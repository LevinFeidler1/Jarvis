import type { AppConfig } from "../config.js";
import { type Db, nowIso } from "../db/database.js";
import { localDate } from "../core/time.js";
import type { ProviderHub } from "../providers/hub.js";
import { budgetStatus, usd } from "./budget.js";
import { formatEuro } from "./finance.js";
import { loadLifeSettings } from "./settings.js";
import type { Weather } from "./weather.js";

/**
 * Proactive push hints — things worth knowing before you ask:
 *  · an event with a place starts in 20–70 min (+ rain/frost from the forecast),
 *  · an invoice became overdue,
 *  · the monthly AI budget reached 80 % / 100 %.
 * Each hint is sent exactly once (proactive_sent). No LLM involved — free.
 */
export class ProactiveService {
  constructor(
    private readonly db: Db,
    private readonly providers: ProviderHub,
    private readonly config: Pick<AppConfig, "timezone">,
  ) {}

  /** Records the key; true only the first time (safe across parallel cron runs). */
  private async once(key: string): Promise<boolean> {
    return (await this.db.run("INSERT INTO proactive_sent (key, sent_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [key, nowIso()])) > 0;
  }

  private localHour(now: Date): number {
    // formatToParts: the de-DE string is "10 Uhr", not "10".
    const part = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: this.config.timezone }).formatToParts(now).find((p) => p.type === "hour");
    return Number(part?.value ?? 12);
  }

  async run(now = new Date()): Promise<number> {
    const life = await loadLifeSettings(this.db);
    if (!life.proactive) return 0;
    let sent = 0;
    sent += await this.leaveSoon(now, life.home ? () => this.providers.weather.forecast(life.home!, 2) : undefined).catch(() => 0);
    // Not at night: overdue invoices and budget can wait until morning.
    const hour = this.localHour(now);
    if (hour >= 8 && hour < 21) {
      sent += await this.overdueInvoices(now).catch(() => 0);
      sent += await this.budget(now).catch(() => 0);
    }
    // Housekeeping: forget sent keys after 60 days.
    await this.db.run("DELETE FROM proactive_sent WHERE sent_at < $1", [new Date(now.getTime() - 60 * 86_400_000).toISOString()]).catch(() => undefined);
    return sent;
  }

  private async leaveSoon(now: Date, forecast?: () => Promise<Weather>): Promise<number> {
    const calendar = await this.providers.calendar().catch(() => undefined);
    if (!calendar) return 0;
    const from = new Date(now.getTime() + 20 * 60_000), to = new Date(now.getTime() + 70 * 60_000);
    const events = await calendar.listEvents({ timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: 10 });
    let sent = 0;
    let weather: Weather | undefined | null = null;
    for (const e of events) {
      if (e.allDay || e.status === "cancelled" || !e.location?.trim()) continue;
      const start = new Date(e.start);
      if (start < from || start > to) continue;
      if (!(await this.once(`leave:${e.id}:${e.start}`))) continue;
      if (weather === null) weather = forecast ? await forecast().catch(() => undefined) : undefined;
      const mins = Math.round((start.getTime() - now.getTime()) / 60_000);
      const hint = weather ? weatherAt(weather, start) : undefined;
      const place = e.location.replace(/[\r\n]+/g, " ").slice(0, 120);
      await this.providers.notifications.notify(`🚶 ${e.title.slice(0, 80)} in ${mins} Min.`, `${place}${hint ? ` · ${hint}` : ""}`, { url: "/#calendar", tag: `leave-${e.id}` });
      sent++;
    }
    return sent;
  }

  private async overdueInvoices(now: Date): Promise<number> {
    const today = localDate(now, this.config.timezone);
    const open = await this.providers.finance.list({ status: "open", kind: "invoice" });
    let sent = 0;
    for (const i of open) {
      if (!i.dueDate || i.dueDate >= today) continue;
      if (!(await this.once(`overdue:${i.id}`))) continue;
      const amount = i.amountCents !== null ? ` über ${formatEuro(i.amountCents)}` : "";
      await this.providers.notifications.notify("💶 Rechnung überfällig", `${i.vendor}${amount} war am ${i.dueDate.split("-").reverse().join(".")} fällig.`, { url: "/#finance", tag: `overdue-${i.id}` });
      sent++;
    }
    return sent;
  }

  private async budget(now: Date): Promise<number> {
    const b = await budgetStatus(this.db, this.config.timezone, now);
    if (!b.budgetUsd) return 0;
    const month = b.monthStart.slice(0, 7);
    for (const [level, label] of [[1, "aufgebraucht"], [0.8, "zu 80 % verbraucht"]] as const) {
      if (b.ratio < level) continue;
      if (!(await this.once(`budget${level * 100}:${month}`))) return 0;
      const stop = level === 1 && b.hardStop ? " Neue KI-Anfragen sind bis Monatsende pausiert (Einstellungen → Kosten)." : "";
      await this.providers.notifications.notify(`💸 KI-Budget ${label}`, `${usd(b.spentUsd)} von ${usd(b.budgetUsd)} diesen Monat.${stop}`, { url: "/#settings", tag: "budget" });
      return 1;
    }
    return 0;
  }
}

const WET = new Set(["drizzle", "rain", "storm", "snow"]);

/** Short weather advice for the hour of an event. */
export function weatherAt(w: Weather, at: Date): string | undefined {
  const hour = w.hours.reduce((best, h) => (Math.abs(new Date(h.time).getTime() - at.getTime()) < Math.abs(new Date(best.time).getTime() - at.getTime()) ? h : best), w.hours[0]!);
  if (!hour || Math.abs(new Date(hour.time).getTime() - at.getTime()) > 2 * 3_600_000) return undefined;
  if (hour.icon === "snow") return `Schnee erwartet (${hour.temperature}°) — mehr Zeit einplanen.`;
  if (WET.has(hour.icon) || hour.precipitationProbability >= 55) return `Regen erwartet (${hour.precipitationProbability} %) — Schirm oder Bahn statt Rad.`;
  if (hour.temperature <= 0) return `Frostig (${hour.temperature}°) — warm anziehen.`;
  return undefined;
}
