// Automations view.

import { api } from "./api.js";
import { fmt, h, icon, set } from "./dom.js";
import { go, viewHead } from "./shell.js";
import { dialog, fail, toast } from "./ui.js";

// ─── View: Automationen ─────────────────────────────────────────────────────
const WEEKDAYS = [[1, "Mo"], [2, "Di"], [3, "Mi"], [4, "Do"], [5, "Fr"], [6, "Sa"], [7, "So"]];
const AUTO_STATUS = { ok: ["erledigt", "ok"], waiting: ["wartet auf dich", "warn"], nothing: ["nichts Neues", ""], error: ["Fehler", "err"] };

let ALLOWLISTABLE = [];
function automationEditor(a) {
  return new Promise((resolve) => {
    const allowed = new Set(a?.allowedTools ?? []);
    const limitField = h("input", { class: "field small", id: "au-limit", type: "number", min: 1, max: 200, value: a?.dailyActionLimit ?? 20, style: "width:110px" });
    const allowBox = h("div", { class: "allow-list" }, ALLOWLISTABLE.map((t) => {
      const cb = h("input", { type: "checkbox", checked: allowed.has(t.name), onchange: (e) => (e.target.checked ? allowed.add(t.name) : allowed.delete(t.name)) });
      return h("label", { class: "allow-item" }, cb, h("div", {}, h("div", { class: "mono" }, t.name), h("div", { class: "muted small" }, t.description, t.rule ? h("b", {}, ` · ${t.rule}`) : null)));
    }));
    const t = a?.trigger ?? { type: "schedule", time: "07:00", days: [1, 2, 3, 4, 5] };
    let type = t.type;
    const days = new Set(t.type === "schedule" ? t.days : [1, 2, 3, 4, 5]);
    const f = {
      name: h("input", { class: "field", id: "au-name", maxlength: 80, required: true, placeholder: "z.B. Morgen-Briefing", value: a?.name ?? "" }),
      prompt: h("textarea", { class: "field", id: "au-prompt", rows: 5, maxlength: 2000, required: true, style: "height:auto;padding:10px 12px", placeholder: "Was soll JARVIS jedes Mal tun? z.B. „Fasse meine Termine und wichtigen E-Mails für heute zusammen.“" }, a?.prompt ?? ""),
      time: h("input", { class: "field", id: "au-time", type: "time", value: t.type === "schedule" ? t.time : "07:00" }),
      from: h("input", { class: "field", id: "au-from", maxlength: 200, placeholder: "Absender enthält … (optional)", value: t.type === "email" ? t.from ?? "" : "" }),
      subject: h("input", { class: "field", id: "au-subject", maxlength: 200, placeholder: "Betreff enthält … (optional)", value: t.type === "email" ? t.subject ?? "" : "" }),
    };
    const dayChips = h("div", { class: "filters day-chips" }, WEEKDAYS.map(([n, l]) =>
      h("button", { type: "button", class: `chip ${days.has(n) ? "active" : ""}`, "aria-pressed": String(days.has(n)), onclick: (e) => {
        days.has(n) ? days.delete(n) : days.add(n);
        e.currentTarget.classList.toggle("active", days.has(n));
        e.currentTarget.setAttribute("aria-pressed", String(days.has(n)));
      } }, l)));
    const scheduleBox = h("div", { style: "display:grid;gap:8px" }, h("label", { class: "small muted", for: "au-time" }, "Uhrzeit"), f.time, h("div", { class: "small muted" }, "Wochentage"), dayChips);
    const emailBox = h("div", { style: "display:grid;gap:8px" }, h("div", { class: "small muted" }, "Läuft, sobald eine neue passende E-Mail eingeht (Prüfung alle 5 Minuten, in allen Postfächern)."), f.from, f.subject);
    const seg = h("div", { class: "filters" });
    const renderType = () => {
      set(seg, [["schedule", "Zeitplan"], ["email", "Neue E-Mail"]].map(([k, l]) => h("button", { type: "button", class: `chip ${type === k ? "active" : ""}`, onclick: () => { type = k; renderType(); } }, l)));
      scheduleBox.style.display = type === "schedule" ? "grid" : "none";
      emailBox.style.display = type === "email" ? "grid" : "none";
    };
    renderType();
    const err = h("div", { class: "error-text" });
    const close = (v) => { wrap.remove(); resolve(v); };
    const form = h("form", { class: "modal contact-modal", role: "dialog", "aria-modal": "true", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const trigger = type === "schedule"
        ? { type, time: f.time.value || "07:00", days: [...days].sort() }
        : { type, ...(f.from.value.trim() ? { from: f.from.value.trim() } : {}), ...(f.subject.value.trim() ? { subject: f.subject.value.trim() } : {}) };
      if (type === "schedule" && !trigger.days.length) { err.textContent = "Mindestens einen Wochentag wählen."; return; }
      const body = { name: f.name.value.trim(), prompt: f.prompt.value.trim(), trigger, allowedTools: [...allowed], dailyActionLimit: Math.max(1, Math.min(200, Number(limitField.value) || 20)) };
      try {
        close(a?.id ? await api(`/api/automations/${a.id}`, { method: "PATCH", body }) : await api("/api/automations", { method: "POST", body }));
      } catch (ex) { err.textContent = ex.message; }
    } },
      h("h3", {}, a?.id ? "Automation bearbeiten" : "Neue Automation"),
      h("label", { class: "small muted", for: "au-name" }, "Name"), f.name,
      h("div", { class: "small muted" }, "Auslöser"), seg, scheduleBox, emailBox,
      h("label", { class: "small muted", for: "au-prompt" }, "Auftrag an JARVIS"), f.prompt,
      h("details", { class: "fold allow-fold", open: allowed.size > 0 },
        h("summary", { class: "small" }, icon("shield"), `Selbstständig erlauben (Stufe 2) — ${allowed.size ? `${allowed.size} freigegeben` : "nichts freigegeben"}`),
        h("div", { class: "muted small" }, "Lesen und Stufe 1 (Labels, Archivieren, Aufgaben …) darf jede Automation. Hier gibst du zusätzliche Werkzeuge nur für diese Automation frei. Nie ohne dich: E-Mails an neue Empfänger, Termine mit Gästen, Löschen ohne Papierkorb, Zahlungen, Verträge, Logins, alles Kritische."),
        allowBox,
        h("label", { class: "small muted", for: "au-limit", style: "display:flex;align-items:center;gap:10px;margin-top:6px" }, "Höchstens", limitField, "selbstständige Aktionen pro Tag")),
      err,
      h("div", { class: "foot" }, h("button", { class: "btn ghost", type: "button", onclick: () => close(null) }, "Abbrechen"), h("button", { class: "btn primary", type: "submit" }, "Speichern")));
    const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close(null) }, form);
    wrap.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
    document.body.append(wrap);
    f.name.focus();
  });
}

export async function viewAutomations(main) {
  const data = await api("/api/automations");
  ALLOWLISTABLE = data.allowlistable ?? [];
  const pauseBtn = h("button", { class: `btn ${data.paused.paused ? "primary" : "danger"}` }, icon(data.paused.paused ? "bolt" : "stop"), h("span", {}, data.paused.paused ? "Fortsetzen" : "Alle pausieren"));
  pauseBtn.onclick = async () => {
    if (!data.paused.paused && !(await dialog({ title: "Alle Automationen pausieren?", text: "Not-Aus: Keine Automation läuft mehr, bis du fortsetzt — auch keine E-Mail-Auslöser.", confirmLabel: "Pausieren", danger: true }))) return;
    await api("/api/automations/pause", { method: "PUT", body: { paused: !data.paused.paused } }).catch(fail);
    viewAutomations(main);
  };
  const reload = () => viewAutomations(main);
  const sw = (checked, onchange) => { const i = h("input", { type: "checkbox", checked, "aria-label": "Aktiv" }); i.addEventListener("change", () => onchange(i.checked)); return h("label", { class: "switch" }, i, h("span")); };
  const card = (a) => {
    const st = a.lastStatus ? AUTO_STATUS[a.lastStatus] : null;
    const runBtn = h("button", { class: "btn sm" }, icon("bolt"), h("span", {}, "Jetzt ausführen"));
    runBtn.onclick = async () => {
      runBtn.disabled = true;
      set(runBtn, h("span", { class: "spinner sm" }), h("span", {}, "Läuft …"));
      try {
        const r = await api(`/api/automations/${a.id}/run`, { method: "POST" });
        toast(r.status === "error" ? r.text : r.status === "nothing" ? "Nichts Neues." : "Fertig — Ergebnis wurde als Benachrichtigung verschickt.", r.status === "error" ? "err" : "ok");
      } catch (e) { fail(e); }
      reload();
    };
    return h("div", { class: `card auto ${a.enabled ? "" : "off"}` },
      h("div", { class: "auto-head" },
        h("div", { class: "sheet-ic" }, icon(a.trigger.type === "email" ? "mail" : "clock")),
        h("div", { class: "main" }, h("div", { class: "title" }, a.name), h("div", { class: "sub" }, a.triggerText, a.enabled && a.nextRunAt && a.trigger.type === "schedule" ? ` · nächste: ${fmt.dt(a.nextRunAt)}` : "")),
        sw(a.enabled, async (v) => { await api(`/api/automations/${a.id}`, { method: "PATCH", body: { enabled: v } }).catch(fail); reload(); })),
      h("div", { class: "auto-prompt" }, a.prompt),
      a.allowedTools?.length || a.autonomousToday ? h("div", { class: "auto-allow" }, icon("shield"),
        a.allowedTools?.length ? h("span", {}, `Selbstständig: ${a.allowedTools.join(", ")}`) : h("span", {}, "Nur Stufe 0–1 selbstständig"),
        h("span", { class: "muted" }, ` · heute ${a.autonomousToday ?? 0}/${a.dailyActionLimit} Aktionen`)) : null,
      a.lastRunAt ? h("div", { class: "auto-last" },
        h("div", { class: "auto-last-head" }, st ? h("span", { class: `badge ${st[1]}` }, st[0]) : null, h("span", { class: "muted small" }, `zuletzt ${fmt.rel(a.lastRunAt)} · ${a.runCount}× gelaufen`)),
        a.lastResult ? h("div", { class: "small auto-result" }, a.lastResult.length > 280 ? `${a.lastResult.slice(0, 280)} …` : a.lastResult) : null) : null,
      h("div", { class: "auto-actions" },
        runBtn,
        a.lastConversationId ? h("button", { class: "btn ghost sm", "aria-label": "Verlauf öffnen", onclick: () => go("chat", `?c=${a.lastConversationId}`) }, icon("chat"), h("span", { class: "hide-mobile" }, "Verlauf")) : null,
        h("span", { style: "flex:1" }),
        h("button", { class: "btn ghost icon sm", "aria-label": `${a.name} bearbeiten`, onclick: async () => { if (await automationEditor(a)) { toast("Gespeichert.", "ok"); reload(); } } }, icon("edit")),
        h("button", { class: "btn ghost icon sm", "aria-label": `${a.name} löschen`, onclick: async () => {
          if (!(await dialog({ title: `„${a.name}“ löschen?`, text: "Die Automation läuft danach nicht mehr.", confirmLabel: "Löschen", danger: true }))) return;
          await api(`/api/automations/${a.id}`, { method: "DELETE" }).catch(fail); reload();
        } }, icon("trash"))));
  };
  const have = new Set(data.automations.map((a) => a.name));
  const templates = data.templates.filter((t) => !have.has(t.name));
  set(main, h("div", { class: "view" },
    viewHead("Automationen", "JARVIS erledigt Dinge von selbst und schickt dir das Ergebnis aufs Handy.",
      pauseBtn,
      h("button", { class: "btn primary", onclick: async () => { if (await automationEditor(null)) { toast("Automation angelegt.", "ok"); reload(); } } }, icon("plus"), h("span", {}, "Neue Automation"))),
    data.paused.paused ? h("div", { class: "banner warn", style: "max-width:none" }, icon("stop"),
      h("div", { style: "flex:1" }, h("b", {}, "Not-Aus aktiv: "), `Alle Automationen sind seit ${fmt.rel(data.paused.since)} pausiert.`)) : null,
    data.pushDevices ? null : h("div", { class: "banner warn", style: "max-width:none" }, icon("bell"),
      h("div", { style: "flex:1" }, h("b", {}, "Push ist noch aus. "), "Ohne Push siehst du Ergebnisse nur hier und unter Benachrichtigungen."),
      h("button", { class: "btn sm", onclick: () => go("settings", "?focus=push") }, "Einrichten")),
    data.automations.length ? h("div", { class: "auto-grid" }, data.automations.map(card))
      : h("div", { class: "empty" }, "Noch keine Automationen. Nimm eine Vorlage oder sag im Chat z.B. „Schick mir jeden Montag um 8 eine Wochenübersicht.“"),
    templates.length ? [h("div", { class: "section-title" }, icon("memory"), "Vorlagen"),
      h("div", { class: "tpl-grid" }, templates.map((t) =>
        h("button", { class: "card tpl", onclick: async () => { if (await automationEditor({ ...t, id: undefined })) { toast(`„${t.name}“ angelegt.`, "ok"); reload(); } } },
          h("div", { class: "title" }, t.name), h("div", { class: "sub" }, t.description), h("span", { class: "badge accent" }, icon("plus"), "Hinzufügen"))))] : null,
    data.cronConfigured ? null : h("div", { class: "muted small", style: "margin-top:14px" }, "Hinweis: CRON_SECRET ist nicht gesetzt — Zeitpläne laufen nur, solange JARVIS lokal läuft.")));
}
