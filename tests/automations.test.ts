import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationRunner, AutomationStore, describeTrigger, nextScheduledRun } from "../src/core/automations.js";
import { buildWeekReview, weekRange } from "../src/core/review.js";
import { PushService, isAllowedPushEndpoint } from "../src/providers/push.js";
import { createServer } from "../src/server.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { harness, makeEmail, message, testDb, text, toolUse } from "./helpers.js";

const TZ = "Europe/Berlin";
const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

function fakePush(db: Awaited<ReturnType<typeof testDb>>, status = 201) {
  const svc = new PushService(db, Buffer.alloc(32, 7), "https://jarvis.example.com");
  const sent: Array<{ endpoint: string; payload: Record<string, string> }> = [];
  svc.setSender(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    if (status >= 400) throw Object.assign(new Error("gone"), { statusCode: status });
    return status;
  });
  return { svc, sent };
}

describe("automation schedules", () => {
  it("computes the next local run across weekends and DST", () => {
    const weekdays = { type: "schedule" as const, time: "07:00", days: [1, 2, 3, 4, 5] };
    // Friday 2 Oct 2026, 08:00 CEST → Monday 5 Oct 07:00 CEST
    expect(nextScheduledRun(weekdays, new Date("2026-10-02T06:00:00Z"), TZ)!.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    // Same day, before the time → today
    expect(nextScheduledRun(weekdays, new Date("2026-10-05T04:00:00Z"), TZ)!.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    // DST ends on 25 Oct: 07:00 is then 06:00 UTC
    const daily = { type: "schedule" as const, time: "07:00", days: [1, 2, 3, 4, 5, 6, 7] };
    expect(nextScheduledRun(daily, new Date("2026-10-24T12:00:00Z"), TZ)!.toISOString()).toBe("2026-10-25T06:00:00.000Z");
  });

  it("describes triggers in plain German", () => {
    expect(describeTrigger({ type: "schedule", time: "07:00", days: [1, 2, 3, 4, 5] })).toBe("Mo–Fr um 07:00 Uhr");
    expect(describeTrigger({ type: "schedule", time: "17:00", days: [5] })).toBe("Fr um 17:00 Uhr");
    expect(describeTrigger({ type: "email", subject: "Rechnung" })).toBe("Neue E-Mail (Betreff enthält „Rechnung“)");
  });

  it("claims a due run only once, even with parallel ticks", async () => {
    const store = new AutomationStore(await testDb(), TZ);
    const a = await store.create({ name: "X", prompt: "Tu was", trigger: { type: "schedule", time: "07:00", days: [1, 2, 3, 4, 5, 6, 7] } }, new Date("2026-10-05T04:00:00Z"));
    const now = new Date("2026-10-05T05:01:00Z");
    const [c1, c2] = await Promise.all([store.claimDue(now), store.claimDue(now)]);
    expect(c1.length + c2.length).toBe(1);
    expect((await store.get(a.id))!.nextRunAt).toBe("2026-10-06T05:00:00.000Z");
    expect(await store.claimDue(now)).toHaveLength(0);
  });

  it("paused automations never run", async () => {
    const store = new AutomationStore(await testDb(), TZ);
    const a = await store.create({ name: "X", prompt: "Tu was", trigger: { type: "schedule", time: "07:00", days: [1] } }, new Date("2026-10-04T12:00:00Z"));
    await store.update(a.id, { enabled: false });
    expect(await store.claimDue(new Date("2026-10-12T12:00:00Z"))).toHaveLength(0);
  });
});

describe("automation runner", () => {
  it("runs a due automation through the agent and pushes the result", async () => {
    const h = await harness([message([toolUse("list_tasks", {})]), message([text("Dein Tag\n- 3 Termine\n- 1 wichtige Mail")])]);
    const { svc, sent } = fakePush(h.db);
    await svc.subscribe({ endpoint: FCM, keys }, "iPhone");
    (h.providers as unknown as { push: PushService }).push = svc;
    (h.providers.notifications as unknown as { push: PushService }).push = svc;
    const a = await h.providers.automations.create({ name: "Morgen-Briefing", prompt: "Briefing bitte", trigger: { type: "schedule", time: "07:00", days: [1, 2, 3, 4, 5, 6, 7] } }, new Date("2026-10-05T04:00:00Z"));
    const runner = new AutomationRunner(h.providers.automations, h.agent, h.providers);

    expect(await runner.runDue(new Date("2026-10-05T05:00:30Z"))).toBe(1);
    const firstUser = JSON.stringify(h.llm.requests[0]!.messages[0]!.content);
    expect(firstUser).toContain("<automation>");
    expect(firstUser).toContain("Morgen-Briefing");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ title: "⚡ Dein Tag", body: "• 3 Termine\n• 1 wichtige Mail" });
    expect(sent[0]!.payload.url).toMatch(/^\/#chat\?c=/);
    const after = (await h.providers.automations.get(a.id))!;
    expect(after).toMatchObject({ lastStatus: "ok", runCount: 1, nextRunAt: "2026-10-06T05:00:00.000Z" });
    expect((await h.agent.conversations.get(after.lastConversationId!))!.origin).toBe("automation");
    // not due again the same day
    expect(await runner.runDue(new Date("2026-10-05T05:05:00Z"))).toBe(0);
  });

  it("'Nichts Neues.' is recorded but not pushed", async () => {
    const h = await harness([message([text("Nichts Neues.")])]);
    await h.providers.automations.create({ name: "Check", prompt: "Prüfen", trigger: { type: "schedule", time: "12:00", days: [1] } }, new Date("2026-10-05T04:00:00Z"));
    const runner = new AutomationRunner(h.providers.automations, h.agent, h.providers);
    await runner.runDue(new Date("2026-10-05T10:00:10Z"));
    expect(await h.providers.notifications.list()).toHaveLength(0);
    expect((await h.providers.automations.list())[0]!.lastStatus).toBe("nothing");
  });

  it("never sends on its own: external actions wait for confirmation", async () => {
    const h = await harness([
      message([toolUse("send_email", { to: ["anna@example.com"], subject: "Hi", body: "Hallo" })]),
      message([text("Mail an Anna vorbereitet\nSoll ich sie senden?")]),
    ]);
    const a = await h.providers.automations.create({ name: "Mailer", prompt: "Schreib Anna", trigger: { type: "schedule", time: "09:00", days: [1] } }, new Date("2026-10-05T04:00:00Z"));
    const runner = new AutomationRunner(h.providers.automations, h.agent, h.providers);
    const r = await runner.runNow(a.id);
    expect(r.status).toBe("waiting");
    expect(h.email.sent).toHaveLength(0);
    const [n] = await h.providers.notifications.list();
    expect(n!.body).toContain("wartet auf deine Bestätigung");
  });

  it("e-mail triggers react once to new matching mail only", async () => {
    const created = new Date("2026-10-05T08:00:00Z");
    const h = await harness([message([text("Aufgabe angelegt")]), message([text("Aufgabe angelegt")])], {
      emails: [
        makeEmail({ id: "old", subject: "Rechnung September", date: "2026-10-05T07:00:00.000Z" }),
        makeEmail({ id: "new", subject: "Ihre Rechnung Oktober", date: "2026-10-05T08:30:00.000Z" }),
        makeEmail({ id: "other", subject: "Hallo", date: "2026-10-05T08:40:00.000Z" }),
      ],
    });
    await h.providers.automations.create({ name: "Rechnungen", prompt: "Mach eine Aufgabe draus", trigger: { type: "email", subject: "rechnung" } }, created);
    const runner = new AutomationRunner(h.providers.automations, h.agent, h.providers);
    expect(await runner.runDue(new Date("2026-10-05T08:45:00Z"))).toBe(1);
    expect(JSON.stringify(h.llm.requests[0]!.messages[0]!.content)).toContain("ID new");
    // next poll: nothing new
    expect(await runner.runDue(new Date("2026-10-05T08:51:00Z"))).toBe(0);
    expect(h.llm.requests).toHaveLength(1);
  });
});

describe("web push", () => {
  it("only accepts real push services as endpoints", async () => {
    expect(isAllowedPushEndpoint(FCM)).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QK")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/collect")).toBe(false);
    const { svc } = fakePush(await testDb());
    await expect(svc.subscribe({ endpoint: "https://169.254.169.254/latest", keys })).rejects.toThrow();
  });

  it("keeps one VAPID key pair and removes expired subscriptions", async () => {
    const db = await testDb();
    const { svc, sent } = fakePush(db, 410);
    const k1 = await svc.publicKey();
    expect(await new PushService(db, Buffer.alloc(32, 7), "https://jarvis.example.com").publicKey()).toBe(k1);
    await svc.subscribe({ endpoint: FCM, keys });
    expect(await svc.send({ title: "Hi" })).toEqual({ sent: 0, failed: 1 });
    expect(sent).toHaveLength(1);
    expect(await svc.devices()).toHaveLength(0);
  });
});

describe("weekly review", () => {
  it("counts the week's work and estimated cost", async () => {
    const h = await harness([message([text("ok")])]);
    const t = await h.providers.tasks.create({ title: "Angebot schreiben" });
    await h.providers.tasks.complete(t.id);
    await h.agent.handleUserMessage(undefined, "Hallo");
    const r = await buildWeekReview({ db: h.db, providers: h.providers, config: h.config });
    expect(r.tasks.completed.map((x) => x.title)).toEqual(["Angebot schreiben"]);
    expect(r.conversations).toBe(1);
    expect(r.usage.requests).toBe(1);
    expect(r.nextWeek.events).toEqual([]);
  });

  it("weeks start on Monday in local time", () => {
    const { from, to } = weekRange(new Date("2026-10-04T21:30:00Z"), TZ); // Sunday 23:30 CEST
    expect(from.toISOString()).toBe("2026-09-27T22:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-04T22:00:00.000Z");
  });
});

describe("HTTP API: push, automations, review", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("manages automations and devices", async () => {
    const h = await harness([message([text("Briefing\nAlles ruhig.")])]);
    app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), scheduler: h.scheduler, llmConfigured: true });
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { token: "t".repeat(40) } });
    const cookie = `jarvis_session=${login.cookies.find((c) => c.name === "jarvis_session")!.value}`;
    const headers = { cookie, "x-jarvis-csrf": login.json().csrfToken as string, origin: "http://localhost:3000" };

    const list0 = (await app.inject({ url: "/api/automations", headers: { cookie } })).json();
    expect(list0.templates.map((t: { id: string }) => t.id)).toContain("week-review");

    const bad = await app.inject({ method: "POST", url: "/api/automations", headers, payload: { name: "X", prompt: "Tu etwas", trigger: { type: "schedule", time: "25:00", days: [1] } } });
    expect(bad.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/api/automations", headers, payload: { name: "Briefing", prompt: "Briefing bitte", trigger: { type: "schedule", time: "07:00", days: [1, 2, 3, 4, 5] } } });
    expect(created.json()).toMatchObject({ name: "Briefing", enabled: true, triggerText: "Mo–Fr um 07:00 Uhr" });
    const id = created.json().id as string;

    const run = await app.inject({ method: "POST", url: `/api/automations/${id}/run`, headers });
    expect(run.json()).toMatchObject({ status: "ok" });
    const paused = await app.inject({ method: "PATCH", url: `/api/automations/${id}`, headers, payload: { enabled: false } });
    expect(paused.json()).toMatchObject({ enabled: false, nextRunAt: null });

    const push = (await app.inject({ url: "/api/push", headers: { cookie } })).json();
    expect(push.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers, payload: { subscription: { endpoint: "https://evil.example/x", keys } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers, payload: { subscription: { endpoint: FCM, keys }, label: "iPhone · Safari" } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/push", headers: { cookie } })).json().devices).toEqual([expect.objectContaining({ label: "iPhone · Safari", host: "fcm.googleapis.com" })]);

    const review = await app.inject({ url: "/api/review?offset=-1", headers: { cookie } });
    expect(review.statusCode).toBe(200);
    expect(review.json()).toMatchObject({ isCurrentWeek: false });

    expect((await app.inject({ method: "DELETE", url: `/api/automations/${id}`, headers })).statusCode).toBe(200);
  });
});
