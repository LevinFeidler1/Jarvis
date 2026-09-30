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
  }): Promise<Activity> {
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO activity (id, conversation_id, tool_name, description, risk, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, input.conversationId, input.toolName, input.description, input.risk, input.status, ts, ts],
    );
    return { id, ...input, error: null, createdAt: ts, updatedAt: ts };
  }

  async update(id: string, status: ActionStatus, error?: string): Promise<void> {
    await this.db.run("UPDATE activity SET status = $1, error = $2, updated_at = $3 WHERE id = $4", [status, error ?? null, nowIso(), id]);
  }

  async list(limit = 100): Promise<Activity[]> {
    return this.db.query<Activity>(
      `SELECT id, conversation_id AS "conversationId", tool_name AS "toolName", description, risk, status, error,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM activity ORDER BY seq DESC LIMIT $1`,
      [limit],
    );
  }
}
