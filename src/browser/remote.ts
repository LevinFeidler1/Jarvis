import { createHmac, timingSafeEqual } from "node:crypto";
import type { BrowserEngine, BrowserRunRequest, BrowserRunResult } from "./types.js";

/** Shared secret for /api/browser, derived from JARVIS_ENCRYPTION_KEY (no extra env variable). */
export function browserSecret(encryptionKey: Buffer): string {
  return createHmac("sha256", encryptionKey).update("jarvis-browser-v1").digest("base64url");
}

export function checkBrowserSecret(header: string | undefined, encryptionKey: Buffer): boolean {
  const expected = Buffer.from(`Bearer ${browserSecret(encryptionKey)}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Calls the browser function (api/browser.ts on Vercel, or `npm run
 * browser-worker` on your own computer) over HTTPS.
 */
export class RemoteBrowserEngine implements BrowserEngine {
  readonly kind = "remote" as const;
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(req: BrowserRunRequest): Promise<BrowserRunResult> {
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.secret}` },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(58_000),
      });
      if (!res.ok) return { ok: false, error: `Browser-Dienst antwortet mit HTTP ${res.status}.` };
      return (await res.json()) as BrowserRunResult;
    } catch (err) {
      return { ok: false, error: `Browser-Dienst nicht erreichbar: ${(err as Error).message}` };
    }
  }
}
