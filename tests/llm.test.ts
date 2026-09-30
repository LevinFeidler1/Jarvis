import { describe, expect, it } from "vitest";
import { AnthropicLlm } from "../src/core/llm.js";

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

    const retry = bodies[1]!;
    expect(retry.body.context_management).toBeUndefined();
    expect(retry.body.thinking).toEqual({ type: "adaptive" });
    expect(retry.beta).not.toContain("compact");

    // later requests skip the extras directly
    await llm.create(req);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.body.context_management).toBeUndefined();
  });
});
