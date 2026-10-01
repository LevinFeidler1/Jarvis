import { ToolError } from "../../core/types.js";
import { type CellInput, markdownToDocx, markdownToPdf, rowsToCsv, rowsToXlsx } from "./create.js";
import { type FileFormat, assertSafeZip } from "./detect.js";
import { decodeText, extract, parseCsv } from "./extract.js";

export const CONVERSIONS: Record<string, FileFormat[]> = {
  pdf: ["txt", "md", "docx"],
  docx: ["pdf", "md", "txt"],
  md: ["docx", "pdf", "txt"],
  txt: ["docx", "pdf", "md"],
  xlsx: ["csv", "pdf", "md"],
  csv: ["xlsx", "pdf", "md"],
  pptx: ["md", "txt", "pdf", "docx"],
  png: ["pdf"],
  jpg: ["pdf"],
};

export interface ConvertResult {
  data: Buffer;
  warnings: string[];
}

const LOSSY = "Textbasierte Umwandlung: Layout, Bilder und Formatierungen werden nicht übernommen.";

function mdTable(rows: unknown[][], maxRows = 500): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "/").replace(/\s+/g, " ");
  const line = (r: unknown[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [line(rows[0]!), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1, maxRows).map(line)].join("\n");
}

async function xlsxRows(data: Buffer, sheet?: string): Promise<{ name: string; rows: CellInput[][] }> {
  await assertSafeZip(data);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) throw new ToolError(`Blatt „${sheet}“ nicht gefunden.`, "NOT_FOUND");
  const rows: CellInput[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const out: CellInput[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value as unknown;
      out.push(
        v === null || v === undefined
          ? null
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : typeof v === "object"
              ? ((v as { result?: CellInput; text?: string }).result ?? (v as { text?: string }).text ?? null)
              : (v as CellInput),
      );
    }
    rows.push(out);
  });
  return { name: ws.name, rows };
}

async function imageToPdf(format: FileFormat, data: Buffer): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const img = format === "png" ? await pdf.embedPng(data) : await pdf.embedJpg(data);
  const W = 595.28, H = 841.89, M = 28;
  const scale = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height, 1);
  const page = pdf.addPage([W, H]);
  page.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  return Buffer.from(await pdf.save());
}

export async function convert(from: FileFormat, to: FileFormat, data: Buffer, opts: { sheet?: string; title?: string } = {}): Promise<ConvertResult> {
  if (!(CONVERSIONS[from] ?? []).includes(to)) {
    throw new ToolError(`Umwandlung ${from} → ${to} wird nicht unterstützt. Möglich: ${(CONVERSIONS[from] ?? []).join(", ") || "keine"}.`, "INVALID_INPUT");
  }
  // Tables
  if (from === "xlsx" || from === "csv") {
    const { name, rows } = from === "xlsx" ? await xlsxRows(data, opts.sheet) : { name: "Tabelle", rows: (await parseCsv(data)) as CellInput[][] };
    if (to === "csv") return { data: await rowsToCsv(rows), warnings: from === "xlsx" ? [`Nur Blatt „${name}“; Formeln als Ergebniswerte.`] : [] };
    if (to === "xlsx") return { data: await rowsToXlsx([{ name, rows }]), warnings: [] };
    const md = `# ${opts.title ?? name}\n\n${mdTable(rows)}`;
    if (to === "md") return { data: Buffer.from(md, "utf8"), warnings: rows.length > 500 ? ["Nur die ersten 500 Zeilen."] : [] };
    return { data: await markdownToPdf(md, opts.title), warnings: ["Breite Tabellen werden im PDF gekürzt dargestellt.", ...(rows.length > 500 ? ["Nur die ersten 500 Zeilen."] : [])] };
  }
  if (from === "png" || from === "jpg") return { data: await imageToPdf(from, data), warnings: [] };

  // Text-like documents
  let md: string;
  const warnings: string[] = [];
  if (from === "md" || from === "txt") md = decodeText(data);
  else if (from === "docx" && to === "md") {
    await assertSafeZip(data);
    const mammoth = (await import("mammoth")).default as unknown as { convertToMarkdown(i: { buffer: Buffer }): Promise<{ value: string }> };
    md = (await mammoth.convertToMarkdown({ buffer: data })).value.replace(/\\([.()!-])/g, "$1");
    warnings.push("Bilder und komplexe Formatierungen werden nicht übernommen.");
  } else {
    const ex = await extract(from, data);
    md = ex.pages && from === "pptx" ? ex.pages.map((t, i) => `## Folie ${i + 1}\n\n${t}`).join("\n\n") : ex.text;
    if (from === "pdf") md = (ex.pages ?? [ex.text]).join("\n\n");
    if (ex.needsVision) warnings.push("Das PDF enthält kaum Text (Scan?) — Inhalt ggf. mit read_file mode=visual lesen.");
    warnings.push(LOSSY);
  }
  if (to === "md" || to === "txt") return { data: Buffer.from(md, "utf8"), warnings };
  if (to === "docx") return { data: await markdownToDocx(md, opts.title), warnings };
  if (to === "pdf") return { data: await markdownToPdf(md, opts.title), warnings: from === "docx" ? [LOSSY] : warnings };
  throw new ToolError(`Umwandlung ${from} → ${to} wird nicht unterstützt.`, "INVALID_INPUT");
}
