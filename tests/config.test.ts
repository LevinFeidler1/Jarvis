import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { JARVIS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

describe("config: access token", () => {
  it("ignores a trailing newline or spaces pasted into the environment variable", () => {
    const token = "a".repeat(40);
    expect(loadConfig({ ...base, JARVIS_ACCESS_TOKEN: `${token}\n` }).accessToken).toBe(token);
    expect(loadConfig({ ...base, JARVIS_ACCESS_TOKEN: `  ${token}  ` }).accessToken).toBe(token);
  });

  it("still rejects tokens that are too short once trimmed", () => {
    expect(() => loadConfig({ ...base, JARVIS_ACCESS_TOKEN: `${"a".repeat(20)}${" ".repeat(20)}` })).toThrow(/mindestens 32 Zeichen/);
  });
});
