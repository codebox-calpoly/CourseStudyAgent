import { signalScore } from "./signalScore";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_DAYS = 120;
const MIN_RECENCY = 0.25;

export type SourceCandidate = {
  id: string;
  similarity: number;
  kind: "lecture_notes" | "notes" | "rubric" | "past_exam" | "signal";
  date: Date;
  confirms?: number;
  disputes?: number;
  verified?: boolean;
};

export function rankSources<T extends SourceCandidate>(
  candidates: readonly T[],
  limit: number,
  now: Date = new Date(),
): T[] {
  if (limit <= 0) return [];

  const currentTime = now.getTime();

  return candidates
    .map((candidate) => {
      const date = candidate.date.getTime();
      const ageDays = Math.max(0, (currentTime - date) / MILLISECONDS_PER_DAY);
      const recency = Math.max(
        MIN_RECENCY,
        0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS),
      );
      const trust =
        candidate.kind === "signal" && candidate.verified !== true
          ? signalScore(candidate.confirms ?? 0, candidate.disputes ?? 0)
          : 1;

      return { candidate, date, score: candidate.similarity * recency * trust };
    })
    .sort((a, b) => b.score - a.score || b.date - a.date)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
