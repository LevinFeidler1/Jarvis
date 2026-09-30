import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import type { LlmMessage } from "./llm.js";

export interface ConversationInfo {
  id: string;
  title: string | null;
  tainted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

/**
 * Append-only conversation history. Assistant content (incl. thinking blocks)
 * is stored verbatim so it can be replayed unchanged to the API.
 */
export class ConversationStore {
  constructor(private readonly db: Db) {}

  create(title?: string): ConversationInfo {
    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare("INSERT INTO conversations (id, title, tainted, created_at, updated_at) VALUES (?, ?, 0, ?, ?)")
      .run(id, title ?? null, ts, ts);
    return { id, title: title ?? null, tainted: false, createdAt: ts, updatedAt: ts };
  }

  get(id: string): ConversationInfo | undefined {
    const r = this.db
      .prepare("SELECT id, title, tainted, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id = ?")
      .get(id) as (Omit<ConversationInfo, "tainted"> & { tainted: number }) | undefined;
    return r ? { ...r, tainted: r.tainted === 1 } : undefined;
  }

  list(limit = 50): ConversationInfo[] {
    const rows = this.db
      .prepare("SELECT id, title, tainted, created_at AS createdAt, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Array<Omit<ConversationInfo, "tainted"> & { tainted: number }>;
    return rows.map((r) => ({ ...r, tainted: r.tainted === 1 }));
  }

  markTainted(id: string): void {
    this.db.prepare("UPDATE conversations SET tainted = 1 WHERE id = ?").run(id);
  }

  append(conversationId: string, message: LlmMessage, displayText: string | null): void {
    const ts = nowIso();
    this.db
      .prepare("INSERT INTO messages (conversation_id, role, content_json, display_text, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(conversationId, message.role, JSON.stringify(message.content), displayText, ts);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, conversationId);
    if (displayText && message.role === "user") {
      this.db
        .prepare("UPDATE conversations SET title = ? WHERE id = ? AND title IS NULL")
        .run(displayText.slice(0, 80), conversationId);
    }
  }

  history(conversationId: string): LlmMessage[] {
    const rows = this.db
      .prepare("SELECT role, content_json FROM messages WHERE conversation_id = ? ORDER BY id")
      .all(conversationId) as Array<{ role: "user" | "assistant"; content_json: string }>;
    return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content_json) }));
  }

  display(conversationId: string): DisplayMessage[] {
    return this.db
      .prepare(
        "SELECT id, role, display_text AS text, created_at AS createdAt FROM messages WHERE conversation_id = ? AND display_text IS NOT NULL ORDER BY id",
      )
      .all(conversationId) as unknown as DisplayMessage[];
  }
}
