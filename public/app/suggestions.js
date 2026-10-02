// Suggestions from mail triage (proactive butler).

import { api, state } from "./api.js";
import { append, h, icon, set } from "./dom.js";
import { cardHead, go } from "./shell.js";
import { fail, toast } from "./ui.js";
import { startChat } from "./view-chat.js";

// ─── Vorschläge (proaktiver Butler) ─────────────────────────────────────────
const SUGG_ICON = { meeting: "calendar", lead: "bolt", invoice: "file", deadline: "clock", reply: "reply", newsletter: "inbox" };

export function suggestionCard(s, onChange) {
  const btns = h("div", { class: "sugg-actions" });
  const busy = (fn) => async (e) => {
    btns.querySelectorAll("button").forEach((b) => (b.disabled = true));
    e.currentTarget.classList.add("loading");
    try { await fn(); } catch (err) { fail(err); }
    onChange();
  };
  const accept = h("button", { class: "btn primary sm" }, icon("check"), h("span", {}, s.acceptLabel ?? "Annehmen"));
  accept.onclick = busy(async () => {
    const r = await api(`/api/suggestions/${s.id}/accept`, { method: "POST" });
    if (r.status === "needs_confirmation") { toast("Kritische Aktion — bitte im Chat bestätigen.", "info"); state.conversationId = r.conversationId; go("chat"); return; }
    toast(r.status === "failed" ? `Teilweise fehlgeschlagen:\n${r.result}` : "Erledigt.", r.status === "failed" ? "err" : "ok");
  });
  const edit = h("button", { class: "btn sm" }, icon("edit"), h("span", {}, "Bearbeiten"));
  edit.onclick = () => startChat(s.editPrompt, { send: false });
  const ignore = h("button", { class: "btn ghost sm" }, "Ignorieren");
  ignore.onclick = busy(() => api(`/api/suggestions/${s.id}/ignore`, { method: "POST" }));
  if (s.status === "auto") {
    const undo = h("button", { class: "btn sm" }, icon("history"), h("span", {}, "Rückgängig"));
    undo.onclick = busy(async () => { await api(`/api/suggestions/${s.id}/undo`, { method: "POST" }); toast("Rückgängig gemacht.", "ok"); });
    const okBtn = h("button", { class: "btn ghost sm" }, "OK");
    okBtn.onclick = busy(() => api(`/api/suggestions/${s.id}/ignore`, { method: "POST" }));
    append(btns, [undo, okBtn]);
  } else if (s.status === "needs_confirmation") {
    append(btns, [h("button", { class: "btn primary sm", onclick: () => { state.conversationId = s.conversationId; go("chat"); } }, icon("shield"), h("span", {}, "Im Chat bestätigen"))]);
  } else {
    append(btns, [s.actions.length ? accept : null, edit, ignore]);
  }
  const [summary, ...draft] = (s.body ?? "").split("\n\nEntwurf:\n");
  return h("div", { class: `sugg ${s.kind} ${s.status}` },
    h("div", { class: "sugg-ic" }, icon(SUGG_ICON[s.kind] ?? "bolt")),
    h("div", { class: "main" },
      h("div", { class: "title" }, s.status === "auto" ? `✓ ${s.title}` : s.title),
      summary ? h("div", { class: "sub" }, summary) : null,
      draft.length ? h("details", { class: "sugg-draft" }, h("summary", {}, "Entwurf ansehen"), h("div", {}, draft.join("\n"))) : null,
      s.actions.length && s.status === "open" ? h("details", { class: "sugg-draft" }, h("summary", {}, `Was „${s.acceptLabel ?? "Annehmen"}“ genau tut`), h("ul", {}, s.actions.map((a) => h("li", {}, a.label)))) : null,
      s.warning ? h("div", { class: "sugg-warn" }, icon("alert"), s.warning) : null,
      s.status === "auto" && s.result ? h("div", { class: "muted small" }, s.result) : null,
      btns));
}

async function suggestionsCard(onChange) {
  const data = await api("/api/suggestions").catch(() => null);
  if (!data || !data.suggestions.length) return null;
  return h("div", { class: "card sugg-card", style: "margin-bottom:16px" },
    cardHead(`Vorschläge (${data.suggestions.length})`, "bolt", h("button", { class: "btn ghost sm", onclick: () => go("settings", "?focus=triage") }, "Einstellungen")),
    h("div", { class: "card-body sugg-list" }, data.suggestions.map((s) => suggestionCard(s, onChange))));
}

export function triageSettingsCard() {
  const card = h("div", { class: "card" }, h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "spinner" })));
  const render = async () => {
    const d = await api("/api/suggestions");
    const sw = (checked, onchange, label) => { const i = h("input", { type: "checkbox", checked, "aria-label": label }); i.addEventListener("change", () => onchange(i.checked)); return h("label", { class: "switch" }, i, h("span")); };
    const save = async (patch) => { await api("/api/settings/triage", { method: "PUT", body: patch }).catch(fail); render(); };
    const check = h("button", { class: "btn sm" }, icon("refresh"), h("span", {}, "Jetzt prüfen"));
    check.onclick = async () => {
      check.disabled = true;
      try { const r = await api("/api/suggestions/check", { method: "POST" }); toast(r.skipped ? `Übersprungen: ${r.skipped}` : `${r.classified} E-Mail(s) geprüft, ${r.suggestions} Vorschlag/Vorschläge.`, "ok"); } catch (e) { fail(e); }
      render();
    };
    set(card,
      h("label", { class: "toggle-row" }, h("div", { class: "main" }, h("div", { class: "title" }, "Neue E-Mails prüfen und Vorschläge machen"),
        h("div", { class: "sub" }, `Terminanfragen, Kundenanfragen, Rechnungen, Fristen. Kleines Modell, nur neue Mails · heute ${d.usedToday} von ${d.dailyLimit}.`)),
        sw(d.settings.enabled, (v) => save({ enabled: v }), "Proaktive Hinweise")),
      h("label", { class: "toggle-row" }, h("div", { class: "main" }, h("div", { class: "title" }, "Aufgaben für Rechnungen & Fristen automatisch anlegen"),
        h("div", { class: "sub" }, "Mit „Rückgängig“ auf der Startseite.")),
        sw(d.settings.autoTasks, (v) => save({ autoTasks: v }), "Aufgaben automatisch")),
      d.settings.mutedKinds.length || d.settings.mutedSenders.length
        ? h("div", { class: "card-body", style: "padding:12px 18px" }, h("div", { class: "small muted", style: "margin-bottom:6px" }, "Stummgeschaltet (weil mehrfach ignoriert):"),
            h("div", { class: "filters", style: "flex-wrap:wrap" },
              d.settings.mutedKinds.map((k) => h("button", { class: "chip", title: "Wieder einschalten", onclick: async () => { await api("/api/settings/triage/unmute", { method: "POST", body: { kind: k } }).catch(fail); render(); } }, d.labels[k] ?? k, icon("x"))),
              d.settings.mutedSenders.map((ks) => { const [k, ...rest] = ks.split(":"); const sender = rest.join(":"); return h("button", { class: "chip", title: "Wieder einschalten", onclick: async () => { await api("/api/settings/triage/unmute", { method: "POST", body: { kind: k, sender } }).catch(fail); render(); } }, `${d.labels[k] ?? k}: ${sender}`, icon("x")); })))
        : null,
      h("div", { class: "card-body", style: "padding:12px 18px" }, check));
  };
  render().catch((e) => set(card, h("div", { class: "card-body" }, h("div", { class: "empty" }, e.message))));
  return card;
}
