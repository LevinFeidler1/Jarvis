// Shared app state and the API client (JSON + NDJSON streams, time limits per route).

import { renderLogin } from "./shell.js";

// ─── API ────────────────────────────────────────────────────────────────────
export const state = {
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
const FILE_WORK_RE = /^\/api\/(files\/(uploads\/[^/?]+\/complete|[^/?]+\/preview)|finance\/scan)(\?|$)/;
function defaultTimeout(path, method) {
  if (method !== "GET" && AGENT_ROUTE_RE.test(path)) return 285_000;
  if (FILE_WORK_RE.test(path)) return 50_000;
  return 30_000;
}

export async function api(path, { method = "GET", body, timeoutMs = defaultTimeout(path, method) } = {}) {
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
export async function apiStream(path, body, onEvent) {
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
