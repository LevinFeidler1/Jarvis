import { describe, expect, it } from "vitest";
import { AnthropicLlm } from "../src/core/llm.js";
import { summarizeUsage } from "../src/core/usage.js";

function sse(text: string): string {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return (
    ev("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }) +
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
    ev("content_block_stop", { type: "content_block_stop", index: 0 }) +
    ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }) +
    ev("message_stop", { type: "message_stop" })
  );
}

describe("Claude API request", () => {
  it("sends compaction, thinking binding and fallbacks; falls back once if the API rejects the extras", async () => {
    const bodies: Array<{ body: Record<string, unknown>; beta: string }> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const beta = new Headers(init.headers).get("anthropic-beta") ?? "";
      bodies.push({ body, beta });
      if (body.context_management) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "context_management: Extra inputs are not permitted" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(sse("Hallo"), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const llm = new AnthropicLlm({ apiKey: "sk-test", model: "claude-sonnet-5-5", enableWebSearch: false, compactAtTokens: 60_000, fetch: fakeFetch });
    const req = { system: [{ type: "text" as const, text: "sys" }], messages: [{ role: "user" as const, content: "hi" }], tools: [] };
    const r1 = await llm.create(req);
    expect(r1.content).toEqual([expect.objectContaining({ type: "text", text: "Hallo" })]);

    const first = bodies[0]!;
    expect(first.body.fallbacks).toBe("default");
    expect(first.body.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(first.body.context_management).toEqual({
      edits: [expect.objectContaining({ type: "compact_20260112", trigger: { type: "input_tokens", value: 60_000 } })],
    });
    expect(first.beta).toContain("compact-2026-01-12");
    expect(first.beta).toContain("thinking-binding-controls-2026-08-01");
    expect(first.beta).toContain("server-side-fallback-2026-07-01");
    // stable prefix cached for 1 hour, conversation via the automatic 5-minute breakpoint
    expect(first.body.system).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(first.body.cache_control).toEqual({ type: "ephemeral" });
    expect(first.body.output_config).toEqual({ effort: "medium" });

    const retry = bodies[1]!;
    expect(retry.body.context_management).toBeUndefined();
    expect(retry.body.thinking).toEqual({ type: "adaptive" });
    expect(retry.beta).not.toContain("compact");

    // later requests skip the extras directly
    await llm.create(req);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.body.context_management).toBeUndefined();
  });

  it("uses the requested effort and does not mutate the caller's system blocks", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(sse("Ok"), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const llm = new AnthropicLlm({ apiKey: "sk-test", model: "claude-sonnet-5-5", enableWebSearch: false, fetch: fakeFetch });
    const system = [{ type: "text" as const, text: "sys" }];
    await llm.create({ system, messages: [{ role: "user", content: "hi" }], tools: [], effort: "low" });
    expect(bodies[0]!.output_config).toEqual({ effort: "low" });
    expect(system[0]).toEqual({ type: "text", text: "sys" });
  });

  it("falls back without the 1-hour cache if the API rejects the ttl", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (JSON.stringify(body.system).includes("ttl")) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "system.0.cache_control.ttl: not supported" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(sse("Ok"), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const llm = new AnthropicLlm({ apiKey: "sk-test", model: "claude-sonnet-5-5", enableWebSearch: false, fetch: fakeFetch });
    const r = await llm.create({ system: [{ type: "text", text: "sys" }], messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(r.content[0]).toMatchObject({ text: "Ok" });
    expect(bodies[1]!.system).toEqual([{ type: "text", text: "sys" }]);
  });
});

describe("usage cost", () => {
  it("prices 1-hour cache writes at 2x input and 5-minute writes at 1.25x", () => {
    const base = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    const fiveMin = summarizeUsage({ model: "claude-sonnet-5-5", usage: { ...base, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } } as never });
    const oneHour = summarizeUsage({ model: "claude-sonnet-5-5", usage: { ...base, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } } as never });
    expect(fiveMin.costUsd).toBeCloseTo(2.5);
    expect(oneHour.costUsd).toBeCloseTo(4);
  });
});
