import { afterEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { answerQuestion, embedTexts } from "./ai";
import { buildPrompt } from "../lib/prompt";

function textModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("answerQuestion", () => {
  it("uses buildPrompt and maps unique citations to sources without an API key", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    const chunks = [
      { fileName: "lecture.pdf", content: "Processes are isolated." },
      { fileName: "lab.txt", content: "Threads share memory." },
    ];
    const model = textModel(
      "Threads share memory [2]. Processes are isolated [1][2]. Bad [0][3].",
    );
    expect(await answerQuestion("Compare them", chunks, model)).toEqual({
      text: "Threads share memory [2]. Processes are isolated [1][2]. Bad [0][3].",
      citations: [
        { number: 2, fileName: "lab.txt" },
        { number: 1, fileName: "lecture.pdf" },
      ],
      invalidCitations: [0, 3],
    });
    expect(model.doGenerateCalls[0].prompt).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: buildPrompt("Compare them", chunks) }],
      },
    ]);
  });
  it("handles no sources and an uncited answer", async () => {
    expect(
      await answerQuestion("Anything?", [], textModel("I don't know.")),
    ).toEqual({ text: "I don't know.", citations: [], invalidCitations: [] });
  });
  it("imports without configuration but explains the missing live model on call", async () => {
    vi.stubEnv("CHAT_MODEL", " ");
    vi.resetModules();
    const aiModule = await import("./ai");
    await expect(aiModule.answerQuestion("Question", [])).rejects.toThrow(
      "CHAT_MODEL",
    );
  });
});

describe("embedTexts", () => {
  it("returns vectors in input order using a mock without credentials", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    const embeddings = [Array(1536).fill(0.1), Array(1536).fill(0.2)];
    const model = new MockEmbeddingModelV4({
      maxEmbeddingsPerCall: 10,
      doEmbed: { embeddings, warnings: [] },
    });
    expect(await embedTexts(["first", "second"], model)).toEqual(embeddings);
    expect(model.doEmbedCalls[0].values).toEqual(["first", "second"]);
  });
  it("skips the model for empty inputs", async () => {
    const model = new MockEmbeddingModelV4();
    expect(await embedTexts([], model)).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
  });
  it.each([1535, 1537])("rejects a vector with %s dimensions", async (size) => {
    const model = new MockEmbeddingModelV4({
      doEmbed: { embeddings: [Array(size).fill(0)], warnings: [] },
    });
    await expect(embedTexts(["text"], model)).rejects.toThrow("1536");
  });
  it("rejects nonfinite values even with the right dimensions", async () => {
    const vector = Array(1536).fill(0);
    vector[0] = NaN;
    await expect(
      embedTexts(
        ["text"],
        new MockEmbeddingModelV4({
          doEmbed: { embeddings: [vector], warnings: [] },
        }),
      ),
    ).rejects.toThrow("finite");
  });
});
