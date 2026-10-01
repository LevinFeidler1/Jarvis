import { z } from "zod";
import { RiskLevel, type ToolDefinition } from "../core/types.js";
import { findFreeSlots } from "../core/time.js";
import type { CalendarEvent } from "../providers/types.js";
import { defineTool, emailAddress, external, fail, id, isoDateOrDateTime, isoDateTime, ok, singleLine } from "./common.js";

function view(e: CalendarEvent) {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: e.location,
    attendees: e.attendees.map((a) => ({ email: a.email, name: a.name, response: a.responseStatus, self: a.self })),
    organizer: e.organizer,
    busy: e.busy,
    status: e.status,
  };
}

const range = z.object({
  time_min: isoDateTime.describe("Beginn des Zeitraums (ISO-8601 mit Offset)."),
  time_max: isoDateTime.describe("Ende des Zeitraums (ISO-8601 mit Offset)."),
});

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM");

/** Conflicts with existing busy events in [start, end). */
async function conflicts(ctx: Parameters<ToolDefinition["execute"]>[1], start: string, end: string, ignoreId?: string) {
  const events = await (await ctx.providers.calendar()).listEvents({ timeMin: start, timeMax: end });
  return events
    .filter((e) => e.busy && !e.allDay && e.id !== ignoreId)
    .filter((e) => new Date(e.start) < new Date(end) && new Date(e.end) > new Date(start))
    .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end }));
}

const newEventInput = z
  .object({
    title: singleLine(300),
    start: isoDateOrDateTime.describe("Start (ISO-8601 mit Offset; bei ganztägig YYYY-MM-DD)."),
    end: isoDateOrDateTime,
    all_day: z.boolean().optional(),
    location: z.string().max(500).optional(),
    description: z.string().max(8000).optional(),
    attendees: z.array(emailAddress).max(100).optional().describe("Gäste. Mit Gästen werden Einladungen verschickt."),
  })
  .refine((e) => new Date(e.end) > new Date(e.start), { message: "Ende muss nach dem Beginn liegen", path: ["end"] });

export const calendarTools: ToolDefinition[] = [
  defineTool({
    name: "get_events",
    description: "Listet Kalendertermine in einem Zeitraum (z.B. heute, diese Woche). Enthält Teilnehmer und Antwortstatus.",
    category: "calendar",
    risk: RiskLevel.READ,
    input: range,
    describe: () => "Kalender lesen",
    async execute(input, ctx) {
      const events = await (await ctx.providers.calendar()).listEvents({ timeMin: input.time_min, timeMax: input.time_max });
      return external(
        "calendar",
        { count: events.length, events: events.map(view) },
        events.flatMap((e) => [e.title, e.description ?? ""]),
      );
    },
  }),
  defineTool({
    name: "search_events",
    description: "Sucht Termine per Freitext (Titel, Ort, Teilnehmer) in einem Zeitraum.",
    category: "calendar",
    risk: RiskLevel.READ,
    input: range.extend({ query: z.string().min(1).max(200) }),
    describe: (i) => `Termine suchen: "${i.query}"`,
    async execute(input, ctx) {
      const events = await (await ctx.providers.calendar()).listEvents({ timeMin: input.time_min, timeMax: input.time_max, text: input.query });
      return external("calendar", { count: events.length, events: events.map(view) }, events.map((e) => e.title));
    },
  }),
  defineTool({
    name: "find_free_slots",
    description:
      "Findet freie Zeitfenster für einen Termin einer bestimmten Dauer im Kalender des Benutzers, " +
      "innerhalb der Arbeitszeiten und mit Puffer zwischen Terminen. Liefert Vorschläge sortiert nach Zeit.",
    category: "calendar",
    risk: RiskLevel.READ,
    input: range.extend({
      duration_minutes: z.number().int().min(5).max(24 * 60),
      workday_start: hm.optional().describe("Standard 09:00 oder Präferenz aus dem Gedächtnis."),
      workday_end: hm.optional().describe("Standard 18:00."),
      buffer_minutes: z.number().int().min(0).max(120).optional().describe("Puffer vor/nach Terminen, Standard 10."),
      weekdays_only: z.boolean().optional(),
      max_results: z.number().int().min(1).max(30).optional(),
    }),
    describe: (i) => `Freie Zeitfenster (${i.duration_minutes} min) suchen`,
    async execute(input, ctx) {
      const events = await (await ctx.providers.calendar()).listEvents({ timeMin: input.time_min, timeMax: input.time_max });
      const busy = events
        .filter((e) => e.busy && !e.allDay && e.status !== "cancelled")
        .filter((e) => !e.attendees.some((a) => a.self && a.responseStatus === "declined"))
        .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }));
      const result = findFreeSlots({
        rangeStart: new Date(Math.max(new Date(input.time_min).getTime(), ctx.now().getTime())),
        rangeEnd: new Date(input.time_max),
        durationMinutes: input.duration_minutes,
        busy,
        timeZone: ctx.config.timezone,
        workdayStart: input.workday_start ?? "09:00",
        workdayEnd: input.workday_end ?? "18:00",
        bufferMinutes: input.buffer_minutes ?? 10,
        weekdaysOnly: input.weekdays_only ?? true,
        maxResults: input.max_results ?? 8,
      });
      return ok({ timezone: ctx.config.timezone, busyEventsConsidered: busy.length, ...result });
    },
  }),
  defineTool({
    name: "create_event",
    description:
      "Erstellt einen Kalendertermin. Ohne Gäste: niedriges Risiko. Mit Gästen werden Einladungen versendet → Bestätigung. " +
      "Prüft Konflikte und meldet sie im Ergebnis.",
    category: "calendar",
    risk: RiskLevel.LOW,
    riskFor: (i) => (i.attendees?.length ? RiskLevel.EXTERNAL : RiskLevel.LOW),
    input: newEventInput,
    describe: (i) =>
      `Termin erstellen: "${i.title}"\n${i.start} – ${i.end}${i.location ? `\nOrt: ${i.location}` : ""}` +
      `${i.attendees?.length ? `\nEinladungen an: ${i.attendees.join(", ")}` : ""}`,
    auditTarget: (i) => i.attendees?.join(", "),
    outgoingText: (i) => `${i.title}\n${i.description ?? ""}`,
    async execute(input, ctx) {
      const found = input.all_day ? [] : await conflicts(ctx, input.start, input.end);
      const ev = await (await ctx.providers.calendar()).createEvent(
        {
          title: input.title,
          start: input.start,
          end: input.end,
          allDay: input.all_day,
          location: input.location,
          description: input.description,
          attendees: input.attendees,
          timezone: ctx.config.timezone,
        },
        !!input.attendees?.length,
      );
      return ok({ created: view(ev), conflicts: found });
    },
    undo: (input, data) => {
      if (input.attendees?.length) return undefined; // invitations were sent — deleting would notify guests
      const ev = (data as { created: { id: string; title: string } }).created;
      return { tool: "delete_event", input: { event_id: ev.id, event_title: ev.title, notify_attendees: false }, label: "Termin wieder löschen" };
    },
  }),
  defineTool({
    name: "update_event",
    description:
      "Ändert einen Termin (verschieben, umbenennen, Ort, Gäste setzen). Bei Terminen mit Gästen werden diese benachrichtigt → Bestätigung.",
    category: "calendar",
    risk: RiskLevel.LOW,
    riskFor: (i) => (i.has_attendees || i.attendees?.length ? RiskLevel.EXTERNAL : RiskLevel.LOW),
    input: z.object({
      event_id: id,
      has_attendees: z.boolean().describe("true, wenn der Termin (bereits) Gäste hat — sie werden über die Änderung informiert."),
      title: singleLine(300).optional(),
      start: isoDateOrDateTime.optional(),
      end: isoDateOrDateTime.optional(),
      location: z.string().max(500).optional(),
      description: z.string().max(8000).optional(),
      attendees: z.array(emailAddress).max(100).optional().describe("Vollständige neue Gästeliste."),
    }),
    describe: (i) => {
      const parts = [
        i.title && `Titel: "${i.title}"`,
        i.start && `Beginn: ${i.start}`,
        i.end && `Ende: ${i.end}`,
        i.location && `Ort: ${i.location}`,
        i.attendees && `Gäste: ${i.attendees.join(", ")}`,
      ].filter(Boolean);
      return `Termin ändern (${i.event_id})\n${parts.join("\n")}${i.has_attendees ? "\nGäste werden benachrichtigt." : ""}`;
    },
    auditTarget: (i) => i.attendees?.join(", ") ?? i.event_id,
    async execute(input, ctx) {
      const cal = (await ctx.providers.calendar());
      const current = await cal.getEvent(input.event_id);
      // Guard against the model under-reporting attendees: re-check with live data.
      if (current.attendees.some((a) => !a.self) && !input.has_attendees) {
        return fail(
          "Dieser Termin hat Gäste, die benachrichtigt würden. Bitte erneut mit has_attendees=true aufrufen (erfordert Bestätigung).",
          "INVALID_INPUT",
        );
      }
      const start = input.start ?? current.start;
      const end = input.end ?? current.end;
      if (new Date(end) <= new Date(start)) return fail("Ende muss nach dem Beginn liegen.", "INVALID_INPUT");
      const found = input.start || input.end ? await conflicts(ctx, start, end, input.event_id) : [];
      const ev = await cal.updateEvent(
        input.event_id,
        {
          title: input.title,
          start: input.start,
          end: input.end,
          location: input.location,
          description: input.description,
          attendees: input.attendees,
          allDay: current.allDay,
          timezone: ctx.config.timezone,
        },
        input.has_attendees,
      );
      return ok({ updated: view(ev), conflicts: found });
    },
  }),
  defineTool({
    name: "invite_attendees",
    description: "Fügt einem bestehenden Termin Gäste hinzu und sendet Einladungen. Erfordert Bestätigung.",
    category: "calendar",
    risk: RiskLevel.EXTERNAL,
    isExternal: true,
    input: z.object({ event_id: id, attendees: z.array(emailAddress).min(1).max(100) }),
    describe: (i) => `Einladungen senden an: ${i.attendees.join(", ")} (Termin ${i.event_id})`,
    auditTarget: (i) => i.attendees.join(", "),
    async execute(input, ctx) {
      const cal = (await ctx.providers.calendar());
      const current = await cal.getEvent(input.event_id);
      const emails = new Set(current.attendees.map((a) => a.email.toLowerCase()));
      const merged = [...current.attendees.map((a) => a.email), ...input.attendees.filter((a) => !emails.has(a.toLowerCase()))];
      const ev = await cal.updateEvent(input.event_id, { attendees: merged }, true);
      return ok({ updated: view(ev) });
    },
  }),
  defineTool({
    name: "delete_event",
    description: "Löscht einen Termin. Gäste werden ggf. über die Absage informiert. Erfordert Bestätigung.",
    category: "calendar",
    risk: RiskLevel.EXTERNAL,
    input: z.object({ event_id: id, event_title: z.string().max(300).describe("Titel zur Anzeige in der Bestätigung."), notify_attendees: z.boolean() }),
    describe: (i) => `Termin löschen: "${i.event_title}"${i.notify_attendees ? " — Gäste werden benachrichtigt" : ""}`,
    auditTarget: (i) => i.event_id,
    async execute(input, ctx) {
      await (await ctx.providers.calendar()).deleteEvent(input.event_id, input.notify_attendees);
      return ok({ deleted: true });
    },
  }),
  defineTool({
    name: "respond_to_invitation",
    description: "Sagt eine Termineinladung zu, ab oder mit Vorbehalt. Der Organisator wird benachrichtigt → Bestätigung.",
    category: "calendar",
    risk: RiskLevel.EXTERNAL,
    isExternal: true,
    input: z.object({ event_id: id, event_title: z.string().max(300), response: z.enum(["accepted", "declined", "tentative"]) }),
    describe: (i) =>
      `Einladung "${i.event_title}" ${i.response === "accepted" ? "zusagen" : i.response === "declined" ? "absagen" : "mit Vorbehalt beantworten"}`,
    auditTarget: (i) => i.event_id,
    async execute(input, ctx) {
      const ev = await (await ctx.providers.calendar()).respondToInvitation(input.event_id, input.response);
      return ok({ updated: view(ev) });
    },
  }),
];
