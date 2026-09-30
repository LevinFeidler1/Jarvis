import { createHash } from "node:crypto";
import type { Db } from "../../db/database.js";
import { nowIso } from "../../db/database.js";
import { randomToken } from "../../security/crypto.js";
import type { StoredTokens, TokenStore } from "../../security/token-store.js";
import { ToolError } from "../../core/types.js";

/**
 * Least-privilege scopes (SECURITY.md §5, TOOLS.md). Each one is required by
 * an implemented tool; nothing broader is requested.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  // Read, label, archive, draft, send, trash. Does NOT allow permanent deletion.
  "https://www.googleapis.com/auth/gmail.modify",
  // Read and write events on the user's calendars (no calendar settings/ACLs).
  "https://www.googleapis.com/auth/calendar.events",
  // Read/write saved contacts, and read "other contacts" (people you emailed).
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const PROVIDER = "google";
const STATE_TTL_MS = 10 * 60_000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export class GoogleAuth {
  private refreshing?: Promise<string>;

  constructor(
    private readonly cfg: GoogleOAuthConfig,
    private readonly tokens: TokenStore,
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  isConnected(): boolean {
    try {
      return this.tokens.load(PROVIDER) !== undefined;
    } catch {
      return false;
    }
  }

  status(): { connected: boolean; account: string | null; scopes: string[] } {
    const stored = this.tokens.load(PROVIDER);
    return { connected: !!stored, account: stored?.account ?? null, scopes: stored?.scopes ?? [] };
  }

  /** Step 1: build the consent URL (with state + PKCE S256). */
  createAuthUrl(): string {
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.db
      .prepare("INSERT INTO oauth_states (state, provider, code_verifier, created_at) VALUES (?, ?, ?, ?)")
      .run(state, PROVIDER, verifier, nowIso());
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /** Step 2: validate state, exchange code, store encrypted tokens. */
  async handleCallback(code: string, state: string): Promise<{ account: string | null; scopes: string[] }> {
    const row = this.db
      .prepare("SELECT code_verifier, created_at FROM oauth_states WHERE state = ? AND provider = ?")
      .get(state, PROVIDER) as { code_verifier: string; created_at: string } | undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (!row || Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) {
      throw new Error("Ungültiger oder abgelaufener OAuth-State. Bitte Verbindung erneut starten.");
    }
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri: this.cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: row.code_verifier,
      }),
    });
    if (!res.ok) throw new Error(`Google-Token-Austausch fehlgeschlagen (HTTP ${res.status})`);
    const body = (await res.json()) as TokenResponse;
    if (!body.refresh_token) {
      throw new Error("Google hat kein Refresh-Token geliefert. Zugriff unter myaccount.google.com/permissions entfernen und erneut verbinden.");
    }
    const scopes = (body.scope ?? "").split(" ").filter(Boolean);
    const account = body.id_token ? decodeIdTokenEmail(body.id_token) : null;
    this.tokens.save(
      PROVIDER,
      { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + body.expires_in * 1000 },
      scopes,
      account ?? undefined,
    );
    return { account, scopes };
  }

  /** Valid access token, refreshing when needed. Concurrent callers share one refresh. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    const stored = this.tokens.load(PROVIDER);
    if (!stored) throw new ToolError("Google ist nicht verbunden.", "NOT_CONFIGURED");
    if (!forceRefresh && stored.tokens.expiresAt - 60_000 > Date.now()) return stored.tokens.accessToken;
    this.refreshing ??= this.refresh(stored.tokens, stored.scopes).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh(tokens: StoredTokens, scopes: string[]): Promise<string> {
    if (!tokens.refreshToken) throw new ToolError("Google-Sitzung abgelaufen. Bitte neu verbinden.", "AUTH_FAILED");
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (res.status === 400 || res.status === 401) {
      throw new ToolError("Google-Zugriff wurde widerrufen oder ist abgelaufen. Bitte in den Einstellungen neu verbinden.", "AUTH_FAILED");
    }
    if (!res.ok) throw new ToolError(`Google-Token-Erneuerung fehlgeschlagen (HTTP ${res.status})`, "UPSTREAM_ERROR");
    const body = (await res.json()) as TokenResponse;
    this.tokens.save(
      PROVIDER,
      {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? tokens.refreshToken,
        expiresAt: Date.now() + body.expires_in * 1000,
      },
      scopes,
    );
    return body.access_token;
  }

  async disconnect(): Promise<void> {
    const stored = this.tokens.load(PROVIDER);
    this.tokens.delete(PROVIDER);
    const token = stored?.tokens.refreshToken ?? stored?.tokens.accessToken;
    if (token) {
      await this.fetchImpl(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => undefined);
    }
  }
}

function decodeIdTokenEmail(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}
