import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // First PGlite (WASM Postgres) boot per worker takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
