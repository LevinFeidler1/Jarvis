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
  ["weather", /\b(wetter|regen|grad|sonne|schirm|wolken|temperatur|gewitter|schnee)\b/i],
  ["place", /\b(restaurant|café|cafe|bar|friseur|praxis|arzt|reservier\w*|tisch)\b/i],
  ["list", /\b(liste|einkauf\w*|abgehakt|eingetragen)\b/i],
  ["news", /\b(nachrichten|schlagzeile\w*|news|meldung\w*)\b/i],
  ["note", /\b(notiz\w*|notiert|aufgeschrieben)\b/i],
];
const CARD_META = {
  event: { label: "Kalender", icon: "calendar", cls: "k-event" },
  mail: { label: "E-Mail", icon: "mail", cls: "k-mail" },
  task: { label: "Aufgabe", icon: "tasks", cls: "k-task" },
  contact: { label: "Kontakt", icon: "users", cls: "k-contact" },
  file: { label: "Datei", icon: "file", cls: "k-file" },
  finance: { label: "Finanzen", icon: "euro", cls: "k-finance" },
  weather: { label: "Wetter", icon: "w-partly", cls: "k-weather" },
  place: { label: "Ort", icon: "pin", cls: "k-place" },
  list: { label: "Liste", icon: "list", cls: "k-list" },
  news: { label: "Nachrichten", icon: "news", cls: "k-news" },
  note: { label: "Notiz", icon: "note", cls: "k-note" },
};
const END_WORDS = /^(stopp?|ende|beenden|danke,? das war'?s|das war'?s|tschüss|nichts)[.! ]*$/i;
const PROMPTS = [
  ["calendar", "Was steht diese Woche an?"],
  ["w-partly", "Wie wird das Wetter?"],
  ["euro", "Was muss ich noch bezahlen?"],
  ["pin", "Reservier mir einen Tisch"],
  ["mail", "Was ist wichtig in meinen Mails?"],
];

/** Links from third-party data must be http(s) — never javascript:/data: (defense in depth; the server filters too). */
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const initials = (name) => (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "J";

export function mountJarvis(main, ui) {
  const { h, set, icon, api, apiStream, go, toast, state, fmt, toSpeech } = ui;
  const S = { mode: "idle", conv: state.voiceConversationId ?? null, items: [], shown: new Set(), card: null, alive: true, cfg: { stt: "browser", tts: "browser" }, listenAgain: false, audio: null, rec: null, sr: null };

  // ─── DOM ──────────────────────────────────────────────────────────────
  const anchor = h("div", { class: "jv-anchor", "aria-hidden": "true" });
  // Tap targets: one scrolls with the home page, one sits on the small orb while talking.
  const coreBtn = h("button", { class: "jv-core-btn", "aria-label": "Mit JARVIS sprechen", onclick: () => onCore() });
  const coreBtnTalk = h("button", { class: "jv-core-btn talk-btn", "aria-label": "Zuhören / Unterbrechen", onclick: () => onCore() });
  const status = h("div", { class: "jv-status glass", role: "status", "aria-live": "polite" });
  status.addEventListener("click", () => { if (S.tapHint) onCore(); });
  const leftBtn = h("div", { class: "jv-left" });
  const greet = h("div", { class: "jv-greet" }, `${ui.greeting()}${state.userName ? `, ${state.userName.split(/\s+/)[0]}` : ""}`);
  const summary = h("div", { class: "jv-summary" }, " ");
  const prompts = h("div", { class: "jv-prompts" }, PROMPTS.map(([ic, text]) => h("button", { class: "jv-chip glass", onclick: () => ask(text) }, icon(ic), h("span", {}, text))));
  const idleBox = h("div", { class: "jv-idle" }, greet, summary, prompts);
  const bootBox = h("div", { class: "jv-boot mono hidden" });
  const userBox = h("div", { class: "jv-user" }, h("div", { class: "jv-label mono" }, "DU"), h("div", { class: "jv-user-text" }));
  const thinkBox = h("div", { class: "jv-think" }, h("div", { class: "shim" }, "Einen Moment …"), h("div", { class: "jv-tools" }));
  const caption = h("div", { class: "jv-caption", "aria-live": "polite" });
  const cards = h("div", { class: "jv-cards", role: "region", "aria-label": "Worüber JARVIS spricht" });
  const widgets = h("div", { class: "jv-widgets" });
  const stage = h("div", { class: "jv-stage" }, anchor);
  const scroller = h("div", { class: "jv-scroll" }, h("div", { class: "jv-hero" }, coreBtn), bootBox, idleBox, widgets);
  const talkCol = h("div", { class: "jv-talkcol" }, userBox, thinkBox, caption, cards);
  const root = h("div", { class: "jv st-idle" }, stage, scroller, talkCol, coreBtnTalk,
    h("div", { class: "jv-top" }, leftBtn, status, h("button", { class: "jv-avatar glass", "aria-label": "Einstellungen", onclick: () => go("settings") }, initials(state.userName))));
  set(main, root);
  document.body.classList.add("jv-on");

  let core = null;
  try { core = new Core(stage, anchor); } catch { root.classList.add("no-core"); }
  // The orb scrolls away with the home page (the canvas layer follows the scroller).
  let scrollRaf = 0;
  scroller.addEventListener("scroll", () => {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => { if (S.mode === "idle") stage.style.transform = `translate3d(0, ${-scroller.scrollTop}px, 0)`; });
  }, { passive: true });
  root.addEventListener("pointermove", (e) => { const r = root.getBoundingClientRect(); core?.pointer(e.clientX - r.left, e.clientY - r.top); });
  root.addEventListener("pointerleave", () => core?.pointerOut());

  // ─── State machine ────────────────────────────────────────────────────
  function setMode(mode, extra = {}) {
    S.mode = mode;
    // "rest": the answer (caption + card) stays on screen, the core calms down.
    const talk = mode !== "idle";
    root.className = `jv st-${mode}${talk ? " talk" : ""}${cards.childElementCount ? " has-cards" : ""}${extra.boot ? " booting" : ""}`;
    document.body.classList.toggle("jv-talk", talk);
    if (talk) {
      // Glide the orb from wherever the home page was scrolled to its place at the top.
      stage.style.transform = "";
    } else {
      stage.style.transform = `translate3d(0, ${-scroller.scrollTop}px, 0)`;
    }
    core?.set({ orb: mode === "rest" ? "idle" : mode, compact: talk, card: S.card?.kind ?? "" });
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
    status.classList.toggle("tap", !!S.tapHint && m === "idle");
    set(status, m === "listening" ? [wave("cyan"), "HÖRT ZU"] : m === "thinking" ? [h("span", { class: "spin-v" }), "DENKT NACH"] : m === "speaking" ? [wave("gold"), "SPRICHT"]
      : S.tapHint ? [h("span", { class: "live" }), "TIPPEN ZUM SPRECHEN"] : [h("span", { class: "live" }), "BEREIT"]);
  }

  /**
   * Quick start from the home screen (#jarvis?listen): listen right away when
   * the microphone is already allowed; otherwise the browser needs one tap
   * (autoplay/microphone rules), so the core asks for it.
   */
  async function quickStart() {
    let granted = false;
    try { granted = (await navigator.permissions?.query({ name: "microphone" }))?.state === "granted"; } catch { /* Safari: unknown */ }
    if (!S.alive || S.mode !== "idle") return;
    if (granted) { S.micOk = true; ensureAudioCtx(); listen(); return; }
    S.tapHint = true;
    root.classList.add("tap-hint");
    renderStatus();
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
    if (S.tapHint) { S.tapHint = false; root.classList.remove("tap-hint"); }
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

  /** @param {MediaStream} [stream] an already open microphone (barge-in hands its stream over, so no syllable is lost) */
  async function listen(stream) {
    S.listenAgain = true;
    showWords(userBox.querySelector(".jv-user-text"), "", "u");
    setMode("listening");
    if (S.cfg.stt === "server" && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) return recordAndTranscribe(stream);
    stream?.getTracks().forEach((t) => t.stop());
    return browserRecognition();
  }

  async function recordAndTranscribe(given) {
    let stream = given;
    try { stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); S.micOk = true; }
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
      S.micOk = true;
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
    thinkBox.querySelector(".jv-tools").replaceChildren();
    setThinkText("Einen Moment …");
    setMode("thinking");
    await talk("/api/chat/stream", { conversationId: S.conv ?? undefined, message: text, voice: true });
  }

  /** Tool progress as small chips under „Einen Moment …“. */
  function makeChips() {
    const tools = thinkBox.querySelector(".jv-tools");
    const chips = new Map();
    return (a) => {
      const label = a.description.split("\n")[0].slice(0, 60);
      setThinkText(a.status === "executing" ? `${label} …` : "Ich stelle die Antwort zusammen …");
      const done = a.status === "succeeded" || a.status === "partially_succeeded";
      const chip = h("div", { class: `jv-tool glass ${done ? "done" : a.status === "executing" ? "run" : "warn"}` },
        done ? h("span", { class: "ok-dot" }, icon("check")) : a.status === "executing" ? h("span", { class: "spin-v" }) : h("span", { class: "warn-dot" }, icon("alert")), h("span", {}, label));
      const old = chips.get(a.activityId);
      if (old) old.replaceWith(chip); else tools.append(chip);
      chips.set(a.activityId, chip);
      while (tools.children.length > 3) tools.firstElementChild.remove();
    };
  }

  /**
   * One agent turn, spoken while it streams: every finished sentence goes to the
   * speech queue at once, so JARVIS starts talking before the reply is complete.
   */
  async function talk(path, body) {
    const token = ++speakToken;
    const speaker = createSpeaker(token);
    const splitter = createSplitter((sentence) => speaker.push(sentence));
    const onAction = makeChips();
    let streamed = false;
    let reply;
    try {
      reply = await apiStream(path, body, (ev) => {
        if (token !== speakToken) return;
        if (ev.type === "thinking") splitter.step();
        else if (ev.type === "text") { streamed = true; splitter.feed(ev.delta); }
        else if (ev.type === "context") S.items = ev.items ?? [];
        else if (ev.type === "action") onAction(ev.action);
      });
      if (reply.conversationId) { S.conv = reply.conversationId; state.voiceConversationId = reply.conversationId; }
      if (reply.context) S.items = reply.context;
      if (streamed) splitter.end();
      else for (const sentence of sentencesOf(reply.text)) speaker.push(sentence);
    } catch (e) {
      splitter.end();
      speaker.push(`Das hat nicht geklappt: ${e.message}`);
      reply = { text: "", pendingActions: [] };
    }
    await speaker.finish();
    afterSpeaking(reply, token);
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
  /** Speaks a complete reply (local answers, no stream). */
  async function speakAll(reply) {
    const token = ++speakToken;
    S.items = reply.context ?? [];
    const speaker = createSpeaker(token);
    for (const sentence of sentencesOf(reply.text)) speaker.push(sentence);
    await speaker.finish();
    afterSpeaking(reply, token);
  }

  function afterSpeaking(reply, token) {
    if (token !== speakToken || !S.alive) return;
    stopBargeIn();
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

  /**
   * Speech queue: sentences are spoken in order as they arrive; server audio
   * for the next sentences is fetched while the current one plays.
   */
  function createSpeaker(token) {
    const queue = [];
    let busy = false;
    let finished = false;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const server = () => S.cfg.tts === "server" && voicePrefs().speak;
    const prefetch = () => { for (const q of queue.slice(0, 2)) if (!q.audio && server()) q.audio = fetchAudio(q.text); };
    async function pump() {
      if (busy) return;
      busy = true;
      while (queue.length && token === speakToken && S.alive) {
        const item = queue.shift();
        prefetch();
        if (S.mode !== "speaking") { setMode("speaking"); startBargeIn(token); }
        const it = cardFor(item.text);
        if (it && S.card?.id !== it.id) setTimeout(() => token === speakToken && openCard(it), 280);
        await speakSentence(item.text, item.audio ?? (server() ? fetchAudio(item.text) : null), token);
      }
      busy = false;
      if ((finished && !queue.length) || token !== speakToken || !S.alive) resolveDone();
    }
    return {
      push(text) {
        if (token !== speakToken) return;
        queue.push({ text, audio: null });
        prefetch();
        pump();
      },
      finish() {
        finished = true;
        if (!busy) resolveDone();
        return done;
      },
    };
  }

  /**
   * Cuts streamed text into speakable sentences. Does not split German dates
   * („am 14. Oktober“) or common abbreviations; merges very short sentences.
   */
  function createSplitter(onSentence) {
    const ABBR = /(?:^|\s)(?:\d{1,2}|[A-Za-zÄÖÜäöü]|bzw|usw|ggf|inkl|evtl|ca|Nr|Str|Dr|Prof|St|Hr|Fr|vgl|Tel|Mio|Mrd|z\.\s?B|d\.\s?h|u\.\s?a)\.$/;
    let buf = "", pos = 0, held = "", count = 0, capped = false;
    const out = (raw, final = false) => {
      if (capped) return;
      let t = toSpeech(String(raw).replace(/\[([^\]]+)\]\(#file:[0-9a-f-]{36}\)/g, "$1")).trim();
      if (!t) { if (final && held) { onSentence(held); held = ""; } return; }
      if (held) { t = `${held} ${t}`; held = ""; }
      if (t.length < 28 && !final) { held = t; return; }
      if (++count > 14) { capped = true; onSentence("Den Rest findest du im Chat."); return; }
      onSentence(t);
    };
    const scan = (final) => {
      const re = /([.!?…]+["“”»)]*)(?=\s)|\n+/g;
      re.lastIndex = pos;
      let m;
      while ((m = re.exec(buf))) {
        const end = m.index + (m[1] ? m[1].length : 0);
        const piece = buf.slice(pos, end);
        if (m[1] === "." && ABBR.test(piece)) continue;
        out(piece);
        pos = m.index + m[0].length;
      }
      if (final) { out(buf.slice(pos), true); pos = buf.length; }
    };
    return {
      feed(delta) { buf += delta; scan(false); },
      /** A new model step begins: whatever the previous step said is complete. */
      step() { if (buf.length > pos) scan(true); buf = ""; pos = 0; },
      end() { scan(true); buf = ""; pos = 0; },
    };
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

  // ─── Barge-in: start talking while JARVIS speaks ──────────────────────
  // The microphone (with echo cancellation) watches for your voice while JARVIS
  // talks. Sustained speech above the calibrated level stops the output and
  // hands the open stream straight to the recorder.
  let barge = null;
  async function startBargeIn(token) {
    if (barge || voicePrefs().bargeIn === false || !navigator.mediaDevices?.getUserMedia) return;
    // Only when the microphone is already allowed — never a permission prompt mid-sentence.
    let allowed = !!S.micOk;
    if (!allowed) { try { allowed = (await navigator.permissions?.query({ name: "microphone" }))?.state === "granted"; } catch { allowed = false; } }
    if (!allowed || token !== speakToken || S.mode !== "speaking") return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { return; }
    if (token !== speakToken || S.mode !== "speaking") { stream.getTracks().forEach((t) => t.stop()); return; }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(1024);
    const t0 = performance.now();
    let floor = 0.01, loud = 0, last = t0, raf = 0;
    const ctl = { stream, stop: (keepStream) => {
      cancelAnimationFrame(raf);
      try { src.disconnect(); } catch { /* ignore */ }
      if (!keepStream) stream.getTracks().forEach((t) => t.stop());
      if (barge === ctl) barge = null;
    } };
    barge = ctl;
    const tick = (now) => {
      if (barge !== ctl) return;
      if (token !== speakToken || S.mode !== "speaking") return ctl.stop(false);
      an.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
      // First 500 ms: learn the room + echo residue of JARVIS' own voice.
      if (now - t0 < 500) floor = Math.max(floor, rms * 1.4);
      else {
        const thr = Math.max(0.045, floor * 2.6);
        loud = rms > thr ? loud + (now - last) : Math.max(0, loud - (now - last) * 0.6);
        if (loud > 260) {
          ctl.stop(true);
          stopSpeaking();
          S.listenAgain = true;
          listen(S.cfg.stt === "server" ? stream : (stream.getTracks().forEach((t) => t.stop()), undefined));
          return;
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function stopBargeIn() { barge?.stop(false); }

  function stopSpeaking() {
    stopBargeIn();
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
  /** Shows a card below the caption (newest on top); an already shown card just lights up again. */
  function openCard(it) {
    S.card = it;
    const key = `${it.kind}:${it.id}`;
    S.shown.add(key);
    let el = [...cards.children].find((c) => c.dataset.key === key);
    if (el) {
      el.classList.remove("again");
      void el.offsetWidth;
      el.classList.add("again");
      cards.prepend(el);
    } else {
      el = h("div", { class: "jc-wrap glass", "data-key": key }, renderCard(it));
      cards.prepend(el);
      while (cards.children.length > 4) cards.lastElementChild.remove();
    }
    root.classList.add("has-cards");
    core?.set({ compact: true, card: it.kind });
    linkTo(el);
  }
  /** Particles stream from the core to the card once it has landed. */
  function linkTo(el, delay = 420) {
    setTimeout(() => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const host = stage.getBoundingClientRect();
      core?.link(r.left - host.left + r.width / 2, r.top - host.top + 12, Math.min(300, r.width * 0.7));
    }, delay);
  }
  function closeCard() {
    S.card = null;
    cards.replaceChildren();
    root.classList.remove("has-cards");
    core?.set({ card: "" });
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
        actions(btn("Im Kalender", () => { state.calendarFocus = it.start; state.calendarFocusId = it.id; go("calendar"); }, true),
          it.location ? h("a", { class: "jc-btn", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.location)}`, target: "_blank", rel: "noopener" }, "Route") : btn("Schließen", closeCard)));
    } else if (it.kind === "finance" && it.detail?.kind) {
      // Item from the finance overview (detected invoice / subscription / manual entry)
      const sub = it.detail.kind === "subscription";
      const due = it.due ? new Date(`${it.due}T12:00:00`) : null;
      const overdue = due && due < new Date() && it.status === "open";
      append(body,
        cardHead("finance", sub ? ({ monthly: "monatlich", yearly: "jährlich", quarterly: "vierteljährlich", weekly: "wöchentlich" }[it.detail.interval] ?? "Abo") : due ? `fällig ${due.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}` : null, overdue ? "red" : sub ? "" : "orange"),
        it.amount ? h("div", { class: "jc-big gold" }, it.amount) : null,
        h("div", { class: "jc-from" }, ui.avatar(it.from || "?"), h("div", {}, h("div", { class: "jc-name" }, it.from), h("div", { class: "jc-sub" }, { open: "offen", paid: "bezahlt", autopay: "wird abgebucht", ignored: "ausgeblendet" }[it.status] ?? ""))),
        h("div", { class: "jc-title" }, it.title),
        actions(it.status === "open" ? btn("Bezahlt", async (e) => { e.currentTarget.disabled = true; await api(`/api/finance/${it.id}`, { method: "PATCH", body: { status: "paid" } }).catch(() => {}); toast("Als bezahlt markiert.", "ok"); }, true) : btn("Finanzen", () => go("finance"), true),
          btn(it.status === "open" ? "Finanzen" : "Schließen", it.status === "open" ? () => go("finance") : closeCard)));
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
    } else if (it.kind === "weather") {
      const d = it.detail ?? {};
      append(body,
        cardHead("weather", it.title),
        h("div", { class: "jc-weather" },
          h("span", { class: "wx-icon" }, icon(`w-${d.icon ?? "partly"}`)),
          h("span", { class: "jc-big" }, `${d.temperature ?? "–"}°`),
          h("div", { class: "wx-now" }, h("div", { class: "jc-name" }, d.text ?? ""), h("div", { class: "jc-sub" }, `gefühlt ${d.feelsLike ?? "–"}° · Wind ${d.windKmh ?? "–"} km/h`))),
        d.hint ? h("div", { class: "jc-hint" }, icon("alert"), d.hint) : null,
        d.hours?.length ? h("div", { class: "wx-hours" }, d.hours.map((x, i) =>
          h("div", { class: "wx-h", style: `animation-delay:${0.35 + i * 0.05}s` },
            h("span", { class: "mono" }, x.time ? new Date(x.time).toLocaleTimeString("de-DE", { hour: "2-digit" }) : ""),
            icon(`w-${x.icon ?? "partly"}`),
            h("b", {}, `${x.temperature ?? "–"}°`),
            h("span", { class: `rain ${x.rain >= 50 ? "hi" : ""}` }, `${x.rain ?? 0}%`)))) : null,
        d.days?.length ? h("div", { class: "wx-days" }, d.days.slice(1, 4).map((x) =>
          h("div", { class: "wx-d" }, h("span", {}, new Date(`${x.date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short" })), icon(`w-${x.icon ?? "partly"}`), h("span", { class: "mono" }, `${x.min}° / ${x.max}°`)))) : null);
    } else if (it.kind === "place") {
      const d = { ...(it.detail ?? {}) };
      d.website = safeUrl(d.website);
      d.mapsUrl = safeUrl(d.mapsUrl) ?? "https://www.google.com/maps";
      const dist = d.distanceM >= 1000 ? `${(d.distanceM / 1000).toFixed(1).replace(".", ",")} km` : `${d.distanceM} m`;
      const resv = { yes: "Reservierung möglich", required: "Reservierung nötig", recommended: "Reservierung empfohlen", no: "Keine Reservierung" }[d.reservation];
      append(body,
        cardHead("place", dist),
        h("div", { class: "jc-title big" }, it.title),
        d.cuisine ? h("div", { class: "jc-sub cap" }, d.cuisine) : null,
        h("div", { class: "jc-meta" },
          it.location ? h("div", {}, icon("pin"), it.location) : null,
          d.openingHours ? h("div", {}, icon("clock"), d.openingHours) : null,
          resv ? h("div", {}, icon("calendar"), resv) : null),
        actions(
          d.website ? h("a", { class: "jc-btn primary", href: d.website, target: "_blank", rel: "noopener noreferrer" }, "Website") : null,
          d.phone ? h("a", { class: `jc-btn ${d.website ? "" : "primary"}`, href: `tel:${String(d.phone).replace(/[^+\d]/g, "")}` }, "Anrufen") : null,
          h("a", { class: "jc-btn", href: d.mapsUrl, target: "_blank", rel: "noopener noreferrer" }, "Route")),
        h("div", { class: "jc-actions" }, btn("Hier reservieren", () => ask(`Reservier mir bitte einen Tisch bei ${it.title}${it.location ? ` (${it.location})` : ""}.`), true)));
    } else if (it.kind === "list") {
      const d = it.detail ?? {};
      const box = h("div", { class: "jc-list" }, (d.items ?? []).map((x, i) => {
        const row = h("button", { class: `jc-li ${x.done ? "done" : ""}`, style: `animation-delay:${0.25 + i * 0.06}s`, onclick: async () => {
          const done = !row.classList.contains("done");
          row.classList.toggle("done", done);
          await api(`/api/list-items/${x.id}`, { method: "PATCH", body: { done } }).catch(() => row.classList.toggle("done", !done));
        } }, h("span", { class: "tick" }, icon("check")), h("span", {}, x.text));
        return row;
      }));
      append(body, cardHead("list", `${d.open ?? 0} offen`), h("div", { class: "jc-title" }, it.title), box,
        actions(btn("Alle Listen", () => go("notes"), true), btn("Schließen", closeCard)));
    } else if (it.kind === "news") {
      const d = { ...(it.detail ?? {}), link: safeUrl(it.detail?.link) };
      append(body,
        cardHead("news", d.source ?? null),
        h("div", { class: "jc-title" }, it.title),
        it.snippet ? h("div", { class: "jc-snippet" }, it.snippet) : null,
        it.date ? h("div", { class: "jc-note mono" }, fmt.rel(it.date).toUpperCase()) : null,
        actions(d.link ? h("a", { class: "jc-btn primary", href: d.link, target: "_blank", rel: "noopener noreferrer" }, "Artikel lesen") : null, btn("Schließen", closeCard)));
    } else if (it.kind === "note") {
      append(body, cardHead("note", null), h("div", { class: "jc-title" }, it.title), it.snippet ? h("div", { class: "jc-snippet note" }, it.snippet) : null,
        actions(btn("Notizen", () => go("notes"), true), btn("Schließen", closeCard)));
    }
    return body;
  }
  const append = (node, ...children) => ui.append(node, children);

  function openConfirm(p) {
    const crit = p.risk >= 3;
    const [headline, ...rest] = p.description.split("\n");
    S.card = { kind: "task", id: p.id };
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
    const wrap = h("div", { class: "jc-wrap glass confirm-wrap", "data-key": `confirm:${p.id}` }, card);
    cards.prepend(wrap);
    root.classList.add("has-cards");
    linkTo(wrap);
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
          closeCard();
          await talk(`/api/confirmations/${p.id}`, { approve: true, stream: true });
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
  const queued = state.jarvisPrompt;
  state.jarvisPrompt = null;
  api("/api/voice/config").then((c) => { S.cfg = c; }).catch(() => {}).finally(() => {
    if (!S.alive) return;
    if (queued) ask(queued);
    else if (ui.autoListen) quickStart();
  });
  // ─── Home widgets ─────────────────────────────────────────────────────
  const euro = (c) => `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const widget = (cls, glyph, ic, label, onOpen, ...content) =>
    h("section", { class: `wd ${cls} glass` },
      h("button", { class: "wd-head", onclick: onOpen }, h("span", { class: `jc-glyph ${glyph}` }, icon(ic)), h("span", { class: "wd-label" }, label), icon("right")),
      ...content);

  function weatherWidget(home) {
    const w = home?.weather;
    if (w?.ok) {
      const d = w.data;
      return widget("wd-weather", "k-weather", `w-${d.now.icon}`, d.place.name, () => ask("Wie wird das Wetter heute und morgen?"),
        h("div", { class: "wd-wx" }, h("span", { class: "wx-icon" }, icon(`w-${d.now.icon}`)), h("span", { class: "wd-big" }, `${d.now.temperature}°`)),
        h("div", { class: "wd-sub" }, `${d.now.text} · ${d.days[0]?.min ?? "–"}° / ${d.days[0]?.max ?? "–"}°`),
        d.hint ? h("div", { class: "wd-hint" }, d.hint) : null);
    }
    const input = h("input", { class: "wd-input", placeholder: "Deine Stadt, z.B. Hamburg", "aria-label": "Heimatort für das Wetter", maxlength: "100" });
    const save = async () => {
      const city = input.value.trim();
      if (city.length < 2) return;
      try { await api("/api/life/settings", { method: "PUT", body: { city } }); loadHome(); } catch (e) { toast(e.message, "err"); }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && save());
    return widget("wd-weather", "k-weather", "w-partly", "Wetter", () => go("settings"),
      h("div", { class: "wd-sub" }, w?.code === "NOT_CONFIGURED" ? "Wo wohnst du? Dann weiß ich, ob du einen Schirm brauchst." : "Wetter gerade nicht erreichbar."),
      w?.code === "NOT_CONFIGURED" ? h("div", { class: "wd-row" }, input, h("button", { class: "jc-btn primary sm", onclick: save }, "Speichern")) : null);
  }

  /** Today as a compact 24-hour ring plus what is happening now / next. */
  function dayWidget(b) {
    const ok = !!b?.events?.ok;
    const events = ok ? b.events.data : [];
    const now = new Date();
    const timed = events.filter((e) => !e.allDay).sort((a, z) => new Date(a.start) - new Date(z.start));
    const current = timed.find((e) => new Date(e.start) <= now && new Date(e.end) > now);
    const upcoming = timed.filter((e) => new Date(e.start) > now);
    const focus = current ?? upcoming[0];
    const allDay = events.filter((e) => e.allDay);
    const openCal = () => { if (focus) { state.calendarFocus = focus.start; state.calendarFocusId = focus.id; } go("calendar"); };
    const info = !ok
      ? [h("div", { class: "wd-title" }, "Kalender"), h("div", { class: "wd-sub" }, b?.events?.code === "NOT_CONFIGURED" ? "Noch nicht verbunden." : "Gerade nicht erreichbar."),
         b?.events?.code === "NOT_CONFIGURED" ? h("button", { class: "jc-btn sm", onclick: () => go("settings") }, "Verbinden") : null]
      : focus
        ? [h("div", { class: `wd-kicker mono ${current ? "live" : ""}` }, current ? `JETZT · BIS ${fmt.time(current.end)}` : `ALS NÄCHSTES · ${fmt.time(focus.start)}`),
           h("div", { class: "wd-title" }, focus.title),
           focus.location ? h("div", { class: "wd-sub" }, icon("pin"), focus.location) : h("div", { class: "wd-sub" }, current ? "läuft gerade" : ui.inHours(new Date(focus.start) - now))]
        : [h("div", { class: "wd-kicker mono" }, "HEUTE"), h("div", { class: "wd-title" }, timed.length ? "Alles erledigt" : "Kein Termin"), h("div", { class: "wd-sub" }, "Der Rest des Tages gehört dir.")];
    const rest = upcoming.filter((e) => e !== focus).slice(0, 3);
    const color = (e) => ui.ringColors[timed.indexOf(e) % ui.ringColors.length];
    return widget("wd-day", "k-event", "calendar", ok && events.length ? `Heute · ${events.length} ${events.length === 1 ? "Termin" : "Termine"}` : "Heute", openCal,
      h("div", { class: "wd-day-row" }, h("div", { class: "wd-ring" }, ui.dayRing(events, ok)), h("div", { class: "wd-day-info" }, info)),
      allDay.length ? h("div", { class: "wd-sub wd-allday" }, `Ganztägig: ${allDay.map((e) => e.title).join(", ")}`) : null,
      rest.length ? h("div", { class: "wd-day-list" }, rest.map((e) =>
        h("button", { class: "wd-day-item", onclick: () => ui.openEventSheet(e, timed) }, h("span", { class: "dot", style: `background:${color(e)}` }), h("span", { class: "mono" }, fmt.time(e.start)), h("span", { class: "t" }, e.title)))) : null);
  }

  /** Actions waiting for a decision — approve right on the home screen. */
  function pendingWidget(b) {
    const pending = b?.pending?.ok ? b.pending.data : [];
    if (!pending.length) return null;
    return widget("wd-pending", "k-crit", "shield", `Wartet auf dich · ${pending.length}`, () => go("activity"),
      h("div", { class: "wd-confirms" }, pending.slice(0, 3).map((p) => ui.confirmCard(p, () => loadHome()))),
      pending.length > 3 ? h("div", { class: "wd-more mono" }, `+${pending.length - 3} WEITERE IN „AKTIVITÄT“`) : null);
  }

  const usd = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** AI spend this month vs. budget — only once there is something to show. */
  function costWidget(home) {
    const u = home?.usage?.ok ? home.usage.data : null;
    if (!u || (!u.budgetUsd && u.spentUsd < 0.01)) return null;
    const pct = u.budgetUsd ? Math.round(u.ratio * 100) : null;
    const level = !u.budgetUsd ? "" : u.ratio >= 1 ? "crit" : u.ratio >= 0.8 ? "warn" : "";
    const note = u.blocked ? "Budget aufgebraucht — neue KI-Anfragen sind bis Monatsende pausiert."
      : u.budgetUsd && u.ratio >= 1 ? "Budget überschritten (harte Grenze ist aus)."
      : level === "warn" ? `Über 80 % deines Monatsbudgets.` : null;
    return widget(`wd-cost ${level}`, "k-cost", "bolt", "KI-Kosten diesen Monat", () => go("settings", "?focus=cost"),
      h("div", { class: "wd-cost-row" }, h("span", { class: "wd-big" }, usd(u.spentUsd)),
        h("span", { class: "wd-sub" }, u.budgetUsd ? `von ${usd(u.budgetUsd)} · ${pct} %` : `${u.requests} Anfrage${u.requests === 1 ? "" : "n"} · kein Limit`)),
      u.budgetUsd ? h("div", { class: "wd-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.min(100, pct)) }, h("div", { style: `width:${Math.min(100, pct)}%` })) : null,
      note ? h("div", { class: "wd-hint" }, note) : null);
  }

  function listWidget(home) {
    const lists = home?.lists?.ok ? home.lists.data : [];
    const list = lists.find((l) => l.open) ?? lists[0] ?? { name: "Einkaufsliste", items: [], open: 0 };
    const input = h("input", { class: "wd-input", placeholder: `Auf „${list.name}“ setzen …`, "aria-label": `Eintrag für ${list.name}`, maxlength: "200" });
    const items = h("div", { class: "wd-list" }, list.items.slice(0, 5).map((x) => {
      const row = h("button", { class: `jc-li ${x.done ? "done" : ""}`, onclick: async () => {
        const done = !row.classList.contains("done");
        row.classList.toggle("done", done);
        await api(`/api/list-items/${x.id}`, { method: "PATCH", body: { done } }).catch(() => row.classList.toggle("done", !done));
      } }, h("span", { class: "tick" }, icon("check")), h("span", {}, x.text));
      return row;
    }));
    const add = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try { await api(`/api/lists/${encodeURIComponent(list.name)}/items`, { method: "POST", body: { items: [text] } }); loadHome(); } catch (e) { toast(e.message, "err"); }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && add());
    return widget("wd-list-w", "k-list", "list", list.open ? `${list.name} · ${list.open}` : list.name, () => go("notes"),
      list.items.length ? items : h("div", { class: "wd-sub" }, "Leer. Sag einfach: „Schreib Milch auf die Einkaufsliste.“"),
      h("div", { class: "wd-row" }, input, h("button", { class: "jc-btn sm", "aria-label": "Hinzufügen", onclick: add }, icon("plus"))));
  }

  function renderWidgets(b, home) {
    const out = [];
    out.push(dayWidget(b));
    const confirms = pendingWidget(b);
    if (confirms) out.push(confirms);
    const suggSlot = h("div", { class: "wd-slot" });
    out.push(suggSlot);
    ui.suggestionItems?.(() => loadHome()).then((items) => {
      if (!S.alive || !items?.length) return;
      set(suggSlot, widget("wd-sugg", "k-mail", "bolt", `Vorschläge aus deinen Mails · ${items.length}`, () => go("settings", "?focus=triage"), h("div", { class: "sugg-list" }, items)));
    }).catch(() => {});
    out.push(weatherWidget(home));
    const mails = b?.emails?.ok ? b.emails.data.length : null;
    const tasks = b?.tasks?.ok ? b.tasks.data.length : null;
    const pending = b?.pending?.ok ? b.pending.data.length : 0;
    out.push(h("div", { class: "wd-tiles" },
      h("button", { class: "wd-tile glass", onclick: () => go("email") }, h("span", { class: "jc-glyph k-mail" }, icon("mail")), h("b", {}, mails ?? "–"), h("span", {}, "Ungelesen")),
      h("button", { class: "wd-tile glass", onclick: () => go("tasks") }, h("span", { class: "jc-glyph k-task" }, icon("tasks")), h("b", {}, tasks ?? "–"), h("span", {}, "Aufgaben")),
      h("button", { class: `wd-tile glass ${pending ? "warn" : ""}`, onclick: () => go("activity") }, h("span", { class: "jc-glyph k-crit" }, icon("shield")), h("b", {}, pending), h("span", {}, "Warten"))));
    const f = home?.finance?.ok ? home.finance.data : null;
    if (f) {
      out.push(widget("wd-fin", "k-finance", "euro", "Finanzen", () => go("finance"),
        h("div", { class: "wd-fin-row" },
          h("div", {}, h("div", { class: "wd-big gold" }, euro(f.openTotalCents)), h("div", { class: "wd-sub" }, f.openCount ? `${f.openCount} offene Rechnung${f.openCount === 1 ? "" : "en"}${f.overdue.length ? ` · ${f.overdue.length} überfällig` : ""}` : "Nichts offen")),
          h("div", { class: "wd-fin-side" }, h("b", {}, euro(f.subscriptionsMonthlyCents)), h("span", {}, "Abos / Monat"))),
        f.dueSoon[0] ? h("div", { class: "wd-hint" }, `${f.dueSoon[0].vendor}: ${f.dueSoon[0].amountCents !== null ? euro(f.dueSoon[0].amountCents) : ""} fällig am ${new Date(`${f.dueSoon[0].dueDate}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`) : null));
    }
    const cost = costWidget(home);
    if (cost) out.push(cost);
    out.push(listWidget(home));
    const news = home?.news?.ok ? home.news.data.items : [];
    if (news.length) {
      out.push(widget("wd-news", "k-news", "news", "Nachrichten", () => ask("Was gibt es Neues?"),
        h("div", { class: "wd-news-list" }, news.slice(0, 3).map((n) => {
          const href = safeUrl(n.link);
          return h(href ? "a" : "div", { class: "wd-news-item", href: href ?? undefined, target: "_blank", rel: "noopener noreferrer" }, h("span", { class: "mono" }, n.source.toUpperCase()), h("span", {}, n.title));
        }))));
    }
    out.forEach((el, i) => { el.style.animationDelay = `${0.08 + i * 0.07}s`; });
    set(widgets, out);
  }

  async function loadHome() {
    const [b, home] = await Promise.all([api("/api/briefing").catch(() => null), api("/api/home").catch(() => null)]);
    if (!S.alive) return;
    renderWidgets(b, home);
    const events = b?.events?.ok ? b.events.data : [];
    const upcoming = events.filter((e) => !e.allDay && new Date(e.end) > new Date());
    const w = home?.weather?.ok ? home.weather.data : null;
    summary.textContent = [
      w ? `${w.now.temperature}° und ${w.now.text.toLowerCase()}` : "",
      upcoming.length ? `${upcoming.length} ${upcoming.length === 1 ? "Termin" : "Termine"} heute` : b?.events?.ok ? "keine Termine mehr" : "",
    ].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase());
    return b;
  }
  set(widgets, [1, 2, 3].map(() => h("div", { class: "wd glass skeleton" })));
  loadHome().then((b) => {
    if (!firstOpen || !b) return;
    const events = b.events?.ok ? b.events.data : [];
    const mails = b.emails?.ok ? b.emails.data.length : 0;
    const ln = (t, i) => h("span", { class: `bl bl${i}` }, h("span", { class: "live" }), t);
    append(bootBox,
      b.events?.ok ? ln(`KALENDER · ${events.length} TERMIN${events.length === 1 ? "" : "E"}`, 1) : null,
      b.emails?.ok ? ln(`POSTFACH · ${mails} UNGELESEN`, 2) : null,
      ln(`AUFGABEN · ${b.tasks?.ok ? b.tasks.data.length : 0} OFFEN`, 3));
  });

  return () => {
    S.alive = false;
    stopBargeIn();
    stopListening(true);
    stopSpeaking();
    core?.destroy();
    document.body.classList.remove("jv-on", "jv-talk");
    try { actx?.close(); } catch { /* ignore */ }
  };
}
