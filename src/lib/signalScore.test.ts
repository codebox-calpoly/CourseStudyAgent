import { expect, test } from "vitest";
import { signalScore } from "./signalScore";

test("returns 0.5 when there are no votes", () => {
  expect(signalScore(0, 0)).toBe(0.5);
});

test("calculates the score using the specified formula", () => {
  expect(signalScore(3, 1)).toBeCloseTo(2 / 3);
});

test("returns above 0.5 when confirms outnumber disputes", () => {
  expect(signalScore(5, 2)).toBeGreaterThan(0.5);
});

test("returns below 0.5 when disputes outnumber confirms", () => {
  expect(signalScore(2, 5)).toBeLessThan(0.5);
});

test("returns 0.5 when the vote counts are equal", () => {
  expect(signalScore(10, 10)).toBe(0.5);
});

test("keeps scores between 0 and 1, including extreme vote counts", () => {
  const counts = [0, 1, 10, 1000, Number.MAX_SAFE_INTEGER];

  for (const confirms of counts) {
    for (const disputes of counts) {
      const score = signalScore(confirms, disputes);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  }
});

test("returns a neutral score for large equal vote counts", () => {
  expect(signalScore(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(
    0.5,
  );
});

test.each([-1, -100, -0.5])(
  "rejects negative count %s in either input",
  (value) => {
    expect(() => signalScore(value, 0)).toThrow(RangeError);
    expect(() => signalScore(0, value)).toThrow(RangeError);
  },
);
