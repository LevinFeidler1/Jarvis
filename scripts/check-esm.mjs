// Emulates Vercel's Node runtime, which cannot require() ESM-only packages
// (ERR_REQUIRE_ESM — happened with @fastify/static). Run with:
//   node --no-experimental-require-module scripts/check-esm.mjs
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// Loaded lazily only for local development (never on Vercel).
const LOCAL_ONLY = new Set(["@fastify/static", "@electric-sql/pglite"]);
let failed = 0;
for (const name of Object.keys(pkg.dependencies)) {
  if (LOCAL_ONLY.has(name)) continue;
  try {
    await import(name);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${err.code ?? ""} ${String(err.message).split("\n")[0]}`);
  }
}
console.log(failed ? `${failed} Paket(e) laden nicht ohne require(esm).` : "OK: alle Laufzeit-Abhängigkeiten laden ohne require(esm).");
process.exit(failed ? 1 : 0);
