// Settings: life/weather, proactive hints, cost & budget, mail accounts, voice.

import { api, state } from "./api.js";
import { $, avatar, h, icon, set } from "./dom.js";
import { pushCard, telegramCard } from "./push.js";
import { cardHead, viewHead } from "./shell.js";
import { triageSettingsCard } from "./suggestions.js";
import { applyTheme, dialog, fail, getTheme, toast } from "./ui.js";
import { RISK } from "./view-activity.js";
import { voice } from "./voice.js";

// ─── View: Einstellungen ────────────────────────────────────────────────────
/** Home location (weather, "in der Nähe") and news sources. */
function lifeSettingsCard() {
  const card = h("div", { class: "card" }, h("div", { class: "card-body" }, h("div", { class: "spinner" })));
  const render = (life) => {
    const city = h("input", { class: "field", placeholder: "Stadt oder Stadtteil, z.B. Hamburg-Ottensen", value: life.home?.name ?? "", maxlength: "100", "aria-label": "Heimatort" });
    const saveCity = async () => {
      if (city.value.trim().length < 2) return;
      try { render({ ...(await api("/api/life/settings", { method: "PUT", body: { city: city.value.trim() } })), feeds: life.feeds }); toast("Ort gespeichert.", "ok"); } catch (e) { fail(e); }
    };
    city.addEventListener("keydown", (e) => e.key === "Enter" && saveCity());
    const toggle = async (id, on) => {
      const next = on ? [...new Set([...life.newsFeeds, id])] : life.newsFeeds.filter((x) => x !== id);
      try { render({ ...(await api("/api/life/settings", { method: "PUT", body: { newsFeeds: next } })), feeds: life.feeds }); } catch (e) { fail(e); }
    };
    set(card, h("div", { class: "card-body life-settings" },
      h("label", { class: "muted small" }, "Heimatort — für Wetter, Regen-Hinweise vor Terminen und „in der Nähe“"),
      h("div", { class: "list-add" }, city, h("button", { class: "btn primary", onclick: saveCity }, "Speichern")),
      life.home ? h("div", { class: "muted small" }, icon("pin"), ` ${life.home.name}${life.home.region ? `, ${life.home.region}` : ""} · ${life.home.lat.toFixed(2)}, ${life.home.lon.toFixed(2)}`) : null,
      h("label", { class: "muted small", style: "margin-top:14px;display:block" }, "Nachrichtenquellen (kostenlose RSS-Feeds)"),
      h("div", { class: "chips" }, life.feeds.map((f) => h("button", { class: `chip ${life.newsFeeds.includes(f.id) ? "active" : ""}`, onclick: () => toggle(f.id, !life.newsFeeds.includes(f.id)) }, f.name, h("span", { class: "muted" }, ` · ${f.topic}`))))));
  };
  api("/api/life/settings").then(render).catch((e) => set(card, h("div", { class: "card-body empty" }, e.message)));
  return card;
}

function proactiveCard() {
  const card = h("div", { class: "card" }, h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "spinner" })));
  const render = (life) => {
    const i = h("input", { type: "checkbox", checked: life.proactive, "aria-label": "Hinweise aufs Handy" });
    i.addEventListener("change", async () => {
      try { render(await api("/api/life/settings", { method: "PUT", body: { proactive: i.checked } })); } catch (e) { i.checked = !i.checked; fail(e); }
    });
    set(card, h("label", { class: "toggle-row" },
      h("div", { class: "main" }, h("div", { class: "title" }, "Hinweise aufs Handy"),
        h("div", { class: "sub" }, "Losgehen-Erinnerung 20–70 Min. vor Terminen mit Ort (mit Regen-/Frost-Hinweis), überfällige Rechnungen, KI-Budget bei 80 % und 100 %. Jeder Hinweis nur einmal, nachts nur Termine. Kostenlos — ohne KI-Anfrage.")),
      h("span", { class: "switch" }, i, h("span"))));
  };
  api("/api/life/settings").then(render).catch((e) => set(card, h("div", { class: "card-body empty" }, e.message)));
  return card;
}

const usd = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function costCard() {
  const card = h("div", { class: "card" }, h("div", { class: "card-body" }, h("div", { class: "spinner" })));
  const render = async () => {
    const [u, life] = await Promise.all([api("/api/usage"), api("/api/life/settings")]);
    const pct = u.budgetUsd ? Math.round(u.ratio * 100) : 0;
    const level = !u.budgetUsd ? "" : u.ratio >= 1 ? "crit" : u.ratio >= 0.8 ? "warn" : "";
    const input = h("input", { class: "field", type: "number", min: "0", max: "10000", step: "1", inputmode: "decimal", placeholder: "z.B. 20", value: life.budgetUsd ?? "", "aria-label": "Monatsbudget in US-Dollar" });
    const save = async (patch) => {
      try { await api("/api/life/settings", { method: "PUT", body: patch }); toast("Gespeichert.", "ok"); render(); } catch (e) { fail(e); }
    };
    const saveBudget = () => {
      const v = input.value.trim() === "" ? null : Number(input.value.replace(",", "."));
      if (v !== null && (!Number.isFinite(v) || v < 0)) return toast("Bitte einen Betrag in Dollar eingeben.", "err");
      save({ budgetUsd: v });
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && saveBudget());
    const stop = h("input", { type: "checkbox", checked: life.budgetHardStop, disabled: !life.budgetUsd, "aria-label": "Harte Grenze" });
    stop.addEventListener("change", () => save({ budgetHardStop: stop.checked }));
    set(card,
      h("div", { class: `card-body cost-body ${level}` },
        h("div", { class: "cost-now" }, h("span", { class: "cost-big" }, usd(u.spentUsd)),
          h("span", { class: "muted" }, u.budgetUsd ? ` von ${usd(u.budgetUsd)} · ${pct} %` : " diesen Monat")),
        u.budgetUsd ? h("div", { class: `progress ${level}` }, h("div", { style: `width:${Math.min(100, pct)}%` })) : null,
        h("div", { class: "muted small" }, `${u.requests} Anfrage${u.requests === 1 ? "" : "n"} ans Modell seit dem 1. · Schätzung nach Anthropic-Listenpreisen (in US-Dollar)`),
        u.blocked ? h("div", { class: "banner warn", style: "margin:10px 0 0" }, "Budget aufgebraucht: JARVIS schickt bis Monatsende keine neuen Anfragen an Claude. Erhöhe das Limit oder schalte die harte Grenze ab.") : null,
        h("label", { class: "muted small", style: "margin-top:14px;display:block" }, "Monatsbudget in US-Dollar (leer = kein Limit). Ab 80 % kommt ein Hinweis aufs Handy."),
        h("div", { class: "list-add" }, input, h("button", { class: "btn primary", onclick: saveBudget }, "Speichern"))),
      h("label", { class: "toggle-row" },
        h("div", { class: "main" }, h("div", { class: "title" }, "Harte Grenze"),
          h("div", { class: "sub" }, life.budgetUsd ? "Bei 100 % keine neuen KI-Anfragen mehr (Chat, Sprache, Mail-Vorschläge). Kalender, Listen und Bestätigungen gehen weiter." : "Erst ein Monatsbudget eintragen.")),
        h("span", { class: "switch" }, stop, h("span"))),
      h("div", { class: "card-body muted small", style: "padding-top:0" }, "Tipp: Setze zusätzlich in der Anthropic Console unter Settings → Limits ein Ausgabenlimit — das greift auch dann, wenn JARVIS sich verschätzt."));
  };
  render().catch((e) => set(card, h("div", { class: "card-body empty" }, e.message)));
  return card;
}

const CAT_LABELS = {
  email: ["E-Mail organisieren", "Labels, gelesen/ungelesen, archivieren, Entwürfe"],
  calendar: ["Private Termine", "Termine ohne Gäste anlegen und ändern"],
  contacts: ["Kontakte pflegen", "Kontakte anlegen und aktualisieren"],
  tasks: ["Aufgaben", "Anlegen, ändern, erledigen"],
  reminders: ["Erinnerungen", "Erinnerungen und In-App-Benachrichtigungen"],
  memory: ["Gedächtnis", "Präferenzen speichern"],
  notes: ["Notizen & Listen", "Notizen speichern, Einkaufsliste & Co. pflegen"],
  finance: ["Finanzen", "Rechnungen erfassen und als bezahlt markieren (nie Überweisungen)"],
};
export async function viewSettings(main, params) {
  const flash = params.get("google");
  if (flash) { toast(flash === "connected" ? "Google wurde verbunden." : `Google-Verbindung fehlgeschlagen: ${flash}`, flash === "connected" ? "ok" : "err"); history.replaceState(null, "", "#settings"); }
  const [setup, integrations, perms, status] = await Promise.all([api("/api/setup"), api("/api/integrations"), api("/api/settings/permissions"), api("/api/status")]);
  const done = setup.steps.filter((s) => s.done).length;
  if (params.get("focus")) setTimeout(() => $(`#${params.get("focus")}-section`)?.scrollIntoView({ behavior: "smooth" }), 300);
  const settings = perms.settings;
  const save = async () => { try { await api("/api/settings/permissions", { method: "PUT", body: settings }); toast("Berechtigungen gespeichert.", "ok"); } catch (e) { fail(e); } };
  const sw = (checked, onchange) => { const i = h("input", { type: "checkbox", checked }); i.addEventListener("change", () => onchange(i.checked)); return h("label", { class: "switch" }, i, h("span")); };
  const LOGO = { google: ["G", "#4285f4"], microsoft: ["M", "#00a4ef"], "local-tasks": ["✓", "var(--ok)"], "local-reminders": ["⏰", "var(--warn)"] };

  set(main, h("div", { class: "view" },
    viewHead("Einstellungen", "Integrationen, Berechtigungen und System"),
    h("div", { class: "card" }, cardHead(`Einrichtung — ${done} von ${setup.steps.length}`, "bolt"),
      h("div", { class: "card-body" }, h("div", { class: "progress" }, h("div", { style: `width:${(done / setup.steps.length) * 100}%` })),
        setup.steps.map((s, i) => h("div", { class: `setup-step ${s.done ? "done" : ""}` }, h("div", { class: "n" }, s.done ? icon("check") : i + 1),
          h("div", { class: "main" }, h("div", { class: "title" }, s.title), h("div", { class: "sub" }, s.hint)))))),

    h("div", { class: "section-title" }, icon("plug"), "Integrationen"),
    h("div", { class: "card" }, integrations.map((i) => {
      const [l, c] = LOGO[i.id] ?? ["•", "var(--muted)"];
      const stateBadge = { connected: ["verbunden", "ok"], not_configured: ["nicht verbunden", "warn"], credentials_missing: ["nicht konfiguriert", "warn"], planned: ["geplant", ""] }[i.state];
      return h("div", { class: "integration" }, h("div", { class: "logo", style: `color:${c}` }, l),
        h("div", { class: "main" }, h("div", { class: "title" }, i.name, i.account ? h("span", { class: "muted", style: "font-weight:400" }, ` · ${i.account}`) : null), h("div", { class: "sub" }, i.detail)),
        h("span", { class: `badge ${stateBadge[1]}` }, stateBadge[0]),
        i.id === "google" && (i.state === "not_configured" || i.needsReconnect) ? h("a", { class: "btn primary sm", href: "/api/integrations/google/connect" }, i.needsReconnect ? "Neu verbinden" : "Verbinden") : null,
        i.id === "google" && i.state === "connected" ? h("button", { class: "btn danger sm", onclick: async () => {
          if (!(await dialog({ title: "Google trennen?", text: "Die Tokens werden gelöscht und der Zugriff bei Google widerrufen.", confirmLabel: "Trennen", danger: true }))) return;
          await api("/api/integrations/google/disconnect", { method: "POST" }).catch(fail); viewSettings(main, new URLSearchParams());
        } }, "Trennen") : null);
    })),

    h("div", { class: "section-title", id: "triage-section" }, icon("bolt"), "Proaktive Hinweise"),
    triageSettingsCard(),
    proactiveCard(),
    h("div", { class: "section-title", id: "push-section" }, icon("bell"), "Push-Benachrichtigungen"),
    pushCard(),
    h("div", { class: "section-title", id: "telegram-section" }, icon("send"), "Telegram"),
    telegramCard(),
    h("div", { class: "section-title" }, icon("mail"), "E-Mail-Konten"),
    mailAccountsCard(main),
    h("div", { class: "section-title" }, icon("w-partly"), "Wetter, Ort & Nachrichten"),
    lifeSettingsCard(),
    h("div", { class: "section-title", id: "cost-section" }, icon("bolt"), "Kosten & Budget"),
    costCard(),
    h("div", { class: "section-title" }, icon("shield"), "Berechtigungen"),
    h("div", { class: "levels" },
      [["0", "Lesen", "", "E-Mails, Kalender, Kontakte lesen und suchen. Immer erlaubt."],
       ["1", "Niedriges Risiko", "accent", "Organisieren, Entwürfe, Aufgaben. Automatisch — unten abschaltbar."],
       ["2", "Extern", "warn", "Senden, Einladen, Löschen. Immer mit deiner Bestätigung."],
       ["3", "Kritisch", "crit", "Sensible Daten, Verdacht auf Manipulation. Immer explizit bestätigen."]]
        .map(([n, l, c, t]) => h("div", { class: "card level" }, h("span", { class: `badge ${c}` }, `Stufe ${n} · ${l}`), h("p", {}, t)))),
    h("div", { class: "card" }, Object.entries(CAT_LABELS).map(([k, [l, sub]]) =>
      h("label", { class: "toggle-row" }, h("div", { class: "main" }, h("div", { class: "title" }, l), h("div", { class: "sub" }, sub)),
        sw(settings.autoApproveLowRisk[k] ?? false, (v) => { settings.autoApproveLowRisk[k] = v; save(); })))),
    h("details", { class: "fold" }, h("summary", { class: "section-title" }, icon("settings"), `Einzelne Tools (${perms.tools.length})`),
      h("div", { class: "card" }, perms.tools.map((t) =>
        h("label", { class: "toggle-row" },
          h("div", { class: "main" }, h("div", { class: "title mono" }, t.name), h("div", { class: "sub" }, t.description)),
          h("span", { class: `badge ${RISK[t.risk]?.[1] ?? ""}` }, `Stufe ${t.risk}`),
          sw(!settings.disabledTools.includes(t.name), (v) => { settings.disabledTools = v ? settings.disabledTools.filter((n) => n !== t.name) : [...settings.disabledTools, t.name]; save(); }))))),

    h("div", { class: "section-title" }, icon("mic"), "Sprache"),
    voiceSettingsCard(),
    h("div", { class: "section-title" }, icon("settings"), "System"),
    h("div", { class: "card" }, h("dl", { class: "kv" },
      h("dt", {}, "Modell"), h("dd", {}, `${status.model} ${status.llmConfigured ? "" : "(nicht konfiguriert)"}`),
      h("dt", {}, "Hosting"), h("dd", {}, status.hosting),
      h("dt", {}, "Datenbank"), h("dd", {}, status.database),
      h("dt", {}, "Zeitzone"), h("dd", {}, status.timezone),
      h("dt", {}, "Design"), h("dd", {}, h("div", { class: "filters" }, [["system", "System"], ["dark", "Dunkel"], ["light", "Hell"]].map(([k, l]) =>
        h("button", { class: `chip ${getTheme() === k ? "active" : ""}`, onclick: () => { applyTheme(k); viewSettings(main, new URLSearchParams()); } }, l)))))),
  ));
}

// ─── E-Mail-Konten (IMAP/SMTP) ─────────────────────────────────────────────
function mailAccountsCard(main) {
  const card = h("div", { class: "card" }, h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "spinner" })));
  const reload = () => viewSettings(main, new URLSearchParams());
  api("/api/email-accounts").then((data) => {
    const all = [...(data.gmail ? [{ email: data.gmail, label: "Gmail (über Google verbunden)", gmail: true }] : []), ...data.accounts.map((a) => ({ ...a, label: `${a.name ? `${a.name} · ` : ""}IMAP ${a.imap.host}` }))];
    const rows = all.map((a) =>
      h("div", { class: "integration" },
        avatar(a.email),
        h("div", { class: "main" }, h("div", { class: "title" }, a.email), h("div", { class: "sub" }, a.label)),
        data.defaultAccount === a.email || (all.length === 1)
          ? h("span", { class: "badge accent" }, "Standard-Absender")
          : h("button", { class: "btn ghost sm", onclick: async () => { await api("/api/email-accounts/default", { method: "PUT", body: { email: a.email } }).catch(fail); reload(); } }, "Als Standard"),
        a.gmail ? null : h("button", { class: "btn ghost icon sm", "aria-label": "Entfernen", onclick: async () => {
          if (!(await dialog({ title: `${a.email} entfernen?`, text: "JARVIS verliert den Zugriff auf dieses Postfach. Das gespeicherte Passwort wird gelöscht.", confirmLabel: "Entfernen", danger: true }))) return;
          await api(`/api/email-accounts/${a.id}`, { method: "DELETE" }).catch(fail); reload();
        } }, icon("trash"))));

    // Add form
    const presetSel = h("select", { class: "field", id: "ma-preset" }, data.presets.map((p) => h("option", { value: p.id }, p.label)));
    const f = {
      email: h("input", { class: "field", id: "ma-email", type: "email", placeholder: "levin@feidler.de", required: true, autocomplete: "off" }),
      name: h("input", { class: "field", id: "ma-name", placeholder: "Anzeigename, z.B. Levin Feidler" }),
      username: h("input", { class: "field", id: "ma-user", placeholder: "Benutzername (meist die E-Mail-Adresse)", autocomplete: "off" }),
      password: h("input", { class: "field", id: "ma-pass", type: "password", placeholder: "Postfach-Passwort", required: true, autocomplete: "new-password" }),
      imapHost: h("input", { class: "field", id: "ma-imap", placeholder: "IMAP-Server" }),
      imapPort: h("input", { class: "field", id: "ma-imap-port", type: "number", min: 1, max: 65535 }),
      smtpHost: h("input", { class: "field", id: "ma-smtp", placeholder: "SMTP-Server" }),
      smtpPort: h("input", { class: "field", id: "ma-smtp-port", type: "number", min: 1, max: 65535 }),
    };
    const hint = h("div", { class: "muted small" });
    const err = h("div", { class: "error-text" });
    let preset;
    const applyPreset = () => {
      preset = data.presets.find((p) => p.id === presetSel.value);
      f.imapHost.value = preset.imap.host; f.imapPort.value = preset.imap.port;
      f.smtpHost.value = preset.smtp.host; f.smtpPort.value = preset.smtp.port;
      f.imapHost.placeholder = f.smtpHost.placeholder = preset.id === "allinkl" ? "w0123456.kasserver.com" : "z.B. imap.anbieter.de";
      hint.textContent = preset.hint;
    };
    presetSel.addEventListener("change", applyPreset);
    f.email.addEventListener("input", () => { f.username.placeholder = f.email.value || "Benutzername (meist die E-Mail-Adresse)"; });
    f.imapHost.addEventListener("input", () => { if (preset?.id === "allinkl") f.smtpHost.value = f.imapHost.value; });
    applyPreset();
    const submit = h("button", { class: "btn primary", type: "submit" }, "Verbindung testen & speichern");
    const form = h("form", { class: "card-body", style: "display:grid;gap:10px;padding:18px", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      submit.disabled = true;
      submit.textContent = "Teste Verbindung …";
      const port = (v, d) => Number(v) || d;
      try {
        await api("/api/email-accounts", { method: "POST", body: {
          email: f.email.value.trim(), name: f.name.value.trim() || undefined, preset: preset.id,
          username: f.username.value.trim() || f.email.value.trim(), password: f.password.value,
          imap: { host: f.imapHost.value.trim(), port: port(f.imapPort.value, 993), secure: port(f.imapPort.value, 993) === 993 },
          smtp: { host: f.smtpHost.value.trim(), port: port(f.smtpPort.value, 465), secure: port(f.smtpPort.value, 465) === 465 },
        } });
        toast(`${f.email.value} verbunden.`, "ok");
        reload();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        f.password.value = "";
        submit.disabled = false;
        submit.textContent = "Verbindung testen & speichern";
      }
    } },
      h("div", { class: "title", style: "font-weight:600" }, "Postfach hinzufügen (1&1, All-Inkl, …)"),
      h("label", { class: "small muted", for: "ma-preset" }, "Anbieter"), presetSel, hint,
      h("div", { class: "grid2" }, f.email, f.name),
      h("div", { class: "grid2" }, f.username, f.password),
      h("div", { class: "grid2" }, h("div", { class: "hostport" }, f.imapHost, f.imapPort), h("div", { class: "hostport" }, f.smtpHost, f.smtpPort)),
      h("div", { class: "muted small" }, "Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt. Vor dem Speichern prüft JARVIS die Anmeldung per IMAP und SMTP."),
      err, h("div", {}, submit));
    set(card, ...(rows.length ? rows : [h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "muted" }, "Noch kein Postfach verbunden."))]), h("details", { class: "fold", open: rows.length === 0 }, h("summary", { class: "integration", style: "cursor:pointer" }, icon("plus"), h("div", { class: "main title" }, "Postfach hinzufügen")), form));
  }).catch((e) => set(card, h("div", { class: "card-body" }, h("div", { class: "empty" }, e.message))));
  return card;
}

// ─── Sprach-Einstellungen ──────────────────────────────────────────────────
function voiceSettingsCard() {
  if (!voice.canSpeak && !voice.canListen) {
    return h("div", { class: "card" }, h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "muted" }, "Dieser Browser unterstützt keine Sprachfunktionen. Chrome, Edge oder Safari verwenden.")));
  }
  const sel = h("select", { class: "field", id: "voice-select", "aria-label": "Stimme" });
  const fill = () => {
    const list = voice.voices();
    const cur = voice.pickVoice();
    set(sel, ...(list.length ? list.map((v) => h("option", { value: v.voiceURI, selected: cur?.voiceURI === v.voiceURI }, `${v.name}${v.localService ? "" : " (online)"}`)) : [h("option", {}, "Keine deutsche Stimme gefunden")]));
  };
  fill();
  if (voice.canSpeak) speechSynthesis.addEventListener?.("voiceschanged", fill);
  sel.addEventListener("change", () => { voice.prefs.voiceURI = sel.value; voice.save(); });
  const rate = h("input", { type: "range", id: "voice-rate", min: "0.8", max: "1.4", step: "0.05", value: String(voice.prefs.rate), style: "width:100%" });
  const rateLabel = h("span", { class: "muted small" }, `${voice.prefs.rate.toFixed(2)}×`);
  rate.addEventListener("input", () => { voice.prefs.rate = Number(rate.value); rateLabel.textContent = `${voice.prefs.rate.toFixed(2)}×`; voice.save(); });
  return h("div", { class: "card" },
    h("div", { class: "card-body", style: "padding:18px;display:grid;gap:12px" },
      h("div", { class: "grid2" },
        h("div", {}, h("label", { class: "small muted", for: "voice-select" }, "Stimme"), sel),
        h("div", {}, h("label", { class: "small muted", for: "voice-rate" }, "Sprechtempo "), rateLabel, rate)),
      h("label", { class: "toggle-row" },
        h("div", { class: "main" }, h("div", { class: "title" }, "Dazwischenreden"), h("div", { class: "sub" }, "Fängst du an zu sprechen, während JARVIS redet, hört er sofort auf und hört dir zu (Startseite).")),
        (() => { const cb = h("input", { type: "checkbox", checked: voice.prefs.bargeIn !== false, "aria-label": "Dazwischenreden" }); cb.addEventListener("change", () => { voice.prefs.bargeIn = cb.checked; voice.save(); }); return h("span", { class: "switch" }, cb, h("span")); })()),
      h("div", {}, h("button", { class: "btn sm", onclick: () => { voice.unlock(); voice.speak(`Guten Tag${state.userName ? `, ${state.userName}` : ""}. So klinge ich. Was kann ich für dich tun?`); } }, icon("volume"), "Probe anhören")),
      h("div", { class: "muted small" },
        `Spracheingabe: ${voice.canListen ? "verfügbar" : "nicht verfügbar in diesem Browser"} · Sprachausgabe: ${voice.canSpeak ? "verfügbar" : "nicht verfügbar"}. `,
        "Im Chat: 🎤 zum Sprechen, „Gespräch“ für freihändigen Dialog (beenden mit „Stopp“). ",
        "Datenschutz: In Chrome/Edge wird die Aufnahme zur Erkennung an den Browser-Hersteller (Google/Microsoft) gesendet; Safari erkennt teils auf dem Gerät. ",
        "Sicherheit: Ein gesprochenes „Ja“ bestätigt nur normale Aktionen, die JARVIS vorher vorgelesen hat. Kritische Aktionen immer per Knopf.")));
}
