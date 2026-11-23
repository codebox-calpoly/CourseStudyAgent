import type { getClassScope } from "../getClassScope";

export type GuardrailLabel =
  "answer" | "hint_only" | "embargoed" | "confidential";
export type GuardrailInput = {
  message: string;
  recentMessages: { role: "user" | "assistant"; content: string }[];
  files: { name: string; kind?: string; excerpt: string }[];
};

/** Retrieval contract proposed for #49. Never serialize this object to clients. */
export type Source = {
  id: string;
  text: string;
  fileId: string;
  fileName: string;
  uploadedBy: string;
  professorReleased: boolean;
  kind: string;
  date: Date;
  similarity: number;
};
export type Citation = { number: number; label: string; date: string };
export type ChatResult = {
  conversationId: string;
  text: string;
  citations: Citation[];
};
export type StoredAnswer = {
  text: string;
  citations: (Citation & { chunkId: string })[];
};
export type MessageInput = {
  userId: string;
  classId: string;
  conversationId?: string;
  message: string;
  idempotencyKey: string;
};
export type Usage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  classId: string;
  userId: string;
  outcome: "success" | "error" | "timeout";
};
export type AnswerInput = {
  message: string;
  recentMessages: GuardrailInput["recentMessages"];
  sources: { fileName: string; content: string }[];
  label: GuardrailLabel;
  model: string;
  signal: AbortSignal;
};
export type ModelAnswer = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};
export type ChatDependencies = {
  requireUser: (request: Request) => Promise<{ id: string } | null>;
  isMember: (userId: string, classId: string) => Promise<boolean>;
  checkRateLimit: (userId: string) => boolean;
  getClassScope: typeof getClassScope;
  classify: (input: GuardrailInput) => Promise<GuardrailLabel>;
  retrieve: (classIds: string[], question: string) => Promise<Source[]>;
  answer: (input: AnswerInput) => Promise<ModelAnswer>;
  /** Atomically deduplicate, load this user's history, and save answer + citations. */
  saveMessage: (
    input: MessageInput,
    respond: (
      recentMessages: GuardrailInput["recentMessages"],
    ) => Promise<StoredAnswer>,
  ) => Promise<ChatResult>;
  logUsage: (usage: Usage) => void;
  primaryModel: string;
  backupModel: string;
  estimateCost: (
    model: string,
    inputTokens: number,
    outputTokens: number,
  ) => number | null;
};
