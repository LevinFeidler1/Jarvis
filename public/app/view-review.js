// Weekly review view.

import { api } from "./api.js";
import { fmt, h, icon, set } from "./dom.js";
import { cardHead, go, viewHead } from "./shell.js";
import { startChat } from "./view-chat.js";

// ─── View: Wochenrückblick ──────────────────────────────────────────────────
export async function viewReview(main, params) {
  const offset = Math.min(0, Number(params.get("w") ?? 0) || 0);
  const r = await api(`/api/review?offset=${offset}`);
  const num = (key) => r.actions.find((a) => a.key === key)?.count ?? 0;
  const tile = (n, l, ic, cls = "") => h("div", { class: "card stat static" }, h("div", { class: `ic ${cls}` }, icon(ic)), h("div", {}, h("div", { class: "n" }, n), h("div", { class: "l" }, l)));
  const eur = (usd) => usd.toLocaleString("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: usd < 1 ? 3 : 2 });
  const cacheShare = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens
    ? Math.round((r.usage.cacheReadTokens / (r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens)) * 100) : 0;
  const list = (items, empty) => items.length ? h("div", {}, items) : h("div", { class: "muted small", style: "padding:4px 0" }, empty);
  set(main, h("div", { class: "view" },
    viewHead("Wochenrückblick", `${r.label}${r.isCurrentWeek ? " · diese Woche" : ""}`,
      h("button", { class: "btn icon", "aria-label": "Vorherige Woche", onclick: () => go("review", `?w=${offset - 1}`) }, icon("left")),
      offset < 0 ? h("button", { class: "btn icon", "aria-label": "Nächste Woche", onclick: () => go("review", `?w=${offset + 1}`) }, icon("right")) : null,
      h("button", { class: "btn primary", onclick: () => startChat(`Erstelle meinen Wochenrückblick${offset ? ` für week_offset ${offset}` : ""}: Was wurde erledigt, was ist offen geblieben, was steht an? Schließe mit den 3 wichtigsten Punkten.`) }, icon("bolt"), h("span", {}, "Zusammenfassen"))),
    h("div", { class: "stat-row review-stats" },
      tile(num("emailsSent"), "E-Mails gesendet", "mail"),
      tile(num("eventsCreated") + num("eventsChanged"), "Termine geplant", "calendar"),
      tile(r.tasks.completed.length, "Aufgaben erledigt", "tasks", "ok"),
      tile(r.automationRuns, "Automationen gelaufen", "bolt")),
    h("div", { class: "grid" },
      h("div", { class: "card col-6" }, cardHead("Erledigt", "check"), h("div", { class: "card-body" },
        list(r.tasks.completed.map((t) => h("div", { class: "rv-row" }, icon("check"), h("span", {}, t.title), h("span", { class: "muted small" }, fmt.rel(t.completedAt)))), "Keine erledigten Aufgaben."),
        r.highlights.length ? [h("div", { class: "rv-sub" }, "Von JARVIS ausgeführt"), r.highlights.map((x) => h("div", { class: "rv-row" }, icon(x.tool.includes("event") || x.tool.includes("invit") ? "calendar" : "mail"), h("span", {}, x.description), h("span", { class: "muted small" }, fmt.rel(x.at))))] : null,
        r.actions.length ? h("div", { class: "rv-chips" }, r.actions.map((a) => h("span", { class: "badge" }, `${a.label}: ${a.count}`))) : null)),
      h("div", { class: "card col-6" }, cardHead("Offen & nächste Woche", "clock"), h("div", { class: "card-body" },
        r.tasks.openOverdue ? h("div", { class: "rv-row warn" }, icon("alert"), h("span", {}, `${r.tasks.openOverdue} überfällige Aufgabe${r.tasks.openOverdue === 1 ? "" : "n"}`), h("button", { class: "btn ghost sm", onclick: () => go("tasks") }, "Ansehen")) : null,
        h("div", { class: "rv-sub" }, "Fällig nächste Woche"),
        list(r.tasks.dueNextWeek.map((t) => h("div", { class: "rv-row" }, icon("tasks"), h("span", {}, t.title), h("span", { class: "muted small" }, new Date(t.due).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })))), "Nichts fällig."),
        h("div", { class: "rv-sub" }, "Termine nächste Woche"),
        r.nextWeek.events ? list(r.nextWeek.events.map((e) => h("div", { class: "rv-row" }, icon("calendar"), h("span", {}, e.title), h("span", { class: "muted small" }, e.allDay ? new Date(e.start).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) : fmt.dt(e.start)))), "Keine Termine.")
          : h("div", { class: "muted small" }, "Kalender nicht verbunden."))),
      h("div", { class: "card col-6" }, cardHead("Aktivität", "activity"), h("div", { class: "card-body" }, h("dl", { class: "kv" },
        h("dt", {}, "Unterhaltungen"), h("dd", {}, r.conversations),
        h("dt", {}, "Erinnerungen ausgelöst"), h("dd", {}, r.remindersFired),
        h("dt", {}, "Bestätigt / abgelehnt"), h("dd", {}, `${r.confirmations.approved} / ${r.confirmations.rejected}`),
        h("dt", {}, "Neue Aufgaben"), h("dd", {}, r.tasks.created)))),
      h("div", { class: "card col-6" }, cardHead("Kosten (Claude API)", "bolt"), h("div", { class: "card-body" },
        h("div", { class: "rv-cost" }, `ca. ${eur(r.usage.costUsd)}`),
        h("dl", { class: "kv" },
          h("dt", {}, "Anfragen ans Modell"), h("dd", {}, r.usage.requests),
          h("dt", {}, "Tokens (ein/aus)"), h("dd", {}, `${(r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens).toLocaleString("de-DE")} / ${r.usage.outputTokens.toLocaleString("de-DE")}`),
          h("dt", {}, "Aus dem Cache"), h("dd", {}, `${cacheShare} %`),
          h("dt", {}, "Websuchen"), h("dd", {}, r.usage.webSearches),
          h("dt", {}, "Gekürzte Unterhaltungen"), h("dd", {}, r.usage.compactions)),
        h("div", { class: "muted small", style: "margin-top:8px" }, "Schätzung nach Listenpreisen. Genaue Abrechnung: console.anthropic.com → Usage.")))),
  ));
}
