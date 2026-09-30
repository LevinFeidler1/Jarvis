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

async function start(steps: Step[] = []) {
  const h = harness(steps);
  app = await createServer({
    config: h.config,
    db: h.db,
    agent: h.agent,
    providers: h.providers,
    memory: h.memory,
    registry: createDefaultRegistry(),
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
    const h = harness([], { connect: false });
    app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), llmConfigured: false });
    const { cookie } = await login(app);
    const res = await app.inject({ url: "/api/email", headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("nicht konfiguriert");
    const setup = (await app.inject({ url: "/api/setup", headers: { cookie } })).json();
    expect(setup.complete).toBe(false);
    expect(setup.steps.find((s: { id: string }) => s.id === "llm").done).toBe(false);
  });
});
