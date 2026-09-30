import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Ordered, append-only list of schema migrations. Never edit an applied
 * migration; add a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    tainted INTEGER NOT NULL DEFAULT 0, -- suspicious external content was read
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,              -- 'user' | 'assistant'
    content_json TEXT NOT NULL,      -- Anthropic content blocks, stored verbatim
    display_text TEXT,               -- plain text shown in the UI (null = hidden)
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

  CREATE TABLE pending_actions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    description TEXT NOT NULL,
    risk INTEGER NOT NULL,
    reasons_json TEXT NOT NULL,
    status TEXT NOT NULL,            -- pending | approved | rejected | expired
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    tool_name TEXT NOT NULL,
    description TEXT NOT NULL,
    risk INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_activity_created ON activity(created_at);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    risk INTEGER NOT NULL,
    status TEXT NOT NULL,
    user_confirmation INTEGER NOT NULL,
    details_json TEXT
  );

  CREATE TABLE memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,          -- preference | person | project | rule | fact
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,            -- user | inferred
    confidence REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(category, key)
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    due TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open',
    project TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | fired | cancelled
    created_at TEXT NOT NULL
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE oauth_tokens (
    provider TEXT PRIMARY KEY,
    account TEXT,
    scopes TEXT NOT NULL,
    encrypted_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      version += 1;
      db.prepare("UPDATE schema_version SET version = ?").run(version);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
