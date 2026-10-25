// Activity & audit view.

import { api, state } from "./api.js";
import { fmt, h, icon, set } from "./dom.js";
import { route, viewHead } from "./shell.js";
import { fail, toast } from "./ui.js";
import { STEP_ICON, confirmCard } from "./view-chat.js";

// ─── View: Aktivität ────────────────────────────────────────────────────────
const STATUS = {
  planned: ["geplant", ""], executing: ["läuft", "accent"], succeeded: ["erfolgreich", "ok"], failed: ["fehlgeschlagen", "err"],
  partially_succeeded: ["teilweise", "warn"], awaiting_confirmation: ["wartet", "warn"], rejected: ["abgelehnt", ""],
  expired: ["abgelaufen", ""], denied: ["verweigert", "err"],
};
export const RISK = [["Lesen", ""], ["Niedrig", "accent"], ["Extern", "warn"], ["Kritisch", "crit"]];

export async function viewActivity(main) {
  const [pending, activity, audit] = await Promise.all([api("/api/confirmations"), api("/api/activity"), api("/api/audit")]);
  const filters = { all: "Alle", awaiting_confirmation: "Wartet", succeeded: "Erfolgreich", failed: "Fehler", autonomous: "Autonom" };
  const shown = activity.filter((a) => state.activityFilter === "all" || a.status === state.activityFilter || (state.activityFilter === "failed" && a.status === "denied") || (state.activityFilter === "autonomous" && a.autonomous));
  const undoBtn = (a) => {
    const b = h("button", { class: "btn sm", title: "Rückgängig" }, icon("history"), h("span", {}, "Rückgängig"));
    b.onclick = async () => {
      b.disabled = true;
      try { const r = await api(`/api/activity/${a.id}/undo`, { method: "POST" }); toast(`Rückgängig: ${r.label}`, "ok"); } catch (e) { fail(e); }
      viewActivity(main);
    };
    return b;
  };
  set(main, h("div", { class: "view" },
    viewHead("Aktivität", "Alles, was JARVIS getan hat oder tun möchte — nachvollziehbar.", h("button", { class: "btn ghost", onclick: () => route() }, icon("refresh"), "Aktualisieren")),
    pending.length ? h("div", {}, h("div", { class: "section-title" }, icon("shield"), `Wartet auf Bestätigung (${pending.length})`),
      pending.map((p) => confirmCard(p, () => viewActivity(main)))) : null,
    h("div", { class: "section-title" }, "Verlauf"),
    h("div", { class: "filters", style: "margin-bottom:12px" }, Object.entries(filters).map(([k, l]) =>
      h("button", { class: `chip ${state.activityFilter === k ? "active" : ""}`, onclick: () => { state.activityFilter = k; viewActivity(main); } }, l))),
    h("div", { class: "card" }, shown.length ? h("div", { class: "timeline" }, shown.map((a) => {
      const [label, cls] = STATUS[a.status] ?? [a.status, ""];
      return h("div", { class: "tl-item" },
        h("div", { class: `tl-ic ${a.status}` }, a.status === "executing" ? h("div", { class: "spinner" }) : icon(STEP_ICON[a.status] ?? "dot")),
        h("div", { style: "min-width:0" }, h("div", { class: "title" }, a.description.split("\n")[0]),
          h("div", { class: "sub" }, `${fmt.dt(a.createdAt)} · ${a.toolName}${a.error ? ` · ${a.error}` : ""}`)),
        h("div", { class: "right" },
          a.autonomous ? h("span", { class: "badge accent", title: "Von einer Automation selbst ausgeführt" }, "autonom") : null,
          a.undoneAt ? h("span", { class: "badge" }, "rückgängig gemacht") : null,
          h("span", { class: `badge ${RISK[a.risk]?.[1] ?? ""}` }, RISK[a.risk]?.[0] ?? a.risk), h("span", { class: `badge ${cls}` }, label),
          a.canUndo ? undoBtn(a) : null));
    })) : h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "empty" }, "Noch keine Einträge."))),
    h("details", { class: "fold" },
      h("summary", { class: "section-title" }, icon("shield"), "Audit-Log (externe & ändernde Aktionen)"),
      h("div", { class: "card", style: "overflow-x:auto" }, audit.length ? h("table", { class: "audit" },
        h("thead", {}, h("tr", {}, ["Zeit", "Aktion", "Ziel", "Status", "Bestätigt", "Stufe"].map((t) => h("th", {}, t)))),
        h("tbody", {}, audit.map((a) => h("tr", {},
          h("td", { class: "mono" }, a.ts.replace("T", " ").slice(0, 16)), h("td", { class: "mono" }, a.action), h("td", {}, a.target ?? "–"),
          h("td", {}, h("span", { class: `badge ${a.status === "SUCCESS" ? "ok" : a.status === "FAILED" || a.status === "DENIED" ? "err" : ""}` }, a.status)),
          h("td", {}, a.userConfirmation ? "ja" : "nein"), h("td", {}, a.risk)))))
        : h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "empty" }, "Audit-Log ist leer."))))));
}
