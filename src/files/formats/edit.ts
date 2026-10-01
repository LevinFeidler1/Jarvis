import { ToolError } from "../../core/types.js";
import { type CellInput, cellValue, rowsToCsv } from "./create.js";
import { type FileFormat, assertSafeZip } from "./detect.js";
import { decodeText, parseCsv, parsePageList } from "./extract.js";

export type EditOp =
  | { op: "replace_text"; find: string; replace: string; all?: boolean }
  | { op: "append_text"; text: string }
  | { op: "set_cells"; sheet?: string; cells: Array<{ ref: string; value?: CellInput; formula?: string }> }
  | { op: "append_rows"; sheet?: string; rows: CellInput[][] }
  | { op: "add_sheet"; name: string; rows?: CellInput[][] }
  | { op: "merge_pdf"; with: Buffer[] }
  | { op: "keep_pages"; pages: string }
  | { op: "delete_pages"; pages: string }
  | { op: "rotate_pages"; pages: string; degrees: 90 | 180 | 270 };

export interface EditResult {
  data: Buffer;
  /** Human-readable summary of what changed. */
  changes: string[];
  warnings: string[];
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function replaceInString(text: string, find: string, replace: string, all: boolean): { text: string; count: number } {
  if (!find) throw new ToolError("„find“ darf nicht leer sein.", "INVALID_INPUT");
  if (all) {
    const parts = text.split(find);
    return { text: parts.join(replace), count: parts.length - 1 };
  }
  const i = text.indexOf(find);
  if (i < 0) return { text, count: 0 };
  return { text: text.slice(0, i) + replace + text.slice(i + find.length), count: 1 };
}

/**
 * Replaces text inside Word paragraphs. A match may span several runs
 * (Word splits text by formatting); the paragraph's text is then put into its
 * first run, which keeps that run's formatting.
 */
function docxReplace(xml: string, find: string, replace: string, all: boolean): { xml: string; count: number } {
  let count = 0;
  const out = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    if (!all && count > 0) return para;
    const texts = [...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    if (!texts.length) return para;
    const full = texts.map((m) => unescapeXml(m[1]!)).join("");
    if (!full.includes(find)) return para;
    const r = replaceInString(full, find, replace, all);
    count += r.count;
    let first = true;
    return para.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, () => {
      if (first) {
        first = false;
        return `<w:t xml:space="preserve">${escapeXml(r.text)}</w:t>`;
      }
      return "<w:t></w:t>";
    });
  });
  return { xml: out, count };
}

function docxParagraphs(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");
}

async function editDocx(data: Buffer, ops: EditOp[]): Promise<EditResult> {
  await assertSafeZip(data);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  const xmls = new Map<string, string>();
  for (const p of parts) xmls.set(p, await zip.file(p)!.async("string"));
  const changes: string[] = [];
  const warnings: string[] = [];
  for (const op of ops) {
    if (op.op === "replace_text") {
      let total = 0;
      for (const [p, xml] of xmls) {
        const r = docxReplace(xml, op.find, op.replace, op.all ?? true);
        xmls.set(p, r.xml);
        total += r.count;
      }
      if (!total) throw new ToolError(`Text „${op.find}“ wurde im Dokument nicht gefunden.`, "NOT_FOUND");
      changes.push(`„${op.find}“ → „${op.replace}“ (${total}×)`);
    } else if (op.op === "append_text") {
      const doc = xmls.get("word/document.xml")!;
      const at = doc.lastIndexOf("<w:sectPr");
      const end = doc.lastIndexOf("</w:body>");
      const idx = at > -1 && at < end ? at : end;
      xmls.set("word/document.xml", doc.slice(0, idx) + docxParagraphs(op.text) + doc.slice(idx));
      changes.push(`Text angehängt (${op.text.split("\n").length} Absatz/Absätze)`);
    } else throw new ToolError(`Operation ${op.op} ist für Word-Dateien nicht möglich.`, "INVALID_INPUT");
  }
  for (const [p, xml] of xmls) zip.file(p, xml);
  if (ops.some((o) => o.op === "replace_text")) warnings.push("Bei Treffern über Formatierungsgrenzen übernimmt der Absatz die Formatierung seines ersten Textstücks.");
  return { data: Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })), changes, warnings };
}

const REF = /^([A-Z]{1,3})([1-9]\d{0,6})$/;

async function editXlsx(data: Buffer, ops: EditOp[]): Promise<EditResult> {
  await assertSafeZip(data);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const changes: string[] = [];
  const sheetOf = (name?: string) => {
    const ws = name ? wb.getWorksheet(name) : wb.worksheets[0];
    if (!ws) throw new ToolError(`Blatt „${name}“ nicht gefunden. Vorhanden: ${wb.worksheets.map((w) => w.name).join(", ")}`, "NOT_FOUND");
    return ws;
  };
  for (const op of ops) {
    if (op.op === "set_cells") {
      const ws = sheetOf(op.sheet);
      for (const c of op.cells) {
        const ref = c.ref.toUpperCase();
        if (!REF.test(ref)) throw new ToolError(`Ungültige Zelle „${c.ref}“ (Beispiel: B4).`, "INVALID_INPUT");
        ws.getCell(ref).value = (c.formula ? { formula: c.formula.replace(/^=/, "") } : cellValue(c.value ?? null)) as never;
      }
      changes.push(`${op.cells.length} Zelle(n) in „${ws.name}“ gesetzt: ${op.cells.map((c) => c.ref.toUpperCase()).join(", ")}`);
    } else if (op.op === "append_rows") {
      const ws = sheetOf(op.sheet);
      for (const r of op.rows) ws.addRow(r.map((v) => cellValue(v)));
      changes.push(`${op.rows.length} Zeile(n) an „${ws.name}“ angehängt`);
    } else if (op.op === "add_sheet") {
      if (wb.getWorksheet(op.name)) throw new ToolError(`Blatt „${op.name}“ existiert bereits.`, "INVALID_INPUT");
      const ws = wb.addWorksheet(op.name.slice(0, 31));
      for (const r of op.rows ?? []) ws.addRow(r.map((v) => cellValue(v)));
      changes.push(`Blatt „${ws.name}“ hinzugefügt`);
    } else throw new ToolError(`Operation ${op.op} ist für Excel-Dateien nicht möglich.`, "INVALID_INPUT");
  }
  return {
    data: Buffer.from(await wb.xlsx.writeBuffer()),
    changes,
    warnings: ["Formel-Ergebnisse berechnet Excel beim nächsten Öffnen. Diagramme/Pivot-Tabellen werden beim Bearbeiten ggf. nicht übernommen."],
  };
}

function colIndex(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

async function editCsv(data: Buffer, ops: EditOp[]): Promise<EditResult> {
  const rows: CellInput[][] = await parseCsv(data);
  const changes: string[] = [];
  for (const op of ops) {
    if (op.op === "set_cells") {
      for (const c of op.cells) {
        const m = REF.exec(c.ref.toUpperCase());
        if (!m) throw new ToolError(`Ungültige Zelle „${c.ref}“.`, "INVALID_INPUT");
        const r = Number(m[2]) - 1;
        const col = colIndex(m[1]!) - 1;
        while (rows.length <= r) rows.push([]);
        const row = rows[r]!;
        while (row.length <= col) row.push("");
        row[col] = c.formula ? `=${c.formula.replace(/^=/, "")}` : (c.value ?? "");
      }
      changes.push(`${op.cells.length} Zelle(n) gesetzt`);
    } else if (op.op === "append_rows") {
      rows.push(...op.rows);
      changes.push(`${op.rows.length} Zeile(n) angehängt`);
    } else if (op.op === "replace_text") {
      let n = 0;
      for (const row of rows) for (let i = 0; i < row.length; i++) {
        const v = row[i];
        if (typeof v === "string" && v.includes(op.find)) {
          const r = replaceInString(v, op.find, op.replace, op.all ?? true);
          row[i] = r.text;
          n += r.count;
        }
      }
      if (!n) throw new ToolError(`Text „${op.find}“ nicht gefunden.`, "NOT_FOUND");
      changes.push(`„${op.find}“ → „${op.replace}“ (${n}×)`);
    } else throw new ToolError(`Operation ${op.op} ist für CSV nicht möglich.`, "INVALID_INPUT");
  }
  return { data: await rowsToCsv(rows), changes, warnings: [] };
}

function editText(data: Buffer, ops: EditOp[]): EditResult {
  let text = decodeText(data);
  const changes: string[] = [];
  for (const op of ops) {
    if (op.op === "replace_text") {
      const r = replaceInString(text, op.find, op.replace, op.all ?? true);
      if (!r.count) throw new ToolError(`Text „${op.find}“ nicht gefunden.`, "NOT_FOUND");
      text = r.text;
      changes.push(`„${op.find}“ → „${op.replace}“ (${r.count}×)`);
    } else if (op.op === "append_text") {
      text = `${text.replace(/\s*$/, "")}\n\n${op.text}\n`;
      changes.push("Text angehängt");
    } else throw new ToolError(`Operation ${op.op} ist für Textdateien nicht möglich.`, "INVALID_INPUT");
  }
  return { data: Buffer.from(text, "utf8"), changes, warnings: [] };
}

async function editPdf(data: Buffer, ops: EditOp[]): Promise<EditResult> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  let pdf = await PDFDocument.load(data, { ignoreEncryption: false });
  const changes: string[] = [];
  for (const op of ops) {
    if (op.op === "merge_pdf") {
      for (const other of op.with) {
        const src = await PDFDocument.load(other);
        const pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach((p) => pdf.addPage(p));
        changes.push(`${pages.length} Seite(n) angehängt`);
      }
    } else if (op.op === "keep_pages" || op.op === "delete_pages") {
      const total = pdf.getPageCount();
      const list = parsePageList(op.pages, total);
      const keep = op.op === "keep_pages" ? list : Array.from({ length: total }, (_, i) => i + 1).filter((n) => !list.includes(n));
      if (!keep.length) throw new ToolError("Danach bliebe keine Seite übrig.", "INVALID_INPUT");
      const out = await PDFDocument.create();
      (await out.copyPages(pdf, keep.map((n) => n - 1))).forEach((p) => out.addPage(p));
      pdf = out;
      changes.push(op.op === "keep_pages" ? `Seiten ${op.pages} übernommen (${keep.length} Seiten)` : `Seiten ${op.pages} entfernt (${keep.length} übrig)`);
    } else if (op.op === "rotate_pages") {
      const list = parsePageList(op.pages, pdf.getPageCount());
      for (const n of list) {
        const p = pdf.getPage(n - 1);
        p.setRotation(degrees((p.getRotation().angle + op.degrees) % 360));
      }
      changes.push(`Seiten ${op.pages} um ${op.degrees}° gedreht`);
    } else throw new ToolError(`Operation ${op.op} ist für PDFs nicht möglich (Text in PDFs lässt sich nicht direkt ändern — in DOCX umwandeln, bearbeiten und wieder als PDF erstellen).`, "INVALID_INPUT");
  }
  return { data: Buffer.from(await pdf.save()), changes, warnings: [] };
}

export async function applyEdits(format: FileFormat, data: Buffer, ops: EditOp[]): Promise<EditResult> {
  if (!ops.length) throw new ToolError("Keine Änderungen angegeben.", "INVALID_INPUT");
  switch (format) {
    case "docx":
      return editDocx(data, ops);
    case "xlsx":
      return editXlsx(data, ops);
    case "csv":
      return editCsv(data, ops);
    case "txt":
    case "md":
    case "json":
      return editText(data, ops);
    case "pdf":
      return editPdf(data, ops);
    default:
      throw new ToolError(`Dateien vom Typ ${format} können nicht bearbeitet werden.`, "INVALID_INPUT");
  }
}
