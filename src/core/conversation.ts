import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import type { LlmMessage } from "./llm.js";

export interface ConversationInfo {
  id: string;
  title: string | null;
  tainted: boolean;
  /** Hash of the memory snapshot last sent in this conversation. */
  memoryHash: string | null;
  /** "automation" for conversations started by an automation. */
  origin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

const SELECT = `SELECT id, title, tainted, memory_hash AS "memoryHash", origin, created_at AS "createdAt", updated_at AS "updatedAt" FROM conversations`;

/**
 * Append-only conversation history. Assistant content (incl. thinking blocks)
 * is stored verbatim so it can be replayed unchanged to the API.
 */
export class ConversationStore {
  constructor(private readonly db: Db) {}

  async create(title?: string, origin?: string): Promise<ConversationInfo> {
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run(
      "INSERT INTO conversations (id, title, tainted, origin, created_at, updated_at) VALUES ($1, $2, FALSE, $3, $4, $5)",
      [id, title ?? null, origin ?? null, ts, ts],
    );
    return { id, title: title ?? null, tainted: false, memoryHash: null, origin: origin ?? null, createdAt: ts, updatedAt: ts };
  }

  async setMemoryHash(id: string, hash: string): Promise<void> {
    await this.db.run("UPDATE conversations SET memory_hash = $1 WHERE id = $2", [hash, id]);
  }

  get(id: string): Promise<ConversationInfo | undefined> {
    return this.db.one<ConversationInfo>(`${SELECT} WHERE id = $1`, [id]);
  }

  list(limit = 50): Promise<ConversationInfo[]> {
    return this.db.query<ConversationInfo>(`${SELECT} ORDER BY updated_at DESC LIMIT $1`, [limit]);
  }

  async delete(id: string): Promise<boolean> {
    await this.db.run("DELETE FROM pending_actions WHERE conversation_id = $1 AND status = 'pending'", [id]);
    return (await this.db.run("DELETE FROM conversations WHERE id = $1", [id])) === 1;
  }

  async markTainted(id: string): Promise<void> {
    await this.db.run("UPDATE conversations SET tainted = TRUE WHERE id = $1", [id]);
  }

  async append(conversationId: string, message: LlmMessage, displayText: string | null): Promise<void> {
    const ts = nowIso();
    await this.db.run(
      "INSERT INTO messages (conversation_id, role, content_json, display_text, created_at) VALUES ($1, $2, $3, $4, $5)",
      [conversationId, message.role, JSON.stringify(message.content), displayText, ts],
    );
    await this.db.run("UPDATE conversations SET updated_at = $1 WHERE id = $2", [ts, conversationId]);
    if (displayText && message.role === "user") {
      await this.db.run("UPDATE conversations SET title = $1 WHERE id = $2 AND title IS NULL", [displayText.slice(0, 80), conversationId]);
    }
  }

  async history(conversationId: string): Promise<LlmMessage[]> {
    const rows = await this.db.query<{ role: "user" | "assistant"; content_json: string }>(
      "SELECT role, content_json FROM messages WHERE conversation_id = $1 ORDER BY id",
      [conversationId],
    );
    return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content_json) }));
  }

  display(conversationId: string): Promise<DisplayMessage[]> {
    return this.db.query<DisplayMessage>(
      `SELECT id, role, display_text AS text, created_at AS "createdAt" FROM messages
       WHERE conversation_id = $1 AND display_text IS NOT NULL ORDER BY id`,
      [conversationId],
    );
  }
}
