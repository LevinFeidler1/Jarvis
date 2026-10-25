// Login, navigation shell, router, polling, notifications drawer, boot.

import { api, state } from "./api.js";
import { $, fmt, h, icon, logoMark, set } from "./dom.js";
import { push } from "./push.js";
import { applyTheme, fail, getTheme, toast } from "./ui.js";
import { voice } from "./voice.js";

// ─── Login ──────────────────────────────────────────────────────────────────
export function renderLogin() {
  const err = h("div", { class: "error-text", role: "alert" });
  const input = h("input", { class: "field", type: "password", id: "token", autocomplete: "current-password", required: true, placeholder: "Zugangstoken" });
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      try {
        const r = await api("/api/login", { method: "POST", body: { token: input.value } });
        state.csrf = r.csrfToken;
        boot();
      } catch (ex) { err.textContent = ex.message; }
    },
  }, h("label", { for: "token" }, "Zugangstoken"), input, h("button", { class: "btn primary", type: "submit" }, "Anmelden"), err);
  set($("#root"), h("section", { class: "login" },
    h("div", { class: "login-card" }, logoMark("xl"), h("h1", {}, "JARVIS"), h("div", { class: "muted" }, "Dein persönlicher digitaler Butler"), form)));
  input.focus();
}

// ─── Shell ──────────────────────────────────────────────────────────────────
/** [id, label, icon, group] — groups structure the sidebar and the "Mehr" sheet. */
const NAV = [
  ["jarvis", "JARVIS", "spark", "main"],
  ["calendar", "Kalender", "calendar", "main"],
  ["chat", "Chat", "chat", "main"],
  ["email", "E-Mail", "mail", "life"],
  ["tasks", "Aufgaben", "tasks", "life"],
  ["notes", "Notizen & Listen", "list", "life"],
  ["finance", "Finanzen", "euro", "life"],
  ["contacts", "Kontakte", "users", "life"],
  ["files", "Dateien", "folder", "life"],
  ["automations", "Automationen", "bolt", "jarvis"],
  ["activity", "Aktivität", "activity", "jarvis"],
  ["review", "Rückblick", "chart", "jarvis"],
  ["memory", "Gedächtnis", "memory", "jarvis"],
  ["settings", "Einstellungen", "settings", "jarvis"],
];
const NAV_GROUPS = { life: "Alltag", jarvis: "JARVIS" };
const MOBILE_NAV = ["jarvis", "calendar"];
export const isMobile = () => matchMedia("(max-width: 860px)").matches;

function renderShell() {
  const navBtn = (id, label, ic) =>
    h("button", { class: "nav-item", "data-view": id, onclick: () => go(id) }, icon(ic), h("span", {}, label), id === "activity" ? h("span", { class: "count hidden", "data-count": "pending" }) : null);
  const sidebar = h("nav", { class: "sidebar", "aria-label": "Navigation" },
    h("div", { class: "brand" }, logoMark(), h("span", {}, "JARVIS")),
    NAV.filter((n) => n[3] === "main").map((n) => navBtn(...n)),
    Object.entries(NAV_GROUPS).map(([g, title]) => [h("div", { class: "nav-group" }, title), NAV.filter((n) => n[3] === g).map((n) => navBtn(...n))]),
    h("div", { class: "sidebar-foot" },
      h("button", { class: "nav-item", onclick: openNotifications }, icon("bell"), h("span", {}, "Benachrichtigungen"), h("span", { class: "count hidden", "data-count": "notif" })),
      h("button", { class: "nav-item", onclick: cycleTheme }, icon("moon"), h("span", {}, "Design")),
      h("button", { class: "nav-item", onclick: logout }, icon("logout"), h("span", {}, "Abmelden")),
      h("div", { class: "status-line", id: "status-line" })));
  const mobile = h("nav", { class: "mobile-bar", "aria-label": "Navigation" },
    MOBILE_NAV.map((id) => {
      const [, label, ic] = NAV.find((n) => n[0] === id);
      return h("button", { "data-view": id, onclick: () => go(id) }, id === "jarvis" ? logoMark("tab") : icon(ic), h("span", {}, label), id === "jarvis" ? h("span", { class: "count hidden", "data-count": "pending" }) : null);
    }),
    h("button", { id: "more-btn", onclick: openMoreSheet, "aria-haspopup": "dialog" }, icon("grid"), h("span", {}, "Mehr"), h("span", { class: "count hidden", "data-count": "notif" })));
  set($("#root"), h("div", { class: "shell" }, sidebar, h("main", { id: "main" }), mobile));
}

function setCounts() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const n = state.counts[el.dataset.count] ?? 0;
    el.textContent = n;
    el.classList.toggle("hidden", !n);
  });
}

/** Never two refreshes at once: callers share the running one. Resolves true on success. */
let countsInFlight = null;
export function refreshCounts() {
  countsInFlight ??= loadCounts().finally(() => { countsInFlight = null; });
  return countsInFlight;
}

async function loadCounts() {
  try {
    const [pending, notifs] = await Promise.all([api("/api/confirmations", { timeoutMs: 20_000 }), api("/api/notifications", { timeoutMs: 20_000 })]);
    const unread = notifs.filter((n) => !n.read);
    if (unread.length > state.counts.notif && state.counts.notif !== undefined && state.bootedCounts) {
      unread.slice(0, unread.length - state.counts.notif).forEach((n) => toast(`${n.title}: ${n.body ?? ""}`));
    }
    state.bootedCounts = true;
    state.counts = { pending: pending.length, notif: unread.length };
    setCounts();
    return true;
  } catch {
    return false; // offline / timeout — the poller backs off
  }
}

/**
 * Background polling: the next poll starts only after the previous one finished
 * (or timed out), backs off on errors (30 s → 1 → 2 → 4 → max. 5 min) and pauses
 * while the tab is hidden.
 */
const POLL_MS = 30_000;
const poller = {
  timer: null,
  failures: 0,
  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delay);
  },
  async run() {
    if (document.hidden) return; // resumed by visibilitychange
    if (!state.csrf) return this.schedule(POLL_MS);
    const ok = await refreshCounts();
    this.failures = ok ? 0 : Math.min(this.failures + 1, 4);
    this.schedule(this.failures ? Math.min(5 * 60_000, POLL_MS * 2 ** this.failures) : POLL_MS);
  },
  start() {
    if (this.started) return;
    this.started = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearTimeout(this.timer);
      else this.schedule(400); // fresh numbers right after returning to the tab
    });
    this.run();
  },
};

function cycleTheme() {
  const next = { system: "dark", dark: "light", light: "system" }[getTheme()];
  applyTheme(next);
  toast(`Design: ${{ system: "System", dark: "Dunkel", light: "Hell" }[next]}`);
}

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  state.csrf = null;
  renderLogin();
}

/** Mobile: everything that does not fit into the bottom bar. */
function openMoreSheet() {
  const close = () => wrap.remove();
  const item = (ic, label, onclick, extra = null, active = false) =>
    h("button", { class: `sheet-item ${active ? "active" : ""}`, onclick: () => { close(); onclick(); } }, h("span", { class: "sheet-ic" }, icon(ic)), h("span", {}, label), extra);
  const views = NAV.filter(([id]) => !MOBILE_NAV.includes(id));
  const themeLabel = { system: "System", dark: "Dunkel", light: "Hell" }[getTheme()];
  const tile = ([id, label, ic]) => item(ic, label, () => go(id), id === "activity" && state.counts.pending ? h("span", { class: "count" }, state.counts.pending) : null, state.view === id);
  const wrap = h("div", { class: "modal-wrap sheet-wrap", onclick: (e) => e.target === wrap && close() },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Mehr" },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-grid" }, views.filter((n) => n[3] === "main" || n[3] === "life").map(tile)),
      h("div", { class: "sheet-sub" }, "JARVIS"),
      h("div", { class: "sheet-grid" }, views.filter((n) => n[3] === "jarvis").map(tile)),
      h("div", { class: "sheet-list" },
        item("bell", "Benachrichtigungen", openNotifications, state.counts.notif ? h("span", { class: "count" }, state.counts.notif) : null),
        item(getTheme() === "light" ? "sun" : "moon", `Design: ${themeLabel}`, cycleTheme),
        item("logout", "Abmelden", logout))));
  wrap.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(wrap);
  wrap.querySelector("button")?.focus();
}

export function go(view, params = "") {
  location.hash = `${view}${params}`;
}

let unmountView = null;
/** View name → render function; filled once by the entry module (registerViews). */
let VIEWS = {};
export function registerViews(views) {
  VIEWS = views;
}
export async function route() {
  if (voice.listening) voice.stopListening();
  if (voice.speaking) voice.stopSpeaking();
  try { unmountView?.(); } catch { /* ignore */ }
  unmountView = null;
  const [raw, query = ""] = location.hash.replace(/^#/, "").split("?");
  // Old links (notifications, bookmarks) to the former "Heute" page land on the home screen.
  const view = { today: "jarvis" }[raw] ?? raw;
  state.view = VIEWS[view] ? view : "jarvis";
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  $("#more-btn")?.classList.toggle("active", !MOBILE_NAV.includes(state.view));
  const main = $("#main");
  if (!main) return;
  main.scrollTop = 0;
  try {
    // A view may return a cleanup function (the voice home stops its animation loop).
    const cleanup = await VIEWS[state.view](main, new URLSearchParams(query));
    if (typeof cleanup === "function") unmountView = cleanup;
  } catch (err) {
    set(main, h("div", { class: "view" }, h("div", { class: "empty" }, err.message)));
  }
}

export function viewHead(title, sub, ...actions) {
  return h("div", { class: "view-head" }, h("div", {}, h("h1", {}, title), sub ? h("div", { class: "sub" }, sub) : null), h("div", { class: "head-actions" }, actions));
}

export function cardHead(title, ic, ...actions) {
  return h("div", { class: "card-head" }, h("h3", {}, ic ? icon(ic) : null, title), h("div", { class: "head-actions" }, actions));
}

export const notConfigured = (msg) =>
  h("div", { class: "empty" }, h("div", {}, msg), h("button", { class: "btn sm", onclick: () => go("settings") }, icon("plug"), "Integration verbinden"));

// ─── Notifications drawer ───────────────────────────────────────────────────
async function openNotifications() {
  const list = await api("/api/notifications").catch((e) => (fail(e), []));
  const close = () => { scrim.remove(); drawer.remove(); refreshCounts(); };
  const scrim = h("div", { class: "scrim", onclick: close });
  const drawer = h("aside", { class: "drawer" },
    h("div", { class: "drawer-head" }, h("h3", {}, "Benachrichtigungen"),
      h("div", { class: "head-actions" },
        list.some((n) => !n.read) ? h("button", { class: "btn ghost sm", onclick: async () => { await api("/api/notifications/read-all", { method: "POST" }).catch(fail); close(); } }, "Alle gelesen") : null,
        h("button", { class: "btn ghost icon", onclick: close, "aria-label": "Schließen" }, icon("x")))),
    h("div", { class: "drawer-body" }, list.length ? list.map((n) =>
      h("div", { class: `notif-item ${n.read ? "" : "unread"}` }, icon("bell"),
        h("div", { class: "main" }, h("div", { class: "title" }, n.title), h("div", { class: "sub" }, n.body ?? ""), h("div", { class: "muted small" }, fmt.rel(n.createdAt))),
        n.read ? null : h("button", { class: "btn ghost icon sm", "aria-label": "Gelesen", onclick: async (e) => { await api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(fail); e.currentTarget.closest(".notif-item").classList.remove("unread"); e.currentTarget.remove(); } }, icon("check"))))
      : h("div", { class: "empty" }, "Keine Benachrichtigungen.")));
  document.body.append(scrim, drawer);
}

// ─── Boot ───────────────────────────────────────────────────────────────────
let routerBound = false;
export async function boot() {
  const s = await api("/api/session").catch(() => ({ authenticated: false }));
  if (!s.authenticated) return renderLogin();
  state.csrf = s.csrfToken;
  state.userName = s.userName;
  renderShell();
  api("/api/status").then((st) => {
    state.status = st;
    const line = $("#status-line");
    if (line) set(line, h("span", { class: `dot ${st.llmConfigured ? "ok" : "warn"}` }), st.llmConfigured ? `Online · ${st.hosting}` : "Sprachmodell fehlt");
  }).catch(() => {});
  if (!routerBound) { window.addEventListener("hashchange", route); routerBound = true; }
  push.register();
  await route();
  poller.start();
}
