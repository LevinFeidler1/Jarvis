import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { ToolError } from "../core/types.js";
import type { BrowserStep, PageState } from "./types.js";

export interface BrowserTask {
  id: string;
  conversationId: string;
  steps: BrowserStep[];
  last: PageState | null;
  calls: number;
  createdAt: string;
}

const TASK_TTL_MS = 30 * 60_000;

/** Recorded browser tasks: the steps (for replays/confirmation) and the last page state (for risk checks). */
export class BrowserTaskStore {
  constructor(
    private readonly db: Db,
    readonly maxSteps: number,
    readonly taskMinutes = 15,
  ) {}

  async create(conversationId: string): Promise<BrowserTask> {
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run("INSERT INTO browser_tasks (id, conversation_id, steps_json, last_json, calls, created_at, updated_at) VALUES ($1, $2, '[]', NULL, 0, $3, $3)", [id, conversationId, ts]);
    await this.db.run("DELETE FROM browser_tasks WHERE updated_at < $1", [new Date(Date.now() - 24 * 3600_000).toISOString()]);
    return { id, conversationId, steps: [], last: null, calls: 0, createdAt: ts };
  }

  async get(id: string, conversationId?: string): Promise<BrowserTask> {
    const r = await this.db.one<{ id: string; conversation_id: string; steps_json: string; last_json: string | null; calls: number; created_at: string; updated_at: string }>(
      "SELECT * FROM browser_tasks WHERE id = $1",
      [id],
    );
    if (!r || (conversationId && r.conversation_id !== conversationId)) throw new ToolError("Browser-Aufgabe nicht gefunden — mit open_page neu starten.", "NOT_FOUND");
    if (Date.now() - Date.parse(r.updated_at) > TASK_TTL_MS) throw new ToolError("Browser-Aufgabe ist abgelaufen (30 Min.) — mit open_page neu starten.", "NOT_FOUND");
    return { id: r.id, conversationId: r.conversation_id, steps: JSON.parse(r.steps_json), last: r.last_json ? JSON.parse(r.last_json) : null, calls: r.calls, createdAt: r.created_at };
  }

  async save(task: BrowserTask): Promise<void> {
    await this.db.run("UPDATE browser_tasks SET steps_json = $1, last_json = $2, calls = $3, updated_at = $4 WHERE id = $5", [
      JSON.stringify(task.steps),
      task.last ? JSON.stringify(task.last) : null,
      task.calls,
      nowIso(),
      task.id,
    ]);
  }

  /** Step limit per task (SECURITY: no endless browsing). */
  assertBudget(task: BrowserTask): void {
    if (task.calls >= this.maxSteps) throw new ToolError(`Schrittlimit (${this.maxSteps}) für diese Browser-Aufgabe erreicht.`, "INVALID_INPUT");
    if (Date.now() - Date.parse(task.createdAt) > this.taskMinutes * 60_000) {
      throw new ToolError(`Zeitlimit (${this.taskMinutes} Min.) für diese Browser-Aufgabe erreicht.`, "INVALID_INPUT");
    }
  }
}
