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

  it("prefers sentence boundaries", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const chunks = chunkText(text, 40, 5);

    expect(chunks[0]).toBe("First sentence. Second sentence.");
  });

  it("still respects the maximum size", () => {
    const text = "This sentence has no convenient early stopping point.";
    const chunks = chunkText(text, 10, 2);

    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it.each([
    ["Unix", "\n\n"],
    ["Windows", "\r\n\r\n"],
    ["spaces in blank line", "\n   \n"],
  ])("recognizes %s paragraph boundaries", (_name, separator) => {
    const first = "This is a sufficiently long first paragraph.";
    const text =
      `${first}${separator}` + "Second paragraph continues for quite a while.";

    const chunks = chunkText(text, 55, 5);

    expect(chunks[0]).toBe(first + separator);
  });

  it("avoids splitting words when possible", () => {
    const chunks = chunkText("alpha beta gamma delta", 12, 2);

    expect(chunks[0]).toBe("alpha beta ");
  });

  it("uses a single newline as a low-priority boundary", () => {
    const chunks = chunkText("alpha\nbetagamma", 8, 1);

    expect(chunks[0]).toBe("alpha\n");
  });

  it("uses a tab as a low-priority boundary", () => {
    const chunks = chunkText("alpha\tbetagamma", 8, 1);

    expect(chunks[0]).toBe("alpha\t");
  });

  it("splits at the hard limit when no boundary exists", () => {
    expect(chunkText("abcdefghijklmnop", 5, 1)).toEqual([
      "abcde",
      "efghi",
      "ijklm",
      "mnop",
    ]);
  });

  it("reconstructs text after splitting at natural boundaries", () => {
    const text =
      "This is the first paragraph.\n\n" +
      "This is the second paragraph. It has another sentence.";

    const overlap = 5;
    const chunks = chunkText(text, 40, overlap);

    const reconstructed =
      (chunks[0] ?? "") +
      chunks
        .slice(1)
        .map((chunk) => chunk.slice(overlap))
        .join("");

    expect(reconstructed).toBe(text);
  });
});
