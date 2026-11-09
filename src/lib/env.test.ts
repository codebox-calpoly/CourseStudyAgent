import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://localhost/course_study_test",
  AI_GATEWAY_API_KEY: "test-api-key",
  AUTH_SECRET: "test-auth-secret",
};

const keys = ["DATABASE_URL", "AI_GATEWAY_API_KEY", "AUTH_SECRET"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getEnv", () => {
  it("returns all required values and excludes unrelated variables", () => {
    expect(getEnv({ ...validEnv, UNRELATED: "ignored" })).toEqual(validEnv);
  });

  it.each(keys)("names the missing variable %s", (key) => {
    const source: Record<string, string | undefined> = { ...validEnv };
    delete source[key];
    expect(() => getEnv(source)).toThrow(
      `Missing environment variables: ${key}`,
    );
  });

  it("names every missing variable together", () => {
    expect(() => getEnv({ AUTH_SECRET: validEnv.AUTH_SECRET })).toThrow(
      "Missing environment variables: DATABASE_URL, AI_GATEWAY_API_KEY",
    );
  });

  it("names all three variables when none are present", () => {
    expect(() => getEnv({})).toThrow(
      "Missing environment variables: DATABASE_URL, AI_GATEWAY_API_KEY, AUTH_SECRET",
    );
  });

  it.each(keys)("treats an empty %s as missing", (key) => {
    expect(() => getEnv({ ...validEnv, [key]: "" })).toThrow(
      `Missing environment variables: ${key}`,
    );
  });

  it("reads process.env when no source is supplied", () => {
    for (const key of keys) vi.stubEnv(key, validEnv[key]);
    expect(getEnv()).toEqual(validEnv);
  });

  it("can be imported without environment variables and validates only on call", async () => {
    for (const key of keys) vi.stubEnv(key, undefined);
    vi.resetModules();
    const { getEnv: importedGetEnv } = await import("./env.js");
    expect(() => importedGetEnv()).toThrow(
      "Missing environment variables: DATABASE_URL, AI_GATEWAY_API_KEY, AUTH_SECRET",
    );
  });
});
