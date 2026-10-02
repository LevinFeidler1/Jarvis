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
  // 8 — browser agent tasks (recorded steps for replays + last page state for risk checks).
  `
  CREATE TABLE browser_tasks (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    last_json TEXT,
    calls INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 9 — Telegram: processed update ids (Telegram retries webhooks; each update is handled once).
  `
  CREATE TABLE telegram_updates (
    update_id BIGINT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  `,
  // 10 — notes & lists, finance items (invoices / subscriptions detected in mails or added by hand).
  `
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT,
    body TEXT NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    done_at TEXT
  );
  CREATE INDEX list_items_list_idx ON list_items (list_id, done, position);
  CREATE TABLE finance_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    vendor TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'EUR',
    due_date TEXT,
    interval TEXT,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    email_id TEXT UNIQUE,
    account TEXT,
    reminder_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX finance_items_status_idx ON finance_items (status, due_date);
  `,
];

// ─── Timeouts ───────────────────────────────────────────────────────────────

/** Thrown when an operation does not finish in time — mapped to HTTP 503. */
export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Rejects after `ms` (and runs `onTimeout`, e.g. to destroy a stuck connection). */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* best effort */ }
      reject(new TimeoutError(message));
    }, ms);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Errors that mean "database briefly unavailable / too slow" rather than a bug:
 * the API answers 503 (retry later) instead of 500.
 */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const e = err as { code?: string; message?: string } | undefined;
  // 57014 statement_timeout / query canceled · 55P03 lock_not_available · 57P01-03 admin shutdown / cannot connect now · 08xxx connection exceptions
  if (e?.code && (/^(57014|55P03|57P0[123]|08\w{3})$/.test(e.code) || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"].includes(e.code))) return true;
  return /timeout|timed out|Connection terminated|terminating connection|Client has encountered a connection error|connection is closed/i.test(e?.message ?? "");
}

// ─── Migrations ─────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = MIGRATIONS.length;
const MIGRATION_LOCK_KEY = 424242;

/** Minimal connection interface for migrations (pg.Client and PGlite both fit). */
export interface MigrationConn {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Current schema version; 0 when the table does not exist yet. */
export async function readSchemaVersion(q: MigrationConn["query"]): Promise<number> {
  try {
    const { rows } = await q("SELECT version FROM schema_version LIMIT 1");
    return Number((rows[0] as { version?: number } | undefined)?.version ?? 0);
  } catch (err) {
    if ((err as { code?: string }).code === "42P01" || /schema_version.*does not exist/i.test((err as Error).message)) return 0;
    throw err;
  }
}

/**
 * Applies pending migrations in ONE transaction, serialised across concurrent
 * cold starts with a transaction-scoped advisory lock. pg_advisory_xact_lock is
 * released by COMMIT/ROLLBACK on the very connection that took it — unlike
 * pg_advisory_lock/unlock, which can land on different backends behind a pooler
 * (PgBouncer) and leave the lock held forever. lock_timeout bounds the wait.
 */
export async function runMigrations(conn: MigrationConn, opts: { lockTimeout?: string; statementTimeout?: string } = {}): Promise<number> {
  await conn.query(`SET lock_timeout = '${opts.lockTimeout ?? "10s"}'`);
  await conn.query(`SET statement_timeout = '${opts.statementTimeout ?? "30s"}'`);
  await conn.query("BEGIN");
  try {
    await conn.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);
    await conn.query("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    const { rows } = await conn.query("SELECT version FROM schema_version LIMIT 1");
    const row = rows[0] as { version?: number } | undefined;
    let version = Number(row?.version ?? 0);
    if (!row) await conn.query("INSERT INTO schema_version (version) VALUES (0)");
    const from = version;
    // Another instance may have migrated while we waited for the lock.
    while (version < MIGRATIONS.length) {
      for (const stmt of splitStatements(MIGRATIONS[version]!)) await conn.query(stmt);
      version += 1;
    }
    if (version !== from) await conn.query(`UPDATE schema_version SET version = ${version}`);
    await conn.query("COMMIT");
    return version - from;
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** Splits a migration into single statements (our migrations contain no functions or quoted semicolons). */
function splitStatements(sql: string): string[] {
  return sql.split(";").map((x) => x.trim()).filter(Boolean);
}

// ─── Implementations ────────────────────────────────────────────────────────

/** Per-query limits for the shared pool (ms). */
export const DB_TIMEOUTS = {
  connect: 5_000,
  idle: 5_000,
  query: 20_000,
  /** Whole migration run incl. connect + lock wait (lock_timeout 10 s on top of 5 s connect). */
  migrationTotal: 15_000,
} as const;

/** Forces certificate verification (sslmode=verify-full) except for local databases. */
export function normalizeDbUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (/^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(u.hostname) || u.searchParams.get("sslmode") === "disable") return url;
  u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}

const isLocalUrl = (url: string) => /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url);

/** node-postgres pool options: short connect/idle timeouts, keep-alive, per-query limits. */
export function poolConfig(url: string) {
  const connectionString = normalizeDbUrl(url);
  return {
    connectionString,
    max: Number(process.env.JARVIS_DB_POOL_MAX ?? 3),
    connectionTimeoutMillis: DB_TIMEOUTS.connect,
    idleTimeoutMillis: DB_TIMEOUTS.idle,
    keepAlive: true,
    query_timeout: DB_TIMEOUTS.query,
    statement_timeout: DB_TIMEOUTS.query,
    ssl: isLocalUrl(connectionString) ? undefined : { rejectUnauthorized: true },
  };
}

interface PgQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}
interface PgPoolLike extends PgQueryable {
  on(event: "error", listener: (err: Error) => void): unknown;
  end(): Promise<void>;
}

/** Wraps a pg pool as Db. Idle-connection errors are logged and the client is discarded by the pool. */
export function wrapPool(pool: PgPoolLike, log: (msg: string) => void = (m) => console.warn(m)): Db {
  pool.on("error", (err) => log(`[db] idle connection dropped: ${err.message}`));
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await q(sql, params)).rows as T[],
    one: async <T>(sql: string, params: unknown[] = []) => (await q(sql, params)).rows[0] as T | undefined,
    run: async (sql: string, params: unknown[] = []) => (await q(sql, params)).rowCount ?? 0,
    exec: async (sql: string) => void (await q(sql)),
    close: () => pool.end(),
  };
}

/** A short-lived single connection used only for migrations. */
export interface MigrationClient extends MigrationConn {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  /** Hard close when it hangs (pg: client.connection.stream.destroy()). */
  destroy?(): void;
}

/**
 * Migrates over its own connection with a hard overall deadline: a stuck lock or
 * a dead connection fails fast instead of blocking the cold start for 300 s.
 */
export async function migrateWithDeadline(makeClient: () => MigrationClient, totalMs: number = DB_TIMEOUTS.migrationTotal): Promise<number> {
  const client = makeClient();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { client.destroy?.(); } catch { /* ignore */ }
    client.end().catch(() => undefined);
  };
  try {
    return await withTimeout((async () => {
      await client.connect();
      return runMigrations(client);
    })(), totalMs, `Datenbank-Migration nicht in ${Math.round(totalMs / 1000)} s abgeschlossen (Lock oder Verbindung hängt).`, close);
  } finally {
    close();
  }
}

async function openPostgres(url: string, migrationUrl?: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool(poolConfig(url));
  const db = wrapPool(pool);
  if (process.env.VERCEL) {
    // Fluid Compute: close idle connections before the instance is frozen.
    try {
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    } catch (err) {
      console.warn("[db] attachDatabasePool unavailable:", (err as Error).message);
    }
  }
  // Fast path for warm schemas: one cheap read, no lock at all.
  const version = await readSchemaVersion((sql, params) => pool.query(sql, params));
  if (version < SCHEMA_VERSION) {
    const target = poolConfig(migrationUrl ?? url);
    await migrateWithDeadline(() => {
      const c = new pg.Client({ ...target, query_timeout: 30_000, statement_timeout: 30_000 });
      c.on("error", () => undefined); // a broken migration connection must not crash the process
      return {
        connect: () => c.connect(),
        query: (sql: string, params?: unknown[]) => c.query(sql, params),
        end: () => c.end(),
        destroy: () => (c as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy(),
      };
    });
  }
  return db;
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
  // Single in-process connection: same migration code path as Postgres.
  await serial(() => runMigrations({ query: (sql, params) => pg.query(sql, params) }));
  return db;
}

/**
 * `DATABASE_URL` (postgres://…) → Neon/Postgres; migrations use `DATABASE_URL_UNPOOLED`
 * (direct connection, no PgBouncer) when set.
 * Otherwise PGlite: a directory path persists data, ":memory:" does not.
 */
export async function openDatabase(opts: { url?: string; unpooledUrl?: string; localPath?: string }): Promise<Db> {
  if (opts.url) return openPostgres(opts.url, opts.unpooledUrl);
  return openPglite(opts.localPath && opts.localPath !== ":memory:" ? opts.localPath : undefined);
}

export function nowIso(): string {
  return new Date().toISOString();
}
