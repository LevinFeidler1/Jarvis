import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { waitUntil } from "@vercel/functions";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Agent, AgentEvent, AgentReply } from "./core/agent.js";
import { toView } from "./core/agent.js";
import { DEFAULT_PERMISSION_SETTINGS, loadPermissionSettings, savePermissionSettings } from "./core/permissions.js";
import type { Scheduler } from "./core/scheduler.js";
import { addDaysYmd, localDate, zonedToUtc } from "./core/time.js";
import { RISK_LABELS, ToolError } from "./core/types.js";
import { type Db, isTransientDbError, withTimeout } from "./db/database.js";
import { MEMORY_CATEGORIES, type MemoryStore } from "./memory/memory.js";
import { AUTOMATION_TEMPLATES, type Automation, type AutomationInput, AutomationRunner, describeTrigger } from "./core/automations.js";
import { buildWeekReview } from "./core/review.js";
import { KIND_LABEL, TriageService } from "./core/triage.js";
import { allowlistableTools } from "./core/autonomy.js";
import { automationTriggerSchema } from "./tools/automation.js";
import { ACCEPTED_EXTENSIONS } from "./files/formats/detect.js";
import { DOWNLOAD_RANGE_BYTES, UPLOAD_CHUNK_BYTES } from "./files/service.js";
import { CombinedContacts } from "./providers/combined-contacts.js";
import { parseVCards, toVCards } from "./providers/local/vcard.js";
import { MAIL_PRESETS } from "./providers/imap/accounts.js";
import { ImapEmailProvider } from "./providers/imap/imap.js";
import { MultiAccountEmail } from "./providers/multi-email.js";
import type { ProviderHub } from "./providers/hub.js";
import { safeEqual } from "./security/crypto.js";
import { SessionStore } from "./security/sessions.js";
import type { ToolRegistry } from "./tools/registry.js";
import { type TelegramBot, checkTelegramSecret, telegramWebhookSecret } from "./telegram/bot.js";
import type { TgUpdate } from "./telegram/api.js";
import { OpenAiCompatibleTranscriber, type Transcriber } from "./telegram/transcribe.js";
import { ElevenLabsSynth, type SpeechSynth, TtsQuotaError } from "./voice/tts.js";

const SESSION_COOKIE = "jarvis_session";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface ServerDeps {
  config: AppConfig;
  db: Db;
  agent: Agent;
  providers: ProviderHub;
  memory: MemoryStore;
  registry: ToolRegistry;
  scheduler: Scheduler;
  llmConfigured: boolean;
  /** Mail triage / suggestions (created with a no-op classifier when omitted). */
  triage?: TriageService;
  /** Telegram bot (only when TELEGRAM_BOT_TOKEN is set). */
  telegram?: TelegramBot;
  /** Voice mode overrides (tests). Default: from config. */
  transcriber?: Transcriber;
  synth?: SpeechSynth;
  /** Serve public/ from Fastify (local). On Vercel the CDN serves it. */
  serveStatic?: boolean;
  /** Overrides of the request time limits (tests). */
  timeouts?: Partial<typeof REQUEST_TIMEOUTS>;
}

declare module "fastify" {
  interface FastifyRequest {
    session?: { csrfToken: string };
  }
  interface FastifyContextConfig {
    /** Time limit for this route in ms (default REQUEST_TIMEOUTS.default). */
    timeoutMs?: number;
  }
}

/**
 * No request may hang until Vercel kills it (504 after maxDuration). Normal API
 * routes answer 503 after 25 s; calls to external voice services get 45 s; only
 * agent/LLM routes and cron run long — and even they stop cleanly before the
 * 300 s function limit of api/agent.ts.
 */
export const REQUEST_TIMEOUTS = {
  default: 25_000,
  external: 45_000,
  agent: 270_000,
  /** Reminders fired opportunistically in the background (Vercel). */
  backgroundTick: 10_000,
};
const TIMEOUT_MESSAGE = "Zeitüberschreitung — der Server war zu langsam. Bitte gleich noch einmal versuchen.";

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; " +
  "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, db, agent, providers, memory, registry, scheduler } = deps;
  const sessions = new SessionStore(db);
  const secureCookie = config.publicUrl.startsWith("https://");
  const allowedOrigin = new URL(config.publicUrl).origin;
  const limits = { ...REQUEST_TIMEOUTS, ...deps.timeouts };
  const AGENT_ROUTE = { timeoutMs: limits.agent };
  const EXTERNAL_ROUTE = { timeoutMs: limits.external };

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.cookie", "req.headers['x-jarvis-csrf']", "req.headers.authorization"] },
    bodyLimit: 256 * 1024,
    trustProxy: !!process.env.VERCEL,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  // ─── Request time limit ───────────────────────────────────────────────
  // Answer 503 instead of hanging; the handler's late result is discarded.
  app.addHook("onRequest", async (req, reply) => {
    const ms = req.routeOptions.config?.timeoutMs ?? limits.default;
    if (!ms || !req.url.startsWith("/api/")) return;
    const timer = setTimeout(() => {
      if (reply.sent || reply.raw.headersSent) return;
      app.log.warn({ url: req.url.split("?")[0], ms }, "request timed out");
      reply.code(503).header("retry-after", "5").send({ error: TIMEOUT_MESSAGE, code: "TIMEOUT" });
    }, ms);
    timer.unref?.();
    const clear = () => clearTimeout(timer);
    reply.raw.once("finish", clear);
    reply.raw.once("close", clear);
  });

  app.addHook("onSend", async (_req, reply, payload) => {
    if (!reply.hasHeader("Content-Security-Policy")) reply.header("Content-Security-Policy", CSP);
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    if (secureCookie) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return payload;
  });

  // ─── Auth + CSRF ──────────────────────────────────────────────────────
  // The OAuth callback arrives as a cross-site navigation (SameSite=Strict cookie is not sent);
  // it is protected by the single-use, unguessable state + PKCE verifier instead.
  // The cron endpoint authenticates with CRON_SECRET, the Telegram webhook with its secret header.
  const PUBLIC_API = new Set(["/api/login", "/api/session", "/api/integrations/google/callback", "/api/cron/tick", "/api/health", "/api/telegram"]);
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") || PUBLIC_API.has(path)) return;
    const session = await sessions.get(req.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "Nicht angemeldet" });
    req.session = session;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin && origin !== allowedOrigin) return reply.code(403).send({ error: "Ungültiger Origin" });
      const csrf = req.headers["x-jarvis-csrf"];
      if (typeof csrf !== "string" || !safeEqual(csrf, session.csrfToken)) {
        return reply.code(403).send({ error: "CSRF-Token fehlt oder ist ungültig" });
      }
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: "Ungültige Eingabe", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    if (err instanceof ToolError) {
      const code = err.code === "NOT_CONFIGURED" ? 409 : err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_INPUT" ? 400 : 502;
      return reply.code(code).send({ error: err.message, code: err.code });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    if (isTransientDbError(err)) {
      app.log.warn({ err: err.message }, "transient database error");
      return reply.code(503).header("retry-after", "5").send({ error: "Die Datenbank antwortet gerade nicht. Bitte gleich noch einmal versuchen.", code: "DB_UNAVAILABLE" });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Interner Fehler" });
  });

  if (deps.serveStatic !== false && existsSync(PUBLIC_DIR)) {
    // Lazy import: on Vercel (serveStatic: false) the CDN serves files and
    // @fastify/static (CJS requiring ESM-only content-disposition) must not load.
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/", index: ["index.html"] });
  }

  /**
   * Streams agent progress as NDJSON: {"type":"action",…} lines while tools run,
   * then one {"type":"reply",…} line (or {"type":"error"}).
   */
  async function streamAgent(reply: FastifyReply, work: (emit: (e: AgentEvent) => void) => Promise<AgentReply>) {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    });
    let ended = false;
    const write = (obj: unknown) => { if (!ended && !raw.writableEnded) raw.write(`${JSON.stringify(obj)}\n`); };
    try {
      // Stop cleanly before the platform kills the function (otherwise: 504 without a message).
      const result = await withTimeout(work((e) => write(e)), limits.agent, "Die Anfrage hat zu lange gedauert.");
      write({ type: "reply", reply: result });
    } catch (err) {
      if (isTransientDbError(err)) app.log.warn({ err: (err as Error).message }, "agent stream aborted");
      else app.log.error(err);
      write({
        type: "error",
        error: isTransientDbError(err)
          ? "Das hat zu lange gedauert oder die Datenbank war nicht erreichbar. Bereits erledigte Schritte siehst du unter Aktivität; Unbestätigtes wurde nicht ausgeführt."
          : "Bei der Verarbeitung ist ein Fehler aufgetreten. Es wurde nichts Unbestätigtes ausgeführt.",
      });
    }
    ended = true;
    raw.end();
  }

  // ─── Session ──────────────────────────────────────────────────────────
  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(1).max(512) }).parse(req.body);
    if (!safeEqual(token, config.accessToken)) return reply.code(401).send({ error: "Ungültiges Zugangstoken" });
    const s = await sessions.create();
    reply.setCookie(SESSION_COOKIE, s.sessionId, { httpOnly: true, sameSite: "strict", secure: secureCookie, path: "/", maxAge: SessionStore.ttlSeconds });
    return { authenticated: true, csrfToken: s.csrfToken };
  });

  app.get("/api/session", async (req) => {
    const s = await sessions.get(req.cookies[SESSION_COOKIE]);
    return s ? { authenticated: true, csrfToken: s.csrfToken, userName: config.userName ?? null } : { authenticated: false };
  });

  app.post("/api/logout", async (req, reply) => {
    await sessions.destroy(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // ─── Setup / onboarding ───────────────────────────────────────────────
  app.get("/api/setup", async () => {
    const integrations = await providers.status();
    const google = integrations.find((i) => i.id === "google")!;
    const imapCount = (await providers.emailAccounts.list()).length;
    const mailDone = google.state === "connected" || imapCount > 0;
    const prefs = (await memory.list("preference")).length;
    const permsSaved = (await db.one("SELECT 1 AS x FROM settings WHERE key = 'permissions'")) !== undefined;
    const steps = [
      { id: "llm", title: "Sprachmodell (Claude API)", done: deps.llmConfigured, hint: deps.llmConfigured ? `Modell: ${config.model}` : "ANTHROPIC_API_KEY setzen und neu deployen." },
      { id: "email", title: "E-Mail verbinden", done: mailDone, hint: mailDone ? `${imapCount + (google.state === "connected" ? 1 : 0)} Postfach/Postfächer verbunden` : "Gmail über Google, 1&1/All-Inkl über Einstellungen → E-Mail-Konten" },
      { id: "calendar", title: "Kalender verbinden", done: google.state === "connected", hint: google.detail },
      { id: "contacts", title: "Kontakte verbinden", done: google.state === "connected", hint: google.detail },
      { id: "permissions", title: "Berechtigungen prüfen", done: permsSaved, hint: "Einstellungen → Berechtigungen" },
      { id: "memory", title: "Präferenzen hinterlegen", done: prefs > 0, hint: "z.B. Arbeitszeiten, Meetingdauer, Signatur (Gedächtnis)" },
    ];
    return { steps, complete: steps.every((s) => s.done) };
  });

  // ─── Briefing (dashboard) ─────────────────────────────────────────────
  app.get("/api/briefing", async () => {
    const tz = config.timezone;
    const today = localDate(new Date(), tz);
    const dayStart = zonedToUtc(today, "00:00", tz).toISOString();
    const dayEnd = zonedToUtc(addDaysYmd(today, 1), "00:00", tz).toISOString();
    const settle = async <T>(fn: () => Promise<T>) => {
      try {
        return { ok: true as const, data: await fn() };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err), code: err instanceof ToolError ? err.code : undefined };
      }
    };
    const [events, emails, tasks, reminders, pending] = await Promise.all([
      settle(async () => (await providers.calendar()).listEvents({ timeMin: dayStart, timeMax: dayEnd })),
      settle(async () => (await providers.email()).listEmails({ inboxOnly: true, unreadOnly: true, maxResults: 8 })),
      settle(() => providers.tasks.list({ status: "open" })),
      settle(() => providers.reminders.list("scheduled")),
      settle(async () => (await agent.confirmations.listPending()).map(toView)),
    ]);
    return { date: today, timezone: tz, userName: config.userName ?? null, events, emails, tasks, reminders, pending };
  });

  // ─── Chat ─────────────────────────────────────────────────────────────
  const idParam = z.object({ id: z.uuid() });
  const chatBody = z.object({
    conversationId: z.uuid().optional(),
    message: z.string().trim().max(8000),
    attachments: z.array(z.uuid()).max(10).optional(),
    /** Sent by the voice home: the answer is read aloud (short, low effort). */
    voice: z.boolean().optional(),
  }).refine((b) => b.message.length > 0 || (b.attachments?.length ?? 0) > 0, { message: "Nachricht oder Anhang erforderlich" });
  const chatOpts = async (b: z.infer<typeof chatBody>) => ({
    ...(b.attachments?.length ? { attachments: await Promise.all(b.attachments.map((fid) => providers.files.get(fid))) } : {}),
    ...(b.voice ? { voice: true } : {}),
  });

  app.post("/api/chat", { config: { rateLimit: { max: 30, timeWindow: "1 minute" }, ...AGENT_ROUTE } }, async (req) => {
    const body = chatBody.parse(req.body);
    return agent.handleUserMessage(body.conversationId, body.message, undefined, await chatOpts(body));
  });

  app.post("/api/chat/stream", { config: { rateLimit: { max: 30, timeWindow: "1 minute" }, ...AGENT_ROUTE } }, async (req, reply) => {
    const body = chatBody.parse(req.body);
    const opts = await chatOpts(body);
    await streamAgent(reply, (emit) => agent.handleUserMessage(body.conversationId, body.message, emit, opts));
  });

  // ─── Files (Phase A) ──────────────────────────────────────────────────
  const files = providers.files;
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: UPLOAD_CHUNK_BYTES + 1024 }, (_req, body, done) => done(null, body));
  app.get("/api/files", async (req) => {
    const { q } = z.object({ q: z.string().trim().max(200).optional() }).parse(req.query);
    return {
      files: await files.list({ query: q || undefined, limit: 200 }),
      limits: { maxBytes: files.limits.maxBytes, dbQuotaBytes: files.limits.dbQuotaBytes, dbUsedBytes: await files.dbUsage() },
      storage: (await files.defaultStorage()).kind,
      accept: ACCEPTED_EXTENSIONS,
    };
  });
  app.get("/api/files/:id", async (req) => {
    const f = await files.get(idParam.parse(req.params).id);
    return { file: f, versions: await files.versions(f.rootId) };
  });
  app.get("/api/files/:id/preview", { config: EXTERNAL_ROUTE }, async (req) => {
    const { id } = idParam.parse(req.params);
    const f = await files.get(id);
    if (f.format === "png" || f.format === "jpg") return { file: f, text: null };
    const { extracted } = await files.extract(id);
    return { file: f, text: extracted.text.slice(0, 6000), truncated: extracted.text.length > 6000, sheets: extracted.sheets ?? null, needsVision: !!extracted.needsVision };
  });
  // Ranged download: every response stays below Vercel's 4.5 MB limit; the UI joins the parts.
  app.get("/api/files/:id/content", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const f = await files.get(id);
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(f.size - 1, range?.[2] ? Number(range[2]) : start + DOWNLOAD_RANGE_BYTES - 1, start + DOWNLOAD_RANGE_BYTES - 1);
    if (start >= f.size || end < start) return reply.code(416).header("content-range", `bytes */${f.size}`).send();
    const { data } = start === 0 && end === f.size - 1 ? await files.read(id) : await files.readRange(id, start, end);
    const ascii = f.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    reply
      .header("content-type", f.mime)
      .header("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header("content-security-policy", "sandbox; default-src 'none'")
      .header("cache-control", "private, no-store")
      .header("accept-ranges", "bytes")
      .header("x-file-size", String(f.size));
    if (start > 0 || end < f.size - 1) reply.code(206).header("content-range", `bytes ${start}-${end}/${f.size}`);
    return reply.send(data);
  });
  app.post("/api/files/uploads", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().positive() }).parse(req.body);
    return files.beginUpload(b.name, b.size);
  });
  app.put("/api/files/uploads/:id/:index", { bodyLimit: UPLOAD_CHUNK_BYTES + 1024 }, async (req) => {
    const p = z.object({ id: z.uuid(), index: z.coerce.number().int().min(0).max(100) }).parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw new ToolError("Upload-Teil muss application/octet-stream sein.", "INVALID_INPUT");
    await files.addChunk(p.id, p.index, req.body);
    return { ok: true };
  });
  app.post("/api/files/uploads/:id/complete", { config: EXTERNAL_ROUTE }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ conversationId: z.uuid().optional() }).parse(req.body ?? {});
    return files.completeUpload(id, { conversationId: b.conversationId ?? null });
  });
  app.delete("/api/files/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { all } = z.object({ all: z.enum(["0", "1"]).optional() }).parse(req.query);
    return { deleted: await files.delete(id, all === "1") };
  });

  app.get("/api/conversations", async () => agent.conversations.list());

  app.get("/api/conversations/:id/messages", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const conv = await agent.conversations.get(id);
    if (!conv) return reply.code(404).send({ error: "Nicht gefunden" });
    return {
      conversation: conv,
      messages: await agent.conversations.display(id),
      pendingActions: (await agent.confirmations.listPending(id)).map(toView),
    };
  });

  app.delete("/api/conversations/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return (await agent.conversations.delete(id)) ? { ok: true } : reply.code(404).send({ error: "Nicht gefunden" });
  });

  // ─── Confirmations & activity ─────────────────────────────────────────
  app.get("/api/confirmations", async () =>
    (await agent.confirmations.listPending()).map((p) => ({ ...toView(p), conversationId: p.conversationId, input: p.input })),
  );

  app.post("/api/confirmations/:id", { config: AGENT_ROUTE }, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { approve, stream } = z.object({ approve: z.boolean(), stream: z.boolean().optional() }).parse(req.body);
    if (!(await agent.confirmations.get(id))) return reply.code(404).send({ error: "Nicht gefunden" });
    if (stream) return streamAgent(reply, (emit) => agent.resolveConfirmation(id, approve, undefined, emit));
    return agent.resolveConfirmation(id, approve);
  });

  app.get("/api/activity", async () => agent.activity.list(200));
  app.get("/api/audit", async () => agent.audit.list(200));

  // ─── Memory ───────────────────────────────────────────────────────────
  const memoryInput = z.object({
    category: z.enum(MEMORY_CATEGORIES),
    key: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(2000),
  });
  app.get("/api/memory", async () => memory.list());
  app.post("/api/memory", async (req) => memory.upsert({ ...memoryInput.parse(req.body), source: "user" }));
  app.patch("/api/memory/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const updated = await memory.update(id, memoryInput.partial().parse(req.body));
    return updated ?? reply.code(404).send({ error: "Nicht gefunden" });
  });
  app.delete("/api/memory/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return (await memory.delete(id)) ? { ok: true } : reply.code(404).send({ error: "Nicht gefunden" });
  });

  // ─── Tasks, reminders, notifications (direct UI access) ───────────────
  app.get("/api/tasks", async (req) => {
    const { status } = z.object({ status: z.enum(["open", "done", "all"]).optional() }).parse(req.query);
    return providers.tasks.list({ status: status ?? "all" });
  });
  app.post("/api/tasks", async (req) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(300),
        due: z.iso.date().optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        project: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    return providers.tasks.create(body);
  });
  app.post("/api/tasks/:id/complete", async (req) => providers.tasks.complete(idParam.parse(req.params).id));
  app.post("/api/tasks/:id/reopen", async (req) => providers.tasks.reopen(idParam.parse(req.params).id));
  app.delete("/api/tasks/:id", async (req) => {
    await providers.tasks.delete(idParam.parse(req.params).id);
    return { ok: true };
  });
  // ─── Contacts (JARVIS-own; Google only searched) ──────────────────────
  const contactInput = z.object({
    name: z.string().trim().min(1).max(200),
    emails: z.array(z.email().max(320)).max(10).optional(),
    phones: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    organization: z.string().trim().max(200).optional(),
    role: z.string().trim().max(200).optional(),
    notes: z.string().max(2000).optional(),
  });
  const contactId = z.object({ id: z.string().regex(/^jarvis:[0-9a-f-]{36}$/) });
  app.get("/api/contacts", async (req) => {
    const { q } = z.object({ q: z.string().trim().max(200).optional() }).parse(req.query);
    const combined = await providers.contacts();
    const google = combined instanceof CombinedContacts && combined.hasGoogle;
    if (!q) return { contacts: await providers.localContacts.list(), google };
    const contacts = await combined.searchContacts(q, 50);
    return { contacts, google, warning: combined instanceof CombinedContacts ? combined.lastFailure : undefined };
  });
  app.post("/api/contacts", async (req) => providers.localContacts.createContact(contactInput.parse(req.body)));
  app.patch("/api/contacts/:id", async (req) =>
    providers.localContacts.updateContact(contactId.parse(req.params).id, contactInput.partial().parse(req.body)),
  );
  app.delete("/api/contacts/:id", async (req, reply) =>
    (await providers.localContacts.deleteContact(contactId.parse(req.params).id)) ? { ok: true } : reply.code(404).send({ error: "Nicht gefunden" }),
  );
  app.post("/api/contacts/import", { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const { vcf } = z.object({ vcf: z.string().min(1).max(4 * 1024 * 1024) }).parse(req.body);
    const parsed = parseVCards(vcf);
    if (parsed.length === 0) return reply.code(400).send({ error: "Keine Kontakte in der Datei gefunden (erwartet: vCard/.vcf)." });
    return providers.localContacts.importContacts(parsed);
  });
  app.get("/api/contacts/export", async (_req, reply) =>
    reply
      .header("content-type", "text/vcard; charset=utf-8")
      .header("content-disposition", 'attachment; filename="jarvis-kontakte.vcf"')
      .send(toVCards(await providers.localContacts.list())),
  );

  app.get("/api/reminders", async () => providers.reminders.list("all"));
  app.delete("/api/reminders/:id", async (req) => ({ ok: await providers.reminders.cancel(idParam.parse(req.params).id) }));

  // Serverless has no background loop. Due reminders are fired by /api/cron/tick and,
  // opportunistically, in the background after a UI poll — never inside the request.
  let lastBackgroundTick = 0;
  const backgroundTick = () => {
    if (!process.env.VERCEL || Date.now() - lastBackgroundTick < 60_000) return;
    lastBackgroundTick = Date.now();
    waitUntil(withTimeout(scheduler.tick(), limits.backgroundTick, "reminder tick timed out").catch((err) => app.log.warn({ err: (err as Error).message }, "reminder tick failed")));
  };
  app.get("/api/notifications", async () => {
    const list = await providers.notifications.list(false);
    backgroundTick();
    return list;
  });
  app.post("/api/notifications/:id/read", async (req) => {
    await providers.notifications.markRead(idParam.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/notifications/read-all", async () => {
    await providers.notifications.markAllRead();
    return { ok: true };
  });

  // ─── Cron (Vercel Cron / external scheduler) ──────────────────────────
  app.get("/api/cron/tick", { config: AGENT_ROUTE }, async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    if (!config.cronSecret || !safeEqual(auth, `Bearer ${config.cronSecret}`)) return reply.code(401).send({ error: "Unauthorized" });
    const now = new Date();
    const fired = await withTimeout(scheduler.tick(now), 20_000, "Erinnerungen nicht rechtzeitig verarbeitet.");
    const automations = scheduler.runAutomations(now).catch((err) => {
      app.log.error({ err }, "automations failed");
      return 0;
    });
    // External cron services give up after ~30 s; on Vercel the automations keep
    // running after the response (up to maxDuration), locally we simply wait.
    if (process.env.VERCEL) {
      waitUntil(automations);
      return { fired, automations: "started" };
    }
    return { fired, automations: await automations };
  });

  // ─── Voice mode ───────────────────────────────────────────────────────
  const transcriber = deps.transcriber ?? (config.transcribe ? new OpenAiCompatibleTranscriber(config.transcribe) : undefined);
  const synth = deps.synth ?? (config.elevenlabs ? new ElevenLabsSynth(config.elevenlabs) : undefined);
  let ttsBlockedUntil = 0;
  app.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: 4 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get("/api/voice/config", async () => ({
    stt: transcriber ? "server" : "browser",
    tts: synth && Date.now() > ttsBlockedUntil ? "server" : "browser",
  }));

  app.post("/api/voice/transcribe", { config: { rateLimit: { max: 40, timeWindow: "1 minute" }, ...EXTERNAL_ROUTE } }, async (req, reply) => {
    if (!transcriber) return reply.code(409).send({ error: "Spracherkennung ist nicht eingerichtet (TRANSCRIBE_API_KEY)." });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 800) return { text: "" };
    const mime = String(req.headers["content-type"] ?? "audio/webm").split(";")[0]!;
    const ext = mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
    const text = await transcriber.transcribe(body, `sprache.${ext}`, mime);
    return { text };
  });

  app.post("/api/voice/speak", { config: { rateLimit: { max: 60, timeWindow: "1 minute" }, ...EXTERNAL_ROUTE } }, async (req, reply) => {
    if (!synth || Date.now() < ttsBlockedUntil) return reply.code(409).send({ error: "Server-Stimme nicht verfügbar." });
    const { text } = z.object({ text: z.string().trim().min(1).max(600) }).parse(req.body);
    try {
      const { audio, mime } = await synth.speak(text);
      return reply.header("content-type", mime).header("cache-control", "no-store").send(audio);
    } catch (err) {
      if (err instanceof TtsQuotaError) ttsBlockedUntil = Date.now() + 30 * 60_000;
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  // ─── Telegram ─────────────────────────────────────────────────────────
  const telegram = deps.telegram;
  app.post("/api/telegram", { config: { rateLimit: { max: 120, timeWindow: "1 minute" }, ...AGENT_ROUTE } }, async (req, reply) => {
    if (!telegram) return reply.code(404).send({ error: "Telegram ist nicht eingerichtet" });
    if (!checkTelegramSecret(req.headers["x-telegram-bot-api-secret-token"], config.encryptionKey)) return reply.code(401).send({ error: "Unauthorized" });
    const update = req.body as TgUpdate;
    if (!update || typeof update !== "object" || typeof update.update_id !== "number") return { ok: true };
    const work = telegram.handleUpdate(update).catch((err) => {
      app.log.error({ err: (err as Error).message }, "telegram update failed");
      return "ignored" as const;
    });
    // Answer Telegram at once (it retries slow webhooks); on Vercel the agent keeps working after the response.
    if (process.env.VERCEL) {
      waitUntil(work);
      return { ok: true };
    }
    return { ok: true, result: await work };
  });

  app.get("/api/telegram/status", async () => {
    if (!telegram) return { configured: false, chatIdSet: !!config.telegram.chatId, transcription: !!config.transcribe };
    const api = telegram.api;
    const [me, hook] = await Promise.all([api.getMe().catch((e: Error) => ({ error: e.message })), api.getWebhookInfo().catch(() => undefined)]);
    const expected = `${config.publicUrl}/api/telegram`;
    return {
      configured: true,
      chatIdSet: !!config.telegram.chatId,
      transcription: !!config.transcribe,
      bot: "error" in me ? null : { username: me.username, name: me.first_name },
      error: "error" in me ? me.error : undefined,
      webhook: hook ? { active: hook.url === expected, pending: hook.pending_update_count, lastError: hook.last_error_message ?? null } : null,
      httpsReady: config.publicUrl.startsWith("https://"),
      settings: await telegram.settings(),
    };
  });

  app.post("/api/telegram/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (_req, reply) => {
    if (!telegram) return reply.code(409).send({ error: "TELEGRAM_BOT_TOKEN ist nicht gesetzt." });
    if (!config.publicUrl.startsWith("https://")) return reply.code(409).send({ error: "Telegram braucht eine öffentliche https-Adresse (JARVIS_PUBLIC_URL)." });
    const api = telegram.api;
    await api.setWebhook(`${config.publicUrl}/api/telegram`, telegramWebhookSecret(config.encryptionKey));
    const me = await api.getMe();
    return { ok: true, bot: { username: me.username, name: me.first_name } };
  });

  app.post("/api/telegram/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (_req, reply) => {
    if (!telegram || !config.telegram.chatId) return reply.code(409).send({ error: "TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID müssen gesetzt sein." });
    await telegram.api.sendMessage(config.telegram.chatId, "🔔 Test von JARVIS — Telegram ist verbunden.");
    return { ok: true };
  });

  app.put("/api/telegram/settings", async (req, reply) => {
    if (!telegram) return reply.code(409).send({ error: "Telegram ist nicht eingerichtet" });
    return telegram.saveSettings(z.object({ notifications: z.boolean() }).parse(req.body));
  });

  // ─── Push notifications ───────────────────────────────────────────────
  const pushSub = z.object({
    endpoint: z.url().max(2000),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  });
  app.get("/api/push", async () => ({ publicKey: await providers.push.publicKey(), devices: await providers.push.devices() }));
  app.post("/api/push/subscribe", async (req, reply) => {
    const body = z.object({ subscription: pushSub, label: z.string().trim().max(80).optional() }).parse(req.body);
    try {
      await providers.push.subscribe(body.subscription, body.label);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    return { ok: true };
  });
  app.post("/api/push/unsubscribe", async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
    return { ok: await providers.push.unsubscribe(endpoint) };
  });
  app.delete("/api/push/devices/:id", async (req) => ({ ok: await providers.push.removeDevice(idParam.parse(req.params).id) }));
  app.post("/api/push/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async () => {
    const r = await providers.notifications.notify("🔔 Test von JARVIS", "Push-Benachrichtigungen funktionieren auf diesem Gerät.", { url: "/#settings", tag: "push-test" });
    return { pushed: r.pushed ?? 0 };
  });

  // ─── Automations ──────────────────────────────────────────────────────
  const automationRunner = new AutomationRunner(providers.automations, agent, providers);
  const allowlistable = allowlistableTools(registry);
  const automationInput = z.object({
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(5).max(2000),
    trigger: automationTriggerSchema,
    enabled: z.boolean().optional(),
    allowedTools: z
      .array(z.string())
      .max(20)
      .refine((l) => l.every((n) => allowlistable.some((t) => t.name === n)), "Nur Stufe-2-Werkzeuge, die freigegeben werden dürfen")
      .optional(),
    dailyActionLimit: z.number().int().min(1).max(200).optional(),
  });
  const withText = (a: Automation) => ({ ...a, triggerText: describeTrigger(a.trigger) });
  const todayStart = () => zonedToUtc(localDate(new Date(), config.timezone), "00:00", config.timezone).toISOString();
  app.get("/api/automations", async () => ({
    automations: await Promise.all(
      (await providers.automations.list()).map(async (a) => ({ ...withText(a), autonomousToday: await agent.activity.countAutonomous(a.id, todayStart()) })),
    ),
    allowlistable,
    paused: await providers.automations.paused(),
    templates: AUTOMATION_TEMPLATES.map((t) => ({ ...t, triggerText: describeTrigger(t.trigger) })),
    pushDevices: (await providers.push.devices()).length,
    cronConfigured: !!config.cronSecret,
  }));
  app.post("/api/automations", async (req) => withText(await providers.automations.create(automationInput.parse(req.body) as AutomationInput)));
  app.patch("/api/automations/:id", async (req, reply) => {
    const a = await providers.automations.update(idParam.parse(req.params).id, automationInput.partial().parse(req.body) as Partial<AutomationInput>);
    return a ? withText(a) : reply.code(404).send({ error: "Nicht gefunden" });
  });
  app.delete("/api/automations/:id", async (req, reply) =>
    (await providers.automations.delete(idParam.parse(req.params).id)) ? { ok: true } : reply.code(404).send({ error: "Nicht gefunden" }),
  );
  app.put("/api/automations/pause", async (req) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
    return providers.automations.setPaused(paused);
  });
  app.post("/api/activity/:id/undo", { config: AGENT_ROUTE }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const u = await agent.activity.getUndo(id);
    if (!u) return reply.code(409).send({ error: "Für diese Aktion gibt es kein Rückgängig (mehr)." });
    const conv = u.conversationId ?? (await agent.conversations.create("Rückgängig")).id;
    const r = await agent.runApprovedAction(conv, u.undo.tool, u.undo.input, { actor: "rückgängig" });
    if (r.status !== "succeeded" && r.status !== "partially_succeeded") return reply.code(502).send({ error: r.error ?? "Rückgängig fehlgeschlagen", status: r.status });
    await agent.activity.markUndone(id);
    return { ok: true, label: u.undo.label };
  });
  app.post("/api/automations/:id/run", { config: { rateLimit: { max: 10, timeWindow: "1 minute" }, ...AGENT_ROUTE } }, async (req) =>
    automationRunner.runNow(idParam.parse(req.params).id),
  );

  // ─── Suggestions (Phase C) ────────────────────────────────────────────
  const triage = deps.triage ?? new TriageService({ db, config, providers, memory, agent, dailyLimit: config.triage.dailyLimit });
  const kindEnum = z.enum(["meeting", "lead", "invoice", "deadline", "reply", "newsletter"]);
  app.get("/api/suggestions", async () => ({ suggestions: await triage.list(), settings: await triage.settings(), usedToday: await triage.usageToday(), dailyLimit: config.triage.dailyLimit, labels: KIND_LABEL }));
  app.post("/api/suggestions/:id/accept", { config: AGENT_ROUTE }, async (req) => triage.accept(idParam.parse(req.params).id));
  app.post("/api/suggestions/:id/ignore", async (req) => triage.ignore(idParam.parse(req.params).id));
  app.post("/api/suggestions/:id/undo", async (req) => triage.undo(idParam.parse(req.params).id));
  app.post("/api/suggestions/check", { config: { rateLimit: { max: 4, timeWindow: "1 minute" }, ...AGENT_ROUTE } }, async () => triage.runTick());
  app.put("/api/settings/triage", async (req) => {
    const b = z.object({ enabled: z.boolean().optional(), autoTasks: z.boolean().optional() }).parse(req.body);
    return triage.saveSettings(b);
  });
  app.post("/api/settings/triage/unmute", async (req) => {
    const b = z.object({ kind: kindEnum, sender: z.string().max(320).optional() }).parse(req.body);
    return triage.unmute(b.kind, b.sender);
  });

  // ─── Weekly review ────────────────────────────────────────────────────
  app.get("/api/review", async (req) => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(-52).max(0).optional() }).parse(req.query);
    return buildWeekReview({ db: deps.db, providers, config }, offset ?? 0);
  });

  // ─── Calendar & email views (read-only, level 0) ──────────────────────
  app.get("/api/calendar", async (req) => {
    const q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).parse(req.query);
    return (await providers.calendar()).listEvents({ timeMin: q.from, timeMax: q.to });
  });
  app.get("/api/email", async (req) => {
    const q = z
      .object({ unread: z.enum(["true", "false"]).optional(), q: z.string().max(200).optional(), account: z.string().max(254).optional() })
      .parse(req.query);
    const provider = await providers.email();
    const query = { inboxOnly: true, unreadOnly: q.unread === "true", text: q.q, maxResults: 40, account: q.account || undefined };
    if (provider instanceof MultiAccountEmail) return provider.listAcrossAccounts(query);
    return { emails: await provider.listEmails(query), failures: [] };
  });
  app.get("/api/email/:id", async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(256) }).parse(req.params);
    return (await providers.email()).readEmail(id);
  });

  // ─── E-Mail-Konten (IMAP/SMTP) ────────────────────────────────────────
  app.get("/api/email-accounts", async () => {
    let gmail: string | null = null;
    if (providers.googleAuth) {
      const s = await providers.googleAuth.status();
      if (s.connected) gmail = (s.account ?? "gmail").toLowerCase();
    }
    return {
      presets: MAIL_PRESETS,
      accounts: await providers.emailAccounts.list(),
      gmail,
      defaultAccount: await providers.emailAccounts.getDefault(),
    };
  });

  const endpoint = z.object({ host: z.string().trim().min(3).max(253).regex(/^[A-Za-z0-9.-]+$/, "ungültiger Hostname"), port: z.number().int().min(1).max(65535), secure: z.boolean() });
  app.post("/api/email-accounts", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z
      .object({
        email: z.email().max(254),
        name: z.string().trim().max(100).optional(),
        preset: z.string().max(40),
        username: z.string().trim().min(1).max(254),
        password: z.string().min(1).max(512),
        imap: endpoint,
        smtp: endpoint,
      })
      .parse(req.body);
    const existing = await providers.emailAccounts.list();
    if (existing.some((a) => a.email === body.email.toLowerCase())) return reply.code(409).send({ error: "Dieses Postfach ist bereits verbunden." });
    // Verify IMAP login and SMTP before storing anything.
    try {
      await new ImapEmailProvider({ ...body, name: body.name ?? null, id: "test", createdAt: "" }).verify();
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Verbindung fehlgeschlagen" });
    }
    const acct = await providers.emailAccounts.add({ ...body, name: body.name || null });
    if (!(await providers.emailAccounts.getDefault()) && existing.length === 0) await providers.emailAccounts.setDefault(acct.email);
    return acct;
  });

  app.delete("/api/email-accounts/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return (await providers.emailAccounts.delete(id)) ? { ok: true } : reply.code(404).send({ error: "Nicht gefunden" });
  });

  app.put("/api/email-accounts/default", async (req) => {
    const { email } = z.object({ email: z.email().nullable() }).parse(req.body);
    await providers.emailAccounts.setDefault(email);
    return { ok: true };
  });

  // ─── Integrations ─────────────────────────────────────────────────────
  app.get("/api/integrations", async () => providers.status());

  app.get("/api/integrations/google/connect", async (_req, reply) => {
    if (!providers.googleAuth) return reply.code(409).send({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET fehlen. Siehe docs/SETUP_GOOGLE.md." });
    return reply.redirect(await providers.googleAuth.createAuthUrl());
  });

  app.get("/api/integrations/google/callback", async (req, reply) => {
    const q = z.object({ code: z.string().max(2048).optional(), state: z.string().max(256).optional(), error: z.string().max(200).optional() }).parse(req.query);
    if (!providers.googleAuth) return reply.code(409).send({ error: "Google ist nicht konfiguriert" });
    if (q.error || !q.code || !q.state) return reply.redirect(`/#settings?google=${encodeURIComponent(q.error ?? "abgebrochen")}`);
    try {
      await providers.googleAuth.handleCallback(q.code, q.state);
      return reply.redirect("/#settings?google=connected");
    } catch (err) {
      app.log.warn({ err }, "Google OAuth callback failed");
      return reply.redirect(`/#settings?google=${encodeURIComponent((err as Error).message)}`);
    }
  });

  app.post("/api/integrations/google/disconnect", async () => {
    await providers.googleAuth?.disconnect();
    return { ok: true };
  });

  // ─── Settings ─────────────────────────────────────────────────────────
  app.get("/api/settings/permissions", async () => ({
    settings: await loadPermissionSettings(db),
    defaults: DEFAULT_PERMISSION_SETTINGS,
    tools: registry
      .all()
      .map((t) => ({ name: t.name, category: t.category, risk: t.risk, riskLabel: RISK_LABELS[t.risk], description: t.description }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.risk - b.risk),
  }));

  app.put("/api/settings/permissions", async (req) => {
    const body = z
      .object({
        autoApproveLowRisk: z.record(z.enum(["email", "calendar", "contacts", "tasks", "reminders", "memory", "system", "web", "files"]), z.boolean()),
        disabledTools: z.array(z.string().max(100)).max(100),
      })
      .parse(req.body);
    const known = new Set(registry.all().map((t) => t.name));
    const settings = { autoApproveLowRisk: body.autoApproveLowRisk, disabledTools: body.disabledTools.filter((n) => known.has(n)) };
    await savePermissionSettings(db, settings);
    return { settings };
  });

  app.get("/api/status", async () => ({
    model: config.model,
    llmConfigured: deps.llmConfigured,
    timezone: config.timezone,
    database: config.databaseUrl ? "Postgres (Neon)" : "PGlite (lokal)",
    hosting: process.env.VERCEL ? "Vercel" : "lokal",
  }));

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith("/api/") || deps.serveStatic === false) return reply.code(404).send({ error: "Nicht gefunden" });
    return reply.sendFile("index.html");
  });

  return app;
}
