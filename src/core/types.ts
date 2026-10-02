import type { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import type { ProviderHub } from "../providers/hub.js";
import type { MemoryStore } from "../memory/memory.js";

/** Risk levels as defined in SECURITY.md. Fixed per tool in code. */
export enum RiskLevel {
  READ = 0,
  LOW = 1,
  EXTERNAL = 2,
  CRITICAL = 3,
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  [RiskLevel.READ]: "Lesen",
  [RiskLevel.LOW]: "Niedriges Risiko",
  [RiskLevel.EXTERNAL]: "Externe Kommunikation",
  [RiskLevel.CRITICAL]: "Kritisch",
};

export type ToolCategory =
  | "email"
  | "calendar"
  | "contacts"
  | "tasks"
  | "reminders"
  | "memory"
  | "system"
  | "web"
  | "files";

/** Lifecycle of every action JARVIS takes (SECURITY.md §7). */
export type ActionStatus =
  | "planned"
  | "awaiting_confirmation"
  | "executing"
  | "succeeded"
  | "failed"
  | "partially_succeeded"
  | "rejected"
  | "expired"
  | "denied";

/** Binary content handed to the model next to the JSON result (vision / PDF reading). */
export type ToolAttachment =
  | { type: "image"; mediaType: "image/png" | "image/jpeg"; base64: string }
  | { type: "document"; base64: string };

export type ToolResult =
  | { ok: true; data: unknown; partial?: boolean; externalData?: ExternalDataInfo; attachments?: ToolAttachment[] }
  | { ok: false; error: string; code?: ToolErrorCode };

export type ToolErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "AMBIGUOUS"
  | "INTERNAL";

/** Marks tool output as untrusted third-party content (emails, web pages, …). */
export interface ExternalDataInfo {
  source: string;
  /** Free-text fields that came from third parties; scanned for injection. */
  texts: string[];
}

export interface ToolContext {
  config: AppConfig;
  db: Db;
  providers: ProviderHub;
  memory: MemoryStore;
  conversationId: string;
  now: () => Date;
}

export interface ToolDefinition<I = any> {
  name: string;
  description: string;
  category: ToolCategory;
  risk: RiskLevel;
  /** True if the action reaches people/systems outside JARVIS. */
  isExternal?: boolean;
  input: z.ZodType<I>;
  /**
   * Optional input-dependent risk. The permission engine uses
   * max(risk, riskFor(input)) — it can only ever raise the level.
   */
  riskFor?(input: I): RiskLevel;
  /**
   * Optional risk that depends on external state (e.g. which button on a web
   * page is clicked). Like riskFor it can only raise the level.
   */
  assessRisk?(input: I, ctx: ToolContext): Promise<{ risk: RiskLevel; reasons: string[] } | undefined>;
  /** Human readable, precise description used for confirmations and activity. */
  describe(input: I): string;
  /** Audit target (e.g. recipient). Masked before storage. */
  auditTarget?(input: I): string | undefined;
  /** Outgoing free text to scan for sensitive data (passwords, OTPs, IBAN…). */
  outgoingText?(input: I): string;
  /**
   * Optional read-only check before the permission gate (e.g. "which mailbox
   * sends this?"). A failure is returned to the model instead of asking the
   * user to confirm an action that could not run anyway.
   */
  precheck?(input: I, ctx: ToolContext): Promise<ToolResult | void>;
  /**
   * Optional inverse action after a successful run (archive → back to inbox,
   * create → delete). Offered as "Rückgängig" in the activity log.
   */
  undo?(input: I, data: unknown, ctx: ToolContext): Promise<{ tool: string; input: Record<string, unknown>; label: string } | undefined> | { tool: string; input: Record<string, unknown>; label: string } | undefined;
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: ToolErrorCode = "INTERNAL",
  ) {
    super(message);
    this.name = "ToolError";
  }
}
