import { ToolError } from "../../core/types.js";
import { type FileFormat, assertSafeZip, isImage } from "./detect.js";

export interface Extracted {
  /** Plain-text rendering (tables as tab-separated rows with cell references). */
  text: string;
  /** Pages (PDF) or slides (PPTX) with their own text, 1-based. */
  pages?: string[];
  sheets?: Array<{ name: string; rows: number; columns: number }>;
  /** PDF without a text layer (scan) — needs visual reading. */
  needsVision?: boolean;
  meta?: Record<string, unknown>;
}

const MAX_SHEET_ROWS = 2000;

export function decodeText(data: Buffer): string {
  const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
  const body = bom ? data.subarray(3) : data;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

export function columnLetter(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Renders a grid with A/B/C… column headers and row numbers, so cells can be referenced for edits. */
export function renderGrid(rows: unknown[][], maxRows = MAX_SHEET_ROWS): string {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const head = ["", ...Array.from({ length: width }, (_, i) => columnLetter(i + 1))].join("\t");
  const body = rows.slice(0, maxRows).map((r, i) => [String(i + 1), ...Array.from({ length: width }, (_, c) => cellText(r[c]))].join("\t"));
  const more = rows.length > maxRows ? `\n… ${rows.length - maxRows} weitere Zeilen` : "";
  return `${head}\n${body.join("\n")}${more}`;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { formula?: string; result?: unknown; text?: string; richText?: Array<{ text: string }>; hyperlink?: string; error?: string };
    if (o.formula) return `=${o.formula} → ${cellText(o.result)}`;
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text !== undefined) return String(o.text);
    if (o.error) return String(o.error);
    return JSON.stringify(v);
  }
  return String(v).replace(/[\t\r\n]+/g, " ");
}

async function extractPdf(data: Buffer): Promise<Extracted> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t) => t.replace(/[ \t]+\n/g, "\n").trim());
  const chars = pages.join("").replace(/\s/g, "").length;
  return {
    text: pages.map((t, i) => `--- Seite ${i + 1} ---\n${t}`).join("\n\n"),
    pages,
    needsVision: chars < 20 * Math.max(1, totalPages),
    meta: { pages: totalPages },
  };
}

async function extractDocx(data: Buffer): Promise<Extracted> {
  await assertSafeZip(data);
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: data });
  return { text: value.replace(/\n{3,}/g, "\n\n").trim() };
}

async function extractXlsx(data: Buffer, sheetName?: string): Promise<Extracted> {
  await assertSafeZip(data);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheets: Extracted["sheets"] = [];
  const parts: string[] = [];
  wb.eachSheet((ws) => {
    sheets.push({ name: ws.name, rows: ws.rowCount, columns: ws.columnCount });
    if (sheetName && ws.name.toLowerCase() !== sheetName.toLowerCase()) return;
    const rows: unknown[][] = [];
    for (let r = 1; r <= Math.min(ws.rowCount, MAX_SHEET_ROWS + 1); r++) {
      const row = ws.getRow(r);
      const values: unknown[] = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(row.getCell(c).value);
      rows.push(values);
    }
    parts.push(`### Blatt „${ws.name}“ (${ws.rowCount} Zeilen × ${ws.columnCount} Spalten)\n${renderGrid(rows)}`);
  });
  if (sheetName && parts.length === 0) throw new ToolError(`Blatt „${sheetName}“ nicht gefunden. Vorhanden: ${sheets.map((s) => s.name).join(", ")}`, "NOT_FOUND");
  return { text: parts.join("\n\n"), sheets };
}

export async function parseCsv(data: Buffer): Promise<string[][]> {
  const Papa = (await import("papaparse")).default;
  const parsed = Papa.parse<string[]>(decodeText(data), { skipEmptyLines: "greedy" });
  return parsed.data;
}

async function extractCsv(data: Buffer): Promise<Extracted> {
  const rows = await parseCsv(data);
  return { text: renderGrid(rows), sheets: [{ name: "CSV", rows: rows.length, columns: rows.reduce((m, r) => Math.max(m, r.length), 0) }] };
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function extractPptx(data: Buffer): Promise<Extracted> {
  await assertSafeZip(data);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const pages: string[] = [];
  for (const f of slideFiles) {
    const xml = await zip.file(f)!.async("string");
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1]!)).join("")).filter((t) => t.trim());
    pages.push(paras.join("\n"));
  }
  return { text: pages.map((t, i) => `--- Folie ${i + 1} ---\n${t}`).join("\n\n"), pages, meta: { slides: pages.length } };
}

export async function extract(format: FileFormat, data: Buffer, opts: { sheet?: string } = {}): Promise<Extracted> {
  switch (format) {
    case "pdf":
      return extractPdf(data);
    case "docx":
      return extractDocx(data);
    case "xlsx":
      return extractXlsx(data, opts.sheet);
    case "csv":
      return extractCsv(data);
    case "pptx":
      return extractPptx(data);
    case "txt":
    case "md":
    case "json":
      return { text: decodeText(data) };
    default:
      if (isImage(format)) return { text: "", needsVision: true };
      throw new ToolError(`Format ${format} kann nicht gelesen werden.`, "INVALID_INPUT");
  }
}

/** Parses "1-3,5" into sorted unique 1-based page numbers within [1, max]. */
export function parsePageList(spec: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!m) throw new ToolError(`Ungültige Seitenangabe „${part}“ (Beispiel: 1-3,5).`, "INVALID_INPUT");
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > max) throw new ToolError(`Seiten ${part} liegen außerhalb von 1–${max}.`, "INVALID_INPUT");
    for (let i = a; i <= b; i++) out.add(i);
  }
  if (out.size === 0) throw new ToolError("Keine Seiten angegeben.", "INVALID_INPUT");
  return [...out].sort((x, y) => x - y);
}

/** Downscales large photos for Claude vision (long edge ≤ 1568 px, ≤ ~3.5 MB). */
export async function imageForVision(format: FileFormat, data: Buffer): Promise<{ mediaType: "image/png" | "image/jpeg"; base64: string }> {
  const mediaType = format === "png" ? "image/png" : "image/jpeg";
  const { Jimp } = await import("jimp");
  const img = await Jimp.read(data);
  const long = Math.max(img.width, img.height);
  if (long <= 1568 && data.length <= 3_500_000) return { mediaType, base64: data.toString("base64") };
  if (long > 1568) img.scaleToFit({ w: 1568, h: 1568 });
  const out = await img.getBuffer("image/jpeg", { quality: 85 });
  return { mediaType: "image/jpeg", base64: Buffer.from(out).toString("base64") };
}
