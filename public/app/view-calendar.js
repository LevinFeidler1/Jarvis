// Calendar (week/agenda) and the event sheet.

import { api, state } from "./api.js";
import { TZ, avatar, fmt, h, icon, isToday, set, ymd } from "./dom.js";
import { isMobile, notConfigured, viewHead } from "./shell.js";
import { startChat } from "./view-chat.js";

// ─── View: Kalender ─────────────────────────────────────────────────────────
const HOUR_PX = 48;
function weekStart(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

export async function viewCalendar(main) {
  const focusId = state.calendarFocusId;
  state.calendarFocusId = null;
  if (state.calendarFocus) {
    const focus = new Date(state.calendarFocus);
    state.calendarFocus = null;
    if (!Number.isNaN(focus.getTime())) {
      focus.setHours(0, 0, 0, 0);
      focus.setDate(focus.getDate() - ((focus.getDay() + 6) % 7));
      state.weekOffset = Math.round((focus - weekStart(0)) / 604800000);
    }
  }
  const start = weekStart(state.weekOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const range = `${start.toLocaleDateString("de-DE", { day: "numeric", month: "long" })} – ${new Date(end - 1).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}`;
  const nav = [
    h("button", { class: "btn icon", onclick: () => { state.weekOffset--; viewCalendar(main); }, "aria-label": "Vorherige Woche" }, icon("left")),
    h("button", { class: "btn", onclick: () => { state.weekOffset = 0; viewCalendar(main); } }, "Heute"),
    h("button", { class: "btn icon", onclick: () => { state.weekOffset++; viewCalendar(main); }, "aria-label": "Nächste Woche" }, icon("right")),
    h("button", { class: "btn primary", onclick: () => startChat("Plane einen Termin für mich: ", { send: false }) }, icon("plus"), "Termin"),
  ];
  const head = viewHead("Kalender", range, ...nav);
  set(main, h("div", { class: "view" }, head, h("div", { class: "card", style: "padding:40px" }, h("div", { class: "spinner", style: "margin:auto" }))));

  let events;
  try {
    events = await api(`/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
  } catch (err) {
    set(main, h("div", { class: "view" }, head, err.status === 409 ? notConfigured("Der Kalender ist noch nicht verbunden.") : h("div", { class: "empty" }, err.message)));
    return;
  }

  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const focused = focusId && events.find((e) => e.id === focusId);
  if (focused) setTimeout(() => openEventSheet(focused, events), 350);
  if (isMobile()) return renderAgenda(main, head, days, events);
  const headRow = h("div", { class: "cal-head" }, h("div"), days.map((d) =>
    h("div", { class: isToday(d) ? "today" : "" }, d.toLocaleDateString("de-DE", { weekday: "short" }), h("b", {}, d.getDate()))));
  const allday = h("div", { class: "cal-allday" }, h("div", {}, "ganzt."), days.map((d) =>
    h("div", {}, events.filter((e) => e.allDay && e.start.slice(0, 10) <= ymd(d) && e.end.slice(0, 10) > ymd(d)).map((e) => h("button", { class: "cal-chip", title: e.title, onclick: () => openEventSheet(e, events) }, e.title)))));
  const hours = h("div", { class: "cal-hours" }, [...Array(24)].map((_, i) => h("div", {}, i ? `${String(i).padStart(2, "0")}:00` : "")));
  const cols = days.map((d) => {
    const col = h("div", { class: `cal-day ${isToday(d) ? "today" : ""}`, style: `height:${24 * HOUR_PX}px` });
    const dayStart = new Date(d).getTime();
    const dayEnd = dayStart + 86400000;
    const evs = events.filter((e) => !e.allDay && new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    // Simple overlap layout: assign lanes.
    const lanes = [];
    const placed = evs.map((e) => {
      const s = Math.max(new Date(e.start).getTime(), dayStart);
      const en = Math.min(new Date(e.end).getTime(), dayEnd);
      let lane = lanes.findIndex((l) => l <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(en); } else lanes[lane] = en;
      return { e, s, en, lane };
    });
    const n = Math.max(1, lanes.length);
    for (const { e, s, en, lane } of placed) {
      const top = ((s - dayStart) / 3600000) * HOUR_PX;
      const height = Math.max(22, ((en - s) / 3600000) * HOUR_PX - 2);
      col.append(h("button", { class: `cal-ev ${e.busy ? "" : "free"}`, onclick: () => openEventSheet(e, events), style: `top:${top}px;height:${height}px;left:calc(${(lane / n) * 100}% + 3px);width:calc(${100 / n}% - 6px);right:auto`, title: `${e.title}\n${fmt.time(e.start)}–${fmt.time(e.end)}${e.location ? `\n${e.location}` : ""}` },
        h("b", {}, e.title), height > 34 ? h("span", {}, `${fmt.time(e.start)}–${fmt.time(e.end)}`) : null));
    }
    if (isToday(d)) {
      const now = new Date();
      col.append(h("div", { class: "now-line", style: `top:${(now.getHours() + now.getMinutes() / 60) * HOUR_PX}px` }));
    }
    return col;
  });
  const body = h("div", { class: "cal-body" }, hours, cols);
  set(main, h("div", { class: "view" }, head, h("div", { class: "card cal" }, headRow, allday, body),
    h("div", { class: "muted small", style: "margin-top:10px" }, `${events.length} Termine · Zeitzone ${state.status?.timezone ?? TZ}`)));
  body.scrollTop = 7 * HOUR_PX;
}

// ─── Termin-Sheet ───────────────────────────────────────────────────────────
const RSVP = { accepted: ["Zugesagt", "ok"], declined: ["Abgesagt", "err"], tentative: ["Vielleicht", "warn"], needsAction: ["Offen", ""] };

/** Event details as a glass sheet (phone) / dialog (desktop). Event texts are rendered as text only. */
export function openEventSheet(e, sameDayEvents = []) {
  document.querySelector(".ev-wrap")?.remove();
  const close = () => { wrap.classList.add("closing"); setTimeout(() => wrap.remove(), 260); document.removeEventListener("keydown", onKey); };
  const onKey = (ev) => ev.key === "Escape" && close();
  const start = new Date(e.start);
  const dayKey = start.toDateString();
  const sameDay = sameDayEvents.filter((x) => !x.allDay && new Date(x.start).toDateString() === dayKey);
  const pos = (iso) => { const d = new Date(iso); return Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60 - 7) / 14) * 100)); };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(start.getFullYear(), start.getMonth(), start.getDate()) - today) / 86400000);
  const chip = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : diff > 1 && diff < 7 ? `in ${diff} Tagen` : null;
  const mins = e.allDay ? 0 : Math.round((new Date(e.end) - start) / 60000);
  const safeLink = typeof e.htmlLink === "string" && /^https:\/\//.test(e.htmlLink) ? e.htmlLink : null;
  const body = h("div", { class: "jc jc-event ev-card" },
    h("div", { class: "jc-head" }, h("span", { class: "jc-glyph k-event" }, icon("calendar")), h("span", { class: "jc-label" }, "Termin"),
      e.status === "tentative" ? h("span", { class: "jc-chip orange" }, "Vorläufig") : chip ? h("span", { class: "jc-chip" }, chip) : null,
      h("button", { class: "ev-x", "aria-label": "Schließen", onclick: close }, icon("x"))),
    h("div", { class: "jc-date" }, start.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })),
    e.allDay ? h("div", { class: "jc-big" }, "Ganztägig")
      : h("div", { class: "jc-timeRow" }, h("span", { class: "jc-big" }, fmt.time(e.start)), h("span", { class: "jc-to" }, `– ${fmt.time(e.end)}`),
          h("span", { class: "jc-dur mono" }, mins >= 60 ? `${Math.floor(mins / 60)} STD${mins % 60 ? ` ${mins % 60} MIN` : ""}` : `${mins} MIN`)),
    h("div", { class: "jc-title" }, e.title),
    e.allDay || !sameDay.length ? null : h("div", { class: "jc-daybar" },
      h("div", { class: "track" }),
      sameDay.map((x) => h("div", { class: `seg ${x.id === e.id ? "me" : ""}`, title: `${x.title} ${fmt.time(x.start)}`, style: `left:${pos(x.start)}%;width:${Math.max(2.5, pos(x.end) - pos(x.start))}%` })),
      h("div", { class: "ticks mono" }, ["7", "10", "13", "16", "19", "21"].map((t) => h("span", {}, t)))),
    h("div", { class: "jc-meta" },
      e.location ? h("div", {}, icon("pin"), e.location) : null,
      e.organizer ? h("div", {}, icon("users"), `Organisiert von ${e.organizer}`) : null),
    e.attendees?.length ? h("div", { class: "ev-people" }, e.attendees.slice(0, 8).map((a) => {
      const [label, cls] = RSVP[a.responseStatus] ?? RSVP.needsAction;
      return h("div", { class: "ev-person" }, avatar(a.name || a.email), h("div", { class: "main" }, h("div", { class: "title" }, a.name || a.email), a.name ? h("div", { class: "sub" }, a.email) : null), h("span", { class: `badge ${cls}` }, label));
    }), e.attendees.length > 8 ? h("div", { class: "muted small" }, `+ ${e.attendees.length - 8} weitere`) : null) : null,
    e.description ? h("div", { class: "jc-preview ev-desc" }, e.description.slice(0, 1200)) : null,
    h("div", { class: "jc-actions" },
      e.location ? h("a", { class: "jc-btn primary", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`, target: "_blank", rel: "noopener noreferrer" }, "Route") : null,
      h("button", { class: `jc-btn ${e.location ? "" : "primary"}`, onclick: () => { close(); startChat(`Zum Termin „${e.title}“ am ${fmt.dt(e.start)}: `, { send: false }); } }, "Mit JARVIS"),
      safeLink ? h("a", { class: "jc-btn", href: safeLink, target: "_blank", rel: "noopener noreferrer", "aria-label": "In Google Kalender öffnen" }, icon("external")) : null));
  const wrap = h("div", { class: "ev-wrap", onclick: (ev) => ev.target === wrap && close() },
    h("div", { class: "ev-sheet glass", role: "dialog", "aria-modal": "true", "aria-label": e.title }, h("div", { class: "jv-grip ev-grip", "aria-hidden": "true" }), body));
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  wrap.querySelector(".ev-x")?.focus();
}

/** Phones: a readable day-by-day list instead of the 7-column grid. */
function renderAgenda(main, head, days, events) {
  const todayYmd = ymd(new Date());
  const past = days.filter((d) => ymd(d) < todayYmd);
  let showPast = false;
  const list = h("div", { class: "agenda" });
  const dayEvents = (d) => {
    const dayStart = new Date(d).getTime();
    const dayEnd = dayStart + 86400000;
    return events
      .filter((e) => (e.allDay ? e.start.slice(0, 10) <= ymd(d) && e.end.slice(0, 10) > ymd(d) : new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart))
      .sort((a, b) => (b.allDay - a.allDay) || (new Date(a.start) - new Date(b.start)));
  };
  const render = () => {
    const shown = showPast ? days : days.filter((d) => ymd(d) >= todayYmd);
    set(list,
      past.length && !showPast && shown.length < days.length
        ? h("button", { class: "btn ghost sm agenda-past", onclick: () => { showPast = true; render(); } }, icon("history"), `${past.length} ${past.length === 1 ? "früheren Tag" : "frühere Tage"} anzeigen`)
        : null,
      shown.map((d) => {
        const evs = dayEvents(d);
        const today = ymd(d) === todayYmd;
        return h("section", { class: `agenda-day ${today ? "today" : ""} ${ymd(d) < todayYmd ? "past" : ""}` },
          h("div", { class: "agenda-date" },
            h("div", { class: "num" }, d.getDate()),
            h("div", {}, h("div", { class: "wd" }, d.toLocaleDateString("de-DE", { weekday: "long" })), h("div", { class: "mo" }, d.toLocaleDateString("de-DE", { month: "long" }))),
            today ? h("span", { class: "badge accent" }, "Heute") : null),
          evs.length
            ? h("div", { class: "card agenda-list" }, evs.map((e) =>
                h("button", { class: `agenda-ev ${e.busy ? "" : "free"}`, onclick: () => openEventSheet(e, events) },
                  h("div", { class: "t" }, e.allDay ? h("b", {}, "ganztägig") : [h("b", {}, fmt.time(e.start)), h("span", {}, fmt.time(e.end))]),
                  h("div", { class: "main" }, h("div", { class: "title" }, e.title),
                    e.location ? h("div", { class: "sub" }, icon("pin"), e.location) : null,
                    e.attendees?.length ? h("div", { class: "sub" }, icon("users"), `${e.attendees.length} Teilnehmer`) : null))))
            : h("div", { class: "agenda-free" }, "Keine Termine"));
      }));
  };
  render();
  set(main, h("div", { class: "view" }, head, list,
    h("div", { class: "muted small", style: "margin-top:14px" }, `${events.length} Termine diese Woche · Zeitzone ${state.status?.timezone ?? TZ}`)));
}
