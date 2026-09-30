import { randomUUID } from "node:crypto";
import webpush from "web-push";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { decrypt, encrypt } from "../security/crypto.js";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body?: string;
  /** App-relative URL opened when the notification is tapped, e.g. "/#tasks". */
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

export interface PushDeviceInfo {
  id: string;
  label: string | null;
  host: string;
  createdAt: string;
  lastSuccessAt: string | null;
}

/** Sends one encrypted Web Push message; returns the push service's HTTP status. */
export type PushSender = (
  sub: PushSubscriptionInput,
  payload: string,
  vapid: { subject: string; publicKey: string; privateKey: string },
) => Promise<number>;

/** Only real browser push services — the endpoint is supplied by the client. */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const defaultSender: PushSender = async (sub, payload, vapid) => {
  const res = await webpush.sendNotification(sub, payload, { vapidDetails: vapid, TTL: 60 * 60 * 24, urgency: "high" });
  return res.statusCode;
};

/**
 * Web Push to the user's devices (installed PWA on iPhone/Android, desktop
 * browsers). VAPID keys are generated once and stored encrypted in the DB,
 * so no extra environment variables are needed.
 */
export class PushService {
  private sender: PushSender = defaultSender;

  constructor(
    private readonly db: Db,
    private readonly encryptionKey: Buffer,
    private readonly publicUrl: string,
  ) {}

  /** Test hook. */
  setSender(sender: PushSender): void {
    this.sender = sender;
  }

  private get subject(): string {
    return this.publicUrl.startsWith("https://") ? this.publicUrl : "mailto:jarvis@example.com";
  }

  private async vapid(): Promise<{ publicKey: string; privateKey: string }> {
    const read = async () => {
      const row = await this.db.one<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'vapid'");
      if (!row) return undefined;
      const v = JSON.parse(row.value_json) as { publicKey: string; privateKey: string };
      return { publicKey: v.publicKey, privateKey: decrypt(v.privateKey, this.encryptionKey, "vapid") };
    };
    const existing = await read();
    if (existing) return existing;
    const keys = webpush.generateVAPIDKeys();
    // Two cold starts may race: the first insert wins, everyone re-reads it.
    await this.db.run("INSERT INTO settings (key, value_json) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [
      JSON.stringify({ publicKey: keys.publicKey, privateKey: encrypt(keys.privateKey, this.encryptionKey, "vapid") }),
    ]);
    return (await read())!;
  }

  async publicKey(): Promise<string> {
    return (await this.vapid()).publicKey;
  }

  async subscribe(sub: PushSubscriptionInput, label?: string): Promise<void> {
    if (!isAllowedPushEndpoint(sub.endpoint)) throw new Error("Unbekannter Push-Dienst");
    await this.db.run(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label`,
      [randomUUID(), sub.endpoint, sub.keys.p256dh, sub.keys.auth, label ?? null, nowIso()],
    );
  }

  async unsubscribe(endpoint: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint])) > 0;
  }

  async removeDevice(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM push_subscriptions WHERE id = $1", [id])) > 0;
  }

  async devices(): Promise<PushDeviceInfo[]> {
    const rows = await this.db.query<{ id: string; endpoint: string; label: string | null; createdAt: string; lastSuccessAt: string | null }>(
      `SELECT id, endpoint, label, created_at AS "createdAt", last_success_at AS "lastSuccessAt" FROM push_subscriptions ORDER BY created_at`,
    );
    return rows.map(({ endpoint, ...r }) => ({ ...r, host: new URL(endpoint).hostname }));
  }

  /** Sends to every registered device. Expired subscriptions (404/410) are removed. */
  async send(msg: PushMessage): Promise<{ sent: number; failed: number }> {
    const subs = await this.db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions",
    );
    if (subs.length === 0) return { sent: 0, failed: 0 };
    const keys = await this.vapid();
    const payload = JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body?.slice(0, 400) ?? "", url: msg.url ?? "/", tag: msg.tag });
    let sent = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          const status = await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { subject: this.subject, ...keys });
          if (status >= 200 && status < 300) {
            sent++;
            await this.db.run("UPDATE push_subscriptions SET last_success_at = $1 WHERE id = $2", [nowIso(), s.id]);
          } else failed++;
        } catch (err) {
          failed++;
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await this.db.run("DELETE FROM push_subscriptions WHERE id = $1", [s.id]);
          else console.error("[push]", status ?? "", (err as Error).message);
        }
      }),
    );
    return { sent, failed };
  }
}
