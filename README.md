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

Gmail/Kalender/Kontakte verbinden: **[docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md)**.
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
