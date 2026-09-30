import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { harness, message, text, toolUse, type Step } from "./helpers.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(steps: Step[] = [], opts: Parameters<typeof harness>[1] = {}) {
  const h = await harness(steps, opts);
  app = await createServer({
    config: h.config,
    db: h.db,
    agent: h.agent,
    providers: h.providers,
    memory: h.memory,
    registry: createDefaultRegistry(),
    scheduler: h.scheduler,
    llmConfigured: true,
  });
  return { h, app };
}

async function login(app: FastifyInstance, token = "t".repeat(40)) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { token } });
  const cookie = res.cookies.find((c) => c.name === "jarvis_session");
  return { res, cookie: cookie ? `jarvis_session=${cookie.value}` : "", csrf: res.json().csrfToken as string };
}

describe("HTTP API security", () => {
  it("requires authentication", async () => {
    const { app } = await start();
    expect((await app.inject({ url: "/api/memory" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/chat", payload: { message: "hi" } })).statusCode).toBe(401);
  });

  it("rejects wrong access tokens", async () => {
    const { app } = await start();
    const { res } = await login(app, "wrong");
    expect(res.statusCode).toBe(401);
  });

  it("sets a hardened session cookie", async () => {
    const { app } = await start();
    const { res } = await login(app);
    const c = res.cookies.find((x) => x.name === "jarvis_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Strict");
  });

  it("enforces CSRF token and origin on state-changing requests", async () => {
    const { app } = await start();
    const { cookie, csrf } = await login(app);
    const body = { category: "preference", key: "k", value: "v" };
    expect((await app.inject({ method: "POST", url: "/api/memory", headers: { cookie }, payload: body })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/api/memory", headers: { cookie, "x-jarvis-csrf": csrf, origin: "https://evil.example" }, payload: body }))
        .statusCode,
    ).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/api/memory", headers: { cookie, "x-jarvis-csrf": csrf, origin: "http://localhost:3000" }, payload: body });
    expect(ok.statusCode).toBe(200);
  });

  it("validates input", async () => {
    const { app } = await start();
    const { cookie, csrf } = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/chat", headers: { cookie, "x-jarvis-csrf": csrf }, payload: { message: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("sends security headers", async () => {
    const { app } = await start();
    const res = await app.inject({ url: "/api/session" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("HTTP API — vertical slice", () => {
  it("chat → agent → tool → permission → confirmation → execution → result", async () => {
    const { app, h } = await start([
      message([toolUse("send_email", { to: ["anna@example.com"], subject: "Re: Termin", body: "Donnerstag passt." })]),
      message([text("Soll ich die Antwort an Anna senden?")]),
      message([text("Gesendet.")]),
    ]);
    const { cookie, csrf } = await login(app);
    const headers = { cookie, "x-jarvis-csrf": csrf };

    const chat = await app.inject({ method: "POST", url: "/api/chat", headers, payload: { message: "Antworte Anna, dass Donnerstag passt." } });
    expect(chat.statusCode).toBe(200);
    const reply = chat.json();
    expect(reply.pendingActions).toHaveLength(1);
    expect(h.email.sent).toHaveLength(0);

    const pending = (await app.inject({ url: "/api/confirmations", headers })).json();
    expect(pending[0].input.to).toEqual(["anna@example.com"]);

    const done = await app.inject({ method: "POST", url: `/api/confirmations/${reply.pendingActions[0].id}`, headers, payload: { approve: true } });
    expect(done.json().text).toBe("Gesendet.");
    expect(h.email.sent).toHaveLength(1);

    const audit = (await app.inject({ url: "/api/audit", headers })).json();
    expect(audit[0]).toMatchObject({ action: "send_email", status: "SUCCESS", userConfirmation: true });
  });

  it("reports not-configured integrations with 409", async () => {
    const h = await harness([], { connect: false });
    app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), scheduler: h.scheduler, llmConfigured: false });
    const { cookie } = await login(app);
    const res = await app.inject({ url: "/api/email", headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("nicht konfiguriert");
    const setup = (await app.inject({ url: "/api/setup", headers: { cookie } })).json();
    expect(setup.complete).toBe(false);
    expect(setup.steps.find((s: { id: string }) => s.id === "llm").done).toBe(false);
  });
});

describe("HTTP API — streaming, cron, briefing", () => {
  it("streams live action events and the final reply as NDJSON", async () => {
    const { app } = await start([message([toolUse("list_tasks", {})]), message([text("Keine offenen Aufgaben.")])]);
    const { cookie, csrf } = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/chat/stream", headers: { cookie, "x-jarvis-csrf": csrf }, payload: { message: "Was ist offen?" } });
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const events = res.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toContain("thinking");
    expect(events.filter((e) => e.type === "action").map((e) => e.action.status)).toEqual(["executing", "succeeded"]);
    expect(events.at(-1)).toMatchObject({ type: "reply", reply: { text: "Keine offenen Aufgaben." } });
  });

  it("protects the cron endpoint with CRON_SECRET", async () => {
    const { app, h } = await start([], { config: { cronSecret: "s".repeat(32) } });
    await h.providers.reminders.create("Zahnarzt", "2020-01-01T00:00:00.000Z");
    expect((await app.inject({ url: "/api/cron/tick" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/cron/tick", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const ok = await app.inject({ url: "/api/cron/tick", headers: { authorization: `Bearer ${"s".repeat(32)}` } });
    expect(ok.json()).toEqual({ fired: 1 });
  });

  it("cron endpoint is disabled when no secret is configured", async () => {
    const { app } = await start();
    expect((await app.inject({ url: "/api/cron/tick", headers: { authorization: "Bearer " } })).statusCode).toBe(401);
  });

  it("briefing degrades gracefully per section", async () => {
    const { app, h } = await start([], { connect: false });
    await h.providers.tasks.create({ title: "Steuer", priority: "high" });
    const { cookie } = await login(app);
    const b = (await app.inject({ url: "/api/briefing", headers: { cookie } })).json();
    expect(b.events).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(b.emails).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(b.tasks.ok).toBe(true);
    expect(b.tasks.data[0].title).toBe("Steuer");
  });
});

describe("Vercel handler", () => {
  it("restores the original URL after the rewrite", async () => {
    const { restoreUrl } = await import("../api/index.js");
    expect(restoreUrl("/api/index?path=chat%2Fstream")).toBe("/api/chat/stream");
    expect(restoreUrl("/api/index?path=calendar&from=a&to=b")).toBe("/api/calendar?from=a&to=b");
    expect(restoreUrl("/api/calendar?from=a&to=b&path=calendar")).toBe("/api/calendar?from=a&to=b");
    expect(restoreUrl("/api/session")).toBe("/api/session");
    expect(restoreUrl("/api/index?path=integrations%2Fgoogle%2Fcallback&code=x&state=y")).toBe("/api/integrations/google/callback?code=x&state=y");
  });
});
