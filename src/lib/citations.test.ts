import { describe, expect, it } from "vitest";
import { parseCitations } from "./citations";

describe("parseCitations", () => {
  it("deduplicates valid and invalid citations in first-appearance order", () => {
    expect(parseCitations("[2] [1] [2] [0] [4] [0] [3] [4]", 3)).toEqual({
      citations: [2, 1, 3],
      invalidCitations: [0, 4],
    });
  });
  it("returns empty arrays for no numeric citations", () => {
    expect(parseCitations("No citations. [word] [1.5] [-1]", 3)).toEqual({
      citations: [],
      invalidCitations: [],
    });
  });
  it("rejects every citation when there are no sources", () => {
    expect(parseCitations("[1] [0]", 0)).toEqual({
      citations: [],
      invalidCitations: [1, 0],
    });
  });
  it("normalizes leading zeroes and does not map unsafe integers to sources", () => {
    expect(parseCitations("[01] [1] [9007199254740992]", 1)).toEqual({
      citations: [1],
      invalidCitations: [9007199254740992],
    });
  });
  it.each([-1, 1.5, NaN])("rejects invalid source counts %s", (count) => {
    expect(() => parseCitations("[1]", count)).toThrow("sourceCount");
  });
});

it("explicitly ignores unsupported grouped and range forms", () => {
  expect(parseCitations("[1, 2] [1-3] [2]", 3)).toEqual({
    citations: [2],
    invalidCitations: [],
  });
});
