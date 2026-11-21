import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "../../lib/aiConfig";
import { getDb } from "./index";
import {
  chunks,
  classes,
  conversations,
  files,
  messageCitations,
  messages,
  users,
} from "./schema";

function hasLocalDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

it.skipIf(!hasLocalDatabase())(
  "enforces chat constraints, file status, and cascading deletion in PostgreSQL",
  async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-api-key");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    const db = getDb();
    const rollback = new Error("Roll back chat integration fixtures.");

    try {
      await expect(
        db.transaction(async (tx) => {
          const userId = randomUUID();
          await tx.insert(authUsers).values({ id: userId });
          await tx.insert(users).values({ id: userId });
          const [course] = await tx
            .insert(classes)
            .values({
              course: `chat-${randomUUID()}`,
              term: "Fall 2026",
              section: "001",
              professor: "Integration Test",
            })
            .returning();
          const [file] = await tx
            .insert(files)
            .values({
              classId: course.id,
              uploadedBy: userId,
              name: "lecture.txt",
              storagePath: `integration/${randomUUID()}`,
            })
            .returning();
          expect(file.status).toBe("pending");
          for (const status of ["ready", "failed"] as const) {
            const [updated] = await tx
              .update(files)
              .set({ status })
              .where(eq(files.id, file.id))
              .returning();
            expect(updated.status).toBe(status);
          }
          const [chunk] = await tx
            .insert(chunks)
            .values({
              fileId: file.id,
              classId: course.id,
              content: "Recursion requires a base case.",
              embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
            })
            .returning();
          const [conversation, otherConversation] = await tx
            .insert(conversations)
            .values([
              { classId: course.id, userId },
              { classId: course.id, userId },
            ])
            .returning();
          const question = {
            conversationId: conversation.id,
            role: "user" as const,
            content: "Explain recursion.",
            idempotencyKey: "request-1",
          };
          await tx.insert(messages).values(question);
          await expect(
            tx.transaction((savepoint) =>
              savepoint.insert(messages).values(question),
            ),
          ).rejects.toMatchObject({ cause: { code: "23505" } });
          await tx
            .insert(messages)
            .values({ ...question, conversationId: otherConversation.id });
          const unkeyedMessages = await tx
            .insert(messages)
            .values([
              { ...question, idempotencyKey: null },
              { ...question, idempotencyKey: null },
            ])
            .returning();
          expect(unkeyedMessages).toHaveLength(2);
          const [answer] = await tx
            .insert(messages)
            .values({
              conversationId: conversation.id,
              role: "assistant",
              content: "Recursion requires a base case. [1]",
            })
            .returning();
          const [citation] = await tx
            .insert(messageCitations)
            .values({
              messageId: answer.id,
              chunkId: chunk.id,
              citationNumber: 1,
            })
            .returning();
          expect(citation).toMatchObject({
            messageId: answer.id,
            chunkId: chunk.id,
            citationNumber: 1,
          });
          await expect(
            tx.transaction((savepoint) =>
              savepoint.execute(
                sql`update ${messages} set role = ${"system"} where id = ${answer.id}`,
              ),
            ),
          ).rejects.toMatchObject({ cause: { code: "22P02" } });
          await expect(
            tx.transaction((savepoint) =>
              savepoint.execute(
                sql`update ${files} set status = ${"processing"} where id = ${file.id}`,
              ),
            ),
          ).rejects.toMatchObject({ cause: { code: "22P02" } });

          await tx.delete(classes).where(eq(classes.id, course.id));
          expect(
            await tx
              .select()
              .from(conversations)
              .where(eq(conversations.id, conversation.id)),
          ).toEqual([]);
          expect(
            await tx.select().from(messages).where(eq(messages.id, answer.id)),
          ).toEqual([]);
          expect(
            await tx
              .select()
              .from(messageCitations)
              .where(eq(messageCitations.id, citation.id)),
          ).toEqual([]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.$client.end({ timeout: 5 });
      vi.unstubAllEnvs();
    }
  },
);
