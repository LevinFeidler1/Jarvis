import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";

export const MEMORY_CATEGORIES = ["preference", "person", "project", "rule", "fact"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemorySource = "user" | "inferred";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

const SELECT = `SELECT id, category, key, value, source, confidence, created_at AS createdAt, updated_at AS updatedAt FROM memory`;

/**
 * Structured, user-controllable memory (ARCHITECTURE.md §7).
 * Every entry records where it came from and how certain it is.
 */
export class MemoryStore {
  constructor(private readonly db: Db) {}

  upsert(input: { category: MemoryCategory; key: string; value: string; source: MemorySource; confidence?: number }): MemoryEntry {
    const key = input.key.trim();
    const confidence = input.confidence ?? (input.source === "user" ? 1 : 0.6);
    const existing = this.db.prepare(`${SELECT} WHERE category = ? AND key = ?`).get(input.category, key) as
      | MemoryEntry
      | undefined;
    const ts = nowIso();
    if (existing) {
      // An inferred fact never overwrites something the user stated explicitly.
      if (existing.source === "user" && input.source === "inferred") return existing;
      this.db
        .prepare("UPDATE memory SET value = ?, source = ?, confidence = ?, updated_at = ? WHERE id = ?")
        .run(input.value, input.source, confidence, ts, existing.id);
      return { ...existing, value: input.value, source: input.source, confidence, updatedAt: ts };
    }
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO memory (id, category, key, value, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.category, key, input.value, input.source, confidence, ts, ts);
    return { id, category: input.category, key, value: input.value, source: input.source, confidence, createdAt: ts, updatedAt: ts };
  }

  list(category?: MemoryCategory): MemoryEntry[] {
    const rows = category
      ? this.db.prepare(`${SELECT} WHERE category = ? ORDER BY key`).all(category)
      : this.db.prepare(`${SELECT} ORDER BY category, key`).all();
    return rows as unknown as MemoryEntry[];
  }

  search(query: string): MemoryEntry[] {
    const q = `%${query.trim().toLowerCase()}%`;
    return this.db
      .prepare(`${SELECT} WHERE lower(key) LIKE ? OR lower(value) LIKE ? ORDER BY category, key LIMIT 50`)
      .all(q, q) as unknown as MemoryEntry[];
  }

  get(id: string): MemoryEntry | undefined {
    return this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as MemoryEntry | undefined;
  }

  update(id: string, patch: { value?: string; key?: string; category?: MemoryCategory }): MemoryEntry | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, source: "user" as const, confidence: 1, updatedAt: nowIso() };
    this.db
      .prepare("UPDATE memory SET category = ?, key = ?, value = ?, source = ?, confidence = ?, updated_at = ? WHERE id = ?")
      .run(next.category, next.key, next.value, next.source, next.confidence, next.updatedAt, id);
    return next;
  }

  delete(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM memory WHERE id = ?").run(id).changes) === 1;
  }

  /** Compact memory block for the system context. Uncertain entries are labelled. */
  renderForPrompt(limit = 200): string {
    const entries = this.list().slice(0, limit);
    if (entries.length === 0) return "(noch keine Einträge)";
    return entries
      .map((e) => {
        const certainty = e.source === "user" ? "" : ` [unsicher, abgeleitet, confidence ${e.confidence.toFixed(1)}]`;
        return `- ${e.category} · ${e.key}: ${e.value}${certainty}`;
      })
      .join("\n");
  }
}
