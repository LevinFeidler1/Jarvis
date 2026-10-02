// JARVIS Web-UI — no framework, no build step.
// Security: all data from the server/providers is rendered via textContent or
// DOM nodes (never innerHTML). Only the static icon markup below uses innerHTML.

import { mountJarvis } from "./jarvis.js";

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
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.4-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 15.5h6"/>',
  euro: '<path d="M18 6.5A7 7 0 1 0 18 17.5"/><path d="M4 10h9M4 14h9"/>',
  spark: '<path d="M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/>',
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
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<![*\w])\*([^*\n]+)\*(?!\w)|_([^_\n]+)_|\[([^\]]+)\]\(#file:([0-9a-f-]{36})\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[2]) frag.append(h("strong", {}, m[2]));
    else if (m[3]) frag.append(h("code", {}, m[3]));
    else if (m[4]) frag.append(h("a", { href: m[5], target: "_blank", rel: "noopener noreferrer" }, m[4]));
    else if (m[6]) frag.append(h("em", {}, m[6]));
    else if (m[7]) frag.append(h("em", {}, m[7]));
    else if (m[8]) { const fid = m[9]; frag.append(h("a", { href: "#", class: "file-link", onclick: (e) => { e.preventDefault(); openFileById(fid); } }, icon("download"), m[8])); }
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
  view: "jarvis",
  conversationId: null,
  /** Conversation of the voice home (kept apart from the chat view). */
  voiceConversationId: null,
  /** ISO date the calendar should jump to (set by a context card). */
  calendarFocus: null,
  calendarFocusId: null,
  /** Prompt the JARVIS home should ask right away (e.g. "Briefing" on Heute). */
  jarvisPrompt: null,
  renderedPending: new Set(),
  busy: false,
  /** Files attached to the next chat message: {file?, name, size, progress, error, promise}. */
  attachments: [],
  weekOffset: 0,
  mailUnread: false,
  mailSelected: null,
  activityFilter: "all",
  counts: { pending: 0, notif: 0 },
};

/**
 * Client-side limits, slightly above the server's (src/server.ts REQUEST_TIMEOUTS):
 * normal routes 25 s, file processing 45 s, agent work 270 s.
 */
const AGENT_ROUTE_RE = /^\/api\/(chat|confirmations\/[^/?]+|automations\/[^/?]+\/run|suggestions\/([^/?]+\/accept|check)|activity\/[^/?]+\/undo)(\?|$)/;
const FILE_WORK_RE = /^\/api\/files\/(uploads\/[^/?]+\/complete|[^/?]+\/preview)(\?|$)/;
function defaultTimeout(path, method) {
  if (method !== "GET" && AGENT_ROUTE_RE.test(path)) return 285_000;
  if (FILE_WORK_RE.test(path)) return 50_000;
  return 30_000;
}

async function api(path, { method = "GET", body, timeoutMs = defaultTimeout(path, method) } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-jarvis-csrf"] = state.csrf ?? "";
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin", signal: ctrl.signal });
  } catch (err) {
    if (err?.name === "AbortError") throw Object.assign(new Error("Zeitüberschreitung — bitte gleich noch einmal versuchen."), { status: 0, timeout: true });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
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

// ─── Dateien: Upload in Teilen, Download in Bereichen (Vercel-Limit 4,5 MB) ──
const FILE_ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.csv,.tsv,.pptx,.txt,.md,.markdown,.json,.png,.jpg,.jpeg";
const FILE_ICON = { pdf: "file", docx: "file", xlsx: "chart", csv: "chart", pptx: "file", txt: "file", md: "file", json: "file", png: "image", jpg: "image" };
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);

async function uploadFile(file, onProgress = () => {}, conversationId) {
  const begin = await api("/api/files/uploads", { method: "POST", body: { name: file.name, size: file.size } });
  for (let i = 0; i < begin.chunks; i++) {
    const part = file.slice(i * begin.chunkSize, Math.min(file.size, (i + 1) * begin.chunkSize));
    const res = await fetch(`/api/files/uploads/${begin.uploadId}/${i}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", "x-jarvis-csrf": state.csrf ?? "" },
      body: part,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Upload fehlgeschlagen (HTTP ${res.status})`);
    onProgress((i + 1) / begin.chunks);
  }
  return api(`/api/files/uploads/${begin.uploadId}/complete`, { method: "POST", body: conversationId ? { conversationId } : {} });
}

async function fetchFileBlob(id, size) {
  const parts = [];
  let type = "application/octet-stream";
  for (let start = 0; start === 0 || start < size; ) {
    const res = await fetch(`/api/files/${id}/content`, { credentials: "same-origin", headers: { range: `bytes=${start}-` } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Download fehlgeschlagen (HTTP ${res.status})`);
    type = res.headers.get("content-type") ?? type;
    size = Number(res.headers.get("x-file-size") ?? size ?? 0);
    const buf = await res.arrayBuffer();
    parts.push(buf);
    start += buf.byteLength;
    if (!buf.byteLength) break;
  }
  return new Blob(parts, { type });
}

async function downloadFile(id, name, size) {
  try {
    const blob = await fetchFileBlob(id, size);
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name ?? "datei" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) { fail(e); }
}

async function openFileById(id) {
  try {
    const { file } = await api(`/api/files/${id}`);
    downloadFile(file.id, file.name, file.size);
  } catch (e) { fail(e); }
}

/** Drag & drop target that calls onFiles(FileList). */
function dropZone(el, onFiles) {
  let depth = 0;
  el.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); depth++; el.classList.add("dragging"); } });
  el.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  el.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove("dragging"); });
  el.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; el.classList.remove("dragging"); onFiles(e.dataTransfer.files); });
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
  ["jarvis", "JARVIS", "spark"],
  ["today", "Heute", "home"],
  ["chat", "Chat", "chat"],
  ["activity", "Aktivität", "activity"],
  ["calendar", "Kalender", "calendar"],
  ["email", "E-Mail", "mail"],
  ["tasks", "Aufgaben", "tasks"],
  ["contacts", "Kontakte", "users"],
  ["files", "Dateien", "folder"],
  ["automations", "Automationen", "bolt"],
  ["review", "Rückblick", "chart"],
  ["memory", "Gedächtnis", "memory"],
  ["settings", "Einstellungen", "settings"],
];
const MOBILE_NAV = ["jarvis", "today", "calendar", "chat"];
const isMobile = () => matchMedia("(max-width: 860px)").matches;

function renderShell() {
  const navBtn = (id, label, ic) =>
    h("button", { class: "nav-item", "data-view": id, onclick: () => go(id) }, icon(ic), h("span", {}, label), id === "activity" ? h("span", { class: "count hidden", "data-count": "pending" }) : null);
  const sidebar = h("nav", { class: "sidebar", "aria-label": "Navigation" },
    h("div", { class: "brand" }, h("div", { class: "orb" }), "JARVIS"),
    NAV.slice(0, 3).map((n) => navBtn(...n)),
    h("div", { class: "nav-sep" }),
    NAV.slice(3).map((n) => navBtn(...n)),
    h("div", { class: "sidebar-foot" },
      h("button", { class: "nav-item", onclick: openNotifications }, icon("bell"), h("span", {}, "Benachrichtigungen"), h("span", { class: "count hidden", "data-count": "notif" })),
      h("button", { class: "nav-item", onclick: cycleTheme }, icon("moon"), h("span", {}, "Design")),
      h("button", { class: "nav-item", onclick: logout }, icon("logout"), h("span", {}, "Abmelden")),
      h("div", { class: "status-line", id: "status-line" })));
  const mobile = h("nav", { class: "mobile-bar", "aria-label": "Navigation" },
    MOBILE_NAV.map((id) => {
      const [, label, ic] = NAV.find((n) => n[0] === id);
      return h("button", { "data-view": id, onclick: () => go(id) }, icon(ic), h("span", {}, label), id === "today" ? h("span", { class: "count hidden", "data-count": "pending" }) : null);
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
function refreshCounts() {
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
  const wrap = h("div", { class: "modal-wrap sheet-wrap", onclick: (e) => e.target === wrap && close() },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Mehr" },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-grid" }, views.map(([id, label, ic]) =>
        item(ic, label, () => go(id), id === "activity" && state.counts.pending ? h("span", { class: "count" }, state.counts.pending) : null, state.view === id))),
      h("div", { class: "sheet-list" },
        item("bell", "Benachrichtigungen", openNotifications, state.counts.notif ? h("span", { class: "count" }, state.counts.notif) : null),
        item(getTheme() === "light" ? "sun" : "moon", `Design: ${themeLabel}`, cycleTheme),
        item("logout", "Abmelden", logout))));
  wrap.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(wrap);
  wrap.querySelector("button")?.focus();
}

function go(view, params = "") {
  location.hash = `${view}${params}`;
}

let unmountView = null;
async function route() {
  if (voice.listening) voice.stopListening();
  if (voice.speaking) voice.stopSpeaking();
  try { unmountView?.(); } catch { /* ignore */ }
  unmountView = null;
  const [view, query = ""] = location.hash.replace(/^#/, "").split("?");
  state.view = VIEWS[view] ? view : "jarvis";
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  $("#more-btn")?.classList.toggle("active", !MOBILE_NAV.includes(state.view));
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

// ─── Voice (Sprach-Chat) ─────────────────────────────────────────────────────
// Browser speech recognition + speech synthesis. Same agent, same permission
// rules as typing: a spoken "ja" is sent as a normal message; critical actions
// are refused server-side and need the button.
const voice = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition || null,
  rec: null,
  listening: false,
  speaking: false,
  unlocked: false,
  prefs: (() => {
    const d = { speak: true, conversation: false, voiceURI: null, rate: 1.05 };
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
function voiceUi() {
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

function startVoiceInput() {
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
function speakReply(reply) {
  let text = reply.text;
  const crit = (reply.pendingActions ?? []).some((p) => p.risk >= 3);
  if (crit) text += " Achtung: Das ist eine kritische Aktion. Bitte bestätige sie per Knopf auf dem Bildschirm.";
  const again = () => { if (voice.prefs.conversation && !crit && state.view === "chat") setTimeout(startVoiceInput, 250); };
  if (voice.prefs.speak) voice.speak(text, again);
  else again();
}

// ─── Vorschläge (proaktiver Butler) ─────────────────────────────────────────
const SUGG_ICON = { meeting: "calendar", lead: "bolt", invoice: "file", deadline: "clock", reply: "reply", newsletter: "inbox" };

function suggestionCard(s, onChange) {
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

function triageSettingsCard() {
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
        h("div", { class: "sub" }, "Mit „Rückgängig“ auf der Heute-Seite.")),
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

// ─── View: JARVIS (voice home) ──────────────────────────────────────────────
function viewJarvis(main) {
  unmountView = mountJarvis(main, {
    h, set, append, icon, api, apiStream, go, toast, state, fmt, greeting, avatar,
    toSpeech: (t) => voice.toSpeech(t),
    unlockAudio: () => voice.unlock(),
    pickVoice: () => voice.pickVoice(),
    voicePrefs: () => ({ speak: voice.prefs.speak, conversation: true }),
    voiceRate: () => voice.prefs.rate,
  });
}


// ─── Tagesring (Heute) ──────────────────────────────────────────────────────
const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
const RING_COLORS = ["#64D2FF", "#7D7AFF", "#30D158", "#FF9F0A", "#FF6482"];
const minutesOfDay = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };
function inHours(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `in ${m} Min.` : `in ${Math.floor(m / 60)} Std.${m % 60 ? ` ${m % 60} Min.` : ""}`;
}

/** 24-hour ring: midnight at the top, today's events as glowing arcs, a pulsing "now". */
function dayRing(events, ok) {
  const R = 112, C = 2 * Math.PI * R, now = new Date(), nowMin = minutesOfDay(now);
  const timed = events.filter((e) => !e.allDay).sort((a, b) => new Date(a.start) - new Date(b.start));
  const arc = (fromMin, toMin, attrs) => svg("circle", { cx: 150, cy: 150, r: R, fill: "none", "stroke-dasharray": `${Math.max(1.5, ((toMin - fromMin) / 1440) * C).toFixed(2)} ${C.toFixed(2)}`, "stroke-dashoffset": (-(fromMin / 1440) * C).toFixed(2), ...attrs });
  const span = (e) => {
    const s = new Date(e.start), en = new Date(e.end), day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const from = s < day0 ? 0 : minutesOfDay(s);
    const to = en.getTime() - day0.getTime() >= 86400000 ? 1440 : Math.max(from + 5, minutesOfDay(en));
    return [from, to];
  };
  const arcs = timed.map((e, i) => ({ e, color: RING_COLORS[i % RING_COLORS.length], span: span(e), past: new Date(e.end) < now }));
  const at = (min, r) => { const a = (min / 1440) * 2 * Math.PI - Math.PI / 2; return [150 + r * Math.cos(a), 150 + r * Math.sin(a)]; };
  const ticks = [...Array(24)].map((_, hIdx) => {
    const major = hIdx % 6 === 0;
    const [x1, y1] = at(hIdx * 60, major ? 90 : 95), [x2, y2] = at(hIdx * 60, 99);
    return svg("line", { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2), stroke: major ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.22)", "stroke-width": major ? 1.6 : 1.2, "stroke-linecap": "round" });
  });
  const labels = [[0, "0"], [360, "6"], [720, "12"], [1080, "18"]].map(([m, t]) => { const [x, y] = at(m, 134); return svg("text", { x: x.toFixed(1), y: y.toFixed(1) }, t); });
  const [nx, ny] = at(nowMin, R);
  const title = ok ? `Tagesring: ${timed.map((e) => `${e.title} ${fmt.time(e.start)}`).join(", ") || "keine Termine"}, jetzt ${fmt.time(now)}` : "Tagesring";
  const ringSvg = svg("svg", { viewBox: "0 0 300 300", class: "ring-svg", role: "img", "aria-label": title },
    svg("defs", {},
      svg("filter", { id: "ringGlow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, svg("feGaussianBlur", { stdDeviation: 5 })),
      svg("mask", { id: "ringReveal", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: 300, height: 300 },
        svg("circle", { class: "ring-reveal", cx: 150, cy: 150, r: R, fill: "none", stroke: "#fff", "stroke-width": 44 }))),
    svg("g", { transform: "rotate(-90 150 150)", mask: "url(#ringReveal)" },
      arc(0, 1440, { stroke: "rgba(255,255,255,.07)", "stroke-width": 12, class: "ring-track" }),
      arc(0, nowMin, { stroke: "rgba(255,255,255,.16)", "stroke-width": 2 }),
      svg("g", { filter: "url(#ringGlow)", opacity: 0.8 }, arcs.filter((a) => !a.past).map((a) => arc(...a.span, { stroke: a.color, "stroke-width": 14, "stroke-linecap": "round" }))),
      arcs.map((a) => arc(...a.span, { stroke: a.color, "stroke-width": 12, "stroke-linecap": "round", opacity: a.past ? 0.35 : 1 }))),
    svg("g", {}, ticks),
    svg("g", { class: "ring-labels" }, labels),
    svg("circle", { cx: nx.toFixed(2), cy: ny.toFixed(2), r: 13, fill: "#fff", "fill-opacity": 0.14 }),
    svg("circle", { class: "ring-now", cx: nx.toFixed(2), cy: ny.toFixed(2), r: 6, fill: "none", stroke: "#fff", "stroke-width": 1.5 }),
    svg("circle", { cx: nx.toFixed(2), cy: ny.toFixed(2), r: 5.5, fill: "#fff" }));

  const current = timed.find((e) => new Date(e.start) <= now && new Date(e.end) > now);
  const next = timed.find((e) => new Date(e.start) > now);
  const center = !ok
    ? [h("span", { class: "mono ring-kicker" }, "KALENDER"), h("span", { class: "ring-title" }, "Nicht verbunden"), h("button", { class: "ring-sub link", onclick: () => go("settings") }, "Jetzt verbinden")]
    : current
      ? [h("span", { class: "mono ring-kicker live-k" }, `JETZT · BIS ${fmt.time(current.end)}`), h("span", { class: "ring-title" }, current.title), h("span", { class: "ring-sub" }, next ? `danach ${next.title} · ${fmt.time(next.start)}` : "danach frei")]
      : next
        ? [h("span", { class: "mono ring-kicker" }, `ALS NÄCHSTES · ${fmt.time(next.start)}`), h("span", { class: "ring-title" }, next.title), h("span", { class: "ring-sub" }, inHours(new Date(next.start) - now))]
        : [h("span", { class: "mono ring-kicker" }, "HEUTE"), h("span", { class: "ring-title" }, timed.length ? "Alles erledigt" : "Kein Termin"), h("span", { class: "ring-sub" }, "Der Rest des Tages gehört dir.")];
  const legend = arcs.filter((a) => !a.past).slice(0, 4).map((a) =>
    h("button", { class: "ring-leg", onclick: () => openEventSheet(a.e, timed) }, h("span", { class: "dot", style: `background:${a.color}` }), h("span", { class: "mono" }, fmt.time(a.e.start)), h("span", { class: "t" }, a.e.title)));
  return h("div", { class: "ring-wrap" },
    h("div", { class: "ring" }, ringSvg, h("div", { class: "ring-center" }, center)),
    legend.length ? h("div", { class: "ring-legend" }, legend) : null);
}

// ─── View: Heute ────────────────────────────────────────────────────────────
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Gute Nacht" : hr < 11 ? "Guten Morgen" : hr < 17 ? "Guten Tag" : hr < 22 ? "Guten Abend" : "Gute Nacht";
}

async function viewToday(main) {
  set(main, h("div", { class: "view today" }, h("div", { class: "today-top" }, h("div", { class: "today-hello" }, h("div", { class: "today-date" }, fmt.long(new Date()).toUpperCase()), h("h1", {}, `${greeting()}.`), h("p", { class: "today-sum shim" }, "Einen Moment, ich sehe mir deinen Tag an …")))));
  const [b, setup, sugg] = await Promise.all([api("/api/briefing"), api("/api/setup"), suggestionsCard(() => viewToday(main))]);
  const now = Date.now();

  const events = b.events.ok ? b.events.data : [];
  const emails = b.emails.ok ? b.emails.data : [];
  const tasks = b.tasks.ok ? b.tasks.data : [];
  const today = ymd(new Date());
  const dueTasks = tasks.filter((t) => t.due && t.due.slice(0, 10) <= today);
  const pending = b.pending.ok ? b.pending.data : [];
  const upcoming = events.filter((e) => e.allDay || new Date(e.end).getTime() > now);

  const summary = [];
  if (b.events.ok) summary.push(events.length ? `${events.length} ${events.length === 1 ? "Termin" : "Termine"} heute` : "keine Termine heute");
  if (b.emails.ok) summary.push(`${emails.length} ungelesene E-Mail${emails.length === 1 ? "" : "s"}`);
  summary.push(`${tasks.length} offene Aufgabe${tasks.length === 1 ? "" : "n"}`);
  const name = state.userName ? `, ${state.userName.split(/\s+/)[0]}` : "";

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

  set(main, h("div", { class: "view today" },
    h("div", { class: "today-top" },
      h("div", { class: "today-hello" },
        h("div", { class: "today-date" }, fmt.long(new Date()).toUpperCase()),
        h("h1", {}, `${greeting()}${name}.`),
        h("p", { class: "today-sum" }, `${summary.join(", ")}.`)),
      h("button", { class: "orb-btn", "aria-label": "Mit JARVIS sprechen", onclick: () => go("jarvis") }, h("span", { class: "orb breathe" }))),
    h("div", { class: "today-hero" },
      dayRing(events, b.events.ok),
      h("div", { class: "brief glass" },
        h("button", { class: "brief-play", "aria-label": "Briefing von JARVIS vorlesen lassen", onclick: () => { voice.unlock(); state.jarvisPrompt = "Guten Morgen, JARVIS. Bereite mir meinen Tag vor."; go("jarvis"); } },
          icon("play")),
        h("div", { class: "brief-text" }, h("b", {}, greeting() === "Guten Morgen" ? "Morgenbriefing" : "Tagesbriefing"), h("span", {}, "Termine, Mails, Entscheidungen — gesprochen")),
        h("span", { class: "eq" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i"), h("i")),
        h("button", { class: "btn sm ghost", onclick: () => startChat("Guten Morgen, JARVIS. Bereite mir meinen Tag vor.") }, "Als Text"))),
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
    sugg,
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

async function viewChat(main, params = new URLSearchParams()) {
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
    h("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, h("div", { class: "orb" }), title),
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
      h("div", { class: "orb xl" }),
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

async function sendMessage(text, opts = {}) {
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
    const reply = await apiStream("/api/chat/stream", { conversationId: state.conversationId ?? undefined, message: text, attachments: ids.length ? ids : undefined }, (ev) => ev.type === "action" && turn.step(ev.action));
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
function confirmCard(p, onDone, inChat = false) {
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

// ─── View: Aktivität ────────────────────────────────────────────────────────
const STATUS = {
  planned: ["geplant", ""], executing: ["läuft", "accent"], succeeded: ["erfolgreich", "ok"], failed: ["fehlgeschlagen", "err"],
  partially_succeeded: ["teilweise", "warn"], awaiting_confirmation: ["wartet", "warn"], rejected: ["abgelehnt", ""],
  expired: ["abgelaufen", ""], denied: ["verweigert", "err"],
};
const RISK = [["Lesen", ""], ["Niedrig", "accent"], ["Extern", "warn"], ["Kritisch", "crit"]];

async function viewActivity(main) {
  const [pending, activity, audit] = await Promise.all([api("/api/confirmations"), api("/api/activity"), api("/api/audit")]);
  const filters = { all: "Alle", awaiting_confirmation: "Wartet", succeeded: "Erfolgreich", failed: "Fehler", autonomous: "Autonom" };
  const shown = activity.filter((a) => state.activityFilter === "all" || a.status === state.activityFilter || (state.activityFilter === "failed" && a.status === "denied") || (state.activityFilter === "autonomous" && a.autonomous));
  const undoBtn = (a) => {
    const b = h("button", { class: "btn sm", title: "Rückgängig" }, icon("history"), h("span", {}, "Rückgängig"));
    b.onclick = async () => {
      b.disabled = true;
      try { const r = await api(`/api/activity/${a.id}/undo`, { method: "POST" }); toast(`Rückgängig: ${r.label}`, "ok"); } catch (e) { fail(e); }
      viewActivity(main);
    };
    return b;
  };
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
        h("div", { class: "right" },
          a.autonomous ? h("span", { class: "badge accent", title: "Von einer Automation selbst ausgeführt" }, "autonom") : null,
          a.undoneAt ? h("span", { class: "badge" }, "rückgängig gemacht") : null,
          h("span", { class: `badge ${RISK[a.risk]?.[1] ?? ""}` }, RISK[a.risk]?.[0] ?? a.risk), h("span", { class: `badge ${cls}` }, label),
          a.canUndo ? undoBtn(a) : null));
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
  const focusId = state.calendarFocusId;
  state.calendarFocusId = null;
  if (state.calendarFocus) {
    const focus = new Date(state.calendarFocus);
    state.calendarFocus = null;
    if (!Number.isNaN(focus.getTime())) {
      focus.setHours(0, 0, 0, 0);
      focus.setDate(focus.getDate() - ((focus.getDay() + 6) % 7));
      state.weekOffset = Math.round((focus - weekStart(0)) / 604800000);
    }
  }
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
  const focused = focusId && events.find((e) => e.id === focusId);
  if (focused) setTimeout(() => openEventSheet(focused, events), 350);
  if (isMobile()) return renderAgenda(main, head, days, events);
  const headRow = h("div", { class: "cal-head" }, h("div"), days.map((d) =>
    h("div", { class: isToday(d) ? "today" : "" }, d.toLocaleDateString("de-DE", { weekday: "short" }), h("b", {}, d.getDate()))));
  const allday = h("div", { class: "cal-allday" }, h("div", {}, "ganzt."), days.map((d) =>
    h("div", {}, events.filter((e) => e.allDay && e.start.slice(0, 10) <= ymd(d) && e.end.slice(0, 10) > ymd(d)).map((e) => h("button", { class: "cal-chip", title: e.title, onclick: () => openEventSheet(e, events) }, e.title)))));
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
      col.append(h("button", { class: `cal-ev ${e.busy ? "" : "free"}`, onclick: () => openEventSheet(e, events), style: `top:${top}px;height:${height}px;left:calc(${(lane / n) * 100}% + 3px);width:calc(${100 / n}% - 6px);right:auto`, title: `${e.title}\n${fmt.time(e.start)}–${fmt.time(e.end)}${e.location ? `\n${e.location}` : ""}` },
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


// ─── Termin-Sheet ───────────────────────────────────────────────────────────
const RSVP = { accepted: ["Zugesagt", "ok"], declined: ["Abgesagt", "err"], tentative: ["Vielleicht", "warn"], needsAction: ["Offen", ""] };

/** Event details as a glass sheet (phone) / dialog (desktop). Event texts are rendered as text only. */
function openEventSheet(e, sameDayEvents = []) {
  document.querySelector(".ev-wrap")?.remove();
  const close = () => { wrap.classList.add("closing"); setTimeout(() => wrap.remove(), 260); document.removeEventListener("keydown", onKey); };
  const onKey = (ev) => ev.key === "Escape" && close();
  const start = new Date(e.start);
  const dayKey = start.toDateString();
  const sameDay = sameDayEvents.filter((x) => !x.allDay && new Date(x.start).toDateString() === dayKey);
  const pos = (iso) => { const d = new Date(iso); return Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60 - 7) / 14) * 100)); };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(start.getFullYear(), start.getMonth(), start.getDate()) - today) / 86400000);
  const chip = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : diff > 1 && diff < 7 ? `in ${diff} Tagen` : null;
  const mins = e.allDay ? 0 : Math.round((new Date(e.end) - start) / 60000);
  const safeLink = typeof e.htmlLink === "string" && /^https:\/\//.test(e.htmlLink) ? e.htmlLink : null;
  const body = h("div", { class: "jc jc-event ev-card" },
    h("div", { class: "jc-head" }, h("span", { class: "jc-glyph k-event" }, icon("calendar")), h("span", { class: "jc-label" }, "Termin"),
      e.status === "tentative" ? h("span", { class: "jc-chip orange" }, "Vorläufig") : chip ? h("span", { class: "jc-chip" }, chip) : null,
      h("button", { class: "ev-x", "aria-label": "Schließen", onclick: close }, icon("x"))),
    h("div", { class: "jc-date" }, start.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })),
    e.allDay ? h("div", { class: "jc-big" }, "Ganztägig")
      : h("div", { class: "jc-timeRow" }, h("span", { class: "jc-big" }, fmt.time(e.start)), h("span", { class: "jc-to" }, `– ${fmt.time(e.end)}`),
          h("span", { class: "jc-dur mono" }, mins >= 60 ? `${Math.floor(mins / 60)} STD${mins % 60 ? ` ${mins % 60} MIN` : ""}` : `${mins} MIN`)),
    h("div", { class: "jc-title" }, e.title),
    e.allDay || !sameDay.length ? null : h("div", { class: "jc-daybar" },
      h("div", { class: "track" }),
      sameDay.map((x) => h("div", { class: `seg ${x.id === e.id ? "me" : ""}`, title: `${x.title} ${fmt.time(x.start)}`, style: `left:${pos(x.start)}%;width:${Math.max(2.5, pos(x.end) - pos(x.start))}%` })),
      h("div", { class: "ticks mono" }, ["7", "10", "13", "16", "19", "21"].map((t) => h("span", {}, t)))),
    h("div", { class: "jc-meta" },
      e.location ? h("div", {}, icon("pin"), e.location) : null,
      e.organizer ? h("div", {}, icon("users"), `Organisiert von ${e.organizer}`) : null),
    e.attendees?.length ? h("div", { class: "ev-people" }, e.attendees.slice(0, 8).map((a) => {
      const [label, cls] = RSVP[a.responseStatus] ?? RSVP.needsAction;
      return h("div", { class: "ev-person" }, avatar(a.name || a.email), h("div", { class: "main" }, h("div", { class: "title" }, a.name || a.email), a.name ? h("div", { class: "sub" }, a.email) : null), h("span", { class: `badge ${cls}` }, label));
    }), e.attendees.length > 8 ? h("div", { class: "muted small" }, `+ ${e.attendees.length - 8} weitere`) : null) : null,
    e.description ? h("div", { class: "jc-preview ev-desc" }, e.description.slice(0, 1200)) : null,
    h("div", { class: "jc-actions" },
      e.location ? h("a", { class: "jc-btn primary", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`, target: "_blank", rel: "noopener noreferrer" }, "Route") : null,
      h("button", { class: `jc-btn ${e.location ? "" : "primary"}`, onclick: () => { close(); startChat(`Zum Termin „${e.title}“ am ${fmt.dt(e.start)}: `, { send: false }); } }, "Mit JARVIS"),
      safeLink ? h("a", { class: "jc-btn", href: safeLink, target: "_blank", rel: "noopener noreferrer", "aria-label": "In Google Kalender öffnen" }, icon("external")) : null));
  const wrap = h("div", { class: "ev-wrap", onclick: (ev) => ev.target === wrap && close() },
    h("div", { class: "ev-sheet glass", role: "dialog", "aria-modal": "true", "aria-label": e.title }, h("div", { class: "jv-grip ev-grip", "aria-hidden": "true" }), body));
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  wrap.querySelector(".ev-x")?.focus();
}

/** Phones: a readable day-by-day list instead of the 7-column grid. */
function renderAgenda(main, head, days, events) {
  const todayYmd = ymd(new Date());
  const past = days.filter((d) => ymd(d) < todayYmd);
  let showPast = false;
  const list = h("div", { class: "agenda" });
  const dayEvents = (d) => {
    const dayStart = new Date(d).getTime();
    const dayEnd = dayStart + 86400000;
    return events
      .filter((e) => (e.allDay ? e.start.slice(0, 10) <= ymd(d) && e.end.slice(0, 10) > ymd(d) : new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart))
      .sort((a, b) => (b.allDay - a.allDay) || (new Date(a.start) - new Date(b.start)));
  };
  const render = () => {
    const shown = showPast ? days : days.filter((d) => ymd(d) >= todayYmd);
    set(list,
      past.length && !showPast && shown.length < days.length
        ? h("button", { class: "btn ghost sm agenda-past", onclick: () => { showPast = true; render(); } }, icon("history"), `${past.length} ${past.length === 1 ? "früheren Tag" : "frühere Tage"} anzeigen`)
        : null,
      shown.map((d) => {
        const evs = dayEvents(d);
        const today = ymd(d) === todayYmd;
        return h("section", { class: `agenda-day ${today ? "today" : ""} ${ymd(d) < todayYmd ? "past" : ""}` },
          h("div", { class: "agenda-date" },
            h("div", { class: "num" }, d.getDate()),
            h("div", {}, h("div", { class: "wd" }, d.toLocaleDateString("de-DE", { weekday: "long" })), h("div", { class: "mo" }, d.toLocaleDateString("de-DE", { month: "long" }))),
            today ? h("span", { class: "badge accent" }, "Heute") : null),
          evs.length
            ? h("div", { class: "card agenda-list" }, evs.map((e) =>
                h("button", { class: `agenda-ev ${e.busy ? "" : "free"}`, onclick: () => openEventSheet(e, events) },
                  h("div", { class: "t" }, e.allDay ? h("b", {}, "ganztägig") : [h("b", {}, fmt.time(e.start)), h("span", {}, fmt.time(e.end))]),
                  h("div", { class: "main" }, h("div", { class: "title" }, e.title),
                    e.location ? h("div", { class: "sub" }, icon("pin"), e.location) : null,
                    e.attendees?.length ? h("div", { class: "sub" }, icon("users"), `${e.attendees.length} Teilnehmer`) : null))))
            : h("div", { class: "agenda-free" }, "Keine Termine"));
      }));
  };
  render();
  set(main, h("div", { class: "view" }, head, list,
    h("div", { class: "muted small", style: "margin-top:14px" }, `${events.length} Termine diese Woche · Zeitzone ${state.status?.timezone ?? TZ}`)));
}

// ─── View: E-Mail ───────────────────────────────────────────────────────────
async function viewEmail(main) {
  const head = viewHead("E-Mail", "Posteingang",
    h("button", { class: `chip ${state.mailUnread ? "active" : ""}`, onclick: () => { state.mailUnread = !state.mailUnread; viewEmail(main); } }, "Nur ungelesen"),
    h("button", { class: "btn", onclick: () => startChat("Sortiere mein Postfach: Was ist wichtig, was braucht eine Antwort, was ist Newsletter/Werbung? Schlag Aktionen vor."), "aria-label": "Mit JARVIS sortieren" }, icon("bolt"), h("span", {}, "Mit JARVIS sortieren")),
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

// ─── View: Dateien ──────────────────────────────────────────────────────────
const SOURCE_LABEL = { upload: "hochgeladen", generated: "von JARVIS erstellt", edited: "bearbeitet", converted: "umgewandelt", drive: "aus Drive", browser: "aus dem Web", telegram: "per Telegram" };

function chatAboutFile(file) {
  state.conversationId = null;
  state.attachments = [{ name: file.name, size: file.size, progress: 1, file, error: null, promise: Promise.resolve() }];
  go("chat");
}

async function previewFile(file) {
  const body = h("div", { class: "preview-body" }, h("div", { class: "spinner", style: "margin:30px auto" }));
  const close = () => { wrap.remove(); if (url) URL.revokeObjectURL(url); };
  let url = null;
  const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close() },
    h("div", { class: "modal preview-modal", role: "dialog", "aria-modal": "true" },
      h("div", { class: "preview-head" }, h("h3", {}, file.name), h("button", { class: "btn ghost icon", "aria-label": "Schließen", onclick: close }, icon("x"))),
      body,
      h("div", { class: "foot" },
        h("button", { class: "btn", onclick: () => { close(); chatAboutFile(file); } }, icon("chat"), h("span", {}, "Mit JARVIS besprechen")),
        h("button", { class: "btn primary", onclick: () => downloadFile(file.id, file.name, file.size) }, icon("download"), h("span", {}, "Herunterladen")))));
  wrap.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(wrap);
  try {
    if (file.format === "png" || file.format === "jpg") {
      url = URL.createObjectURL(await fetchFileBlob(file.id, file.size));
      set(body, h("img", { src: url, alt: file.name, class: "preview-img" }));
    } else {
      const p = await api(`/api/files/${file.id}/preview`);
      set(body,
        p.sheets ? h("div", { class: "muted small" }, p.sheets.map((s) => `${s.name}: ${s.rows} × ${s.columns}`).join(" · ")) : null,
        p.needsVision ? h("div", { class: "banner warn", style: "max-width:none;margin:0" }, icon("alert"), h("div", {}, "Kaum Text gefunden (Scan?) — JARVIS kann das PDF trotzdem visuell lesen.")) : null,
        h("pre", { class: "preview-text" }, p.text || "(kein Text)"),
        p.truncated ? h("div", { class: "muted small" }, "Vorschau gekürzt.") : null);
    }
  } catch (e) { set(body, h("div", { class: "empty" }, e.message)); }
}

async function viewFiles(main, params) {
  const q = params.get("q") ?? "";
  const data = await api(`/api/files${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const previewId = params.get("preview");
  if (previewId) {
    // Opened from a JARVIS context card: show that file right away.
    const f = data.files.find((x) => x.id === previewId) ?? (await api(`/api/files/${encodeURIComponent(previewId)}`).catch(() => null))?.file;
    if (f) setTimeout(() => previewFile(f), 0);
  }
  const reload = (query = q) => go("files", query ? `?q=${encodeURIComponent(query)}` : "");
  const progress = h("div", { class: "upload-list" });
  const doUpload = async (list) => {
    for (const f of [...list]) {
      const bar = h("div", { class: "bar" }, h("div", { style: "width:0%" }));
      const row = h("div", { class: "upload-item" }, icon("upload"), h("span", { class: "name" }, f.name), bar);
      progress.append(row);
      try {
        await uploadFile(f, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
        row.remove();
        toast(`${f.name} hochgeladen.`, "ok");
      } catch (e) { row.classList.add("err"); set(row, icon("alert"), h("span", { class: "name" }, `${f.name}: ${e.message}`)); }
    }
    if (!progress.querySelector(".err")) viewFiles(main, params);
  };
  const picker = h("input", { type: "file", multiple: true, accept: FILE_ACCEPT, hidden: true, onchange: () => { doUpload(picker.files); picker.value = ""; } });
  let t;
  const search = h("input", { class: "field", type: "search", placeholder: "Dateien und Inhalte durchsuchen …", value: q, "aria-label": "Dateien durchsuchen",
    oninput: () => { clearTimeout(t); t = setTimeout(() => reload(search.value.trim()), 400); } });

  const versionsBox = (f) => {
    const box = h("div", { class: "versions" });
    api(`/api/files/${f.id}`).then((d) => set(box, d.versions.map((v) => h("div", { class: "version" },
      h("span", { class: "badge" }, `v${v.version}`),
      h("div", { class: "main" }, h("div", {}, v.note ?? SOURCE_LABEL[v.source] ?? v.source), h("div", { class: "muted small" }, `${fmtSize(v.size)} · ${fmt.rel(v.createdAt)}`)),
      h("button", { class: "btn ghost icon sm", "aria-label": `Version ${v.version} herunterladen`, onclick: () => downloadFile(v.id, v.name, v.size) }, icon("download")))))).catch((e) => set(box, e.message));
    return box;
  };

  const row = (f) => {
    const det = h("details", { class: "file-row" },
      h("summary", {},
        h("div", { class: `file-ic ${f.format}` }, icon(FILE_ICON[f.format] ?? "file")),
        h("div", { class: "main" }, h("div", { class: "title" }, f.name),
          h("div", { class: "sub" }, [f.format.toUpperCase(), fmtSize(f.size), f.versions > 1 ? `${f.versions} Versionen` : null, SOURCE_LABEL[f.source], fmt.rel(f.createdAt), f.storage === "drive" ? "Google Drive" : null].filter(Boolean).join(" · "))),
        h("div", { class: "actions", onclick: (e) => e.preventDefault() },
          h("button", { class: "btn ghost icon sm", "aria-label": "Vorschau", title: "Vorschau", onclick: () => previewFile(f) }, icon("eye")),
          h("button", { class: "btn ghost icon sm", "aria-label": "Herunterladen", title: "Herunterladen", onclick: () => downloadFile(f.id, f.name, f.size) }, icon("download")),
          f.driveUrl && /^https:\/\/(drive|docs)\.google\.com\//.test(f.driveUrl) ? h("a", { class: "btn ghost icon sm hide-mobile", href: f.driveUrl, target: "_blank", rel: "noopener noreferrer", "aria-label": "In Google Drive öffnen", title: "In Google Drive öffnen" }, icon("globe")) : null,
          h("button", { class: "btn ghost icon sm hide-mobile", "aria-label": "Mit JARVIS besprechen", title: "Mit JARVIS besprechen", onclick: () => chatAboutFile(f) }, icon("chat")),
          h("button", { class: "btn ghost icon sm", "aria-label": "Löschen", title: "Löschen", onclick: async () => {
            if (!(await dialog({ title: `„${f.name}“ löschen?`, text: f.versions > 1 ? `Alle ${f.versions} Versionen werden gelöscht.${f.storage === "drive" ? " In Google Drive landen sie im Papierkorb." : ""}` : f.storage === "drive" ? "Die Datei landet im Drive-Papierkorb." : "Die Datei wird endgültig gelöscht.", confirmLabel: "Löschen", danger: true }))) return;
            await api(`/api/files/${f.id}?all=1`, { method: "DELETE" }).catch(fail); viewFiles(main, params);
          } }, icon("trash")))));
    det.addEventListener("toggle", () => { if (det.open && !det.querySelector(".versions")) det.append(versionsBox(f)); });
    return det;
  };

  const usedPct = Math.round((data.limits.dbUsedBytes / data.limits.dbQuotaBytes) * 100);
  const zone = h("button", { class: "drop-zone", onclick: () => picker.click() }, icon("upload"),
    h("div", {}, h("b", {}, "Dateien hierher ziehen oder tippen zum Auswählen"), h("div", { class: "muted small" }, `PDF, Word, Excel, CSV, PowerPoint, Text, Markdown, Bilder · max. ${Math.round(data.limits.maxBytes / 1048576)} MB`)));
  set(main, h("div", { class: "view" },
    viewHead("Dateien", data.storage === "drive" ? "Gespeichert in deinem Google Drive (Ordner „JARVIS“)" : `Gespeichert in JARVIS · ${fmtSize(data.limits.dbUsedBytes)} von ${fmtSize(data.limits.dbQuotaBytes)} belegt (${usedPct} %)`,
      h("button", { class: "btn primary", onclick: () => picker.click() }, icon("upload"), h("span", {}, "Hochladen")), picker),
    zone, progress,
    h("div", { class: "card", style: "padding:12px;margin:14px 0" }, search),
    data.files.length ? h("div", { class: "card files-card" }, data.files.map(row))
      : h("div", { class: "empty" }, q ? "Keine Treffer." : "Noch keine Dateien. Lade etwas hoch oder bitte JARVIS z.B. „Erstelle mir eine Excel-Liste meiner Fixkosten“."),
    data.storage === "db" ? h("div", { class: "muted small", style: "margin-top:10px" }, "Tipp: Mit Google Drive (Einstellungen → Integrationen) liegen Dateien in deinem Drive statt in der JARVIS-Datenbank.") : null));
  dropZone(main.querySelector(".view"), doUpload);
}

// ─── View: Kontakte ─────────────────────────────────────────────────────────
const splitList = (v) => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

function contactEditor(c) {
  return new Promise((resolve) => {
    const f = {
      name: h("input", { class: "field", id: "ct-name", maxlength: 200, required: true, placeholder: "Vor- und Nachname", value: c?.name ?? "" }),
      emails: h("input", { class: "field", id: "ct-emails", placeholder: "anna@example.com, …", value: (c?.emails ?? []).join(", ") }),
      phones: h("input", { class: "field", id: "ct-phones", type: "tel", placeholder: "+49 170 …", value: (c?.phones ?? []).join(", ") }),
      organization: h("input", { class: "field", id: "ct-org", maxlength: 200, placeholder: "Firma", value: c?.organization ?? "" }),
      role: h("input", { class: "field", id: "ct-role", maxlength: 200, placeholder: "Rolle, z.B. Geschäftsführerin", value: c?.role ?? "" }),
      notes: h("textarea", { class: "field", id: "ct-notes", rows: 3, maxlength: 2000, style: "height:auto;padding:10px 12px", placeholder: "Notizen (z.B. „duzen“, „bevorzugt WhatsApp“)" }, c?.notes ?? ""),
    };
    const err = h("div", { class: "error-text" });
    const close = (v) => { wrap.remove(); resolve(v); };
    const label = (text, forId) => h("label", { class: "small muted", for: forId }, text);
    const form = h("form", { class: "modal contact-modal", role: "dialog", "aria-modal": "true", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const body = {
        name: f.name.value.trim(), emails: splitList(f.emails.value), phones: splitList(f.phones.value),
        organization: f.organization.value.trim(), role: f.role.value.trim(), notes: f.notes.value.trim(),
      };
      const bad = body.emails.find((m) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
      if (bad) { err.textContent = `Ungültige E-Mail-Adresse: ${bad}`; return; }
      try {
        const saved = c ? await api(`/api/contacts/${encodeURIComponent(c.id)}`, { method: "PATCH", body }) : await api("/api/contacts", { method: "POST", body });
        close(saved);
      } catch (ex) { err.textContent = ex.message; }
    } },
      h("h3", {}, c ? "Kontakt bearbeiten" : "Neuer Kontakt"),
      label("Name", "ct-name"), f.name,
      label("E-Mail-Adressen (mehrere mit Komma)", "ct-emails"), f.emails,
      label("Telefonnummern", "ct-phones"), f.phones,
      h("div", { class: "grid2" }, f.organization, f.role),
      label("Notizen", "ct-notes"), f.notes,
      err,
      h("div", { class: "foot" },
        h("button", { class: "btn ghost", type: "button", onclick: () => close(null) }, "Abbrechen"),
        h("button", { class: "btn primary", type: "submit" }, "Speichern")));
    const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close(null) }, form);
    wrap.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
    document.body.append(wrap);
    f.name.focus();
  });
}

async function viewContacts(main) {
  const data = await api("/api/contacts");
  const contacts = data.contacts;
  const reload = () => viewContacts(main);

  const row = (c) => h("div", { class: "integration contact-row" },
    avatar(c.name),
    h("div", { class: "main" },
      h("div", { class: "title" }, c.name, c.source !== "jarvis" ? h("span", { class: "badge", style: "margin-left:8px" }, c.source === "other" ? "aus E-Mails" : "Google") : null),
      h("div", { class: "sub" }, [c.role, c.organization].filter(Boolean).join(" · ") || null),
      h("div", { class: "sub contact-links" },
        c.emails.map((m) => h("a", { href: `mailto:${m}` }, icon("mail"), m)),
        c.phones.map((p) => h("a", { href: `tel:${p.replace(/[^\d+]/g, "")}` }, icon("phone"), p))),
      c.notes ? h("div", { class: "sub" }, c.notes) : null),
    c.source === "jarvis" ? h("div", { class: "actions" },
      h("button", { class: "btn ghost icon sm", "aria-label": `${c.name} bearbeiten`, onclick: async () => { if (await contactEditor(c)) { toast("Gespeichert.", "ok"); reload(); } } }, icon("edit")),
      h("button", { class: "btn ghost icon sm", "aria-label": `${c.name} löschen`, onclick: async () => {
        if (!(await dialog({ title: `${c.name} löschen?`, text: "Der Kontakt wird aus JARVIS entfernt.", confirmLabel: "Löschen", danger: true }))) return;
        await api(`/api/contacts/${encodeURIComponent(c.id)}`, { method: "DELETE" }).catch(fail); reload();
      } }, icon("trash"))) : null);

  const listBox = h("div", {});
  const googleBox = h("div", {});
  const renderList = (q) => {
    const needle = q.trim().toLowerCase();
    const hits = needle ? contacts.filter((c) => [c.name, c.organization, c.role, ...c.emails, ...c.phones].filter(Boolean).join(" ").toLowerCase().includes(needle)) : contacts;
    set(listBox, hits.length
      ? h("div", { class: "card" }, hits.map(row))
      : h("div", { class: "empty" }, contacts.length ? "Keine Treffer in deinen JARVIS-Kontakten." : "Noch keine Kontakte. Lege oben einen an, importiere eine .vcf-Datei oder sag JARVIS: „Speichere Anna Schmidt, anna@example.com“."));
  };
  let timer;
  const search = h("input", { class: "field", type: "search", placeholder: data.google ? "Suchen (auch in Google Kontakte) …" : "Kontakte durchsuchen …", "aria-label": "Kontakte durchsuchen",
    oninput: () => {
      renderList(search.value);
      clearTimeout(timer);
      set(googleBox);
      if (!data.google || search.value.trim().length < 2) return;
      timer = setTimeout(async () => {
        try {
          const r = await api(`/api/contacts?q=${encodeURIComponent(search.value.trim())}`);
          const remote = r.contacts.filter((c) => c.source !== "jarvis");
          set(googleBox,
            r.warning ? h("div", { class: "muted small" }, r.warning) : null,
            remote.length ? [h("div", { class: "section-title" }, "Aus Google Kontakte", h("span", { class: "badge" }, remote.length)), h("div", { class: "card" }, remote.map(row))] : null);
        } catch (e) { set(googleBox, h("div", { class: "muted small" }, e.message)); }
      }, 300);
    } });

  const file = h("input", { type: "file", accept: ".vcf,text/vcard,text/x-vcard", hidden: true, onchange: async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { toast("Datei zu groß (max. 4 MB).", "err"); return; }
    try {
      const r = await api("/api/contacts/import", { method: "POST", body: { vcf: await f.text() } });
      toast(`${r.imported} Kontakte importiert${r.skipped ? `, ${r.skipped} übersprungen (schon vorhanden)` : ""}.`, "ok");
      reload();
    } catch (e) { fail(e); } finally { file.value = ""; }
  } });

  set(main, h("div", { class: "view" },
    viewHead("Kontakte",
      `${contacts.length} in JARVIS${data.google ? " · Google Kontakte verbunden" : ""}`,
      h("button", { class: "btn", onclick: () => file.click() }, icon("upload"), h("span", {}, "Importieren")),
      contacts.length ? h("a", { class: "btn", href: "/api/contacts/export", download: "jarvis-kontakte.vcf" }, icon("download"), h("span", {}, "Exportieren")) : null,
      h("button", { class: "btn primary", onclick: async () => { if (await contactEditor(null)) { toast("Kontakt gespeichert.", "ok"); reload(); } } }, icon("plus"), h("span", {}, "Neuer Kontakt")),
      file),
    h("div", { class: "card", style: "padding:12px" }, search),
    listBox,
    googleBox,
    h("div", { class: "muted small", style: "margin-top:4px" },
      "Import: vCard-Datei (.vcf) vom iPhone (iCloud.com → Kontakte → Exportieren), Android, Outlook oder 1&1. ",
      data.google ? "Google-Kontakte werden bei der Suche automatisch mit durchsucht." : "Google Kontakte ist optional — JARVIS nutzt diese Kontakte auch ohne Google.")));
  renderList("");
}

// ─── Push-Benachrichtigungen ───────────────────────────────────────────────
const push = {
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

function pushCard(onChange) {
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

function telegramCard() {
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

async function viewAutomations(main) {
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

// ─── View: Wochenrückblick ──────────────────────────────────────────────────
async function viewReview(main, params) {
  const offset = Math.min(0, Number(params.get("w") ?? 0) || 0);
  const r = await api(`/api/review?offset=${offset}`);
  const num = (key) => r.actions.find((a) => a.key === key)?.count ?? 0;
  const tile = (n, l, ic, cls = "") => h("div", { class: "card stat static" }, h("div", { class: `ic ${cls}` }, icon(ic)), h("div", {}, h("div", { class: "n" }, n), h("div", { class: "l" }, l)));
  const eur = (usd) => usd.toLocaleString("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: usd < 1 ? 3 : 2 });
  const cacheShare = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens
    ? Math.round((r.usage.cacheReadTokens / (r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens)) * 100) : 0;
  const list = (items, empty) => items.length ? h("div", {}, items) : h("div", { class: "muted small", style: "padding:4px 0" }, empty);
  set(main, h("div", { class: "view" },
    viewHead("Wochenrückblick", `${r.label}${r.isCurrentWeek ? " · diese Woche" : ""}`,
      h("button", { class: "btn icon", "aria-label": "Vorherige Woche", onclick: () => go("review", `?w=${offset - 1}`) }, icon("left")),
      offset < 0 ? h("button", { class: "btn icon", "aria-label": "Nächste Woche", onclick: () => go("review", `?w=${offset + 1}`) }, icon("right")) : null,
      h("button", { class: "btn primary", onclick: () => startChat(`Erstelle meinen Wochenrückblick${offset ? ` für week_offset ${offset}` : ""}: Was wurde erledigt, was ist offen geblieben, was steht an? Schließe mit den 3 wichtigsten Punkten.`) }, icon("bolt"), h("span", {}, "Zusammenfassen"))),
    h("div", { class: "stat-row review-stats" },
      tile(num("emailsSent"), "E-Mails gesendet", "mail"),
      tile(num("eventsCreated") + num("eventsChanged"), "Termine geplant", "calendar"),
      tile(r.tasks.completed.length, "Aufgaben erledigt", "tasks", "ok"),
      tile(r.automationRuns, "Automationen gelaufen", "bolt")),
    h("div", { class: "grid" },
      h("div", { class: "card col-6" }, cardHead("Erledigt", "check"), h("div", { class: "card-body" },
        list(r.tasks.completed.map((t) => h("div", { class: "rv-row" }, icon("check"), h("span", {}, t.title), h("span", { class: "muted small" }, fmt.rel(t.completedAt)))), "Keine erledigten Aufgaben."),
        r.highlights.length ? [h("div", { class: "rv-sub" }, "Von JARVIS ausgeführt"), r.highlights.map((x) => h("div", { class: "rv-row" }, icon(x.tool.includes("event") || x.tool.includes("invit") ? "calendar" : "mail"), h("span", {}, x.description), h("span", { class: "muted small" }, fmt.rel(x.at))))] : null,
        r.actions.length ? h("div", { class: "rv-chips" }, r.actions.map((a) => h("span", { class: "badge" }, `${a.label}: ${a.count}`))) : null)),
      h("div", { class: "card col-6" }, cardHead("Offen & nächste Woche", "clock"), h("div", { class: "card-body" },
        r.tasks.openOverdue ? h("div", { class: "rv-row warn" }, icon("alert"), h("span", {}, `${r.tasks.openOverdue} überfällige Aufgabe${r.tasks.openOverdue === 1 ? "" : "n"}`), h("button", { class: "btn ghost sm", onclick: () => go("tasks") }, "Ansehen")) : null,
        h("div", { class: "rv-sub" }, "Fällig nächste Woche"),
        list(r.tasks.dueNextWeek.map((t) => h("div", { class: "rv-row" }, icon("tasks"), h("span", {}, t.title), h("span", { class: "muted small" }, new Date(t.due).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })))), "Nichts fällig."),
        h("div", { class: "rv-sub" }, "Termine nächste Woche"),
        r.nextWeek.events ? list(r.nextWeek.events.map((e) => h("div", { class: "rv-row" }, icon("calendar"), h("span", {}, e.title), h("span", { class: "muted small" }, e.allDay ? new Date(e.start).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) : fmt.dt(e.start)))), "Keine Termine.")
          : h("div", { class: "muted small" }, "Kalender nicht verbunden."))),
      h("div", { class: "card col-6" }, cardHead("Aktivität", "activity"), h("div", { class: "card-body" }, h("dl", { class: "kv" },
        h("dt", {}, "Unterhaltungen"), h("dd", {}, r.conversations),
        h("dt", {}, "Erinnerungen ausgelöst"), h("dd", {}, r.remindersFired),
        h("dt", {}, "Bestätigt / abgelehnt"), h("dd", {}, `${r.confirmations.approved} / ${r.confirmations.rejected}`),
        h("dt", {}, "Neue Aufgaben"), h("dd", {}, r.tasks.created)))),
      h("div", { class: "card col-6" }, cardHead("Kosten (Claude API)", "bolt"), h("div", { class: "card-body" },
        h("div", { class: "rv-cost" }, `ca. ${eur(r.usage.costUsd)}`),
        h("dl", { class: "kv" },
          h("dt", {}, "Anfragen ans Modell"), h("dd", {}, r.usage.requests),
          h("dt", {}, "Tokens (ein/aus)"), h("dd", {}, `${(r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens).toLocaleString("de-DE")} / ${r.usage.outputTokens.toLocaleString("de-DE")}`),
          h("dt", {}, "Aus dem Cache"), h("dd", {}, `${cacheShare} %`),
          h("dt", {}, "Websuchen"), h("dd", {}, r.usage.webSearches),
          h("dt", {}, "Gekürzte Unterhaltungen"), h("dd", {}, r.usage.compactions)),
        h("div", { class: "muted small", style: "margin-top:8px" }, "Schätzung nach Listenpreisen. Genaue Abrechnung: console.anthropic.com → Usage.")))),
  ));
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
    h("div", { class: "section-title", id: "push-section" }, icon("bell"), "Push-Benachrichtigungen"),
    pushCard(),
    h("div", { class: "section-title", id: "telegram-section" }, icon("send"), "Telegram"),
    telegramCard(),
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
      h("div", {}, h("button", { class: "btn sm", onclick: () => { voice.unlock(); voice.speak(`Guten Tag${state.userName ? `, ${state.userName}` : ""}. So klinge ich. Was kann ich für dich tun?`); } }, icon("volume"), "Probe anhören")),
      h("div", { class: "muted small" },
        `Spracheingabe: ${voice.canListen ? "verfügbar" : "nicht verfügbar in diesem Browser"} · Sprachausgabe: ${voice.canSpeak ? "verfügbar" : "nicht verfügbar"}. `,
        "Im Chat: 🎤 zum Sprechen, „Gespräch“ für freihändigen Dialog (beenden mit „Stopp“). ",
        "Datenschutz: In Chrome/Edge wird die Aufnahme zur Erkennung an den Browser-Hersteller (Google/Microsoft) gesendet; Safari erkennt teils auf dem Gerät. ",
        "Sicherheit: Ein gesprochenes „Ja“ bestätigt nur normale Aktionen, die JARVIS vorher vorgelesen hat. Kritische Aktionen immer per Knopf.")));
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
const VIEWS = { jarvis: viewJarvis, today: viewToday, chat: viewChat, activity: viewActivity, calendar: viewCalendar, email: viewEmail, tasks: viewTasks, contacts: viewContacts, files: viewFiles, automations: viewAutomations, review: viewReview, memory: viewMemory, settings: viewSettings };

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
  push.register();
  await route();
  poller.start();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "") && state.csrf) {
    e.preventDefault();
    if (state.view !== "chat") go("chat"); else $("#chat-input")?.focus();
  }
});

boot();
