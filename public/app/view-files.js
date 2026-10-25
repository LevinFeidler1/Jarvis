// Files view.

import { api, state } from "./api.js";
import { fmt, h, icon, set } from "./dom.js";
import { FILE_ACCEPT, FILE_ICON, downloadFile, dropZone, fetchFileBlob, fmtSize, uploadFile } from "./files-io.js";
import { go, viewHead } from "./shell.js";
import { dialog, fail, toast } from "./ui.js";

// ─── View: Dateien ──────────────────────────────────────────────────────────
const SOURCE_LABEL = { upload: "hochgeladen", generated: "von JARVIS erstellt", edited: "bearbeitet", converted: "umgewandelt", drive: "aus Drive", browser: "aus dem Web", telegram: "per Telegram" };

function chatAboutFile(file) {
  state.conversationId = null;
  state.attachments = [{ name: file.name, size: file.size, progress: 1, file, error: null, promise: Promise.resolve() }];
  go("chat");
}

async function previewFile(file) {
  const body = h("div", { class: "preview-body" }, h("div", { class: "spinner", style: "margin:30px auto" }));
  const close = () => { wrap.remove(); if (url) URL.revokeObjectURL(url); };
  let url = null;
  const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close() },
    h("div", { class: "modal preview-modal", role: "dialog", "aria-modal": "true" },
      h("div", { class: "preview-head" }, h("h3", {}, file.name), h("button", { class: "btn ghost icon", "aria-label": "Schließen", onclick: close }, icon("x"))),
      body,
      h("div", { class: "foot" },
        h("button", { class: "btn", onclick: () => { close(); chatAboutFile(file); } }, icon("chat"), h("span", {}, "Mit JARVIS besprechen")),
        h("button", { class: "btn primary", onclick: () => downloadFile(file.id, file.name, file.size) }, icon("download"), h("span", {}, "Herunterladen")))));
  wrap.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(wrap);
  try {
    if (file.format === "png" || file.format === "jpg") {
      url = URL.createObjectURL(await fetchFileBlob(file.id, file.size));
      set(body, h("img", { src: url, alt: file.name, class: "preview-img" }));
    } else {
      const p = await api(`/api/files/${file.id}/preview`);
      set(body,
        p.sheets ? h("div", { class: "muted small" }, p.sheets.map((s) => `${s.name}: ${s.rows} × ${s.columns}`).join(" · ")) : null,
        p.needsVision ? h("div", { class: "banner warn", style: "max-width:none;margin:0" }, icon("alert"), h("div", {}, "Kaum Text gefunden (Scan?) — JARVIS kann das PDF trotzdem visuell lesen.")) : null,
        h("pre", { class: "preview-text" }, p.text || "(kein Text)"),
        p.truncated ? h("div", { class: "muted small" }, "Vorschau gekürzt.") : null);
    }
  } catch (e) { set(body, h("div", { class: "empty" }, e.message)); }
}

export async function viewFiles(main, params) {
  const q = params.get("q") ?? "";
  const data = await api(`/api/files${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const previewId = params.get("preview");
  if (previewId) {
    // Opened from a JARVIS context card: show that file right away.
    const f = data.files.find((x) => x.id === previewId) ?? (await api(`/api/files/${encodeURIComponent(previewId)}`).catch(() => null))?.file;
    if (f) setTimeout(() => previewFile(f), 0);
  }
  const reload = (query = q) => go("files", query ? `?q=${encodeURIComponent(query)}` : "");
  const progress = h("div", { class: "upload-list" });
  const doUpload = async (list) => {
    for (const f of [...list]) {
      const bar = h("div", { class: "bar" }, h("div", { style: "width:0%" }));
      const row = h("div", { class: "upload-item" }, icon("upload"), h("span", { class: "name" }, f.name), bar);
      progress.append(row);
      try {
        await uploadFile(f, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
        row.remove();
        toast(`${f.name} hochgeladen.`, "ok");
      } catch (e) { row.classList.add("err"); set(row, icon("alert"), h("span", { class: "name" }, `${f.name}: ${e.message}`)); }
    }
    if (!progress.querySelector(".err")) viewFiles(main, params);
  };
  const picker = h("input", { type: "file", multiple: true, accept: FILE_ACCEPT, hidden: true, onchange: () => { doUpload(picker.files); picker.value = ""; } });
  let t;
  const search = h("input", { class: "field", type: "search", placeholder: "Dateien und Inhalte durchsuchen …", value: q, "aria-label": "Dateien durchsuchen",
    oninput: () => { clearTimeout(t); t = setTimeout(() => reload(search.value.trim()), 400); } });

  const versionsBox = (f) => {
    const box = h("div", { class: "versions" });
    api(`/api/files/${f.id}`).then((d) => set(box, d.versions.map((v) => h("div", { class: "version" },
      h("span", { class: "badge" }, `v${v.version}`),
      h("div", { class: "main" }, h("div", {}, v.note ?? SOURCE_LABEL[v.source] ?? v.source), h("div", { class: "muted small" }, `${fmtSize(v.size)} · ${fmt.rel(v.createdAt)}`)),
      h("button", { class: "btn ghost icon sm", "aria-label": `Version ${v.version} herunterladen`, onclick: () => downloadFile(v.id, v.name, v.size) }, icon("download")))))).catch((e) => set(box, e.message));
    return box;
  };

  const row = (f) => {
    const det = h("details", { class: "file-row" },
      h("summary", {},
        h("div", { class: `file-ic ${f.format}` }, icon(FILE_ICON[f.format] ?? "file")),
        h("div", { class: "main" }, h("div", { class: "title" }, f.name),
          h("div", { class: "sub" }, [f.format.toUpperCase(), fmtSize(f.size), f.versions > 1 ? `${f.versions} Versionen` : null, SOURCE_LABEL[f.source], fmt.rel(f.createdAt), f.storage === "drive" ? "Google Drive" : null].filter(Boolean).join(" · "))),
        h("div", { class: "actions", onclick: (e) => e.preventDefault() },
          h("button", { class: "btn ghost icon sm", "aria-label": "Vorschau", title: "Vorschau", onclick: () => previewFile(f) }, icon("eye")),
          h("button", { class: "btn ghost icon sm", "aria-label": "Herunterladen", title: "Herunterladen", onclick: () => downloadFile(f.id, f.name, f.size) }, icon("download")),
          f.driveUrl && /^https:\/\/(drive|docs)\.google\.com\//.test(f.driveUrl) ? h("a", { class: "btn ghost icon sm hide-mobile", href: f.driveUrl, target: "_blank", rel: "noopener noreferrer", "aria-label": "In Google Drive öffnen", title: "In Google Drive öffnen" }, icon("globe")) : null,
          h("button", { class: "btn ghost icon sm hide-mobile", "aria-label": "Mit JARVIS besprechen", title: "Mit JARVIS besprechen", onclick: () => chatAboutFile(f) }, icon("chat")),
          h("button", { class: "btn ghost icon sm", "aria-label": "Löschen", title: "Löschen", onclick: async () => {
            if (!(await dialog({ title: `„${f.name}“ löschen?`, text: f.versions > 1 ? `Alle ${f.versions} Versionen werden gelöscht.${f.storage === "drive" ? " In Google Drive landen sie im Papierkorb." : ""}` : f.storage === "drive" ? "Die Datei landet im Drive-Papierkorb." : "Die Datei wird endgültig gelöscht.", confirmLabel: "Löschen", danger: true }))) return;
            await api(`/api/files/${f.id}?all=1`, { method: "DELETE" }).catch(fail); viewFiles(main, params);
          } }, icon("trash")))));
    det.addEventListener("toggle", () => { if (det.open && !det.querySelector(".versions")) det.append(versionsBox(f)); });
    return det;
  };

  const usedPct = Math.round((data.limits.dbUsedBytes / data.limits.dbQuotaBytes) * 100);
  const zone = h("button", { class: "drop-zone", onclick: () => picker.click() }, icon("upload"),
    h("div", {}, h("b", {}, "Dateien hierher ziehen oder tippen zum Auswählen"), h("div", { class: "muted small" }, `PDF, Word, Excel, CSV, PowerPoint, Text, Markdown, Bilder · max. ${Math.round(data.limits.maxBytes / 1048576)} MB`)));
  set(main, h("div", { class: "view" },
    viewHead("Dateien", data.storage === "drive" ? "Gespeichert in deinem Google Drive (Ordner „JARVIS“)" : `Gespeichert in JARVIS · ${fmtSize(data.limits.dbUsedBytes)} von ${fmtSize(data.limits.dbQuotaBytes)} belegt (${usedPct} %)`,
      h("button", { class: "btn primary", onclick: () => picker.click() }, icon("upload"), h("span", {}, "Hochladen")), picker),
    zone, progress,
    h("div", { class: "card", style: "padding:12px;margin:14px 0" }, search),
    data.files.length ? h("div", { class: "card files-card" }, data.files.map(row))
      : h("div", { class: "empty" }, q ? "Keine Treffer." : "Noch keine Dateien. Lade etwas hoch oder bitte JARVIS z.B. „Erstelle mir eine Excel-Liste meiner Fixkosten“."),
    data.storage === "db" ? h("div", { class: "muted small", style: "margin-top:10px" }, "Tipp: Mit Google Drive (Einstellungen → Integrationen) liegen Dateien in deinem Drive statt in der JARVIS-Datenbank.") : null));
  dropZone(main.querySelector(".view"), doUpload);
}
