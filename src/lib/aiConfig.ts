// Keep the model and database vector size together; changing these needs a migration.
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const AI_REQUEST_TIMEOUT_MS = 30_000;
export const ANSWER_MAX_OUTPUT_TOKENS = 2048;
