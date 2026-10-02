// Files: chunked upload, ranged download (Vercel 4.5 MB request limit), drop zones.

import { api, state } from "./api.js";
import { h } from "./dom.js";
import { fail } from "./ui.js";

// ─── Dateien: Upload in Teilen, Download in Bereichen (Vercel-Limit 4,5 MB) ──
export const FILE_ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.csv,.tsv,.pptx,.txt,.md,.markdown,.json,.png,.jpg,.jpeg";
export const FILE_ICON = { pdf: "file", docx: "file", xlsx: "chart", csv: "chart", pptx: "file", txt: "file", md: "file", json: "file", png: "image", jpg: "image" };
export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);

export async function uploadFile(file, onProgress = () => {}, conversationId) {
  const begin = await api("/api/files/uploads", { method: "POST", body: { name: file.name, size: file.size } });
  for (let i = 0; i < begin.chunks; i++) {
    const part = file.slice(i * begin.chunkSize, Math.min(file.size, (i + 1) * begin.chunkSize));
    const res = await fetch(`/api/files/uploads/${begin.uploadId}/${i}`, {
      method: "PUT", credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", "x-jarvis-csrf": state.csrf ?? "" },
      body: part,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Upload fehlgeschlagen (HTTP ${res.status})`);
    onProgress((i + 1) / begin.chunks);
  }
  return api(`/api/files/uploads/${begin.uploadId}/complete`, { method: "POST", body: conversationId ? { conversationId } : {} });
}

export async function fetchFileBlob(id, size) {
  const parts = [];
  let type = "application/octet-stream";
  for (let start = 0; start === 0 || start < size; ) {
    const res = await fetch(`/api/files/${id}/content`, { credentials: "same-origin", headers: { range: `bytes=${start}-` } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Download fehlgeschlagen (HTTP ${res.status})`);
    type = res.headers.get("content-type") ?? type;
    size = Number(res.headers.get("x-file-size") ?? size ?? 0);
    const buf = await res.arrayBuffer();
    parts.push(buf);
    start += buf.byteLength;
    if (!buf.byteLength) break;
  }
  return new Blob(parts, { type });
}

export async function downloadFile(id, name, size) {
  try {
    const blob = await fetchFileBlob(id, size);
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name ?? "datei" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) { fail(e); }
}

export async function openFileById(id) {
  try {
    const { file } = await api(`/api/files/${id}`);
    downloadFile(file.id, file.name, file.size);
  } catch (e) { fail(e); }
}

/** Drag & drop target that calls onFiles(FileList). */
export function dropZone(el, onFiles) {
  let depth = 0;
  el.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); depth++; el.classList.add("dragging"); } });
  el.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  el.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove("dragging"); });
  el.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; el.classList.remove("dragging"); onFiles(e.dataTransfer.files); });
}
