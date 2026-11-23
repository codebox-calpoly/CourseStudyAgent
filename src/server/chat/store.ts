import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { ChatHttpError } from "./handler";
import type { ChatDependencies, Citation, GuardrailInput } from "./types";

export type ChatTransaction = {
  execute: <T extends Record<string, unknown> = Record<string, unknown>>(
    query: SQL,
  ) => Promise<T[]>;
};
export type ChatDatabase = {
  transaction: <T>(work: (tx: ChatTransaction) => Promise<T>) => Promise<T>;
};

/** Normalize Drizzle's driver-specific RowList into plain typed query rows. */
export function adaptChatDatabase(
  db: Pick<ReturnType<typeof getDb>, "transaction">,
): ChatDatabase {
  return {
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          execute: async <T extends Record<string, unknown>>(query: SQL) => {
            const rows = await tx.execute(query);
            return [...rows] as T[];
          },
        }),
      ),
  };
}

/** Requires #47's conversations, messages and message_citations migration. */
export function createMessageStore(
  db: ChatDatabase = adaptChatDatabase(getDb()),
): ChatDependencies["saveMessage"] {
  return async (input, respond) =>
    db.transaction(async (tx) => {
      // Serialize this user's class conversation, including simultaneous retries.
      // The lock is transaction-scoped and released on rollback or commit.
      // Tradeoff: a transaction stays open during generation (at most three 30s attempts).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.userId + ":" + input.classId}, 0))`,
      );
      const userKey = `user:${input.idempotencyKey}`;
      const answerKey = `assistant:${input.idempotencyKey}`;
      if (input.conversationId) {
        const owned = await tx.execute(
          sql`select id from conversations where id = ${input.conversationId} and user_id = ${input.userId} and class_id = ${input.classId}`,
        );
        if (!owned.length)
          throw new ChatHttpError(403, "Conversation access denied");
      }
      const existing = await tx.execute<{
        conversation_id: string;
        content: string;
      }>(sql`
      select m.conversation_id, m.content from messages m join conversations c on c.id = m.conversation_id
      where c.user_id = ${input.userId} and c.class_id = ${input.classId} and m.idempotency_key = ${userKey}
      
      limit 1`);
      let conversationId = input.conversationId;
      if (existing[0]) {
        if (
          existing[0].content !== input.message ||
          (input.conversationId &&
            input.conversationId !== existing[0].conversation_id)
        )
          throw new ChatHttpError(
            409,
            "Idempotency key already used for another message",
          );
        conversationId = existing[0].conversation_id;
        const answers = await tx.execute<{ id: string; content: string }>(
          sql`select id, content from messages where conversation_id = ${conversationId} and idempotency_key = ${answerKey}`,
        );
        if (!answers[0])
          throw new ChatHttpError(
            409,
            "Earlier message has no completed answer",
          );
        const citations = await tx.execute<{
          citation_number: number;
          name: string;
          kind: string;
          date: string;
          uploaded_by: string;
          professor_released: boolean;
        }>(sql`
        select mc.citation_number, f.name, f.kind, coalesce(f.taught_on, f.created_at::date)::text as date, f.uploaded_by, f.professor_released
        from message_citations mc join chunks ch on ch.id = mc.chunk_id join files f on f.id = ch.file_id
        where mc.message_id = ${answers[0].id} order by mc.citation_number`);
        return {
          conversationId,
          text: answers[0].content,
          citations: citations.map((citation): Citation => ({
            number: citation.citation_number,
            label:
              citation.uploaded_by === input.userId ||
              citation.professor_released
                ? citation.name
                : `a classmate's ${citation.kind.replaceAll("_", " ")}`,
            date: citation.date,
          })),
        };
      }
      if (!conversationId) {
        const created = await tx.execute<{ id: string }>(
          sql`insert into conversations (class_id, user_id) values (${input.classId}, ${input.userId}) returning id`,
        );
        conversationId = created[0].id;
      }
      const recent = await tx.execute<{
        role: "user" | "assistant";
        content: string;
      }>(
        sql`select role, content from messages where conversation_id = ${conversationId} order by created_at desc, id desc limit 10`,
      );
      await tx.execute(
        sql`insert into messages (conversation_id, role, content, idempotency_key, created_at) values (${conversationId}, 'user', ${input.message}, ${userKey}, clock_timestamp())`,
      );
      const history: GuardrailInput["recentMessages"] = [...recent]
        .reverse()
        .map(({ role, content }) => ({ role, content }));
      const answer = await respond(history);
      const saved = await tx.execute<{ id: string }>(
        sql`insert into messages (conversation_id, role, content, idempotency_key, created_at) values (${conversationId}, 'assistant', ${answer.text}, ${answerKey}, clock_timestamp()) returning id`,
      );
      for (const citation of answer.citations) {
        await tx.execute(
          sql`insert into message_citations (message_id, chunk_id, citation_number) values (${saved[0].id}, ${citation.chunkId}, ${citation.number})`,
        );
      }
      // Any citation failure rejects the transaction, rolling back the answer too.
      return {
        conversationId,
        text: answer.text,
        citations: answer.citations.map(({ number, label, date }) => ({
          number,
          label,
          date,
        })),
      };
    });
}
