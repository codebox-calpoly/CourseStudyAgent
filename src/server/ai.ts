import "server-only";
import {
  embedMany,
  gateway,
  generateText,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { parseCitations } from "@/lib/citations";
import { buildPrompt, type SourceChunk } from "@/lib/prompt";

import { getChatModelId } from "@/lib/env";
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  AI_REQUEST_TIMEOUT_MS,
  ANSWER_MAX_OUTPUT_TOKENS,
} from "@/lib/aiConfig";

export function getChatModel(): LanguageModel {
  return gateway(getChatModelId());
}

export type AIRequestOptions = { abortSignal?: AbortSignal };

/** Bound every request while also honoring caller cancellation. */
export function getRequestSignal(abortSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
  return abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
}

export async function embedTexts(
  texts: string[],
  model: EmbeddingModel = gateway.embeddingModel(EMBEDDING_MODEL),
  options: AIRequestOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model,
    values: texts,
    abortSignal: getRequestSignal(options.abortSignal),
  });
  if (embeddings.length !== texts.length) {
    throw new Error("Expected one embedding per input text");
  }
  for (const embedding of embeddings) {
    if (
      embedding.length !== EMBEDDING_DIMENSIONS ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `Each embedding must contain ${EMBEDDING_DIMENSIONS} finite numbers`,
      );
    }
  }
  return embeddings;
}

export async function answerQuestion(
  question: string,
  chunks: readonly SourceChunk[],
  model: LanguageModel = getChatModel(),
  options: AIRequestOptions = {},
) {
  const { text } = await generateText({
    model,
    prompt: buildPrompt(question, chunks),
    maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
    abortSignal: getRequestSignal(options.abortSignal),
  });
  const { citations, invalidCitations } = parseCitations(text, chunks.length);
  return {
    text,
    citations: citations.map((number) => ({
      number,
      fileName: chunks[number - 1].fileName,
    })),
    invalidCitations,
  };
}
