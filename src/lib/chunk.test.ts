import { describe, expect, it } from "vitest";

import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns an empty array for empty text", () => {
    expect(chunkText("", 10, 2)).toEqual([]);
  });

  it("returns one chunk since text < size", () => {
    expect(chunkText("dog", 5, 2)).toEqual(["dog"]);
  });

  it("returns one chunk since text = size", () => {
    expect(chunkText("dog", 3, 2)).toEqual(["dog"]);
  });

  it("overlaps neighboring chunks correctly", () => {
    expect(chunkText("abcdefghij", 4, 2)).toEqual([
      "abcd",
      "cdef",
      "efgh",
      "ghij",
    ]);
  });

  it("does not produce chunks longer than size", () => {
    const size = 4;
    const chunks = chunkText("abcdefghij", size, 2);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(size);
    }
  });

  it("can reconstruct the original text after removing overlaps", () => {
    const text = "abcdefghij";
    const overlap = 2;
    const chunks = chunkText(text, 4, overlap);

    const reconstructed =
      chunks[0] +
      chunks
        .slice(1)
        .map((chunk) => chunk.slice(overlap))
        .join("");

    expect(reconstructed).toBe(text);
  });

  it("supports zero overlap", () => {
    expect(chunkText("abcdefghij", 4, 0)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("returns a shorter final chunk", () => {
    expect(chunkText("abcdefghi", 4, 2)).toEqual([
      "abcd",
      "cdef",
      "efgh",
      "ghi",
    ]);
  });

  it("supports the largest valid overlap", () => {
    expect(chunkText("abcde", 3, 2)).toEqual(["abc", "bcd", "cde"]);
  });

  it("supports a size of one with no overlap", () => {
    expect(chunkText("abc", 1, 0)).toEqual(["a", "b", "c"]);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("throws when size is %s", (size) => {
    expect(() => chunkText("hello", size, 0)).toThrow(
      "Size must be a positive integer",
    );
  });

  it.each([-1, 1.5, NaN, Infinity])("throws when overlap is %s", (overlap) => {
    expect(() => chunkText("hello", 5, overlap)).toThrow(
      "Overlap must be a non-negative integer",
    );
  });

  it.each([5, 6])(
    "throws when overlap is greater than or equal to size",
    (overlap) => {
      expect(() => chunkText("hello", 5, overlap)).toThrow(
        "Overlap must be smaller than size",
      );
    },
  );
});
