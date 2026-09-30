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
