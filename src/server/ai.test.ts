import { afterEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import {
  answerQuestion,
  embedTexts,
  getChatModel,
  getRequestSignal,
} from "./ai";
import { buildPrompt } from "@/lib/prompt";

vi.mock("server-only", () => ({}));

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
    await expect(answerQuestion("Question", [])).rejects.toThrow("CHAT_MODEL");
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

describe("runtime configuration and request bounds", () => {
  it("reads the current model each time without resetting modules", () => {
    vi.stubEnv("CHAT_MODEL", "  test/first  ");
    expect(getChatModel()).toHaveProperty("modelId", "test/first");
    vi.stubEnv("CHAT_MODEL", "test/second");
    expect(getChatModel()).toHaveProperty("modelId", "test/second");
    vi.stubEnv("CHAT_MODEL", undefined);
    expect(() => getChatModel()).toThrow("CHAT_MODEL");
  });
  it("sets an answer budget and forwards caller cancellation", async () => {
    const controller = new AbortController();
    const model = textModel("Answer");
    await answerQuestion("Question", [], model, {
      abortSignal: controller.signal,
    });
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(2048);
    const signal = model.doGenerateCalls[0].abortSignal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
  it("applies a 30-second timeout even without caller cancellation", () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    try {
      const signal = getRequestSignal();
      expect(timeout).toHaveBeenCalledWith(30_000);
      controller.abort(new DOMException("Timed out", "TimeoutError"));
      expect(signal.aborted).toBe(true);
      expect(signal.reason.name).toBe("TimeoutError");
    } finally {
      timeout.mockRestore();
    }
  });
  it("forwards cancellation to embedding calls", async () => {
    const controller = new AbortController();
    const model = new MockEmbeddingModelV4({
      doEmbed: { embeddings: [Array(1536).fill(0)], warnings: [] },
    });
    await embedTexts(["text"], model, { abortSignal: controller.signal });
    const signal = model.doEmbedCalls[0].abortSignal;
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
