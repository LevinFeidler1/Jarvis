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

const SELECT = `SELECT id, category, key, value, source, confidence, created_at AS "createdAt", updated_at AS "updatedAt" FROM memory`;

/**
 * Structured, user-controllable memory (ARCHITECTURE.md §7).
 * Every entry records where it came from and how certain it is.
 */
export class MemoryStore {
  constructor(private readonly db: Db) {}

  async upsert(input: { category: MemoryCategory; key: string; value: string; source: MemorySource; confidence?: number }): Promise<MemoryEntry> {
    const key = input.key.trim();
    const confidence = input.confidence ?? (input.source === "user" ? 1 : 0.6);
    const existing = await this.db.one<MemoryEntry>(`${SELECT} WHERE category = $1 AND key = $2`, [input.category, key]);
    const ts = nowIso();
    if (existing) {
      // An inferred fact never overwrites something the user stated explicitly.
      if (existing.source === "user" && input.source === "inferred") return existing;
      await this.db.run("UPDATE memory SET value = $1, source = $2, confidence = $3, updated_at = $4 WHERE id = $5", [
        input.value,
        input.source,
        confidence,
        ts,
        existing.id,
      ]);
      return { ...existing, value: input.value, source: input.source, confidence, updatedAt: ts };
    }
    const id = randomUUID();
    await this.db.run(
      "INSERT INTO memory (id, category, key, value, source, confidence, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, input.category, key, input.value, input.source, confidence, ts, ts],
    );
    return { id, category: input.category, key, value: input.value, source: input.source, confidence, createdAt: ts, updatedAt: ts };
  }

  list(category?: MemoryCategory): Promise<MemoryEntry[]> {
    return category
      ? this.db.query<MemoryEntry>(`${SELECT} WHERE category = $1 ORDER BY key`, [category])
      : this.db.query<MemoryEntry>(`${SELECT} ORDER BY category, key`);
  }

  search(query: string): Promise<MemoryEntry[]> {
    const q = `%${query.trim().toLowerCase()}%`;
    return this.db.query<MemoryEntry>(`${SELECT} WHERE lower(key) LIKE $1 OR lower(value) LIKE $1 ORDER BY category, key LIMIT 50`, [q]);
  }

  get(id: string): Promise<MemoryEntry | undefined> {
    return this.db.one<MemoryEntry>(`${SELECT} WHERE id = $1`, [id]);
  }

  async update(id: string, patch: { value?: string; key?: string; category?: MemoryCategory }): Promise<MemoryEntry | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, source: "user" as const, confidence: 1, updatedAt: nowIso() };
    await this.db.run(
      "UPDATE memory SET category = $1, key = $2, value = $3, source = $4, confidence = $5, updated_at = $6 WHERE id = $7",
      [next.category, next.key, next.value, next.source, next.confidence, next.updatedAt, id],
    );
    return next;
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM memory WHERE id = $1", [id])) === 1;
  }

  /** Compact memory block for the system context. Uncertain entries are labelled. */
  async renderForPrompt(limit = 200): Promise<string> {
    const entries = (await this.list()).slice(0, limit);
    if (entries.length === 0) return "(noch keine Einträge)";
    return entries
      .map((e) => {
        const certainty = e.source === "user" ? "" : ` [unsicher, abgeleitet, confidence ${e.confidence.toFixed(1)}]`;
        return `- ${e.category} · ${e.key}: ${e.value}${certainty}`;
      })
      .join("\n");
  }
}
