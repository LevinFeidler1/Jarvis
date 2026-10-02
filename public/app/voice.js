// Speech in the chat (browser recognition + synthesis).

import { state } from "./api.js";
import { $, h, icon, set } from "./dom.js";
import { isMobile } from "./shell.js";
import { toast } from "./ui.js";
import { sendMessage } from "./view-chat.js";

// ─── Voice (Sprach-Chat) ─────────────────────────────────────────────────────
// Browser speech recognition + speech synthesis. Same agent, same permission
// rules as typing: a spoken "ja" is sent as a normal message; critical actions
// are refused server-side and need the button.
export const voice = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition || null,
  rec: null,
  listening: false,
  speaking: false,
  unlocked: false,
  prefs: (() => {
    const d = { speak: true, conversation: false, voiceURI: null, rate: 1.05, bargeIn: true };
    try { return { ...d, ...JSON.parse(localStorage.getItem("jarvis-voice") || "{}") }; } catch { return d; }
  })(),
  save() { try { localStorage.setItem("jarvis-voice", JSON.stringify(this.prefs)); } catch { /* ignore */ } },
  get canListen() { return !!this.SR; },
  get canSpeak() { return "speechSynthesis" in window; },

  voices() {
    if (!this.canSpeak) return [];
    return speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("de"));
  },
  pickVoice() {
    const list = this.voices();
    return list.find((v) => v.voiceURI === this.prefs.voiceURI)
      ?? list.find((v) => /google deutsch|markus|conrad|yannick|killian|anna|helena|katja|petra|vicki/i.test(v.name))
      ?? list[0] ?? null;
  },

  /** iOS/Safari only allow speech after a user gesture: prime it once. */
  unlock() {
    if (this.unlocked || !this.canSpeak) return;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
    this.unlocked = true;
  },

  toSpeech(text) {
    let t = String(text ?? "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[*_`#>]/g, "")
      .replace(/^\s*[-•]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/\.\s*\./g, ".")
      .replace(/([:!?;,])\s*\./g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (t.length > 700) {
      const cut = t.slice(0, 700);
      t = `${cut.slice(0, Math.max(cut.lastIndexOf(". "), 400) + 1)} Den Rest findest du im Chat.`;
    }
    return t;
  },

  speak(text, onEnd) {
    if (!this.canSpeak || !text) { onEnd?.(); return; }
    this.stopSpeaking();
    let finished = false;
    const done = () => { if (finished) return; finished = true; this.speaking = false; voiceUi(); onEnd?.(); };
    try {
      const u = new SpeechSynthesisUtterance(this.toSpeech(text));
      const v = this.pickVoice();
      try { if (v) u.voice = v; } catch { /* keep default voice */ }
      u.lang = v?.lang ?? "de-DE";
      u.rate = this.prefs.rate;
      u.onstart = () => { this.speaking = true; voiceUi(); };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    } catch {
      done(); // speech output must never break the chat
    }
  },
  stopSpeaking() {
    if (this.canSpeak) speechSynthesis.cancel();
    this.speaking = false;
    voiceUi();
  },

  listen({ onInterim, onFinal }) {
    if (!this.canListen) { toast("Spracheingabe wird von diesem Browser nicht unterstützt (Chrome, Edge oder Safari verwenden).", "err"); return; }
    this.stopSpeaking();
    this.stopListening();
    const rec = new this.SR();
    rec.lang = "de-DE";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim?.((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast("Mikrofon-Zugriff verweigert. Erlaube das Mikrofon in den Browser-Einstellungen für diese Seite.", "err");
        this.prefs.conversation = false;
      } else if (e.error === "network") toast("Spracherkennung nicht erreichbar (Netzwerk).", "err");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast(`Spracherkennung: ${e.error}`, "err");
    };
    rec.onend = () => {
      this.listening = false;
      this.rec = null;
      voiceUi();
      const text = finalText.trim();
      if (text) onFinal?.(text);
      else if (this.prefs.conversation) { this.prefs.conversation = false; voiceUi(); toast("Gesprächsmodus beendet (nichts gehört)."); }
    };
    this.rec = rec;
    this.listening = true;
    voiceUi();
    try { rec.start(); } catch { this.listening = false; voiceUi(); }
  },
  stopListening() {
    try { this.rec?.stop(); } catch { /* ignore */ }
  },
};
if (voice.canSpeak) speechSynthesis.onvoiceschanged = () => { /* voices load async */ };

const END_WORDS = /^(stopp?|ende|beenden|danke,? das war'?s|das war'?s|tschüss|gesprächsmodus aus)[.! ]*$/i;

/** Reflects voice state in the chat UI. */
export function voiceUi() {
  const mic = $("#mic-btn");
  if (mic) {
    mic.classList.toggle("on", voice.listening);
    mic.setAttribute("aria-pressed", String(voice.listening));
    mic.title = voice.listening ? "Zuhören beenden" : "Sprechen";
  }
  $(".composer")?.classList.toggle("listening", voice.listening);
  const input = $("#chat-input");
  if (input) input.placeholder = voice.listening ? "Ich höre zu …" : isMobile() ? "Nachricht an JARVIS …" : "Frag JARVIS oder gib einen Auftrag …";
  $(".chat-top .orb")?.classList.toggle("busy", voice.speaking);
  const spk = $("#speak-btn");
  if (spk) {
    set(spk, icon(voice.speaking ? "stop" : voice.prefs.speak ? "volume" : "mute"), h("span", {}, voice.speaking ? "Stopp" : voice.prefs.speak ? "Vorlesen an" : "Vorlesen aus"));
    spk.classList.toggle("active-chip", voice.prefs.speak);
  }
  const conv = $("#conv-btn");
  if (conv) conv.classList.toggle("active-chip", voice.prefs.conversation);
}

export function startVoiceInput() {
  voice.unlock();
  const input = $("#chat-input");
  voice.listen({
    onInterim: (t) => { if (input) { input.value = t; input.dispatchEvent(new Event("input")); } },
    onFinal: (t) => {
      if (input) { input.value = ""; input.dispatchEvent(new Event("input")); }
      if (voice.prefs.conversation && END_WORDS.test(t.trim())) {
        voice.prefs.conversation = false; voice.save(); voiceUi();
        voice.speak("Gesprächsmodus beendet.");
        return;
      }
      sendMessage(t, { viaVoice: true });
    },
  });
}

/** Speak the reply if the request came by voice; keep the conversation going. */
export function speakReply(reply) {
  let text = reply.text;
  const crit = (reply.pendingActions ?? []).some((p) => p.risk >= 3);
  if (crit) text += " Achtung: Das ist eine kritische Aktion. Bitte bestätige sie per Knopf auf dem Bildschirm.";
  const again = () => { if (voice.prefs.conversation && !crit && state.view === "chat") setTimeout(startVoiceInput, 250); };
  if (voice.prefs.speak) voice.speak(text, again);
  else again();
}
