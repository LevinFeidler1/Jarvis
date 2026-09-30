# JARVIS — persönlicher digitaler Butler

Ein tool-nutzender KI-Agent, der E-Mails, Kalender, Kontakte, Aufgaben und
Erinnerungen für dich verwaltet — mit einem deterministischen
Berechtigungssystem: Lesen läuft automatisch, alles, was nach außen geht,
erst nach deiner präzisen Bestätigung.

```text
Du:     Antworte Anna, dass Donnerstag um 14 Uhr passt.
JARVIS: Ich habe eine Antwort an Anna vorbereitet:
        „Donnerstag um 14 Uhr passt für mich."
        Soll ich sie senden?              [Bestätigen & ausführen] [Ablehnen]
```

## Schnellstart

Voraussetzung: **Node.js ≥ 22.5**.

```bash
npm install
cp .env.example .env
npm run setup:secrets        # erzeugt JARVIS_ACCESS_TOKEN + JARVIS_ENCRYPTION_KEY → in .env eintragen
# ANTHROPIC_API_KEY in .env eintragen (https://console.anthropic.com → API Keys)
npm start                    # → http://localhost:3000, mit JARVIS_ACCESS_TOKEN anmelden
```

Beim ersten Start führt der Setup-Assistent durch die fehlenden Schritte.
Gmail/Kalender/Kontakte verbinden: **[docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md)**.

Ohne Google-Verbindung funktionieren Aufgaben, Erinnerungen, Gedächtnis und
Websuche; bei E-Mail/Kalender sagt JARVIS ehrlich, dass die Integration fehlt.

## Befehle

| | |
|---|---|
| `npm start` | Server starten |
| `npm run dev` | mit Auto-Reload |
| `npm test` | Testsuite (Vitest) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run setup:secrets` | Zufallswerte für `.env` erzeugen |

## Dokumentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — Komponenten, Agent Loop, Entscheidungen
- [SECURITY.md](SECURITY.md) — Berechtigungsstufen, Bestätigungen, Prompt-Injection-Schutz
- [TOOLS.md](TOOLS.md) — alle Tools mit Risikostufe, OAuth-Scopes
- [ROADMAP.md](ROADMAP.md) — Phasen 1–5 und aktueller Stand

## Konfiguration

Alle Einstellungen über Umgebungsvariablen, siehe [.env.example](.env.example).
Keine Secrets im Code, keine Secrets in Git.
