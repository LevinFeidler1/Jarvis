import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import type { RiskLevel } from "./types.js";

export type PendingStatus = "pending" | "approved" | "rejected" | "expired";

export interface PendingAction {
  id: string;
  conversationId: string;
  activityId: string;
  toolName: string;
  input: unknown;
  description: string;
  risk: RiskLevel;
  reasons: string[];
  status: PendingStatus;
  createdAt: string;
  expiresAt: string;
}

interface Row {
  id: string;
  conversation_id: string;
  activity_id: string;
  tool_name: string;
  input_json: string;
  description: string;
  risk: number;
  reasons_json: string;
  status: PendingStatus;
  created_at: string;
  expires_at: string;
}

function fromRow(r: Row): PendingAction {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    activityId: r.activity_id,
    toolName: r.tool_name,
    input: JSON.parse(r.input_json),
    description: r.description,
    risk: r.risk as RiskLevel,
    reasons: JSON.parse(r.reasons_json),
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

/**
 * Stores actions that wait for user approval. The stored input is what gets
 * executed on approval — the model cannot alter it afterwards.
 */
export class ConfirmationStore {
  constructor(
    private readonly db: Db,
    private readonly ttlMinutes: number,
  ) {}

  create(input: Omit<PendingAction, "id" | "status" | "createdAt" | "expiresAt">, now = new Date()): PendingAction {
    const id = randomUUID();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60_000).toISOString();
    this.db
      .prepare(
        `INSERT INTO pending_actions (id, conversation_id, activity_id, tool_name, input_json, description, risk, reasons_json, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.activityId,
        input.toolName,
        JSON.stringify(input.input),
        input.description,
        input.risk,
        JSON.stringify(input.reasons),
        createdAt,
        expiresAt,
      );
    return { ...input, id, status: "pending", createdAt, expiresAt };
  }

  get(id: string): PendingAction | undefined {
    const row = this.db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  /** Pending actions, oldest first. Expired ones are returned with status "expired" once. */
  listPending(conversationId?: string): PendingAction[] {
    const rows = (
      conversationId
        ? this.db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' AND conversation_id = ? ORDER BY created_at").all(conversationId)
        : this.db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at").all()
    ) as unknown as Row[];
    return rows.map(fromRow);
  }

  /** Atomically moves pending → new status. Returns false if it was not pending. */
  resolve(id: string, status: Exclude<PendingStatus, "pending">): boolean {
    const res = this.db
      .prepare("UPDATE pending_actions SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, nowIso(), id);
    return Number(res.changes) === 1;
  }

  isExpired(action: PendingAction, now = new Date()): boolean {
    return new Date(action.expiresAt).getTime() <= now.getTime();
  }
}
