import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("chat rate limit", () => {
  it("allows twenty per user per minute and resets at the boundary", () => {
    let time = 0;
    const check = createRateLimiter(() => time);
    for (let i = 0; i < 20; i++) expect(check("one")).toBe(true);
    expect(check("one")).toBe(false);
    expect(check("two")).toBe(true);
    time = 59_999;
    expect(check("one")).toBe(false);
    time = 60_000;
    expect(check("one")).toBe(true);
  });
});
