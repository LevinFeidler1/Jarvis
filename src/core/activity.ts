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
}

/** Tracks the lifecycle of every tool call for the Activity view. */
export class ActivityLog {
  constructor(private readonly db: Db) {}

  create(input: { conversationId: string | null; toolName: string; description: string; risk: RiskLevel; status: ActionStatus }): Activity {
    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO activity (id, conversation_id, tool_name, description, risk, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.conversationId, input.toolName, input.description, input.risk, input.status, ts, ts);
    return { id, ...input, error: null, createdAt: ts, updatedAt: ts };
  }

  update(id: string, status: ActionStatus, error?: string): void {
    this.db
      .prepare("UPDATE activity SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, nowIso(), id);
  }

  list(limit = 100): Activity[] {
    return this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, tool_name AS toolName, description, risk, status, error,
                created_at AS createdAt, updated_at AS updatedAt
         FROM activity ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit) as unknown as Activity[];
  }
}
