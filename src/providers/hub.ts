import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import { ToolError } from "../core/types.js";
import type { TokenStore } from "../security/token-store.js";
import { GoogleCalendarProvider } from "./google/calendar.js";
import { GmailProvider } from "./google/gmail.js";
import { GoogleHttp } from "./google/http.js";
import { GoogleDriveProvider } from "./google/drive.js";
import { DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE, GoogleAuth } from "./google/oauth.js";
import { DriveFileStorage } from "../files/storage.js";
import { GoogleContactsProvider } from "./google/people.js";
import { CombinedContacts } from "./combined-contacts.js";
import { EmailAccountStore } from "./imap/accounts.js";
import { type ImapDeps, ImapEmailProvider } from "./imap/imap.js";
import { LocalContactProvider } from "./local/contacts.js";
import { InAppNotificationProvider, LocalTaskProvider, ReminderStore } from "./local/local.js";
import { type MailboxEntry, MultiAccountEmail } from "./multi-email.js";
import { PushService } from "./push.js";
import { AutomationStore } from "../core/automations.js";
import { FileService } from "../files/service.js";
import { PlaywrightEngine } from "../browser/engine.js";
import { RemoteBrowserEngine, browserSecret } from "../browser/remote.js";
import { BrowserTaskStore } from "../browser/tasks.js";
import type { BrowserEngine } from "../browser/types.js";
import type { CalendarProvider, ContactProvider, EmailProvider, FileProvider } from "./types.js";

export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  state: "connected" | "not_configured" | "credentials_missing" | "planned";
  account?: string | null;
  detail: string;
  /** Connected, but a newer feature (e.g. Drive) needs the user to reconnect for more permissions. */
  needsReconnect?: boolean;
}

function resolveBrowserEngine(config: AppConfig): BrowserEngine | null {
  const b = config.browser;
  if (b.mode === "off") return null;
  const secret = browserSecret(config.encryptionKey);
  if (b.mode === "remote" || (b.mode === "auto" && b.url)) {
    return b.url || process.env.VERCEL ? new RemoteBrowserEngine(b.url ?? `${config.publicUrl}/api/browser`, secret) : null;
  }
  if (b.mode === "auto" && process.env.VERCEL) return new RemoteBrowserEngine(`${config.publicUrl}/api/browser`, secret);
  if (b.chromiumPath) return new PlaywrightEngine({ executablePath: b.chromiumPath, maxDownloadBytes: config.files.maxBytes });
  return null;
}

const SETUP_HINT = "Einrichtung: Einstellungen → Integrationen (Anleitung: docs/SETUP_GOOGLE.md).";

/**
 * Resolves the active provider per capability. Never pretends a service is
 * connected: missing integrations raise NOT_CONFIGURED with setup guidance.
 */
export class ProviderHub {
  readonly tasks: LocalTaskProvider;
  readonly reminders: ReminderStore;
  readonly notifications: InAppNotificationProvider;
  readonly push: PushService;
  readonly automations: AutomationStore;
  readonly files: FileService;
  readonly browserTasks: BrowserTaskStore;
  /** Tests only: allow the browser to open 127.0.0.1 test servers. */
  browserAllowPrivate = false;
  private browserEngine?: BrowserEngine | null;
  readonly emailAccounts: EmailAccountStore;
  /** Contacts maintained in JARVIS itself — always available, no Google needed. */
  readonly localContacts: LocalContactProvider;
  readonly googleAuth?: GoogleAuth;
  private imapDeps: ImapDeps = {};
  private readonly google?: { email: GmailProvider; calendar: GoogleCalendarProvider; contacts: GoogleContactsProvider; drive: GoogleDriveProvider };
  private driveOverride?: FileProvider | null;
  private overrides: { email?: EmailProvider; calendar?: CalendarProvider; contacts?: ContactProvider } = {};

  constructor(config: AppConfig, db: Db, tokenStore: TokenStore) {
    this.tasks = new LocalTaskProvider(db);
    this.reminders = new ReminderStore(db);
    this.automations = new AutomationStore(db, config.timezone);
    this.files = new FileService(db, config.files);
    this.browserTasks = new BrowserTaskStore(db, config.browser.maxSteps, config.browser.taskMinutes);
    this.browserEngine = resolveBrowserEngine(config);
    this.push = new PushService(db, config.encryptionKey, config.publicUrl);
    this.notifications = new InAppNotificationProvider(db, this.push);
    this.emailAccounts = new EmailAccountStore(db, config.encryptionKey);
    this.localContacts = new LocalContactProvider(db);
    if (config.google) {
      this.googleAuth = new GoogleAuth(
        { ...config.google, redirectUri: `${config.publicUrl}/api/integrations/google/callback` },
        tokenStore,
        db,
      );
      const http = new GoogleHttp(this.googleAuth);
      this.google = {
        email: new GmailProvider(http),
        calendar: new GoogleCalendarProvider(http),
        contacts: new GoogleContactsProvider(http),
        drive: new GoogleDriveProvider(http),
      };
    }
    this.files.setDriveStorage(async () => {
      const drive = await this.drive().catch(() => undefined);
      return drive ? new DriveFileStorage(drive) : undefined;
    });
  }

  /** For tests and future providers (e.g. Microsoft Graph). */
  setProviders(p: { email?: EmailProvider; calendar?: CalendarProvider; contacts?: ContactProvider }): void {
    this.overrides = { ...this.overrides, ...p };
  }

  /** Test hook / override for the browser engine. */
  setBrowserEngine(engine: BrowserEngine | null): void {
    this.browserEngine = engine;
  }

  browser(): BrowserEngine {
    if (!this.browserEngine) {
      throw new ToolError("Der Browser-Agent ist nicht eingerichtet (lokal: JARVIS_CHROMIUM_PATH setzen; auf Vercel automatisch; siehe docs/BROWSER.md).", "NOT_CONFIGURED");
    }
    return this.browserEngine;
  }

  /** Test hook: a fake Drive (null = explicitly no Drive). */
  setDrive(drive: FileProvider | null): void {
    this.driveOverride = drive;
  }

  /** Google Drive when connected AND the drive.file permission was granted (older connections lack it). */
  async drive(): Promise<FileProvider> {
    if (this.driveOverride !== undefined) {
      if (this.driveOverride) return this.driveOverride;
      throw new ToolError("Google Drive ist nicht verbunden.", "NOT_CONFIGURED");
    }
    if (!(await this.googleReady())) throw new ToolError(`Google Drive ist nicht verbunden. ${SETUP_HINT}`, "NOT_CONFIGURED");
    const { scopes } = await this.googleAuth!.status();
    if (!scopes.includes(DRIVE_FILE_SCOPE)) {
      throw new ToolError("Google ist verbunden, aber ohne Drive-Berechtigung. Einstellungen → Integrationen → Google „Neu verbinden“ (docs/SETUP_GOOGLE.md).", "NOT_CONFIGURED");
    }
    return this.google!.drive;
  }

  /** True if the whole Drive may be searched (drive.readonly granted). */
  async driveReadAll(): Promise<boolean> {
    if (this.driveOverride) return true;
    if (!(await this.googleReady())) return false;
    return (await this.googleAuth!.status()).scopes.includes(DRIVE_READONLY_SCOPE);
  }

  /** Test hook: custom IMAP/SMTP clients. */
  setImapDeps(deps: ImapDeps): void {
    this.imapDeps = deps;
  }

  private async googleReady(): Promise<boolean> {
    return !!this.google && !!(await this.googleAuth?.isConnected());
  }

  /** All connected mailboxes (Gmail + IMAP accounts) behind one provider. */
  async email(): Promise<EmailProvider> {
    if (this.overrides.email) return this.overrides.email;
    const entries: MailboxEntry[] = [];
    if (await this.googleReady()) {
      const s = await this.googleAuth!.status();
      entries.push({ email: (s.account ?? "gmail").toLowerCase(), name: "Gmail", kind: "gmail", provider: this.google!.email });
    }
    let accounts;
    try {
      accounts = await this.emailAccounts.listWithSecrets();
    } catch {
      throw new ToolError("Gespeicherte Postfach-Passwörter können nicht entschlüsselt werden (JARVIS_ENCRYPTION_KEY geändert?). Konten neu anlegen.", "AUTH_FAILED");
    }
    for (const a of accounts) {
      entries.push({ email: a.email, name: a.name ?? a.email, kind: "imap", provider: new ImapEmailProvider(a, this.imapDeps) });
    }
    if (entries.length === 0) {
      throw new ToolError(`E-Mail ist noch nicht konfiguriert. Einstellungen → E-Mail-Konten (Gmail über Google, 1&1/All-Inkl über IMAP).`, "NOT_CONFIGURED");
    }
    return new MultiAccountEmail(entries, await this.emailAccounts.getDefault());
  }

  async calendar(): Promise<CalendarProvider> {
    if (this.overrides.calendar) return this.overrides.calendar;
    if (await this.googleReady()) return this.google!.calendar;
    throw new ToolError(`Der Kalender ist noch nicht konfiguriert. ${SETUP_HINT}`, "NOT_CONFIGURED");
  }

  async contacts(): Promise<ContactProvider> {
    if (this.overrides.contacts) return this.overrides.contacts;
    return new CombinedContacts(this.localContacts, (await this.googleReady()) ? this.google!.contacts : undefined);
  }

  async status(): Promise<IntegrationStatus[]> {
    let google: IntegrationStatus;
    if (!this.googleAuth) {
      google = {
        id: "google",
        name: "Google (Gmail, Kalender, Kontakte, Drive)",
        category: "email,calendar,contacts",
        state: "credentials_missing",
        detail: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen in .env. Siehe docs/SETUP_GOOGLE.md.",
      };
    } else {
      const s = await this.googleAuth.status();
      google = {
        id: "google",
        name: "Google (Gmail, Kalender, Kontakte, Drive)",
        category: "email,calendar,contacts,files",
        state: s.connected ? "connected" : "not_configured",
        account: s.account,
        detail: !s.connected
          ? "Zugangsdaten vorhanden — Konto noch nicht verbunden."
          : s.scopes.includes(DRIVE_FILE_SCOPE)
            ? `Verbunden${s.scopes.includes(DRIVE_READONLY_SCOPE) ? " · Drive vollständig lesbar" : " · Drive: nur JARVIS-Dateien"}.`
            : "Verbunden — für Google Drive bitte neu verbinden (zusätzliche Berechtigung).",
        needsReconnect: s.connected && !s.scopes.includes(DRIVE_FILE_SCOPE),
      };
    }
    const imap: IntegrationStatus[] = (await this.emailAccounts.list()).map((a) => ({
      id: `imap:${a.id}`,
      name: a.name ? `${a.name} (${a.email})` : a.email,
      category: "email",
      state: "connected",
      account: a.email,
      detail: `IMAP ${a.imap.host} · SMTP ${a.smtp.host}`,
    }));
    return [
      google,
      ...imap,
      {
        id: "microsoft",
        name: "Microsoft 365 (Outlook, Kalender, Kontakte)",
        category: "email,calendar,contacts",
        state: "planned",
        detail: "Geplant für eine spätere Phase (siehe ROADMAP.md).",
      },
      { id: "local-contacts", name: "Kontakte (JARVIS)", category: "contacts", state: "connected", detail: "Integriert — selbst pflegen oder vCard (.vcf) importieren; Google Kontakte werden zusätzlich durchsucht, wenn verbunden." },
      { id: "local-tasks", name: "Aufgaben (lokal)", category: "tasks", state: "connected", detail: "Integriert, keine Einrichtung nötig." },
      { id: "local-reminders", name: "Erinnerungen (In-App)", category: "reminders", state: "connected", detail: "Integriert." },
    ];
  }
}
