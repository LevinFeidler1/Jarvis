// Chat view: streaming answers, attachments, confirmations, history.

import { api, apiStream, state } from "./api.js";
import { $, fmt, greeting, h, icon, logoMark, markdown, set } from "./dom.js";
import { FILE_ACCEPT, FILE_ICON, dropZone, fmtSize, uploadFile } from "./files-io.js";
import { go, isMobile, refreshCounts, route } from "./shell.js";
import { dialog, fail, toast } from "./ui.js";
import { speakReply, startVoiceInput, voice, voiceUi } from "./voice.js";

// ─── View: Chat ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  ["sun", "Guten Morgen, JARVIS.", "Tagesbriefing mit Terminen, Mails und Aufgaben"],
  ["inbox", "Was muss ich heute beantworten?", "Priorisierte Übersicht deines Posteingangs"],
  ["calendar", "Wann habe ich nächste Woche 60 Minuten frei?", "Freie Zeitfenster finden"],
  ["tasks", "Was habe ich diese Woche noch offen?", "Aufgaben und Deadlines"],
];

let pendingPrefill = null;
export function startChat(text, { send = true, newConversation = true } = {}) {
  if (newConversation) state.conversationId = null;
  pendingPrefill = { text, send };
  if (state.view === "chat") route(); else go("chat");
}

export async function viewChat(main, params = new URLSearchParams()) {
  if (params.get("c")) { state.conversationId = params.get("c"); history.replaceState(null, "", "#chat"); }
  const thread = h("div", { class: "thread", id: "thread" });
  const scroll = h("div", { class: "chat-scroll", id: "chat-scroll" }, thread);
  const input = h("textarea", { id: "chat-input", rows: 1, placeholder: isMobile() ? "Nachricht an JARVIS …" : "Frag JARVIS oder gib einen Auftrag …", enterkeyhint: "send", maxlength: 8000, "aria-label": "Nachricht" });
  const sendBtn = h("button", { class: "btn primary icon", type: "submit", title: "Senden", "aria-label": "Senden" }, icon("send"));
  const micBtn = voice.canListen
    ? h("button", { class: "btn ghost icon mic", id: "mic-btn", type: "button", title: "Sprechen", "aria-label": "Sprechen", "aria-pressed": "false",
        onclick: () => (voice.listening ? voice.stopListening() : startVoiceInput()) }, icon("mic"))
    : null;
  const picker = h("input", { type: "file", multiple: true, accept: FILE_ACCEPT, hidden: true, onchange: () => { addAttachments(picker.files); picker.value = ""; } });
  const attachBtn = h("button", { class: "btn ghost icon attach", type: "button", title: "Datei anhängen", "aria-label": "Datei anhängen", onclick: () => picker.click() }, icon("clip"));
  const form = h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); voice.unlock(); const t = input.value; input.value = ""; autosize(); sendMessage(t); } }, attachBtn, micBtn, input, sendBtn, picker);
  input.addEventListener("paste", (e) => { const fl = e.clipboardData?.files; if (fl?.length) { e.preventDefault(); addAttachments(fl); } });
  const autosize = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 220)}px`; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });

  const title = h("div", { class: "title" }, "Neue Unterhaltung");
  const top = h("div", { class: "chat-top" },
    h("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, logoMark("sm"), title),
    h("div", { class: "head-actions" },
      voice.canSpeak ? h("button", { class: "btn ghost sm", id: "speak-btn", title: "Antworten auf Spracheingaben vorlesen",
        onclick: () => { if (voice.speaking) return voice.stopSpeaking(); voice.prefs.speak = !voice.prefs.speak; voice.save(); voiceUi(); } }) : null,
      voice.canListen ? h("button", { class: "btn ghost sm", id: "conv-btn", title: "Gesprächsmodus: nach jeder Antwort automatisch weiter zuhören. Beenden mit „Stopp“.",
        onclick: () => { voice.prefs.conversation = !voice.prefs.conversation; voice.save(); voiceUi(); if (voice.prefs.conversation && !voice.listening) startVoiceInput(); else if (!voice.prefs.conversation) voice.stopListening(); } },
        icon("headset"), h("span", {}, "Gespräch")) : null,
      h("button", { class: "btn ghost sm", onclick: openHistory, "aria-label": "Verlauf" }, icon("history"), h("span", {}, "Verlauf")),
      h("button", { class: "btn sm", "aria-label": "Neue Unterhaltung", onclick: () => { state.conversationId = null; route(); } }, icon("plus"), h("span", {}, "Neu"))));

  const secBanner = h("div", { class: "banner warn hidden", id: "sec-banner" }, icon("shield"),
    h("div", {}, h("b", {}, "Sicherheitshinweis: "), "In dieser Unterhaltung wurde ein möglicher Manipulationsversuch (Prompt Injection) erkannt. Externe Aktionen erfordern erhöhte Bestätigung."));

  set(main, h("div", { class: "view chat" }, top, scroll,
    h("div", { class: "composer-wrap" }, secBanner, h("div", { class: "attach-row", id: "attach-row" }), form, h("div", { class: "composer-hint" }, voice.canListen ? "Enter zum Senden · 🎤 zum Sprechen · Externe Aktionen immer erst nach deiner Bestätigung" : "Enter zum Senden · Shift+Enter für neue Zeile · Externe Aktionen immer erst nach deiner Bestätigung"))));

  state.renderedPending = new Set();
  dropZone(main.querySelector(".view.chat"), addAttachments);
  renderAttachRow();
  voiceUi();
  if (state.conversationId) {
    const data = await api(`/api/conversations/${state.conversationId}/messages`);
    title.textContent = data.conversation.title ?? "Unterhaltung";
    secBanner.classList.toggle("hidden", !data.conversation.tainted);
    for (const m of data.messages) {
      if (m.role === "user") {
        const lines = (m.text ?? "").split("\n");
        const files = lines.filter((l) => l.startsWith("📎 ")).map((l) => l.slice(3));
        addUser(lines.filter((l) => !l.startsWith("📎 ")).join("\n"), m.createdAt, files);
      }
      else addAssistant().finish(m.text, [], m.createdAt);
    }
    renderPendingCards(data.pendingActions);
  } else {
    thread.append(h("div", { class: "welcome" },
      logoMark("xl"),
      h("h2", {}, `${greeting()}${state.userName ? `, ${state.userName.split(/\s+/)[0]}` : ""}.`),
      h("p", {}, "Wie kann ich helfen? Ich lese, plane und bereite vor — und frage, bevor etwas dein Postfach oder deinen Kalender verlässt."),
      h("div", { class: "suggest-grid" }, SUGGESTIONS.map(([ic, text, sub]) =>
        h("button", { class: "suggest", onclick: () => sendMessage(text) }, icon(ic), h("div", {}, h("b", {}, text), h("span", {}, sub)))))));
  }
  scrollDown();

  if (pendingPrefill) {
    const { text, send } = pendingPrefill;
    pendingPrefill = null;
    if (send) sendMessage(text);
    else { input.value = text; autosize(); input.focus(); }
  } else input.focus();
}

function scrollDown() {
  const s = $("#chat-scroll");
  if (s) s.scrollTop = s.scrollHeight;
}

function addUser(text, at, files = []) {
  $(".welcome")?.remove();
  $("#thread").append(h("div", { class: "msg user" }, h("div", {},
    files.length ? h("div", { class: "user-files" }, files.map((n) => h("span", { class: "attach-chip done" }, icon("clip"), h("span", { class: "name" }, n)))) : null,
    text ? h("div", { class: "bubble" }, text) : null,
    at ? h("div", { class: "msg-time", style: "text-align:right" }, fmt.rel(at)) : null)));
  scrollDown();
}

export const STEP_ICON = { succeeded: "check", failed: "x", denied: "x", awaiting_confirmation: "shield", rejected: "x", expired: "clock", partially_succeeded: "alert" };

/** An assistant turn: live steps while working, then the answer. */
function addAssistant() {
  const steps = h("div", { class: "steps" });
  const typing = h("div", { class: "typing" }, h("i"), h("i"), h("i"));
  const content = h("div", { class: "content" }, steps, typing);
  const orb = logoMark("busy");
  const node = h("div", { class: "msg assistant" }, orb, content);
  $("#thread").append(node);
  scrollDown();
  const map = new Map();
  let live = null;
  return {
    content,
    /** Streamed reply text, shown as it is generated (replaced by formatted Markdown at the end). */
    text(delta) {
      if (!live) { live = h("div", { class: "live-text" }); typing.before(live); }
      live.textContent += delta;
      typing.classList.add("hidden");
      scrollDown();
    },
    /** A new model step: text so far was a preamble before tool use — keep it, faded. */
    nextStep() {
      if (live) { live.classList.add("preamble"); live = null; }
      typing.classList.remove("hidden");
    },
    /** Routes NDJSON agent events to this turn. */
    onEvent(ev) {
      if (ev.type === "action") this.step(ev.action);
      else if (ev.type === "text") this.text(ev.delta);
      else if (ev.type === "thinking") this.nextStep();
    },
    step(a) {
      const prev = map.get(a.activityId);
      const label = a.description.split("\n")[0];
      const running = a.status === "executing" || a.status === "planned";
      const t0 = prev?.t0 ?? performance.now();
      const secs = !running && prev ? (performance.now() - t0) / 1000 : null;
      const ic = running ? h("span", { class: "spin-v" }) : h("span", { class: `step-ic ${a.status}` }, icon(STEP_ICON[a.status] ?? "check"));
      const next = h("div", { class: `step ${a.status}`, title: a.error ?? a.description }, ic, h("span", { class: "label" }, label),
        a.error ? h("span", { class: "muted err-note" }, a.error) : null,
        secs !== null && secs >= 0.05 ? h("span", { class: "mono step-t" }, `${secs.toFixed(1).replace(".", ",")} s`) : null);
      if (prev) prev.el.replaceWith(next); else steps.append(next);
      map.set(a.activityId, { el: next, t0 });
      scrollDown();
    },
    finish(text, actions = [], at) {
      orb.classList.remove("busy");
      typing.remove();
      live?.remove();
      live = null;
      for (const a of actions) if (!map.has(a.activityId)) this.step(a);
      if (!steps.children.length) steps.remove();
      content.append(markdown(text));
      if (at) content.append(h("div", { class: "msg-time" }, fmt.rel(at)));
      scrollDown();
    },
    error(msg) {
      orb.classList.remove("busy");
      typing.remove();
      content.append(h("div", { class: "banner warn", style: "margin:0" }, icon("alert"), h("div", {}, msg)));
    },
  };
}

function handleReply(reply, turn, opts = {}) {
  const isNew = state.conversationId !== reply.conversationId;
  state.conversationId = reply.conversationId;
  turn.finish(reply.text, reply.actions, new Date().toISOString());
  renderPendingCards(reply.pendingActions);
  $("#sec-banner")?.classList.toggle("hidden", !reply.securityWarning);
  if (opts.viaVoice) { try { speakReply(reply); } catch { /* never break the reply */ } }
  if (isNew) api(`/api/conversations/${reply.conversationId}/messages`).then((d) => { const t = $(".chat-top .title"); if (t) t.textContent = d.conversation.title ?? "Unterhaltung"; }).catch(() => {});
  refreshCounts();
}

// ─── Chat-Anhänge ──────────────────────────────────────────────────────────
function renderAttachRow() {
  const row = $("#attach-row");
  if (!row) return;
  set(row, state.attachments.map((a) => h("div", { class: `attach-chip ${a.error ? "err" : a.file ? "done" : ""}`, title: a.error ?? a.name },
    icon(a.error ? "alert" : FILE_ICON[a.file?.format] ?? "file"),
    h("span", { class: "name" }, a.name),
    h("span", { class: "meta" }, a.error ? "Fehler" : a.file ? fmtSize(a.size) : `${Math.round(a.progress * 100)} %`),
    h("button", { type: "button", class: "x", "aria-label": `${a.name} entfernen`, onclick: () => { state.attachments = state.attachments.filter((x) => x !== a); renderAttachRow(); } }, icon("x")))));
}

function addAttachments(fileList) {
  for (const f of [...fileList].slice(0, 10 - state.attachments.length)) {
    const a = { name: f.name, size: f.size, progress: 0, file: null, error: null };
    a.promise = uploadFile(f, (p) => { a.progress = p; renderAttachRow(); }, state.conversationId ?? undefined)
      .then((file) => { a.file = file; })
      .catch((e) => { a.error = e.message; toast(`${f.name}: ${e.message}`, "err"); })
      .finally(renderAttachRow);
    state.attachments.push(a);
  }
  renderAttachRow();
  $("#chat-input")?.focus();
}

export async function sendMessage(text, opts = {}) {
  text = text.trim();
  const pending = state.attachments.filter((a) => !a.error);
  if ((!text && !pending.length) || state.busy) return;
  state.busy = true;
  state.attachments = [];
  renderAttachRow();
  addUser(text, undefined, pending.map((a) => a.name));
  const turn = addAssistant();
  try {
    await Promise.all(pending.map((a) => a.promise));
    const ids = pending.filter((a) => a.file).map((a) => a.file.id);
    if (!text && !ids.length) throw new Error("Upload fehlgeschlagen.");
    const reply = await apiStream("/api/chat/stream", { conversationId: state.conversationId ?? undefined, message: text, attachments: ids.length ? ids : undefined }, (ev) => turn.onEvent(ev));
    handleReply(reply, turn, opts);
  } catch (err) {
    turn.error(err.message);
    if (opts.viaVoice) voice.speak(`Fehler: ${err.message}`);
  } finally {
    state.busy = false;
    if (!voice.listening) $("#chat-input")?.focus();
  }
}

function renderPendingCards(list) {
  const thread = $("#thread");
  if (!thread) return;
  // Cards resolved elsewhere (e.g. by a spoken "ja") no longer offer buttons.
  const open = new Set((list ?? []).map((p) => p.id));
  thread.querySelectorAll(".confirm[data-pending-id]").forEach((c) => {
    const foot = c.querySelector(".confirm-foot");
    if (foot && !open.has(c.dataset.pendingId)) foot.replaceWith(h("div", { class: "resolved" }, icon("check"), "Erledigt"));
  });
  for (const p of list ?? []) {
    if (state.renderedPending.has(p.id)) continue;
    state.renderedPending.add(p.id);
    const last = thread.querySelector(".msg.assistant:last-of-type .content") ?? thread;
    last.append(confirmCard(p, null, true));
  }
  scrollDown();
}

function describePreview(desc) {
  const [first, ...rest] = desc.split("\n");
  return { headline: first, body: rest.join("\n").trim() };
}

/** "Press and hold to run": fills over 1.2 s, fires once. Works with pointer and Space/Enter. */
function holdButton(onFire, label = "Halten zum Ausführen") {
  const btn = h("button", { class: "hold-btn", "aria-label": `${label} (1 Sekunde)` },
    h("span", { class: "base" }, icon("send"), label),
    h("span", { class: "fill" }, icon("send"), "Weiter halten …"),
    h("span", { class: "done" }, icon("check"), "Bestätigt"));
  let timer = null;
  const down = (e) => {
    if (btn.disabled || btn.classList.contains("sent")) return;
    if (e?.pointerId !== undefined) btn.setPointerCapture?.(e.pointerId);
    btn.classList.add("on");
    timer = setTimeout(() => { btn.classList.remove("on"); btn.classList.add("sent"); navigator.vibrate?.(12); onFire(); }, 1200);
  };
  const up = () => { clearTimeout(timer); btn.classList.remove("on"); };
  btn.addEventListener("pointerdown", down);
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(ev, up);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); down(); } });
  btn.addEventListener("keyup", (e) => (e.key === " " || e.key === "Enter") && up());
  return btn;
}

/** Confirmation card. inChat → the follow-up turn streams into the thread. */
export function confirmCard(p, onDone, inChat = false) {
  const crit = p.risk >= 3;
  const { headline, body } = describePreview(p.description);
  const foot = h("div", { class: "confirm-foot" });
  const card = h("div", { class: `confirm ${crit ? "crit" : ""}`, "data-pending-id": p.id },
    h("div", { class: "confirm-head" }, icon(crit ? "alert" : "shield"), h("span", {}, headline),
      h("span", { class: `badge ${crit ? "crit" : "warn"}` }, crit ? "Kritisch" : "Bestätigung")),
    body ? h("div", { class: "confirm-preview" }, body) : null,
    p.reasons?.length ? h("ul", { class: "confirm-reasons" }, p.reasons.map((r) => h("li", {}, r))) : null,
    foot);

  const decide = async (approve) => {
    foot.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (inChat && $("#thread")) {
        foot.replaceWith(h("div", { class: "resolved" }, icon(approve ? "check" : "x"), approve ? "Bestätigt — wird ausgeführt" : "Abgelehnt"));
        const turn = addAssistant();
        const reply = await apiStream(`/api/confirmations/${p.id}`, { approve, stream: true }, (ev) => turn.onEvent(ev));
        handleReply(reply, turn);
      } else {
        const reply = await api(`/api/confirmations/${p.id}`, { method: "POST", body: { approve } });
        toast(approve ? "Ausgeführt. " + (reply.text?.split("\n")[0] ?? "") : "Abgelehnt.", approve ? "ok" : "info");
        onDone?.(reply);
      }
      refreshCounts();
    } catch (err) {
      fail(err);
      foot.querySelectorAll("button").forEach((b) => (b.disabled = false));
      foot.querySelector(".hold-btn")?.classList.remove("sent");
    }
  };
  // Level 2: press and hold (1.2 s) — a deliberate gesture instead of a stray tap.
  // Level 3 keeps the explicit "Trotzdem ausführen" button.
  const approveBtn = crit
    ? h("button", { class: "btn danger", onclick: () => decide(true) }, icon("alert"), "Trotzdem ausführen")
    : holdButton(() => decide(true));
  foot.append(approveBtn,
    h("div", { class: "confirm-row" },
      h("button", { class: "btn ghost reject", onclick: () => decide(false) }, "Ablehnen"),
      h("span", { class: "muted" }, icon("shield"), `Erst nach deiner Bestätigung · gültig bis ${fmt.time(p.expiresAt)}`)));
  return card;
}

async function openHistory() {
  const list = await api("/api/conversations").catch((e) => (fail(e), []));
  const close = () => { scrim.remove(); drawer.remove(); };
  const scrim = h("div", { class: "scrim", onclick: close });
  const body = h("div", { class: "drawer-body" });
  const renderList = (items) => set(body, 
    ...(items.length ? items.map((c) =>
      h("div", { class: `conv ${c.id === state.conversationId ? "active" : ""}`, onclick: () => { state.conversationId = c.id; close(); route(); } },
        c.tainted ? icon("shield") : icon("chat"),
        h("div", { class: "main" }, h("div", { class: "title" }, c.title ?? "(ohne Titel)"), h("div", { class: "muted small" }, fmt.rel(c.updatedAt))),
        h("button", { class: "btn ghost icon sm del", title: "Löschen", onclick: async (e) => {
          e.stopPropagation();
          if (!(await dialog({ title: "Unterhaltung löschen?", text: "Der Verlauf wird dauerhaft entfernt. Offene Bestätigungen darin verfallen.", confirmLabel: "Löschen", danger: true }))) return;
          await api(`/api/conversations/${c.id}`, { method: "DELETE" }).catch(fail);
          if (state.conversationId === c.id) state.conversationId = null;
          renderList(items.filter((x) => x.id !== c.id));
        } }, icon("trash"))))
      : [h("div", { class: "empty" }, "Noch keine Unterhaltungen.")]));
  renderList(list);
  const drawer = h("aside", { class: "drawer" }, h("div", { class: "drawer-head" }, h("h3", {}, "Verlauf"), h("button", { class: "btn ghost icon", onclick: close, "aria-label": "Schließen" }, icon("x"))), body);
  document.body.append(scrim, drawer);
}
