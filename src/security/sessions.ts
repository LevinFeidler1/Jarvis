import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { randomToken, sha256 } from "./crypto.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

export interface Session {
  csrfToken: string;
  expiresAt: string;
}

/** Server-side sessions; only a SHA-256 hash of the session id is stored. */
export class SessionStore {
  constructor(private readonly db: Db) {}

  static readonly ttlSeconds = SESSION_TTL_MS / 1000;

  async create(): Promise<{ sessionId: string; csrfToken: string }> {
    const sessionId = randomToken(32);
    const csrfToken = randomToken(32);
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await this.db.run("INSERT INTO sessions (id_hash, csrf_token, created_at, expires_at) VALUES ($1, $2, $3, $4)", [
      sha256(sessionId),
      csrfToken,
      nowIso(),
      expires,
    ]);
    await this.db.run("DELETE FROM sessions WHERE expires_at < $1", [nowIso()]);
    return { sessionId, csrfToken };
  }

  async get(sessionId: string | undefined): Promise<Session | undefined> {
    if (!sessionId) return undefined;
    const row = await this.db.one<{ csrf_token: string; expires_at: string }>(
      "SELECT csrf_token, expires_at FROM sessions WHERE id_hash = $1",
      [sha256(sessionId)],
    );
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return undefined;
    return { csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }

  async destroy(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.db.run("DELETE FROM sessions WHERE id_hash = $1", [sha256(sessionId)]);
  }
}
