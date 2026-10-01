import type { IncomingMessage, ServerResponse } from "node:http";
import sparticuz from "@sparticuz/chromium";
import { chromium } from "playwright-core";
import { PlaywrightEngine } from "../src/browser/engine.js";
import { checkBrowserSecret } from "../src/browser/remote.js";
import type { BrowserRunRequest } from "../src/browser/types.js";

/**
 * Vercel Function for the browser agent (Phase E): headless Chromium from
 * @sparticuz/chromium + playwright-core, separate from the main function so
 * the agent's cold start stays small. Only the main JARVIS function may call
 * it (HMAC secret derived from JARVIS_ENCRYPTION_KEY).
 */
const engine = new PlaywrightEngine({
  launch: async () => chromium.launch({ args: sparticuz.args, executablePath: await sparticuz.executablePath(), headless: true }),
  maxDownloadBytes: 3 * 1024 * 1024,
  timeoutMs: 50_000,
});

async function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("Anfrage zu groß");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };
  const key = process.env.JARVIS_ENCRYPTION_KEY;
  if (req.method !== "POST") return send(405, { error: "POST only" });
  if (!key || !checkBrowserSecret(req.headers.authorization, Buffer.from(key, "base64"))) return send(401, { error: "Unauthorized" });
  let body: BrowserRunRequest;
  try {
    body = JSON.parse(await readBody(req)) as BrowserRunRequest;
  } catch {
    return send(400, { error: "Ungültige Anfrage" });
  }
  if (typeof body?.taskId !== "string" || !Array.isArray(body.steps) || body.steps.length > 100 || !body.action) return send(400, { error: "Ungültige Anfrage" });
  send(200, await engine.run(body));
}
