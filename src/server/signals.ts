import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { memberships, signals, votes } from "./db/schema";

type SignalDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert">;

const VOTE_VALUES = {
  confirm: "confirm",
  dispute: "dispute",
} as const satisfies Record<string, (typeof votes.$inferInsert)["value"]>;

export async function createSignal(
  db: SignalDatabase,
  userId: string,
  classId: string,
  content: string,
) {
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.classId, classId)),
    )
    .limit(1);

  if (!membership) {
    throw new Error("You must be a class member to share a tip.");
  }

  const [signal] = await db
    .insert(signals)
    .values({ authorId: userId, classId, content })
    // Keep the author in the table, but never include it in the shared result.
    .returning({
      id: signals.id,
      classId: signals.classId,
      content: signals.content,
      createdAt: signals.createdAt,
    });

  return signal;
}

export async function voteOnSignal(
  db: SignalDatabase,
  userId: string,
  signalId: string,
  value: (typeof votes.$inferInsert)["value"],
): Promise<void> {
  const [signal] = await db
    .select({ authorId: signals.authorId })
    .from(signals)
    .innerJoin(
      memberships,
      and(
        eq(memberships.classId, signals.classId),
        eq(memberships.userId, userId),
      ),
    )
    .where(eq(signals.id, signalId))
    .limit(1);

  if (!signal) {
    throw new Error("You must be a class member to vote on this tip.");
  }
  if (signal.authorId === userId) {
    throw new Error("You cannot vote on your own tip.");
  }

  await db
    .insert(votes)
    .values({ signalId, userId, value })
    .onConflictDoUpdate({
      target: [votes.signalId, votes.userId],
      set: { value },
      setWhere: ne(votes.value, value),
    });
}

export async function getSignalCounts(db: SignalDatabase, signalId: string) {
  const [counts] = await db
    .select({
      confirms:
        sql`count(*) filter (where ${votes.value} = ${VOTE_VALUES.confirm})`.mapWith(
          Number,
        ),
      disputes:
        sql`count(*) filter (where ${votes.value} = ${VOTE_VALUES.dispute})`.mapWith(
          Number,
        ),
    })
    .from(votes)
    .where(eq(votes.signalId, signalId));

  return counts;
}
