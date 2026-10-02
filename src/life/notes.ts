import { randomUUID } from "node:crypto";
import { type Db, nowIso } from "../db/database.js";
import { ToolError } from "../core/types.js";

export interface Note {
  id: string;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  text: string;
  done: boolean;
}

export interface List {
  id: string;
  name: string;
  items: ListItem[];
  open: number;
}

const NOTE_COLS = `id, title, body, pinned, created_at AS "createdAt", updated_at AS "updatedAt"`;

/** "Einkaufsliste", "einkauf", "Einkäufe" → one key, so "auf die Einkaufsliste" finds the list. */
export function listKey(name: string): string {
  let k = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ");
  k = k.replace(/\b(meine|meiner|meinen|die|der|das|auf|zur|zum|liste|list)\b/g, " ").replace(/\s+/g, "");
  k = k.replace(/s?liste?$/, "").replace(/(en|e|s)$/, "");
  return k || "liste";
}

/** Notes and checklists kept in JARVIS (shopping list, packing list, ideas …). */
export class NotesStore {
  constructor(private readonly db: Db) {}

  // ─── Notes ────────────────────────────────────────────────────────────
  async addNote(input: { title?: string; body: string; pinned?: boolean }): Promise<Note> {
    const now = nowIso();
    const id = randomUUID();
    await this.db.run("INSERT INTO notes (id, title, body, pinned, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)", [id, input.title ?? null, input.body, !!input.pinned, now]);
    return (await this.getNote(id))!;
  }

  async getNote(id: string): Promise<Note | undefined> {
    return this.db.one<Note>(`SELECT ${NOTE_COLS} FROM notes WHERE id = $1`, [id]);
  }

  async updateNote(id: string, patch: { title?: string | null; body?: string; pinned?: boolean }): Promise<Note> {
    const cur = await this.getNote(id);
    if (!cur) throw new ToolError("Notiz nicht gefunden.", "NOT_FOUND");
    await this.db.run("UPDATE notes SET title = $2, body = $3, pinned = $4, updated_at = $5 WHERE id = $1", [
      id, patch.title === undefined ? cur.title : patch.title, patch.body ?? cur.body, patch.pinned ?? cur.pinned, nowIso(),
    ]);
    return (await this.getNote(id))!;
  }

  async deleteNote(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM notes WHERE id = $1", [id])) > 0;
  }

  async listNotes(query?: string, limit = 50): Promise<Note[]> {
    if (query?.trim()) {
      const like = `%${query.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      return this.db.query<Note>(`SELECT ${NOTE_COLS} FROM notes WHERE lower(coalesce(title, '') || ' ' || body) LIKE $1 ORDER BY pinned DESC, updated_at DESC LIMIT $2`, [like, limit]);
    }
    return this.db.query<Note>(`SELECT ${NOTE_COLS} FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT $1`, [limit]);
  }

  // ─── Lists ────────────────────────────────────────────────────────────
  private async ensureList(name: string): Promise<{ id: string; name: string }> {
    const key = listKey(name);
    const found = await this.db.one<{ id: string; name: string }>("SELECT id, name FROM lists WHERE name_key = $1", [key]);
    if (found) return found;
    const id = randomUUID();
    const pretty = name.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 80);
    await this.db.run("INSERT INTO lists (id, name, name_key, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (name_key) DO NOTHING", [id, pretty, key, nowIso()]);
    return (await this.db.one<{ id: string; name: string }>("SELECT id, name FROM lists WHERE name_key = $1", [key]))!;
  }

  /** Adds items; duplicates of open items are skipped ("Milch" twice stays once). */
  async addToList(name: string, items: string[]): Promise<List> {
    const list = await this.ensureList(name);
    const existing = await this.db.query<{ text: string }>("SELECT text FROM list_items WHERE list_id = $1 AND done = FALSE", [list.id]);
    const seen = new Set(existing.map((e) => e.text.toLowerCase()));
    const max = await this.db.one<{ m: number | null }>("SELECT max(position) AS m FROM list_items WHERE list_id = $1", [list.id]);
    let pos = Number(max?.m ?? 0);
    for (const raw of items) {
      const text = raw.trim().slice(0, 200);
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      await this.db.run("INSERT INTO list_items (id, list_id, text, done, position, created_at) VALUES ($1, $2, $3, FALSE, $4, $5)", [randomUUID(), list.id, text, ++pos, nowIso()]);
    }
    return (await this.getList(list.name))!;
  }

  async getList(name: string, includeDone = false): Promise<List | undefined> {
    const list = await this.db.one<{ id: string; name: string }>("SELECT id, name FROM lists WHERE name_key = $1", [listKey(name)]);
    if (!list) return undefined;
    return this.withItems(list, includeDone);
  }

  private async withItems(list: { id: string; name: string }, includeDone: boolean): Promise<List> {
    const items = await this.db.query<ListItem>(
      `SELECT id, text, done FROM list_items WHERE list_id = $1 ${includeDone ? "" : "AND done = FALSE"} ORDER BY done, position`,
      [list.id],
    );
    const open = await this.db.one<{ n: number }>("SELECT count(*)::int AS n FROM list_items WHERE list_id = $1 AND done = FALSE", [list.id]);
    return { id: list.id, name: list.name, items, open: Number(open?.n ?? 0) };
  }

  async allLists(includeDone = false): Promise<List[]> {
    const lists = await this.db.query<{ id: string; name: string }>("SELECT id, name FROM lists ORDER BY created_at");
    return Promise.all(lists.map((l) => this.withItems(l, includeDone)));
  }

  /** Checks items off by id or (case-insensitive) text. Returns how many changed. */
  async setDone(listName: string, items: string[], done = true): Promise<number> {
    const list = await this.getList(listName, true);
    if (!list) throw new ToolError(`Liste „${listName}“ gibt es nicht.`, "NOT_FOUND");
    let n = 0;
    for (const it of items) {
      const target = list.items.find((x) => x.id === it) ?? list.items.find((x) => x.text.toLowerCase() === it.trim().toLowerCase() && x.done !== done);
      if (!target) continue;
      n += await this.db.run("UPDATE list_items SET done = $2, done_at = $3 WHERE id = $1", [target.id, done, done ? nowIso() : null]);
    }
    return n;
  }

  async toggleItem(itemId: string, done: boolean): Promise<boolean> {
    return (await this.db.run("UPDATE list_items SET done = $2, done_at = $3 WHERE id = $1", [itemId, done, done ? nowIso() : null])) > 0;
  }

  async removeItem(itemId: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM list_items WHERE id = $1", [itemId])) > 0;
  }

  /** Removes checked items ("Liste aufräumen"). */
  async clearDone(listName: string): Promise<number> {
    const list = await this.getList(listName, true);
    if (!list) return 0;
    return this.db.run("DELETE FROM list_items WHERE list_id = $1 AND done = TRUE", [list.id]);
  }
}
