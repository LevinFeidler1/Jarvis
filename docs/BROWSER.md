# Browser-Agent

JARVIS kann Webseiten öffnen, suchen, klicken, Formulare vorbereiten, Informationen auslesen,
Bildschirmfotos machen und Dateien herunterladen — z.B. Preise vergleichen, Öffnungszeiten
recherchieren oder ein Kontaktformular bis zum Absenden vorbereiten.

## Entscheidung (kostenlos, ohne Kreditkarte)

| Option | Ergebnis |
|---|---|
| **playwright-core + @sparticuz/chromium in einer eigenen Vercel-Funktion** (`api/browser.ts`) | **gewählt** — läuft im Hobby-Tarif, keine Zusatzkosten, kein externer Dienst |
| Gehostete Headless-Dienste (Browserless, ScrapingBee, Browserbase …) | nicht gewählt: Free-Tiers mit Kreditkarte, Limits oder Datenweitergabe an Dritte |
| Chromium im Haupt-Bundle | nicht gewählt: +67 MB, langsamere Kaltstarts für jeden Chat |

- Die Browser-Funktion ist ~7 MB Code + Chromium (`includeFiles`), deutlich unter dem 250-MB-Limit,
  `maxDuration` 60 s pro Schritt. Das Haupt-Bundle bleibt ohne Chromium (~60 MB).
- Nur die JARVIS-Hauptfunktion darf sie aufrufen (Geheimnis aus `JARVIS_ENCRYPTION_KEY` abgeleitet —
  keine zusätzliche Variable nötig).
- Sitzungen bleiben in einer warmen Instanz offen; landet ein Schritt auf einer neuen Instanz,
  werden die aufgezeichneten Schritte deterministisch wiederholt.
- **Fallback, falls Vercel das je verhindert:** `npm run browser-worker` auf dem eigenen Rechner
  (`JARVIS_ENCRYPTION_KEY` wie auf Vercel, `JARVIS_CHROMIUM_PATH` = lokales Chrome/Chromium),
  per kostenlosem Tunnel erreichbar machen (`cloudflared tunnel --url http://localhost:3210`) und auf
  Vercel `JARVIS_BROWSER_URL=https://<tunnel>/run` setzen. Gleiches Protokoll wie `api/browser.ts`.
- Lokale Entwicklung: `JARVIS_CHROMIUM_PATH` setzen (läuft dann im Prozess).

## Werkzeuge

| Tool | Stufe | |
|---|---|---|
| `open_page` | 0 | neue, isolierte Browser-Aufgabe |
| `navigate` | 0 | andere Adresse in derselben Aufgabe |
| `click` | 1 / 2 / 3 | Links & Suche: 1 · Formular absenden: 2 · Kaufen, Buchen, Bezahlen, Verträge, Anmelden/Login: **3** |
| `type` | 1 / 2 / 3 | normale Felder: 1 · mit Absenden: 2 (Suche: 1) · Passwort-/Zahlungs-/Sicherheitsfelder: **3** |
| `extract_information` | 0 | ganzer Seitentext + Links |
| `screenshot` | 0 (1 mit Speichern) | Bild für JARVIS, optional unter Dateien |
| `download_file` | 1 | unter Dateien ablegen (max. 3 MB über Vercel, 20 MB lokal) |

Die Stufe von `click`/`type` bestimmt der **Server** anhand des echten Elements auf der Seite
(Beschriftung, Formular mit Passwort-/Zahlungsfeldern, Absende-Knopf) — nicht das Modell.
Kritische Schritte bereitet JARVIS bis zum letzten Klick vor und fragt dich; erst nach
„Trotzdem ausführen“ wird die Aufgabe wiederhergestellt und genau dieser Klick ausgeführt.

## Sicherheit & Grenzen

- **Isoliert:** eigener Browser-Kontext pro Aufgabe, keine gespeicherten Cookies/Passwörter,
  kein Zugriff auf lokale Dateien, Service Worker blockiert.
- **Nur öffentliches Internet:** Anfragen an `localhost`, private Netze (10.x, 192.168.x, 172.16–31.x),
  Cloud-Metadaten (169.254.169.254) und Nicht-http(s)-Schemata werden blockiert — für jede
  Anfrage der Seite und jeden Weiterleitungsschritt bei Downloads.
- Jede Seite ist **Fremdinhalt** (`external_data`) mit Injection-Scan; versteckte Anweisungen auf
  Webseiten markieren die Unterhaltung und machen alle externen Folgeaktionen kritisch.
- Eingaben in Passwort-/Zahlungsfelder werden im Protokoll maskiert.
- Limits: `JARVIS_BROWSER_MAX_STEPS` (Standard 25 Schritte) und `JARVIS_BROWSER_TASK_MINUTES`
  (Standard 15 Min.) pro Aufgabe, 45–60 s pro Schritt.
- Automationen dürfen nur Stufe-1-Browserschritte selbst ausführen (Lesen, Links, Suche);
  Formulare absenden ist dort nie freigebbar.
