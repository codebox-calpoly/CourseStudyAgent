import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("server-only", () => ({}));
import {
  createMessageStore,
  type ChatDatabase,
  type ChatTransaction,
} from "./store";

const input = {
  userId: "me",
  classId: "class",
  message: "Question",
  idempotencyKey: "retry",
};
const answer = {
  text: "Answer [1]",
  citations: [
    { number: 1, chunkId: "chunk", label: "my notes", date: "2026-11-01" },
  ],
};

/** Transactional fake: staged writes are committed only if the callback resolves. */
function database(failCitation = false) {
  const state: { role: string; content: string; key: string }[] = [];
  const queries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const db: ChatDatabase = {
    transaction: vi.fn(async (work) => {
      const staged = [...state];
      const tx: ChatTransaction = {
        execute: async <T extends Record<string, unknown>>(
          query: SQL,
        ): Promise<T[]> => {
          const q = dialect.sqlToQuery(query);
          queries.push(q);
          let rows: Record<string, unknown>[] = [];
          if (q.sql.includes("select m.conversation_id")) {
            const existing = staged.find((row) => row.role === "user");
            rows = existing
              ? [{ conversation_id: "conversation", content: existing.content }]
              : [];
          } else if (q.sql.includes("insert into conversations"))
            rows = [{ id: "conversation" }];
          else if (q.sql.includes("insert into messages")) {
            const role = q.sql.includes("'assistant'") ? "assistant" : "user";
            staged.push({
              role,
              content: q.params[1] as string,
              key: q.params[2] as string,
            });
            rows = [{ id: "answer" }];
          } else if (
            q.sql.includes("insert into message_citations") &&
            failCitation
          )
            throw new Error("citation foreign key failed");
          else if (q.sql.includes("select id, content from messages"))
            rows = staged
              .filter((row) => row.role === "assistant")
              .map((row) => ({ id: "answer", content: row.content }));
          else if (q.sql.includes("from message_citations"))
            rows = [
              {
                citation_number: 1,
                name: "Alex-private.pdf",
                kind: "lecture_notes",
                date: "2026-11-01",
                uploaded_by: "someone else",
                professor_released: false,
              },
            ];
          return rows as T[];
        },
      };
      const result = await work(tx);
      state.splice(0, state.length, ...staged);
      return result;
    }),
  };
  return { db, state, queries };
}

describe("message persistence transaction", () => {
  it("writes the user, answer and citations in one transaction", async () => {
    const { db, state, queries } = database();
    const result = await createMessageStore(db)(input, async () => answer);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(state.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(queries.at(-1)?.sql).toContain("insert into message_citations");
    expect(queries.at(-1)?.params).toEqual(["answer", "chunk", 1]);
    expect(result.citations).toEqual([
      { number: 1, label: "my notes", date: "2026-11-01" },
    ]);
    expect(queries[0].sql).toContain("pg_advisory_xact_lock");
    expect(queries[0].params).toEqual(["me:class"]);
  });
  it("rolls the answer back when saving a citation fails", async () => {
    const { db, state } = database(true);
    await expect(
      createMessageStore(db)(input, async () => answer),
    ).rejects.toThrow("citation foreign key failed");
    expect(state).toEqual([]);
  });
  it("deduplicates retries without saving or generating another message", async () => {
    const { db, state } = database();
    const store = createMessageStore(db);
    const respond = vi.fn(async () => answer);
    await store(input, respond);
    const second = await store(input, respond);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(state).toHaveLength(2);
    expect(second.text).toBe(answer.text);
    expect(second.citations).toEqual([
      { number: 1, label: "a classmate's lecture notes", date: "2026-11-01" },
    ]);
    expect(JSON.stringify(second)).not.toContain("Alex");
  });
  it("rejects reusing a key for different content", async () => {
    const { db } = database();
    const store = createMessageStore(db);
    await store(input, async () => answer);
    await expect(
      store({ ...input, message: "Another question" }, async () => answer),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("checks conversation ownership before inserting anything", async () => {
    const { db, state, queries } = database();
    await expect(
      createMessageStore(db)(
        { ...input, conversationId: "foreign" },
        async () => answer,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(state).toEqual([]);
    expect(queries[1].sql).toContain("user_id =");
    expect(queries[1].sql).toContain("class_id =");
    expect(queries[1].params).toEqual(["foreign", "me", "class"]);
  });
});
