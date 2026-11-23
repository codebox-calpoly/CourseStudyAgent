import "server-only";
import { and, eq } from "drizzle-orm";
import { getChatModelId } from "@/lib/env";
import { getDb } from "../db";
import { memberships } from "../db/schema";
import { getClassScope } from "../getClassScope";
import { createChatHandler } from "./handler";
import { BACKUP_CHAT_MODEL, generateChatAnswer } from "./model";
import { createRateLimiter } from "./rateLimit";
import { createMessageStore } from "./store";
import type { ChatDependencies, Usage } from "./types";

const checkRateLimit = createRateLimiter();

/** One structured line per attempt; never log student messages or source contents. */
export function logChatUsage(usage: Usage) {
  console.info(JSON.stringify({ event: "chat_model_usage", ...usage }));
}

/** Compose once at module scope when the real #41/#49/#50 adapters are ready. */
export function createProductionChatHandler(
  adapters: Pick<
    ChatDependencies,
    "requireUser" | "retrieve" | "classify" | "estimateCost"
  >,
) {
  return createChatHandler({
    ...adapters,
    getClassScope,
    checkRateLimit,
    async isMember(userId, classId) {
      const rows = await getDb()
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.userId, userId), eq(memberships.classId, classId)),
        )
        .limit(1);
      return rows.length > 0;
    },
    answer: generateChatAnswer,
    saveMessage: (input, respond) => createMessageStore()(input, respond),
    logUsage: logChatUsage,
    // Resolve config per request, not at module import / next build time.
    get primaryModel() {
      return getChatModelId();
    },
    get backupModel() {
      return BACKUP_CHAT_MODEL;
    },
  });
}
