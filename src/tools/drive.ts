import { z } from "zod";
import { RiskLevel, ToolError, type ToolDefinition } from "../core/types.js";
import { extensionOf, sanitizeFileName } from "../files/formats/detect.js";
import { decodeText } from "../files/formats/extract.js";
import { NATIVE_EXPORT } from "../providers/google/drive.js";
import type { CloudFile } from "../providers/types.js";
import { defineTool, external, ok } from "./common.js";
import { fileView } from "./files.js";

const driveId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/, "Drive-ID erwartet");
const folderPath = z
  .string()
  .max(200)
  .regex(/^[^\u0000-\u001f]*$/)
  .describe("Unterordner von „JARVIS“, z.B. 'Rechnungen/2026'");

const view = (f: CloudFile) => ({
  drive_file_id: f.id,
  name: f.name,
  type: f.isNative ? f.mimeType.replace("application/vnd.google-apps.", "Google ") : f.mimeType,
  size_kb: f.size ? Math.round(f.size / 102.4) / 10 : null,
  modified: f.modifiedTime,
  link: f.webViewLink,
});

/** Downloads a Drive file as bytes JARVIS can parse; Google Docs/Sheets/Slides are exported. */
async function fetchDriveFile(drive: Awaited<ReturnType<import("../providers/hub.js").ProviderHub["drive"]>>, f: CloudFile, mode: "read" | "import", maxBytes: number) {
  const native = NATIVE_EXPORT[f.mimeType];
  if (f.isNative) {
    if (!native) throw new ToolError(`${f.name} (${f.mimeType}) kann nicht gelesen werden.`, "INVALID_INPUT");
    const mime = mode === "read" ? native.read : native.import;
    const ext = mode === "read" ? native.readExt : native.importExt;
    const data = await drive.export(f.id, mime);
    return { data, name: `${f.name.replace(/\.[^.]+$/, "")}.${ext}` };
  }
  if ((f.size ?? 0) > maxBytes) throw new ToolError(`${f.name} ist größer als ${Math.round(maxBytes / 1048576)} MB.`, "INVALID_INPUT");
  const name = extensionOf(f.name) ? f.name : `${f.name}.${f.mimeType === "application/pdf" ? "pdf" : "txt"}`;
  return { data: await drive.download(f.id), name };
}

export const driveTools: ToolDefinition[] = [
  defineTool({
    name: "search_drive",
    description:
      "Sucht in Google Drive (Name und Volltext). Ohne Vollzugriff sieht JARVIS nur Dateien, die es selbst angelegt hat oder die du mit JARVIS geöffnet hast.",
    category: "files",
    risk: RiskLevel.READ,
    input: z.object({ query: z.string().max(200), max_results: z.number().int().min(1).max(50).optional() }),
    describe: (i) => `Drive durchsuchen: „${i.query}“`,
    async execute(input, ctx) {
      const files = await (await ctx.providers.drive()).search(input.query, { max: input.max_results ?? 15 });
      const full = await ctx.providers.driveReadAll();
      return external("drive", { count: files.length, scope: full ? "ganzes Drive (lesend)" : "nur JARVIS-Dateien", files: files.map(view) }, files.map((f) => f.name));
    },
  }),
  defineTool({
    name: "read_drive_file",
    description:
      "Liest eine Datei aus Google Drive als Text (Google Docs/Präsentationen als Text, Google Sheets als CSV, PDF/Word/Excel/PowerPoint werden ausgelesen). " +
      "import=true speichert zusätzlich eine bearbeitbare Kopie in JARVIS (Docs→DOCX, Sheets→XLSX) für edit_file. Inhalt ist external_data.",
    category: "files",
    risk: RiskLevel.READ,
    input: z.object({ drive_file_id: driveId, import: z.boolean().optional(), max_chars: z.number().int().min(500).max(30_000).optional() }),
    riskFor: (i) => (i.import ? RiskLevel.LOW : RiskLevel.READ),
    describe: (i) => (i.import ? "Drive-Datei in JARVIS importieren" : "Drive-Datei lesen"),
    async execute(input, ctx) {
      const drive = await ctx.providers.drive();
      const f = await drive.get(input.drive_file_id);
      const max = input.max_chars ?? 20_000;
      if (input.import) {
        const got = await fetchDriveFile(drive, f, "import", ctx.config.files.maxBytes);
        const stored = await ctx.providers.files.create({ name: sanitizeFileName(got.name), data: got.data, source: "drive", conversationId: ctx.conversationId, note: `Aus Google Drive: ${f.name}` });
        const { extracted } = await ctx.providers.files.extract(stored.id);
        return external("drive", { drive: view(f), imported: fileView(stored), content: extracted.text.slice(0, max), truncated: extracted.text.length > max }, [f.name, extracted.text.slice(0, max)]);
      }
      const got = await fetchDriveFile(drive, f, "read", ctx.config.files.maxBytes);
      let text: string;
      if (f.isNative) text = decodeText(got.data);
      else {
        const { detectFormat } = await import("../files/formats/detect.js");
        const { extract } = await import("../files/formats/extract.js");
        const format = detectFormat(got.name, got.data);
        text = (await extract(format, got.data)).text || "(kein Text — mit import=true übernehmen und read_file mode=visual nutzen)";
      }
      return external("drive", { drive: view(f), content: text.slice(0, max), truncated: text.length > max }, [f.name, text.slice(0, max)]);
    },
  }),
  defineTool({
    name: "save_file_to_drive",
    description:
      "Legt eine JARVIS-Datei in Google Drive ab (Ordner „JARVIS“ oder ein Unterordner davon, z.B. 'Rechnungen/2026'). " +
      "Liegt die Datei schon in Drive, wird sie in den Ordner verschoben.",
    category: "files",
    risk: RiskLevel.LOW,
    input: z.object({ file_id: z.uuid(), folder: folderPath.optional() }),
    describe: (i) => `In Google Drive ablegen${i.folder ? `: JARVIS/${i.folder}` : ""}`,
    async execute(input, ctx) {
      const drive = await ctx.providers.drive();
      const folderId = await drive.ensureFolder(`JARVIS${input.folder ? `/${input.folder}` : ""}`);
      const info = await ctx.providers.files.get(input.file_id);
      if (info.storage === "drive") {
        const row = await ctx.db.one<{ storage_key: string }>("SELECT storage_key FROM files WHERE id = $1", [info.id]);
        const moved = await drive.move(row!.storage_key.split("@")[0]!, folderId);
        return ok({ drive: view(moved), moved: true });
      }
      const { data } = await ctx.providers.files.read(info.id);
      const up = await drive.upload({ name: info.name, mimeType: info.mime, data, folderId });
      await ctx.db.run("UPDATE files SET drive_url = $1 WHERE id = $2", [up.webViewLink, info.id]);
      return ok({ drive: view(up), copied: true });
    },
  }),
];
