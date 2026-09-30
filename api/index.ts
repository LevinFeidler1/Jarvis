import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildJarvis } from "../src/app.js";

/**
 * Vercel Serverless Function: all /api/* requests are rewritten here
 * (vercel.json). The Fastify app is built once per instance and reused
 * across invocations (Fluid Compute). Static files come from the CDN.
 */
let ready: Promise<FastifyInstance> | undefined;

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
 * vercel.json rewrites /api/<path> → /api/index?path=<path>. Restore the
 * original URL so Fastify routes normally, whichever form arrives.
 */
export function restoreUrl(url: string | undefined): string {
  const u = new URL(url ?? "/", "http://localhost");
  const path = u.searchParams.get("path");
  if (u.pathname === "/api/index" || u.pathname === "/api") {
    u.searchParams.delete("path");
    return `/api/${path ?? ""}${u.search}`;
  }
  if (path !== null && u.pathname === `/api/${path}`) u.searchParams.delete("path");
  return `${u.pathname}${u.search}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  req.url = restoreUrl(req.url);
  try {
    const app = await getApp();
    app.server.emit("request", req, res);
  } catch (err) {
    console.error("[jarvis] startup failed:", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    // Config errors only name missing variables — never their values.
    res.end(JSON.stringify({ error: "JARVIS konnte nicht starten", detail: err instanceof Error ? err.message : String(err) }));
  }
}
