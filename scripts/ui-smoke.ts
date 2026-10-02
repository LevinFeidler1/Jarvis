/**
 * UI smoke test — the real server (in-memory Postgres, fake mail/calendar,
 * scripted model) plus headless Chrome. Logs in through the login form, opens
 * every view on phone and desktop width, plays one voice turn and one chat
 * turn, and fails on
 *   · JavaScript errors (pageerror / console.error),
 *   · API answers 404 or ≥ 500 (UI and API out of sync),
 *   · a view that fell into the generic error state,
 *   · horizontal overflow (the page scrolls sideways on a phone).
 *
 *   npm run test:ui                     # CHROME_PATH=/path/to/chrome to override
 *   npm run test:ui -- --shots shots/   # also save a screenshot per view
 *
 * No network access, no API keys, nothing leaves the machine.
 */
process.env.LOG_LEVEL ??= "warn";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import type { LlmRequest } from "../src/core/llm.js";
import { nowIso } from "../src/db/database.js";
import { saveLifeSettings } from "../src/life/settings.js";
import type { NewsService } from "../src/life/news.js";
import type { Weather, WeatherService } from "../src/life/weather.js";
import { createServer } from "../src/server.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { harness, makeEmail, message, text, toolUse } from "../tests/helpers.js";

const VIEWS = ["jarvis", "today", "chat", "calendar", "email", "tasks", "notes", "finance", "contacts", "files", "automations", "activity", "review", "memory", "settings"];
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1366, height: 860, mobile: false },
];
const shotsDir = (() => {
  const i = process.argv.indexOf("--shots");
  return i > 0 ? process.argv[i + 1] : undefined;
})();

function chromePath(): string {
  const candidates = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("Kein Chrome/Chromium gefunden — CHROME_PATH setzen.");
  return found;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

// ─── Fixtures (relative to now, so "today" always has something) ───────────
const now = new Date();
const at = (h: number, m = 0, dayOffset = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const soon = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();

const place = { name: "Hamburg", lat: 53.55, lon: 9.99, region: "Hamburg", country: "Deutschland" };
const weather: Weather = {
  place,
  now: { temperature: 14, feelsLike: 12, code: 2, text: "Teilweise bewölkt", icon: "partly", windKmh: 18, precipitationMm: 0, isDay: true } as Weather["now"],
  hours: Array.from({ length: 24 }, (_, i) => ({ time: soon(i * 60), temperature: 14 - Math.floor(i / 6), precipitationProbability: i === 3 ? 80 : 10, code: i === 3 ? 61 : 2, icon: i === 3 ? "rain" : "partly" })),
  days: [0, 1, 2].map((d) => ({ date: at(12, 0, d).slice(0, 10), min: 9 + d, max: 17 - d, code: 1, text: "Heiter", icon: d === 1 ? "rain" : "sun", precipitationProbability: d === 1 ? 70 : 10 })),
  hint: "Regen wahrscheinlich in drei Stunden — Schirm einpacken.",
  source: "Open-Meteo",
};

/** Scripted model: first a tool call (so a context card appears), then a streamed answer. */
function modelTurn(req: LlmRequest) {
  const last = req.messages.at(-1);
  const answered = Array.isArray(last?.content) && last.content.some((b) => (b as { type: string }).type === "tool_result");
  if (!answered) return message([toolUse("get_weather", {})], "tool_use");
  return message([text("In Hamburg sind es gerade 14 Grad und teilweise bewölkt. In etwa drei Stunden kommt Regen — nimm einen Schirm mit. Morgen wird es kühler.")]);
}

async function start() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const h = await harness(Array.from({ length: 200 }, () => modelTurn), {
    now,
    config: { publicUrl: url },
    events: [
      { id: "e1", title: "Abstimmung Relaunch", start: soon(45), end: soon(105), allDay: false, attendees: [{ name: "Anna Müller", email: "anna@example.com" }], status: "confirmed", busy: true, location: "Speicherstadt, Hamburg" },
      { id: "e2", title: "Gitarre", start: soon(180), end: soon(240), allDay: false, attendees: [], status: "confirmed", busy: true },
      { id: "e3", title: "Workshop", start: at(10, 0, 2), end: at(12, 0, 2), allDay: false, attendees: [], status: "confirmed", busy: true },
    ],
    emails: [1, 2, 3].map((i) => makeEmail({ id: `m${i}`, subject: `Relaunch Feedback ${i}`, from: { name: "Anna Müller", email: "anna@example.com" }, unread: true, date: soon(-60 * i) })),
    contacts: [{ id: "people/1", name: "Anna Müller", emails: ["anna@example.com"], phones: ["+49 40 123456"], source: "contacts" }],
  });
  h.providers.weather = { forecast: async () => weather, geocode: async () => place } as unknown as WeatherService;
  h.providers.news = {
    headlines: async () => ({
      items: [
        { title: "Elbtunnel am Wochenende gesperrt", link: "https://www.ndr.de/a", source: "NDR Hamburg", topic: "Hamburg" },
        { title: "Neues Smartphone im Test: Akku hält zwei Tage", link: "https://www.heise.de/b", source: "heise online", topic: "Technik" },
      ],
      failed: [],
    }),
  } as unknown as NewsService;
  await saveLifeSettings(h.db, { home: place, budgetUsd: 20 });
  await h.db.run(
    `INSERT INTO llm_usage (ts, model, conversation_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, compacted, cost_usd)
     VALUES ($1, 'claude-sonnet-5-5', NULL, 1000, 200, 0, 0, 0, FALSE, 16.4)`,
    [nowIso()],
  );
  await h.providers.tasks.create({ title: "Angebot an Anna schicken", due: at(17), priority: "high" });
  await h.providers.notes.addToList("Einkaufsliste", ["Milch", "Brot", "Kaffeebohnen"]);
  await h.providers.notes.addNote({ title: "Geschenkideen", body: "Mama: Kochbuch\nPapa: Kopfhörer", pinned: true });
  await h.providers.finance.add({ kind: "invoice", vendor: "Vodafone", amountCents: 4999, dueDate: at(12, 0, 3).slice(0, 10) });
  await h.providers.finance.add({ kind: "subscription", vendor: "Spotify", amountCents: 1099, interval: "monthly" });

  // Something to decide on the home screen: one suggestion from a mail, one action waiting for approval.
  await h.db.run(
    `INSERT INTO suggestions (id, kind, title, body, email_id, account, sender, actions_json, accept_label, edit_prompt, warning, status, created_at)
     VALUES ($1, 'meeting', 'Anna fragt nach einem Termin am Donnerstag', 'Vorschlag: Donnerstag 14:00–15:00 ist frei.', 'm1', NULL, 'anna@example.com', '[]', NULL, 'Antworte Anna wegen Donnerstag.', NULL, 'open', $2)`,
    [randomUUID(), nowIso()],
  );
  const conv = await h.agent.conversations.create("Smoke");
  const act = await h.agent.activity.create({ conversationId: conv.id, toolName: "send_email", description: "E-Mail an anna@example.com senden\nBetreff: Angebot", risk: 2, status: "awaiting_confirmation" });
  await h.agent.confirmations.create({ conversationId: conv.id, activityId: act.id, toolName: "send_email", input: { to: ["anna@example.com"], subject: "Angebot", body: "Hallo Anna, anbei das Angebot." }, description: "E-Mail an anna@example.com senden\nBetreff: Angebot", risk: 2, reasons: ["Externe Kommunikation"] }, now);

  const app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), scheduler: h.scheduler, llmConfigured: true });
  await app.listen({ port, host: "127.0.0.1" });
  return { app, url, token: h.config.accessToken };
}

// ─── Checks ────────────────────────────────────────────────────────────────
const failures: string[] = [];
const fail = (where: string, what: string) => failures.push(`${where}: ${what}`);

const OVERFLOW_JS = `(() => {
  const W = document.documentElement.clientWidth;
  const out = [];
  if (document.documentElement.scrollWidth > W + 1) out.push("Seite " + document.documentElement.scrollWidth + "px > " + W + "px");
  for (const el of document.querySelectorAll("#main, .jv-scroll, .view")) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) out.push((el.id ? "#" + el.id : "." + el.className.split(" ")[0]) + " " + el.scrollWidth + "px > " + el.clientWidth + "px");
  }
  return out;
})()`;
const ERROR_VIEW_JS = `(() => { const v = document.querySelector("#main > .view"); return v && v.children.length === 1 && v.firstElementChild.classList.contains("empty") ? v.textContent : null; })()`;

/** Polls an expression from Node — page.waitForFunction would need 'unsafe-eval', which the app's CSP (rightly) forbids. */
async function waitFor(page: Page, expr: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(expr).catch(() => false)) return;
    if (Date.now() > until) throw new Error(`Zeitüberschreitung nach ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function checkView(page: Page, label: string) {
  const overflow = (await page.evaluate(OVERFLOW_JS)) as string[];
  for (const o of overflow) fail(label, `horizontaler Überlauf: ${o}`);
  const error = (await page.evaluate(ERROR_VIEW_JS)) as string | null;
  if (error) fail(label, `Ansicht zeigt Fehler: ${error}`);
}

async function run() {
  const { app, url, token } = await start();
  const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: "dark", locale: "de-DE", timezoneId: "Europe/Berlin" });
      const page = await ctx.newPage();
      let where = `${vp.name}/login`;
      page.on("pageerror", (e) => fail(where, `JS-Fehler: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        // Resource errors are reported via "response" below with the URL.
        if (/Failed to load resource/.test(m.text())) return;
        fail(where, `console.error: ${m.text()}`);
      });
      page.on("response", (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/api/") && (r.status() === 404 || r.status() >= 500)) fail(where, `${r.request().method()} ${u.pathname} → ${r.status()}`);
      });
      // Speech: no audio device in CI — finish every utterance after a moment.
      await page.addInitScript(`try { sessionStorage.setItem("jarvis-booted", "1"); } catch {}
        if (window.speechSynthesis) window.speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 300);`);

      await page.goto(url);
      await page.fill("#token", token);
      await page.click("button[type=submit]");
      await page.waitForSelector("#main", { timeout: 10_000 });

      for (const view of VIEWS) {
        where = `${vp.name}/${view}`;
        await page.goto(`${url}/#${view}`);
        await page.waitForTimeout(view === "jarvis" ? 1500 : 700);
        await waitFor(page, `!document.querySelector("#main .spinner")`, 8_000).catch(() => fail(where, "lädt nach 8 s immer noch"));
        await checkView(page, where);
        if (view === "jarvis") {
          for (const [sel, what] of [[".wd-day .ring-svg", "Tagesring-Widget"], [".wd-pending .confirm", "offene Bestätigung"], [".wd-sugg", "Mail-Vorschlag"], [".wd-cost", "Kosten-Widget"]]) {
            await waitFor(page, `!!document.querySelector(${JSON.stringify(sel)})`, 6_000).catch(() => fail(where, `${what} fehlt`));
          }
        }
        if (shotsDir) {
          mkdirSync(shotsDir, { recursive: true });
          await page.screenshot({ path: join(shotsDir, `${vp.name}-${view}.png`) });
          // Second picture further down where the new parts live.
          const below = { jarvis: ".jv-widgets", settings: "#cost-section" }[view as "jarvis" | "settings"];
          if (below) {
            await page.evaluate(`document.querySelector(${JSON.stringify(below)})?.scrollIntoView({ block: "start" })`);
            await page.waitForTimeout(900);
            await page.screenshot({ path: join(shotsDir, `${vp.name}-${view}-2.png`) });
          }
        }
      }

      // Quick start (#jarvis?listen) without microphone permission: asks for one tap, hash cleaned up.
      where = `${vp.name}/quickstart`;
      await page.goto(`${url}/#jarvis?listen`);
      await waitFor(page, `/TIPPEN ZUM SPRECHEN/.test(document.querySelector(".jv-status")?.textContent ?? "") && location.hash === "#jarvis"`, 6_000).catch(() => fail(where, "kein „Tippen zum Sprechen“"));

      // Voice turn on the home screen: streamed reply → caption + weather card.
      where = `${vp.name}/voice`;
      await page.goto(`${url}/#jarvis`);
      await page.waitForTimeout(800);
      await page.click(".jv-chip >> nth=0");
      await page.waitForSelector(".jc-wrap", { timeout: 10_000 }).catch(() => fail(where, "keine Kontextkarte erschienen"));
      await waitFor(page, `/Schirm/.test(document.querySelector(".jv-caption")?.textContent ?? "")`, 15_000).catch(() => fail(where, "Antwort nicht als Untertitel gesprochen"));
      await checkView(page, where);
      if (shotsDir) await page.waitForTimeout(1500).then(() => page.screenshot({ path: join(shotsDir, `${vp.name}-voice.png`) }));

      // Chat turn: live text, then the final answer.
      where = `${vp.name}/chat-turn`;
      await page.goto(`${url}/#chat`);
      await page.waitForSelector("#chat-input");
      await page.fill("#chat-input", "Wie wird das Wetter?");
      await page.keyboard.press("Enter");
      await waitFor(page, `[...document.querySelectorAll("#thread .msg.assistant")].some((e) => /Schirm/.test(e.textContent))`, 15_000).catch(async (err) => {
        const seen = await page.evaluate(`[...document.querySelectorAll("#thread .msg")].map((e) => e.className + ": " + e.textContent.slice(0, 60)).join(" | ")`).catch(() => "?");
        fail(where, `keine Antwort im Chat (${(err as Error).message.split("\n")[0]}) — sichtbar: ${seen}`);
      });
      await checkView(page, where);
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `${vp.name}-chat-turn.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
    await app.close();
  }
}

run()
  .then(() => {
    if (failures.length) {
      console.error(`✗ UI-Smoke-Test: ${failures.length} Problem(e)\n  ${[...new Set(failures)].join("\n  ")}`);
      process.exit(1);
    }
    console.log(`✓ UI-Smoke-Test: ${VIEWS.length} Ansichten × ${VIEWPORTS.length} Breiten, Sprach- und Chat-Durchlauf ohne Fehler.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("✗ UI-Smoke-Test abgebrochen:", err);
    process.exit(1);
  });
