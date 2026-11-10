import { expect, test, vi } from "vitest";
import { generateJoinCode, isExpired, normalizeJoinCode } from "./joinCode";

test("generates a six-character join code", () => {
  expect(generateJoinCode()).toHaveLength(6);
});

test("generates only uppercase letters and digits excluding 0, O, 1, and I", () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  }
});

test("generates codes without using Math.random", () => {
  const random = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Join codes must use secure randomness.");
  });

  try {
    expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  } finally {
    random.mockRestore();
  }
});

test.each([
  [" ab12cd ", "AB12CD"],
  ["\tAb12cD\n", "AB12CD"],
  ["AB12CD", "AB12CD"],
  ["234567", "234567"],
])("normalizes %j to %s", (input, expected) => {
  expect(normalizeJoinCode(input)).toBe(expected);
});

test.each([
  "",
  "   ",
  "ABC12",
  "ABC1234",
  "AB C12",
  "AB!123",
  "ABC\n12",
  "ＡＢＣ１２３",
])("rejects malformed join code %j", (input) => {
  expect(() => normalizeJoinCode(input)).toThrow(RangeError);
});

test.each([null, undefined, 123456])("rejects non-string input %j", (input) => {
  // Bypass TypeScript deliberately to check invalid inputs at runtime.
  expect(() => normalizeJoinCode(input as unknown as string)).toThrow(
    TypeError,
  );
});

test.each([
  [-1, false],
  [0, true],
  [1, true],
])("checks expiry at offset %i milliseconds", (offset, expected) => {
  const expiresAt = new Date("2026-11-10T12:00:00.000Z");
  const now = new Date(expiresAt.getTime() + offset);

  expect(isExpired(expiresAt, now)).toBe(expected);
});

test("uses the current time when now is omitted", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  vi.useFakeTimers();

  try {
    vi.setSystemTime(now);
    expect(isExpired(new Date(now.getTime() - 1))).toBe(true);
    expect(isExpired(now)).toBe(true);
    expect(isExpired(new Date(now.getTime() + 1))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("rejects invalid dates in either expiry input", () => {
  const validDate = new Date("2026-11-10T12:00:00.000Z");
  const invalidDate = new Date(NaN);

  expect(() => isExpired(invalidDate, validDate)).toThrow(RangeError);
  expect(() => isExpired(validDate, invalidDate)).toThrow(RangeError);
});
