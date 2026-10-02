import { randomUUID } from "node:crypto";
import { type Db, nowIso } from "../db/database.js";
import { addDaysYmd, localDate, zonedToUtc } from "../core/time.js";
import { ToolError } from "../core/types.js";
import type { EmailProvider, EmailSummary } from "../providers/types.js";
import type { ReminderStore } from "../providers/local/local.js";

/**
 * Finance overview: invoices and subscriptions recognised in e-mails (subject +
 * preview, plain pattern matching — no LLM, no cost) or added by hand.
 * Mail text is untrusted: only amount, date and sender name are extracted.
 */

export type FinanceKind = "invoice" | "subscription";
export type FinanceStatus = "open" | "paid" | "autopay" | "ignored";
export type FinanceInterval = "weekly" | "monthly" | "quarterly" | "yearly";

export interface FinanceItem {
  id: string;
  kind: FinanceKind;
  vendor: string;
  title: string;
  amountCents: number | null;
  currency: string;
  dueDate: string | null;
  interval: FinanceInterval | null;
  status: FinanceStatus;
  source: "mail" | "manual";
  emailId: string | null;
  account: string | null;
  createdAt: string;
}

const COLS = `id, kind, vendor, title, amount_cents AS "amountCents", currency, due_date AS "dueDate", interval, status, source,
  email_id AS "emailId", account, created_at AS "createdAt"`;

// ─── Extraction ─────────────────────────────────────────────────────────────

const AMOUNT_RE = /(?:(?:EUR|€)\s?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d+(?:[.,]\d{2})?))|(?:(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+(?:[.,]\d{2})?)\s?(?:€|EUR|Euro\b))/gi;
const INVOICE_RE = /\b(rechnung|invoice|zahlungserinnerung|mahnung|beleg|quittung|receipt|lastschrift|abbuchung|zahlung|payment|betrag|fällig|kontoauszug|gutschrift)\b/i;
const SUBSCRIPTION_RE = /\b(abo|abonnement|mitgliedschaft|membership|subscription|monatlich|jährlich|monthly|yearly|annual|verlängert|renews?|renewal|tarif|vertrag|premium|plus)\b/i;
const PAID_RE = /\b(zahlung erhalten|zahlungsbestätigung|payment received|payment confirmation|bezahlt|paid|vielen dank für (ihre|deine) zahlung|thank you for your payment|beleg|quittung|receipt)\b/i;
const AUTOPAY_RE = /\b(wird .{0,30}(abgebucht|eingezogen)|lastschrift|sepa|automatisch abgebucht|will be charged|auto-?renew)\b/i;
const NOISE_RE = /\b(newsletter|angebot|rabatt|gutschein|sale|% ?off|deal|gewinnspiel)\b/i;

/** "1.249,99" / "1249.99" / "49" → cents. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{2}$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/[.,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) : null;
}

function pickAmount(text: string): number | null {
  const matches = [...text.matchAll(AMOUNT_RE)];
  if (!matches.length) return null;
  // Prefer the amount right after "Betrag/Summe/Gesamt/Total/zu zahlen".
  const keyed = matches.find((m) => /(betrag|summe|gesamt|total|zu zahlen|amount|endbetrag)[^0-9€]{0,25}$/i.test(text.slice(Math.max(0, m.index! - 40), m.index)));
  const m = keyed ?? matches[0]!;
  return parseAmount(m[1] ?? m[2] ?? "");
}

const DATE_RE = /(?:fällig(?:keit)?|zahlbar|bis zum|bis|due|spätestens|abbuchung am|einzug am|wird am)\D{0,12}(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/i;

/** Due date ("fällig am 14.10.", "zahlbar bis 14.10.2026") → YYYY-MM-DD. */
export function parseDueDate(text: string, reference: Date): string | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : reference.getFullYear();
  if (!m[3] && new Date(year, month - 1, day) < new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - 31)) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function intervalOf(text: string): FinanceInterval | null {
  if (/\b(jährlich|yearly|annual|pro jahr|jahresabo|\/ ?jahr)\b/i.test(text)) return "yearly";
  if (/\b(vierteljährlich|quartal|quarterly)\b/i.test(text)) return "quarterly";
  if (/\b(wöchentlich|weekly)\b/i.test(text)) return "weekly";
  if (/\b(monatlich|monthly|pro monat|\/ ?monat|mtl\.?)\b/i.test(text)) return "monthly";
  return null;
}

export function vendorOf(from: { name?: string | null; email: string }): string {
  const name = (from.name ?? "")
    .replace(/["'<>]/g, "")
    .replace(/\b(no-?reply|noreply|rechnung(en)?|billing|invoice(s)?|kundenservice|service|team|buchhaltung|via .*)$/i, "")
    .replace(/[\s,–-]+$/, "")
    .trim();
  if (name.length >= 2) return name.slice(0, 60);
  const domain = from.email.split("@")[1]?.split(".").slice(-2, -1)[0] ?? from.email;
  return domain.charAt(0).toUpperCase() + domain.slice(1, 60);
}

export interface Extracted {
  kind: FinanceKind;
  vendor: string;
  title: string;
  amountCents: number | null;
  dueDate: string | null;
  interval: FinanceInterval | null;
  status: FinanceStatus;
}

/** Recognises an invoice / subscription mail; undefined for anything else. */
export function extractFinance(mail: Pick<EmailSummary, "subject" | "snippet" | "from" | "date">): Extracted | undefined {
  const text = `${mail.subject ?? ""} ${mail.snippet ?? ""}`;
  const invoice = INVOICE_RE.test(text);
  const subscription = SUBSCRIPTION_RE.test(text);
  if (!invoice && !subscription) return undefined;
  if (NOISE_RE.test(text) && !/\b(rechnung|invoice|mahnung)\b/i.test(text)) return undefined;
  const amountCents = pickAmount(text);
  if (amountCents === null && !/\b(rechnung|invoice|mahnung)\b/i.test(mail.subject ?? "")) return undefined;
  const interval = intervalOf(text);
  const kind: FinanceKind = interval || (subscription && !/\b(rechnung|invoice|mahnung)\b/i.test(mail.subject ?? "")) ? "subscription" : "invoice";
  const status: FinanceStatus = PAID_RE.test(text) ? "paid" : AUTOPAY_RE.test(text) ? "autopay" : "open";
  return {
    kind,
    vendor: vendorOf(mail.from),
    title: (mail.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 160) || "Rechnung",
    amountCents,
    dueDate: parseDueDate(text, new Date(mail.date)),
    interval: kind === "subscription" ? interval ?? "monthly" : null,
    status,
  };
}

// ─── Store + overview ───────────────────────────────────────────────────────

const MONTHLY_FACTOR: Record<FinanceInterval, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const SCAN_QUERIES = ["Rechnung", "Invoice", "Zahlung", "Abo", "Beleg", "Mahnung"];

export interface FinanceOverview {
  openCount: number;
  openTotalCents: number;
  overdue: FinanceItem[];
  dueSoon: FinanceItem[];
  open: FinanceItem[];
  subscriptions: Array<{ vendor: string; amountCents: number | null; interval: FinanceInterval; monthlyCents: number | null; id: string }>;
  subscriptionsMonthlyCents: number;
  thisMonthCents: number;
  lastScanAt: string | null;
}

export class FinanceStore {
  constructor(
    private readonly db: Db,
    private readonly opts: { timezone: string; reminders?: ReminderStore },
  ) {}

  async list(filter: { status?: FinanceStatus | "all"; kind?: FinanceKind } = {}): Promise<FinanceItem[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status && filter.status !== "all") { params.push(filter.status); where.push(`status = $${params.length}`); }
    else where.push("status <> 'ignored'");
    if (filter.kind) { params.push(filter.kind); where.push(`kind = $${params.length}`); }
    return this.db.query<FinanceItem>(`SELECT ${COLS} FROM finance_items WHERE ${where.join(" AND ")} ORDER BY (due_date IS NULL), due_date, created_at DESC LIMIT 200`, params);
  }

  async get(id: string): Promise<FinanceItem | undefined> {
    return this.db.one<FinanceItem>(`SELECT ${COLS} FROM finance_items WHERE id = $1`, [id]);
  }

  async add(input: { kind: FinanceKind; vendor: string; title?: string; amountCents?: number | null; dueDate?: string | null; interval?: FinanceInterval | null; status?: FinanceStatus; source?: "mail" | "manual"; emailId?: string; account?: string; createdAt?: string }): Promise<FinanceItem> {
    const id = randomUUID();
    const now = nowIso();
    const inserted = await this.db.run(
      `INSERT INTO finance_items (id, kind, vendor, title, amount_cents, currency, due_date, interval, status, source, email_id, account, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'EUR', $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (email_id) DO NOTHING`,
      [id, input.kind, input.vendor.slice(0, 80), (input.title ?? input.vendor).slice(0, 160), input.amountCents ?? null, input.dueDate ?? null,
        input.kind === "subscription" ? input.interval ?? "monthly" : null, input.status ?? (input.kind === "subscription" ? "autopay" : "open"),
        input.source ?? "manual", input.emailId ?? null, input.account ?? null, input.createdAt ?? now, now],
    );
    const item = inserted ? (await this.get(id))! : (await this.db.one<FinanceItem>(`SELECT ${COLS} FROM finance_items WHERE email_id = $1`, [input.emailId]))!;
    if (inserted) await this.scheduleReminder(item);
    return item;
  }

  async setStatus(id: string, status: FinanceStatus): Promise<FinanceItem> {
    const n = await this.db.run("UPDATE finance_items SET status = $2, updated_at = $3 WHERE id = $1", [id, status, nowIso()]);
    if (!n) throw new ToolError("Eintrag nicht gefunden.", "NOT_FOUND");
    const item = (await this.get(id))!;
    if (status !== "open") await this.cancelReminder(id);
    return item;
  }

  async remove(id: string): Promise<boolean> {
    await this.cancelReminder(id);
    return (await this.db.run("DELETE FROM finance_items WHERE id = $1", [id])) > 0;
  }

  /** Reminder at 09:00 two days before an open invoice is due (once). */
  private async scheduleReminder(item: FinanceItem): Promise<void> {
    if (!this.opts.reminders || item.status !== "open" || !item.dueDate) return;
    const at = zonedToUtc(addDaysYmd(item.dueDate, -2), "09:00", this.opts.timezone);
    if (at.getTime() <= Date.now()) return;
    const amount = item.amountCents !== null ? ` (${formatEuro(item.amountCents)})` : "";
    const r = await this.opts.reminders.create(`Rechnung ${item.vendor}${amount} ist am ${item.dueDate.split("-").reverse().join(".")} fällig.`, at.toISOString());
    await this.db.run("UPDATE finance_items SET reminder_id = $2 WHERE id = $1", [item.id, r.id]);
  }

  private async cancelReminder(id: string): Promise<void> {
    const row = await this.db.one<{ reminder_id: string | null }>("SELECT reminder_id FROM finance_items WHERE id = $1", [id]);
    if (row?.reminder_id && this.opts.reminders) await this.opts.reminders.cancel(row.reminder_id).catch(() => undefined);
  }

  /** Looks through recent mails (last `days`) and records recognised invoices/subscriptions once per mail. */
  async scanMailbox(email: EmailProvider, days = 90): Promise<{ scanned: number; added: number; items: FinanceItem[] }> {
    const seen = new Map<string, EmailSummary>();
    for (const q of SCAN_QUERIES) {
      const found = await email.listEmails({ text: q, newerThanDays: days, maxResults: 25 }).catch(() => [] as EmailSummary[]);
      for (const m of found) seen.set(m.id, m);
    }
    const known = new Set((await this.db.query<{ email_id: string }>("SELECT email_id FROM finance_items WHERE email_id IS NOT NULL")).map((r) => r.email_id));
    const added: FinanceItem[] = [];
    for (const m of seen.values()) {
      if (known.has(m.id)) continue;
      const x = extractFinance(m);
      if (!x) continue;
      added.push(await this.add({ ...x, source: "mail", emailId: m.id, account: m.account, createdAt: new Date(m.date).toISOString() }));
    }
    await this.db.run(
      "INSERT INTO settings (key, value_json) VALUES ('finance_scan', $1) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
      [JSON.stringify({ at: nowIso() })],
    );
    return { scanned: seen.size, added: added.length, items: added };
  }

  async overview(now = new Date()): Promise<FinanceOverview> {
    const items = await this.list();
    const today = localDate(now, this.opts.timezone);
    const in7 = addDaysYmd(today, 7);
    const open = items.filter((i) => i.kind === "invoice" && i.status === "open");
    const subsByVendor = new Map<string, FinanceItem>();
    for (const s of items.filter((i) => i.kind === "subscription" && i.status !== "ignored")) {
      const key = s.vendor.toLowerCase();
      const prev = subsByVendor.get(key);
      if (!prev || s.createdAt > prev.createdAt) subsByVendor.set(key, s);
    }
    const subscriptions = [...subsByVendor.values()].map((s) => {
      const interval = s.interval ?? "monthly";
      return { id: s.id, vendor: s.vendor, amountCents: s.amountCents, interval, monthlyCents: s.amountCents === null ? null : Math.round(s.amountCents * MONTHLY_FACTOR[interval]) };
    });
    const month = today.slice(0, 7);
    const thisMonthCents = items
      .filter((i) => i.kind === "invoice" && i.status !== "ignored" && (i.dueDate ?? localDate(new Date(i.createdAt), this.opts.timezone)).startsWith(month))
      .reduce((a, i) => a + (i.amountCents ?? 0), 0);
    const scan = await this.db.one<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'finance_scan'");
    return {
      openCount: open.length,
      openTotalCents: open.reduce((a, i) => a + (i.amountCents ?? 0), 0),
      overdue: open.filter((i) => i.dueDate && i.dueDate < today),
      dueSoon: open.filter((i) => i.dueDate && i.dueDate >= today && i.dueDate <= in7),
      open,
      subscriptions,
      subscriptionsMonthlyCents: subscriptions.reduce((a, s) => a + (s.monthlyCents ?? 0), 0),
      thisMonthCents,
      lastScanAt: scan ? (JSON.parse(scan.value_json) as { at: string }).at : null,
    };
  }
}

export const formatEuro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
