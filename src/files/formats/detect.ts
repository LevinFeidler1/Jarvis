import { ToolError } from "../../core/types.js";

export type FileFormat = "pdf" | "docx" | "xlsx" | "csv" | "pptx" | "txt" | "md" | "png" | "jpg" | "json";

export const FORMAT_MIME: Record<FileFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
};

export const FORMAT_LABEL: Record<FileFormat, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
  csv: "CSV",
  txt: "Text",
  md: "Markdown",
  json: "JSON",
  png: "Bild (PNG)",
  jpg: "Bild (JPG)",
};

const EXT: Record<string, FileFormat> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  pptx: "pptx",
  csv: "csv",
  tsv: "csv",
  txt: "txt",
  text: "txt",
  log: "txt",
  md: "md",
  markdown: "md",
  json: "json",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXT).map((e) => `.${e}`);

export const isImage = (f: FileFormat) => f === "png" || f === "jpg";
export const isText = (f: FileFormat) => f === "txt" || f === "md" || f === "csv" || f === "json";

const startsWith = (buf: Buffer, sig: number[]) => sig.every((b, i) => buf[i] === b);

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length < buf.length ? trimUtf8(sample) : sample);
    return true;
  } catch {
    // Latin-1/Windows-1252 text (old CSV exports) has no NUL bytes and few control chars.
    let ctrl = 0;
    for (const b of sample) if (b < 9 || (b > 13 && b < 32)) ctrl++;
    return ctrl / Math.max(1, sample.length) < 0.01;
  }
}

/** Cut a sample so it does not end in the middle of a multi-byte UTF-8 sequence. */
function trimUtf8(buf: Buffer): Buffer {
  let end = buf.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = buf[end - i]!;
    if ((b & 0xc0) === 0xc0) return buf.subarray(0, end - i);
    if ((b & 0x80) === 0) break;
  }
  return buf;
}

/** Strips path parts and characters that are unsafe in headers or file systems. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "datei";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
  return clean && !/^\.+$/.test(clean) ? clean : "datei";
}

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

export function withExtension(name: string, format: FileFormat): string {
  const ext = format === "jpg" ? "jpg" : format;
  const base = name.replace(/\.[A-Za-z0-9]{1,10}$/, "");
  return `${base || "datei"}.${ext}`;
}

/**
 * Determines the real format from the content (magic bytes), using the name
 * only to tell OOXML containers apart. Rejects files whose content does not
 * match the claimed type (e.g. an .exe renamed to .pdf).
 */
export function detectFormat(name: string, data: Buffer): FileFormat {
  const ext = extensionOf(name);
  const claimed = EXT[ext];
  if (!claimed) {
    throw new ToolError(`Dateityp „.${ext || "?"}“ wird nicht unterstützt. Erlaubt: PDF, DOCX, XLSX, CSV, PPTX, TXT, MD, JSON, PNG, JPG.`, "INVALID_INPUT");
  }
  if (data.length === 0) throw new ToolError("Die Datei ist leer.", "INVALID_INPUT");
  const zip = startsWith(data, [0x50, 0x4b, 0x03, 0x04]);
  const fits =
    claimed === "pdf"
      ? data.subarray(0, 1024).includes(Buffer.from("%PDF-"))
      : claimed === "png"
        ? startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : claimed === "jpg"
          ? startsWith(data, [0xff, 0xd8, 0xff])
          : claimed === "docx" || claimed === "xlsx" || claimed === "pptx"
            ? zip
            : looksLikeText(data);
  if (!fits) throw new ToolError(`Der Inhalt von „${name}“ passt nicht zum Dateityp .${ext}.`, "INVALID_INPUT");
  return claimed;
}

/** Guards against zip bombs before an OOXML file is unpacked. */
export async function assertSafeZip(data: Buffer, maxUncompressed = 200 * 1024 * 1024): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  let total = 0;
  for (const f of Object.values(zip.files)) {
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (total > maxUncompressed) throw new ToolError("Die Datei ist entpackt zu groß (Schutz vor Zip-Bomben).", "INVALID_INPUT");
  }
}
