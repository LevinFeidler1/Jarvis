import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database.js";
import { nowIso } from "../../db/database.js";
import { ToolError } from "../../core/types.js";
import type { NotificationProvider, Reminder, Task, TaskPriority, TaskProvider, TaskStatus } from "../types.js";

const TASK_SELECT = `SELECT id, title, notes, due, priority, status, project, created_at AS createdAt,
  updated_at AS updatedAt, completed_at AS completedAt FROM tasks`;

/** Real, persistent task list stored in the local database. */
export class LocalTaskProvider implements TaskProvider {
  readonly name = "JARVIS (lokal)";
  constructor(private readonly db: Db) {}

  async list(filter: { status?: TaskStatus | "all"; dueBefore?: string; project?: string }): Promise<Task[]> {
    const where: string[] = [];
    const params: string[] = [];
    const status = filter.status ?? "open";
    if (status !== "all") {
      where.push("status = ?");
      params.push(status);
    }
    if (filter.dueBefore) {
      where.push("due IS NOT NULL AND due <= ?");
      params.push(filter.dueBefore);
    }
    if (filter.project) {
      where.push("lower(project) = lower(?)");
      params.push(filter.project);
    }
    const sql = `${TASK_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY status, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due IS NULL, due, created_at`;
    return this.db.prepare(sql).all(...params) as unknown as Task[];
  }

  private get(id: string): Task {
    const t = this.db.prepare(`${TASK_SELECT} WHERE id = ?`).get(id) as Task | undefined;
    if (!t) throw new ToolError(`Aufgabe ${id} nicht gefunden`, "NOT_FOUND");
    return t;
  }

  async create(input: { title: string; notes?: string; due?: string; priority?: TaskPriority; project?: string }): Promise<Task> {
    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        "INSERT INTO tasks (id, title, notes, due, priority, status, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
      )
      .run(id, input.title, input.notes ?? null, input.due ?? null, input.priority ?? "normal", input.project ?? null, ts, ts);
    return this.get(id);
  }

  async update(
    id: string,
    patch: { title?: string; notes?: string | null; due?: string | null; priority?: TaskPriority; project?: string | null },
  ): Promise<Task> {
    const t = this.get(id);
    const next = { ...t, ...patch };
    this.db
      .prepare("UPDATE tasks SET title = ?, notes = ?, due = ?, priority = ?, project = ?, updated_at = ? WHERE id = ?")
      .run(next.title, next.notes, next.due, next.priority, next.project, nowIso(), id);
    return this.get(id);
  }

  async complete(id: string): Promise<Task> {
    this.get(id);
    const ts = nowIso();
    this.db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, id);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    this.get(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
}

const REMINDER_SELECT = "SELECT id, text, remind_at AS remindAt, status, created_at AS createdAt FROM reminders";

export class ReminderStore {
  constructor(private readonly db: Db) {}

  create(text: string, remindAt: string): Reminder {
    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare("INSERT INTO reminders (id, text, remind_at, status, created_at) VALUES (?, ?, ?, 'scheduled', ?)")
      .run(id, text, remindAt, ts);
    return { id, text, remindAt, status: "scheduled", createdAt: ts };
  }

  list(status: Reminder["status"] | "all" = "scheduled"): Reminder[] {
    return (
      status === "all"
        ? this.db.prepare(`${REMINDER_SELECT} ORDER BY remind_at`).all()
        : this.db.prepare(`${REMINDER_SELECT} WHERE status = ? ORDER BY remind_at`).all(status)
    ) as unknown as Reminder[];
  }

  cancel(id: string): boolean {
    return Number(this.db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'").run(id).changes) === 1;
  }

  /** Marks due reminders as fired and returns them. */
  takeDue(now: Date): Reminder[] {
    const due = this.db
      .prepare(`${REMINDER_SELECT} WHERE status = 'scheduled' AND remind_at <= ? ORDER BY remind_at`)
      .all(now.toISOString()) as unknown as Reminder[];
    const mark = this.db.prepare("UPDATE reminders SET status = 'fired' WHERE id = ? AND status = 'scheduled'");
    return due.filter((r) => Number(mark.run(r.id).changes) === 1);
  }
}

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

/** In-app notifications shown in the UI. Push/e-mail/voice channels come later. */
export class InAppNotificationProvider implements NotificationProvider {
  readonly name = "In-App";
  constructor(private readonly db: Db) {}

  async notify(title: string, body?: string): Promise<{ id: string }> {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO notifications (id, title, body, read, created_at) VALUES (?, ?, ?, 0, ?)")
      .run(id, title, body ?? null, nowIso());
    return { id };
  }

  list(unreadOnly = false, limit = 50): AppNotification[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, body, read, created_at AS createdAt FROM notifications ${unreadOnly ? "WHERE read = 0" : ""} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Omit<AppNotification, "read"> & { read: number }>;
    return rows.map((r) => ({ ...r, read: r.read === 1 }));
  }

  markRead(id: string): void {
    this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
  }
}
