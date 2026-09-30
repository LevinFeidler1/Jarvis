import { describe, expect, it } from "vitest";
import { Scheduler } from "../src/core/scheduler.js";
import { findFreeSlots, toLocalIso, zonedToUtc } from "../src/core/time.js";
import { openDatabase } from "../src/db/database.js";
import { MemoryStore } from "../src/memory/memory.js";
import { harness } from "./helpers.js";

const TZ = "Europe/Berlin";
const ms = (iso: string) => new Date(iso).getTime();

describe("time helpers", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(zonedToUtc("2026-07-01", "09:00", TZ).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", TZ).toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(zonedToUtc("2026-10-25", "12:00", TZ).toISOString()).toBe("2026-10-25T11:00:00.000Z"); // DST ends
  });

  it("formats local ISO with offset", () => {
    expect(toLocalIso(new Date("2026-09-30T12:00:00Z"), TZ)).toBe("2026-09-30T14:00:00+02:00");
  });
});

describe("findFreeSlots", () => {
  const base = {
    timeZone: TZ,
    workdayStart: "09:00",
    workdayEnd: "18:00",
    bufferMinutes: 10,
    weekdaysOnly: true,
    maxResults: 20,
  };

  it("respects busy events and buffers", () => {
    const r = findFreeSlots({
      ...base,
      rangeStart: new Date("2026-10-05T00:00:00+02:00"),
      rangeEnd: new Date("2026-10-05T23:59:00+02:00"),
      durationMinutes: 60,
      busy: [{ start: ms("2026-10-05T10:00:00+02:00"), end: ms("2026-10-05T12:00:00+02:00") }],
    });
    expect(r.freeWindows).toEqual([
      { start: "2026-10-05T09:00:00+02:00", end: "2026-10-05T09:50:00+02:00" },
      { start: "2026-10-05T12:10:00+02:00", end: "2026-10-05T18:00:00+02:00" },
    ].filter((w) => ms(w.end) - ms(w.start) >= 60 * 60_000));
    expect(r.suggestions[0]).toEqual({ start: "2026-10-05T12:15:00+02:00", end: "2026-10-05T13:15:00+02:00" });
  });

  it("skips weekends and handles fully booked days", () => {
    const r = findFreeSlots({
      ...base,
      rangeStart: new Date("2026-10-03T00:00:00+02:00"), // Saturday
      rangeEnd: new Date("2026-10-05T23:00:00+02:00"), // Monday
      durationMinutes: 30,
      busy: [{ start: ms("2026-10-05T08:00:00+02:00"), end: ms("2026-10-05T19:00:00+02:00") }],
    });
    expect(r.suggestions).toEqual([]);
  });

  it("finds a 60-minute slot next week (Thomas example)", () => {
    const r = findFreeSlots({
      ...base,
      rangeStart: new Date("2026-10-05T00:00:00+02:00"),
      rangeEnd: new Date("2026-10-10T00:00:00+02:00"),
      durationMinutes: 60,
      busy: [],
      maxResults: 5,
    });
    expect(r.suggestions).toHaveLength(5);
    expect(r.suggestions.every((s) => ms(s.end) - ms(s.start) === 3_600_000)).toBe(true);
  });
});

describe("memory", () => {
  it("inferred entries never overwrite user statements", () => {
    const m = new MemoryStore(openDatabase(":memory:"));
    m.upsert({ category: "preference", key: "Meetingdauer", value: "30 Minuten", source: "user" });
    m.upsert({ category: "preference", key: "Meetingdauer", value: "60 Minuten", source: "inferred" });
    expect(m.list()[0]).toMatchObject({ value: "30 Minuten", source: "user" });
  });

  it("marks uncertain entries in the prompt and user edits make them certain", () => {
    const m = new MemoryStore(openDatabase(":memory:"));
    const e = m.upsert({ category: "person", key: "Max", value: "Kollege", source: "inferred" });
    expect(m.renderForPrompt()).toContain("[unsicher");
    m.update(e.id, { value: "Teamleiter" });
    expect(m.renderForPrompt()).not.toContain("[unsicher");
  });
});

describe("reminders & scheduler", () => {
  it("fires due reminders exactly once as notifications", async () => {
    const h = harness([]);
    h.providers.reminders.create("Zahnarzt anrufen", "2026-09-30T07:00:00.000Z");
    h.providers.reminders.create("Später", "2026-12-01T07:00:00.000Z");
    const s = new Scheduler(h.providers);
    expect(await s.tick(new Date("2026-09-30T08:00:00Z"))).toBe(1);
    expect(await s.tick(new Date("2026-09-30T08:01:00Z"))).toBe(0);
    expect(h.providers.notifications.list()).toEqual([expect.objectContaining({ title: "Erinnerung", body: "Zahnarzt anrufen" })]);
  });
});
