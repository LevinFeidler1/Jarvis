import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import type { MemoryStore } from "../memory/memory.js";
import type { ProviderHub } from "../providers/hub.js";
import type { EmailSummary } from "../providers/types.js";
import type { Agent } from "./agent.js";
import { scanForInjection } from "./injection.js";
import { formatHuman, localDate } from "./time.js";
import type { MailCategory, MailClassification, MailClassifier } from "./triage-classifier.js";
import { UsageStore } from "./usage.js";
import { budgetStatus } from "../life/budget.js";

export type SuggestionKind = Exclude<MailCategory, "unimportant">;
export type SuggestionStatus = "open" | "accepted" | "ignored" | "expired" | "failed" | "auto" | "undone" | "needs_confirmation";

export interface SuggestionAction {
  tool: string;
  input: Record<string, unknown>;
  /** Shown on the card, e.g. "Antwort an anna@… senden". */
  label: string;
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  body: string;
  emailId: string | null;
  account: string | null;
  sender: string | null;
  actions: SuggestionAction[];
  /** Button label for "Annehmen". */
  acceptLabel: string | null;
  /** Prefilled chat text for "Bearbeiten". */
  editPrompt: string;
  warning: string | null;
  status: SuggestionStatus;
  result: string | null;
  conversationId: string | null;
  createdAt: string;
}

export interface TriageSettings {
  enabled: boolean;
  /** Only mail received after this moment is looked at (no backlog when switching on). */
  since: string | null;
  /** Create tasks for invoices/deadlines automatically (level 1, undoable). */
  autoTasks: boolean;
  mutedKinds: SuggestionKind[];
  mutedSenders: string[];
}

export const KIND_LABEL: Record<SuggestionKind, string> = {
  meeting: "Terminanfragen",
  lead: "Kundenanfragen",
  invoice: "Rechnungen",
  deadline: "Fristen & To-dos",
  reply: "Antwort nötig",
  newsletter: "Newsletter & Werbung",
};

const DEFAULT_SETTINGS: TriageSettings = { enabled: true, since: null, autoTasks: true, mutedKinds: [], mutedSenders: [] };
const SETTINGS_KEY = "triage";
const MAX_PER_TICK = 20;
const EXPIRE_DAYS = 7;
const SENDER_MUTE_AFTER = 3;
const KIND_MUTE_AFTER = 6;

interface Row {
  id: string;
  kind: SuggestionKind;
  title: string;
  body: string;
  email_id: string | null;
  account: string | null;
  sender: string | null;
  actions_json: string;
  accept_label: string | null;
  edit_prompt: string;
  warning: string | null;
  status: SuggestionStatus;
  result: string | null;
  conversation_id: string | null;
  undo_json: string | null;
  created_at: string;
}

const toSuggestion = (r: Row): Suggestion => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  emailId: r.email_id,
  account: r.account,
  sender: r.sender,
  actions: JSON.parse(r.actions_json) as SuggestionAction[],
  acceptLabel: r.accept_label,
  editPrompt: r.edit_prompt,
  warning: r.warning,
  status: r.status,
  result: r.result,
  conversationId: r.conversation_id,
  createdAt: r.created_at,
});

export interface TriageDeps {
  db: Db;
  config: AppConfig;
  providers: ProviderHub;
  memory: MemoryStore;
  agent: Agent;
  classifier?: MailClassifier;
  dailyLimit: number;
  now?: () => Date;
}

/**
 * Proactive butler (Phase C): looks at new mail on every cron tick, classifies
 * it with a small model and turns it into concrete, one-click suggestions.
 * Mail content is untrusted; suggestions only ever contain actions the user
 * sees in full on the card, and accepting runs them through the normal
 * permission gate.
 */
export class TriageService {
  private readonly now: () => Date;
  constructor(private readonly d: TriageDeps) {
    this.now = d.now ?? (() => new Date());
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  async settings(): Promise<TriageSettings> {
    const row = await this.d.db.one<{ value_json: string }>("SELECT value_json FROM settings WHERE key = $1", [SETTINGS_KEY]);
    return { ...DEFAULT_SETTINGS, ...(row ? (JSON.parse(row.value_json) as Partial<TriageSettings>) : {}) };
  }

  async saveSettings(patch: Partial<TriageSettings>): Promise<TriageSettings> {
    const cur = await this.settings();
    const next = { ...cur, ...patch };
    if (patch.enabled && !cur.enabled) next.since = this.now().toISOString(); // no backlog after re-enabling
    await this.d.db.run(
      "INSERT INTO settings (key, value_json) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json",
      [SETTINGS_KEY, JSON.stringify(next)],
    );
    return next;
  }

  async usageToday(): Promise<number> {
    const today = localDate(this.now(), this.d.config.timezone);
    const r = await this.d.db.one<{ n: string | number }>("SELECT count(*) AS n FROM triage_seen WHERE classified AND day = $1", [today]);
    return Number(r?.n ?? 0);
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  /** Classifies new mail and creates suggestions. Returns the number of new suggestions. */
  async runTick(): Promise<{ classified: number; suggestions: number; skipped?: string }> {
    if (!this.d.classifier) return { classified: 0, suggestions: 0, skipped: "Kein Sprachmodell konfiguriert" };
    let settings = await this.settings();
    if (!settings.enabled) return { classified: 0, suggestions: 0, skipped: "ausgeschaltet" };
    if (!settings.since) settings = await this.saveSettings({ since: this.now().toISOString() });
    await this.expireOld();

    if ((await budgetStatus(this.d.db, this.d.config.timezone).catch(() => null))?.blocked) return { classified: 0, suggestions: 0, skipped: "KI-Budget aufgebraucht" };
    const budget = Math.min(MAX_PER_TICK, this.d.dailyLimit - (await this.usageToday()));
    if (budget <= 0) return { classified: 0, suggestions: 0, skipped: "Tageslimit erreicht" };

    let mails: EmailSummary[];
    try {
      mails = await (await this.d.providers.email()).listEmails({ newerThanDays: 2, maxResults: 40, inboxOnly: true });
    } catch {
      return { classified: 0, suggestions: 0, skipped: "E-Mail nicht erreichbar" };
    }
    const fresh = mails.filter((m) => m.date >= settings.since!).sort((a, b) => a.date.localeCompare(b.date));
    if (!fresh.length) return { classified: 0, suggestions: 0 };

    // Claim atomically: parallel ticks never classify the same mail twice.
    const day = localDate(this.now(), this.d.config.timezone);
    const claimed: EmailSummary[] = [];
    for (const m of fresh) {
      if (claimed.length >= budget) break;
      const ins = await this.d.db.query<{ email_id: string }>(
        "INSERT INTO triage_seen (email_id, account, day, classified, processed_at) VALUES ($1, $2, $3, TRUE, $4) ON CONFLICT (email_id) DO NOTHING RETURNING email_id",
        [m.id, m.account ?? null, day, this.now().toISOString()],
      );
      if (ins.length) claimed.push(m);
    }
    if (!claimed.length) return { classified: 0, suggestions: 0 };

    const refs = new Map(claimed.map((m, i) => [String(i + 1), m]));
    let results: MailClassification[];
    try {
      const out = await this.d.classifier.classify(
        claimed.map((m, i) => ({ ref: String(i + 1), from: m.from.email, fromName: m.from.name, subject: m.subject, date: m.date, snippet: m.snippet.slice(0, 600), account: m.account })),
        { now: formatHuman(this.now(), this.d.config.timezone), timezone: this.d.config.timezone, userContext: await this.userContext() },
      );
      results = out.results;
      if (out.response) await new UsageStore(this.d.db).record(out.response as never).catch(() => undefined);
    } catch (err) {
      // Give the mails another chance on the next tick.
      for (const m of claimed) await this.d.db.run("DELETE FROM triage_seen WHERE email_id = $1", [m.id]);
      return { classified: 0, suggestions: 0, skipped: `Klassifizierung fehlgeschlagen: ${(err as Error).message}` };
    }

    const created: Suggestion[] = [];
    const newsletters: EmailSummary[] = [];
    for (const r of results) {
      const m = refs.get(r.ref);
      if (!m) continue;
      await this.d.db.run("UPDATE triage_seen SET category = $1 WHERE email_id = $2", [r.category, m.id]);
      if (r.category === "unimportant") continue;
      if (settings.mutedKinds.includes(r.category)) continue;
      if (settings.mutedSenders.includes(`${r.category}:${m.from.email.toLowerCase()}`)) continue;
      if (r.category === "newsletter") {
        newsletters.push(m);
        continue;
      }
      const s = await this.buildSuggestion(r, m, settings);
      if (s) created.push(s);
    }
    if (newsletters.length && !settings.mutedKinds.includes("newsletter")) {
      created.push(
        await this.insert({
          kind: "newsletter",
          title: `${newsletters.length} Newsletter/Werbung — archivieren?`,
          body: newsletters.map((m) => `• ${m.from.name ?? m.from.email}: ${m.subject}`).join("\n"),
          actions: [{ tool: "archive_email", input: { message_ids: newsletters.map((m) => m.id) }, label: `${newsletters.length} E-Mail(s) archivieren` }],
          acceptLabel: "Alle archivieren",
          editPrompt: "Welche Newsletter und Werbe-Mails sind heute gekommen? Schlag vor, was ich abbestellen sollte.",
        }),
      );
    }

    const autoDone = created.filter((s) => s.status === "auto");
    const open = created.filter((s) => s.status === "open");
    if (created.length) {
      const lines = [...open, ...autoDone].slice(0, 3).map((s) => `• ${s.title}`);
      await this.d.providers.notifications.notify(
        open.length ? `💡 ${open.length} ${open.length === 1 ? "neuer Vorschlag" : "neue Vorschläge"}` : "✅ Für dich erledigt",
        lines.join("\n"),
        { url: "/#jarvis", tag: "suggestions", suggestionIds: open.map((x) => x.id) },
      );
    }
    return { classified: results.length, suggestions: created.length };
  }

  private async userContext(): Promise<string> {
    const name = this.d.config.userName ?? "der Benutzer";
    const mem = (await this.d.memory.list()).filter((m) => m.source === "user" && ["fact", "project", "preference"].includes(m.category)).slice(0, 15);
    return `${name}. ${mem.map((m) => `${m.key}: ${m.value}`).join("; ")}`.slice(0, 1500);
  }

  private async buildSuggestion(r: MailClassification, m: EmailSummary, settings: TriageSettings): Promise<Suggestion | undefined> {
    const who = m.from.name ?? m.from.email;
    const scan = scanForInjection(m.subject, m.snippet);
    const warning = scan.suspicious ? "Diese E-Mail enthält typische Manipulationsversuche — keine Aktion vorbereitet. Bitte selbst prüfen." : null;
    const draft = warning ? null : r.reply_draft;
    const replyAction = (label: string): SuggestionAction | undefined =>
      draft ? { tool: "reply_email", input: { message_id: m.id, to: [m.from.email], body: draft }, label } : undefined;
    const base = { emailId: m.id, account: m.account ?? null, sender: m.from.email.toLowerCase(), warning };
    const editReply = `Hilf mir, auf die E-Mail von ${who} („${m.subject}“, ID ${m.id}) zu antworten.${draft ? ` Mein Entwurf:\n\n${draft}` : ""}`;

    if (r.category === "invoice" || r.category === "deadline") {
      const title = (r.task_title ?? (r.category === "invoice" ? `Rechnung ${who}${r.amount ? ` (${r.amount})` : ""} bezahlen` : r.summary)).slice(0, 200);
      const action: SuggestionAction = {
        tool: "create_task",
        input: { title, ...(r.due_date ? { due: r.due_date } : {}), priority: r.priority === "high" ? "high" : "normal", notes: `Aus E-Mail von ${who}: ${m.subject}` },
        label: `Aufgabe anlegen: ${title}${r.due_date ? ` (fällig ${r.due_date})` : ""}`,
      };
      const s = await this.insert({
        kind: r.category,
        ...base,
        title: `${r.category === "invoice" ? "Rechnung" : "Frist"} von ${who}${r.amount ? ` · ${r.amount}` : ""}${r.due_date ? ` · fällig ${r.due_date}` : ""}`,
        body: r.summary,
        actions: warning ? [] : [action],
        acceptLabel: warning ? null : "Aufgabe anlegen",
        editPrompt: `Was soll ich mit der ${r.category === "invoice" ? "Rechnung" : "E-Mail"} von ${who} („${m.subject}“, ID ${m.id}) tun?`,
      });
      // Level-1 action the user allows automatically: do it now, keep an undo.
      if (!warning && settings.autoTasks) return this.accept(s.id, { auto: true });
      return s;
    }

    if (r.category === "meeting") {
      const slot = r.proposed_times[0];
      let freeText = "";
      let free = false;
      const actions: SuggestionAction[] = [];
      if (slot) {
        const start = new Date(slot.start);
        const end = slot.end ? new Date(slot.end) : new Date(start.getTime() + 60 * 60_000);
        try {
          const events = await (await this.d.providers.calendar()).listEvents({ timeMin: start.toISOString(), timeMax: end.toISOString() });
          const busy = events.filter((e) => e.busy && !e.allDay);
          free = busy.length === 0;
          freeText = free ? " — du bist frei." : ` — Konflikt mit „${busy[0]!.title}“.`;
        } catch {
          freeText = " — Kalender nicht erreichbar, bitte selbst prüfen.";
        }
        if (free && !warning) {
          const reply = replyAction(`Antwort an ${m.from.email}: „${(draft ?? "").slice(0, 80)}…“`);
          if (reply) actions.push(reply);
          actions.push({
            tool: "create_event",
            input: { title: `Termin mit ${who}`.slice(0, 300), start: start.toISOString(), end: end.toISOString(), description: `Aus E-Mail: ${m.subject}` },
            label: `Im Kalender eintragen: ${formatHuman(start, this.d.config.timezone)}`,
          });
        }
      }
      const when = slot ? formatHuman(new Date(slot.start), this.d.config.timezone) : "ohne konkreten Zeitpunkt";
      return this.insert({
        kind: "meeting",
        ...base,
        title: `Terminanfrage von ${who}: ${when}${freeText}`,
        body: r.summary,
        actions,
        acceptLabel: actions.length ? (actions.some((a) => a.tool === "reply_email") ? "Zusagen & eintragen" : "Eintragen") : null,
        editPrompt: free ? editReply : `Terminanfrage von ${who} („${m.subject}“, ID ${m.id}): ${slot ? `der vorgeschlagene Termin ${when} passt nicht.` : "es gibt keinen konkreten Termin."} Prüf meinen Kalender und schlag 2–3 Alternativen in einer Antwort vor.`,
      });
    }

    if (r.category !== "lead" && r.category !== "reply") return undefined;
    const action = replyAction(`Antwort an ${m.from.email} senden`);
    return this.insert({
      kind: r.category,
      ...base,
      title: r.category === "lead" ? `Neue Anfrage von ${who}${action ? " — Antwortentwurf liegt bereit" : ""}` : `Antwort nötig: ${who}`,
      body: draft ? `${r.summary}\n\nEntwurf:\n${draft}` : r.summary,
      actions: action ? [action] : [],
      acceptLabel: action ? "Antwort senden" : null,
      editPrompt: editReply,
    });
  }

  private async insert(s: Partial<Suggestion> & Pick<Suggestion, "kind" | "title" | "body" | "actions" | "editPrompt"> & { acceptLabel: string | null }): Promise<Suggestion> {
    const id = randomUUID();
    await this.d.db.run(
      `INSERT INTO suggestions (id, kind, title, body, email_id, account, sender, actions_json, accept_label, edit_prompt, warning, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12)`,
      [id, s.kind, s.title.slice(0, 300), s.body.slice(0, 4000), s.emailId ?? null, s.account ?? null, s.sender ?? null, JSON.stringify(s.actions), s.acceptLabel, s.editPrompt.slice(0, 4000), s.warning ?? null, this.now().toISOString()],
    );
    return (await this.get(id))!;
  }

  // ─── Suggestions ─────────────────────────────────────────────────────────

  async get(id: string): Promise<Suggestion | undefined> {
    const r = await this.d.db.one<Row>("SELECT * FROM suggestions WHERE id = $1", [id]);
    return r && toSuggestion(r);
  }

  /** Open suggestions plus recent automatic ones (for undo), newest first. */
  async list(): Promise<Suggestion[]> {
    const since = new Date(this.now().getTime() - 2 * 86400_000).toISOString();
    const rows = await this.d.db.query<Row>(
      "SELECT * FROM suggestions WHERE status IN ('open', 'needs_confirmation') OR (status = 'auto' AND created_at >= $1) ORDER BY created_at DESC LIMIT 50",
      [since],
    );
    return rows.map(toSuggestion);
  }

  private async expireOld(): Promise<void> {
    await this.d.db.run("UPDATE suggestions SET status = 'expired' WHERE status = 'open' AND created_at < $1", [
      new Date(this.now().getTime() - EXPIRE_DAYS * 86400_000).toISOString(),
    ]);
  }

  /** Runs the prepared actions (the user saw them on the card) through the permission gate. */
  async accept(id: string, opts: { auto?: boolean } = {}): Promise<Suggestion> {
    const s = await this.get(id);
    if (!s) throw new Error("Vorschlag nicht gefunden");
    if (s.status !== "open") return s;
    const claimed = await this.d.db.run("UPDATE suggestions SET status = 'accepted' WHERE id = $1 AND status = 'open'", [id]);
    if (!claimed) return (await this.get(id))!;
    const conv = await this.d.agent.conversations.create(`💡 ${s.title}`.slice(0, 80), "suggestion");
    const results: string[] = [];
    let failed = false;
    let needsConfirmation = false;
    let undo: SuggestionAction | null = null;
    for (const a of s.actions) {
      const r = await this.d.agent.runApprovedAction(conv.id, a.tool, a.input, { tainted: !!s.warning, actor: opts.auto ? "automatisch (Vorschlag)" : "Vorschlag angenommen" });
      if (r.status === "awaiting_confirmation") needsConfirmation = true;
      if (r.status === "failed" || r.status === "denied") failed = true;
      results.push(`${r.status === "succeeded" ? "✓" : r.status === "awaiting_confirmation" ? "⏳" : "✗"} ${a.label}${r.error ? ` — ${r.error}` : ""}`);
      if (a.tool === "create_task" && r.status === "succeeded") undo = { tool: "delete_task", input: { task_id: (r.data as { id: string }).id }, label: "Aufgabe wieder löschen" };
      if (a.tool === "create_event" && r.status === "succeeded" && s.actions.length === 1) {
        const ev = (r.data as { created: { id: string; title?: string } }).created;
        undo = { tool: "delete_event", input: { event_id: ev.id, event_title: ev.title ?? "Termin", notify_attendees: false }, label: "Termin wieder löschen" };
      }
    }
    const status: SuggestionStatus = needsConfirmation ? "needs_confirmation" : failed ? "failed" : opts.auto ? "auto" : "accepted";
    await this.d.db.run("UPDATE suggestions SET status = $1, result = $2, conversation_id = $3, undo_json = $4, resolved_at = $5 WHERE id = $6", [
      status,
      results.join("\n"),
      conv.id,
      undo ? JSON.stringify(undo) : null,
      this.now().toISOString(),
      id,
    ]);
    if (!opts.auto) await this.feedback(s, "accepted");
    return (await this.get(id))!;
  }

  async ignore(id: string): Promise<Suggestion> {
    const s = await this.get(id);
    if (!s) throw new Error("Vorschlag nicht gefunden");
    if (s.status === "open" || s.status === "auto") {
      await this.d.db.run("UPDATE suggestions SET status = $1, resolved_at = $2 WHERE id = $3", [s.status === "auto" ? "accepted" : "ignored", this.now().toISOString(), id]);
      if (s.status === "open") await this.feedback(s, "ignored");
    }
    return (await this.get(id))!;
  }

  /** Reverts an automatically executed suggestion (e.g. deletes the created task). */
  async undo(id: string): Promise<Suggestion> {
    const r = await this.d.db.one<Row>("SELECT * FROM suggestions WHERE id = $1", [id]);
    if (!r?.undo_json || r.status !== "auto") throw new Error("Hier gibt es nichts rückgängig zu machen.");
    const u = JSON.parse(r.undo_json) as SuggestionAction;
    const res = await this.d.agent.runApprovedAction(r.conversation_id ?? (await this.d.agent.conversations.create("Rückgängig", "suggestion")).id, u.tool, u.input, { actor: "rückgängig" });
    if (res.status !== "succeeded") throw new Error(res.error ?? "Rückgängig fehlgeschlagen");
    await this.d.db.run("UPDATE suggestions SET status = 'undone', result = coalesce(result, '') || $1 WHERE id = $2", [`\n↩ ${u.label}`, id]);
    await this.feedback(toSuggestion(r), "ignored");
    return (await this.get(id))!;
  }

  /** Learns from ignored suggestions so JARVIS nags less (visible and reversible in settings + memory). */
  private async feedback(s: Suggestion, what: "accepted" | "ignored"): Promise<void> {
    const col = what === "accepted" ? "accepted" : "ignored";
    for (const sender of [s.sender ?? "", ""]) {
      await this.d.db.run(
        `INSERT INTO suggestion_feedback (kind, sender, accepted, ignored) VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, sender) DO UPDATE SET ${col} = suggestion_feedback.${col} + 1`,
        [s.kind, sender, what === "accepted" ? 1 : 0, what === "ignored" ? 1 : 0],
      );
    }
    if (what === "accepted") return;
    const settings = await this.settings();
    const fb = await this.d.db.query<{ sender: string; accepted: number; ignored: number }>("SELECT sender, accepted, ignored FROM suggestion_feedback WHERE kind = $1 AND sender IN ($2, '')", [
      s.kind,
      s.sender ?? "",
    ]);
    const bySender = fb.find((f) => f.sender === (s.sender ?? "") && f.sender !== "");
    const byKind = fb.find((f) => f.sender === "");
    if (bySender && bySender.ignored >= SENDER_MUTE_AFTER && bySender.accepted === 0) {
      const key = `${s.kind}:${s.sender}`;
      if (!settings.mutedSenders.includes(key)) await this.saveSettings({ mutedSenders: [...settings.mutedSenders, key] });
    }
    if (byKind && byKind.ignored >= KIND_MUTE_AFTER && byKind.accepted === 0 && !settings.mutedKinds.includes(s.kind)) {
      await this.saveSettings({ mutedKinds: [...(await this.settings()).mutedKinds, s.kind] });
      await this.d.memory.upsert({
        category: "rule",
        key: `Vorschläge: ${KIND_LABEL[s.kind]}`,
        value: `Werden meist ignoriert — JARVIS schlägt dazu nichts mehr vor (in Einstellungen → Proaktive Hinweise wieder einschaltbar).`,
        source: "inferred",
        confidence: 0.8,
      });
    }
  }

  async unmute(kind?: SuggestionKind, sender?: string): Promise<TriageSettings> {
    const s = await this.settings();
    if (kind && !sender) {
      await this.d.db.run("UPDATE suggestion_feedback SET ignored = 0 WHERE kind = $1", [kind]);
      await this.d.memory.list().then(async (all) => {
        const m = all.find((e) => e.category === "rule" && e.key === `Vorschläge: ${KIND_LABEL[kind]}`);
        if (m) await this.d.memory.delete(m.id);
      });
      return this.saveSettings({ mutedKinds: s.mutedKinds.filter((k) => k !== kind) });
    }
    return this.saveSettings({ mutedSenders: s.mutedSenders.filter((x) => x !== `${kind}:${sender}`) });
  }
}
