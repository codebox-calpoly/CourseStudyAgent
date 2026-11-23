import "server-only";
import { z } from "zod";
import { parseCitations } from "@/lib/citations";
import { AI_REQUEST_TIMEOUT_MS } from "@/lib/aiConfig";
import type {
  ChatDependencies,
  ModelAnswer,
  Source,
  StoredAnswer,
} from "./types";

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
    idempotencyKey: z.string().trim().min(1).max(200),
    conversationId: z.uuid().optional(),
  })
  .strict();

export class ChatHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const refusals = {
  confidential:
    "I can explain a concept, but I cannot share another student's private notes.",
  embargoed:
    "I cannot discuss exam contents before the exam window has closed.",
};

function privateSource(source: Source, userId: string) {
  return source.uploadedBy !== userId && !source.professorReleased;
}

/** Never release model output that contains a retrieved private passage or filename. */
function leaksPrivateText(text: string, sources: Source[], userId: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const output = normalize(text);
  return sources
    .filter((source) => privateSource(source, userId))
    .some((source) => {
      if (
        source.fileName &&
        text.toLowerCase().includes(source.fileName.toLowerCase())
      )
        return true;
      const words = normalize(source.text).split(" ").filter(Boolean);
      const size = Math.min(6, words.length);
      if (!size) return false;
      return words.some(
        (_, index) =>
          index + size <= words.length &&
          output.includes(words.slice(index, index + size).join(" ")),
      );
    });
}

async function answerWithFallback(
  deps: ChatDependencies,
  input: Omit<Parameters<ChatDependencies["answer"]>[0], "model" | "signal">,
  classId: string,
  userId: string,
  requestSignal: AbortSignal,
): Promise<ModelAnswer> {
  for (const [index, model] of [
    deps.primaryModel,
    deps.primaryModel,
    deps.backupModel,
  ].entries()) {
    requestSignal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, requestSignal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: "success" | "error" | "timeout" = "error";
    let result: ModelAnswer | undefined;
    let abortListener: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abortListener = () => reject(signal.reason);
        signal.addEventListener("abort", abortListener, { once: true });
        timer = setTimeout(
          () =>
            controller.abort(
              new DOMException("Model timed out", "TimeoutError"),
            ),
          AI_REQUEST_TIMEOUT_MS,
        );
      });
      result = await Promise.race([
        deps.answer({ ...input, model, signal }),
        cancelled,
      ]);
      signal.throwIfAborted();
      outcome = "success";
      return result;
    } catch (error) {
      outcome = controller.signal.aborted ? "timeout" : "error";
      if (requestSignal.aborted || index === 2) throw error;
    } finally {
      clearTimeout(timer);
      if (abortListener) signal.removeEventListener("abort", abortListener);
      const inputTokens = result?.inputTokens ?? null;
      const outputTokens = result?.outputTokens ?? null;
      // Unknown usage/cost remains null, never a misleading zero. No prompt or answer is logged.
      deps.logUsage({
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd:
          inputTokens === null || outputTokens === null
            ? null
            : deps.estimateCost(model, inputTokens, outputTokens),
        classId,
        userId,
        outcome,
      });
    }
  }
  throw new Error("No model configured");
}

export function createChatHandler(deps: ChatDependencies) {
  return async (
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    try {
      const user = await deps.requireUser(request);
      if (!user) throw new ChatHttpError(401, "Sign in required");
      const { id: classId } = await context.params;
      if (!z.uuid().safeParse(classId).success)
        throw new ChatHttpError(400, "Invalid class ID");
      if (!(await deps.isMember(user.id, classId)))
        throw new ChatHttpError(403, "Class membership required");
      const parsed = bodySchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) throw new ChatHttpError(400, "Invalid request body");
      if (!deps.checkRateLimit(user.id))
        throw new ChatHttpError(429, "Too many messages");
      if (!deps.primaryModel || !deps.backupModel)
        throw new ChatHttpError(503, "Chat models are not configured");
      const { message, idempotencyKey, conversationId } = parsed.data;
      // Buffer untrusted model output until privacy validation and the DB commit.
      // This prevents partial private text or uncommitted answers escaping over SSE.
      const result = await deps.saveMessage(
        { userId: user.id, classId, message, idempotencyKey, conversationId },
        async (recentMessages): Promise<StoredAnswer> => {
          const sources = await deps.retrieve(
            await deps.getClassScope(classId),
            message,
          );
          const history = recentMessages.slice(-10);
          const classification = await deps.classify({
            message,
            recentMessages: history,
            files: sources
              .filter((source) => source.uploadedBy === user.id)
              .map((source) => ({
                name: source.fileName,
                kind: source.kind,
                excerpt: source.text.slice(0, 1000),
              })),
          });
          const parsedLabel = z
            .enum(["answer", "hint_only", "embargoed", "confidential"])
            .safeParse(classification);
          const label = parsedLabel.success ? parsedLabel.data : "hint_only";
          request.signal.throwIfAborted();
          // Only explicitly shareable text is sent to the answer model. Private
          // material keeps its citation slot but is withheld to prevent paraphrase.
          const answer = await answerWithFallback(
            deps,
            {
              message,
              recentMessages: history,
              label,
              sources: sources.map((source) => ({
                fileName: privateSource(source, user.id)
                  ? `a classmate's ${source.kind}`
                  : source.fileName,
                content: privateSource(source, user.id)
                  ? "[Private source text withheld; do not quote or paraphrase.]"
                  : source.text,
              })),
            },
            classId,
            user.id,
            request.signal,
          );
          const text =
            label === "confidential" || label === "embargoed"
              ? refusals[label]
              : leaksPrivateText(answer.text, sources, user.id)
                ? refusals.confidential
                : answer.text;
          const { citations, invalidCitations } = parseCitations(
            text,
            sources.length,
          );
          if (invalidCitations.length)
            throw new Error("Model returned invalid citations");
          return {
            text,
            citations: citations
              .sort((a, b) => a - b)
              .map((number) => {
                const source = sources[number - 1];
                return {
                  number,
                  chunkId: source.id,
                  label: privateSource(source, user.id)
                    ? `a classmate's ${source.kind.replaceAll("_", " ")}`
                    : source.fileName,
                  date: source.date.toISOString().slice(0, 10),
                };
              }),
          };
        },
      );
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const event = (name: string, value: unknown) =>
            controller.enqueue(
              encoder.encode(
                `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`,
              ),
            );
          event("message", { text: result.text });
          event("citations", { citations: result.citations });
          event("done", { conversationId: result.conversationId });
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      if (error instanceof ChatHttpError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      return Response.json(
        {
          error:
            "Chat could not complete. Please retry with the same idempotency key.",
        },
        { status: 503 },
      );
    }
  };
}
