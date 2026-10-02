# JARVIS — persönlicher digitaler Butler

Ein tool-nutzender KI-Agent, der E-Mails, Kalender, Kontakte, Aufgaben und
Erinnerungen für dich verwaltet — mit einem deterministischen
Berechtigungssystem: Lesen läuft automatisch, alles, was nach außen geht,
erst nach deiner präzisen Bestätigung.

```text
Du:     Antworte Anna, dass Donnerstag um 14 Uhr passt.
JARVIS: ✓ E-Mail gelesen  ✓ Kalender geprüft
        Ich habe eine Antwort an Anna vorbereitet:
        „Donnerstag um 14 Uhr passt für mich."
        Soll ich sie senden?              [Bestätigen & ausführen] [Ablehnen]
```

## Sprach-Chat

Im Chat auf 🎤 tippen und sprechen — JARVIS liest die Antwort vor.
**Gespräch** oben im Chat schaltet den Freisprech-Modus ein (hört nach jeder
Antwort wieder zu; „Stopp" oder „Danke, das war's" beendet ihn).
Stimme und Tempo: *Einstellungen → Sprache*. Läuft in Chrome, Edge und Safari
(auch iPhone/Android); Firefox kann nur vorlesen. Bestätigen per „Ja" geht auch
gesprochen — außer bei kritischen Aktionen, die brauchen immer den Knopf.

## Automationen, Push & Wochenrückblick

- **Automationen:** JARVIS erledigt Dinge von selbst — z.B. Morgen-Briefing um 7 Uhr,
  „Rechnung per Mail → Aufgabe", Wochenrückblick am Freitag. Vorlagen unter *Automationen*,
  oder im Chat: „Schick mir jeden Montag um 8 eine Wochenübersicht."
  Senden/Löschen/Einladen bereitet eine Automation nur vor — außer du gibst es für diese Automation ausdrücklich frei.
- **Push aufs Handy:** Erinnerungen und Ergebnisse kommen als Benachrichtigung
  (iPhone: JARVIS zuerst „Zum Home-Bildschirm" hinzufügen).
- **Wochenrückblick:** was erledigt wurde, was offen ist, was ansteht — und was JARVIS ungefähr gekostet hat.

## Dateien, Drive, Hinweise, Browser, Telegram

- **Dateien:** PDF, Word, Excel, CSV, PowerPoint (lesen), Text, Markdown, Bilder hochladen —
  im Chat (📎) oder auf der Seite *Dateien*. JARVIS liest, bearbeitet (als neue Version),
  erstellt und wandelt um. Mit Google Drive landen Dateien im Ordner „JARVIS“. → docs/FILES.md
- **Proaktive Hinweise:** neue Mails werden mit einem kleinen Modell sortiert; auf *Heute* erscheinen
  Vorschläge (Termin zusagen, Rechnung → Aufgabe, Lead beantworten …) mit *Annehmen / Bearbeiten / Ignorieren*. → docs/PROACTIVE.md
- **Selbstständige Automationen:** pro Automation freigeben, welche Aktionen sie ohne Rückfrage darf;
  Protokoll, Rückgängig, Tageslimit, Not-Aus. → docs/AUTONOMY.md
- **Browser-Agent:** „Schau nach, wann die Bäckerei offen hat“ — JARVIS öffnet Webseiten, sucht, liest,
  lädt herunter; Käufe/Logins nur nach deiner ausdrücklichen Bestätigung. → docs/BROWSER.md
- **Telegram:** JARVIS als Telegram-Bot — Text, Sprachnachrichten, Dateien, Bestätigungen per Knopf. → docs/TELEGRAM.md
- **Alltag:** Wetter (Open-Meteo), Restaurants & Orte finden und reservieren (OpenStreetMap + Browser-Agent), Notizen & Listen („Schreib Milch auf die Einkaufsliste“), Finanzen (Rechnungen & Abos aus dem Postfach erkannt, Erinnerung vor Fälligkeit), Nachrichten (RSS) — alles kostenlos, ohne API-Key. → docs/ALLTAG.md
- **Sprachmodus & Kontextkarten:** Startseite mit lebendigem Partikel-Kern. Du sprichst mit JARVIS, und während er redet, gleiten passende Karten herein (Kalender, Finanzen, Mails, Aufgaben …). Realistische Stimme optional über ElevenLabs Free. → docs/VOICE.md

## Kontakte

Seite **Kontakte**: selbst anlegen, bearbeiten, löschen, oder eine vCard-Datei (.vcf)
importieren (iPhone: iCloud.com → Kontakte → alle auswählen → Exportieren). Funktioniert
ohne Google; ist Google verbunden, sucht JARVIS zusätzlich in Google Kontakte.

## Online nutzen (Vercel)

Schritt-für-Schritt: **[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)** —
Vercel + Neon Postgres, kostenlos startbar, danach von Handy und Laptop
erreichbar (auch als App auf dem Home-Bildschirm).

## Lokal starten

Voraussetzung: **Node.js ≥ 22.5**. Keine Datenbank nötig (eingebettetes Postgres).

```bash
npm install
cp .env.example .env
npm run setup:secrets        # Werte in .env eintragen
# ANTHROPIC_API_KEY in .env eintragen (https://console.anthropic.com → API Keys)
npm start                    # → http://localhost:3000, mit JARVIS_ACCESS_TOKEN anmelden
```

Gmail/Kalender/Kontakte verbinden: **[docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md)** ·
weitere Postfächer (1&1/IONOS, All-Inkl, jedes IMAP-Postfach): **[docs/SETUP_MAIL.md](docs/SETUP_MAIL.md)**.
Ohne Google-Verbindung funktionieren Aufgaben, Erinnerungen, Gedächtnis und
Websuche; bei E-Mail/Kalender sagt JARVIS ehrlich, dass die Integration fehlt.

## Befehle

| | |
|---|---|
| `npm start` | lokaler Server |
| `npm run dev` | mit Auto-Reload |
| `npm test` | Testsuite (Vitest, echtes Postgres via PGlite) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run setup:secrets` | Zufallswerte für Secrets erzeugen |

## Dokumentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — Komponenten, Agent Loop, Datenhaltung, Entscheidungen
- [SECURITY.md](SECURITY.md) — Berechtigungsstufen, Bestätigungen, Prompt-Injection-Schutz
- [TOOLS.md](TOOLS.md) — alle Tools mit Risikostufe, OAuth-Scopes
- [ROADMAP.md](ROADMAP.md) — Phasen und aktueller Stand
- [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md) · [docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md)

Keine Secrets im Code, keine Secrets in Git — Konfiguration nur über
Umgebungsvariablen ([.env.example](.env.example)).
