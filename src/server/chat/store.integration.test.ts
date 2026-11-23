import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { adaptChatDatabase, createMessageStore } from "./store";
import * as schema from "../db/schema";

// Explicit opt-in to a LOCAL disposable PostgreSQL database. All tables below
// are connection-local temporary tables, not the application's real tables.
const url = process.env.CHAT_TEST_DATABASE_URL;
it.skipIf(!url)(
  "PostgreSQL rolls back a failed citation and serializes duplicate requests",
  async () => {
    const client = postgres(url!, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      await db.execute(
        sql`create temporary table conversations (id uuid primary key default gen_random_uuid(), class_id uuid not null, user_id uuid not null)`,
      );
      await db.execute(
        sql`create temporary table messages (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), conversation_id uuid references conversations(id), role text, content text, idempotency_key text, unique(conversation_id, idempotency_key))`,
      );
      await db.execute(
        sql`create temporary table files (id uuid primary key, name text, kind text, taught_on date, created_at timestamptz default now(), uploaded_by uuid, professor_released boolean)`,
      );
      await db.execute(
        sql`create temporary table chunks (id uuid primary key, file_id uuid references files(id))`,
      );
      await db.execute(
        sql`create temporary table message_citations (message_id uuid references messages(id), chunk_id uuid references chunks(id), citation_number integer)`,
      );
      const input = {
        userId: randomUUID(),
        classId: randomUUID(),
        message: "Explain recursion",
        idempotencyKey: "retry-key",
      };
      const chunkId = randomUUID();
      const fileId = randomUUID();
      const result = {
        text: "A concept [1]",
        citations: [
          { chunkId, number: 1, label: "own.pdf", date: "2026-11-01" },
        ],
      };
      const store = createMessageStore(adaptChatDatabase(db));
      await expect(store(input, async () => result)).rejects.toThrow();
      expect(await db.execute(sql`select * from messages`)).toHaveLength(0);
      expect(await db.execute(sql`select * from conversations`)).toHaveLength(
        0,
      );
      await db.execute(
        sql`insert into files (id,name,kind,taught_on,uploaded_by,professor_released) values (${fileId},'own.pdf','notes','2026-11-01',${input.userId},false)`,
      );
      await db.execute(
        sql`insert into chunks (id,file_id) values (${chunkId},${fileId})`,
      );
      const respond = vi.fn(async () => result);
      const [first, second] = await Promise.all([
        store(input, respond),
        store(input, respond),
      ]);
      expect(first).toEqual(second);
      expect(respond).toHaveBeenCalledTimes(1);
      expect(await db.execute(sql`select * from messages`)).toHaveLength(2);
      expect(
        await db.execute(sql`select * from message_citations`),
      ).toHaveLength(1);
    } finally {
      await client.end({ timeout: 5 });
    }
  },
);
