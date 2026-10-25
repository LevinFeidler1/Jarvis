// Web push and Telegram settings cards.

import { api } from "./api.js";
import { fmt, h, icon, set } from "./dom.js";
import { fail, toast } from "./ui.js";

// ─── Push-Benachrichtigungen ───────────────────────────────────────────────
export const push = {
  supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
  standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  async register() {
    if (!("serviceWorker" in navigator)) return null;
    try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch { return null; }
  },
  async subscription() {
    if (!this.supported) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  },
  deviceLabel() {
    const ua = navigator.userAgent;
    const dev = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "Gerät";
    const br = /edg\//i.test(ua) ? "Edge" : /firefox/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Browser";
    return `${dev} · ${br}`;
  },
  async enable() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(perm === "denied" ? "Benachrichtigungen sind blockiert. Bitte in den Einstellungen des Geräts für JARVIS erlauben." : "Keine Erlaubnis erteilt.");
    const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await this.register());
    if (!reg) throw new Error("Service Worker konnte nicht registriert werden.");
    await navigator.serviceWorker.ready;
    const { publicKey } = await api("/api/push");
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    const json = sub.toJSON();
    await api("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: json.endpoint, keys: json.keys }, label: this.deviceLabel() } });
  },
  async disable() {
    const sub = await this.subscription();
    if (!sub) return;
    await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  },
};

export function pushCard(onChange) {
  const card = h("div", { class: "card" }, h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "spinner" })));
  const render = async () => {
    const [info, sub] = await Promise.all([api("/api/push").catch(() => ({ devices: [] })), push.subscription().catch(() => null)]);
    const perm = push.supported ? Notification.permission : "unsupported";
    const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; render(); onChange?.(); } };
    let head;
    if (!push.supported) {
      head = h("div", { class: "banner warn", style: "max-width:none;margin:0" }, icon("alert"), h("div", {},
        push.ios && !push.standalone
          ? [h("b", {}, "Auf dem iPhone: "), "JARVIS zuerst installieren — in Safari auf Teilen ", h("b", {}, "↑"), " → „Zum Home-Bildschirm“, dann JARVIS über das neue Symbol öffnen und hier aktivieren (ab iOS 16.4)."]
          : "Dieser Browser unterstützt keine Push-Nachrichten. Chrome, Edge, Firefox oder Safari (Mac/iPhone) verwenden."));
    } else if (perm === "denied") {
      head = h("div", { class: "banner warn", style: "max-width:none;margin:0" }, icon("alert"), h("div", {}, "Benachrichtigungen sind für JARVIS blockiert. In den Einstellungen des Geräts/Browsers erlauben und die Seite neu laden."));
    } else if (sub) {
      const test = h("button", { class: "btn" }, icon("bell"), h("span", {}, "Test senden"));
      test.onclick = busy(test, async () => { const r = await api("/api/push/test", { method: "POST" }); toast(r.pushed ? `Test an ${r.pushed} Gerät(e) gesendet.` : "Kein Gerät erreicht.", r.pushed ? "ok" : "err"); });
      const off = h("button", { class: "btn ghost" }, "Auf diesem Gerät ausschalten");
      off.onclick = busy(off, () => push.disable());
      head = h("div", { class: "push-head" }, h("span", { class: "badge ok" }, icon("check"), "Aktiv auf diesem Gerät"), h("div", { class: "push-actions" }, test, off));
    } else {
      const on = h("button", { class: "btn primary" }, icon("bell"), h("span", {}, "Auf diesem Gerät aktivieren"));
      on.onclick = busy(on, async () => { await push.enable(); toast("Push-Benachrichtigungen aktiviert.", "ok"); });
      head = h("div", { class: "push-head" }, h("div", { class: "muted small", style: "flex:1;min-width:200px" }, "Erinnerungen, Automationen und wartende Bestätigungen kommen als Nachricht aufs Handy — auch wenn JARVIS geschlossen ist."), on);
    }
    set(card,
      h("div", { class: "card-body", style: "padding:18px;display:grid;gap:12px" }, head),
      info.devices.map((d) => h("div", { class: "integration" }, h("div", { class: "logo" }, icon("bell")),
        h("div", { class: "main" }, h("div", { class: "title" }, d.label ?? d.host), h("div", { class: "sub" }, d.lastSuccessAt ? `zuletzt zugestellt ${fmt.rel(d.lastSuccessAt)}` : `eingerichtet ${fmt.rel(d.createdAt)}`)),
        h("button", { class: "btn ghost icon sm", "aria-label": "Gerät entfernen", onclick: async () => { await api(`/api/push/devices/${d.id}`, { method: "DELETE" }).catch(fail); render(); } }, icon("trash")))));
  };
  render().catch((e) => set(card, h("div", { class: "card-body" }, h("div", { class: "empty" }, e.message))));
  return card;
}

export function telegramCard() {
  const card = h("div", { class: "card" }, h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "spinner" })));
  const render = async () => {
    const st = await api("/api/telegram/status");
    const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; render(); } };
    if (!st.configured) {
      set(card, h("div", { class: "card-body", style: "padding:18px;display:grid;gap:8px" },
        h("div", {}, "Schreib JARVIS über Telegram — Text, Sprachnachrichten und Dateien. Bestätigungen und Vorschläge kommen mit Knöpfen."),
        h("div", { class: "muted small" }, "Einrichtung: Bot bei @BotFather anlegen, TELEGRAM_BOT_TOKEN in Vercel eintragen, neu deployen. Anleitung: docs/TELEGRAM.md")));
      return;
    }
    const rows = [];
    rows.push(h("div", { class: "integration" }, h("div", { class: "logo", style: "color:#229ed9" }, icon("send")),
      h("div", { class: "main" }, h("div", { class: "title" }, st.bot ? `@${st.bot.username}` : "Bot"), h("div", { class: "sub" }, st.error ? `Fehler: ${st.error}` : st.chatIdSet ? "Nur dein Chat wird beantwortet." : "TELEGRAM_CHAT_ID fehlt: schreib dem Bot /start, er nennt dir die Chat-ID.")),
      h("span", { class: `badge ${st.webhook?.active && st.chatIdSet ? "ok" : "warn"}` }, st.webhook?.active ? (st.chatIdSet ? "verbunden" : "Chat-ID fehlt") : "Webhook fehlt")));
    if (st.webhook?.lastError) rows.push(h("div", { class: "muted small", style: "padding:0 18px" }, `Letzter Fehler bei Telegram: ${st.webhook.lastError}`));
    const hook = h("button", { class: `btn ${st.webhook?.active ? "" : "primary"}` }, h("span", {}, st.webhook?.active ? "Webhook erneuern" : "Webhook einrichten"));
    hook.disabled = !st.httpsReady;
    hook.onclick = busy(hook, async () => { await api("/api/telegram/setup", { method: "POST" }); toast("Telegram-Webhook eingerichtet.", "ok"); });
    const test = h("button", { class: "btn" }, icon("bell"), h("span", {}, "Test senden"));
    test.disabled = !st.chatIdSet;
    test.onclick = busy(test, async () => { await api("/api/telegram/test", { method: "POST" }); toast("Testnachricht gesendet.", "ok"); });
    const i = h("input", { type: "checkbox", checked: st.settings?.notifications ?? true });
    i.addEventListener("change", async () => { try { await api("/api/telegram/settings", { method: "PUT", body: { notifications: i.checked } }); toast("Gespeichert.", "ok"); } catch (e) { fail(e); } });
    rows.push(h("div", { class: "card-body", style: "padding:12px 18px;display:flex;gap:8px;flex-wrap:wrap" }, hook, test,
      st.httpsReady ? null : h("span", { class: "muted small" }, "Webhook braucht eine https-Adresse (JARVIS_PUBLIC_URL).")));
    rows.push(h("label", { class: "toggle-row" }, h("div", { class: "main" }, h("div", { class: "title" }, "Benachrichtigungen auch per Telegram"),
      h("div", { class: "sub" }, `Briefings, Erinnerungen, Vorschläge und Bestätigungen. Sprachnachrichten: ${st.transcription ? "aktiv" : "aus (TRANSCRIBE_API_KEY fehlt)"}.`)),
      h("label", { class: "switch" }, i, h("span"))));
    set(card, rows);
  };
  render().catch((e) => set(card, h("div", { class: "card-body" }, h("div", { class: "empty" }, e.message))));
  return card;
}
