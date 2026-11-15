import {
  embedMany,
  gateway,
  generateText,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { parseCitations } from "../lib/citations";
import { buildPrompt, type SourceChunk } from "../lib/prompt";

// Tech leads choose the Gateway model ID; there is deliberately no guessed default.
export const CHAT_MODEL = process.env.CHAT_MODEL?.trim();

export function getChatModel(): LanguageModel {
  if (!CHAT_MODEL)
    throw new Error(
      "CHAT_MODEL must be set to the tech-lead-selected AI Gateway model ID",
    );
  return gateway(CHAT_MODEL);
}

export async function embedTexts(
  texts: string[],
  model: EmbeddingModel = gateway.embeddingModel(
    "openai/text-embedding-3-small",
  ),
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model, values: texts });
  if (embeddings.length !== texts.length) {
    throw new Error("Expected one embedding per input text");
  }
  for (const embedding of embeddings) {
    if (
      embedding.length !== 1536 ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Each embedding must contain 1536 finite numbers");
    }
  }
  return embeddings;
}

export async function answerQuestion(
  question: string,
  chunks: readonly SourceChunk[],
  model: LanguageModel = getChatModel(),
) {
  const { text } = await generateText({
    model,
    prompt: buildPrompt(question, chunks),
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
