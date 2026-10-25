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

async function start(steps: Step[]) {
  const h = await harness(steps);
  app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), scheduler: h.scheduler, llmConfigured: true });
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { token: "t".repeat(40) } });
  const cookie = res.cookies.find((c) => c.name === "jarvis_session")!;
  return { h, app, headers: { cookie: `jarvis_session=${cookie.value}`, "x-jarvis-csrf": res.json().csrfToken as string } };
}

const events = (body: string) => body.trim().split("\n").map((l) => JSON.parse(l) as { type: string; delta?: string; items?: unknown[]; reply?: { text: string } });

describe("streaming reply text", () => {
  it("streams the text before the final reply, so the voice UI can start speaking early", async () => {
    const { app, headers } = await start([message([text("Morgen hast du zwei Termine. Der erste ist um 9 Uhr.")])]);
    const res = await app.inject({ method: "POST", url: "/api/chat/stream", headers, payload: { message: "Was ist morgen?", voice: true } });
    const ev = events(res.body);
    const deltas = ev.filter((e) => e.type === "text");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => e.delta).join("")).toBe("Morgen hast du zwei Termine. Der erste ist um 9 Uhr.");
    expect(ev.findIndex((e) => e.type === "text")).toBeLessThan(ev.findIndex((e) => e.type === "reply"));
  });

  it("sends context cards as soon as a tool found them, before the answer text", async () => {
    const { h, app, headers } = await start([
      message([text("Ich schaue nach."), toolUse("list_tasks", {})]),
      message([text("Offen ist noch die Steuererklärung.")]),
    ]);
    await h.providers.tasks.create({ title: "Steuererklärung abgeben" });
    const ev = events((await app.inject({ method: "POST", url: "/api/chat/stream", headers, payload: { message: "Was ist offen?" } })).body);
    const ctx = ev.findIndex((e) => e.type === "context");
    expect(ctx).toBeGreaterThan(-1);
    expect(ev[ctx]!.items).toEqual([expect.objectContaining({ kind: "task", title: "Steuererklärung abgeben" })]);
    // each model step starts with "thinking": the preamble of step 1 and the answer of step 2 are separable
    const order = ev.map((e) => e.type).filter((t) => t !== "action");
    expect(order[0]).toBe("thinking");
    expect(order.indexOf("thinking", 1)).toBeGreaterThan(order.indexOf("text"));
    expect(ctx).toBeLessThan(ev.findLastIndex((e) => e.type === "text"));
    expect(ev.at(-1)!.reply!.text).toBe("Offen ist noch die Steuererklärung.");
  });

  it("non-streaming routes do not pay for streaming hooks", async () => {
    const { h, app, headers } = await start([message([text("Hallo!")])]);
    const res = await app.inject({ method: "POST", url: "/api/chat", headers, payload: { message: "Hi" } });
    expect(res.json().text).toBe("Hallo!");
    expect(h.llm.requests).toHaveLength(1);
  });
});
