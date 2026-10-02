import { ToolError } from "../../core/types.js";
import type { GoogleAuth } from "./oauth.js";

export interface GoogleRequest {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  /** Only idempotent requests are retried on 429/5xx. Sending mail is never retried. */
  idempotent?: boolean;
  /** Raw body (e.g. multipart upload) instead of JSON. */
  rawBody?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  /** Return the response body as bytes instead of parsed JSON. */
  responseType?: "json" | "buffer";
}

const MAX_RETRIES = 3;

export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thin Google REST client: auth, retries with backoff, typed errors. */
export class GoogleHttp {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  async request<T>(url: string, req: GoogleRequest = {}): Promise<T> {
    const method = req.method ?? "GET";
    const idempotent = req.idempotent ?? (method === "GET" || method === "PUT" || method === "DELETE");
    const u = new URL(url);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
      else u.searchParams.set(k, String(v));
    }

    let authRetried = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken(authRetried);
      let res: Response;
      try {
        res = await this.fetchImpl(u, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
            ...(req.rawBody !== undefined && req.contentType ? { "content-type": req.contentType } : {}),
            ...req.headers,
          },
          body: req.rawBody !== undefined ? new Uint8Array(req.rawBody) : req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        if (idempotent && attempt < MAX_RETRIES) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new ToolError(`Google-Dienst nicht erreichbar: ${(err as Error).message}`, "UPSTREAM_ERROR");
      }

      if (res.ok) {
        if (req.responseType === "buffer") return Buffer.from(await res.arrayBuffer()) as T;
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      if (res.status === 401 && !authRetried) {
        authRetried = true;
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && idempotent && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : backoff(attempt));
        continue;
      }
      throw await toToolError(res);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), 8_000);
}

async function toToolError(res: Response): Promise<ToolError> {
  let message = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    message = typeof body.error === "string" ? body.error : (body.error?.message ?? "");
  } catch {
    /* ignore */
  }
  const suffix = message ? `: ${message.slice(0, 200)}` : "";
  switch (res.status) {
    case 401:
      return new ToolError(`Google-Authentifizierung fehlgeschlagen${suffix}`, "AUTH_FAILED");
    case 403:
      return new ToolError(`Keine Berechtigung bei Google${suffix}`, "AUTH_FAILED");
    case 404:
      return new ToolError(`Nicht gefunden${suffix}`, "NOT_FOUND");
    case 400:
      return new ToolError(`Ungültige Anfrage an Google${suffix}`, "INVALID_INPUT");
    case 429:
      return new ToolError("Google-Rate-Limit erreicht. Bitte später erneut versuchen.", "RATE_LIMITED");
    default:
      return new ToolError(`Google-Fehler HTTP ${res.status}${suffix}`, "UPSTREAM_ERROR");
  }
}
