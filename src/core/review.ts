import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import type { ProviderHub } from "../providers/hub.js";
import { addDaysYmd, localDate, localWeekday, zonedToUtc } from "./time.js";
import { type UsageTotals, UsageStore } from "./usage.js";

/** Groups of successful actions shown in the weekly review. */
const GROUPS: Record<string, { label: string; tools: string[] }> = {
  emailsSent: { label: "E-Mails gesendet", tools: ["send_email", "reply_email", "forward_email"] },
  drafts: { label: "Entwürfe erstellt", tools: ["draft_email"] },
  emailsSorted: { label: "E-Mails sortiert/archiviert", tools: ["archive_email", "label_email", "mark_as_read", "mark_as_unread", "delete_email"] },
  eventsCreated: { label: "Termine angelegt", tools: ["create_event"] },
  eventsChanged: { label: "Termine geändert/abgesagt", tools: ["update_event", "delete_event", "invite_attendees", "respond_to_invitation"] },
  contacts: { label: "Kontakte gepflegt", tools: ["create_contact", "update_contact"] },
  reminders: { label: "Erinnerungen gestellt", tools: ["create_reminder"] },
  memory: { label: "Gemerkt", tools: ["remember"] },
};

export interface WeekReview {
  from: string;
  to: string;
  label: string;
  isCurrentWeek: boolean;
  actions: Array<{ key: string; label: string; count: number }>;
  highlights: Array<{ tool: string; description: string; at: string }>;
  tasks: { completed: Array<{ title: string; completedAt: string }>; created: number; openOverdue: number; dueNextWeek: Array<{ title: string; due: string }> };
  remindersFired: number;
  conversations: number;
  automationRuns: number;
  confirmations: { approved: number; rejected: number; expired: number };
  nextWeek: { events: Array<{ title: string; start: string; allDay: boolean }> | null; eventsError?: string };
  usage: UsageTotals;
}

/** Monday 00:00 (local) of the week `offset` weeks from now, as UTC instants. */
export function weekRange(now: Date, timeZone: string, offset = 0): { from: Date; to: Date; fromYmd: string } {
  const today = localDate(now, timeZone);
  const wd = localWeekday(now, timeZone);
  const monday = addDaysYmd(today, -((wd + 6) % 7) + offset * 7);
  return { from: zonedToUtc(monday, "00:00", timeZone), to: zonedToUtc(addDaysYmd(monday, 7), "00:00", timeZone), fromYmd: monday };
}

export async function buildWeekReview(deps: { db: Db; providers: ProviderHub; config: AppConfig }, offset = 0, now = new Date()): Promise<WeekReview> {
  const { db, providers, config } = deps;
  const tz = config.timezone;
  const { from, to, fromYmd } = weekRange(now, tz, offset);
  const f = from.toISOString();
  const t = to.toISOString();
  const fmt = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("de-DE", { day: "numeric", month: "long", timeZone: "UTC" });
  const label = `${fmt(fromYmd)} – ${fmt(addDaysYmd(fromYmd, 6))}`;

  const acts = await db.query<{ tool_name: string; description: string; created_at: string }>(
    "SELECT tool_name, description, created_at FROM activity WHERE status = 'succeeded' AND created_at >= $1 AND created_at < $2 ORDER BY seq",
    [f, t],
  );
  const actions = Object.entries(GROUPS)
    .map(([key, g]) => ({ key, label: g.label, count: acts.filter((a) => g.tools.includes(a.tool_name)).length }))
    .filter((a) => a.count > 0);
  const external = new Set([...GROUPS.emailsSent!.tools, ...GROUPS.eventsCreated!.tools, ...GROUPS.eventsChanged!.tools]);
  const highlights = acts
    .filter((a) => external.has(a.tool_name))
    .slice(-12)
    .map((a) => ({ tool: a.tool_name, description: a.description.split("\n")[0]!.slice(0, 160), at: a.created_at }));

  const completed = await db.query<{ title: string; completedAt: string }>(
    `SELECT title, completed_at AS "completedAt" FROM tasks WHERE status = 'done' AND completed_at >= $1 AND completed_at < $2 ORDER BY completed_at`,
    [f, t],
  );
  const one = async (sql: string, params: unknown[]) => Number((await db.one<{ n: string | number }>(sql, params))?.n ?? 0);
  const created = await one("SELECT count(*) AS n FROM tasks WHERE created_at >= $1 AND created_at < $2", [f, t]);
  const todayYmd = localDate(now, tz);
  const openOverdue = await one("SELECT count(*) AS n FROM tasks WHERE status = 'open' AND due IS NOT NULL AND substr(due, 1, 10) < $1", [todayYmd]);
  const next = weekRange(now, tz, offset + 1);
  const dueNextWeek = await db.query<{ title: string; due: string }>(
    "SELECT title, due FROM tasks WHERE status = 'open' AND due IS NOT NULL AND substr(due, 1, 10) >= $1 AND substr(due, 1, 10) < $2 ORDER BY due LIMIT 15",
    [next.fromYmd, addDaysYmd(next.fromYmd, 7)],
  );
  const remindersFired = await one("SELECT count(*) AS n FROM reminders WHERE status = 'fired' AND remind_at >= $1 AND remind_at < $2", [f, t]);
  const conversations = await one("SELECT count(*) AS n FROM conversations WHERE origin IS NULL AND created_at >= $1 AND created_at < $2", [f, t]);
  const automationRuns = await one("SELECT count(*) AS n FROM conversations WHERE origin = 'automation' AND created_at >= $1 AND created_at < $2", [f, t]);
  const conf = await db.query<{ status: string; n: string | number }>(
    "SELECT status, count(*) AS n FROM pending_actions WHERE resolved_at >= $1 AND resolved_at < $2 GROUP BY status",
    [f, t],
  );
  const c = (s: string) => Number(conf.find((r) => r.status === s)?.n ?? 0);

  let events: WeekReview["nextWeek"]["events"] = null;
  let eventsError: string | undefined;
  try {
    const list = await (await providers.calendar()).listEvents({ timeMin: next.from.toISOString(), timeMax: next.to.toISOString() });
    events = list.slice(0, 20).map((e) => ({ title: e.title, start: e.start, allDay: e.allDay }));
  } catch (err) {
    eventsError = (err as Error).message;
  }

  return {
    from: f,
    to: t,
    label,
    isCurrentWeek: offset === 0,
    actions,
    highlights,
    tasks: { completed, created, openOverdue, dueNextWeek },
    remindersFired,
    conversations,
    automationRuns,
    confirmations: { approved: c("approved") + c("executed"), rejected: c("rejected"), expired: c("expired") },
    nextWeek: { events, eventsError },
    usage: await new UsageStore(db).totals(f, t),
  };
}
