/**
 * Database layer (ARCHITECTURE.md §6).
 *
 * One SQL dialect everywhere: PostgreSQL.
 *  - Production (Vercel): Neon Postgres via DATABASE_URL (node-postgres pool).
 *  - Local development and tests: PGlite — real Postgres compiled to WASM,
 *    running in-process, persisted to a directory (or in memory).
 */

export interface Db {
  /** All rows. Use $1, $2 … placeholders. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** First row or undefined. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Number of affected rows. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** Multiple statements, no parameters (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Ordered, append-only list of schema migrations. Never edit an applied
 * migration; add a new one instead. Column aliases in queries must be quoted
 * ("createdAt") because Postgres folds unquoted identifiers to lower case.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    tainted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    display_text TEXT,
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
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE activity (
    seq INTEGER GENERATED ALWAYS AS IDENTITY,
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
  CREATE INDEX idx_activity_seq ON activity(seq);

  CREATE TABLE audit_log (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    risk INTEGER NOT NULL,
    status TEXT NOT NULL,
    user_confirmation BOOLEAN NOT NULL,
    details_json TEXT
  );

  CREATE TABLE memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
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
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TEXT NOT NULL
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    read BOOLEAN NOT NULL DEFAULT FALSE,
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
  // 2 — additional mailboxes via IMAP/SMTP (1&1/IONOS, All-Inkl, …). Password AES-256-GCM encrypted.
  `
  CREATE TABLE email_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    preset TEXT NOT NULL,
    username TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_secure BOOLEAN NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_secure BOOLEAN NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 3 — contacts maintained in JARVIS itself (works without Google Contacts).
  `
  CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    emails TEXT NOT NULL DEFAULT '[]',
    phones TEXT NOT NULL DEFAULT '[]',
    organization TEXT,
    role TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX contacts_name_idx ON contacts (lower(name));
  `,
  // 4 — push notifications, automations, token usage (cost), memory snapshot per conversation.
  `
  ALTER TABLE conversations ADD COLUMN memory_hash TEXT;
  ALTER TABLE conversations ADD COLUMN origin TEXT;

  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    last_success_at TEXT
  );

  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    schedule_time TEXT,
    schedule_days TEXT,
    email_from TEXT,
    email_subject TEXT,
    email_since TEXT,
    email_seen TEXT NOT NULL DEFAULT '[]',
    enabled BOOLEAN NOT NULL,
    next_run_at TEXT,
    running_since TEXT,
    last_run_at TEXT,
    last_status TEXT,
    last_result TEXT,
    last_conversation_id TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE llm_usage (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts TEXT NOT NULL,
    model TEXT NOT NULL,
    conversation_id TEXT,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    web_searches INTEGER NOT NULL DEFAULT 0,
    compacted BOOLEAN NOT NULL DEFAULT FALSE,
    cost_usd DOUBLE PRECISION NOT NULL
  );
  CREATE INDEX llm_usage_ts_idx ON llm_usage (ts);
  `,
  // 5 — files & documents (versions share a root_id; bytes in file_blobs or Google Drive).
  `
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    format TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    drive_url TEXT,
    source TEXT NOT NULL,
    note TEXT,
    conversation_id TEXT,
    text_cache TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX files_root_idx ON files (root_id, version);
  CREATE TABLE file_blobs (
    key TEXT PRIMARY KEY,
    data BYTEA NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE upload_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE upload_chunks (
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    data BYTEA NOT NULL,
    PRIMARY KEY (session_id, idx)
  );
  `,
  // 6 — proactive butler: mail triage and suggestions.
  `
  CREATE TABLE triage_seen (
    email_id TEXT PRIMARY KEY,
    account TEXT,
    day TEXT NOT NULL,
    classified BOOLEAN NOT NULL,
    category TEXT,
    processed_at TEXT NOT NULL
  );
  CREATE INDEX triage_seen_day_idx ON triage_seen (day);
  CREATE TABLE suggestions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    email_id TEXT,
    account TEXT,
    sender TEXT,
    actions_json TEXT NOT NULL,
    accept_label TEXT,
    edit_prompt TEXT NOT NULL,
    warning TEXT,
    status TEXT NOT NULL,
    result TEXT,
    conversation_id TEXT,
    undo_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX suggestions_status_idx ON suggestions (status, created_at);
  CREATE TABLE suggestion_feedback (
    kind TEXT NOT NULL,
    sender TEXT NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    ignored INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, sender)
  );
  `,
  // 7 — autonomous automations: per-automation allowlist + daily limit, undo for actions.
  `
  ALTER TABLE automations ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE automations ADD COLUMN daily_action_limit INTEGER NOT NULL DEFAULT 20;
  ALTER TABLE activity ADD COLUMN automation_id TEXT;
  ALTER TABLE activity ADD COLUMN autonomous BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE activity ADD COLUMN undo_json TEXT;
  ALTER TABLE activity ADD COLUMN undone_at TEXT;
  CREATE INDEX activity_automation_idx ON activity (automation_id, created_at);
  `,
];

async function migrate(db: Db): Promise<void> {
  // Serialise concurrent cold starts (several serverless instances). The lock
  // is taken before anything else; `db` must be a single connection here.
  await db.exec("SELECT pg_advisory_lock(424242)");
  try {
    await db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    const row = await db.one<{ version: number }>("SELECT version FROM schema_version");
    let version = row?.version ?? 0;
    if (!row) await db.run("INSERT INTO schema_version (version) VALUES (0)");
    while (version < MIGRATIONS.length) {
      await db.exec(`BEGIN; ${MIGRATIONS[version]}; UPDATE schema_version SET version = ${version + 1}; COMMIT;`);
      version += 1;
    }
  } catch (err) {
    await db.exec("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await db.exec("SELECT pg_advisory_unlock(424242)");
  }
}

// ─── Implementations ────────────────────────────────────────────────────────

async function openPostgres(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.JARVIS_DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    ssl: /sslmode=disable/.test(url) || /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: true },
  });
  const over = (q: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>): Omit<Db, "close"> => ({
    query: async <T>(sql: string, params: unknown[] = []) => (await q(sql, params)).rows as T[],
    one: async <T>(sql: string, params: unknown[] = []) => (await q(sql, params)).rows[0] as T | undefined,
    run: async (sql: string, params: unknown[] = []) => (await q(sql, params)).rowCount ?? 0,
    exec: async (sql: string) => void (await q(sql)),
  });

  // Migrations run on one pinned connection (advisory lock + BEGIN/COMMIT).
  const client = await pool.connect();
  try {
    await migrate({ ...over((sql, params) => client.query(sql, params)), close: async () => undefined });
  } finally {
    client.release();
  }
  return { ...over((sql, params) => pool.query(sql, params)), close: () => pool.end() };
}

async function openPglite(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const pg = new PGlite(dataDir);
  // PGlite is single-connection; serialise statements to keep BEGIN/COMMIT atomic.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const db: Db = {
    query: <T>(sql: string, params: unknown[] = []) => serial(async () => (await pg.query<T>(sql, params)).rows),
    one: <T>(sql: string, params: unknown[] = []) => serial(async () => (await pg.query<T>(sql, params)).rows[0]),
    run: (sql: string, params: unknown[] = []) => serial(async () => (await pg.query(sql, params)).affectedRows ?? 0),
    exec: (sql: string) => serial(async () => void (await pg.exec(sql))),
    close: () => serial(() => pg.close()),
  };
  await migrate(db);
  return db;
}

/**
 * `DATABASE_URL` (postgres://…) → Neon/Postgres.
 * Otherwise PGlite: a directory path persists data, ":memory:" does not.
 */
export async function openDatabase(opts: { url?: string; localPath?: string }): Promise<Db> {
  if (opts.url) return openPostgres(opts.url);
  return openPglite(opts.localPath && opts.localPath !== ":memory:" ? opts.localPath : undefined);
}

export function nowIso(): string {
  return new Date().toISOString();
}
