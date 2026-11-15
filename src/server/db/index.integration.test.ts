import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { getDb } from "./index";
import { classes } from "./schema";

const databaseUrl = process.env.DATABASE_URL;

describe("database integration", () => {
  it.skipIf(!databaseUrl)("inserts and reads a class", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-api-key");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");

    const db = getDb();
    const course = `integration-${randomUUID()}`;

    try {
      const [inserted] = await db
        .insert(classes)
        .values({
          course,
          term: "Fall 2026",
          section: "001",
          professor: "Integration Test",
        })
        .returning();
      const [read] = await db
        .select()
        .from(classes)
        .where(eq(classes.id, inserted.id));

      expect(read).toMatchObject({ id: inserted.id, course });
    } finally {
      await db.delete(classes).where(eq(classes.course, course));
      await db.$client.end({ timeout: 5 });
    }
  });
});
