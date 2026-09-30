import type { CalendarEvent, CalendarProvider, NewEvent } from "../types.js";
import type { GoogleHttp } from "./http.js";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}
interface GEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  status?: string;
  transparency?: string;
  htmlLink?: string;
  organizer?: { email?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean }>;
}

function toEvent(e: GEvent): CalendarEvent {
  const allDay = !!e.start?.date;
  return {
    id: e.id,
    title: e.summary ?? "(ohne Titel)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay,
    location: e.location,
    description: e.description,
    organizer: e.organizer?.email,
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.email,
      name: a.displayName,
      responseStatus: a.responseStatus as CalendarEvent["attendees"][number]["responseStatus"],
      self: a.self,
      organizer: a.organizer,
    })),
    status: (e.status as CalendarEvent["status"]) ?? "confirmed",
    busy: e.transparency !== "transparent",
    htmlLink: e.htmlLink,
  };
}

function toTime(value: string, allDay: boolean | undefined, tz?: string): GEventTime {
  if (allDay) return { date: value.slice(0, 10) };
  return { dateTime: value, timeZone: tz };
}

function toBody(input: Partial<NewEvent>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.summary = input.title;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start !== undefined) body.start = toTime(input.start, input.allDay, input.timezone);
  if (input.end !== undefined) body.end = toTime(input.end, input.allDay, input.timezone);
  if (input.attendees !== undefined) body.attendees = input.attendees.map((email) => ({ email }));
  return body;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "Google Calendar";

  constructor(private readonly http: GoogleHttp) {}

  async listEvents(q: { timeMin: string; timeMax: string; text?: string; maxResults?: number }): Promise<CalendarEvent[]> {
    const res = await this.http.request<{ items?: GEvent[] }>(BASE, {
      query: {
        timeMin: q.timeMin,
        timeMax: q.timeMax,
        q: q.text,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: Math.min(q.maxResults ?? 100, 250),
      },
    });
    return (res.items ?? []).filter((e) => e.status !== "cancelled").map(toEvent);
  }

  async getEvent(id: string): Promise<CalendarEvent> {
    return toEvent(await this.http.request<GEvent>(`${BASE}/${encodeURIComponent(id)}`));
  }

  async createEvent(input: NewEvent, notifyAttendees: boolean): Promise<CalendarEvent> {
    const res = await this.http.request<GEvent>(BASE, {
      method: "POST",
      query: { sendUpdates: notifyAttendees ? "all" : "none" },
      body: toBody(input),
      idempotent: false,
    });
    return toEvent(res);
  }

  async updateEvent(id: string, patch: Partial<NewEvent>, notifyAttendees: boolean): Promise<CalendarEvent> {
    const res = await this.http.request<GEvent>(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      query: { sendUpdates: notifyAttendees ? "all" : "none" },
      body: toBody(patch),
      idempotent: true,
    });
    return toEvent(res);
  }

  async deleteEvent(id: string, notifyAttendees: boolean): Promise<void> {
    await this.http.request(`${BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      query: { sendUpdates: notifyAttendees ? "all" : "none" },
    });
  }

  async respondToInvitation(id: string, response: "accepted" | "declined" | "tentative"): Promise<CalendarEvent> {
    const raw = await this.http.request<GEvent>(`${BASE}/${encodeURIComponent(id)}`);
    const attendees = raw.attendees ?? [];
    if (!attendees.some((a) => a.self)) throw new Error("Du bist bei diesem Termin nicht als Teilnehmer eingetragen.");
    const updated = attendees.map((a) => (a.self ? { ...a, responseStatus: response } : a));
    const res = await this.http.request<GEvent>(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      query: { sendUpdates: "all" },
      body: { attendees: updated },
      idempotent: true,
    });
    return toEvent(res);
  }
}
