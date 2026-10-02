import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DB_TIMEOUTS,
  type MigrationClient,
  SCHEMA_VERSION,
  TimeoutError,
  isTransientDbError,
  migrateWithDeadline,
  normalizeDbUrl,
  poolConfig,
  readSchemaVersion,
  runMigrations,
  withTimeout,
  wrapPool,
} from "../src/db/database.js";
import { createServer } from "../src/server.js";
import { restoreUrl } from "../src/vercel/handler.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { harness } from "./helpers.js";

const never = <T>() => new Promise<T>(() => undefined);
const pgError = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

/** Fake pg client that records statements; `hangOn`/`failOn` simulate a stuck lock or a broken connection. */
function fakeClient(opts: { hangOn?: RegExp; failOn?: RegExp; failWith?: Error; connect?: () => Promise<unknown> } = {}) {
  const sql: string[] = [];
  const client = {
    sql,
    ended: false,
    destroyed: false,
    connect: opts.connect ?? (async () => undefined),
    query: async (q: string) => {
      sql.push(q);
      if (opts.hangOn?.test(q)) return never<{ rows: unknown[] }>();
      if (opts.failOn?.test(q)) throw opts.failWith ?? pgError("boom");
      if (/SELECT version FROM schema_version/.test(q)) return { rows: [{ version: SCHEMA_VERSION }] };
      return { rows: [] };
    },
    end: async () => void (client.ended = true),
    destroy: () => void (client.destroyed = true),
  };
  return client satisfies MigrationClient & Record<string, unknown>;
}

describe("migrations", () => {
  it("never wait forever on the migration lock: deadline + hard close", async () => {
    const c = fakeClient({ hangOn: /pg_advisory_xact_lock/ });
    const t0 = Date.now();
    await expect(migrateWithDeadline(() => c, 150)).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(c.destroyed).toBe(true);
    expect(c.ended).toBe(true);
    // lock_timeout / statement_timeout are set before the lock is requested
    expect(c.sql.slice(0, 4)).toEqual(["SET lock_timeout = '10s'", "SET statement_timeout = '30s'", "BEGIN", "SELECT pg_advisory_xact_lock(424242)"]);
    // no session-level lock that could outlive the transaction behind a pooler
    expect(c.sql.join("\n")).not.toMatch(/pg_advisory_lock\(|pg_advisory_unlock/);
  });

  it("lock_timeout (55P03) rolls back and counts as a transient error", async () => {
    const c = fakeClient({ failOn: /pg_advisory_xact_lock/, failWith: pgError("canceling statement due to lock timeout", "55P03") });
    const err = await migrateWithDeadline(() => c, 5_000).catch((e) => e);
    expect(err.code).toBe("55P03");
    expect(isTransientDbError(err)).toBe(true);
    expect(c.sql).toContain("ROLLBACK");
    expect(c.ended).toBe(true);
  });

  it("a dead connection fails fast instead of hanging", async () => {
    const refused = fakeClient({ connect: async () => { throw pgError("connect ECONNRESET", "ECONNRESET"); } });
    await expect(migrateWithDeadline(() => refused, 5_000)).rejects.toMatchObject({ code: "ECONNRESET" });
    const stuck = fakeClient({ connect: () => never() });
    await expect(migrateWithDeadline(() => stuck, 100)).rejects.toBeInstanceOf(TimeoutError);
    expect(stuck.destroyed).toBe(true);
  });

  it("applies all migrations once, atomically, on a real Postgres (PGlite)", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    const conn = { query: (q: string, p?: unknown[]) => pg.query(q, p) };
    expect(await readSchemaVersion(conn.query)).toBe(0); // table missing → 0, no error
    expect(await runMigrations(conn)).toBe(SCHEMA_VERSION);
    expect(await readSchemaVersion(conn.query)).toBe(SCHEMA_VERSION);
    expect(await runMigrations(conn)).toBe(0); // second cold start: nothing to do
    // the transaction-scoped lock is gone after COMMIT
    const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'");
    expect(rows[0]!.n).toBe(0);
    await pg.close();
  });

  it("is skipped entirely when the schema is current (fast cold start)", async () => {
    const q = vi.fn(async () => ({ rows: [{ version: SCHEMA_VERSION }] }));
    expect(await readSchemaVersion(q)).toBe(SCHEMA_VERSION);
    expect(q).toHaveBeenCalledTimes(1);
  });
});

describe("pool", () => {
  it("uses short timeouts, keep-alive and verified TLS", () => {
    const c = poolConfig("postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=require&channel_binding=require");
    expect(c).toMatchObject({ connectionTimeoutMillis: 5_000, idleTimeoutMillis: 5_000, keepAlive: true, query_timeout: DB_TIMEOUTS.query, statement_timeout: DB_TIMEOUTS.query });
    expect(new URL(c.connectionString).searchParams.get("sslmode")).toBe("verify-full");
    expect(new URL(c.connectionString).searchParams.get("channel_binding")).toBe("require");
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
    expect(normalizeDbUrl("postgres://u:p@localhost:5432/db")).toBe("postgres://u:p@localhost:5432/db");
    expect(poolConfig("postgres://u:p@localhost:5432/db").ssl).toBeUndefined();
  });

  it("survives dead idle connections and rejects broken queries quickly", async () => {
    const pool = Object.assign(new EventEmitter(), {
      query: vi.fn(async () => { throw pgError("Connection terminated unexpectedly"); }),
      end: vi.fn(async () => undefined),
    });
    const logs: string[] = [];
    const db = wrapPool(pool, (m) => logs.push(m));
    // An idle client dying must not crash the process (unhandled 'error' event).
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
    expect(logs[0]).toMatch(/idle connection dropped/);
    const err = await db.query("SELECT 1").catch((e) => e);
    expect(isTransientDbError(err)).toBe(true);
  });

  it("classifies timeouts and connection errors as transient, bugs as not", () => {
    expect(isTransientDbError(pgError("canceling statement due to statement timeout", "57014"))).toBe(true);
    expect(isTransientDbError(pgError("Query read timeout"))).toBe(true);
    expect(isTransientDbError(pgError("timeout exceeded when trying to connect"))).toBe(true);
    expect(isTransientDbError(pgError("connect ETIMEDOUT", "ETIMEDOUT"))).toBe(true);
    expect(isTransientDbError(pgError('relation "x" does not exist', "42P01"))).toBe(false);
    expect(isTransientDbError(new TypeError("x is undefined"))).toBe(false);
  });

  it("withTimeout rejects and runs the cleanup", async () => {
    const cleanup = vi.fn();
    await expect(withTimeout(never(), 20, "zu langsam", cleanup)).rejects.toThrow("zu langsam");
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(withTimeout(Promise.resolve(7), 20, "x")).resolves.toBe(7);
  });
});

describe("HTTP: no request hangs", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(timeouts: { default?: number; agent?: number } = {}) {
    const h = await harness([]);
    app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), scheduler: h.scheduler, llmConfigured: true, timeouts });
    const res = await app.inject({ method: "POST", url: "/api/login", payload: { token: "t".repeat(40) } });
    const cookie = res.cookies.find((c) => c.name === "jarvis_session")!;
    return { h, app, headers: { cookie: `jarvis_session=${cookie.value}`, "x-jarvis-csrf": res.json().csrfToken as string } };
  }

  it("a hanging query answers 503 after the route limit", async () => {
    const { h, app, headers } = await start({ default: 150 });
    h.providers.notifications.list = () => never();
    const t0 = Date.now();
    const res = await app.inject({ url: "/api/notifications", headers });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("TIMEOUT");
    expect(res.headers["retry-after"]).toBe("5");
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("database timeouts become a quick 503, not a 500", async () => {
    const { h, app, headers } = await start();
    h.agent.confirmations.listPending = async () => { throw pgError("canceling statement due to statement timeout", "57014"); };
    const res = await app.inject({ url: "/api/confirmations", headers });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("DB_UNAVAILABLE");
  });

  it("/api/notifications no longer runs the scheduler inside the request", async () => {
    const { h, app, headers } = await start();
    const tick = vi.spyOn(h.scheduler, "tick");
    expect((await app.inject({ url: "/api/notifications", headers })).statusCode).toBe(200);
    expect(tick).not.toHaveBeenCalled();
  });

  it("a stuck agent stream ends with a clean error line before the platform limit", async () => {
    const { h, app, headers } = await start({ agent: 150 });
    h.agent.handleUserMessage = () => never();
    const res = await app.inject({ method: "POST", url: "/api/chat/stream", headers, payload: { message: "Hallo" } });
    const lines = res.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ type: "error" });
    expect(lines.at(-1).error).toMatch(/zu lange/);
  });

  it("agent routes keep their long limit (not cut at 25 s)", async () => {
    const { h, app, headers } = await start({ default: 50, agent: 5_000 });
    h.agent.handleUserMessage = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { conversationId: "c", text: "Fertig.", actions: [], pendingActions: [] } as never;
    };
    const res = await app.inject({ method: "POST", url: "/api/chat", headers, payload: { message: "Hallo" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe("Fertig.");
  });

  it("restores URLs rewritten to the agent function", () => {
    expect(restoreUrl("/api/agent?path=chat/stream")).toBe("/api/chat/stream");
    expect(restoreUrl("/api/agent?path=confirmations/abc")).toBe("/api/confirmations/abc");
    expect(restoreUrl("/api/agent?path=cron/tick&x=1")).toBe("/api/cron/tick?x=1");
  });
});
