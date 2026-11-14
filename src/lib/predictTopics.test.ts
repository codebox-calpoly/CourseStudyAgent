import { expect, test } from "vitest";
import { predictTopics } from "./predictTopics";

test("returns no predictions without evidence", () => {
  expect(predictTopics([], [])).toEqual([]);
});

test("ranks topics by smoothed report frequency, including empty reports", () => {
  const predictions = predictTopics(
    [],
    [{ topics: ["Makefiles", "Pointers"] }, { topics: ["Makefiles"] }],
  );
  expect(predictions).toEqual([
    { topic: "Makefiles", likelihood: 0.75, reportCount: 2, signalCount: 0 },
    { topic: "Pointers", likelihood: 0.5, reportCount: 1, signalCount: 0 },
  ]);
  expect(
    predictTopics([], [{ topics: ["Makefiles"] }, { topics: [] }])[0],
  ).toMatchObject({ likelihood: 0.5, reportCount: 1 });
});

test("combines normalized topics and counts each report only once", () => {
  expect(
    predictTopics(
      [{ topic: "Makefiles", stance: "on_exam", confirms: 0, disputes: 0 }],
      [{ topics: [" makefiles ", "MAKEFILES"] }],
    ),
  ).toEqual([
    { topic: "Makefiles", likelihood: 2 / 3, reportCount: 1, signalCount: 1 },
  ]);
});

test("preserves the first report spelling while combining repeated topics", () => {
  expect(
    predictTopics(
      [],
      [{ topics: [" makefiles ", "MAKEFILES"] }, { topics: ["MakeFiles"] }],
    ),
  ).toEqual([
    { topic: " makefiles ", likelihood: 0.75, reportCount: 2, signalCount: 0 },
  ]);
});

test("treats object property names as ordinary topic names", () => {
  expect(
    predictTopics([], [{ topics: ["__proto__", "constructor", "__PROTO__"] }]),
  ).toEqual([
    { topic: "__proto__", likelihood: 2 / 3, reportCount: 1, signalCount: 0 },
    { topic: "constructor", likelihood: 2 / 3, reportCount: 1, signalCount: 0 },
  ]);
});

test("lowers a frequently reported topic when a not_on_exam tip is confirmed", () => {
  const reports = Array.from({ length: 10 }, () => ({ topics: ["Makefiles"] }));
  const [baseline] = predictTopics([], reports);
  const [prediction] = predictTopics(
    [{ topic: "Makefiles", stance: "not_on_exam", confirms: 3, disputes: 1 }],
    reports,
  );

  expect(baseline.likelihood).toBeCloseTo(11 / 12);
  expect(prediction.likelihood).toBeCloseTo(0.75);
  expect(prediction.likelihood).toBeLessThan(baseline.likelihood);
  expect(prediction).toMatchObject({ reportCount: 10, signalCount: 1 });
});

test("accepts frozen inputs without mutating the evidence", () => {
  const signals = Object.freeze([
    Object.freeze({
      topic: "Makefiles",
      stance: "on_exam" as const,
      confirms: 3,
      disputes: 1,
    }),
  ]);
  const reports = Object.freeze([
    Object.freeze({ topics: Object.freeze(["makefiles", "MAKEFILES"]) }),
  ]);

  const [prediction] = predictTopics(signals, reports);

  expect(prediction).toMatchObject({
    topic: "Makefiles",
    reportCount: 1,
    signalCount: 1,
  });
  expect(prediction.likelihood).toBeCloseTo(5 / 6);
});

test.each([
  ["on_exam", 3, 1, 0.5 + 1 / 6],
  ["not_on_exam", 3, 1, 0.5 - 1 / 6],
  ["on_exam", 1, 3, 0.5 - 1 / 6],
  ["not_on_exam", 1, 3, 0.5 + 1 / 6],
] as const)(
  "applies %s tips with %i confirms and %i disputes",
  (stance, confirms, disputes, expected) => {
    const [prediction] = predictTopics(
      [{ topic: "Makefiles", stance, confirms, disputes }],
      [],
    );
    expect(prediction.likelihood).toBeCloseTo(expected);
    expect(prediction.signalCount).toBe(1);
  },
);

test("ignores info tips entirely", () => {
  const signals = [
    { topic: "Pointers", stance: "info" as const, confirms: 100, disputes: 0 },
  ];
  expect(predictTopics(signals, [])).toEqual([]);
  expect(predictTopics(signals, [{ topics: ["POINTERS"] }])[0]).toMatchObject({
    topic: "POINTERS",
    signalCount: 0,
    likelihood: 2 / 3,
  });
});

test.each([
  ["on_exam", 0.9],
  ["not_on_exam", 0.1],
] as const)("caps 100 %s tips", (stance, expected) => {
  const [prediction] = predictTopics(
    Array.from({ length: 100 }, () => ({
      topic: "Makefiles",
      stance,
      confirms: 100,
      disputes: 0,
    })),
    [],
  );
  expect(prediction.likelihood).toBeCloseTo(expected);
  expect(prediction.signalCount).toBe(100);
});

test("cancels opposing tips before capping their combined influence", () => {
  const positive = {
    topic: "Makefiles",
    stance: "on_exam" as const,
    confirms: 8,
    disputes: 0,
  };
  const negative = { ...positive, stance: "not_on_exam" as const };
  for (const signals of [
    [positive, positive, negative, negative],
    [negative, negative, positive, positive],
  ]) {
    expect(predictTopics(signals, [])[0].likelihood).toBeCloseTo(0.5);
  }
});

test("clamps final likelihoods to zero and one", () => {
  const predictions = predictTopics(
    [
      { topic: "Frequent", stance: "on_exam", confirms: 100, disputes: 0 },
      { topic: "Absent", stance: "not_on_exam", confirms: 100, disputes: 0 },
    ],
    Array.from({ length: 10 }, () => ({ topics: ["Frequent"] })),
  );
  expect(predictions.map(({ likelihood }) => likelihood)).toEqual([1, 0]);
});
