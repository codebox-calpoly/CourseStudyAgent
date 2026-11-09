import { describe, expect, it } from "vitest";
import { isCalPolyEmail } from "./email.js";

describe("isCalPolyEmail", () => {
  it.each([
    "a@calpoly.edu",
    "A@CALPOLY.EDU",
    "a@CalPoly.Edu",
    "  a@calpoly.edu  ",
    "\tA@CALPOLY.EDU\n",
    "first.last+course@calpoly.edu",
  ])("accepts Cal Poly address %j", (email) => {
    expect(isCalPolyEmail(email)).toBe(true);
  });

  it.each([
    "a@gmail.com",
    "a@calpoly.edu.evil.com",
    "a@evil.com@calpoly.edu",
    "a@notcalpoly.edu",
    "",
    "   ",
    "@calpoly.edu",
    "calpoly.edu",
    "a@",
    "a@@calpoly.edu",
    "a@students.calpoly.edu",
    "a b@calpoly.edu",
    "a @calpoly.edu",
    "a@ calpoly.edu",
    "a\n@calpoly.edu",
  ])("rejects non-Cal Poly or malformed address %j", (email) => {
    expect(isCalPolyEmail(email)).toBe(false);
  });
});
