import { ToolError } from "../../core/types.js";

// ─── Tiny Markdown model shared by the DOCX and PDF writers ──────────────────

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "bullet"; spans: Span[]; ordered: boolean; n: number }
  | { type: "table"; rows: string[][] }
  | { type: "rule" };

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) spans.push({ text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**") || t.startsWith("__")) spans.push({ text: t.slice(2, -2), bold: true });
    else spans.push({ text: t.slice(1, -1), italic: true });
    last = m.index! + t.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text: "" }];
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", spans: parseInline(para.join(" ").trim()) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      blocks.push({ type: "heading", level: Math.min(3, h[1]!.length) as 1 | 2 | 3, spans: parseInline(h[2]!) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const b = /^[-*•]\s+(.*)$/.exec(t);
    const o = /^(\d+)[.)]\s+(.*)$/.exec(t);
    if (b || o) {
      flush();
      blocks.push({ type: "bullet", ordered: !!o, n: o ? Number(o[1]) : 0, spans: parseInline((b ? b[1] : o![2])!) });
      continue;
    }
    if (t.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const row = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!row.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(row);
        i++;
      }
      i--;
      blocks.push({ type: "table", rows });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

const plain = (spans: Span[]) => spans.map((s) => s.text).join("");

// ─── DOCX ────────────────────────────────────────────────────────────────────

export async function markdownToDocx(md: string, title?: string): Promise<Buffer> {
  const d = await import("docx");
  const runs = (spans: Span[], size?: number) => spans.map((s) => new d.TextRun({ text: s.text, bold: s.bold, italics: s.italic, size }));
  const children: Array<InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>> = [];
  const HEAD = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3];
  for (const b of parseMarkdown(md)) {
    if (b.type === "heading") children.push(new d.Paragraph({ heading: HEAD[b.level - 1], children: runs(b.spans) }));
    else if (b.type === "paragraph") children.push(new d.Paragraph({ children: runs(b.spans), spacing: { after: 120 } }));
    else if (b.type === "bullet")
      children.push(
        b.ordered
          ? new d.Paragraph({ children: [new d.TextRun(`${b.n}. `), ...runs(b.spans)], indent: { left: 360, hanging: 260 } })
          : new d.Paragraph({ children: runs(b.spans), bullet: { level: 0 } }),
      );
    else if (b.type === "rule") children.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } }));
    else if (b.type === "table" && b.rows.length) {
      const width = Math.max(...b.rows.map((r) => r.length));
      children.push(
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: b.rows.map(
            (r, ri) =>
              new d.TableRow({
                tableHeader: ri === 0,
                children: Array.from({ length: width }, (_, c) => new d.TableCell({ children: [new d.Paragraph({ children: runs(parseInline(r[c] ?? "")).map((x) => x) })], shading: ri === 0 ? { fill: "EEEEEE" } : undefined })),
              }),
          ),
        }),
      );
    }
  }
  if (children.length === 0) children.push(new d.Paragraph(""));
  const doc = new d.Document({ creator: "JARVIS", title: title ?? "Dokument", sections: [{ children }] });
  return Buffer.from(await d.Packer.toBuffer(doc));
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** Characters outside WinAnsi (the standard PDF fonts) are mapped to look-alikes. */
function winAnsi(text: string): string {
  return text
    .replace(/[‐-‒−]/g, "-")
    .replace(/[→⇒]/g, "->")
    .replace(/[✓✔]/g, "v")
    .replace(/[   ]/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e¡-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, "?");
}

export async function markdownToPdf(md: string, title?: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title ?? "Dokument");
  pdf.setCreator("JARVIS");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const W = 595.28, H = 841.89, M = 56;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M) newPage();
  };

  /** Word-wraps styled spans into lines and draws them. */
  const drawSpans = (spans: Span[], size: number, indent = 0, forceBold = false) => {
    type Word = { text: string; f: typeof font };
    const words: Word[] = [];
    for (const s of spans) {
      const f = forceBold || s.bold ? bold : s.italic ? italic : font;
      for (const w of winAnsi(s.text).split(/(\s+)/)) if (w) words.push({ text: w, f });
    }
    const maxW = W - 2 * M - indent;
    let line: Word[] = [];
    let lineW = 0;
    const flush = () => {
      ensure(size * 1.35);
      let x = M + indent;
      for (const w of line) {
        page.drawText(w.text, { x, y: y - size, size, font: w.f, color: rgb(0.1, 0.1, 0.1) });
        x += w.f.widthOfTextAtSize(w.text, size);
      }
      y -= size * 1.35;
      line = [];
      lineW = 0;
    };
    for (const w of words) {
      const ww = w.f.widthOfTextAtSize(w.text, size);
      if (lineW + ww > maxW && line.length && w.text.trim()) flush();
      if (!line.length && !w.text.trim()) continue;
      line.push(w);
      lineW += ww;
    }
    if (line.length) flush();
  };

  for (const b of parseMarkdown(md)) {
    if (b.type === "heading") {
      const size = [18, 14, 12][b.level - 1]!;
      y -= 6;
      ensure(size * 2);
      drawSpans(b.spans, size, 0, true);
      y -= 4;
    } else if (b.type === "paragraph") {
      drawSpans(b.spans, 10.5);
      y -= 5;
    } else if (b.type === "bullet") {
      ensure(14);
      page.drawText(b.ordered ? `${b.n}.` : "•", { x: M + 4, y: y - 10.5, size: 10.5, font });
      drawSpans(b.spans, 10.5, 18);
      y -= 2;
    } else if (b.type === "rule") {
      ensure(10);
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      y -= 12;
    } else if (b.type === "table" && b.rows.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const cw = (W - 2 * M) / cols;
      for (const [ri, r] of b.rows.entries()) {
        ensure(16);
        for (let c = 0; c < cols; c++) {
          const f = ri === 0 ? bold : font;
          let t = winAnsi(plain(parseInline(r[c] ?? "")));
          while (t && f.widthOfTextAtSize(t, 9.5) > cw - 6) t = t.slice(0, -2) + "…";
          page.drawText(t, { x: M + c * cw + 3, y: y - 11, size: 9.5, font: f });
        }
        page.drawLine({ start: { x: M, y: y - 15 }, end: { x: W - M, y: y - 15 }, thickness: 0.3, color: rgb(0.75, 0.75, 0.75) });
        y -= 16;
      }
      y -= 6;
    }
  }
  return Buffer.from(await pdf.save());
}

// ─── XLSX / CSV ──────────────────────────────────────────────────────────────

export type CellInput = string | number | boolean | null;

export function cellValue(v: CellInput): unknown {
  if (typeof v === "string" && v.startsWith("=") && v.length > 1) return { formula: v.slice(1) };
  return v;
}

export async function rowsToXlsx(sheets: Array<{ name: string; rows: CellInput[][] }>): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "JARVIS";
  if (!sheets.length) throw new ToolError("Mindestens ein Tabellenblatt angeben.", "INVALID_INPUT");
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, "_") || "Tabelle");
    for (const r of s.rows) ws.addRow(r.map((v) => cellValue(v)));
    if (s.rows.length > 1) ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col, i) => {
      const len = Math.max(8, ...s.rows.map((r) => String(r[i] ?? "").length));
      col.width = Math.min(60, len + 2);
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Neutralises spreadsheet formulas in CSV cells (CSV injection: =HYPERLINK(…), @SUM, +cmd …). */
export function csvSafe(v: CellInput): string | number | boolean {
  if (v === null) return "";
  if (typeof v !== "string") return v;
  return /^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d+([.,]\d+)?$/.test(v)) ? `'${v}` : v;
}

export async function rowsToCsv(rows: CellInput[][]): Promise<Buffer> {
  const Papa = (await import("papaparse")).default;
  // Excel (de) expects a BOM and semicolons; formulas are written as text, never as live formulas.
  return Buffer.from(`﻿${Papa.unparse(rows.map((r) => r.map(csvSafe)), { delimiter: ";" })}\r\n`, "utf8");
}
