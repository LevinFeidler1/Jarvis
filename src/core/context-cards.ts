/**
 * Context cards: the things a reply talks about (events, mails, tasks, …),
 * collected from this turn's tool results. The voice UI shows the matching
 * card the moment JARVIS says a sentence that mentions it.
 *
 * Only display fields are copied — never mail bodies or file contents — and
 * every string is length-limited. Detection is by shape, so new tools that
 * return the same provider types get cards for free.
 */

export type ContextKind = "event" | "mail" | "task" | "contact" | "file" | "finance" | "weather" | "place" | "list" | "news" | "note";

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
  /** Extra display data for weather / place / list / news cards (bounded, text only). */
  detail?: Record<string, unknown>;
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

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Shapes without an `id` field (weather, places, news). */
function classifyLife(o: Record<string, unknown>): ContextItem | undefined {
  // get_weather: { place:{name,lat,lon}, now:{temperature…}, days:[…] }
  if (isObj(o.place) && isObj(o.now) && Array.isArray(o.days)) {
    const place = str((o.place as Record<string, unknown>).name, 80) ?? "Wetter";
    const now = o.now as Record<string, unknown>;
    return {
      kind: "weather", id: `weather:${place}`, title: place,
      terms: ["wetter", "regen", "sonne", "grad", "temperatur", "schirm", "kalt", "warm", "wind", "schnee", "gewitter", ...termsOf(place)],
      detail: {
        temperature: num(now.temperature), feelsLike: num(now.feelsLike), text: str(now.text, 40), icon: str(now.icon, 12), windKmh: num(now.windKmh),
        hint: str(o.hint, 120),
        hours: (Array.isArray(o.hours) ? o.hours : []).slice(0, 8).filter(isObj).map((h) => ({ time: str(h.time, 40), temperature: num(h.temperature), icon: str(h.icon, 12), rain: num(h.precipitationProbability) })),
        days: (o.days as unknown[]).slice(0, 4).filter(isObj).map((d) => ({ date: str(d.date, 12), min: num(d.min), max: num(d.max), icon: str(d.icon, 12), rain: num(d.precipitationProbability) })),
      },
    };
  }
  // find_places entry
  if (str(o.name) && typeof o.distanceM === "number" && typeof o.lat === "number" && str(o.mapsUrl)) {
    const name = str(o.name, 100)!;
    return {
      kind: "place", id: `place:${name}:${(o.lat as number).toFixed(4)}`, title: name, terms: termsOf(name),
      location: str(o.address, 160),
      detail: { kind: str(o.kind, 20), cuisine: str(o.cuisine, 80), phone: str(o.phone, 40), website: str(o.website, 300), openingHours: str(o.openingHours, 120), reservation: str(o.reservation, 20), distanceM: o.distanceM, mapsUrl: str(o.mapsUrl, 400) },
    };
  }
  // get_news entry
  if (str(o.title) && str(o.link) && str(o.source) && typeof o.topic === "string") {
    const title = str(o.title, 200)!;
    return { kind: "news", id: `news:${str(o.link, 300)}`, title, terms: termsOf(title).slice(0, 5), snippet: str(o.summary, 220), date: str(o.published, 40), detail: { link: str(o.link, 400), source: str(o.source, 40) } };
  }
  return undefined;
}

function classify(o: Record<string, unknown>): ContextItem | undefined {
  const life = classifyLife(o);
  if (life) return life;
  const id = str(o.id, 200);
  if (!id) return undefined;
  // get_list / add_to_list: { id, name, items:[{id,text,done}], open }
  if (str(o.name) && Array.isArray(o.items) && typeof o.open === "number") {
    const name = str(o.name, 80)!;
    const items = (o.items as unknown[]).filter(isObj).slice(0, 12).map((i) => ({ id: str(i.id, 80), text: str(i.text, 120), done: i.done === true }));
    return { kind: "list", id, title: name, terms: ["liste", ...termsOf(name), ...items.flatMap((i) => termsOf(i.text)).slice(0, 4)], detail: { items, open: o.open } };
  }
  // Notes
  if (typeof o.body === "string" && typeof o.pinned === "boolean") {
    const title = str(o.title, 120) ?? str(o.body, 60)!;
    return { kind: "note", id, title, terms: ["notiz", ...termsOf(title)], snippet: str(o.body, 220) };
  }
  // Finance items (manual or detected)
  if (str(o.vendor) && (o.kind === "invoice" || o.kind === "subscription") && typeof o.status === "string") {
    const vendor = str(o.vendor, 80)!;
    const cents = num(o.amountCents);
    return {
      kind: "finance", id, title: str(o.title, 160) ?? vendor, from: vendor, due: str(o.dueDate, 12) ?? null, status: str(o.status, 12),
      amount: cents !== undefined ? euro(cents) : undefined,
      terms: ["rechnung", "zahlung", "abo", ...termsOf(vendor)],
      detail: { kind: o.kind, interval: str(o.interval, 12) },
    };
  }
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
