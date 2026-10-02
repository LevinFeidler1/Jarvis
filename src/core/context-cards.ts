/**
 * Context cards: the things a reply talks about (events, mails, tasks, …),
 * collected from this turn's tool results. The voice UI shows the matching
 * card the moment JARVIS says a sentence that mentions it.
 *
 * Only display fields are copied — never mail bodies or file contents — and
 * every string is length-limited. Detection is by shape, so new tools that
 * return the same provider types get cards for free.
 */

export type ContextKind = "event" | "mail" | "task" | "contact" | "file" | "finance";

export interface ContextItem {
  kind: ContextKind;
  id: string;
  title: string;
  /** Words that, when spoken, bring this card up (lower case). */
  terms: string[];
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  attendees?: string[];
  from?: string;
  fromEmail?: string;
  date?: string;
  snippet?: string;
  due?: string | null;
  priority?: string;
  status?: string;
  emails?: string[];
  phones?: string[];
  organization?: string;
  format?: string;
  size?: number;
  amount?: string;
}

const MAX_ITEMS = 12;
const STOP = new Set(["und", "der", "die", "das", "mit", "von", "für", "zum", "zur", "den", "dem", "des", "ein", "eine", "re", "aw", "fwd", "wg", "the", "and"]);

const str = (v: unknown, max = 160): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Distinctive words of a title or name (≥ 4 letters, no stop words). */
export function termsOf(...texts: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    const words = t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/);
    for (const w of words) if (w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return [...out].slice(0, 8);
}

const AMOUNT = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s?(?:€|EUR|Euro)/i;

function classify(o: Record<string, unknown>): ContextItem | undefined {
  const id = str(o.id, 200);
  if (!id) return undefined;
  if (str(o.title) && str(o.start) && str(o.end) && Array.isArray(o.attendees)) {
    const attendees = (o.attendees as unknown[]).map((a) => (isObj(a) ? str(a.name, 60) ?? str(a.email, 80) : undefined)).filter((x): x is string => !!x).slice(0, 6);
    return {
      kind: "event", id, title: str(o.title)!, start: str(o.start), end: str(o.end), allDay: o.allDay === true,
      location: str(o.location, 120), attendees,
      terms: termsOf(str(o.title), ...attendees.map((a) => a.split(/[\s@]/)[0])),
    };
  }
  if (isObj(o.from) && str(o.subject) !== undefined && str(o.date)) {
    const from = str((o.from as Record<string, unknown>).name, 80) ?? str((o.from as Record<string, unknown>).email, 120) ?? "";
    const subject = str(o.subject) ?? "(ohne Betreff)";
    const snippet = str(o.snippet, 220);
    const amount = `${subject} ${snippet ?? ""}`.match(AMOUNT)?.[0];
    return {
      kind: amount && /rechnung|zahlung|betrag|invoice|mahnung|fällig/i.test(`${subject} ${snippet ?? ""}`) ? "finance" : "mail",
      id, title: subject, from, fromEmail: str((o.from as Record<string, unknown>).email, 120), date: str(o.date), snippet, amount,
      terms: termsOf(subject, from.split(/[\s@]/)[0], from.split(/\s/)[1]),
    };
  }
  if (str(o.title) && typeof o.status === "string" && typeof o.priority === "string") {
    return { kind: "task", id, title: str(o.title)!, due: str(o.due) ?? null, priority: str(o.priority), status: str(o.status), terms: termsOf(str(o.title)) };
  }
  if (str(o.name) && Array.isArray(o.emails) && Array.isArray(o.phones)) {
    const name = str(o.name)!;
    return {
      kind: "contact", id, title: name, emails: (o.emails as unknown[]).filter((e): e is string => typeof e === "string").slice(0, 3),
      phones: (o.phones as unknown[]).filter((p): p is string => typeof p === "string").slice(0, 2), organization: str(o.organization, 80),
      terms: termsOf(name),
    };
  }
  if (str(o.name) && str(o.format, 20) && typeof o.size === "number") {
    return { kind: "file", id, title: str(o.name)!, format: str(o.format, 20), size: o.size as number, terms: termsOf(str(o.name)?.replace(/\.[a-z0-9]+$/i, "")) };
  }
  return undefined;
}

/** Finds displayable items anywhere in a tool result (depth-limited). */
export function extractContext(data: unknown, depth = 0, out: ContextItem[] = []): ContextItem[] {
  if (depth > 3 || out.length >= MAX_ITEMS || data == null) return out;
  if (Array.isArray(data)) {
    for (const v of data.slice(0, 30)) extractContext(v, depth + 1, out);
    return out;
  }
  if (!isObj(data)) return out;
  const item = classify(data);
  if (item) {
    out.push(item);
    return out;
  }
  for (const v of Object.values(data)) extractContext(v, depth + 1, out);
  return out;
}

/** Adds new items, de-duplicated by kind+id, newest information wins. */
export function mergeContext(into: ContextItem[], items: ContextItem[]): ContextItem[] {
  for (const it of items) {
    const i = into.findIndex((x) => x.kind === it.kind && x.id === it.id);
    if (i >= 0) into[i] = { ...into[i], ...it };
    else if (into.length < MAX_ITEMS) into.push(it);
  }
  return into;
}
