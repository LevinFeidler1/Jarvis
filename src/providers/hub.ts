import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import { ToolError } from "../core/types.js";
import type { TokenStore } from "../security/token-store.js";
import { GoogleCalendarProvider } from "./google/calendar.js";
import { GmailProvider } from "./google/gmail.js";
import { GoogleHttp } from "./google/http.js";
import { GoogleAuth } from "./google/oauth.js";
import { GoogleContactsProvider } from "./google/people.js";
import { InAppNotificationProvider, LocalTaskProvider, ReminderStore } from "./local/local.js";
import type { CalendarProvider, ContactProvider, EmailProvider, TaskProvider } from "./types.js";

export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  state: "connected" | "not_configured" | "credentials_missing" | "planned";
  account?: string | null;
  detail: string;
}

const SETUP_HINT = "Einrichtung: Einstellungen → Integrationen (Anleitung: docs/SETUP_GOOGLE.md).";

/**
 * Resolves the active provider per capability. Never pretends a service is
 * connected: missing integrations raise NOT_CONFIGURED with setup guidance.
 */
export class ProviderHub {
  readonly tasks: TaskProvider;
  readonly reminders: ReminderStore;
  readonly notifications: InAppNotificationProvider;
  readonly googleAuth?: GoogleAuth;
  private readonly google?: { email: GmailProvider; calendar: GoogleCalendarProvider; contacts: GoogleContactsProvider };
  private overrides: { email?: EmailProvider; calendar?: CalendarProvider; contacts?: ContactProvider } = {};

  constructor(config: AppConfig, db: Db, tokenStore: TokenStore) {
    this.tasks = new LocalTaskProvider(db);
    this.reminders = new ReminderStore(db);
    this.notifications = new InAppNotificationProvider(db);
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
      };
    }
  }

  /** For tests and future providers (e.g. Microsoft Graph). */
  setProviders(p: { email?: EmailProvider; calendar?: CalendarProvider; contacts?: ContactProvider }): void {
    this.overrides = { ...this.overrides, ...p };
  }

  private googleReady(): boolean {
    return !!this.google && !!this.googleAuth?.isConnected();
  }

  email(): EmailProvider {
    if (this.overrides.email) return this.overrides.email;
    if (this.googleReady()) return this.google!.email;
    throw new ToolError(`E-Mail ist noch nicht konfiguriert. ${SETUP_HINT}`, "NOT_CONFIGURED");
  }

  calendar(): CalendarProvider {
    if (this.overrides.calendar) return this.overrides.calendar;
    if (this.googleReady()) return this.google!.calendar;
    throw new ToolError(`Der Kalender ist noch nicht konfiguriert. ${SETUP_HINT}`, "NOT_CONFIGURED");
  }

  contacts(): ContactProvider {
    if (this.overrides.contacts) return this.overrides.contacts;
    if (this.googleReady()) return this.google!.contacts;
    throw new ToolError(`Kontakte sind noch nicht konfiguriert. ${SETUP_HINT}`, "NOT_CONFIGURED");
  }

  status(): IntegrationStatus[] {
    let google: IntegrationStatus;
    if (!this.googleAuth) {
      google = {
        id: "google",
        name: "Google (Gmail, Kalender, Kontakte)",
        category: "email,calendar,contacts",
        state: "credentials_missing",
        detail: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen in .env. Siehe docs/SETUP_GOOGLE.md.",
      };
    } else {
      const s = this.googleAuth.status();
      google = {
        id: "google",
        name: "Google (Gmail, Kalender, Kontakte)",
        category: "email,calendar,contacts",
        state: s.connected ? "connected" : "not_configured",
        account: s.account,
        detail: s.connected ? `Verbunden. Scopes: ${s.scopes.length}` : "Zugangsdaten vorhanden — Konto noch nicht verbunden.",
      };
    }
    return [
      google,
      {
        id: "microsoft",
        name: "Microsoft 365 (Outlook, Kalender, Kontakte)",
        category: "email,calendar,contacts",
        state: "planned",
        detail: "Geplant für eine spätere Phase (siehe ROADMAP.md).",
      },
      { id: "local-tasks", name: "Aufgaben (lokal)", category: "tasks", state: "connected", detail: "Integriert, keine Einrichtung nötig." },
      { id: "local-reminders", name: "Erinnerungen (In-App)", category: "reminders", state: "connected", detail: "Integriert." },
    ];
  }
}
