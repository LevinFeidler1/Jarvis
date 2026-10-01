import type { ToolRegistry } from "../tools/registry.js";
import { RiskLevel, type ToolContext, type ToolDefinition } from "./types.js";

/**
 * Phase D — what an automation may do on its own.
 *
 * Level 0–1: always. Level 2: only tools the user allowlisted for exactly that
 * automation, and never in these cases (always confirmation):
 * mail to new/unknown recipients, events with guests, deleting without a trash,
 * anything that changes automations, and everything level 3.
 */

/** Never autonomous, whatever the allowlist says. */
export const NEVER_AUTONOMOUS = new Set([
  "create_automation",
  "set_automation_enabled",
  "delete_automation",
  "invite_attendees",
  "respond_to_invitation",
  "delete_event", // calendar events have no trash
]);

/** Restrictions shown in the UI next to the allowlist checkbox. */
export const AUTONOMY_RULES: Record<string, string> = {
  send_email: "nur an bekannte Empfänger (eigene Adressen, Kontakte)",
  reply_email: "nur an bekannte Empfänger (eigene Adressen, Kontakte)",
  forward_email: "nur an bekannte Empfänger (eigene Adressen, Kontakte)",
  delete_email: "verschiebt in den Papierkorb",
  delete_file: "nur Dateien in Google Drive (Papierkorb)",
};

/** Level-2 tools the user may allowlist for an automation. */
export function allowlistableTools(registry: ToolRegistry): Array<{ name: string; description: string; rule: string | null }> {
  return registry
    .all()
    .filter((t) => !NEVER_AUTONOMOUS.has(t.name) && t.risk === RiskLevel.EXTERNAL)
    .map((t) => ({ name: t.name, description: t.description.split(/(?<=\.)\s/)[0]!, rule: AUTONOMY_RULES[t.name] ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function isKnownRecipient(address: string, ctx: ToolContext): Promise<boolean> {
  const a = address.toLowerCase();
  const own = (await ctx.providers.emailAccounts.list()).map((x) => x.email.toLowerCase());
  const google = await ctx.providers.googleAuth?.status().catch(() => undefined);
  if (own.includes(a) || google?.account?.toLowerCase() === a) return true;
  try {
    const hits = await (await ctx.providers.contacts()).searchContacts(a, 5);
    return hits.some((c) => c.emails.some((e) => e.toLowerCase() === a));
  } catch {
    return false;
  }
}

/** Returns why this concrete call must not run autonomously, or null if it may. */
export async function autonomyBlock(tool: ToolDefinition, input: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
  if (NEVER_AUTONOMOUS.has(tool.name)) return `${tool.name} wird nie automatisch ausgeführt.`;
  const list = (k: string) => (Array.isArray(input[k]) ? (input[k] as string[]) : []);
  if (["send_email", "reply_email", "forward_email"].includes(tool.name)) {
    const recipients = [...list("to"), ...list("cc"), ...list("bcc")];
    for (const r of recipients) if (!(await isKnownRecipient(r, ctx))) return `Neuer/unbekannter Empfänger ${r} — E-Mails an fremde Adressen nur mit Bestätigung.`;
  }
  if ((tool.name === "create_event" || tool.name === "update_event") && (list("attendees").length || input.has_attendees)) {
    return "Termine mit Gästen nur mit Bestätigung.";
  }
  if (tool.name === "delete_file") {
    const f = await ctx.providers.files.get(String(input.file_id)).catch(() => undefined);
    if (!f || f.storage !== "drive") return "Diese Datei hat keinen Papierkorb — Löschen nur mit Bestätigung.";
  }
  return null;
}
