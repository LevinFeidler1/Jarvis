import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import type { ProviderHub } from "../providers/hub.js";
import type { EmailSummary } from "../providers/types.js";
import type { AgentReply } from "./agent.js";
import { addDaysYmd, localDate, localWeekday, zonedToUtc } from "./time.js";

/** Days use ISO numbering: 1 = Monday … 7 = Sunday. */
export type AutomationTrigger =
  | { type: "schedule"; time: string; days: number[] }
  | { type: "email"; from?: string; subject?: string };

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "waiting" | "nothing" | "error" | null;
  lastResult: string | null;
  lastConversationId: string | null;
  runCount: number;
  createdAt: string;
}

export interface AutomationInput {
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
  enabled?: boolean;
}

interface Row {
  id: string;
  name: string;
  prompt: string;
  trigger_type: "schedule" | "email";
  schedule_time: string | null;
  schedule_days: string | null;
  email_from: string | null;
  email_subject: string | null;
  email_since: string | null;
  email_seen: string;
  enabled: boolean;
  next_run_at: string | null;
  running_since: string | null;
  last_run_at: string | null;
  last_status: Automation["lastStatus"];
  last_result: string | null;
  last_conversation_id: string | null;
  run_count: number;
  created_at: string;
}

const DAY_NAMES = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
/** E-mail triggers are checked at most this often. */
export const EMAIL_POLL_MINUTES = 5;
/** A run that has not finished after this long is considered crashed and may be claimed again. */
const STALE_RUN_MINUTES = 10;
const MAX_SEEN = 300;

export function describeTrigger(t: AutomationTrigger): string {
  if (t.type === "email") {
    const parts = [t.from ? `Absender enthält „${t.from}“` : null, t.subject ? `Betreff enthält „${t.subject}“` : null].filter(Boolean);
    return `Neue E-Mail${parts.length ? ` (${parts.join(", ")})` : ""}`;
  }
  const days = [...t.days].sort();
  const label =
    days.length === 7 ? "täglich" : days.join() === "1,2,3,4,5" ? "Mo–Fr" : days.join() === "6,7" ? "Sa+So" : days.map((d) => DAY_NAMES[d]).join(", ");
  return `${label} um ${t.time} Uhr`;
}

/** Next local occurrence of a schedule strictly after `after`. */
export function nextScheduledRun(t: Extract<AutomationTrigger, { type: "schedule" }>, after: Date, timeZone: string): Date | null {
  if (!t.days.length) return null;
  const today = localDate(after, timeZone);
  for (let i = 0; i <= 7; i++) {
    const ymd = addDaysYmd(today, i);
    const at = zonedToUtc(ymd, t.time, timeZone);
    const wd = localWeekday(at, timeZone);
    const iso = wd === 0 ? 7 : wd;
    if (t.days.includes(iso) && at.getTime() > after.getTime()) return at;
  }
  return null;
}

function toAutomation(r: Row): Automation {
  const trigger: AutomationTrigger =
    r.trigger_type === "email"
      ? { type: "email", from: r.email_from ?? undefined, subject: r.email_subject ?? undefined }
      : { type: "schedule", time: r.schedule_time ?? "08:00", days: (r.schedule_days ?? "").split(",").filter(Boolean).map(Number) };
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    trigger,
    enabled: r.enabled,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastResult: r.last_result,
    lastConversationId: r.last_conversation_id,
    runCount: r.run_count,
    createdAt: r.created_at,
  };
}

/** Persistent automations; claiming a run is atomic so parallel ticks never run one twice. */
export class AutomationStore {
  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
  ) {}

  private nextRun(trigger: AutomationTrigger, now: Date): string | null {
    if (trigger.type === "email") return now.toISOString();
    return nextScheduledRun(trigger, now, this.timeZone)?.toISOString() ?? null;
  }

  async list(): Promise<Automation[]> {
    return (await this.db.query<Row>("SELECT * FROM automations ORDER BY created_at")).map(toAutomation);
  }

  async get(id: string): Promise<Automation | undefined> {
    const r = await this.db.one<Row>("SELECT * FROM automations WHERE id = $1", [id]);
    return r && toAutomation(r);
  }

  async create(input: AutomationInput, now = new Date()): Promise<Automation> {
    const id = randomUUID();
    const t = input.trigger;
    const enabled = input.enabled ?? true;
    await this.db.run(
      `INSERT INTO automations (id, name, prompt, trigger_type, schedule_time, schedule_days, email_from, email_subject, email_since,
         enabled, next_run_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        id,
        input.name,
        input.prompt,
        t.type,
        t.type === "schedule" ? t.time : null,
        t.type === "schedule" ? [...new Set(t.days)].sort().join(",") : null,
        t.type === "email" ? t.from ?? null : null,
        t.type === "email" ? t.subject ?? null : null,
        // E-mail triggers only react to mail that arrives after they were created.
        t.type === "email" ? now.toISOString() : null,
        enabled,
        enabled ? this.nextRun(t, now) : null,
        nowIso(),
      ],
    );
    return (await this.get(id))!;
  }

  async update(id: string, input: Partial<AutomationInput>, now = new Date()): Promise<Automation | undefined> {
    const cur = await this.get(id);
    if (!cur) return undefined;
    const next = { name: input.name ?? cur.name, prompt: input.prompt ?? cur.prompt, trigger: input.trigger ?? cur.trigger, enabled: input.enabled ?? cur.enabled };
    const t = next.trigger;
    const triggerChanged = JSON.stringify(t) !== JSON.stringify(cur.trigger);
    const reactivated = next.enabled && !cur.enabled;
    await this.db.run(
      `UPDATE automations SET name = $1, prompt = $2, trigger_type = $3, schedule_time = $4, schedule_days = $5, email_from = $6,
         email_subject = $7, enabled = $8, next_run_at = $9, updated_at = $10,
         email_since = CASE WHEN $11 THEN $12 ELSE email_since END
       WHERE id = $13`,
      [
        next.name,
        next.prompt,
        t.type,
        t.type === "schedule" ? t.time : null,
        t.type === "schedule" ? [...new Set(t.days)].sort().join(",") : null,
        t.type === "email" ? t.from ?? null : null,
        t.type === "email" ? t.subject ?? null : null,
        next.enabled,
        next.enabled ? this.nextRun(t, now) : null,
        nowIso(),
        t.type === "email" && (triggerChanged || reactivated),
        now.toISOString(),
        id,
      ],
    );
    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM automations WHERE id = $1", [id])) > 0;
  }

  /** Atomically claims due automations and moves their next run forward. */
  async claimDue(now: Date, limit = 5): Promise<Array<Automation & { emailSince: string | null; emailSeen: string[] }>> {
    const staleBefore = new Date(now.getTime() - STALE_RUN_MINUTES * 60_000).toISOString();
    const due = await this.db.query<Row>(
      `SELECT * FROM automations WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= $1
         AND (running_since IS NULL OR running_since < $2) ORDER BY next_run_at LIMIT $3`,
      [now.toISOString(), staleBefore, limit],
    );
    const claimed = [];
    for (const r of due) {
      const a = toAutomation(r);
      const next =
        a.trigger.type === "email"
          ? new Date(now.getTime() + EMAIL_POLL_MINUTES * 60_000).toISOString()
          : (nextScheduledRun(a.trigger, now, this.timeZone)?.toISOString() ?? null);
      const n = await this.db.run(
        "UPDATE automations SET next_run_at = $1, running_since = $2 WHERE id = $3 AND next_run_at = $4 AND (running_since IS NULL OR running_since < $5)",
        [next, now.toISOString(), r.id, r.next_run_at, staleBefore],
      );
      if (n === 1) claimed.push({ ...a, emailSince: r.email_since, emailSeen: JSON.parse(r.email_seen) as string[] });
    }
    return claimed;
  }

  async finish(
    id: string,
    result: { status: NonNullable<Automation["lastStatus"]>; text: string; conversationId?: string; countRun?: boolean },
    now = new Date(),
  ): Promise<void> {
    await this.db.run(
      `UPDATE automations SET running_since = NULL, last_run_at = $1, last_status = $2, last_result = $3,
         last_conversation_id = COALESCE($4, last_conversation_id), run_count = run_count + $5 WHERE id = $6`,
      [now.toISOString(), result.status, result.text.slice(0, 2000), result.conversationId ?? null, result.countRun === false ? 0 : 1, id],
    );
  }

  async release(id: string): Promise<void> {
    await this.db.run("UPDATE automations SET running_since = NULL WHERE id = $1", [id]);
  }

  async markSeen(id: string, seen: string[]): Promise<void> {
    await this.db.run("UPDATE automations SET email_seen = $1 WHERE id = $2", [JSON.stringify(seen.slice(-MAX_SEEN)), id]);
  }
}

export interface AutomationAgent {
  handleUserMessage(
    conversationId: string | undefined,
    text: string,
    emit?: undefined,
    opts?: { automation?: { name: string; trigger: string } },
  ): Promise<AgentReply>;
}

/** Splits the agent's reply into a push title (first line) and body. */
export function toPush(name: string, reply: AgentReply): { title: string; body: string } {
  const clean = (s: string) => s.replace(/[*_`#>]/g, "").replace(/^\s*[-•]\s+/gm, "• ").trim();
  const lines = clean(reply.text).split("\n").map((l) => l.trim()).filter(Boolean);
  const title = (lines[0] ?? name).slice(0, 80);
  let body = lines.slice(1).join("\n");
  if (reply.pendingActions.length) {
    body = `${body}\n🔔 ${reply.pendingActions.length === 1 ? "Eine Aktion wartet" : `${reply.pendingActions.length} Aktionen warten`} auf deine Bestätigung.`.trim();
  }
  return { title: `⚡ ${title}`, body };
}

const matches = (hay: string | undefined, needle: string | undefined) => !needle || (hay ?? "").toLowerCase().includes(needle.toLowerCase());

/** Runs due automations through the normal agent (same permission gate, same audit trail). */
export class AutomationRunner {
  constructor(
    private readonly store: AutomationStore,
    private readonly agent: AutomationAgent,
    private readonly providers: ProviderHub,
  ) {}

  /** Runs everything that is due; stops starting new runs after `budgetMs`. */
  async runDue(now = new Date(), budgetMs = 200_000): Promise<number> {
    const started = Date.now();
    let runs = 0;
    for (const a of await this.store.claimDue(now)) {
      if (Date.now() - started > budgetMs) {
        await this.store.release(a.id);
        continue;
      }
      runs += a.trigger.type === "email" ? await this.runEmail(a, now) : (await this.execute(a, a.prompt), 1);
    }
    return runs;
  }

  /** "Jetzt ausführen" from the UI. E-mail automations run once on the latest matching mail. */
  async runNow(id: string): Promise<{ status: string; text: string; conversationId?: string }> {
    const a = await this.store.get(id);
    if (!a) throw new Error("Automation nicht gefunden");
    if (a.trigger.type === "email") {
      const mails = await this.matchingEmails(a, null, []);
      if (!mails.length) {
        await this.store.finish(a.id, { status: "nothing", text: "Keine passende E-Mail gefunden.", countRun: false });
        return { status: "nothing", text: "Keine passende E-Mail gefunden." };
      }
      return this.execute(a, this.emailPrompt(a, mails[0]!));
    }
    return this.execute(a, a.prompt);
  }

  private emailPrompt(a: Automation, m: EmailSummary): string {
    return (
      `${a.prompt}\n\nAuslösende E-Mail: ID ${m.id} · von ${m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email} · ` +
      `Betreff „${m.subject}“ · ${m.date}${m.account ? ` · Postfach ${m.account}` : ""}. Lies sie bei Bedarf mit read_email.`
    );
  }

  private async matchingEmails(a: Automation, since: string | null, seen: string[]): Promise<EmailSummary[]> {
    if (a.trigger.type !== "email") return [];
    const t = a.trigger;
    const list = await (await this.providers.email()).listEmails({ newerThanDays: 2, maxResults: 25, inboxOnly: true });
    return list
      .filter((m) => (!since || m.date >= since) && !seen.includes(m.id))
      .filter((m) => matches(`${m.from.name ?? ""} ${m.from.email}`, t.from) && matches(m.subject, t.subject))
      .sort((x, y) => x.date.localeCompare(y.date));
  }

  private async runEmail(a: Automation & { emailSince: string | null; emailSeen: string[] }, now: Date): Promise<number> {
    let mails: EmailSummary[];
    try {
      mails = await this.matchingEmails(a, a.emailSince, a.emailSeen);
    } catch (err) {
      await this.store.finish(a.id, { status: "error", text: `E-Mails konnten nicht geprüft werden: ${(err as Error).message}`, countRun: false }, now);
      return 0;
    }
    if (!mails.length) {
      await this.store.release(a.id);
      return 0;
    }
    const batch = mails.slice(0, 3); // the rest follows on the next tick
    await this.store.markSeen(a.id, [...a.emailSeen, ...batch.map((m) => m.id)]);
    for (const m of batch) await this.execute(a, this.emailPrompt(a, m));
    return batch.length;
  }

  private async execute(a: Automation, prompt: string): Promise<{ status: string; text: string; conversationId?: string }> {
    try {
      const reply = await this.agent.handleUserMessage(undefined, prompt, undefined, {
        automation: { name: a.name, trigger: describeTrigger(a.trigger) },
      });
      const nothing = /^\s*nichts neues\.?\s*$/i.test(reply.text) && reply.pendingActions.length === 0;
      const status = reply.pendingActions.length ? "waiting" : nothing ? "nothing" : "ok";
      await this.store.finish(a.id, { status, text: reply.text, conversationId: reply.conversationId });
      if (!nothing) {
        const { title, body } = toPush(a.name, reply);
        await this.providers.notifications.notify(title, body, { url: `/#chat?c=${reply.conversationId}`, tag: `automation-${a.id}` });
      }
      return { status, text: reply.text, conversationId: reply.conversationId };
    } catch (err) {
      const text = `Fehlgeschlagen: ${(err as Error).message}`;
      await this.store.finish(a.id, { status: "error", text });
      await this.providers.notifications.notify(`⚠️ Automation „${a.name}“ fehlgeschlagen`, (err as Error).message, { url: "/#automations" });
      return { status: "error", text };
    }
  }
}

/** Ready-made automations offered in the UI (the user can edit everything before saving). */
export const AUTOMATION_TEMPLATES: Array<AutomationInput & { id: string; description: string }> = [
  {
    id: "morning",
    name: "Morgen-Briefing",
    description: "Jeden Werktag um 7 Uhr: Termine, wichtige Mails, fällige Aufgaben.",
    trigger: { type: "schedule", time: "07:00", days: [1, 2, 3, 4, 5] },
    prompt:
      "Erstelle mein Morgen-Briefing für heute: Termine (mit Konflikten und freien Blöcken), wichtige ungelesene E-Mails " +
      "und welche eine Antwort brauchen, heute fällige oder überfällige Aufgaben und Erinnerungen. Kurz und priorisiert.",
  },
  {
    id: "inbox-noon",
    name: "Posteingang-Check",
    description: "Werktags um 12 Uhr: nur melden, was wirklich wichtig ist.",
    trigger: { type: "schedule", time: "12:00", days: [1, 2, 3, 4, 5] },
    prompt:
      "Prüfe die E-Mails, die seit heute Morgen eingegangen sind. Melde nur, was wirklich wichtig ist oder eine Antwort von mir braucht " +
      "(mit Absender und Anliegen). Newsletter und Werbung ignorieren. Gibt es nichts Wichtiges, antworte nur „Nichts Neues.“",
  },
  {
    id: "invoices",
    name: "Rechnungen → Aufgaben",
    description: "Neue E-Mail mit „Rechnung“ im Betreff wird zur Aufgabe.",
    trigger: { type: "email", subject: "Rechnung" },
    prompt:
      "Lies die auslösende E-Mail. Wenn es wirklich eine Rechnung an mich ist: lege eine Aufgabe „Rechnung <Absender> bezahlen (<Betrag>)“ an, " +
      "fällig am Zahlungsziel (falls genannt, sonst in 7 Tagen), Priorität hoch bei Mahnungen. Keine E-Mails senden, nichts bezahlen. " +
      "Ist es keine Rechnung, antworte nur „Nichts Neues.“",
  },
  {
    id: "meeting-prep",
    name: "Wichtige Termine vorbereiten",
    description: "Täglich 18 Uhr: an Termine der nächsten 3 Tage erinnern.",
    trigger: { type: "schedule", time: "18:00", days: [1, 2, 3, 4, 5, 6, 7] },
    prompt:
      "Prüfe meine Termine der nächsten 3 Tage. Für wichtige Termine (externe Teilnehmer, Kunden, Arzt, Behörden) stelle mit create_reminder " +
      "eine Erinnerung am Vortag um 09:00 — prüfe vorher mit list_reminders, dass es dafür noch keine gibt. Nenne kurz, was du eingerichtet hast. " +
      "Gibt es nichts Neues, antworte nur „Nichts Neues.“",
  },
  {
    id: "week-start",
    name: "Wochenstart",
    description: "Montag 7:30: Was steht diese Woche an?",
    trigger: { type: "schedule", time: "07:30", days: [1] },
    prompt:
      "Was steht diese Woche an? Termine, Deadlines und offene Aufgaben. Schlag mir die 3 wichtigsten Prioritäten für die Woche vor.",
  },
  {
    id: "week-review",
    name: "Wochenrückblick",
    description: "Freitag 17 Uhr: Was wurde erledigt, was ist offen, was kommt?",
    trigger: { type: "schedule", time: "17:00", days: [5] },
    prompt:
      "Erstelle meinen Wochenrückblick mit get_week_review: Was wurde diese Woche erledigt, was ist offen geblieben, was steht nächste Woche an, " +
      "und was hat JARVIS diese Woche ungefähr gekostet. Schließe mit den 3 wichtigsten Punkten für nächste Woche.",
  },
];
