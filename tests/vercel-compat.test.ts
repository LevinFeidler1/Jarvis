import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Vercel compatibility", () => {
  it("every runtime dependency loads without require(esm) (ERR_REQUIRE_ESM on Vercel)", () => {
    const out = execFileSync(process.execPath, ["--no-experimental-require-module", "scripts/check-esm.mjs"], { encoding: "utf8", stdio: "pipe" });
    expect(out).toContain("OK");
  }, 60_000);
});
