// DOM helpers, icons, formatting, safe Markdown → DOM.
// Security: all data from the server/providers is rendered via textContent or
// DOM nodes (never innerHTML). Only the static icon markup below uses innerHTML.

import { openFileById } from "./files-io.js";

// ─── Utilities ──────────────────────────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
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
export function set(node, ...children) {
  node.replaceChildren();
  return append(node, children);
}
export function append(node, children) {
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
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v9a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h5"/>',
  "w-sun": '<circle cx="12" cy="12" r="4.2" fill="#FFD60A" stroke="#FFB340"/><path stroke="#FFB340" d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  "w-moon": '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" fill="#CFE1FF" stroke="#A8C4FF"/>',
  "w-partly": '<circle cx="9" cy="9" r="3.4" fill="#FFD60A" stroke="#FFB340"/><path stroke="#FFB340" d="M9 2.8v1.4M3.6 4.6l1 1M2.8 9h1.4M14.4 4.6l-1 1"/><path d="M8 20h9.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6.9A3 3 0 0 0 8 20z" fill="#E5E5EA" stroke="#C7C7CC"/>',
  "w-cloud": '<path d="M7 19h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 19z" fill="#D1D1D6" stroke="#AEAEB2"/>',
  "w-fog": '<path d="M7 13h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6.9A3 3 0 0 0 7 13z" fill="#D1D1D6" stroke="#AEAEB2"/><path stroke="#AEAEB2" d="M4 16.5h16M6 20h12"/>',
  "w-drizzle": '<path d="M7 15h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6.9A3 3 0 0 0 7 15z" fill="#D1D1D6" stroke="#AEAEB2"/><path stroke="#64D2FF" d="M9 18l-.6 1.6M13 18l-.6 1.6M17 18l-.6 1.6"/>',
  "w-rain": '<path d="M7 14h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6.9A3 3 0 0 0 7 14z" fill="#C7C7CC" stroke="#8E8E93"/><path stroke="#0A84FF" stroke-width="2" d="M8.5 17l-1.2 3M12.5 17l-1.2 3M16.5 17l-1.2 3"/>',
  "w-snow": '<path d="M7 14h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6.9A3 3 0 0 0 7 14z" fill="#E5E5EA" stroke="#AEAEB2"/><path stroke="#FFFFFF" d="M8 18h.01M12 20h.01M16 18h.01M10 21.5h.01M14 21.5h.01" stroke-width="2.6"/>',
  "w-storm": '<path d="M7 13h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6.9A3 3 0 0 0 7 13z" fill="#8E8E93" stroke="#636366"/><path d="M12.5 13.5 10 18h3.5l-2 4.5" stroke="#FFD60A" stroke-width="2"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 15.5h6"/>',
  euro: '<path d="M18 6.5A7 7 0 1 0 18 17.5"/><path d="M4 10h9M4 14h9"/>',
  spark: '<path d="M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/>',
};
/** The JARVIS mark: a glowing ring with a travelling light point (static markup only). */
let logoSeq = 0;
export function logoMark(cls = "") {
  const n = ++logoSeq;
  const span = document.createElement("span");
  span.className = `logo-mark ${cls}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 64 64"><defs><linearGradient id="lr${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ff0ff"/><stop offset=".45" stop-color="#3d8bff"/><stop offset="1" stop-color="#7a4dff"/></linearGradient><filter id="lg${n}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6"/></filter></defs><circle cx="32" cy="32" r="22" fill="none" stroke="url(#lr${n})" stroke-width="7" opacity=".8" filter="url(#lg${n})"/><circle class="lm-ring" cx="32" cy="32" r="22" fill="none" stroke="url(#lr${n})" stroke-width="4"/><circle cx="32" cy="32" r="3.2" fill="#fff"/><g class="lm-dot"><circle cx="47.6" cy="16.4" r="5" fill="#bdf4ff" filter="url(#lg${n})"/><circle cx="47.6" cy="16.4" r="2.6" fill="#fff"/></g></svg>`;
  return span;
}

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.dot}</svg>`;
  return span.firstChild;
}

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const fmt = {
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
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const isToday = (d) => ymd(new Date(d)) === ymd(new Date());

const AVATAR_COLORS = ["#0e7490", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#2563eb", "#9333ea", "#0891b2"];
export function avatar(name) {
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
export function markdown(src) {
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

// ─── Greeting ───────────────────────────────────────────────────────────────
export function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Gute Nacht" : hr < 11 ? "Guten Morgen" : hr < 17 ? "Guten Tag" : hr < 22 ? "Guten Abend" : "Gute Nacht";
}
