import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { decrypt, encrypt } from "./crypto.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
}

/** OAuth tokens, encrypted at rest with AES-256-GCM (SECURITY.md §5). */
export class TokenStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {}

  save(provider: string, tokens: StoredTokens, scopes: string[], account?: string): void {
    const encrypted = encrypt(JSON.stringify(tokens), this.key, `oauth:${provider}`);
    this.db
      .prepare(
        `INSERT INTO oauth_tokens (provider, account, scopes, encrypted_json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET account = COALESCE(excluded.account, oauth_tokens.account),
           scopes = excluded.scopes, encrypted_json = excluded.encrypted_json, updated_at = excluded.updated_at`,
      )
      .run(provider, account ?? null, scopes.join(" "), encrypted, nowIso());
  }

  load(provider: string): { tokens: StoredTokens; scopes: string[]; account: string | null } | undefined {
    const row = this.db.prepare("SELECT account, scopes, encrypted_json FROM oauth_tokens WHERE provider = ?").get(provider) as
      | { account: string | null; scopes: string; encrypted_json: string }
      | undefined;
    if (!row) return undefined;
    const tokens = JSON.parse(decrypt(row.encrypted_json, this.key, `oauth:${provider}`)) as StoredTokens;
    return { tokens, scopes: row.scopes.split(" ").filter(Boolean), account: row.account };
  }

  delete(provider: string): void {
    this.db.prepare("DELETE FROM oauth_tokens WHERE provider = ?").run(provider);
  }
}
