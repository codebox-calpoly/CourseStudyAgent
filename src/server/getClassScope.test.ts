import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
const { select, from, where } = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: () => ({ select }) }));

import { getClassScope } from "./getClassScope";
import { prerequisites } from "./db/schema";

describe("getClassScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnValue({ from });
    from.mockReturnValue({ where });
  });

  it.each([
    [[], ["algorithms"]],
    [["discrete"], ["algorithms", "discrete"]],
    [
      ["discrete", "programming"],
      ["algorithms", "discrete", "programming"],
    ],
    [
      ["discrete", "algorithms", "discrete"],
      ["algorithms", "discrete"],
    ],
  ])("returns the class first for prerequisites %j", async (ids, expected) => {
    where.mockResolvedValue(ids.map((id) => ({ id })));
    expect(await getClassScope("algorithms")).toEqual(expected);
    expect(select).toHaveBeenCalledWith({
      id: prerequisites.prerequisiteClassId,
    });
    expect(from).toHaveBeenCalledWith(prerequisites);
    expect(where).toHaveBeenCalledWith(eq(prerequisites.classId, "algorithms"));
  });

  it("propagates database failure instead of silently narrowing the scope", async () => {
    where.mockRejectedValue(new Error("database unavailable"));
    await expect(getClassScope("algorithms")).rejects.toThrow(
      "database unavailable",
    );
  });
});
