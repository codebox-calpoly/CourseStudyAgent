import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { authUsers } from "drizzle-orm/supabase";
import { expect, test, vi } from "vitest";
import { signalScore } from "@/lib/signalScore";
import { getDb } from "./db";
import { classes, memberships, signals, users, votes } from "./db/schema";
import { createSignal, getSignalCounts, voteOnSignal } from "./signals";

vi.mock("server-only", () => ({}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CLASS_ID = "00000000-0000-4000-8000-000000000002";
const SIGNAL_ID = "00000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000005";
const OTHER_SIGNAL_ID = "00000000-0000-4000-8000-000000000006";
const CONTENT = "The professor said Makefiles will be on the exam.";

test("does not save a tip when the user is not a member of its class", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const db = drizzle(query);

  await expect(createSignal(db, USER_ID, CLASS_ID, CONTENT)).rejects.toThrow(
    "You must be a class member to share a tip.",
  );

  expect(query).toHaveBeenCalledTimes(1);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('from "memberships"');
  expect(sql).toContain('"memberships"."user_id" = $1');
  expect(sql).toContain('"memberships"."class_id" = $2');
  expect(params).toEqual([USER_ID, CLASS_ID, 1]);
});

test("saves the author internally and returns only shared tip fields", async () => {
  const createdAt = "2026-11-19T12:00:00.000Z";
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [["membership-id"]] })
    .mockResolvedValueOnce({
      rows: [[SIGNAL_ID, CLASS_ID, CONTENT, createdAt]],
    });
  const db = drizzle(query);

  const result = await createSignal(db, USER_ID, CLASS_ID, CONTENT);

  expect(result).toEqual({
    id: SIGNAL_ID,
    classId: CLASS_ID,
    content: CONTENT,
    createdAt: new Date(createdAt),
  });
  expect(result).not.toHaveProperty("authorId");
  expect(result).not.toHaveProperty("author_id");
  expect(query).toHaveBeenCalledTimes(2);
  const [sql, params] = query.mock.calls[1];
  expect(sql).toContain('insert into "signals"');
  expect(params).toEqual([CLASS_ID, USER_ID, CONTENT]);
  expect(sql.split(" returning ")[1]).not.toContain("author_id");
});

test("propagates a failed save instead of reporting success", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [["membership-id"]] })
    .mockRejectedValueOnce(new Error("Database unavailable"));

  await expect(
    createSignal(drizzle(query), USER_ID, CLASS_ID, CONTENT),
  ).rejects.toThrow();
});

test("does not record a vote without membership in the tip's class", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });

  await expect(
    voteOnSignal(drizzle(query), USER_ID, SIGNAL_ID, "confirm"),
  ).rejects.toThrow("You must be a class member to vote on this tip.");

  expect(query).toHaveBeenCalledTimes(1);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('inner join "memberships"');
  expect(sql).toContain('"memberships"."class_id" = "signals"."class_id"');
  expect(sql).toContain('"memberships"."user_id" = $1');
  expect(sql).toContain('"signals"."id" = $2');
  expect(params).toEqual([USER_ID, SIGNAL_ID, 1]);
});

test("does not let the author vote on their own tip", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [[USER_ID]] });

  await expect(
    voteOnSignal(drizzle(query), USER_ID, SIGNAL_ID, "dispute"),
  ).rejects.toThrow("You cannot vote on your own tip.");

  expect(query).toHaveBeenCalledTimes(1);
});

test.each(["confirm", "dispute"] as const)(
  "records a %s vote using the unique signal/user pair without returning identities",
  async (value) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [[AUTHOR_ID]] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await voteOnSignal(
      drizzle(query),
      USER_ID,
      SIGNAL_ID,
      value,
    );

    expect(result).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('insert into "votes"');
    expect(sql).toContain('on conflict ("signal_id","user_id") do update');
    expect(sql).toContain('set "value" = $4 where "votes"."value" <> $5');
    expect(params).toEqual([SIGNAL_ID, USER_ID, value, value, value]);
  },
);

test.each([
  [0, 0],
  [3, 1],
  [1, 3],
])(
  "returns %i confirms and %i disputes as numbers",
  async (confirms, disputes) => {
    const query = vi.fn().mockResolvedValue({
      rows: [[String(confirms), String(disputes)]],
    });

    const counts = await getSignalCounts(drizzle(query), SIGNAL_ID);

    expect(counts).toEqual({ confirms, disputes });
    expect(signalScore(counts.confirms, counts.disputes)).toBe(
      (confirms + 1) / (confirms + disputes + 2),
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('count(*) filter (where "value" = $1)');
    expect(sql).toContain('count(*) filter (where "value" = $2)');
    expect(sql).toContain('where "votes"."signal_id" = $3');
    expect(sql).not.toContain("author_id");
    expect(sql).not.toContain("user_id");
    expect(params).toEqual(["confirm", "dispute", SIGNAL_ID]);
  },
);

test("counts repeated and changed votes once and excludes other tips", async () => {
  type VoteValue = Parameters<typeof voteOnSignal>[3];
  const storedVotes = new Map<string, { signalId: string; value: VoteValue }>();
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('insert into "votes"')) {
      const [signalId, userId, value] = params as [string, string, VoteValue];
      storedVotes.set(`${signalId}:${userId}`, { signalId, value });
      return { rows: [] };
    }
    if (sql.includes("count(*)")) {
      const votesForTip = [...storedVotes.values()].filter(
        (vote) => vote.signalId === params[2],
      );
      return {
        rows: [
          [
            votesForTip.filter((vote) => vote.value === "confirm").length,
            votesForTip.filter((vote) => vote.value === "dispute").length,
          ],
        ],
      };
    }
    return { rows: [[AUTHOR_ID]] };
  });
  const db = drizzle(query);

  await voteOnSignal(db, USER_ID, SIGNAL_ID, "confirm");
  await voteOnSignal(db, USER_ID, SIGNAL_ID, "confirm");
  expect(storedVotes.size).toBe(1);
  expect(await getSignalCounts(db, SIGNAL_ID)).toEqual({
    confirms: 1,
    disputes: 0,
  });

  await voteOnSignal(db, USER_ID, SIGNAL_ID, "dispute");
  expect(storedVotes.size).toBe(1);
  expect(await getSignalCounts(db, SIGNAL_ID)).toEqual({
    confirms: 0,
    disputes: 1,
  });

  await voteOnSignal(db, OTHER_USER_ID, SIGNAL_ID, "confirm");
  await voteOnSignal(db, USER_ID, OTHER_SIGNAL_ID, "dispute");
  expect(await getSignalCounts(db, SIGNAL_ID)).toEqual({
    confirms: 1,
    disputes: 1,
  });
});

function hasLocalDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

// Keep unit tests above independent of a running database; test real SQL locally too.
test.skipIf(!hasLocalDatabase())(
  "shares tips and enforces voting rules against local Supabase",
  async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-api-key");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    const db = getDb();
    const rollback = new Error("Roll back signal integration fixtures.");

    try {
      await expect(
        db.transaction(async (tx) => {
          const [authorId, voterId, secondVoterId, outsiderId] = Array.from(
            { length: 4 },
            () => randomUUID(),
          );
          const identities = [authorId, voterId, secondVoterId, outsiderId].map(
            (id) => ({ id }),
          );
          await tx.insert(authUsers).values(identities);
          await tx.insert(users).values(identities);
          const [course] = await tx
            .insert(classes)
            .values({
              course: `signals-${randomUUID()}`,
              term: "Fall 2026",
              section: "001",
              professor: "Integration Test",
            })
            .returning();
          await tx.insert(memberships).values(
            [authorId, voterId, secondVoterId].map((userId) => ({
              userId,
              classId: course.id,
              role: "student" as const,
            })),
          );

          await expect(
            createSignal(tx, outsiderId, course.id, CONTENT),
          ).rejects.toThrow("You must be a class member to share a tip.");
          const tip = await createSignal(tx, authorId, course.id, CONTENT);
          expect(tip).toEqual({
            id: expect.any(String),
            classId: course.id,
            content: CONTENT,
            createdAt: expect.any(Date),
          });
          const [storedTip] = await tx
            .select()
            .from(signals)
            .where(eq(signals.id, tip.id));
          expect(storedTip.authorId).toBe(authorId);
          await expect(
            voteOnSignal(tx, outsiderId, tip.id, "confirm"),
          ).rejects.toThrow("You must be a class member to vote on this tip.");
          await expect(
            voteOnSignal(tx, authorId, tip.id, "confirm"),
          ).rejects.toThrow("You cannot vote on your own tip.");
          expect(await getSignalCounts(tx, tip.id)).toEqual({
            confirms: 0,
            disputes: 0,
          });

          expect(
            await voteOnSignal(tx, voterId, tip.id, "confirm"),
          ).toBeUndefined();
          await voteOnSignal(tx, voterId, tip.id, "confirm");
          const [originalVote] = await tx
            .select()
            .from(votes)
            .where(eq(votes.signalId, tip.id));
          expect(await getSignalCounts(tx, tip.id)).toEqual({
            confirms: 1,
            disputes: 0,
          });

          await voteOnSignal(tx, voterId, tip.id, "dispute");
          const changedVotes = await tx
            .select()
            .from(votes)
            .where(eq(votes.signalId, tip.id));
          expect(changedVotes).toHaveLength(1);
          expect(changedVotes[0]).toMatchObject({
            id: originalVote.id,
            value: "dispute",
          });
          expect(await getSignalCounts(tx, tip.id)).toEqual({
            confirms: 0,
            disputes: 1,
          });
          await voteOnSignal(tx, secondVoterId, tip.id, "confirm");
          const otherTip = await createSignal(tx, authorId, course.id, CONTENT);
          await voteOnSignal(tx, voterId, otherTip.id, "dispute");
          const counts = await getSignalCounts(tx, tip.id);
          expect(counts).toEqual({ confirms: 1, disputes: 1 });
          expect(signalScore(counts.confirms, counts.disputes)).toBe(0.5);

          // Roll back fixtures, including when an assertion fails.
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.$client.end({ timeout: 5 });
      vi.unstubAllEnvs();
    }
  },
);
