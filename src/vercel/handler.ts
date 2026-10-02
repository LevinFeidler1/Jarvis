import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildJarvis } from "../app.js";
import { TimeoutError, withTimeout } from "../db/database.js";

/**
 * Shared Vercel entry for api/index.ts (normal routes, 60 s) and api/agent.ts
 * (agent/LLM routes and cron, 300 s). The Fastify app is built once per
 * instance and reused across invocations (Fluid Compute). Static files come
 * from the CDN.
 */
let ready: Promise<FastifyInstance> | undefined;

/** A cold start (DB connect + schema check) must not block a request for minutes. */
export const STARTUP_TIMEOUT_MS = 25_000;

function getApp(): Promise<FastifyInstance> {
  ready ??= buildJarvis({ serveStatic: false })
    .then(async ({ app }) => {
      await app.ready();
      return app;
    })
    .catch((err) => {
      ready = undefined; // retry on next request
      throw err;
    });
  return ready;
}

/**
 * vercel.json rewrites /api/<path> → /api/index?path=<path> (or /api/agent?path=…).
 * Restore the original URL so Fastify routes normally, whichever form arrives.
 */
export function restoreUrl(url: string | undefined): string {
  const u = new URL(url ?? "/", "http://localhost");
  const path = u.searchParams.get("path");
  if (u.pathname === "/api/index" || u.pathname === "/api/agent" || u.pathname === "/api") {
    u.searchParams.delete("path");
    return `/api/${path ?? ""}${u.search}`;
  }
  if (path !== null && u.pathname === `/api/${path}`) u.searchParams.delete("path");
  return `${u.pathname}${u.search}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function handleVercelRequest(req: IncomingMessage, res: ServerResponse, startupTimeoutMs = STARTUP_TIMEOUT_MS): Promise<void> {
  req.url = restoreUrl(req.url);
  let app: FastifyInstance;
  try {
    // The startup keeps running in the background; the next request reuses it.
    app = await withTimeout(getApp(), startupTimeoutMs, "JARVIS startet noch (Datenbank langsam). Bitte gleich noch einmal versuchen.");
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn("[jarvis] startup slow:", err.message);
      return sendJson(res, 503, { error: err.message, code: "STARTING" }, { "retry-after": "5" });
    }
    console.error("[jarvis] startup failed:", err);
    // Config errors only name missing variables — never their values.
    return sendJson(res, 503, { error: "JARVIS konnte nicht starten", detail: err instanceof Error ? err.message : String(err) }, { "retry-after": "10" });
  }
  app.server.emit("request", req, res);
}
