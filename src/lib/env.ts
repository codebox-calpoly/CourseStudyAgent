import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
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
