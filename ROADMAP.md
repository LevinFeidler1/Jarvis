# JARVIS — Roadmap

Iterativ, jede Phase ist für sich lauffähig und getestet.

## Phase 1 — Fundament ✅ (dieser Stand)

- [x] Agent Core mit robustem Loop (Iterationslimit, parallele Lese-Tools, Pause/Refusal-Handling)
- [x] Claude-Anbindung (`claude-opus-5-5`, adaptive thinking, Streaming, Server-Fallback, Prompt Caching)
- [x] Tool-System mit zod-Validierung und fester Risikostufe pro Tool
- [x] Permission-System Stufe 0–3, Eskalation bei sensiblen Inhalten und Prompt Injection
- [x] Bestätigungssystem (serverseitige Ausführung der gespeicherten Aktion, Ablauf, Einmaligkeit, „ja" im Chat)
- [x] Activity-Status (geplant … teilweise erfolgreich) und Audit-Log mit Redaktion
- [x] Strukturiertes Gedächtnis (Präferenzen, Personen, Projekte, Regeln, Fakten; user vs. inferred)
- [x] Web-UI: Chat, Aktivität, Kalender, E-Mail, Aufgaben, Gedächtnis, Einstellungen, Setup-Assistent
- [x] Security: Session-Auth, CSRF, Origin-Check, Rate-Limit, CSP, AES-256-GCM-Tokens
- [x] Automatisierte Tests inkl. Injection-, Failure- und Bestätigungsszenarien (aktuell 91)

## Phase 1b — Hosting & UI ✅

- [x] Datenbank auf PostgreSQL umgestellt: Neon (Vercel), PGlite (lokal/Tests); migrationssicher bei parallelen Kaltstarts
- [x] Vercel-Deployment: Serverless Function, CDN für die UI, Cron-Endpunkt, Region Frankfurt (docs/DEPLOY_VERCEL.md)
- [x] UI-Redesign: Heute-Dashboard, Chat mit Live-Arbeitsschritten (NDJSON-Streaming) und Markdown,
      Wochenkalender mit Zeitachse, E-Mail mit Lesebereich, Aufgaben nach Fälligkeit, Gedächtnis-Karten,
      Einstellungen mit Schaltern, Hell/Dunkel, Mobil-Navigation, installierbar als Web-App (PWA-Manifest)

## Phase 2 — Integrationen (größtenteils ✅)

- [x] Google OAuth 2.0 (PKCE, State, Least Privilege, Refresh, Widerruf)
- [x] Gmail: lesen, suchen, Entwürfe, senden, antworten, weiterleiten, Labels, archivieren, Papierkorb
- [x] Google Calendar: lesen, suchen, freie Slots, erstellen, ändern, löschen, einladen, antworten
- [x] Google Contacts: suchen (inkl. weitere Kontakte), lesen, anlegen, ändern
- [ ] **Live-Test mit echtem Google-Konto** (benötigt deine Credentials → docs/SETUP_GOOGLE.md)
- [ ] Microsoft Graph: Outlook, Kalender, Kontakte (`MicrosoftEmailProvider` etc. gegen dieselben Interfaces)
- [ ] Google Drive / OneDrive (`FileProvider`, Tools `search_files`, `read_file`, …)
- [ ] Reisezeit zwischen Terminen (Ort → Maps-API) in `find_free_slots`
- [ ] Mehrere Kalender (nicht nur `primary`) + bevorzugter Kalender aus Gedächtnis

## Phase 3 — Aufgaben, Erinnerungen, Automationen

- [x] Lokale Aufgaben, Erinnerungen, In-App-Benachrichtigungen, Scheduler
- [ ] Automationen als eigene, in der UI verwaltete Objekte
      (`trigger`: Zeitplan | neue E-Mail mit Bedingung; `action`: Agent-Prompt mit Tool-Allowlist;
      aktivieren/deaktivieren; Stufe-2-Freigabe nur für explizit benannte Tools, Stufe 3 nie)
  - „Jeden Montag 8 Uhr Wochenübersicht", „Jeden Morgen wichtige Mails prüfen",
    „3 Tage vor wichtigen Terminen erinnern", „Rechnung per Mail → Aufgabe"
- [ ] Gmail-Push (Pub/Sub) bzw. Polling für E-Mail-Trigger
- [ ] Google Tasks / Microsoft To Do als alternative `TaskProvider`
- [ ] Benachrichtigungskanäle: Web Push, E-Mail an sich selbst, Telegram/Signal

## Phase 4 — Browser-Agent & komplexe Workflows

- [ ] `BrowserProvider` auf Playwright-Basis in isolierter Sandbox (eigener Container, kein Zugriff auf lokale Dateien/Cookies)
- [ ] Tools `open_page`, `navigate`, `click`, `type`, `extract_information`, `download_file`
- [ ] Jede Seite ist `external_data`; Formular-Submit mit Zahlung/Vertrag/Buchung = Stufe 3
- [ ] Preisvergleich/Buchungsvorbereitung („günstigster sinnvoller Flug") bis zur finalen Bestätigung
- [ ] Workflow-Status über mehrere Unterhaltungsrunden (z.B. „warte auf Sarahs Antwort, dann Termin anlegen")

## Phase 5 — Voice, Proaktivität, fortgeschrittenes Memory

- [ ] Voice-Client: Wake-Word/Push-to-Talk → STT → `/api/chat` → TTS; gleiche Bestätigungslogik
      (Bestätigungen per Sprache nur mit Wiederholung der Kernparameter)
- [ ] Proaktive Briefings (Morgen, Wochenstart) als Automationen
- [ ] Proaktive Hinweise aus neuen E-Mails (Terminvorschlag erkannt → „Du bist frei. Soll ich zusagen?")
- [ ] Memory: automatische Vorschläge („Soll ich mir merken, dass …?"), Verfallsdaten, Quellenlinks
- [ ] Lange Unterhaltungen: Server-Compaction der Claude API
- [ ] Mehrbenutzerbetrieb (Mandantentrennung)

## Bekannte Einschränkungen des aktuellen Stands

- Die Google-Integration ist gegen die offiziellen REST-APIs implementiert und mit
  simulierten HTTP-Antworten getestet, aber noch nicht gegen ein echtes Konto gelaufen.
- Arbeitsschritte werden live gestreamt, der Antworttext selbst erscheint am Stück.
- Auf Vercel Hobby läuft der Cron nur täglich; minutengenaue Erinnerungen über externen Cron (siehe DEPLOY_VERCEL.md).
- Unterhaltungen werden ungekürzt an das Modell gesendet — für neue Themen „Neue Unterhaltung" nutzen.
