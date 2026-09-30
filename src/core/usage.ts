import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";

/** USD per million tokens (first-party API list prices). Cache write = 5-minute TTL. */
const PRICES: Array<{ prefix: string; input: number; output: number; cacheRead: number; cacheWrite: number }> = [
  { prefix: "claude-sonnet-5", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { prefix: "claude-opus-5-5", input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { prefix: "claude-opus", input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: "claude-sonnet-4", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { prefix: "claude-haiku", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { prefix: "claude-fable", input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
];
const WEB_SEARCH_USD = 10 / 1000;

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  compactions: number;
  costUsd: number;
}

function priceFor(model: string) {
  return PRICES.find((p) => model.startsWith(p.prefix)) ?? PRICES[0]!;
}

/** Sums a response's usage, including compaction/fallback iterations (billed but not in the top-level fields). */
export function summarizeUsage(response: Pick<Anthropic.Beta.BetaMessage, "model" | "usage">) {
  const u = response.usage;
  const parts = u.iterations?.length ? u.iterations : [u];
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  for (const p of parts) {
    input += p.input_tokens ?? 0;
    output += p.output_tokens ?? 0;
    cacheRead += p.cache_read_input_tokens ?? 0;
    cacheWrite += p.cache_creation_input_tokens ?? 0;
  }
  const webSearches = u.server_tool_use?.web_search_requests ?? 0;
  const compacted = !!u.iterations?.some((i) => i.type === "compaction");
  const price = priceFor(response.model);
  const costUsd =
    (input * price.input + output * price.output + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) / 1_000_000 +
    webSearches * WEB_SEARCH_USD;
  return { input, output, cacheRead, cacheWrite, webSearches, compacted, costUsd };
}

/** Token usage and estimated cost per model request — shown in the weekly review. */
export class UsageStore {
  constructor(private readonly db: Db) {}

  async record(response: Pick<Anthropic.Beta.BetaMessage, "model" | "usage">, conversationId?: string): Promise<void> {
    if (!response.usage) return;
    const s = summarizeUsage(response);
    await this.db.run(
      `INSERT INTO llm_usage (ts, model, conversation_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, compacted, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [nowIso(), response.model, conversationId ?? null, s.input, s.output, s.cacheRead, s.cacheWrite, s.webSearches, s.compacted, s.costUsd],
    );
  }

  async totals(fromIso: string, toIso: string): Promise<UsageTotals> {
    const r = await this.db.one<Record<string, string | number | null>>(
      `SELECT count(*) AS requests, coalesce(sum(input_tokens), 0) AS input, coalesce(sum(output_tokens), 0) AS output,
         coalesce(sum(cache_read_tokens), 0) AS cache_read, coalesce(sum(cache_write_tokens), 0) AS cache_write,
         coalesce(sum(web_searches), 0) AS web, coalesce(sum(CASE WHEN compacted THEN 1 ELSE 0 END), 0) AS compactions,
         coalesce(sum(cost_usd), 0) AS cost
       FROM llm_usage WHERE ts >= $1 AND ts < $2`,
      [fromIso, toIso],
    );
    const n = (v: unknown) => Number(v ?? 0);
    return {
      requests: n(r?.requests),
      inputTokens: n(r?.input),
      outputTokens: n(r?.output),
      cacheReadTokens: n(r?.cache_read),
      cacheWriteTokens: n(r?.cache_write),
      webSearches: n(r?.web),
      compactions: n(r?.compactions),
      costUsd: Math.round(n(r?.cost) * 10000) / 10000,
    };
  }
}
