import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database.js";
import { nowIso } from "../../db/database.js";
import { ToolError } from "../../core/types.js";
import type { PushService } from "../push.js";
import type { NotificationProvider, NotifyOptions, Reminder, Task, TaskPriority, TaskProvider, TaskStatus } from "../types.js";

const TASK_SELECT = `SELECT id, title, notes, due, priority, status, project, created_at AS "createdAt",
  updated_at AS "updatedAt", completed_at AS "completedAt" FROM tasks`;

/** Real, persistent task list stored in the JARVIS database. */
export class LocalTaskProvider implements TaskProvider {
  readonly name = "JARVIS (lokal)";
  constructor(private readonly db: Db) {}

  async list(filter: { status?: TaskStatus | "all"; dueBefore?: string; project?: string }): Promise<Task[]> {
    const where: string[] = [];
    const params: string[] = [];
    const status = filter.status ?? "open";
    if (status !== "all") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (filter.dueBefore) {
      params.push(filter.dueBefore);
      where.push(`due IS NOT NULL AND due <= $${params.length}`);
    }
    if (filter.project) {
      params.push(filter.project);
      where.push(`lower(project) = lower($${params.length})`);
    }
    const sql = `${TASK_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY status DESC, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due IS NULL, due, created_at`;
    return this.db.query<Task>(sql, params);
  }

  private async get(id: string): Promise<Task> {
    const t = await this.db.one<Task>(`${TASK_SELECT} WHERE id = $1`, [id]);
    if (!t) throw new ToolError(`Aufgabe ${id} nicht gefunden`, "NOT_FOUND");
    return t;
  }

  async create(input: { title: string; notes?: string; due?: string; priority?: TaskPriority; project?: string }): Promise<Task> {
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run(
      "INSERT INTO tasks (id, title, notes, due, priority, status, project, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8)",
      [id, input.title, input.notes ?? null, input.due ?? null, input.priority ?? "normal", input.project ?? null, ts, ts],
    );
    return this.get(id);
  }

  async update(
    id: string,
    patch: { title?: string; notes?: string | null; due?: string | null; priority?: TaskPriority; project?: string | null },
  ): Promise<Task> {
    const t = await this.get(id);
    const next = { ...t, ...patch };
    await this.db.run("UPDATE tasks SET title = $1, notes = $2, due = $3, priority = $4, project = $5, updated_at = $6 WHERE id = $7", [
      next.title,
      next.notes,
      next.due,
      next.priority,
      next.project,
      nowIso(),
      id,
    ]);
    return this.get(id);
  }

  async complete(id: string): Promise<Task> {
    await this.get(id);
    const ts = nowIso();
    await this.db.run("UPDATE tasks SET status = 'done', completed_at = $1, updated_at = $1 WHERE id = $2", [ts, id]);
    return this.get(id);
  }

  async reopen(id: string): Promise<Task> {
    await this.get(id);
    await this.db.run("UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = $1 WHERE id = $2", [nowIso(), id]);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.db.run("DELETE FROM tasks WHERE id = $1", [id]);
  }
}

const REMINDER_SELECT = `SELECT id, text, remind_at AS "remindAt", status, created_at AS "createdAt" FROM reminders`;

export class ReminderStore {
  constructor(private readonly db: Db) {}

  async create(text: string, remindAt: string): Promise<Reminder> {
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run("INSERT INTO reminders (id, text, remind_at, status, created_at) VALUES ($1, $2, $3, 'scheduled', $4)", [
      id,
      text,
      remindAt,
      ts,
    ]);
    return { id, text, remindAt, status: "scheduled", createdAt: ts };
  }

  list(status: Reminder["status"] | "all" = "scheduled"): Promise<Reminder[]> {
    return status === "all"
      ? this.db.query<Reminder>(`${REMINDER_SELECT} ORDER BY remind_at`)
      : this.db.query<Reminder>(`${REMINDER_SELECT} WHERE status = $1 ORDER BY remind_at`, [status]);
  }

  async cancel(id: string): Promise<boolean> {
    return (await this.db.run("UPDATE reminders SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled'", [id])) === 1;
  }

  /** Atomically marks due reminders as fired and returns them (safe across instances). */
  takeDue(now: Date): Promise<Reminder[]> {
    return this.db.query<Reminder>(
      `UPDATE reminders SET status = 'fired' WHERE status = 'scheduled' AND remind_at <= $1
       RETURNING id, text, remind_at AS "remindAt", status, created_at AS "createdAt"`,
      [now.toISOString()],
    );
  }
}

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

/** In-app notifications shown in the UI, mirrored as Web Push to the user's devices. */
export class InAppNotificationProvider implements NotificationProvider {
  readonly name = "In-App + Push";
  private mirrors: Array<(title: string, body: string | undefined, opts: NotifyOptions) => Promise<unknown>> = [];

  constructor(
    private readonly db: Db,
    private readonly push?: PushService,
  ) {}

  /** Additional channel (Telegram) that receives every notification, best effort. */
  addMirror(fn: (title: string, body: string | undefined, opts: NotifyOptions) => Promise<unknown>): void {
    this.mirrors.push(fn);
  }

  async notify(title: string, body?: string, opts: NotifyOptions = {}): Promise<{ id: string; pushed?: number }> {
    const id = randomUUID();
    await this.db.run("INSERT INTO notifications (id, title, body, read, created_at) VALUES ($1, $2, $3, FALSE, $4)", [
      id,
      title,
      body ?? null,
      nowIso(),
    ]);
    // Push is best effort: the in-app notification is already stored.
    const pushed = this.push ? (await this.push.send({ title, body, url: opts.url, tag: opts.tag }).catch(() => ({ sent: 0 }))).sent : undefined;
    for (const m of this.mirrors) await m(title, body, opts).catch(() => undefined);
    return { id, pushed };
  }

  list(unreadOnly = false, limit = 50): Promise<AppNotification[]> {
    return this.db.query<AppNotification>(
      `SELECT id, title, body, read, created_at AS "createdAt" FROM notifications ${unreadOnly ? "WHERE read = FALSE" : ""}
       ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
  }

  async markRead(id: string): Promise<void> {
    await this.db.run("UPDATE notifications SET read = TRUE WHERE id = $1", [id]);
  }

  async markAllRead(): Promise<void> {
    await this.db.run("UPDATE notifications SET read = TRUE WHERE read = FALSE");
  }
}
