import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "../../lib/env";

import * as schema from "./schema";

const createDb = () =>
  drizzle(postgres(getEnv().DATABASE_URL), {
    schema,
  });

let db: ReturnType<typeof createDb> | undefined;

/** Return the shared database client, creating it only when first needed. */
export function getDb() {
  db ??= createDb();
  return db;
}
