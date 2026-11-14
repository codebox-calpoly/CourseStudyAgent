import { signalScore } from "./signalScore";

const NEUTRAL_SIGNAL_SCORE = 0.5;
const MAX_SIGNAL_ADJUSTMENT = 0.4;

type Signal = {
  topic: string;
  stance: "on_exam" | "not_on_exam" | "info";
  confirms: number;
  disputes: number;
};

type Prediction = {
  topic: string;
  likelihood: number;
  reportCount: number;
  signalCount: number;
};

type TopicTotals = Omit<Prediction, "likelihood"> & { adjustment: number };

export function predictTopics(
  signals: readonly Signal[],
  reports: readonly { topics: readonly string[] }[],
): Prediction[] {
  const topics = new Map<string, TopicTotals>();

  function getTopic(topic: string): TopicTotals {
    const key = topic.trim().toLowerCase();
    let entry = topics.get(key);
    if (!entry) {
      entry = { topic, reportCount: 0, signalCount: 0, adjustment: 0 };
      topics.set(key, entry);
    }
    return entry;
  }

  // Signals establish the first spelling; informational tips are ignored.
  for (const signal of signals) {
    if (signal.stance === "info") continue;
    const entry = getTopic(signal.topic);
    const weight =
      signalScore(signal.confirms, signal.disputes) - NEUTRAL_SIGNAL_SCORE;
    entry.adjustment += signal.stance === "on_exam" ? weight : -weight;
    entry.signalCount++;
  }

  for (const report of reports) {
    const seen = new Set<TopicTotals>();
    for (const topic of report.topics) {
      const entry = getTopic(topic);
      if (seen.has(entry)) continue;
      seen.add(entry);
      entry.reportCount++;
    }
  }

  const reportDenominator = reports.length + 2;

  return Array.from(topics.values(), ({ adjustment, ...prediction }) => {
    const reportRate = (prediction.reportCount + 1) / reportDenominator;
    // Cap after summing so opposing tips cancel before limiting influence.
    const cappedAdjustment = Math.max(
      -MAX_SIGNAL_ADJUSTMENT,
      Math.min(MAX_SIGNAL_ADJUSTMENT, adjustment),
    );
    return {
      ...prediction,
      likelihood: Math.max(0, Math.min(1, reportRate + cappedAdjustment)),
    };
  }).sort((a, b) => b.likelihood - a.likelihood);
}
