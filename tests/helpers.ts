import { randomBytes } from "node:crypto";
import type { AppConfig } from "../src/config.js";
import { Agent } from "../src/core/agent.js";
import type { LlmClient, LlmRequest, LlmResponse } from "../src/core/llm.js";
import { openDatabase, type Db } from "../src/db/database.js";
import { Scheduler } from "../src/core/scheduler.js";
import { MemoryStore } from "../src/memory/memory.js";
import { ProviderHub } from "../src/providers/hub.js";
import type {
  CalendarEvent,
  CalendarProvider,
  Contact,
  ContactProvider,
  Email,
  EmailProvider,
  ListEmailsQuery,
  NewEvent,
  OutgoingEmail,
} from "../src/providers/types.js";
import { TokenStore } from "../src/security/token-store.js";
import { createDefaultRegistry } from "../src/tools/registry.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    model: "test-model",
    accessToken: "t".repeat(40),
    encryptionKey: randomBytes(32),
    host: "127.0.0.1",
    port: 0,
    publicUrl: "http://localhost:3000",
    dbPath: ":memory:",
    timezone: "Europe/Berlin",
    language: "de",
    maxAgentSteps: 8,
    confirmationTtlMinutes: 30,
    compactAtTokens: 60_000,
    files: { maxBytes: 20 * 1024 * 1024, dbQuotaBytes: 150 * 1024 * 1024 },
    triage: { model: "test-small", dailyLimit: 100 },
    ...overrides,
  };
}

// ─── Database ──────────────────────────────────────────────────────────────

let shared: Promise<Db> | undefined;
const TABLES = [
  "messages", "conversations", "pending_actions", "activity", "audit_log", "memory", "tasks",
  "reminders", "notifications", "oauth_tokens", "oauth_states", "settings", "sessions", "email_accounts", "contacts", "push_subscriptions", "automations", "llm_usage", "files", "file_blobs", "upload_sessions", "upload_chunks", "triage_seen", "suggestions", "suggestion_feedback",
];

/** One in-process Postgres (PGlite) per test worker, emptied for every test. */
export async function testDb(): Promise<Db> {
  shared ??= openDatabase({ localPath: ":memory:" });
  const db = await shared;
  await db.exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  return db;
}

// ─── Scripted LLM ──────────────────────────────────────────────────────────

type Block = Record<string, unknown>;
export const text = (t: string): Block => ({ type: "text", text: t, citations: null });
let seq = 0;
export const toolUse = (name: string, input: unknown, id = `toolu_${++seq}`): Block => ({ type: "tool_use", id, name, input });

export function message(content: Block[], stop_reason?: string): LlmResponse {
  const hasTool = content.some((b) => b.type === "tool_use");
  return {
    id: `msg_${++seq}`,
    type: "message",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: stop_reason ?? (hasTool ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as LlmResponse;
}

export type Step = LlmResponse | ((req: LlmRequest) => LlmResponse);

/** Plays back a fixed script of model turns and records every request. */
export class ScriptedLlm implements LlmClient {
  readonly model = "test-model";
  readonly requests: LlmRequest[] = [];
  constructor(private readonly steps: Step[]) {}
  async create(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedLlm: script exhausted");
    return typeof step === "function" ? step(req) : step;
  }
  /** tool_result blocks sent back in the latest request. */
  lastToolResults(): Array<{ tool_use_id: string; content: string; is_error?: boolean }> {
    const last = this.requests.at(-1)!.messages.at(-1)!;
    return (Array.isArray(last.content) ? last.content : []).filter((b) => (b as unknown as Block).type === "tool_result") as never;
  }
}

// ─── In-memory provider doubles (test-only) ────────────────────────────────

export class FakeEmail implements EmailProvider {
  readonly name = "FakeMail";
  sent: OutgoingEmail[] = [];
  forwarded: Array<{ id: string; to: string[] }> = [];
  drafts: OutgoingEmail[] = [];
  read = new Set<string>();
  failOn = new Set<string>();
  constructor(public mails: Email[] = []) {}
  async listEmails(q: ListEmailsQuery) {
    return this.mails.filter((m) => (!q.unreadOnly || m.unread) && (!q.from || m.from.email.includes(q.from)));
  }
  async readEmail(id: string) {
    const m = this.mails.find((x) => x.id === id);
    if (!m) throw new Error("not found");
    return m;
  }
  async draftEmail(input: OutgoingEmail) {
    this.drafts.push(input);
    return { id: `draft_${this.drafts.length}` };
  }
  async sendEmail(input: OutgoingEmail) {
    this.sent.push(input);
    return { id: `sent_${this.sent.length}` };
  }
  async forwardEmail(id: string, to: string[]) {
    this.forwarded.push({ id, to });
    return { id: `fwd_${this.forwarded.length}` };
  }
  labels: Array<{ id: string; add?: string[]; remove?: string[] }> = [];
  archived: string[] = [];
  trashed: string[] = [];
  async modifyLabels(id: string, change: { add?: string[]; remove?: string[] } = {}) {
    if (this.failOn.has(id)) throw new Error("upstream failed");
    this.labels.push({ id, ...change });
  }
  async markRead(id: string, read: boolean) {
    if (this.failOn.has(id)) throw new Error("upstream failed");
    if (read) this.read.add(id);
    else this.read.delete(id);
  }
  async archive(id: string) {
    this.archived.push(id);
  }
  async trash(id: string) {
    this.trashed.push(id);
  }
}

export function makeEmail(partial: Partial<Email> & { id: string }): Email {
  return {
    threadId: `th_${partial.id}`,
    from: { name: "Anna Müller", email: "anna@example.com" },
    to: [{ email: "me@example.com" }],
    cc: [],
    subject: "Hallo",
    snippet: "",
    date: "2026-09-30T08:00:00.000Z",
    unread: true,
    labels: ["INBOX", "UNREAD"],
    hasAttachments: false,
    bodyText: "",
    attachments: [],
    ...partial,
  };
}

export class FakeCalendar implements CalendarProvider {
  readonly name = "FakeCal";
  created: Array<{ input: NewEvent; notify: boolean }> = [];
  down = false;
  constructor(public events: CalendarEvent[] = []) {}
  private check() {
    if (this.down) throw new Error("Kalenderdienst antwortet nicht");
  }
  async listEvents(q: { timeMin: string; timeMax: string }) {
    this.check();
    return this.events.filter((e) => new Date(e.end) > new Date(q.timeMin) && new Date(e.start) < new Date(q.timeMax));
  }
  async getEvent(id: string) {
    this.check();
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new Error("not found");
    return e;
  }
  async createEvent(input: NewEvent, notify: boolean) {
    this.check();
    this.created.push({ input, notify });
    const ev: CalendarEvent = {
      id: `ev_${this.created.length}`,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: !!input.allDay,
      attendees: (input.attendees ?? []).map((email) => ({ email })),
      status: "confirmed",
      busy: true,
    };
    this.events.push(ev);
    return ev;
  }
  async updateEvent(id: string, patch: Partial<NewEvent>) {
    this.check();
    const e = await this.getEvent(id);
    Object.assign(e, { title: patch.title ?? e.title, start: patch.start ?? e.start, end: patch.end ?? e.end });
    return e;
  }
  async deleteEvent(id: string) {
    this.events = this.events.filter((e) => e.id !== id);
  }
  async respondToInvitation(id: string) {
    return this.getEvent(id);
  }
}

export class FakeContacts implements ContactProvider {
  readonly name = "FakeContacts";
  constructor(public contacts: Contact[] = []) {}
  async searchContacts(q: string) {
    const n = q.toLowerCase();
    return this.contacts.filter((c) => c.name.toLowerCase().includes(n) || c.emails.some((e) => e.toLowerCase().includes(n)));
  }
  async getContact(id: string) {
    return this.contacts.find((c) => c.id === id)!;
  }
  async createContact(input: { name: string }) {
    const c: Contact = { id: `people/${this.contacts.length + 1}`, name: input.name, emails: [], phones: [], source: "contacts" };
    this.contacts.push(c);
    return c;
  }
  async updateContact(id: string) {
    return this.getContact(id);
  }
}

// ─── Wiring ────────────────────────────────────────────────────────────────

export interface Harness {
  db: Db;
  config: AppConfig;
  agent: Agent;
  llm: ScriptedLlm;
  providers: ProviderHub;
  memory: MemoryStore;
  email: FakeEmail;
  calendar: FakeCalendar;
  contacts: FakeContacts;
  clock: { now: Date };
  scheduler: Scheduler;
}

export async function harness(
  steps: Step[],
  opts: { connect?: boolean; emails?: Email[]; events?: CalendarEvent[]; contacts?: Contact[]; now?: Date; config?: Partial<AppConfig> } = {},
): Promise<Harness> {
  const config = testConfig(opts.config);
  const db = await testDb();
  const memory = new MemoryStore(db);
  const providers = new ProviderHub(config, db, new TokenStore(db, config.encryptionKey));
  const email = new FakeEmail(opts.emails);
  const calendar = new FakeCalendar(opts.events);
  const contacts = new FakeContacts(opts.contacts);
  if (opts.connect !== false) providers.setProviders({ email, calendar, contacts });
  const llm = new ScriptedLlm(steps);
  const clock = { now: opts.now ?? new Date("2026-09-30T08:00:00+02:00") };
  const agent = new Agent({ config, db, llm, registry: createDefaultRegistry(), providers, memory, now: () => clock.now });
  return { db, config, agent, llm, providers, memory, email, calendar, contacts, clock, scheduler: new Scheduler(providers) };
}
