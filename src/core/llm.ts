import Anthropic from "@anthropic-ai/sdk";

export type LlmMessage = Anthropic.Beta.BetaMessageParam;
export type LlmResponse = Anthropic.Beta.BetaMessage;
export type LlmTool = Anthropic.Beta.BetaToolUnion;
export type LlmSystem = Anthropic.Beta.BetaTextBlockParam[];

export interface LlmRequest {
  system: LlmSystem;
  messages: LlmMessage[];
  tools: LlmTool[];
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
}

/** Claude Messages API with adaptive thinking, streaming and refusal fallback. */
export class AnthropicLlm implements LlmClient {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly enableWebSearch: boolean;

  constructor(opts: AnthropicLlmOptions) {
    this.model = opts.model;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      maxRetries: 2,
      defaultHeaders: opts.workspaceId ? { "anthropic-workspace-id": opts.workspaceId } : undefined,
    });
    this.enableWebSearch = opts.enableWebSearch ?? true;
  }

  async create(req: LlmRequest): Promise<LlmResponse> {
    const tools: LlmTool[] = [...req.tools];
    if (this.enableWebSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 32_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: req.system,
        tools,
        messages: req.messages,
      });
      return await stream.finalMessage();
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
