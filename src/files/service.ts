import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import { ToolError } from "../core/types.js";
import { FORMAT_MIME, type FileFormat, detectFormat, extensionOf, sanitizeFileName } from "./formats/detect.js";
import { type Extracted, extract } from "./formats/extract.js";
import { DbFileStorage, type FileStorage } from "./storage.js";

export type FileSource = "upload" | "generated" | "edited" | "converted" | "drive" | "browser" | "telegram";

export interface FileInfo {
  id: string;
  rootId: string;
  version: number;
  parentId: string | null;
  name: string;
  format: FileFormat;
  mime: string;
  size: number;
  storage: "db" | "drive";
  driveUrl: string | null;
  source: FileSource;
  note: string | null;
  conversationId: string | null;
  createdAt: string;
  /** Number of versions of this document (list views only). */
  versions?: number;
}

interface Row {
  id: string;
  root_id: string;
  version: number;
  parent_id: string | null;
  name: string;
  format: FileFormat;
  mime: string;
  size: number;
  sha256: string;
  storage: "db" | "drive";
  storage_key: string;
  drive_url: string | null;
  source: FileSource;
  note: string | null;
  conversation_id: string | null;
  text_cache: string | null;
  created_at: string;
  versions?: string | number;
}

const toInfo = (r: Row): FileInfo => ({
  id: r.id,
  rootId: r.root_id,
  version: r.version,
  parentId: r.parent_id,
  name: r.name,
  format: r.format,
  mime: r.mime,
  size: Number(r.size),
  storage: r.storage,
  driveUrl: r.drive_url,
  source: r.source,
  note: r.note,
  conversationId: r.conversation_id,
  createdAt: r.created_at,
  ...(r.versions !== undefined ? { versions: Number(r.versions) } : {}),
});

export interface FileLimits {
  maxBytes: number;
  /** Total bytes allowed in Postgres (Neon Free has 0.5 GB). */
  dbQuotaBytes: number;
}

export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024; // < Vercel's 4.5 MB request limit
export const DOWNLOAD_RANGE_BYTES = 4 * 1024 * 1024; // < Vercel's 4.5 MB response limit
const TEXT_CACHE_CHARS = 300_000;

/**
 * Files & documents (Phase A). Every edit or conversion creates a new
 * version; originals are never overwritten. Bytes live in Google Drive when
 * connected (see setDriveStorage), otherwise in Postgres.
 */
export class FileService {
  private readonly dbStorage: DbFileStorage;
  private driveStorage?: () => Promise<FileStorage | undefined>;

  constructor(
    private readonly db: Db,
    readonly limits: FileLimits,
  ) {
    this.dbStorage = new DbFileStorage(db);
  }

  /** Phase B hook: returns Drive storage when Google is connected with the Drive scope. */
  setDriveStorage(resolver: () => Promise<FileStorage | undefined>): void {
    this.driveStorage = resolver;
  }

  private async storageFor(kind: "db" | "drive"): Promise<FileStorage> {
    if (kind === "db") return this.dbStorage;
    const drive = await this.driveStorage?.();
    if (!drive) throw new ToolError("Google Drive ist nicht verbunden — diese Datei liegt in Drive.", "NOT_CONFIGURED");
    return drive;
  }

  /** Drive when available, Postgres otherwise. */
  async defaultStorage(): Promise<FileStorage> {
    return (await this.driveStorage?.().catch(() => undefined)) ?? this.dbStorage;
  }

  async dbUsage(): Promise<number> {
    const r = await this.db.one<{ n: string | number | null }>("SELECT coalesce(sum(size), 0) AS n FROM files WHERE storage = 'db' AND deleted_at IS NULL");
    return Number(r?.n ?? 0);
  }

  private async assertCapacity(size: number, storage: FileStorage): Promise<void> {
    if (size > this.limits.maxBytes) {
      throw new ToolError(`Die Datei ist ${(size / 1048576).toFixed(1)} MB groß — erlaubt sind ${Math.round(this.limits.maxBytes / 1048576)} MB.`, "INVALID_INPUT");
    }
    if (storage.kind === "db" && (await this.dbUsage()) + size > this.limits.dbQuotaBytes) {
      throw new ToolError(
        `Der Speicher in der JARVIS-Datenbank ist voll (${Math.round(this.limits.dbQuotaBytes / 1048576)} MB). Google Drive verbinden (Einstellungen → Integrationen) oder alte Dateien löschen.`,
        "INVALID_INPUT",
      );
    }
  }

  /** Stores a new document (version 1) or — with parentId — a new version of it. */
  async create(input: {
    name: string;
    data: Buffer;
    source: FileSource;
    format?: FileFormat;
    parentId?: string;
    conversationId?: string | null;
    note?: string;
  }): Promise<FileInfo> {
    const name = sanitizeFileName(input.name);
    const format = input.format ?? detectFormat(name, input.data);
    const parent = input.parentId ? await this.get(input.parentId) : undefined;
    // A new version stays where its document lives (Drive revision or database).
    const parentRow = parent ? await this.row(parent.id) : undefined;
    const storage = parentRow ? await this.storageFor(parentRow.storage) : await this.defaultStorage();
    await this.assertCapacity(input.data.length, storage);
    const mime = FORMAT_MIME[format];
    const stored = await storage.put({ name, mime, data: input.data, replaces: parentRow?.storage === storage.kind ? parentRow.storage_key : undefined });
    const id = randomUUID();
    const rootId = parent?.rootId ?? id;
    const version = parent ? Number((await this.db.one<{ v: number }>("SELECT max(version) AS v FROM files WHERE root_id = $1", [rootId]))?.v ?? 0) + 1 : 1;
    await this.db.run(
      `INSERT INTO files (id, root_id, version, parent_id, name, format, mime, size, sha256, storage, storage_key, drive_url, source, note, conversation_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        rootId,
        version,
        parent?.id ?? null,
        name,
        format,
        mime,
        input.data.length,
        createHash("sha256").update(input.data).digest("hex"),
        storage.kind,
        stored.key,
        stored.url ?? null,
        input.source,
        input.note?.slice(0, 500) ?? null,
        input.conversationId ?? null,
        nowIso(),
      ],
    );
    return (await this.get(id))!;
  }

  async get(id: string): Promise<FileInfo> {
    const r = await this.db.one<Row>("SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!r) throw new ToolError(`Datei ${id} nicht gefunden.`, "NOT_FOUND");
    return toInfo(r);
  }

  /** Latest version of every document, newest first. */
  async list(opts: { query?: string; limit?: number; format?: FileFormat } = {}): Promise<FileInfo[]> {
    const params: unknown[] = [];
    const where = ["f.deleted_at IS NULL"];
    if (opts.query) {
      params.push(`%${opts.query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(lower(f.name) LIKE $${params.length} OR lower(coalesce(f.text_cache, '')) LIKE $${params.length})`);
    }
    if (opts.format) {
      params.push(opts.format);
      where.push(`f.format = $${params.length}`);
    }
    params.push(opts.limit ?? 100);
    const rows = await this.db.query<Row>(
      `SELECT f.*, (SELECT count(*) FROM files v WHERE v.root_id = f.root_id AND v.deleted_at IS NULL) AS versions
       FROM files f
       WHERE ${where.join(" AND ")}
         AND f.version = (SELECT max(version) FROM files v WHERE v.root_id = f.root_id AND v.deleted_at IS NULL)
       ORDER BY f.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(toInfo);
  }

  async versions(rootId: string): Promise<FileInfo[]> {
    return (await this.db.query<Row>("SELECT * FROM files WHERE root_id = $1 AND deleted_at IS NULL ORDER BY version DESC", [rootId])).map(toInfo);
  }

  private async row(id: string): Promise<Row> {
    const r = await this.db.one<Row>("SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!r) throw new ToolError(`Datei ${id} nicht gefunden.`, "NOT_FOUND");
    return r;
  }

  async read(id: string): Promise<{ info: FileInfo; data: Buffer }> {
    const r = await this.row(id);
    const data = await (await this.storageFor(r.storage)).get(r.storage_key);
    return { info: toInfo(r), data };
  }

  async readRange(id: string, start: number, end: number): Promise<{ info: FileInfo; data: Buffer }> {
    const r = await this.row(id);
    return { info: toInfo(r), data: await (await this.storageFor(r.storage)).getRange(r.storage_key, start, end) };
  }

  /** Extracted text, cached per version (files never change once stored). */
  async extract(id: string, opts: { sheet?: string } = {}): Promise<{ info: FileInfo; extracted: Extracted }> {
    const r = await this.row(id);
    if (r.text_cache && !opts.sheet) return { info: toInfo(r), extracted: JSON.parse(r.text_cache) as Extracted };
    const data = await (await this.storageFor(r.storage)).get(r.storage_key);
    const extracted = await extract(r.format, data, opts);
    if (!opts.sheet) {
      const cached: Extracted = { ...extracted, text: extracted.text.slice(0, TEXT_CACHE_CHARS), pages: extracted.pages?.map((p) => p.slice(0, 20_000)) };
      await this.db.run("UPDATE files SET text_cache = $1 WHERE id = $2", [JSON.stringify(cached), id]);
    }
    return { info: toInfo(r), extracted };
  }

  /** Deletes one version (or all versions). Drive files go to the Drive trash. */
  async delete(id: string, allVersions = false): Promise<number> {
    const r = await this.row(id);
    const all = await this.db.query<Row>("SELECT * FROM files WHERE root_id = $1 AND deleted_at IS NULL", [r.root_id]);
    const targets = allVersions ? all : [r];
    const wholeFile = targets.length === all.length;
    for (const t of targets) {
      await (await this.storageFor(t.storage)).remove(t.storage_key, { wholeFile }).catch((err) => {
        if (t.storage === "db" || err instanceof ToolError) throw err; // a Drive file that is already gone is fine
      });
      await this.db.run("UPDATE files SET deleted_at = $1, text_cache = NULL WHERE id = $2", [nowIso(), t.id]);
    }
    return targets.length;
  }

  // ─── Chunked upload (each request stays below Vercel's 4.5 MB body limit) ──

  async beginUpload(name: string, size: number): Promise<{ uploadId: string; chunkSize: number; chunks: number }> {
    const clean = sanitizeFileName(name);
    if (!extensionOf(clean)) throw new ToolError("Dateiname ohne Endung.", "INVALID_INPUT");
    detectFormatName(clean);
    if (!Number.isInteger(size) || size <= 0) throw new ToolError("Ungültige Dateigröße.", "INVALID_INPUT");
    if (size > this.limits.maxBytes) throw new ToolError(`Die Datei ist zu groß (max. ${Math.round(this.limits.maxBytes / 1048576)} MB).`, "INVALID_INPUT");
    await this.db.run("DELETE FROM upload_chunks WHERE session_id IN (SELECT id FROM upload_sessions WHERE created_at < $1)", [new Date(Date.now() - 3600_000).toISOString()]);
    await this.db.run("DELETE FROM upload_sessions WHERE created_at < $1", [new Date(Date.now() - 3600_000).toISOString()]);
    const id = randomUUID();
    await this.db.run("INSERT INTO upload_sessions (id, name, size, chunk_size, created_at) VALUES ($1, $2, $3, $4, $5)", [id, clean, size, UPLOAD_CHUNK_BYTES, nowIso()]);
    return { uploadId: id, chunkSize: UPLOAD_CHUNK_BYTES, chunks: Math.ceil(size / UPLOAD_CHUNK_BYTES) };
  }

  async addChunk(uploadId: string, index: number, data: Buffer): Promise<void> {
    const s = await this.db.one<{ size: number; chunk_size: number }>("SELECT size, chunk_size FROM upload_sessions WHERE id = $1", [uploadId]);
    if (!s) throw new ToolError("Upload nicht gefunden oder abgelaufen.", "NOT_FOUND");
    const chunks = Math.ceil(s.size / s.chunk_size);
    const expected = index === chunks - 1 ? s.size - index * s.chunk_size : s.chunk_size;
    if (!Number.isInteger(index) || index < 0 || index >= chunks || data.length !== expected) {
      throw new ToolError(`Ungültiger Upload-Teil ${index} (${data.length} Bytes, erwartet ${expected}).`, "INVALID_INPUT");
    }
    await this.db.run(
      "INSERT INTO upload_chunks (session_id, idx, data) VALUES ($1, $2, $3) ON CONFLICT (session_id, idx) DO UPDATE SET data = EXCLUDED.data",
      [uploadId, index, data],
    );
  }

  async completeUpload(uploadId: string, opts: { conversationId?: string | null; source?: FileSource } = {}): Promise<FileInfo> {
    const s = await this.db.one<{ name: string; size: number; chunk_size: number }>("SELECT name, size, chunk_size FROM upload_sessions WHERE id = $1", [uploadId]);
    if (!s) throw new ToolError("Upload nicht gefunden oder abgelaufen.", "NOT_FOUND");
    const parts = await this.db.query<{ idx: number; data: unknown }>("SELECT idx, data FROM upload_chunks WHERE session_id = $1 ORDER BY idx", [uploadId]);
    const chunks = Math.ceil(s.size / s.chunk_size);
    if (parts.length !== chunks || parts.some((p, i) => p.idx !== i)) throw new ToolError("Upload unvollständig — bitte erneut hochladen.", "INVALID_INPUT");
    const data = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data as Uint8Array))));
    try {
      return await this.create({ name: s.name, data, source: opts.source ?? "upload", conversationId: opts.conversationId ?? null });
    } finally {
      await this.db.run("DELETE FROM upload_chunks WHERE session_id = $1", [uploadId]);
      await this.db.run("DELETE FROM upload_sessions WHERE id = $1", [uploadId]);
    }
  }
}

/** Validates the extension early (before any bytes are uploaded). */
function detectFormatName(name: string): void {
  try {
    detectFormat(name, Buffer.from("x"));
  } catch (err) {
    if (err instanceof ToolError && /nicht unterstützt/.test(err.message)) throw err;
  }
}
