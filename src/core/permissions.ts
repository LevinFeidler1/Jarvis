import type { Db } from "../db/database.js";
import { detectSensitiveContent } from "./injection.js";
import { RiskLevel, type ToolCategory, type ToolDefinition } from "./types.js";

export type PermissionDecision = "allow" | "confirm" | "deny";

export interface PermissionResult {
  decision: PermissionDecision;
  /** Effective risk after escalation (never lower than the tool's own risk). */
  risk: RiskLevel;
  reasons: string[];
}

export interface PermissionSettings {
  /** Level-1 tools run without confirmation for these categories. */
  autoApproveLowRisk: Partial<Record<ToolCategory, boolean>>;
  /** Tools the user disabled entirely. */
  disabledTools: string[];
}

export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = {
  autoApproveLowRisk: {
    email: true,
    calendar: true,
    contacts: true,
    tasks: true,
    reminders: true,
    memory: true,
    files: true,
    web: true,
  },
  disabledTools: [],
};

export interface PermissionContext {
  /** Suspicious external content was read earlier in this agent run. */
  tainted: boolean;
  settings: PermissionSettings;
}

/**
 * Deterministic permission policy (SECURITY.md §1). The model has no way to
 * influence this function other than through the tool input it proposes, and
 * input can only ever RAISE the risk.
 */
export function decidePermission<I>(tool: ToolDefinition<I>, input: I, ctx: PermissionContext): PermissionResult {
  const reasons: string[] = [];
  let risk = tool.risk;
  if (tool.riskFor) risk = Math.max(risk, tool.riskFor(input)) as RiskLevel;

  if (ctx.settings.disabledTools.includes(tool.name)) {
    return { decision: "deny", risk, reasons: [`Das Tool ${tool.name} ist in den Einstellungen deaktiviert.`] };
  }

  if (tool.outgoingText) {
    const sensitive = detectSensitiveContent(tool.outgoingText(input));
    if (sensitive.length > 0) {
      risk = RiskLevel.CRITICAL;
      reasons.push(`Ausgehender Inhalt enthält möglicherweise sensible Daten (${sensitive.join(", ")}).`);
    }
  }

  if (ctx.tainted && (tool.isExternal || risk >= RiskLevel.EXTERNAL)) {
    risk = RiskLevel.CRITICAL;
    reasons.push(
      "In dieser Anfrage wurden Inhalte mit möglichen Manipulationsversuchen (Prompt Injection) gelesen.",
    );
  }

  switch (risk) {
    case RiskLevel.READ:
      return { decision: "allow", risk, reasons };
    case RiskLevel.LOW: {
      const auto = ctx.settings.autoApproveLowRisk[tool.category] ?? false;
      if (auto) return { decision: "allow", risk, reasons };
      reasons.push("Automatische Ausführung für diese Kategorie ist deaktiviert.");
      return { decision: "confirm", risk, reasons };
    }
    case RiskLevel.EXTERNAL:
      reasons.push("Externe Kommunikation erfordert deine Bestätigung.");
      return { decision: "confirm", risk, reasons };
    case RiskLevel.CRITICAL:
    default:
      reasons.push("Kritische Aktion — explizite Bestätigung erforderlich.");
      return { decision: "confirm", risk: RiskLevel.CRITICAL, reasons };
  }
}

const SETTINGS_KEY = "permissions";

export async function loadPermissionSettings(db: Db): Promise<PermissionSettings> {
  const row = await db.one<{ value_json: string }>("SELECT value_json FROM settings WHERE key = $1", [SETTINGS_KEY]);
  if (!row) return structuredClone(DEFAULT_PERMISSION_SETTINGS);
  const stored = JSON.parse(row.value_json) as Partial<PermissionSettings>;
  return {
    autoApproveLowRisk: { ...DEFAULT_PERMISSION_SETTINGS.autoApproveLowRisk, ...stored.autoApproveLowRisk },
    disabledTools: stored.disabledTools ?? [],
  };
}

export async function savePermissionSettings(db: Db, settings: PermissionSettings): Promise<void> {
  await db.run(
    "INSERT INTO settings (key, value_json) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
    [SETTINGS_KEY, JSON.stringify(settings)],
  );
}
