// JARVIS Web-UI — no framework, no build step.
// Security: all data from the server/providers is rendered via textContent or
// DOM nodes (never innerHTML). Only the static icon markup below uses innerHTML.

// ─── Utilities ──────────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = !!v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  append(node, children);
  return node;
}
/** replaceChildren that skips null/false (the DOM would print "null"). */
function set(node, ...children) {
  node.replaceChildren();
  return append(node, children);
}
function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  tasks: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  memory: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  bell2: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>',
  new: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
function icon(name, cls = "") {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.dot}</svg>`;
  return span.firstChild;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmt = {
  time: (d) => new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
  day: (d) => new Date(d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
  long: (d) => new Date(d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }),
  dt: (d) => new Date(d).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
  rel(d) {
    const date = new Date(d);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return "gerade eben";
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (isToday(date)) return fmt.time(date);
    if (diff < 6 * 86400) return date.toLocaleDateString("de-DE", { weekday: "short" }) + " " + fmt.time(date);
    return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  },
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isToday = (d) => ymd(new Date(d)) === ymd(new Date());

const AVATAR_COLORS = ["#0e7490", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#2563eb", "#9333ea", "#0891b2"];
function avatar(name) {
  const clean = (name || "?").replace(/["<>]/g, "").trim();
  const initials = clean.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  let hash = 0;
  for (const c of clean) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return h("div", { class: "avatar", style: `background:${AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]}` }, initials);
}

// ─── Minimal, safe Markdown → DOM ───────────────────────────────────────────
function inline(text) {
  const frag = document.createDocumentFragment();
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<![*\w])\*([^*\n]+)\*(?!\w)|_([^_\n]+)_)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[2]) frag.append(h("strong", {}, m[2]));
    else if (m[3]) frag.append(h("code", {}, m[3]));
    else if (m[4]) frag.append(h("a", { href: m[5], target: "_blank", rel: "noopener noreferrer" }, m[4]));
    else if (m[6]) frag.append(h("em", {}, m[6]));
    else if (m[7]) frag.append(h("em", {}, m[7]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}
function markdown(src) {
  const root = h("div", { class: "md" });
  const lines = String(src ?? "").replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      root.append(h("pre", {}, h("code", {}, buf.join("\n"))));
      continue;
    }
    const head = line.match(/^(#{1,4})\s+(.*)$/);
    if (head) { root.append(h(head[1].length <= 2 ? "h3" : "h4", {}, inline(head[2]))); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const list = h(ordered ? "ol" : "ul");
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/).test(lines[i])) {
        list.append(h("li", {}, inline(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/, ""))));
        i++;
      }
      root.append(list);
      continue;
    }
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      root.append(h("blockquote", {}, inline(buf.join("\n"))));
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|>)/.test(lines[i])) buf.push(lines[i++]);
    const p = h("p");
    buf.forEach((l, idx) => { if (idx) p.append(h("br")); p.append(inline(l)); });
    root.append(p);
  }
  return root;
}

// ─── API ────────────────────────────────────────────────────────────────────
const state = {
  csrf: null,
  userName: null,
  status: null,
  view: "today",
  conversationId: null,
  renderedPending: new Set(),
  busy: false,
  weekOffset: 0,
  mailUnread: false,
  mailSelected: null,
  activityFilter: "all",
  counts: { pending: 0, notif: 0 },
};

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-jarvis-csrf"] = state.csrf ?? "";
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  if (res.status === 401 && path !== "/api/login") {
    renderLogin();
    throw new Error("Bitte erneut anmelden.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Fehler (HTTP ${res.status})`), { status: res.status, data });
  return data;
}

/** POST that streams NDJSON agent events. */
async function apiStream(path, body, onEvent) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-jarvis-csrf": state.csrf ?? "" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401) { renderLogin(); throw new Error("Bitte erneut anmelden."); }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Fehler (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let reply = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "reply") reply = ev.reply;
      else if (ev.type === "error") throw new Error(ev.error);
      else onEvent(ev);
    }
  }
  if (!reply) throw new Error("Die Verbindung wurde unterbrochen.");
  return reply;
}

// ─── Toasts & dialogs ───────────────────────────────────────────────────────
function toast(message, kind = "info") {
  let box = $(".toasts");
  if (!box) document.body.append((box = h("div", { class: "toasts", role: "status" })));
  const t = h("div", { class: `toast ${kind}` }, icon(kind === "err" ? "alert" : kind === "ok" ? "check" : "bolt"), h("span", {}, message));
  box.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 6000 : 3500);
}
const fail = (err) => toast(err?.message ?? String(err), "err");

function dialog({ title, text, input, confirmLabel = "OK", danger = false }) {
  return new Promise((resolve) => {
    const field = input !== undefined ? h("textarea", { class: "field", rows: 3, style: "height:auto;padding:10px 12px" }, input) : null;
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
        h("h3", {}, title),
        text ? h("p", {}, text) : null,
        field,
        h("div", { class: "foot" },
          h("button", { class: "btn ghost", onclick: () => close(null) }, "Abbrechen"),
          h("button", { class: `btn ${danger ? "danger" : "primary"}`, onclick: () => close(field ? field.value : true) }, confirmLabel))));
    wrap.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
    document.body.append(wrap);
    (field ?? wrap.querySelector(".btn.primary, .btn.danger")).focus();
  });
}

// ─── Theme ──────────────────────────────────────────────────────────────────
function getTheme() { try { return localStorage.getItem("jarvis-theme") || "system"; } catch { return "system"; } }
function applyTheme(t) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("jarvis-theme", t); } catch { /* ignore */ }
}
applyTheme(getTheme());

// ─── Login ──────────────────────────────────────────────────────────────────
function renderLogin() {
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
    h("div", { class: "login-card" }, h("div", { class: "orb xl" }), h("h1", {}, "JARVIS"), h("div", { class: "muted" }, "Dein persönlicher digitaler Butler"), form)));
  input.focus();
}

// ─── Shell ──────────────────────────────────────────────────────────────────
const NAV = [
  ["today", "Heute", "home"],
  ["chat", "Chat", "chat"],
  ["activity", "Aktivität", "activity"],
  ["calendar", "Kalender", "calendar"],
  ["email", "E-Mail", "mail"],
  ["tasks", "Aufgaben", "tasks"],
  ["memory", "Gedächtnis", "memory"],
  ["settings", "Einstellungen", "settings"],
];
const MOBILE_NAV = ["today", "chat", "calendar", "tasks", "settings"];

function renderShell() {
  const navBtn = (id, label, ic) =>
    h("button", { class: "nav-item", "data-view": id, onclick: () => go(id) }, icon(ic), h("span", {}, label), id === "activity" ? h("span", { class: "count hidden", "data-count": "pending" }) : null);
  const sidebar = h("nav", { class: "sidebar", "aria-label": "Navigation" },
    h("div", { class: "brand" }, h("div", { class: "orb" }), "JARVIS"),
    NAV.slice(0, 2).map((n) => navBtn(...n)),
    h("div", { class: "nav-sep" }),
    NAV.slice(2).map((n) => navBtn(...n)),
    h("div", { class: "sidebar-foot" },
      h("button", { class: "nav-item", onclick: openNotifications }, icon("bell"), h("span", {}, "Benachrichtigungen"), h("span", { class: "count hidden", "data-count": "notif" })),
      h("button", { class: "nav-item", onclick: cycleTheme }, icon("moon"), h("span", {}, "Design")),
      h("button", { class: "nav-item", onclick: logout }, icon("logout"), h("span", {}, "Abmelden")),
      h("div", { class: "status-line", id: "status-line" })));
  const mobile = h("nav", { class: "mobile-bar", "aria-label": "Navigation" },
    MOBILE_NAV.map((id) => {
      const [, label, ic] = NAV.find((n) => n[0] === id);
      return h("button", { "data-view": id, onclick: () => go(id) }, icon(ic), label, id === "today" ? h("span", { class: "count hidden", "data-count": "pending" }) : null);
    }));
  set($("#root"), h("div", { class: "shell" }, sidebar, h("main", { id: "main" }), mobile));
}

function setCounts() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const n = state.counts[el.dataset.count] ?? 0;
    el.textContent = n;
    el.classList.toggle("hidden", !n);
  });
}

async function refreshCounts() {
  try {
    const [pending, notifs] = await Promise.all([api("/api/confirmations"), api("/api/notifications")]);
    const unread = notifs.filter((n) => !n.read);
    if (unread.length > state.counts.notif && state.counts.notif !== undefined && state.bootedCounts) {
      unread.slice(0, unread.length - state.counts.notif).forEach((n) => toast(`${n.title}: ${n.body ?? ""}`));
    }
    state.bootedCounts = true;
    state.counts = { pending: pending.length, notif: unread.length };
    setCounts();
  } catch { /* offline */ }
}

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

function go(view, params = "") {
  location.hash = `${view}${params}`;
}

async function route() {
  const [view, query = ""] = location.hash.replace(/^#/, "").split("?");
  state.view = VIEWS[view] ? view : "today";
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  const main = $("#main");
  if (!main) return;
  main.scrollTop = 0;
  try {
    await VIEWS[state.view](main, new URLSearchParams(query));
  } catch (err) {
    set(main, h("div", { class: "view" }, h("div", { class: "empty" }, err.message)));
  }
}

function viewHead(title, sub, ...actions) {
  return h("div", { class: "view-head" }, h("div", {}, h("h1", {}, title), sub ? h("div", { class: "sub" }, sub) : null), h("div", { class: "head-actions" }, actions));
}

function cardHead(title, ic, ...actions) {
  return h("div", { class: "card-head" }, h("h3", {}, ic ? icon(ic) : null, title), h("div", { class: "head-actions" }, actions));
}

const notConfigured = (msg) =>
  h("div", { class: "empty" }, h("div", {}, msg), h("button", { class: "btn sm", onclick: () => go("settings") }, icon("plug"), "Integration verbinden"));

// ─── View: Heute ────────────────────────────────────────────────────────────
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Gute Nacht" : hr < 11 ? "Guten Morgen" : hr < 17 ? "Guten Tag" : hr < 22 ? "Guten Abend" : "Gute Nacht";
}

async function viewToday(main) {
  set(main, h("div", { class: "view" }, h("div", { class: "card hero" }, h("div", { class: "orb xl busy" }), h("div", {}, h("h1", {}, `${greeting()}.`), h("p", {}, "Einen Moment, ich sehe mir deinen Tag an …")))));
  const [b, setup] = await Promise.all([api("/api/briefing"), api("/api/setup")]);
  const now = Date.now();

  const events = b.events.ok ? b.events.data : [];
  const emails = b.emails.ok ? b.emails.data : [];
  const tasks = b.tasks.ok ? b.tasks.data : [];
  const today = ymd(new Date());
  const dueTasks = tasks.filter((t) => t.due && t.due.slice(0, 10) <= today);
  const pending = b.pending.ok ? b.pending.data : [];
  const upcoming = events.filter((e) => e.allDay || new Date(e.end).getTime() > now);
  const next = upcoming.find((e) => !e.allDay);

  const summary = [];
  if (b.events.ok) summary.push(events.length ? `${events.length} ${events.length === 1 ? "Termin" : "Termine"} heute` : "keine Termine heute");
  if (b.emails.ok) summary.push(`${emails.length} ungelesene E-Mail${emails.length === 1 ? "" : "s"}`);
  summary.push(`${tasks.length} offene Aufgabe${tasks.length === 1 ? "" : "n"}`);
  const name = state.userName ? `, ${state.userName}` : "";

  const stat = (n, l, ic, cls, view) => h("div", { class: "card stat", onclick: () => go(view) }, h("div", { class: `ic ${cls}` }, icon(ic)), h("div", {}, h("div", { class: "n" }, n), h("div", { class: "l" }, l)));

  const agenda = !b.events.ok
    ? notConfigured(b.events.code === "NOT_CONFIGURED" ? "Kalender ist noch nicht verbunden." : b.events.error)
    : events.length === 0
      ? h("div", { class: "empty" }, "Heute ist dein Kalender frei.")
      : h("div", { class: "agenda" }, events.map((e) => {
          const past = !e.allDay && new Date(e.end).getTime() < now;
          const isNow = !e.allDay && new Date(e.start).getTime() <= now && !past;
          return h("div", { class: `agenda-item ${past ? "past" : ""} ${isNow ? "now" : ""}` },
            h("div", { class: "t" }, e.allDay ? "ganztags" : fmt.time(e.start), e.allDay ? null : h("small", {}, fmt.time(e.end))),
            h("div", { class: "bar" }),
            h("div", {}, h("div", { class: "what" }, e.title), h("div", { class: "where" }, [e.location, e.attendees?.length ? `${e.attendees.length} Teilnehmer` : null].filter(Boolean).join(" · "))));
        }));

  const mailList = !b.emails.ok
    ? notConfigured(b.emails.code === "NOT_CONFIGURED" ? "E-Mail ist noch nicht verbunden." : b.emails.error)
    : emails.length === 0
      ? h("div", { class: "empty" }, "Posteingang ist gelesen. Sehr ordentlich.")
      : h("div", {}, emails.slice(0, 6).map((m) =>
          h("div", { class: "row clickable", onclick: () => { state.mailSelected = m.id; go("email"); } },
            avatar(m.from.name ?? m.from.email),
            h("div", { class: "main" }, h("div", { class: "title" }, m.from.name ?? m.from.email), h("div", { class: "sub" }, m.subject)),
            h("span", { class: "muted small" }, fmt.rel(m.date)))));

  const taskList = tasks.length === 0
    ? h("div", { class: "empty" }, "Keine offenen Aufgaben.")
    : h("div", {}, tasks.slice(0, 6).map((t) =>
        h("div", { class: "row" },
          h("button", { class: "check", title: "Erledigt", onclick: async (e) => { e.currentTarget.classList.add("done"); await api(`/api/tasks/${t.id}/complete`, { method: "POST" }).catch(fail); viewToday(main); } }, icon("check")),
          h("div", { class: "main" }, h("div", { class: "title" }, t.title), t.due ? h("div", { class: "sub" }, `fällig ${new Date(t.due).toLocaleDateString("de-DE")}`) : null),
          h("span", { class: `prio ${t.priority}` }))));

  const setupDone = setup.steps.filter((s) => s.done).length;

  set(main, h("div", { class: "view" },
    h("div", { class: "card hero" },
      h("div", { class: "orb xl" }),
      h("div", { class: "grow" },
        h("h1", {}, `${greeting()}${name}.`),
        h("p", {}, `${fmt.long(new Date())} — ${summary.join(", ")}.`),
        next ? h("p", { class: "small muted" }, `Als Nächstes: ${next.title} um ${fmt.time(next.start)}`) : null),
      h("button", { class: "btn primary", onclick: () => startChat("Guten Morgen, JARVIS. Bereite mir meinen Tag vor.") }, icon("bolt"), "Briefing starten")),
    !setup.complete
      ? h("div", { class: "banner info", style: "max-width:none" }, icon("plug"),
          h("div", { style: "flex:1" }, h("b", {}, `Einrichtung: ${setupDone} von ${setup.steps.length} Schritten erledigt. `), h("span", { class: "muted" }, setup.steps.find((s) => !s.done)?.title ?? "")),
          h("button", { class: "btn sm", onclick: () => go("settings") }, "Fortsetzen"))
      : null,
    h("div", { class: "stat-row" },
      stat(b.events.ok ? upcoming.length : "–", "Termine noch heute", "calendar", "", "calendar"),
      stat(b.emails.ok ? emails.length : "–", "Ungelesene E-Mails", "mail", "", "email"),
      stat(dueTasks.length, "Heute fällige Aufgaben", "tasks", "ok", "tasks"),
      stat(pending.length, "Warten auf dich", "shield", pending.length ? "warn" : "", "activity")),
    pending.length
      ? h("div", { class: "card", style: "margin-bottom:16px" }, cardHead("Wartet auf deine Bestätigung", "shield"),
          h("div", { class: "card-body" }, pending.map((p) => confirmCard(p, () => viewToday(main)))))
      : null,
    h("div", { class: "grid" },
      h("div", { class: "card col-7" }, cardHead("Heute", "calendar", h("button", { class: "btn ghost sm", onclick: () => go("calendar") }, "Woche")), h("div", { class: "card-body" }, agenda)),
      h("div", { class: "card col-5" }, cardHead("Aufgaben", "tasks", h("button", { class: "btn ghost sm", onclick: () => go("tasks") }, "Alle")), h("div", { class: "card-body" }, taskList)),
      h("div", { class: "card col-12" }, cardHead("Ungelesen", "inbox",
        b.emails.ok && emails.length ? h("button", { class: "btn sm", onclick: () => startChat("Was muss ich heute beantworten? Priorisiere kurz.") }, icon("bolt"), "Was ist wichtig?") : null,
        h("button", { class: "btn ghost sm", onclick: () => go("email") }, "Posteingang")), h("div", { class: "card-body" }, mailList)))));
}

// ─── View: Chat ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  ["sun", "Guten Morgen, JARVIS.", "Tagesbriefing mit Terminen, Mails und Aufgaben"],
  ["inbox", "Was muss ich heute beantworten?", "Priorisierte Übersicht deines Posteingangs"],
  ["calendar", "Wann habe ich nächste Woche 60 Minuten frei?", "Freie Zeitfenster finden"],
  ["tasks", "Was habe ich diese Woche noch offen?", "Aufgaben und Deadlines"],
];

let pendingPrefill = null;
function startChat(text, { send = true, newConversation = true } = {}) {
  if (newConversation) state.conversationId = null;
  pendingPrefill = { text, send };
  if (state.view === "chat") route(); else go("chat");
}

async function viewChat(main) {
  const thread = h("div", { class: "thread", id: "thread" });
  const scroll = h("div", { class: "chat-scroll", id: "chat-scroll" }, thread);
  const input = h("textarea", { id: "chat-input", rows: 1, placeholder: "Frag JARVIS oder gib einen Auftrag …", maxlength: 8000, "aria-label": "Nachricht" });
  const sendBtn = h("button", { class: "btn primary icon", type: "submit", title: "Senden", "aria-label": "Senden" }, icon("send"));
  const form = h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); const t = input.value; input.value = ""; autosize(); sendMessage(t); } }, input, sendBtn);
  const autosize = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 220)}px`; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });

  const title = h("div", { class: "title" }, "Neue Unterhaltung");
  const top = h("div", { class: "chat-top" },
    h("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, h("div", { class: "orb" }), title),
    h("div", { class: "head-actions" },
      h("button", { class: "btn ghost sm", onclick: openHistory }, icon("history"), h("span", {}, "Verlauf")),
      h("button", { class: "btn sm", onclick: () => { state.conversationId = null; route(); } }, icon("plus"), h("span", {}, "Neu"))));

  const secBanner = h("div", { class: "banner warn hidden", id: "sec-banner" }, icon("shield"),
    h("div", {}, h("b", {}, "Sicherheitshinweis: "), "In dieser Unterhaltung wurde ein möglicher Manipulationsversuch (Prompt Injection) erkannt. Externe Aktionen erfordern erhöhte Bestätigung."));

  set(main, h("div", { class: "view chat" }, top, scroll,
    h("div", { class: "composer-wrap" }, secBanner, form, h("div", { class: "composer-hint" }, "Enter zum Senden · Shift+Enter für neue Zeile · Externe Aktionen immer erst nach deiner Bestätigung"))));

  state.renderedPending = new Set();
  if (state.conversationId) {
    const data = await api(`/api/conversations/${state.conversationId}/messages`);
    title.textContent = data.conversation.title ?? "Unterhaltung";
    secBanner.classList.toggle("hidden", !data.conversation.tainted);
    for (const m of data.messages) {
      if (m.role === "user") addUser(m.text, m.createdAt);
      else addAssistant().finish(m.text, [], m.createdAt);
    }
    renderPendingCards(data.pendingActions);
  } else {
    thread.append(h("div", { class: "welcome" },
      h("div", { class: "orb xl" }),
      h("h2", {}, `${greeting()}${state.userName ? `, ${state.userName}` : ""}.`),
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

function addUser(text, at) {
  $(".welcome")?.remove();
  $("#thread").append(h("div", { class: "msg user" }, h("div", {}, h("div", { class: "bubble" }, text), at ? h("div", { class: "msg-time", style: "text-align:right" }, fmt.rel(at)) : null)));
  scrollDown();
}

const STEP_ICON = { succeeded: "check", failed: "x", denied: "x", awaiting_confirmation: "shield", rejected: "x", expired: "clock", partially_succeeded: "alert" };

/** An assistant turn: live steps while working, then the answer. */
function addAssistant() {
  const steps = h("div", { class: "steps" });
  const typing = h("div", { class: "typing" }, h("i"), h("i"), h("i"));
  const content = h("div", { class: "content" }, steps, typing);
  const orb = h("div", { class: "orb busy" });
  const node = h("div", { class: "msg assistant" }, orb, content);
  $("#thread").append(node);
  scrollDown();
  const map = new Map();
  return {
    content,
    step(a) {
      let el = map.get(a.activityId);
      const label = a.description.split("\n")[0];
      const ic = a.status === "executing" || a.status === "planned" ? h("div", { class: "spinner" }) : icon(STEP_ICON[a.status] ?? "check");
      const next = h("div", { class: `step ${a.status}`, title: a.error ?? a.description }, ic, h("span", { class: "label" }, label), a.error ? h("span", { class: "muted" }, `— ${a.error}`) : null);
      if (el) el.replaceWith(next); else steps.append(next);
      map.set(a.activityId, next);
      scrollDown();
    },
    finish(text, actions = [], at) {
      orb.classList.remove("busy");
      typing.remove();
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

function handleReply(reply, turn) {
  const isNew = state.conversationId !== reply.conversationId;
  state.conversationId = reply.conversationId;
  turn.finish(reply.text, reply.actions, new Date().toISOString());
  renderPendingCards(reply.pendingActions);
  $("#sec-banner")?.classList.toggle("hidden", !reply.securityWarning);
  if (isNew) api(`/api/conversations/${reply.conversationId}/messages`).then((d) => { const t = $(".chat-top .title"); if (t) t.textContent = d.conversation.title ?? "Unterhaltung"; }).catch(() => {});
  refreshCounts();
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || state.busy) return;
  state.busy = true;
  addUser(text);
  const turn = addAssistant();
  try {
    const reply = await apiStream("/api/chat/stream", { conversationId: state.conversationId ?? undefined, message: text }, (ev) => ev.type === "action" && turn.step(ev.action));
    handleReply(reply, turn);
  } catch (err) {
    turn.error(err.message);
  } finally {
    state.busy = false;
    $("#chat-input")?.focus();
  }
}

function renderPendingCards(list) {
  const thread = $("#thread");
  if (!thread) return;
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

/** Confirmation card. inChat → the follow-up turn streams into the thread. */
function confirmCard(p, onDone, inChat = false) {
  const crit = p.risk >= 3;
  const { headline, body } = describePreview(p.description);
  const foot = h("div", { class: "confirm-foot" });
  const card = h("div", { class: `confirm ${crit ? "crit" : ""}` },
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
        const reply = await apiStream(`/api/confirmations/${p.id}`, { approve, stream: true }, (ev) => ev.type === "action" && turn.step(ev.action));
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
    }
  };
  foot.append(
    h("button", { class: `btn ${crit ? "danger" : "ok"}`, onclick: () => decide(true) }, icon("check"), crit ? "Trotzdem ausführen" : "Bestätigen & ausführen"),
    h("button", { class: "btn ghost", onclick: () => decide(false) }, "Ablehnen"),
    h("span", { class: "muted" }, `gültig bis ${fmt.time(p.expiresAt)}`));
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

// ─── View: Aktivität ────────────────────────────────────────────────────────
const STATUS = {
  planned: ["geplant", ""], executing: ["läuft", "accent"], succeeded: ["erfolgreich", "ok"], failed: ["fehlgeschlagen", "err"],
  partially_succeeded: ["teilweise", "warn"], awaiting_confirmation: ["wartet", "warn"], rejected: ["abgelehnt", ""],
  expired: ["abgelaufen", ""], denied: ["verweigert", "err"],
};
const RISK = [["Lesen", ""], ["Niedrig", "accent"], ["Extern", "warn"], ["Kritisch", "crit"]];

async function viewActivity(main) {
  const [pending, activity, audit] = await Promise.all([api("/api/confirmations"), api("/api/activity"), api("/api/audit")]);
  const filters = { all: "Alle", awaiting_confirmation: "Wartet", succeeded: "Erfolgreich", failed: "Fehler" };
  const shown = activity.filter((a) => state.activityFilter === "all" || a.status === state.activityFilter || (state.activityFilter === "failed" && a.status === "denied"));
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
        h("div", { class: "right" }, h("span", { class: `badge ${RISK[a.risk]?.[1] ?? ""}` }, RISK[a.risk]?.[0] ?? a.risk), h("span", { class: `badge ${cls}` }, label)));
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

// ─── View: Kalender ─────────────────────────────────────────────────────────
const HOUR_PX = 48;
function weekStart(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

async function viewCalendar(main) {
  const start = weekStart(state.weekOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const range = `${start.toLocaleDateString("de-DE", { day: "numeric", month: "long" })} – ${new Date(end - 1).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}`;
  const nav = [
    h("button", { class: "btn icon", onclick: () => { state.weekOffset--; viewCalendar(main); }, "aria-label": "Vorherige Woche" }, icon("left")),
    h("button", { class: "btn", onclick: () => { state.weekOffset = 0; viewCalendar(main); } }, "Heute"),
    h("button", { class: "btn icon", onclick: () => { state.weekOffset++; viewCalendar(main); }, "aria-label": "Nächste Woche" }, icon("right")),
    h("button", { class: "btn primary", onclick: () => startChat("Plane einen Termin für mich: ", { send: false }) }, icon("plus"), "Termin"),
  ];
  const head = viewHead("Kalender", range, ...nav);
  set(main, h("div", { class: "view" }, head, h("div", { class: "card", style: "padding:40px" }, h("div", { class: "spinner", style: "margin:auto" }))));

  let events;
  try {
    events = await api(`/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
  } catch (err) {
    set(main, h("div", { class: "view" }, head, err.status === 409 ? notConfigured("Der Kalender ist noch nicht verbunden.") : h("div", { class: "empty" }, err.message)));
    return;
  }

  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const headRow = h("div", { class: "cal-head" }, h("div"), days.map((d) =>
    h("div", { class: isToday(d) ? "today" : "" }, d.toLocaleDateString("de-DE", { weekday: "short" }), h("b", {}, d.getDate()))));
  const allday = h("div", { class: "cal-allday" }, h("div", {}, "ganzt."), days.map((d) =>
    h("div", {}, events.filter((e) => e.allDay && e.start.slice(0, 10) <= ymd(d) && e.end.slice(0, 10) > ymd(d)).map((e) => h("div", { class: "cal-chip", title: e.title }, e.title)))));
  const hours = h("div", { class: "cal-hours" }, [...Array(24)].map((_, i) => h("div", {}, i ? `${String(i).padStart(2, "0")}:00` : "")));
  const cols = days.map((d) => {
    const col = h("div", { class: `cal-day ${isToday(d) ? "today" : ""}`, style: `height:${24 * HOUR_PX}px` });
    const dayStart = new Date(d).getTime();
    const dayEnd = dayStart + 86400000;
    const evs = events.filter((e) => !e.allDay && new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    // Simple overlap layout: assign lanes.
    const lanes = [];
    const placed = evs.map((e) => {
      const s = Math.max(new Date(e.start).getTime(), dayStart);
      const en = Math.min(new Date(e.end).getTime(), dayEnd);
      let lane = lanes.findIndex((l) => l <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(en); } else lanes[lane] = en;
      return { e, s, en, lane };
    });
    const n = Math.max(1, lanes.length);
    for (const { e, s, en, lane } of placed) {
      const top = ((s - dayStart) / 3600000) * HOUR_PX;
      const height = Math.max(22, ((en - s) / 3600000) * HOUR_PX - 2);
      col.append(h("div", { class: `cal-ev ${e.busy ? "" : "free"}`, style: `top:${top}px;height:${height}px;left:calc(${(lane / n) * 100}% + 3px);width:calc(${100 / n}% - 6px);right:auto`, title: `${e.title}\n${fmt.time(e.start)}–${fmt.time(e.end)}${e.location ? `\n${e.location}` : ""}` },
        h("b", {}, e.title), height > 34 ? h("span", {}, `${fmt.time(e.start)}–${fmt.time(e.end)}`) : null));
    }
    if (isToday(d)) {
      const now = new Date();
      col.append(h("div", { class: "now-line", style: `top:${(now.getHours() + now.getMinutes() / 60) * HOUR_PX}px` }));
    }
    return col;
  });
  const body = h("div", { class: "cal-body" }, hours, cols);
  set(main, h("div", { class: "view" }, head, h("div", { class: "card cal" }, headRow, allday, body),
    h("div", { class: "muted small", style: "margin-top:10px" }, `${events.length} Termine · Zeitzone ${state.status?.timezone ?? TZ}`)));
  body.scrollTop = 7 * HOUR_PX;
}

// ─── View: E-Mail ───────────────────────────────────────────────────────────
async function viewEmail(main) {
  const head = viewHead("E-Mail", "Posteingang",
    h("button", { class: `chip ${state.mailUnread ? "active" : ""}`, onclick: () => { state.mailUnread = !state.mailUnread; viewEmail(main); } }, "Nur ungelesen"),
    h("button", { class: "btn", onclick: () => startChat("Sortiere mein Postfach: Was ist wichtig, was braucht eine Antwort, was ist Newsletter/Werbung? Schlag Aktionen vor.") }, icon("bolt"), "Mit JARVIS sortieren"),
    h("button", { class: "btn ghost icon", onclick: () => viewEmail(main), "aria-label": "Aktualisieren" }, icon("refresh")));
  set(main, h("div", { class: "view" }, head, h("div", { class: "card", style: "padding:40px" }, h("div", { class: "spinner", style: "margin:auto" }))));

  let mails, failures, accountsInfo;
  try {
    const qs = new URLSearchParams();
    if (state.mailUnread) qs.set("unread", "true");
    if (state.mailAccount) qs.set("account", state.mailAccount);
    const [res, acc] = await Promise.all([api(`/api/email?${qs}`), api("/api/email-accounts")]);
    mails = res.emails;
    failures = res.failures ?? [];
    accountsInfo = [...(acc.gmail ? [acc.gmail] : []), ...acc.accounts.map((a) => a.email)];
  } catch (err) {
    set(main, h("div", { class: "view" }, head, err.status === 409 ? notConfigured("E-Mail ist noch nicht verbunden.") : h("div", { class: "empty" }, err.message)));
    return;
  }

  const reader = h("div", { class: "card reader" });
  const wrap = h("div", { class: "mail" });
  const listScroll = h("div", { class: "scroll" });
  const select = async (m, itemEl) => {
    state.mailSelected = m.id;
    listScroll.querySelectorAll(".mail-item").forEach((x) => x.classList.toggle("active", x === itemEl));
    wrap.classList.add("reading");
    set(reader, h("div", { class: "spinner", style: "margin:40px auto" }));
    try {
      const full = await api(`/api/email/${encodeURIComponent(m.id)}`);
      const from = full.from.name ? `${full.from.name} <${full.from.email}>` : full.from.email;
      set(reader, 
        h("button", { class: "btn ghost sm", style: "margin-bottom:10px", onclick: () => wrap.classList.remove("reading") }, icon("back"), "Zurück"),
        h("h2", {}, full.subject),
        h("div", { class: "meta" }, avatar(full.from.name ?? full.from.email),
          h("div", { style: "flex:1;min-width:0" }, h("div", { style: "font-weight:600" }, from), h("div", { class: "muted small" }, `an ${full.to.map((t) => t.email).join(", ")} · ${fmt.dt(full.date)}`)),
          full.listUnsubscribe ? h("span", { class: "badge" }, "Newsletter") : null),
        h("div", { class: "actions" },
          h("button", { class: "btn primary sm", onclick: () => startChat(`Hilf mir, auf die E-Mail von ${from} mit dem Betreff „${full.subject}" (ID ${full.id}) zu antworten. Entwurf: `, { send: false }) }, icon("reply"), "Mit JARVIS antworten"),
          h("button", { class: "btn sm", onclick: () => startChat(`Fasse die E-Mail „${full.subject}" (ID ${full.id}) kurz zusammen: Anliegen, ob eine Antwort nötig ist und bis wann.`) }, icon("bolt"), "Zusammenfassen")),
        full.attachments?.length ? h("div", { class: "muted small", style: "margin-bottom:12px" }, `📎 ${full.attachments.map((a) => a.filename).join(", ")}`) : null,
        h("div", { class: "body" }, full.bodyText || full.snippet));
    } catch (err) {
      set(reader, h("div", { class: "empty" }, err.message));
    }
  };
  for (const m of mails) {
    const item = h("div", { class: `mail-item ${m.unread ? "unread" : ""}`, onclick: () => select(m, item) },
      avatar(m.from.name ?? m.from.email),
      h("div", { class: "main" },
        h("div", { class: "top" }, h("div", { class: "from" }, m.from.name ?? m.from.email), h("div", { class: "date" }, fmt.rel(m.date))),
        h("div", { class: "subj" }, m.subject), h("div", { class: "snip" }, m.snippet),
        m.account && accountsInfo.length > 1 ? h("div", { class: "acct" }, m.account) : null));
    listScroll.append(item);
    if (m.id === state.mailSelected) queueMicrotask(() => select(m, item));
  }
  if (!mails.length) listScroll.append(h("div", { class: "empty", style: "margin:12px" }, "Keine E-Mails."));
  const multi = accountsInfo.length > 1;
  const accountBar = multi
    ? h("div", { class: "filters", style: "margin-bottom:12px" },
        [["", "Alle Postfächer"], ...accountsInfo.map((a) => [a, a])].map(([v, l]) =>
          h("button", { class: `chip ${(state.mailAccount ?? "") === v ? "active" : ""}`, onclick: () => { state.mailAccount = v || null; viewEmail(main); } }, l)))
    : null;
  const failBanner = failures.length
    ? h("div", { class: "banner warn", style: "max-width:none" }, icon("alert"), h("div", {}, failures.map((f) => h("div", {}, `${f.account}: ${f.error}`))))
    : null;
  reader.append(h("div", { class: "empty", style: "margin-top:20vh;border:0" }, icon("mail"), h("div", {}, "Wähle eine E-Mail aus.")));
  wrap.append(h("div", { class: "card mail-list" }, listScroll), reader);
  set(main, h("div", { class: "view" }, head, failBanner, accountBar, wrap));
}

// ─── View: Aufgaben ─────────────────────────────────────────────────────────
async function viewTasks(main) {
  const [tasks, reminders] = await Promise.all([api("/api/tasks"), api("/api/reminders")]);
  const today = ymd(new Date());
  const open = tasks.filter((t) => t.status === "open");
  const groups = [
    ["Überfällig", open.filter((t) => t.due && t.due.slice(0, 10) < today)],
    ["Heute", open.filter((t) => t.due && t.due.slice(0, 10) === today)],
    ["Demnächst", open.filter((t) => t.due && t.due.slice(0, 10) > today)],
    ["Ohne Datum", open.filter((t) => !t.due)],
    ["Erledigt", tasks.filter((t) => t.status === "done").slice(0, 15)],
  ];

  const title = h("input", { class: "field title", placeholder: "Neue Aufgabe hinzufügen …", maxlength: 300, required: true, "aria-label": "Titel" });
  const due = h("input", { class: "field small", type: "date", "aria-label": "Fällig am" });
  const prio = h("select", { class: "field small", "aria-label": "Priorität" }, h("option", { value: "normal" }, "Normal"), h("option", { value: "high" }, "Hoch"), h("option", { value: "low" }, "Niedrig"));
  const form = h("form", { class: "card quick-add", onsubmit: async (e) => {
    e.preventDefault();
    try {
      await api("/api/tasks", { method: "POST", body: { title: title.value, due: due.value || undefined, priority: prio.value } });
      viewTasks(main).then(() => $(".quick-add .title")?.focus());
    } catch (err) { fail(err); }
  } }, icon("plus"), title, due, prio, h("button", { class: "btn primary", type: "submit" }, "Hinzufügen"));

  const taskRow = (t) => h("div", { class: `task ${t.status === "done" ? "done" : ""}` },
    h("button", { class: `check ${t.status === "done" ? "done" : ""}`, "aria-label": t.status === "done" ? "Wieder öffnen" : "Erledigt",
      onclick: async () => { await api(`/api/tasks/${t.id}/${t.status === "done" ? "reopen" : "complete"}`, { method: "POST" }).catch(fail); viewTasks(main); } }, icon("check")),
    h("span", { class: `prio ${t.priority}`, title: `Priorität: ${t.priority}` }),
    h("div", { class: "main" }, h("div", { class: "title" }, t.title),
      (t.due || t.project || t.notes) ? h("div", { class: "meta" },
        t.due ? h("span", { class: t.status === "open" && t.due.slice(0, 10) < today ? "over" : "" }, new Date(t.due).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })) : null,
        t.project ? h("span", {}, `# ${t.project}`) : null, t.notes ? h("span", {}, t.notes) : null) : null),
    h("button", { class: "btn ghost icon sm del", "aria-label": "Löschen", onclick: async () => { await api(`/api/tasks/${t.id}`, { method: "DELETE" }).catch(fail); viewTasks(main); } }, icon("trash")));

  set(main, h("div", { class: "view" },
    viewHead("Aufgaben", `${open.length} offen`, h("button", { class: "btn", onclick: () => startChat("Was sollte ich heute erledigen? Berücksichtige Termine und Deadlines.") }, icon("bolt"), "Was zuerst?")),
    form,
    open.length === 0 && !tasks.length ? h("div", { class: "empty" }, "Keine Aufgaben. Sag JARVIS einfach „Erinnere mich an …“ oder lege oben eine an.") : null,
    groups.filter(([, list]) => list.length).map(([name, list]) =>
      h("div", {}, h("div", { class: "section-title" }, name, h("span", { class: "badge" }, list.length)), h("div", { class: "card" }, list.map(taskRow)))),
    h("div", { class: "section-title" }, icon("bell2"), "Erinnerungen"),
    h("div", { class: "card" }, reminders.length ? reminders.map((r) =>
      h("div", { class: "task" }, icon("clock"),
        h("div", { class: "main" }, h("div", { class: "title" }, r.text), h("div", { class: "meta" }, fmt.dt(r.remindAt))),
        h("span", { class: `badge ${r.status === "scheduled" ? "accent" : ""}` }, { scheduled: "geplant", fired: "erinnert", cancelled: "storniert" }[r.status]),
        r.status === "scheduled" ? h("button", { class: "btn ghost icon sm", "aria-label": "Stornieren", onclick: async () => { await api(`/api/reminders/${r.id}`, { method: "DELETE" }).catch(fail); viewTasks(main); } }, icon("x")) : null))
      : h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "empty" }, "Keine Erinnerungen. Beispiel: „Erinnere mich morgen um 9 an den Zahnarzt.“")))));
}

// ─── View: Gedächtnis ───────────────────────────────────────────────────────
const CATS = { preference: ["Präferenzen", "settings"], person: ["Personen", "chat"], project: ["Projekte", "tasks"], rule: ["Regeln", "shield"], fact: ["Fakten", "memory"] };
async function viewMemory(main) {
  const entries = await api("/api/memory");
  const cat = h("select", { class: "field", "aria-label": "Kategorie" },
    Object.entries({ preference: "Präferenz", person: "Person", project: "Projekt", rule: "Regel", fact: "Fakt" }).map(([k, l]) => h("option", { value: k }, l)));
  const key = h("input", { class: "field", placeholder: "z.B. Meetingdauer", maxlength: 200, required: true, "aria-label": "Schlüssel" });
  const value = h("input", { class: "field", placeholder: "z.B. 30 Minuten, 10 Min. Puffer", maxlength: 2000, required: true, "aria-label": "Wert" });
  const form = h("form", { class: "card mem-form", onsubmit: async (e) => {
    e.preventDefault();
    try { await api("/api/memory", { method: "POST", body: { category: cat.value, key: key.value, value: value.value } }); toast("Gespeichert.", "ok"); viewMemory(main); } catch (err) { fail(err); }
  } }, cat, key, value, h("button", { class: "btn primary", type: "submit" }, "Merken"));

  const cards = Object.entries(CATS).map(([k, [label, ic]]) => {
    const list = entries.filter((e) => e.category === k);
    return h("div", { class: "card" }, cardHead(label, ic, h("span", { class: "badge" }, list.length)),
      list.length ? list.map((m) => h("div", { class: "mem" },
        h("div", { class: "main" }, h("div", { class: "k" }, m.key), h("div", { class: "v" }, m.value),
          h("div", { style: "margin-top:4px" }, m.source === "user" ? h("span", { class: "badge ok" }, "von dir") : h("span", { class: "badge warn" }, `vermutet · ${Math.round(m.confidence * 100)} %`))),
        h("div", { class: "actions" },
          h("button", { class: "btn ghost icon sm", "aria-label": "Bearbeiten", onclick: async () => {
            const v = await dialog({ title: m.key, text: m.source === "user" ? "Wert ändern" : "Vermuteten Wert bestätigen oder korrigieren", input: m.value, confirmLabel: "Speichern" });
            if (v) { await api(`/api/memory/${m.id}`, { method: "PATCH", body: { value: v } }).catch(fail); viewMemory(main); }
          } }, icon("edit")),
          h("button", { class: "btn ghost icon sm", "aria-label": "Löschen", onclick: async () => {
            if (await dialog({ title: "Eintrag löschen?", text: `„${m.key}: ${m.value}“`, confirmLabel: "Löschen", danger: true })) { await api(`/api/memory/${m.id}`, { method: "DELETE" }).catch(fail); viewMemory(main); }
          } }, icon("trash")))))
        : h("div", { class: "card-body" }, h("div", { class: "muted small" }, "Noch leer.")));
  });

  set(main, h("div", { class: "view" },
    viewHead("Gedächtnis", "Was JARVIS über dich weiß — sichtbar, änderbar, löschbar."),
    form,
    h("div", { class: "mem-grid" }, cards)));
}

// ─── View: Einstellungen ────────────────────────────────────────────────────
const CAT_LABELS = {
  email: ["E-Mail organisieren", "Labels, gelesen/ungelesen, archivieren, Entwürfe"],
  calendar: ["Private Termine", "Termine ohne Gäste anlegen und ändern"],
  contacts: ["Kontakte pflegen", "Kontakte anlegen und aktualisieren"],
  tasks: ["Aufgaben", "Anlegen, ändern, erledigen"],
  reminders: ["Erinnerungen", "Erinnerungen und In-App-Benachrichtigungen"],
  memory: ["Gedächtnis", "Präferenzen und Notizen speichern"],
};
async function viewSettings(main, params) {
  const flash = params.get("google");
  if (flash) { toast(flash === "connected" ? "Google wurde verbunden." : `Google-Verbindung fehlgeschlagen: ${flash}`, flash === "connected" ? "ok" : "err"); history.replaceState(null, "", "#settings"); }
  const [setup, integrations, perms, status] = await Promise.all([api("/api/setup"), api("/api/integrations"), api("/api/settings/permissions"), api("/api/status")]);
  const done = setup.steps.filter((s) => s.done).length;
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
        i.id === "google" && i.state === "not_configured" ? h("a", { class: "btn primary sm", href: "/api/integrations/google/connect" }, "Verbinden") : null,
        i.id === "google" && i.state === "connected" ? h("button", { class: "btn danger sm", onclick: async () => {
          if (!(await dialog({ title: "Google trennen?", text: "Die Tokens werden gelöscht und der Zugriff bei Google widerrufen.", confirmLabel: "Trennen", danger: true }))) return;
          await api("/api/integrations/google/disconnect", { method: "POST" }).catch(fail); viewSettings(main, new URLSearchParams());
        } }, "Trennen") : null);
    })),

    h("div", { class: "section-title" }, icon("mail"), "E-Mail-Konten"),
    mailAccountsCard(main),
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
const VIEWS = { today: viewToday, chat: viewChat, activity: viewActivity, calendar: viewCalendar, email: viewEmail, tasks: viewTasks, memory: viewMemory, settings: viewSettings };

let routerBound = false;
async function boot() {
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
  await route();
  refreshCounts();
  state.poll ??= setInterval(() => state.csrf && refreshCounts(), 30_000);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "") && state.csrf) {
    e.preventDefault();
    if (state.view !== "chat") go("chat"); else $("#chat-input")?.focus();
  }
});

boot();
