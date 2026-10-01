import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import type { ActionStatus, RiskLevel } from "./types.js";

export interface Activity {
  id: string;
  conversationId: string | null;
  toolName: string;
  description: string;
  risk: RiskLevel;
  status: ActionStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  automationId?: string | null;
  autonomous?: boolean;
  /** An inverse action exists and was not used yet. */
  canUndo?: boolean;
  undoneAt?: string | null;
}

export interface UndoAction {
  tool: string;
  input: Record<string, unknown>;
  label: string;
}

export type ActivityListener = (a: Activity) => void;

/** Tracks the lifecycle of every tool call for the Activity view. */
export class ActivityLog {
  constructor(private readonly db: Db) {}

  async create(input: {
    conversationId: string | null;
    toolName: string;
    description: string;
    risk: RiskLevel;
    status: ActionStatus;
    automationId?: string | null;
    autonomous?: boolean;
  }): Promise<Activity> {
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO activity (id, conversation_id, tool_name, description, risk, status, automation_id, autonomous, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, input.conversationId, input.toolName, input.description, input.risk, input.status, input.automationId ?? null, input.autonomous ?? false, ts, ts],
    );
    return { id, ...input, error: null, createdAt: ts, updatedAt: ts };
  }

  async setUndo(id: string, undo: UndoAction): Promise<void> {
    await this.db.run("UPDATE activity SET undo_json = $1 WHERE id = $2", [JSON.stringify(undo), id]);
  }

  async getUndo(id: string): Promise<{ undo: UndoAction; conversationId: string | null } | undefined> {
    const r = await this.db.one<{ undo_json: string | null; undone_at: string | null; conversation_id: string | null }>(
      "SELECT undo_json, undone_at, conversation_id FROM activity WHERE id = $1",
      [id],
    );
    if (!r?.undo_json || r.undone_at) return undefined;
    return { undo: JSON.parse(r.undo_json) as UndoAction, conversationId: r.conversation_id };
  }

  async markUndone(id: string): Promise<boolean> {
    return (await this.db.run("UPDATE activity SET undone_at = $1 WHERE id = $2 AND undone_at IS NULL", [nowIso(), id])) === 1;
  }

  async countAutonomousInConversation(conversationId: string): Promise<number> {
    const r = await this.db.one<{ n: string | number }>(
      "SELECT count(*) AS n FROM activity WHERE conversation_id = $1 AND autonomous AND status IN ('succeeded', 'partially_succeeded')",
      [conversationId],
    );
    return Number(r?.n ?? 0);
  }

  /** Write actions an automation performed on its own since `sinceIso`. */
  async countAutonomous(automationId: string, sinceIso: string): Promise<number> {
    const r = await this.db.one<{ n: string | number }>(
      "SELECT count(*) AS n FROM activity WHERE automation_id = $1 AND autonomous AND created_at >= $2 AND status NOT IN ('failed', 'denied')",
      [automationId, sinceIso],
    );
    return Number(r?.n ?? 0);
  }

  async update(id: string, status: ActionStatus, error?: string): Promise<void> {
    await this.db.run("UPDATE activity SET status = $1, error = $2, updated_at = $3 WHERE id = $4", [status, error ?? null, nowIso(), id]);
  }

  async list(limit = 100): Promise<Activity[]> {
    return this.db.query<Activity>(
      `SELECT id, conversation_id AS "conversationId", tool_name AS "toolName", description, risk, status, error,
              created_at AS "createdAt", updated_at AS "updatedAt", automation_id AS "automationId", autonomous,
              (undo_json IS NOT NULL AND undone_at IS NULL) AS "canUndo", undone_at AS "undoneAt"
       FROM activity ORDER BY seq DESC LIMIT $1`,
      [limit],
    );
  }
}
