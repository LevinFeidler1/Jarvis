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

  async create(input: Omit<PendingAction, "id" | "status" | "createdAt" | "expiresAt">, now = new Date()): Promise<PendingAction> {
    const id = randomUUID();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60_000).toISOString();
    await this.db.run(
      `INSERT INTO pending_actions (id, conversation_id, activity_id, tool_name, input_json, description, risk, reasons_json, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)`,
      [
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
      ],
    );
    return { ...input, id, status: "pending", createdAt, expiresAt };
  }

  async get(id: string): Promise<PendingAction | undefined> {
    const row = await this.db.one<Row>("SELECT * FROM pending_actions WHERE id = $1", [id]);
    return row ? fromRow(row) : undefined;
  }

  /** Pending actions, oldest first. */
  async listPending(conversationId?: string): Promise<PendingAction[]> {
    const rows = conversationId
      ? await this.db.query<Row>("SELECT * FROM pending_actions WHERE status = 'pending' AND conversation_id = $1 ORDER BY created_at", [conversationId])
      : await this.db.query<Row>("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at");
    return rows.map(fromRow);
  }

  /** Atomically moves pending → new status. Returns false if it was not pending. */
  async resolve(id: string, status: Exclude<PendingStatus, "pending">): Promise<boolean> {
    const changed = await this.db.run(
      "UPDATE pending_actions SET status = $1, resolved_at = $2 WHERE id = $3 AND status = 'pending'",
      [status, nowIso(), id],
    );
    return changed === 1;
  }

  isExpired(action: PendingAction, now = new Date()): boolean {
    return new Date(action.expiresAt).getTime() <= now.getTime();
  }
}
