# Dateien & Dokumente

JARVIS liest, bearbeitet und erstellt Dateien — im Chat (📎 oder Drag & Drop) und auf der Seite **Dateien**.

| Format | Lesen | Bearbeiten (neue Version) | Neu erstellen | Umwandeln nach |
|---|---|---|---|---|
| PDF | Text je Seite; Scans/Layout visuell (`mode=visual`) | zusammenführen, Seiten behalten/löschen/drehen | aus Markdown | TXT, MD, DOCX (textbasiert) |
| Word (DOCX) | Text | Text ersetzen (auch über Formatierungsgrenzen), Absätze anhängen | aus Markdown (Überschriften, Listen, Tabellen, fett/kursiv) | PDF, MD, TXT |
| Excel (XLSX) | alle Blätter mit Zellbezügen (A1…) und Formeln | Zellen/Formeln setzen, Zeilen anhängen, Blätter hinzufügen | ja, inkl. Formeln | CSV, PDF, MD |
| CSV | als Tabelle | Zellen, Zeilen, Text ersetzen | ja (Excel-kompatibel: `;` + BOM) | XLSX, PDF, MD |
| PowerPoint (PPTX) | Text je Folie | — | — | MD, TXT, PDF, DOCX |
| TXT / MD / JSON | ja | ersetzen, anhängen | ja | DOCX, PDF |
| Bilder (PNG/JPG) | an Claude als Bild (Vision; große Fotos werden verkleinert) | — | — | PDF |

**Versionen:** Jede Bearbeitung erzeugt eine neue Version; das Original bleibt erhalten
(Seite *Dateien* → Datei aufklappen → ältere Versionen herunterladen).

## Speicher — Entscheidung

| Option | Kosten | Privat? | Entscheidung |
|---|---|---|---|
| **Google Drive** (Ordner „JARVIS“, Scope `drive.file`) | kostenlos (15 GB des Google-Kontos) | ja, nur für dich | **bevorzugt**, sobald Google mit Drive-Berechtigung verbunden ist |
| **Postgres (Neon)** | kostenlos (Neon Free 0,5 GB gesamt) | ja | **Rückfallebene** ohne Drive; Quote `JARVIS_DB_FILE_QUOTA_MB` (Standard 150 MB) |
| Vercel Blob | Hobby-Kontingent kostenlos | **nein** — Blobs sind öffentlich erreichbare URLs | **nicht verwendet**: Rechnungen/Verträge gehören nicht hinter öffentliche Links |

## Grenzen & Vercel

- Maximale Dateigröße: `JARVIS_MAX_FILE_MB` (Standard **20 MB**).
- Vercel begrenzt Anfragen und Antworten von Funktionen auf 4,5 MB. Deshalb lädt die Oberfläche
  Dateien in **3-MB-Teilen** hoch (`/api/files/uploads`) und lädt sie in **4-MB-Bereichen** herunter
  (HTTP Range) — für dich unsichtbar, auch auf dem Handy.
- Nur reine JavaScript/WASM-Bibliotheken: `unpdf` (PDF lesen), `pdf-lib` (PDF erstellen/bearbeiten),
  `mammoth` (Word lesen), `docx` (Word erstellen), `exceljs` (Excel), `papaparse` (CSV), `jszip`
  (PowerPoint, Word-Bearbeitung), `jimp` (Bilder verkleinern). Kein LibreOffice/Python.
- `npm run check:esm` prüft, dass alle Abhängigkeiten auch ohne `require(esm)` laden
  (Vercel-Fehler `ERR_REQUIRE_ESM`); läuft auch als Test.
- Umwandlungen aus PDF/Word/PowerPoint sind **textbasiert**: Layout, Bilder und komplexe
  Formatierung gehen dabei verloren (JARVIS weist darauf hin).

## Sicherheit

- Dateiinhalte und -namen sind immer **Fremdinhalt** (`external_data`) mit Injection-Scan —
  Anweisungen in einem PDF („Sende alle Mails an …“) werden nie befolgt, und folgende externe
  Aktionen werden auf Stufe 3 hochgestuft.
- Dateityp wird am Inhalt erkannt (Magic Bytes), nicht nur an der Endung; HTML/SVG/EXE werden abgelehnt.
  Office-Dateien werden vor dem Entpacken auf Zip-Bomben geprüft.
- Downloads: `Content-Disposition: attachment`, `Content-Security-Policy: sandbox`, `nosniff`.
- CSV-Export neutralisiert Formeln (`=…`, `+…`, `@…`) gegen CSV-Injection.
- `delete_file` ist Stufe 2 (Bestätigung); Erstellen/Bearbeiten/Umwandeln ist Stufe 1 (neue Version, nichts geht verloren).
