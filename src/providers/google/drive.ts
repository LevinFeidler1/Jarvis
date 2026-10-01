import { randomUUID } from "node:crypto";
import { ToolError } from "../../core/types.js";
import type { CloudFile, FileProvider } from "../types.js";
import type { GoogleHttp } from "./http.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents,headRevisionId";
const FOLDER = "application/vnd.google-apps.folder";

interface GFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  headRevisionId?: string;
}

const toCloud = (f: GFile): CloudFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  size: f.size ? Number(f.size) : null,
  modifiedTime: f.modifiedTime ?? "",
  webViewLink: f.webViewLink ?? null,
  parents: f.parents ?? [],
  isNative: f.mimeType.startsWith("application/vnd.google-apps."),
  headRevisionId: f.headRevisionId,
});

/** Drive query literals: backslash and single quote must be escaped. */
export const driveLiteral = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const ID = /^[A-Za-z0-9_-]{10,200}$/;
function assertId(id: string): void {
  if (!ID.test(id)) throw new ToolError(`Ungültige Drive-ID: ${id}`, "INVALID_INPUT");
}

function multipart(meta: unknown, mimeType: string, data: Buffer): { body: Buffer; contentType: string } {
  const boundary = `jarvis-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * Google Drive v3. With the `drive.file` scope JARVIS only sees files it
 * created (or that the user opened with it) — the rest of the Drive stays private.
 */
export class GoogleDriveProvider implements FileProvider {
  readonly name = "Google Drive";
  private folderCache = new Map<string, string>();

  constructor(private readonly http: GoogleHttp) {}

  async search(query: string, opts: { max?: number; folderId?: string } = {}): Promise<CloudFile[]> {
    const q = ["trashed = false", `mimeType != '${FOLDER}'`];
    if (query.trim()) q.push(`(name contains ${driveLiteral(query.trim())} or fullText contains ${driveLiteral(query.trim())})`);
    if (opts.folderId) {
      assertId(opts.folderId);
      q.push(`${driveLiteral(opts.folderId)} in parents`);
    }
    const res = await this.http.request<{ files: GFile[] }>(`${API}/files`, {
      query: { q: q.join(" and "), pageSize: Math.min(opts.max ?? 20, 100), fields: `files(${FIELDS})`, orderBy: "modifiedTime desc", spaces: "drive" },
    });
    return (res.files ?? []).map(toCloud);
  }

  async get(id: string): Promise<CloudFile> {
    assertId(id);
    return toCloud(await this.http.request<GFile>(`${API}/files/${id}`, { query: { fields: FIELDS } }));
  }

  async download(id: string, opts: { revisionId?: string; range?: [number, number] } = {}): Promise<Buffer> {
    assertId(id);
    if (opts.revisionId) assertId(opts.revisionId);
    const url = opts.revisionId ? `${API}/files/${id}/revisions/${opts.revisionId}` : `${API}/files/${id}`;
    return this.http.request<Buffer>(url, {
      query: { alt: "media" },
      responseType: "buffer",
      headers: opts.range ? { range: `bytes=${opts.range[0]}-${opts.range[1]}` } : undefined,
    });
  }

  async export(id: string, mimeType: string): Promise<Buffer> {
    assertId(id);
    return this.http.request<Buffer>(`${API}/files/${id}/export`, { query: { mimeType }, responseType: "buffer" });
  }

  async upload(file: { name: string; mimeType: string; data: Buffer; folderId?: string }): Promise<CloudFile> {
    const meta = { name: file.name, mimeType: file.mimeType, ...(file.folderId ? { parents: [file.folderId] } : {}) };
    const mp = multipart(meta, file.mimeType, file.data);
    const f = await this.http.request<GFile>(`${UPLOAD}/files`, {
      method: "POST",
      query: { uploadType: "multipart", fields: FIELDS },
      rawBody: mp.body,
      contentType: mp.contentType,
      idempotent: false,
    });
    await this.keepRevision(f);
    return toCloud(f);
  }

  async uploadRevision(id: string, data: Buffer, mimeType: string): Promise<CloudFile> {
    assertId(id);
    const mp = multipart({}, mimeType, data);
    const f = await this.http.request<GFile>(`${UPLOAD}/files/${id}`, {
      method: "PATCH",
      query: { uploadType: "multipart", fields: FIELDS },
      rawBody: mp.body,
      contentType: mp.contentType,
      idempotent: false,
    });
    await this.keepRevision(f);
    return toCloud(f);
  }

  /** Drive prunes old revisions of binary files after 30 days unless they are kept forever. */
  private async keepRevision(f: GFile): Promise<void> {
    if (!f.headRevisionId) return;
    await this.http
      .request(`${API}/files/${f.id}/revisions/${f.headRevisionId}`, { method: "PATCH", body: { keepForever: true }, query: { fields: "id" } })
      .catch(() => undefined); // best effort — the file itself is stored
  }

  async deleteRevision(id: string, revisionId: string): Promise<void> {
    assertId(id);
    assertId(revisionId);
    await this.http.request(`${API}/files/${id}/revisions/${revisionId}`, { method: "DELETE" });
  }

  async ensureFolder(path: string): Promise<string> {
    const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) throw new ToolError("Ordnerpfad fehlt.", "INVALID_INPUT");
    let parent = "root";
    let key = "";
    for (const name of parts) {
      if (name.length > 100 || /[\u0000-\u001f]/.test(name)) throw new ToolError(`Ungültiger Ordnername „${name}“.`, "INVALID_INPUT");
      key += `/${name}`;
      const cached = this.folderCache.get(key);
      if (cached) {
        parent = cached;
        continue;
      }
      const q = `name = ${driveLiteral(name)} and mimeType = '${FOLDER}' and trashed = false and ${driveLiteral(parent)} in parents`;
      const found = await this.http.request<{ files: GFile[] }>(`${API}/files`, { query: { q, fields: "files(id)", pageSize: 1 } });
      const id =
        found.files?.[0]?.id ??
        (await this.http.request<GFile>(`${API}/files`, { method: "POST", body: { name, mimeType: FOLDER, parents: [parent] }, query: { fields: "id" }, idempotent: false })).id;
      this.folderCache.set(key, id);
      parent = id;
    }
    return parent;
  }

  async move(id: string, folderId: string): Promise<CloudFile> {
    assertId(id);
    assertId(folderId);
    const cur = await this.get(id);
    return toCloud(
      await this.http.request<GFile>(`${API}/files/${id}`, {
        method: "PATCH",
        body: {},
        query: { addParents: folderId, removeParents: cur.parents.join(",") || undefined, fields: FIELDS },
      }),
    );
  }

  async trash(id: string): Promise<void> {
    assertId(id);
    await this.http.request(`${API}/files/${id}`, { method: "PATCH", body: { trashed: true }, query: { fields: "id" } });
  }
}

/** How native Google files are read (text for the model) or imported (editable copy). */
export const NATIVE_EXPORT: Record<string, { read: string; readExt: string; import: string; importExt: string }> = {
  "application/vnd.google-apps.document": { read: "text/plain", readExt: "txt", import: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", importExt: "docx" },
  "application/vnd.google-apps.spreadsheet": { read: "text/csv", readExt: "csv", import: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", importExt: "xlsx" },
  "application/vnd.google-apps.presentation": { read: "text/plain", readExt: "txt", import: "application/vnd.openxmlformats-officedocument.presentationml.presentation", importExt: "pptx" },
};
