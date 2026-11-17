import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  CHAT_MODEL: z.string().trim().min(1).optional(),
});

/** Validate runtime configuration on demand, never during module import. */
export function getEnv(
  source: Record<string, string | undefined> = process.env,
) {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return result.data;
}

/** Read only chat configuration, so AI calls do not require unrelated DB/auth keys. */
export function getChatModelId(
  source: Record<string, string | undefined> = process.env,
) {
  const result = envSchema.pick({ CHAT_MODEL: true }).safeParse(source);
  if (!result.success || !result.data.CHAT_MODEL) {
    throw new Error("CHAT_MODEL must be set to the AI Gateway model ID");
  }
  return result.data.CHAT_MODEL;
}
