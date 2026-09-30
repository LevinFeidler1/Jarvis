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
- [x] Mehrere Postfächer gleichzeitig: Gmail + IMAP/SMTP (1&1/IONOS, All-Inkl, …), Standard-Absender,
      Antworten vom richtigen Postfach, ehrliche Meldung nicht erreichbarer Postfächer (docs/SETUP_MAIL.md);
      gegen echten IMAP-Server (Dovecot) getestet
- [ ] Live-Test mit den echten Postfächern levin@feidler.de (1&1) und levin.feidler@fa-automations.de (All-Inkl)
- [x] Eigene Kontakte in JARVIS (ohne Google): Seite *Kontakte*, vCard-Import/-Export (iPhone, Android, Outlook, 1&1),
      gemeinsame Suche mit Google Kontakte, ehrliche Meldung bei Google-Ausfall
- [ ] Kalender der IMAP-Anbieter (CalDAV) — aktuell nur Google Calendar
- [ ] Microsoft Graph: Outlook, Kalender, Kontakte (`MicrosoftEmailProvider` etc. gegen dieselben Interfaces)
- [ ] Google Drive / OneDrive (`FileProvider`, Tools `search_files`, `read_file`, …)
- [ ] Reisezeit zwischen Terminen (Ort → Maps-API) in `find_free_slots`
- [ ] Mehrere Kalender (nicht nur `primary`) + bevorzugter Kalender aus Gedächtnis

## Phase 3 — Aufgaben, Erinnerungen, Automationen

- [x] Lokale Aufgaben, Erinnerungen, In-App-Benachrichtigungen, Scheduler
- [x] Automationen als eigene, in der UI verwaltete Objekte (Zeitplan + E-Mail-Auslöser, Vorlagen,
      „Jetzt ausführen", Ergebnis als Push; per Chat anlegbar mit Bestätigung)
- [x] Web-Push aufs Handy (iPhone als Home-Bildschirm-App, Android, Desktop)
- [x] Wochenrückblick (Seite, Tool, Automation-Vorlage) inkl. geschätzter API-Kosten
- [x] Lange Unterhaltungen: serverseitige Compaction, append-only Verlauf
- [ ] Automationen: Stufe-2-Freigabe für ausdrücklich benannte Tools (z.B. „Rechnungen automatisch archivieren")
- [ ] Gmail-Push (Pub/Sub) statt 5-Minuten-Polling für E-Mail-Auslöser
- [ ] Google Tasks / Microsoft To Do als alternative `TaskProvider`
- [ ] Weitere Benachrichtigungskanäle: E-Mail an sich selbst, Telegram/Signal

## Phase 4 — Browser-Agent & komplexe Workflows

- [ ] `BrowserProvider` auf Playwright-Basis in isolierter Sandbox (eigener Container, kein Zugriff auf lokale Dateien/Cookies)
- [ ] Tools `open_page`, `navigate`, `click`, `type`, `extract_information`, `download_file`
- [ ] Jede Seite ist `external_data`; Formular-Submit mit Zahlung/Vertrag/Buchung = Stufe 3
- [ ] Preisvergleich/Buchungsvorbereitung („günstigster sinnvoller Flug") bis zur finalen Bestätigung
- [ ] Workflow-Status über mehrere Unterhaltungsrunden (z.B. „warte auf Sarahs Antwort, dann Termin anlegen")

## Phase 5 — Voice, Proaktivität, fortgeschrittenes Memory

- [x] Sprach-Chat im Browser (Web Speech API): 🎤 Spracheingabe (de-DE), Vorlesen der Antworten,
      Gesprächsmodus (hört nach jeder Antwort wieder zu, „Stopp" beendet), Stimme/Tempo in den Einstellungen;
      gleiche Bestätigungslogik — kritische Aktionen (Stufe 3) nie per gesprochenem „Ja"
- [ ] Wake-Word („Hey Jarvis"), Server-STT/TTS (z.B. Whisper/ElevenLabs) für Browser ohne Web Speech, Telefon-Bot
- [x] Proaktive Briefings (Morgen, Wochenstart, Wochenrückblick) als Automationen
- [ ] Proaktive Hinweise aus neuen E-Mails (Terminvorschlag erkannt → „Du bist frei. Soll ich zusagen?")
- [ ] Memory: automatische Vorschläge („Soll ich mir merken, dass …?"), Verfallsdaten, Quellenlinks
- [ ] Mehrbenutzerbetrieb (Mandantentrennung)

## Bekannte Einschränkungen des aktuellen Stands

- Die Google-Integration ist gegen die offiziellen REST-APIs implementiert und mit
  simulierten HTTP-Antworten getestet, aber noch nicht gegen ein echtes Konto gelaufen.
- Arbeitsschritte werden live gestreamt, der Antworttext selbst erscheint am Stück.
- Auf Vercel Hobby läuft der eingebaute Cron nur täglich; Erinnerungen und Automationen brauchen den
  externen 5-Minuten-Cron (cron-job.org, siehe DEPLOY_VERCEL.md).
- Kostenangaben im Wochenrückblick sind Schätzungen nach Listenpreisen.
