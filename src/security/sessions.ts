import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { randomToken, sha256 } from "./crypto.js";

const SESSION_TTL_MS = 12 * 60 * 60_000;

export interface Session {
  csrfToken: string;
  expiresAt: string;
}

/** Server-side sessions; only a SHA-256 hash of the session id is stored. */
export class SessionStore {
  constructor(private readonly db: Db) {}

  create(): { sessionId: string; csrfToken: string } {
    const sessionId = randomToken(32);
    const csrfToken = randomToken(32);
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.db
      .prepare("INSERT INTO sessions (id_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(sessionId), csrfToken, nowIso(), expires);
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
    return { sessionId, csrfToken };
  }

  get(sessionId: string | undefined): Session | undefined {
    if (!sessionId) return undefined;
    const row = this.db.prepare("SELECT csrf_token, expires_at FROM sessions WHERE id_hash = ?").get(sha256(sessionId)) as
      | { csrf_token: string; expires_at: string }
      | undefined;
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return undefined;
    return { csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }

  destroy(sessionId: string | undefined): void {
    if (sessionId) this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256(sessionId));
  }
}
