/** Timezone helpers built on Intl only (no dependencies). */

function partsIn(date: Date, timeZone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type === "weekday") out.weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.value);
    else if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. +120 for CEST). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Local wall-clock time in `timeZone` → UTC Date. Handles DST transitions. */
export function zonedToUtc(ymd: string, hm: string, timeZone: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number) as [number, number, number];
  const [h, mi] = hm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60_000;
  const offset2 = tzOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60_000;
  }
  return new Date(result);
}

/** YYYY-MM-DD of `date` as seen in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localWeekday(date: Date, timeZone: string): number {
  return partsIn(date, timeZone).weekday!;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO string with the local offset, e.g. 2026-09-30T14:00:00+02:00. */
export function toLocalIso(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  const off = tzOffsetMinutes(date, timeZone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}T${pad(p.hour!)}:${pad(p.minute!)}:${pad(p.second!)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatHuman(date: Date, timeZone: string, language = "de"): string {
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : language, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export interface Interval {
  start: number;
  end: number;
}

export interface FreeSlotOptions {
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  busy: Interval[];
  timeZone: string;
  workdayStart: string; // "09:00"
  workdayEnd: string; // "18:00"
  bufferMinutes: number;
  weekdaysOnly: boolean;
  maxResults: number;
  /** Granularity for suggested start times. */
  stepMinutes?: number;
}

export interface FreeSlot {
  start: string;
  end: string;
}

/**
 * Free time slots within working hours, respecting existing busy intervals and
 * a buffer before/after each of them. Deterministic, provider-agnostic.
 */
export function findFreeSlots(o: FreeSlotOptions): { freeWindows: FreeSlot[]; suggestions: FreeSlot[] } {
  const step = (o.stepMinutes ?? 15) * 60_000;
  const duration = o.durationMinutes * 60_000;
  const buffer = o.bufferMinutes * 60_000;
  const busy = o.busy
    .map((b) => ({ start: b.start - buffer, end: b.end + buffer }))
    .sort((a, b) => a.start - b.start);

  const windows: Interval[] = [];
  let day = localDate(o.rangeStart, o.timeZone);
  const lastDay = localDate(o.rangeEnd, o.timeZone);
  for (let guard = 0; day <= lastDay && guard < 400; guard++, day = addDaysYmd(day, 1)) {
    const dayStart = zonedToUtc(day, o.workdayStart, o.timeZone);
    const weekday = localWeekday(dayStart, o.timeZone);
    if (o.weekdaysOnly && (weekday === 0 || weekday === 6)) continue;
    const start = Math.max(dayStart.getTime(), o.rangeStart.getTime());
    const end = Math.min(zonedToUtc(day, o.workdayEnd, o.timeZone).getTime(), o.rangeEnd.getTime());
    if (end - start < duration) continue;

    let cursor = start;
    for (const b of busy) {
      if (b.end <= cursor || b.start >= end) continue;
      if (b.start - cursor >= duration) windows.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
      if (cursor >= end) break;
    }
    if (end - cursor >= duration) windows.push({ start: cursor, end });
  }

  const iso = (ms: number) => toLocalIso(new Date(ms), o.timeZone);
  const suggestions: FreeSlot[] = [];
  for (const w of windows) {
    let s = Math.ceil(w.start / step) * step;
    // Up to two suggestions per window: earliest start and, if room, one later.
    const picks: number[] = [];
    if (s + duration <= w.end) picks.push(s);
    const later = Math.floor((w.end - duration) / step) * step;
    if (later - s >= 2 * duration) picks.push(s + Math.floor((later - s) / 2 / step) * step);
    for (s of picks) {
      suggestions.push({ start: iso(s), end: iso(s + duration) });
      if (suggestions.length >= o.maxResults) break;
    }
    if (suggestions.length >= o.maxResults) break;
  }
  return { freeWindows: windows.map((w) => ({ start: iso(w.start), end: iso(w.end) })), suggestions };
}
