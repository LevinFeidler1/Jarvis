import Anthropic from "@anthropic-ai/sdk";

export type LlmMessage = Anthropic.Beta.BetaMessageParam;
export type LlmResponse = Anthropic.Beta.BetaMessage;
export type LlmTool = Anthropic.Beta.BetaToolUnion;
export type LlmSystem = Anthropic.Beta.BetaTextBlockParam[];

export interface LlmRequest {
  system: LlmSystem;
  messages: LlmMessage[];
  tools: LlmTool[];
  /** Thinking/effort budget for this turn (default "medium"). Voice turns use "low": short spoken answers. */
  effort?: "low" | "medium" | "high";
}

/** The agent core depends only on this interface (tests use a scripted fake). */
export interface LlmClient {
  readonly model: string;
  create(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export interface AnthropicLlmOptions {
  apiKey?: string;
  /** Sent as anthropic-workspace-id (required for keys not scoped to a workspace). */
  workspaceId?: string;
  model: string;
  enableWebSearch?: boolean;
  /** Server-side compaction threshold (input tokens, API minimum 50 000). */
  compactAtTokens?: number;
  /** Test hook: custom fetch implementation. */
  fetch?: typeof fetch;
}

/** Summarizer instructions for server-side compaction (replaces the default prompt). */
export const COMPACTION_INSTRUCTIONS =
  "Fasse die bisherige Unterhaltung zwischen dem Benutzer und seinem Assistenten JARVIS auf Deutsch zusammen, " +
  "damit das Gespräch nahtlos weitergehen kann. Behalte unbedingt: offene Aufträge und Zusagen, vorbereitete oder " +
  "wartende Aktionen, genannte Personen mit E-Mail-Adressen, Termine mit Datum/Uhrzeit, E-Mail-IDs, Aufgaben-/Termin-IDs, " +
  "Entscheidungen und Vorlieben des Benutzers sowie Sicherheitshinweise (z.B. erkannte Manipulationsversuche). " +
  "Lass Smalltalk und bereits vollständig erledigte Details weg. Schreib nur die Zusammenfassung und rufe kein Werkzeug auf.";

/** Marks the end of the system prompt as a 1-hour cache breakpoint (tools come before it in the prefix). */
export function withLongCache(system: LlmSystem): LlmSystem {
  if (!system.length) return system;
  const last = system[system.length - 1]!;
  return [...system.slice(0, -1), { ...last, cache_control: { type: "ephemeral", ttl: "1h" } }];
}

/** Claude Messages API with adaptive thinking, streaming and refusal fallback. */
export class AnthropicLlm implements LlmClient {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly enableWebSearch: boolean;
  private readonly compactAtTokens: number;

  constructor(opts: AnthropicLlmOptions) {
    this.model = opts.model;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      maxRetries: 2,
      defaultHeaders: opts.workspaceId ? { "anthropic-workspace-id": opts.workspaceId } : undefined,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.enableWebSearch = opts.enableWebSearch ?? true;
    this.compactAtTokens = Math.max(50_000, opts.compactAtTokens ?? 60_000);
  }

  /** Set when the API rejected the optional extras once; the process then continues without them. */
  private extrasDisabled = false;

  private async send(req: LlmRequest, tools: LlmTool[], extras: boolean): Promise<LlmResponse> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 32_000,
      betas: extras
        ? ["server-side-fallback-2026-07-01", "compact-2026-01-12", "thinking-binding-controls-2026-08-01"]
        : ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // A thinking block whose conversation prefix no longer matches is dropped instead of failing the request.
      thinking: extras ? { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } } : { type: "adaptive" },
      // Long conversations are summarized server-side (append-only for us, cheaper per request afterwards).
      ...(extras
        ? {
            context_management: {
              edits: [{ type: "compact_20260112", trigger: { type: "input_tokens", value: this.compactAtTokens }, instructions: COMPACTION_INSTRUCTIONS }],
            },
          }
        : {}),
      output_config: { effort: req.effort ?? "medium" },
      // Two cache layers: the stable prefix (tools + system prompt, ~11k tokens) is kept for 1 hour, so a
      // conversation started 20 minutes after the last one still reads it at 10 % instead of re-writing it;
      // the growing conversation itself uses the automatic 5-minute breakpoint.
      cache_control: { type: "ephemeral" },
      system: extras ? withLongCache(req.system) : req.system,
      tools,
      messages: req.messages,
    });
    return stream.finalMessage();
  }

  async create(req: LlmRequest): Promise<LlmResponse> {
    const tools: LlmTool[] = [...req.tools];
    if (this.enableWebSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
    try {
      if (this.extrasDisabled) return await this.send(req, tools, false);
      try {
        return await this.send(req, tools, true);
      } catch (err) {
        // Compaction / thinking-binding are optimizations: if this account or model rejects them,
        // continue without instead of failing every request.
        if (err instanceof Anthropic.BadRequestError && /context_management|compact|block_binding|thinking-binding|beta|ttl|cache_control/i.test(err.message)) {
          console.warn("[llm] optional API features rejected, continuing without:", err.message);
          this.extrasDisabled = true;
          return await this.send(req, tools, false);
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new LlmUnavailableError("Der Claude-API-Schlüssel ist ungültig oder hat keine Berechtigung.", false);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new LlmUnavailableError("Das Sprachmodell ist gerade ausgelastet (Rate-Limit). Bitte gleich erneut versuchen.", true);
      }
      if (err instanceof Anthropic.BadRequestError && /workspace/i.test(err.message)) {
        throw new LlmUnavailableError(
          "Der Claude-API-Schlüssel ist keinem Workspace zugeordnet. ANTHROPIC_WORKSPACE_ID setzen (Console → Settings → Workspaces) oder einen Key innerhalb eines Workspaces erstellen.",
          false,
        );
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new LlmUnavailableError(`Anfrage an das Sprachmodell abgelehnt: ${err.message}`, false);
      }
      if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
        throw new LlmUnavailableError("Das Sprachmodell ist momentan nicht erreichbar.", true);
      }
      if (err instanceof Anthropic.APIError) {
        throw new LlmUnavailableError(`Fehler des Sprachmodells (HTTP ${err.status}).`, true);
      }
      throw err;
    }
  }
}

/** Used when no API key is configured: explains setup instead of pretending. */
export class UnconfiguredLlm implements LlmClient {
  readonly model = "none";
  async create(): Promise<LlmResponse> {
    throw new LlmUnavailableError(
      "Das Sprachmodell ist noch nicht konfiguriert. Bitte ANTHROPIC_API_KEY in .env setzen und JARVIS neu starten.",
      false,
    );
  }
}
