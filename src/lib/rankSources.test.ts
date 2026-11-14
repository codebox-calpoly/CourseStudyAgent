import { expect, test, vi } from "vitest";
import { rankSources, type SourceCandidate } from "./rankSources";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function source(
  id: string,
  overrides: Partial<SourceCandidate> = {},
): SourceCandidate {
  return { id, similarity: 1, kind: "notes", date: NOW, ...overrides };
}

test("returns no sources for an empty candidate list", () => {
  expect(rankSources([], 5, NOW)).toEqual([]);
});

test("ranks equally recent and trusted sources by similarity", () => {
  const low = source("low", { similarity: 0.2 });
  const high = source("high", { similarity: 0.9 });
  const medium = source("medium", { similarity: 0.6 });

  expect(rankSources([low, high, medium], 3, NOW)).toEqual([high, medium, low]);
});

test("prefers newer sources when similarity and trust are equal", () => {
  const older = source("older", {
    date: new Date(NOW.getTime() - MILLISECONDS_PER_DAY),
  });
  const newer = source("newer");

  expect(rankSources([older, newer], 2, NOW)).toEqual([newer, older]);
});

test.each([
  [120, 0.5],
  [240, 0.25],
  [12000, 0.25],
])("applies recency weight %s days in the past", (ageDays, expectedWeight) => {
  const older = source("older", {
    date: new Date(NOW.getTime() - ageDays * MILLISECONDS_PER_DAY),
  });
  const below = source("below", { similarity: expectedWeight - 0.01 });
  const above = source("above", { similarity: expectedWeight + 0.01 });

  expect(rankSources([below, older, above], 3, NOW)).toEqual([
    above,
    older,
    below,
  ]);
});

test("does not boost a future source above its original similarity", () => {
  const future = source("future", {
    similarity: 0.9,
    date: new Date(NOW.getTime() + 120 * MILLISECONDS_PER_DAY),
  });
  const today = source("today");

  expect(rankSources([future, today], 2, NOW)).toEqual([today, future]);
});

test("ranks a disputed signal below an equally similar confirmed signal", () => {
  const disputed = source("disputed", {
    kind: "signal",
    confirms: 1,
    disputes: 9,
  });
  const confirmed = source("confirmed", {
    kind: "signal",
    confirms: 9,
    disputes: 1,
  });

  expect(rankSources([disputed, confirmed], 2, NOW)).toEqual([
    confirmed,
    disputed,
  ]);
});

test("gives a verified signal full trust regardless of disputes", () => {
  const verified = source("verified", {
    kind: "signal",
    disputes: 100,
    verified: true,
  });
  const notes = source("notes", { similarity: 0.9 });

  expect(rankSources([notes, verified], 2, NOW)).toEqual([verified, notes]);
});

test("defaults missing signal vote counts to zero independently", () => {
  const neutral = source("neutral", { kind: "signal" });
  const confirmed = source("confirmed", { kind: "signal", confirms: 9 });
  const disputed = source("disputed", { kind: "signal", disputes: 9 });

  expect(rankSources([disputed, neutral, confirmed], 3, NOW)).toEqual([
    confirmed,
    neutral,
    disputed,
  ]);
});

test.each(["lecture_notes", "notes", "rubric", "past_exam"] as const)(
  "gives %s full trust without applying signal votes",
  (kind) => {
    const material = source("material", {
      kind,
      similarity: 0.6,
      disputes: 100,
      verified: false,
    });
    const signal = source("signal", { kind: "signal" });

    expect(rankSources([signal, material], 2, NOW)).toEqual([material, signal]);
  },
);

test("breaks equal-score ties using the newer date", () => {
  const older = source("older", {
    date: new Date(NOW.getTime() - 120 * MILLISECONDS_PER_DAY),
  });
  const newer = source("newer", { similarity: 0.5 });

  expect(rankSources([older, newer], 2, NOW)).toEqual([newer, older]);
});

test.each([
  [0, []],
  [1, ["high"]],
  [2, ["high", "low"]],
  [10, ["high", "low"]],
] as const)("respects a limit of %i", (limit, expectedIds) => {
  const high = source("high");
  const low = source("low", { similarity: 0.1 });

  expect(rankSources([low, high], limit, NOW).map(({ id }) => id)).toEqual(
    expectedIds,
  );
});

test("returns no sources for a negative limit", () => {
  expect(rankSources([source("notes")], -1, NOW)).toEqual([]);
});

test("does not modify frozen inputs or add scores to the original candidates", () => {
  const low = Object.freeze(source("low", { similarity: 0.1 }));
  const high = Object.freeze(source("high"));
  const candidates = Object.freeze([low, high]);
  const originalTime = NOW.getTime();

  const result = rankSources(candidates, 2, NOW);

  expect(result).toEqual([high, low]);
  expect(result).not.toBe(candidates);
  expect(result[0]).toBe(high);
  expect(candidates).toEqual([low, high]);
  expect(high).not.toHaveProperty("score");
  expect(NOW.getTime()).toBe(originalTime);
});

test("preserves additional source content and its type", () => {
  const candidate = { ...source("notes"), content: "Lecture material" };

  expect(rankSources([candidate], 1, NOW)[0].content).toBe("Lecture material");
});

test("uses the current time when now is omitted", () => {
  vi.useFakeTimers();

  try {
    vi.setSystemTime(NOW);
    const today = source("today", { similarity: 0.75 });
    const older = source("older", {
      date: new Date(NOW.getTime() - 120 * MILLISECONDS_PER_DAY),
    });

    expect(rankSources([older, today], 2)).toEqual([today, older]);
  } finally {
    vi.useRealTimers();
  }
});
