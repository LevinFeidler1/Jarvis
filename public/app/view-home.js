// Start page: mounts the voice home (jarvis.js) and draws the day ring.

import { mountJarvis } from "../jarvis.js";
import { api, apiStream, state } from "./api.js";
import { append, avatar, fmt, greeting, h, icon, set } from "./dom.js";
import { go } from "./shell.js";
import { suggestionCard } from "./suggestions.js";
import { toast } from "./ui.js";
import { openEventSheet } from "./view-calendar.js";
import { confirmCard } from "./view-chat.js";
import { voice } from "./voice.js";

// ─── View: JARVIS (voice home) ──────────────────────────────────────────────
export function viewJarvis(main, params = new URLSearchParams()) {
  // #jarvis?listen — home-screen shortcut / action button: start listening.
  const autoListen = params.has("listen");
  if (autoListen) history.replaceState(null, "", "#jarvis");
  return mountJarvis(main, {
    autoListen,
    dayRing,
    ringColors: RING_COLORS,
    inHours,
    openEventSheet,
    confirmCard,
    suggestionItems: async (onChange) => {
      const data = await api("/api/suggestions").catch(() => null);
      return data?.suggestions?.map((x) => suggestionCard(x, onChange)) ?? [];
    },
    h, set, append, icon, api, apiStream, go, toast, state, fmt, greeting, avatar,
    toSpeech: (t) => voice.toSpeech(t),
    unlockAudio: () => voice.unlock(),
    pickVoice: () => voice.pickVoice(),
    voicePrefs: () => ({ speak: voice.prefs.speak, conversation: true, bargeIn: voice.prefs.bargeIn !== false }),
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

/** 24-hour ring for the home widget: midnight at the top, today's events as glowing arcs, a pulsing "now". */
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

  // The ring plus how many events are still ahead (home widget).
  const left = timed.filter((e) => new Date(e.end) > now).length;
  return h("div", { class: "ring-wrap compact" },
    h("div", { class: "ring" }, ringSvg, h("div", { class: "ring-center" },
      ok ? [h("span", { class: "ring-count" }, left), h("span", { class: "mono ring-kicker" }, left === 1 ? "TERMIN" : "TERMINE")] : h("span", { class: "mono ring-kicker" }, "–"))));
}
