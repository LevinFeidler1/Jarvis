#!/usr/bin/env node
/**
 * Live check against a running JARVIS (e.g. your Vercel deployment):
 * reachability, login, every endpoint the start page needs, response times.
 *
 *   JARVIS_URL=https://<app>.vercel.app JARVIS_TOKEN=… npm run check:live
 *   … -- --chat    also one tiny chat turn (one model request, ~1–2 US cents)
 *   … -- --cron    also /api/cron/tick (needs CRON_SECRET; may run automations)
 *
 * Plain Node 22, no dependencies. Never prints the token, cookie or CSRF token.
 * Exit code 1 when a check fails — usable in CI (see .github/workflows/live-check.yml).
 */

const base = (process.env.JARVIS_URL ?? "").replace(/\/+$/, "");
const token = process.env.JARVIS_TOKEN ?? "";
const cronSecret = process.env.CRON_SECRET ?? "";
const withChat = process.argv.includes("--chat");
const withCron = process.argv.includes("--cron");
const SLOW_MS = 5_000;

if (!/^https?:\/\//.test(base)) {
  console.error("JARVIS_URL fehlt, z. B. JARVIS_URL=https://meine-app.vercel.app");
  process.exit(2);
}
if (!token) {
  console.error("JARVIS_TOKEN fehlt (dein Zugangstoken, JARVIS_ACCESS_TOKEN in Vercel).");
  process.exit(2);
}

const origin = new URL(base).origin;
const results = [];
let cookie = "";
let csrf = "";

/** Redacts anything that could be a secret before it is printed. */
const redact = (s) => (token.length >= 8 ? String(s).replaceAll(token, "«token»") : String(s)).replace(/jarvis_session=[^;\s]+/g, "jarvis_session=«…»").slice(0, 300);

async function call(method, path, { body, auth = true, headers = {}, timeoutMs = 30_000 } = {}) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(auth && cookie ? { cookie } : {}),
      ...(auth && csrf && method !== "GET" ? { "x-jarvis-csrf": csrf, origin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { res, ms: Math.round(performance.now() - started) };
}

async function check(name, fn) {
  const started = performance.now();
  try {
    const note = (await fn()) ?? "";
    const ms = Math.round(performance.now() - started);
    results.push({ ok: true, name, ms, note: ms > SLOW_MS ? `langsam · ${note}` : note });
  } catch (err) {
    results.push({ ok: false, name, ms: Math.round(performance.now() - started), note: redact(err?.message ?? err) });
  }
}

async function json(method, path, opts) {
  const { res } = await call(method, path, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`keine JSON-Antwort (${text.slice(0, 80)})`);
  }
}

/** Parts of /api/briefing and /api/home fail on their own — report each. */
const parts = (obj, keys) =>
  keys.map((k) => (obj[k]?.ok ? `${k} ✓` : `${k} ✗${obj[k]?.code ? ` (${obj[k].code})` : ""}`)).join(" · ");

await check("Startseite (HTML)", async () => {
  const { res } = await call("GET", "/", { auth: false });
  const html = await res.text();
  if (!res.ok || !html.includes("JARVIS")) throw new Error(`HTTP ${res.status}`);
  const csp = res.headers.get("content-security-policy");
  return csp ? "CSP gesetzt" : "ohne CSP-Header";
});

await check("Health", async () => {
  const r = await json("GET", "/api/health", { auth: false });
  if (!r.ok) throw new Error("ok ≠ true");
});

await check("Login", async () => {
  const { res } = await call("POST", "/api/login", { body: { token }, auth: false, headers: { origin } });
  if (res.status === 401) throw new Error("Token falsch (401)");
  if (res.status === 429) throw new Error("zu viele Logins in einer Minute (429) — kurz warten");
  if (res.status === 403) throw new Error(`Origin abgelehnt (403): JARVIS_PUBLIC_URL in Vercel muss ${origin} sein — sonst scheitert auch der Login im Browser`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const set = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const session = set.map((c) => c.split(";")[0]).find((c) => c.startsWith("jarvis_session="));
  if (!session) throw new Error("kein Session-Cookie");
  const secure = set.some((c) => c.startsWith("jarvis_session=") && /;\s*secure/i.test(c));
  cookie = session;
  csrf = (await res.json()).csrfToken ?? "";
  return secure || base.startsWith("http://") ? "Cookie HttpOnly" : "⚠ Cookie ohne Secure";
});
if (!cookie) {
  print();
  process.exit(1);
}

await check("Sitzung", async () => {
  const r = await json("GET", "/api/session");
  if (!r.authenticated) throw new Error("nicht angemeldet");
  return r.userName ? `als ${r.userName}` : "";
});

let status = {};
await check("Status", async () => {
  status = await json("GET", "/api/status");
  if (!status.llmConfigured) throw new Error("ANTHROPIC_API_KEY fehlt");
  return [status.model, status.database, status.hosting].filter(Boolean).join(" · ");
});

await check("Einrichtung", async () => {
  const r = await json("GET", "/api/setup");
  const open = r.steps.filter((s) => !s.done).map((s) => s.title);
  return `${r.steps.length - open.length}/${r.steps.length} erledigt${open.length ? ` · offen: ${open.slice(0, 2).join(", ")}` : ""}`;
});

await check("Briefing", async () => parts(await json("GET", "/api/briefing"), ["events", "emails", "tasks", "reminders", "pending"]));
await check("Startseite (Widgets)", async () => parts(await json("GET", "/api/home"), ["weather", "news", "finance", "lists", "notes", "usage"]));
await check("Benachrichtigungen", async () => `${(await json("GET", "/api/notifications")).length} Einträge`);
await check("Bestätigungen", async () => `${(await json("GET", "/api/confirmations")).length} offen`);
await check("KI-Kosten", async () => {
  const u = await json("GET", "/api/usage");
  const usd = (v) => `${v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const spent = `${usd(u.spentUsd)} diesen Monat`;
  if (u.blocked) throw new Error(`Budget aufgebraucht, KI pausiert (${spent})`);
  return u.budgetUsd ? `${spent} von ${usd(u.budgetUsd)} (${Math.round(u.ratio * 100)} %)` : `${spent}, kein Budget gesetzt`;
});
await check("Sprache", async () => {
  const v = await json("GET", "/api/voice/config");
  return `Erkennung: ${v.stt === "server" ? "Groq Whisper" : "Browser"} · Stimme: ${v.tts === "server" ? "ElevenLabs" : "Gerät"}`;
});

if (withChat) {
  await check("Chat (1 Modell-Anfrage)", async () => {
    const started = performance.now();
    const { res } = await call("POST", "/api/chat/stream", { body: { message: "Live-Check: Antworte nur mit dem Wort OK." }, timeoutMs: 120_000 });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buf = "", first = 0, reply = null, error = null;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "text" && !first) first = performance.now() - started;
        if (ev.type === "reply") reply = ev.reply;
        if (ev.type === "error") error = ev.error;
      }
    }
    if (error) throw new Error(typeof error === "string" ? error : JSON.stringify(error));
    if (!reply?.text) throw new Error("keine Antwort");
    // Leave no trace: delete the test conversation again.
    if (reply.conversationId) await call("DELETE", `/api/conversations/${reply.conversationId}`).catch(() => undefined);
    return `erstes Wort nach ${first ? `${(first / 1000).toFixed(1)} s` : "–"} · „${reply.text.slice(0, 40)}“`;
  });
}

if (withCron) {
  await check("Cron-Takt", async () => {
    if (!cronSecret) throw new Error("CRON_SECRET nicht gesetzt");
    const { res } = await call("GET", "/api/cron/tick", { auth: false, headers: { authorization: `Bearer ${cronSecret}` }, timeoutMs: 60_000 });
    if (res.status === 401) throw new Error("CRON_SECRET passt nicht (401)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    return `${r.fired} Erinnerung(en) ausgelöst`;
  });
}

await call("POST", "/api/logout").catch(() => undefined);
print();
process.exit(results.every((r) => r.ok) ? 0 : 1);

function print() {
  const w = Math.max(...results.map((r) => r.name.length));
  console.log(`\nJARVIS Live-Check · ${origin}\n`);
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name.padEnd(w)}  ${String(r.ms).padStart(6)} ms  ${r.note}`);
  const failed = results.filter((r) => !r.ok).length;
  const slow = results.filter((r) => r.ok && r.ms > SLOW_MS).length;
  console.log(`\n${failed ? `✗ ${failed} Prüfung(en) fehlgeschlagen` : "✓ Alles in Ordnung"}${slow ? ` · ${slow} langsam (> ${SLOW_MS / 1000} s)` : ""}\n`);
}
