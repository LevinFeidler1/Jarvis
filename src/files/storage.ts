import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { ToolError } from "../core/types.js";
import type { FileProvider } from "../providers/types.js";

/** Where file bytes live. Metadata always stays in the `files` table. */
export interface FileStorage {
  readonly kind: "db" | "drive";
  /** `replaces` = storage key of the previous version (Drive stores versions as revisions of one file). */
  put(file: { name: string; mime: string; data: Buffer; replaces?: string }): Promise<{ key: string; url?: string }>;
  get(key: string): Promise<Buffer>;
  /** Inclusive byte range, like HTTP Range. */
  getRange(key: string, start: number, end: number): Promise<Buffer>;
  /** wholeFile: all versions are being deleted (Drive: move the file to the trash). */
  remove(key: string, opts?: { wholeFile?: boolean }): Promise<void>;
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

/**
 * Bytes in the user's Google Drive, folder "JARVIS". A JARVIS version is a
 * Drive revision of one file (key = fileId@revisionId), so Drive shows one
 * document with its history instead of a pile of copies.
 */
export class DriveFileStorage implements FileStorage {
  readonly kind = "drive" as const;
  constructor(
    private readonly drive: FileProvider,
    private readonly folder = "JARVIS",
  ) {}

  private split(key: string): { id: string; rev?: string } {
    const [id, rev] = key.split("@");
    return { id: id!, rev: rev || undefined };
  }

  async put(file: { name: string; mime: string; data: Buffer; replaces?: string }): Promise<{ key: string; url?: string }> {
    const f = file.replaces
      ? await this.drive.uploadRevision(this.split(file.replaces).id, file.data, file.mime)
      : await this.drive.upload({ name: file.name, mimeType: file.mime, data: file.data, folderId: await this.drive.ensureFolder(this.folder) });
    return { key: f.headRevisionId ? `${f.id}@${f.headRevisionId}` : f.id, url: f.webViewLink ?? undefined };
  }

  get(key: string): Promise<Buffer> {
    const { id, rev } = this.split(key);
    return this.drive.download(id, { revisionId: rev });
  }

  getRange(key: string, start: number, end: number): Promise<Buffer> {
    const { id, rev } = this.split(key);
    return this.drive.download(id, { revisionId: rev, range: [start, end] });
  }

  async remove(key: string, opts: { wholeFile?: boolean } = {}): Promise<void> {
    const { id, rev } = this.split(key);
    if (opts.wholeFile || !rev) return this.drive.trash(id);
    try {
      await this.drive.deleteRevision(id, rev);
    } catch {
      throw new ToolError("Diese Version kann in Google Drive nicht einzeln gelöscht werden (aktuelle Version). Lösche alle Versionen oder lege eine neue an.", "INVALID_INPUT");
    }
  }
}
