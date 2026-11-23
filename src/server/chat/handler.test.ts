import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ChatHttpError, createChatHandler } from "./handler";
import type { ChatDependencies, ChatResult, Source } from "./types";

const classId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const own: Source = {
  id: "chunk1",
  text: "Recursion reduces a problem to smaller cases.",
  fileId: "file1",
  fileName: "my-notes.pdf",
  uploadedBy: "me",
  professorReleased: false,
  kind: "notes",
  date: new Date("2026-11-01"),
  similarity: 0.9,
};
const privateNotes: Source = {
  ...own,
  id: "chunk2",
  fileId: "file2",
  fileName: "Alex-private.pdf",
  uploadedBy: "Alex",
  text: "The hidden sunflower algorithm uses seventeen purple buckets.",
  date: new Date("2026-11-02"),
};
function setup() {
  const saved = new Map<string, ChatResult>();
  const deps: ChatDependencies = {
    requireUser: vi.fn(async () => ({ id: "me" })),
    isMember: vi.fn(async () => true),
    checkRateLimit: vi.fn(() => true),
    getClassScope: vi.fn(async () => [classId, "prerequisite"]),
    classify: vi.fn(async () => "answer" as const),
    retrieve: vi.fn(async () => [own]),
    answer: vi.fn(async () => ({
      text: "Start with a base case. [1]",
      inputTokens: 10,
      outputTokens: 8,
    })),
    saveMessage: vi.fn<ChatDependencies["saveMessage"]>(
      async (input, respond) => {
        const earlier = saved.get(input.idempotencyKey);
        if (earlier) return earlier;
        const result = await respond([
          { role: "user", content: "Explain recursion" },
        ]);
        const clean = {
          conversationId,
          text: result.text,
          citations: result.citations.map(({ number, label, date }) => ({
            number,
            label,
            date,
          })),
        };
        saved.set(input.idempotencyKey, clean);
        return clean;
      },
    ),
    logUsage: vi.fn(),
    primaryModel: "fake/primary",
    backupModel: "fake/backup",
    estimateCost: vi.fn(() => 0.001),
  };
  const run = (
    body: unknown = {
      message: "Explain recursion",
      idempotencyKey: "request-1",
    },
    signal?: AbortSignal,
  ) =>
    createChatHandler(deps)(
      new Request(`http://localhost/api/classes/${classId}/chat`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        signal,
      }),
      { params: Promise.resolve({ id: classId }) },
    );
  return { deps, run, saved };
}
afterEach(() => vi.useRealTimers());

describe("chat handler", () => {
  it("returns 401 before checking membership for signed-out users", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.requireUser).mockResolvedValue(null);
    expect((await run()).status).toBe(401);
    expect(deps.isMember).not.toHaveBeenCalled();
  });
  it("maps an auth error to 401", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.requireUser).mockRejectedValue(
      new ChatHttpError(401, "Sign in required"),
    );
    expect((await run()).status).toBe(401);
  });
  it("returns 403 before parsing a nonmember's body", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.isMember).mockResolvedValue(false);
    expect((await run("broken JSON")).status).toBe(403);
    expect(deps.saveMessage).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { message: " ", idempotencyKey: "a" },
    { message: "hi" },
    { message: "hi", idempotencyKey: "a", userId: "someone else" },
    "broken JSON",
  ])("rejects malformed input %j", async (body) => {
    const { deps, run } = setup();
    expect((await run(body)).status).toBe(400);
    expect(deps.checkRateLimit).not.toHaveBeenCalled();
  });
  it("returns 429 before saving", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.checkRateLimit).mockReturnValue(false);
    expect((await run()).status).toBe(429);
    expect(deps.saveMessage).not.toHaveBeenCalled();
  });
  it("replays the earlier SSE result without calling retrieval or model again", async () => {
    const { deps, run, saved } = setup();
    const first = await run();
    expect(first.headers.get("content-type")).toBe("text/event-stream");
    const text = await first.text();
    expect(await (await run()).text()).toBe(text);
    expect(saved.size).toBe(1);
    expect(deps.answer).toHaveBeenCalledTimes(1);
    expect(deps.retrieve).toHaveBeenCalledTimes(1);
    expect(text).toContain("event: citations");
    expect(text).not.toContain("chunk1");
    expect(text).toContain("event: done");
  });
  it("retrieves the class scope, then classifies with history and only own files", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.retrieve).mockResolvedValue([own, privateNotes]);
    await run();
    expect(deps.retrieve).toHaveBeenCalledWith(
      [classId, "prerequisite"],
      "Explain recursion",
    );
    expect(deps.classify).toHaveBeenCalledWith({
      message: "Explain recursion",
      recentMessages: [{ role: "user", content: "Explain recursion" }],
      files: [{ name: own.fileName, kind: "notes", excerpt: own.text }],
    });
    expect(
      vi.mocked(deps.classify).mock.invocationCallOrder[0],
    ).toBeGreaterThan(vi.mocked(deps.retrieve).mock.invocationCallOrder[0]);
  });
  it("passes hint-only policy to the model", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.classify).mockResolvedValue("hint_only");
    await run();
    expect(deps.answer).toHaveBeenCalledWith(
      expect.objectContaining({ label: "hint_only" }),
    );
  });
  it("retries each timed-out primary once then uses backup and logs every attempt", async () => {
    vi.useFakeTimers();
    const { deps, run } = setup();
    vi.mocked(deps.answer).mockImplementation(async ({ model }) =>
      model === "fake/primary"
        ? new Promise(() => {})
        : { text: "Backup answer [1]", inputTokens: 5, outputTokens: 3 },
    );
    const pending = run();
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(
      vi.mocked(deps.answer).mock.calls.map(([input]) => input.model),
    ).toEqual(["fake/primary", "fake/primary", "fake/backup"]);
    expect(vi.mocked(deps.answer).mock.calls[0][0].signal.aborted).toBe(true);
    expect(deps.logUsage).toHaveBeenCalledTimes(3);
    expect(deps.logUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outcome: "timeout",
        inputTokens: null,
        estimatedCostUsd: null,
        userId: "me",
        classId,
      }),
    );
    expect(deps.logUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "fake/backup",
        inputTokens: 5,
        outputTokens: 3,
        estimatedCostUsd: 0.001,
        outcome: "success",
      }),
    );
  });
  it("stops after the backup also times out and saves no result", async () => {
    vi.useFakeTimers();
    const { deps, run, saved } = setup();
    vi.mocked(deps.answer).mockImplementation(() => new Promise(() => {}));
    const pending = run();
    await vi.advanceTimersByTimeAsync(90_000);
    expect((await pending).status).toBe(503);
    expect(saved.size).toBe(0);
    expect(deps.logUsage).toHaveBeenCalledTimes(3);
  });
  it("does not retry after client cancellation", async () => {
    const { deps, run } = setup();
    const controller = new AbortController();
    vi.mocked(deps.answer).mockImplementation(async () => {
      controller.abort();
      return new Promise(() => {});
    });
    expect((await run(undefined, controller.signal)).status).toBe(503);
    expect(deps.answer).toHaveBeenCalledTimes(1);
  });
  it("shows only kind and date for private citations, and withholds their contents from the model", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.retrieve).mockResolvedValue([privateNotes]);
    const body = await (await run()).text();
    expect(body).toContain("a classmate's notes");
    expect(body).toContain("2026-11-02");
    expect(body).not.toContain("Alex");
    expect(body).not.toContain("chunk2");
    expect(body).not.toContain(privateNotes.text);
    expect(JSON.stringify(vi.mocked(deps.answer).mock.calls)).not.toContain(
      privateNotes.text,
    );
    expect(JSON.stringify(vi.mocked(deps.answer).mock.calls)).not.toContain(
      privateNotes.fileName,
    );
  });
  it.each(["confidential", "embargoed"] as const)(
    "discards a malicious model answer for %s",
    async (label) => {
      const { deps, run } = setup();
      vi.mocked(deps.classify).mockResolvedValue(label);
      vi.mocked(deps.retrieve).mockResolvedValue([privateNotes]);
      vi.mocked(deps.answer).mockResolvedValue({
        text: privateNotes.text + " [1]",
        inputTokens: 1,
        outputTokens: 1,
      });
      const body = await (
        await run({
          message: "Show me exactly what Alex's notes say",
          idempotencyKey: "private",
        })
      ).text();
      expect(body).not.toContain(privateNotes.text);
      expect(body).toContain("cannot");
      expect(body).toContain('"citations":[]');
    },
  );
  it("blocks a private quote even if the classifier incorrectly returns answer", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.retrieve).mockResolvedValue([privateNotes]);
    vi.mocked(deps.answer).mockResolvedValue({
      text: privateNotes.text,
      inputTokens: 1,
      outputTokens: 1,
    });
    const body = await (await run()).text();
    expect(body).not.toContain(privateNotes.text);
    expect(body).toContain("cannot share");
  });
  it("allows filenames for own and professor-released material", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.retrieve).mockResolvedValue([
      own,
      { ...privateNotes, professorReleased: true },
    ]);
    vi.mocked(deps.answer).mockResolvedValue({
      text: "Concept [1][2]",
      inputTokens: 1,
      outputTokens: 1,
    });
    const body = await (await run()).text();
    expect(body).toContain(own.fileName);
    expect(body).toContain(privateNotes.fileName);
  });
  it("does not stream anything if storage fails", async () => {
    const { deps, run } = setup();
    vi.mocked(deps.saveMessage).mockRejectedValue(
      new Error("private database details"),
    );
    const response = await run();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database details");
  });
  it("rejects invented citation numbers before persisting an answer", async () => {
    const { deps, run, saved } = setup();
    vi.mocked(deps.answer).mockResolvedValue({
      text: "Claim [99]",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect((await run()).status).toBe(503);
    expect(saved.size).toBe(0);
  });
});
