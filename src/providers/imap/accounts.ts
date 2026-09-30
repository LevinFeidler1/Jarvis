import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database.js";
import { nowIso } from "../../db/database.js";
import { decrypt, encrypt } from "../../security/crypto.js";

export interface ServerEndpoint {
  host: string;
  port: number;
  /** true = TLS from the start (993/465); false = STARTTLS (587). */
  secure: boolean;
}

export interface MailPreset {
  id: string;
  label: string;
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
  hint: string;
}

/**
 * Known German providers. Hosts marked with "<…>" must be completed by the user.
 * Sources: provider help pages (1&1/IONOS, All-Inkl KAS).
 */
export const MAIL_PRESETS: MailPreset[] = [
  {
    id: "ionos",
    label: "1&1 / IONOS (eigene Domain)",
    imap: { host: "imap.ionos.de", port: 993, secure: true },
    smtp: { host: "smtp.ionos.de", port: 465, secure: true },
    hint: "Für Postfächer mit eigener Domain bei 1&1/IONOS. Benutzername = volle E-Mail-Adresse, Passwort = Postfach-Passwort.",
  },
  {
    id: "1und1",
    label: "1&1 Mail (@online.de u.ä.)",
    imap: { host: "imap.1und1.de", port: 993, secure: true },
    smtp: { host: "smtp.1und1.de", port: 587, secure: false },
    hint: "Für klassische 1&1-Mailadressen. Falls die Anmeldung scheitert, das Preset „1&1 / IONOS“ probieren.",
  },
  {
    id: "allinkl",
    label: "All-Inkl (KAS)",
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 465, secure: true },
    hint: "Servername steht im KAS unter E-Mail → Postfach (z.B. w0123456.kasserver.com), für IMAP und SMTP derselbe. Benutzername ist die Postfach-Kennung (z.B. m0123456) oder die E-Mail-Adresse.",
  },
  {
    id: "custom",
    label: "Anderer Anbieter",
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 465, secure: true },
    hint: "Server-Daten findest du in der Hilfe deines Anbieters (Stichwort „IMAP/SMTP-Einstellungen“).",
  },
];

export interface EmailAccountRecord {
  id: string;
  email: string;
  name: string | null;
  preset: string;
  username: string;
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
  createdAt: string;
}

export interface EmailAccountWithSecret extends EmailAccountRecord {
  password: string;
}

interface Row {
  id: string;
  email: string;
  name: string | null;
  preset: string;
  username: string;
  encrypted_password: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  created_at: string;
}

function fromRow(r: Row): EmailAccountRecord {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    preset: r.preset,
    username: r.username,
    imap: { host: r.imap_host, port: r.imap_port, secure: r.imap_secure },
    smtp: { host: r.smtp_host, port: r.smtp_port, secure: r.smtp_secure },
    createdAt: r.created_at,
  };
}

const DEFAULT_KEY = "email_default_account";

/** IMAP/SMTP mailboxes. Passwords are AES-256-GCM encrypted, never returned by list(). */
export class EmailAccountStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {}

  async list(): Promise<EmailAccountRecord[]> {
    return (await this.db.query<Row>("SELECT * FROM email_accounts ORDER BY created_at")).map(fromRow);
  }

  async listWithSecrets(): Promise<EmailAccountWithSecret[]> {
    const rows = await this.db.query<Row>("SELECT * FROM email_accounts ORDER BY created_at");
    return rows.map((r) => ({ ...fromRow(r), password: decrypt(r.encrypted_password, this.key, `imap:${r.id}`) }));
  }

  async add(input: Omit<EmailAccountRecord, "id" | "createdAt"> & { password: string }): Promise<EmailAccountRecord> {
    const id = randomUUID();
    const createdAt = nowIso();
    await this.db.run(
      `INSERT INTO email_accounts (id, email, name, preset, username, encrypted_password, imap_host, imap_port, imap_secure,
         smtp_host, smtp_port, smtp_secure, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        input.email.toLowerCase(),
        input.name,
        input.preset,
        input.username,
        encrypt(input.password, this.key, `imap:${id}`),
        input.imap.host,
        input.imap.port,
        input.imap.secure,
        input.smtp.host,
        input.smtp.port,
        input.smtp.secure,
        createdAt,
      ],
    );
    return { ...input, email: input.email.toLowerCase(), id, createdAt };
  }

  async delete(id: string): Promise<boolean> {
    const acct = (await this.list()).find((a) => a.id === id);
    const deleted = (await this.db.run("DELETE FROM email_accounts WHERE id = $1", [id])) === 1;
    if (deleted && acct && (await this.getDefault()) === acct.email) await this.setDefault(null);
    return deleted;
  }

  async getDefault(): Promise<string | null> {
    const row = await this.db.one<{ value_json: string }>("SELECT value_json FROM settings WHERE key = $1", [DEFAULT_KEY]);
    return row ? (JSON.parse(row.value_json) as string | null) : null;
  }

  async setDefault(email: string | null): Promise<void> {
    await this.db.run(
      "INSERT INTO settings (key, value_json) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
      [DEFAULT_KEY, JSON.stringify(email ? email.toLowerCase() : null)],
    );
  }
}
