import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { ToolError } from "../core/types.js";

/** Where file bytes live. Metadata always stays in the `files` table. */
export interface FileStorage {
  readonly kind: "db" | "drive";
  put(file: { name: string; mime: string; data: Buffer }): Promise<{ key: string; url?: string }>;
  get(key: string): Promise<Buffer>;
  /** Inclusive byte range, like HTTP Range. */
  getRange(key: string, start: number, end: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const toBuffer = (v: unknown): Buffer => (Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array));

/**
 * Bytes in Postgres (Neon). Used when Google Drive is not connected; guarded
 * by a quota because Neon Free has 0.5 GB in total.
 */
export class DbFileStorage implements FileStorage {
  readonly kind = "db" as const;
  constructor(private readonly db: Db) {}

  async put(file: { data: Buffer }): Promise<{ key: string }> {
    const key = randomUUID();
    await this.db.run("INSERT INTO file_blobs (key, data, created_at) VALUES ($1, $2, $3)", [key, file.data, nowIso()]);
    return { key };
  }

  async get(key: string): Promise<Buffer> {
    const row = await this.db.one<{ data: unknown }>("SELECT data FROM file_blobs WHERE key = $1", [key]);
    if (!row) throw new ToolError("Dateiinhalt nicht gefunden.", "NOT_FOUND");
    return toBuffer(row.data);
  }

  async getRange(key: string, start: number, end: number): Promise<Buffer> {
    const row = await this.db.one<{ data: unknown }>("SELECT substring(data FROM $2 FOR $3) AS data FROM file_blobs WHERE key = $1", [key, start + 1, end - start + 1]);
    if (!row) throw new ToolError("Dateiinhalt nicht gefunden.", "NOT_FOUND");
    return toBuffer(row.data);
  }

  async remove(key: string): Promise<void> {
    await this.db.run("DELETE FROM file_blobs WHERE key = $1", [key]);
  }
}
