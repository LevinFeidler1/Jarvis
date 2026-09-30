import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
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
import type { Db } from "./db/database.js";
import { MEMORY_CATEGORIES, type MemoryStore } from "./memory/memory.js";
import { AUTOMATION_TEMPLATES, type Automation, type AutomationInput, AutomationRunner, describeTrigger } from "./core/automations.js";
import { buildWeekReview } from "./core/review.js";
import { automationTriggerSchema } from "./tools/automation.js";
import { CombinedContacts } from "./providers/combined-contacts.js";
import { parseVCards, toVCards } from "./providers/local/vcard.js";
import { MAIL_PRESETS } from "./providers/imap/accounts.js";
import { ImapEmailProvider } from "./providers/imap/imap.js";
import { MultiAccountEmail } from "./providers/multi-email.js";
import type { ProviderHub } from "./providers/hub.js";
import { safeEqual } from "./security/crypto.js";
import { SessionStore } from "./security/sessions.js";
import type { ToolRegistry } from "./tools/registry.js";

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
  /** Serve public/ from Fastify (local). On Vercel the CDN serves it. */
  serveStatic?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    session?: { csrfToken: string };
  }
}

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; " +
  "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, db, agent, providers, memory, registry, scheduler } = deps;
  const sessions = new SessionStore(db);
  const secureCookie = config.publicUrl.startsWith("https://");
  const allowedOrigin = new URL(config.publicUrl).origin;

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.cookie", "req.headers['x-jarvis-csrf']", "req.headers.authorization"] },
    bodyLimit: 256 * 1024,
    trustProxy: !!process.env.VERCEL,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Content-Security-Policy", CSP);
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
  // The cron endpoint authenticates with CRON_SECRET.
  const PUBLIC_API = new Set(["/api/login", "/api/session", "/api/integrations/google/callback", "/api/cron/tick", "/api/health"]);
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
    app.log.error(err);
    return reply.code(500).send({ error: "Interner Fehler" });
  });

  if (deps.serveStatic !== false && existsSync(PUBLIC_DIR)) {
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
    const write = (obj: unknown) => raw.write(`${JSON.stringify(obj)}\n`);
    try {
      const result = await work((e) => write(e));
      write({ type: "reply", reply: result });
    } catch (err) {
      app.log.error(err);
      write({ type: "error", error: "Bei der Verarbeitung ist ein Fehler aufgetreten. Es wurde nichts Unbestätigtes ausgeführt." });
    }
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
  const chatBody = z.object({ conversationId: z.uuid().optional(), message: z.string().trim().min(1).max(8000) });

  app.post("/api/chat", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = chatBody.parse(req.body);
    return agent.handleUserMessage(body.conversationId, body.message);
  });

  app.post("/api/chat/stream", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = chatBody.parse(req.body);
    await streamAgent(reply, (emit) => agent.handleUserMessage(body.conversationId, body.message, emit));
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

  app.post("/api/confirmations/:id", async (req, reply) => {
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
  const idParam = z.object({ id: z.uuid() });
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

  app.get("/api/notifications", async () => {
    // Serverless has no background loop: fire due reminders opportunistically.
    await scheduler.tick().catch((err) => app.log.warn({ err }, "reminder tick failed")); // reminders only; automations run via cron
    return providers.notifications.list(false);
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
  app.get("/api/cron/tick", async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    if (!config.cronSecret || !safeEqual(auth, `Bearer ${config.cronSecret}`)) return reply.code(401).send({ error: "Unauthorized" });
    const now = new Date();
    const fired = await scheduler.tick(now);
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
  const automationInput = z.object({
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(5).max(2000),
    trigger: automationTriggerSchema,
    enabled: z.boolean().optional(),
  });
  const withText = (a: Automation) => ({ ...a, triggerText: describeTrigger(a.trigger) });
  app.get("/api/automations", async () => ({
    automations: (await providers.automations.list()).map(withText),
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
  app.post("/api/automations/:id/run", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) =>
    automationRunner.runNow(idParam.parse(req.params).id),
  );

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
