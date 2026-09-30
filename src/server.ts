import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Agent } from "./core/agent.js";
import { toView } from "./core/agent.js";
import { DEFAULT_PERMISSION_SETTINGS, loadPermissionSettings, savePermissionSettings } from "./core/permissions.js";
import { RISK_LABELS, ToolError } from "./core/types.js";
import type { Db } from "./db/database.js";
import { MEMORY_CATEGORIES, type MemoryStore } from "./memory/memory.js";
import type { ProviderHub } from "./providers/hub.js";
import type { InAppNotificationProvider } from "./providers/local/local.js";
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
  llmConfigured: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    session?: { csrfToken: string };
  }
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, db, agent, providers, memory, registry } = deps;
  const sessions = new SessionStore(db);
  const secureCookie = config.publicUrl.startsWith("https://");
  const allowedOrigin = new URL(config.publicUrl).origin;

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.cookie", "req.headers['x-jarvis-csrf']"] }, bodyLimit: 256 * 1024 });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    return payload;
  });

  // ─── Auth + CSRF ──────────────────────────────────────────────────────
  // The OAuth callback arrives as a cross-site navigation (SameSite=Strict cookie is not sent);
  // it is protected by the single-use, unguessable state + PKCE verifier instead.
  const PUBLIC_API = new Set(["/api/login", "/api/session", "/api/integrations/google/callback"]);
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") || PUBLIC_API.has(path)) return;
    const session = sessions.get(req.cookies[SESSION_COOKIE]);
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
      const code = err.code === "NOT_CONFIGURED" ? 409 : err.code === "AUTH_FAILED" ? 502 : err.code === "NOT_FOUND" ? 404 : 502;
      return reply.code(code).send({ error: err.message, code: err.code });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "Interner Fehler" });
  });

  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/", index: ["index.html"] });

  // ─── Session ──────────────────────────────────────────────────────────
  app.post("/api/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(1).max(512) }).parse(req.body);
    if (!safeEqual(token, config.accessToken)) return reply.code(401).send({ error: "Ungültiges Zugangstoken" });
    const s = sessions.create();
    reply.setCookie(SESSION_COOKIE, s.sessionId, { httpOnly: true, sameSite: "strict", secure: secureCookie, path: "/", maxAge: 12 * 3600 });
    return { authenticated: true, csrfToken: s.csrfToken };
  });

  app.get("/api/session", async (req) => {
    const s = sessions.get(req.cookies[SESSION_COOKIE]);
    return s ? { authenticated: true, csrfToken: s.csrfToken } : { authenticated: false };
  });

  app.post("/api/logout", async (req, reply) => {
    sessions.destroy(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // ─── Setup / onboarding ───────────────────────────────────────────────
  app.get("/api/setup", async () => {
    const integrations = providers.status();
    const google = integrations.find((i) => i.id === "google")!;
    const prefs = memory.list("preference").length;
    const steps = [
      { id: "llm", title: "Sprachmodell (Claude API)", done: deps.llmConfigured, hint: deps.llmConfigured ? `Modell: ${config.model}` : "ANTHROPIC_API_KEY in .env setzen und neu starten." },
      { id: "email", title: "E-Mail verbinden", done: google.state === "connected", hint: google.detail },
      { id: "calendar", title: "Kalender verbinden", done: google.state === "connected", hint: google.detail },
      { id: "contacts", title: "Kontakte verbinden", done: google.state === "connected", hint: google.detail },
      { id: "permissions", title: "Berechtigungen prüfen", done: db.prepare("SELECT 1 FROM settings WHERE key = 'permissions'").get() !== undefined, hint: "Einstellungen → Berechtigungen" },
      { id: "memory", title: "Präferenzen hinterlegen", done: prefs > 0, hint: "z.B. Arbeitszeiten, Meetingdauer, Signatur (Gedächtnis)" },
    ];
    return { steps, complete: steps.every((s) => s.done) };
  });

  // ─── Chat ─────────────────────────────────────────────────────────────
  app.post("/api/chat", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({ conversationId: z.uuid().optional(), message: z.string().trim().min(1).max(8000) }).parse(req.body);
    return agent.handleUserMessage(body.conversationId, body.message);
  });

  app.get("/api/conversations", async () => agent.conversations.list());

  app.get("/api/conversations/:id/messages", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const conv = agent.conversations.get(id);
    if (!conv) return reply.code(404).send({ error: "Nicht gefunden" });
    return {
      conversation: conv,
      messages: agent.conversations.display(id),
      pendingActions: agent.confirmations.listPending(id).map(toView),
    };
  });

  // ─── Confirmations & activity ─────────────────────────────────────────
  app.get("/api/confirmations", async () =>
    agent.confirmations.listPending().map((p) => ({ ...toView(p), conversationId: p.conversationId, input: p.input })),
  );

  app.post("/api/confirmations/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    if (!agent.confirmations.get(id)) return reply.code(404).send({ error: "Nicht gefunden" });
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
    const updated = memory.update(id, memoryInput.partial().parse(req.body));
    return updated ?? reply.code(404).send({ error: "Nicht gefunden" });
  });
  app.delete("/api/memory/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return memory.delete(id) ? { ok: true } : reply.code(404).send({ error: "Nicht gefunden" });
  });

  // ─── Tasks, reminders, notifications (direct UI access) ───────────────
  app.get("/api/tasks", async (req) => {
    const { status } = z.object({ status: z.enum(["open", "done", "all"]).optional() }).parse(req.query);
    return providers.tasks.list({ status: status ?? "all" });
  });
  app.post("/api/tasks", async (req) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(300), due: z.string().max(40).optional(), priority: z.enum(["low", "normal", "high"]).optional() })
      .parse(req.body);
    return providers.tasks.create(body);
  });
  app.post("/api/tasks/:id/complete", async (req) => providers.tasks.complete(z.object({ id: z.uuid() }).parse(req.params).id));
  app.delete("/api/tasks/:id", async (req) => {
    await providers.tasks.delete(z.object({ id: z.uuid() }).parse(req.params).id);
    return { ok: true };
  });
  app.get("/api/reminders", async () => providers.reminders.list("all"));
  app.get("/api/notifications", async () => (providers.notifications as InAppNotificationProvider).list(false));
  app.post("/api/notifications/:id/read", async (req) => {
    providers.notifications.markRead(z.object({ id: z.uuid() }).parse(req.params).id);
    return { ok: true };
  });

  // ─── Calendar & email views (read-only, level 0) ──────────────────────
  app.get("/api/calendar", async (req) => {
    const q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).parse(req.query);
    return providers.calendar().listEvents({ timeMin: q.from, timeMax: q.to });
  });
  app.get("/api/email", async (req) => {
    const q = z.object({ unread: z.enum(["true", "false"]).optional(), q: z.string().max(200).optional() }).parse(req.query);
    return providers.email().listEmails({ inboxOnly: true, unreadOnly: q.unread === "true", text: q.q, maxResults: 30 });
  });

  // ─── Integrations ─────────────────────────────────────────────────────
  app.get("/api/integrations", async () => providers.status());

  app.get("/api/integrations/google/connect", async (_req, reply) => {
    if (!providers.googleAuth) return reply.code(409).send({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET fehlen. Siehe docs/SETUP_GOOGLE.md." });
    return reply.redirect(providers.googleAuth.createAuthUrl());
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
    settings: loadPermissionSettings(db),
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
    savePermissionSettings(db, settings);
    return { settings };
  });

  app.get("/api/status", async () => ({ model: config.model, llmConfigured: deps.llmConfigured, timezone: config.timezone }));

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Nicht gefunden" });
    return reply.sendFile("index.html");
  });

  return app;
}
