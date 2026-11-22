import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "./db";
import { prerequisites } from "./db/schema";

/**
 * Prerequisite classes are searched only on the server and follow the same
 * privacy rules: classmates' notes may cite only the material kind and date.
 * This returns direct prerequisites; it does not perform the search itself.
 */
export async function getClassScope(classId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: prerequisites.prerequisiteClassId })
    .from(prerequisites)
    .where(eq(prerequisites.classId, classId));
  return [...new Set([classId, ...rows.map(({ id }) => id)])];
}
