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

  async save(provider: string, tokens: StoredTokens, scopes: string[], account?: string): Promise<void> {
    const encrypted = encrypt(JSON.stringify(tokens), this.key, `oauth:${provider}`);
    await this.db.run(
      `INSERT INTO oauth_tokens (provider, account, scopes, encrypted_json, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider) DO UPDATE SET account = COALESCE(excluded.account, oauth_tokens.account),
         scopes = excluded.scopes, encrypted_json = excluded.encrypted_json, updated_at = excluded.updated_at`,
      [provider, account ?? null, scopes.join(" "), encrypted, nowIso()],
    );
  }

  async load(provider: string): Promise<{ tokens: StoredTokens; scopes: string[]; account: string | null } | undefined> {
    const row = await this.db.one<{ account: string | null; scopes: string; encrypted_json: string }>(
      "SELECT account, scopes, encrypted_json FROM oauth_tokens WHERE provider = $1",
      [provider],
    );
    if (!row) return undefined;
    const tokens = JSON.parse(decrypt(row.encrypted_json, this.key, `oauth:${provider}`)) as StoredTokens;
    return { tokens, scopes: row.scopes.split(" ").filter(Boolean), account: row.account };
  }

  async delete(provider: string): Promise<void> {
    await this.db.run("DELETE FROM oauth_tokens WHERE provider = $1", [provider]);
  }
}
