// JARVIS voice home: the living core, voice conversation and context cards.
// The reply's `context` (events, mails, tasks … from this turn's tool results)
// turns into cards that appear the moment JARVIS says the matching sentence.
// All server text is rendered with textContent (via h()), never innerHTML.

import { Core } from "./core.js";

const KIND_RE = [
  ["event", /\b(termin|termine|kalender|meeting|treffen|besprechung|abstimmung|call|uhr)\b/i],
  ["finance", /(rechnung|zahlung|überweis|betrag|euro|€|finanz|konto|ausgabe|einnahme|budget|kosten)/i],
  ["mail", /\b(mail|e-mail|mails|nachricht|schreibt|geschrieben|postfach|antwort)\b/i],
  ["task", /\b(aufgabe|aufgaben|to-?do|erledig|frist|deadline)\b/i],
  ["file", /\b(datei|dokument|pdf|tabelle|präsentation|unterlagen)\b/i],
  ["contact", /\b(kontakt|nummer|telefon|adresse)\b/i],
];
const CARD_META = {
  event: { label: "Kalender", icon: "calendar", cls: "k-event" },
  mail: { label: "E-Mail", icon: "mail", cls: "k-mail" },
  task: { label: "Aufgabe", icon: "tasks", cls: "k-task" },
  contact: { label: "Kontakt", icon: "users", cls: "k-contact" },
  file: { label: "Datei", icon: "file", cls: "k-file" },
  finance: { label: "Finanzen", icon: "euro", cls: "k-finance" },
};
const END_WORDS = /^(stopp?|ende|beenden|danke,? das war'?s|das war'?s|tschüss|nichts)[.! ]*$/i;
const PROMPTS = [
  ["calendar", "Was steht diese Woche an?"],
  ["mail", "Was ist wichtig in meinen Mails?"],
  ["memory", "Plane meinen Tag"],
];

const initials = (name) => (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "J";

export function mountJarvis(main, ui) {
  const { h, set, icon, api, apiStream, go, toast, state, fmt, toSpeech } = ui;
  const S = { mode: "idle", conv: state.voiceConversationId ?? null, items: [], shown: new Set(), card: null, alive: true, cfg: { stt: "browser", tts: "browser" }, listenAgain: false, audio: null, rec: null, sr: null };

  // ─── DOM ──────────────────────────────────────────────────────────────
  const anchor = h("div", { class: "jv-anchor", "aria-hidden": "true" });
  const coreBtn = h("button", { class: "jv-core-btn", "aria-label": "Mit JARVIS sprechen", onclick: () => onCore() });
  const status = h("div", { class: "jv-status glass", role: "status", "aria-live": "polite" });
  const leftBtn = h("div", { class: "jv-left" });
  const greet = h("div", { class: "jv-greet" }, `${ui.greeting()}${state.userName ? `, ${state.userName}` : ""}`);
  const summary = h("div", { class: "jv-summary" }, " ");
  const prompts = h("div", { class: "jv-prompts" }, PROMPTS.map(([ic, text]) => h("button", { class: "jv-chip glass", onclick: () => ask(text) }, icon(ic), h("span", {}, text))));
  const idleBox = h("div", { class: "jv-idle" }, greet, summary, prompts);
  const bootBox = h("div", { class: "jv-boot mono hidden" });
  const userBox = h("div", { class: "jv-user" }, h("div", { class: "jv-label mono" }, "DU"), h("div", { class: "jv-user-text" }));
  const thinkBox = h("div", { class: "jv-think" }, h("div", { class: "shim" }, "Einen Moment …"), h("div", { class: "jv-tools" }));
  const caption = h("div", { class: "jv-caption", "aria-live": "polite" });
  const sheetBody = h("div", { class: "jv-sheet-body" });
  const sheet = h("div", { class: "jv-sheet glass", role: "region", "aria-label": "Kontext" },
    h("button", { class: "jv-grip", "aria-label": "Karte schließen", onclick: () => closeCard() }), sheetBody);
  const root = h("div", { class: "jv st-idle" }, anchor, coreBtn,
    h("div", { class: "jv-top" }, leftBtn, status, h("button", { class: "jv-avatar glass", "aria-label": "Einstellungen", onclick: () => go("settings") }, initials(state.userName))),
    bootBox, idleBox, userBox, thinkBox, caption, sheet);
  set(main, root);
  document.body.classList.add("jv-on");

  let core = null;
  try { core = new Core(root, anchor); } catch { root.classList.add("no-core"); }
  root.addEventListener("pointermove", (e) => { const r = root.getBoundingClientRect(); core?.pointer(e.clientX - r.left, e.clientY - r.top); });
  root.addEventListener("pointerleave", () => core?.pointerOut());

  // ─── State machine ────────────────────────────────────────────────────
  function setMode(mode, extra = {}) {
    S.mode = mode;
    // "rest": the answer (caption + card) stays on screen, the core calms down.
    const talk = mode !== "idle";
    root.className = `jv st-${mode}${talk ? " talk" : ""}${S.card ? " compact sheet-open" : ""}${extra.boot ? " booting" : ""}`;
    document.body.classList.toggle("jv-talk", talk);
    core?.set({ orb: mode === "rest" ? "idle" : mode, compact: !!S.card, card: S.card?.kind ?? "" });
    renderStatus();
    set(leftBtn, talk
      ? h("button", { class: "jv-round glass", "aria-label": "Gespräch beenden", onclick: () => endTalk() }, icon("x"))
      : h("button", { class: "jv-round glass", "aria-label": "Schreiben statt sprechen", onclick: () => go("chat") }, icon("keyboard")));
  }
  /** Back to calm: keep the last answer on screen if there is one. */
  function quiet() { setMode(caption.childElementCount ? "rest" : "idle"); }
  function renderStatus() {
    const m = S.mode;
    const wave = (cls) => h("span", { class: `wave ${cls}` }, h("i"), h("i"), h("i"), h("i"), h("i"));
    set(status, m === "listening" ? [wave("cyan"), "HÖRT ZU"] : m === "thinking" ? [h("span", { class: "spin-v" }), "DENKT NACH"] : m === "speaking" ? [wave("gold"), "SPRICHT"] : [h("span", { class: "live" }), "BEREIT"]);
  }

  function endTalk() {
    S.listenAgain = false;
    stopListening(true);
    stopSpeaking();
    closeCard();
    caption.replaceChildren();
    userBox.querySelector(".jv-user-text").replaceChildren();
    setMode("idle");
  }

  async function onCore() {
    ui.unlockAudio?.();
    ensureAudioCtx();
    if (S.mode === "listening") return stopListening(false);
    if (S.mode === "speaking") stopSpeaking();
    if (S.mode === "thinking") return;
    closeCard();
    listen();
  }

  // ─── Listening ────────────────────────────────────────────────────────
  let actx = null;
  function ensureAudioCtx() {
    try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch { actx = null; }
    return actx;
  }

  async function listen() {
    S.listenAgain = true;
    showWords(userBox.querySelector(".jv-user-text"), "", "u");
    setMode("listening");
    if (S.cfg.stt === "server" && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) return recordAndTranscribe();
    return browserRecognition();
  }

  async function recordAndTranscribe() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast("Mikrofon-Zugriff verweigert. Erlaube das Mikrofon für diese Seite.", "err"); return setMode("idle"); }
    const ctx = ensureAudioCtx();
    const analyser = ctx?.createAnalyser();
    let srcNode = null;
    if (ctx && analyser) { srcNode = ctx.createMediaStreamSource(stream); analyser.fftSize = 1024; srcNode.connect(analyser); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    S.rec = { rec, stream, cancelled: false };
    const buf = new Float32Array(1024);
    const t0 = performance.now();
    let floor = 0.008, spoke = false, lastVoice = 0, raf = 0;
    const tick = () => {
      if (!S.rec || S.rec.rec !== rec) return;
      let rms = 0.02;
      if (analyser) { analyser.getFloatTimeDomainData(buf); rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length); }
      const now = performance.now();
      if (now - t0 < 350) floor = Math.max(floor, rms * 1.6);
      const thr = Math.max(0.015, floor * 2.2);
      core?.setLevel(Math.min(1, rms * 9));
      if (rms > thr) { spoke = true; lastVoice = now; }
      if ((spoke && now - lastVoice > 1300) || now - t0 > 25000) return rec.state === "recording" && rec.stop();
      if (!spoke && now - t0 > 7000) { S.rec.cancelled = true; return rec.state === "recording" && rec.stop(); }
      raf = requestAnimationFrame(tick);
    };
    rec.onstop = async () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      try { srcNode?.disconnect(); } catch { /* ignore */ }
      core?.setLevel(null);
      const cancelled = S.rec?.cancelled;
      S.rec = null;
      if (cancelled || !chunks.length) { S.listenAgain = false; return quiet(); }
      setMode("thinking");
      setThinkText("Ich höre genau hin …");
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const res = await fetch("/api/voice/transcribe", { method: "POST", headers: { "content-type": (rec.mimeType || "audio/webm").split(";")[0], "x-jarvis-csrf": state.csrf ?? "" }, body: blob, credentials: "same-origin" });
        if (res.status === 409) { S.cfg.stt = "browser"; return listen(); }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Spracherkennung fehlgeschlagen.");
        const text = (data.text ?? "").trim();
        if (!text) { S.listenAgain = false; return quiet(); }
        handleHeard(text);
      } catch (e) { toast(e.message, "err"); setMode("idle"); }
    };
    rec.start(250);
    raf = requestAnimationFrame(tick);
  }

  function browserRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Spracheingabe wird hier nicht unterstützt. Tippe deine Frage im Chat.", "err"); return setMode("idle"); }
    const sr = new SR();
    sr.lang = "de-DE"; sr.interimResults = true; sr.continuous = false;
    let finalText = "";
    sr.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      showWords(userBox.querySelector(".jv-user-text"), (finalText + interim).trim(), "u", true);
    };
    sr.onerror = (e) => { if (e.error === "not-allowed") toast("Mikrofon-Zugriff verweigert.", "err"); };
    sr.onend = () => {
      S.sr = null;
      const text = finalText.trim();
      if (!text) { S.listenAgain = false; if (S.mode === "listening") quiet(); return; }
      handleHeard(text);
    };
    S.sr = sr;
    try { sr.start(); } catch { setMode("idle"); }
  }

  function stopListening(cancel) {
    if (S.rec) { S.rec.cancelled = cancel; try { S.rec.rec.state === "recording" && S.rec.rec.stop(); } catch { /* ignore */ } }
    if (S.sr) { try { cancel ? S.sr.abort() : S.sr.stop(); } catch { /* ignore */ } }
  }

  function handleHeard(text) {
    showWords(userBox.querySelector(".jv-user-text"), text, "u");
    if (END_WORDS.test(text)) { S.listenAgain = false; return speakAll({ text: "Alles klar. Bis später.", context: [], pendingActions: [] }); }
    ask(text, true);
  }

  // ─── Asking ───────────────────────────────────────────────────────────
  function setThinkText(t) { thinkBox.querySelector(".shim").textContent = t; }

  async function ask(text, spoken = false) {
    ui.unlockAudio?.();
    ensureAudioCtx();
    if (!spoken) { showWords(userBox.querySelector(".jv-user-text"), text, "u"); S.listenAgain = false; }
    caption.replaceChildren();
    closeCard();
    S.items = [];
    S.shown = new Set();
    const tools = thinkBox.querySelector(".jv-tools");
    tools.replaceChildren();
    setThinkText("Einen Moment …");
    setMode("thinking");
    const chips = new Map();
    try {
      const reply = await apiStream("/api/chat/stream", { conversationId: S.conv ?? undefined, message: text }, (ev) => {
        if (ev.type !== "action") return;
        const a = ev.action;
        const label = a.description.split("\n")[0].slice(0, 60);
        setThinkText(a.status === "executing" ? `${label} …` : "Ich stelle die Antwort zusammen …");
        const done = a.status === "succeeded" || a.status === "partially_succeeded";
        const chip = h("div", { class: `jv-tool glass ${done ? "done" : a.status === "executing" ? "run" : "warn"}` },
          done ? h("span", { class: "ok-dot" }, icon("check")) : a.status === "executing" ? h("span", { class: "spin-v" }) : h("span", { class: "warn-dot" }, icon("alert")), h("span", {}, label));
        const old = chips.get(a.activityId);
        if (old) old.replaceWith(chip); else tools.append(chip);
        chips.set(a.activityId, chip);
        while (tools.children.length > 3) tools.firstElementChild.remove();
      });
      S.conv = reply.conversationId;
      state.voiceConversationId = reply.conversationId;
      await speakAll(reply);
    } catch (e) {
      await speakAll({ text: `Das hat nicht geklappt: ${e.message}`, context: [], pendingActions: [] });
    }
  }

  // ─── Speaking + context cards ─────────────────────────────────────────
  function sentencesOf(text) {
    const clean = toSpeech(String(text ?? "").replace(/\[([^\]]+)\]\(#file:[0-9a-f-]{36}\)/g, "$1"));
    const raw = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const s of raw) {
      if (out.length && (out[out.length - 1].length < 28 || s.length < 14)) out[out.length - 1] += ` ${s}`;
      else out.push(s);
    }
    return out.slice(0, 12);
  }

  function cardFor(sentence) {
    const low = sentence.toLowerCase();
    const items = S.items;
    let best = null;
    let bestPos = Infinity;
    for (const it of items) {
      for (const term of it.terms ?? []) {
        const pos = low.indexOf(term);
        if (pos >= 0 && pos < bestPos) { best = it; bestPos = pos; }
      }
    }
    if (best) return best;
    for (const [kind, re] of KIND_RE) {
      if (!re.test(sentence)) continue;
      const it = items.find((x) => x.kind === kind && !S.shown.has(`${x.kind}:${x.id}`)) ?? items.find((x) => x.kind === kind || (kind === "finance" && x.kind === "mail" && x.amount));
      if (it) return it;
    }
    return null;
  }

  let speakToken = 0;
  async function speakAll(reply) {
    const token = ++speakToken;
    S.items = reply.context ?? [];
    const parts = sentencesOf(reply.text);
    setMode("speaking");
    let next = parts.length && S.cfg.tts === "server" && voicePrefs().speak ? fetchAudio(parts[0]) : null;
    for (let i = 0; i < parts.length; i++) {
      if (token !== speakToken || !S.alive) return;
      const sentence = parts[i];
      const audioP = next;
      next = i + 1 < parts.length && S.cfg.tts === "server" && voicePrefs().speak ? fetchAudio(parts[i + 1]) : null;
      const it = cardFor(sentence);
      if (it && S.card?.id !== it.id) setTimeout(() => token === speakToken && openCard(it), 280);
      await speakSentence(sentence, audioP, token);
    }
    if (token !== speakToken) return;
    core?.setLevel(null);
    const pending = reply.pendingActions ?? [];
    if (pending.length) {
      S.listenAgain = false;
      setMode("rest");
      openConfirm(pending[0]);
      return;
    }
    if (S.listenAgain && voicePrefs().conversation !== false) setTimeout(() => token === speakToken && S.alive && listen(), 350);
    else setMode("rest");
  }

  function voicePrefs() { return ui.voicePrefs?.() ?? { speak: true, conversation: true }; }

  async function fetchAudio(text) {
    try {
      const res = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json", "x-jarvis-csrf": state.csrf ?? "" }, body: JSON.stringify({ text }), credentials: "same-origin" });
      if (res.status === 409) { S.cfg.tts = "browser"; return null; }
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch { return null; }
  }

  function speakSentence(sentence, audioP, token) {
    return new Promise(async (resolve) => {
      const words = sentence.split(/\s+/);
      const reveal = (perWord) => showWords(caption, sentence, "w", false, perWord);
      const done = () => { core?.setLevel(null); resolve(); };
      if (!voicePrefs().speak) { reveal(0.28); return setTimeout(done, words.length * 280 + 500); }
      const url = audioP ? await audioP : null;
      if (token !== speakToken) return resolve();
      if (url) {
        const audio = new Audio(url);
        S.audio = audio;
        let src = null, analyser = null, raf = 0;
        try {
          const ctx = ensureAudioCtx();
          if (ctx) { src = ctx.createMediaElementSource(audio); analyser = ctx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser); analyser.connect(ctx.destination); }
        } catch { /* level stays simulated */ }
        const buf = new Float32Array(512);
        const tick = () => { if (!analyser) return; analyser.getFloatTimeDomainData(buf); core?.setLevel(Math.min(1, Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length) * 6)); raf = requestAnimationFrame(tick); };
        audio.onloadedmetadata = () => reveal(Math.max(0.12, Math.min(0.6, (audio.duration || words.length * 0.36) / words.length)));
        audio.onplay = () => { raf = requestAnimationFrame(tick); };
        const finish = () => { cancelAnimationFrame(raf); try { src?.disconnect(); } catch { /* ignore */ } URL.revokeObjectURL(url); S.audio = null; done(); };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(() => { reveal(0.3); setTimeout(finish, words.length * 300); });
        return;
      }
      if (!("speechSynthesis" in window)) { reveal(0.3); return setTimeout(done, words.length * 300 + 400); }
      const u = new SpeechSynthesisUtterance(sentence);
      const v = ui.pickVoice?.();
      if (v) u.voice = v;
      u.lang = v?.lang ?? "de-DE";
      u.rate = ui.voiceRate?.() ?? 1.05;
      reveal(0.34 / u.rate);
      core?.setLevel(null);
      let ended = false;
      const end = () => { if (ended) return; ended = true; done(); };
      u.onend = end;
      u.onerror = end;
      setTimeout(end, words.length * 650 + 3000);
      try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { end(); }
    });
  }

  function stopSpeaking() {
    speakToken++;
    try { S.audio?.pause(); } catch { /* ignore */ }
    S.audio = null;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    core?.setLevel(null);
  }

  /** Words fade in one after another (perWord seconds apart). */
  function showWords(el, text, kind, instant = false, perWord = 0.22) {
    el.replaceChildren();
    if (!text) return;
    text.split(/\s+/).forEach((w, i) => {
      const s = h("span", { class: kind === "u" ? "uw" : "w" }, w);
      s.style.animationDelay = instant ? "0s" : `${(i * perWord).toFixed(2)}s`;
      el.append(s, " ");
    });
  }

  // ─── Cards ────────────────────────────────────────────────────────────
  function openCard(it) {
    const landed = root.classList.contains("sheet-open");
    S.card = it;
    S.shown.add(`${it.kind}:${it.id}`);
    set(sheetBody, renderCard(it));
    root.classList.add("compact");
    root.classList.add("sheet-open");
    core?.set({ compact: true, card: it.kind });
    // Particles stream from the core to the card once the sheet has landed.
    setTimeout(() => {
      if (S.card !== it) return;
      const r = sheet.getBoundingClientRect();
      const host = root.getBoundingClientRect();
      core?.link(r.left - host.left + r.width / 2, r.top - host.top + 20, Math.min(320, r.width * 0.8));
    }, landed ? 60 : 700);
  }
  function closeCard() {
    S.card = null;
    root.classList.remove("compact", "sheet-open");
    core?.set({ compact: false, card: "" });
  }

  const cardHead = (kind, chip, chipCls = "") => {
    const m = CARD_META[kind];
    return h("div", { class: "jc-head" }, h("span", { class: `jc-glyph ${m.cls}` }, icon(m.icon)), h("span", { class: "jc-label" }, m.label), chip ? h("span", { class: `jc-chip ${chipCls}` }, chip) : null);
  };
  const actions = (...btns) => h("div", { class: "jc-actions" }, btns);
  const btn = (label, onclick, primary = false) => h("button", { class: primary ? "jc-btn primary" : "jc-btn", onclick }, label);

  function dayChip(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
    return diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : diff > 1 && diff < 7 ? `in ${diff} Tagen` : d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  }

  function renderCard(it) {
    const body = h("div", { class: `jc jc-${it.kind}` });
    if (it.kind === "event") {
      const start = new Date(it.start);
      const sameDay = S.items.filter((x) => x.kind === "event" && x.start && !x.allDay && new Date(x.start).toDateString() === start.toDateString());
      const pos = (iso) => Math.max(0, Math.min(100, ((new Date(iso).getHours() + new Date(iso).getMinutes() / 60 - 7) / 14) * 100));
      append(body,
        cardHead("event", dayChip(it.start)),
        h("div", { class: "jc-date" }, start.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })),
        it.allDay ? h("div", { class: "jc-big" }, "Ganztägig") : h("div", { class: "jc-timeRow" }, h("span", { class: "jc-big" }, fmt.time(it.start)), h("span", { class: "jc-to" }, `– ${fmt.time(it.end)}`)),
        h("div", { class: "jc-title" }, it.title),
        it.allDay ? null : h("div", { class: "jc-daybar" },
          h("div", { class: "track" }),
          sameDay.map((x) => h("div", { class: `seg ${x.id === it.id ? "me" : ""}`, style: `left:${pos(x.start)}%;width:${Math.max(2.5, pos(x.end) - pos(x.start))}%` })),
          h("div", { class: "ticks mono" }, ["7", "10", "13", "16", "19", "21"].map((t) => h("span", {}, t)))),
        h("div", { class: "jc-meta" },
          it.location ? h("div", {}, icon("pin"), it.location) : null,
          it.attendees?.length ? h("div", {}, icon("users"), it.attendees.slice(0, 3).join(", ") + (it.attendees.length > 3 ? ` +${it.attendees.length - 3}` : "")) : null),
        actions(btn("Im Kalender", () => { state.calendarFocus = it.start; go("calendar"); }, true),
          it.location ? h("a", { class: "jc-btn", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.location)}`, target: "_blank", rel: "noopener" }, "Route") : btn("Schließen", closeCard)));
    } else if (it.kind === "mail" || it.kind === "finance") {
      const fin = it.kind === "finance";
      append(body,
        cardHead(it.kind, it.date ? fmt.rel(it.date) : null),
        fin && it.amount ? h("div", { class: "jc-big gold" }, it.amount) : null,
        h("div", { class: "jc-from" }, ui.avatar(it.from || "?"), h("div", {}, h("div", { class: "jc-name" }, it.from || "Unbekannt"), it.fromEmail ? h("div", { class: "jc-sub" }, it.fromEmail) : null)),
        h("div", { class: "jc-title" }, it.title),
        it.snippet ? h("div", { class: "jc-snippet" }, it.snippet) : null,
        fin ? h("div", { class: "jc-note mono" }, "ERKANNT AUS DEINEM POSTFACH") : null,
        actions(btn("Öffnen", () => { state.mailSelected = it.id; go("email"); }, true),
          fin ? btn("Erinnern", () => ask(`Lege mir eine Aufgabe an, die Rechnung „${it.title}“ zu bezahlen.`)) : btn("Antworten", () => ask(`Hilf mir, auf die E-Mail „${it.title}“ von ${it.from} zu antworten.`))));
    } else if (it.kind === "task") {
      append(body,
        cardHead("task", it.due ? `fällig ${new Date(it.due).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}` : null, it.due && new Date(it.due) < new Date() ? "red" : ""),
        h("div", { class: "jc-title big" }, it.title),
        h("div", { class: "jc-sub" }, { high: "Hohe Priorität", normal: "Normale Priorität", low: "Niedrige Priorität" }[it.priority] ?? ""),
        actions(btn("Erledigt", async (e) => { e.currentTarget.disabled = true; await api(`/api/tasks/${it.id}/complete`, { method: "POST" }).catch(() => {}); toast("Erledigt.", "ok"); closeCard(); }, true),
          btn("Alle Aufgaben", () => go("tasks"))));
    } else if (it.kind === "contact") {
      append(body,
        cardHead("contact", it.organization ?? null),
        h("div", { class: "jc-from big" }, ui.avatar(it.title), h("div", {}, h("div", { class: "jc-title" }, it.title), it.organization ? h("div", { class: "jc-sub" }, it.organization) : null)),
        h("div", { class: "jc-meta" },
          (it.emails ?? []).map((e) => h("a", { href: `mailto:${e}` }, icon("mail"), e)),
          (it.phones ?? []).map((p) => h("a", { href: `tel:${p.replace(/\s/g, "")}` }, icon("phone"), p))),
        actions(it.phones?.length ? h("a", { class: "jc-btn primary", href: `tel:${it.phones[0].replace(/\s/g, "")}` }, "Anrufen") : btn("Kontakte", () => go("contacts"), true), btn("Schließen", closeCard)));
    } else if (it.kind === "file") {
      append(body,
        cardHead("file", (it.format ?? "").toUpperCase()),
        h("div", { class: "jc-title big" }, it.title),
        h("div", { class: "jc-sub" }, it.size ? `${Math.max(1, Math.round(it.size / 1024))} KB` : ""),
        actions(btn("Öffnen", () => go("files", `?preview=${it.id}`), true), btn("Schließen", closeCard)));
    }
    return body;
  }
  const append = (node, ...children) => ui.append(node, children);

  function openConfirm(p) {
    const crit = p.risk >= 3;
    const [headline, ...rest] = p.description.split("\n");
    S.card = { kind: "task", id: p.id };
    root.classList.add("compact", "sheet-open");
    core?.set({ compact: true, card: crit ? "finance" : "mail" });
    const holdBtn = h("button", { class: "jc-hold", "aria-label": crit ? "Kritisch: in der App bestätigen" : "Zum Ausführen gedrückt halten" },
      h("span", { class: "base" }, crit ? "Im Chat prüfen" : "Zum Ausführen halten"), h("span", { class: "fill" }, "Weiter halten …"));
    const card = h("div", { class: `jc jc-confirm ${crit ? "crit" : ""}` },
      h("div", { class: "jc-head" }, h("span", { class: `jc-glyph ${crit ? "k-crit" : "k-mail"}` }, icon(crit ? "alert" : "shield")), h("span", { class: "jc-label" }, crit ? "Kritische Aktion" : "Wartet auf dich"), h("span", { class: "jc-chip orange" }, crit ? "Stufe 3" : "Stufe 2")),
      h("div", { class: "jc-title" }, headline),
      rest.join("\n").trim() ? h("div", { class: "jc-preview" }, rest.join("\n").trim()) : null,
      holdBtn,
      h("div", { class: "jc-actions" }, btn("Verwerfen", async () => { await api(`/api/confirmations/${p.id}`, { method: "POST", body: { approve: false } }).catch(() => {}); toast("Verworfen."); closeCard(); }), btn("Im Chat ansehen", () => { state.conversationId = S.conv; go("chat"); })),
      h("div", { class: "jc-note" }, icon("shield"), crit ? "Kritische Aktionen bestätigst du nur ausdrücklich im Chat." : "Wird erst ausgeführt, wenn du hältst."));
    set(sheetBody, card);
    if (crit) { holdBtn.onclick = () => { state.conversationId = S.conv; go("chat"); }; return; }
    let timer = null;
    const down = () => {
      if (holdBtn.classList.contains("sent")) return;
      holdBtn.classList.add("on");
      timer = setTimeout(async () => {
        holdBtn.classList.remove("on");
        holdBtn.classList.add("sent");
        holdBtn.querySelector(".base").textContent = "Wird ausgeführt …";
        try {
          setMode("thinking");
          const reply = await apiStream(`/api/confirmations/${p.id}`, { approve: true, stream: true }, () => {});
          closeCard();
          await speakAll(reply);
        } catch (e) { toast(e.message, "err"); setMode("idle"); }
      }, 1200);
    };
    const up = () => { clearTimeout(timer); holdBtn.classList.remove("on"); };
    holdBtn.addEventListener("pointerdown", down);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) holdBtn.addEventListener(ev, up);
    holdBtn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); down(); } });
    holdBtn.addEventListener("keyup", up);
  }

  // ─── Start ────────────────────────────────────────────────────────────
  setMode("idle");
  let firstOpen = false;
  try { firstOpen = !sessionStorage.getItem("jarvis-booted"); } catch { /* private mode */ }
  if (firstOpen && core) {
    try { sessionStorage.setItem("jarvis-booted", "1"); } catch { /* ignore */ }
    core.boot();
    root.classList.add("booting");
    bootBox.classList.remove("hidden");
    set(bootBox, h("span", { class: "bl dots" }, "KERN WIRD INITIALISIERT"));
    setTimeout(() => { root.classList.remove("booting"); bootBox.classList.add("hidden"); }, 2600);
  }
  api("/api/voice/config").then((c) => { S.cfg = c; }).catch(() => {});
  api("/api/briefing").then((b) => {
    if (!S.alive) return;
    const events = b.events?.ok ? b.events.data : [];
    const upcoming = events.filter((e) => !e.allDay && new Date(e.end) > new Date());
    const mails = b.emails?.ok ? b.emails.data.length : 0;
    const pending = b.pending?.ok ? b.pending.data.length : 0;
    const lines = [];
    lines.push(upcoming.length ? `${upcoming.length} ${upcoming.length === 1 ? "Termin" : "Termine"} heute, als Nächstes ${upcoming[0].title} um ${fmt.time(upcoming[0].start)}.` : b.events?.ok ? "Heute keine Termine mehr." : "");
    lines.push(pending ? `${pending} ${pending === 1 ? "Sache wartet" : "Dinge warten"} auf deine Entscheidung.` : mails ? `${mails} ungelesene E-Mail${mails === 1 ? "" : "s"}.` : "Alles erledigt.");
    summary.textContent = lines.filter(Boolean).join("\n");
    if (firstOpen) {
      const ln = (t, i) => h("span", { class: `bl bl${i}` }, h("span", { class: "live" }), t);
      append(bootBox,
        b.events?.ok ? ln(`KALENDER · ${events.length} TERMIN${events.length === 1 ? "" : "E"}`, 1) : null,
        b.emails?.ok ? ln(`POSTFACH · ${mails} UNGELESEN`, 2) : null,
        ln(`AUFGABEN · ${b.tasks?.ok ? b.tasks.data.length : 0} OFFEN`, 3));
    }
  }).catch(() => {});

  return () => {
    S.alive = false;
    stopListening(true);
    stopSpeaking();
    core?.destroy();
    document.body.classList.remove("jv-on", "jv-talk");
    try { actx?.close(); } catch { /* ignore */ }
  };
}
