# JARVIS auf Vercel deployen (mit Neon Postgres)

Ergebnis: JARVIS läuft unter `https://<dein-projekt>.vercel.app`, erreichbar vom
Handy und Laptop, mit dauerhafter Datenbank. Dauer: ca. 15 Minuten. Beides ist
im kostenlosen Tarif möglich (Vercel Hobby + Neon Free).

## Was du brauchst

| | |
|---|---|
| **GitHub** | Das Repo `LevinFeidler1/Jarvis` (hast du schon) |
| **Vercel-Account** | <https://vercel.com/signup> — „Continue with GitHub" |
| **Neon** | Wird direkt in Vercel angelegt (Storage → Neon), kein eigener Account nötig |
| **Claude API Key** | <https://console.anthropic.com> → API Keys |

## 1. Code auf den Produktions-Branch bringen

Vercel deployt `main` als Produktion. Der aktuelle Stand liegt auf
`claude/jarvis-personal-ai-agent-2hlnat` → auf GitHub einen Pull Request nach
`main` erstellen und mergen. (Alternativ in Vercel unter *Settings → Git →
Production Branch* diesen Branch eintragen.)

## 2. Secrets erzeugen

Lokal (oder in jedem Terminal mit Node ≥ 22):

```bash
npm install
npm run setup:secrets
```

Ausgabe notieren — das sind `JARVIS_ACCESS_TOKEN` (dein Login),
`JARVIS_ENCRYPTION_KEY` und `CRON_SECRET`. Nirgends committen.

## 3. Projekt in Vercel anlegen

1. <https://vercel.com/new> → Repository `Jarvis` → **Import**.
2. *Framework Preset*: **Other** (alles Weitere steht in `vercel.json`).
3. *Environment Variables* — jetzt eintragen:

   | Name | Wert |
   |---|---|
   | `ANTHROPIC_API_KEY` | dein Claude-API-Key |
   | `JARVIS_ACCESS_TOKEN` | aus Schritt 2 |
   | `JARVIS_ENCRYPTION_KEY` | aus Schritt 2 |
   | `CRON_SECRET` | aus Schritt 2 |
   | `JARVIS_PUBLIC_URL` | `https://<projektname>.vercel.app` (siehst du nach dem ersten Deploy; dann anpassen) |
   | `JARVIS_USER_NAME` | `Levin` |
   | `JARVIS_TIMEZONE` | `Europe/Berlin` |

4. **Deploy** klicken. Der Build gelingt; die Seite meldet aber noch
   „DATABASE_URL erforderlich" — die Datenbank kommt im nächsten Schritt.

## 4. Neon-Datenbank verbinden

1. Im Vercel-Projekt: **Storage** → **Create Database** → **Neon** (Serverless Postgres) → *Continue*.
2. Region: **Frankfurt (eu-central-1)** — passt zur Funktionsregion `fra1` in `vercel.json`.
3. Plan: **Free** → *Create* → mit dem Projekt verbinden (alle Environments).
   Vercel setzt `DATABASE_URL` automatisch.
4. **Deployments** → letztes Deployment → **⋯ → Redeploy**.

Die Tabellen legt JARVIS beim ersten Start selbst an (Migrationen, gegen
parallele Kaltstarts per Advisory Lock abgesichert).

## 5. Öffentliche URL eintragen und testen

1. Die Produktions-URL steht oben im Projekt (z.B. `https://jarvis-levin.vercel.app`).
2. *Settings → Environment Variables* → `JARVIS_PUBLIC_URL` genau auf diese URL
   setzen (ohne `/` am Ende) → **Redeploy**.
   Wichtig: JARVIS akzeptiert Änderungen nur von dieser Adresse (Origin-Prüfung).
3. URL öffnen → mit `JARVIS_ACCESS_TOKEN` anmelden.
4. **Auf dem Handy:** Seite öffnen → Teilen → „Zum Home-Bildschirm" — JARVIS
   läuft dann wie eine App (Vollbild, eigenes Icon).

## 6. Google verbinden

Wie in [SETUP_GOOGLE.md](SETUP_GOOGLE.md), mit einem Unterschied: Als
*Autorisierte Weiterleitungs-URI* im Google-OAuth-Client eintragen:

```
https://<projektname>.vercel.app/api/integrations/google/callback
```

(Die `localhost`-URI kannst du zusätzlich behalten.) Dann in Vercel
`GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` setzen → Redeploy →
*Einstellungen → Integrationen → Verbinden*.

## 6b. Weitere Postfächer (1&1, All-Inkl)

Nach dem Login in JARVIS: *Einstellungen → E-Mail-Konten → Postfach hinzufügen* —
Details in [SETUP_MAIL.md](SETUP_MAIL.md). Dafür sind keine Vercel-Variablen nötig; die
Passwörter liegen verschlüsselt in der Neon-Datenbank.

## 7. Takt für Erinnerungen & Automationen (wichtig)

Vercel hat keinen dauerhaft laufenden Prozess. Erinnerungen, Automationen
(Morgen-Briefing, Rechnungen → Aufgaben, Wochenrückblick …) und E-Mail-Auslöser
brauchen deshalb einen **externen Takt alle 5 Minuten** — kostenlos über cron-job.org:

1. <https://cron-job.org> → kostenloses Konto → *Create cronjob*
2. *Title*: `JARVIS`, *URL*: `https://<projektname>.vercel.app/api/cron/tick`
3. *Execution schedule*: **Every 5 minutes**
4. *Advanced → Headers*: Key `Authorization`, Value `Bearer <CRON_SECRET>`
5. *Advanced → Timeout*: das Maximum wählen; *Notifications*: bei Fehlern aus
6. Speichern → *Test run* → Antwort `{"fired":0,"automations":"started"}` (Status 200)

Der Endpunkt antwortet sofort; Automationen laufen danach im Hintergrund weiter
(bis 300 s). Ohne gültiges `CRON_SECRET` antwortet er mit 401. Zusätzlich:
Erinnerungen feuern auch, solange die App offen ist, und der eingebaute Vercel-Cron
läuft einmal täglich (06:00 UTC) als Sicherheitsnetz.

## 8. Push-Benachrichtigungen aufs Handy

Keine zusätzlichen Variablen nötig — der Schlüssel wird beim ersten Aufruf erzeugt.

- **iPhone (ab iOS 16.4):** JARVIS in **Safari** öffnen → Teilen ↑ → **„Zum Home-Bildschirm"** →
  JARVIS über das neue Symbol öffnen → *Einstellungen → Push-Benachrichtigungen →
  Auf diesem Gerät aktivieren* → „Erlauben". (In Safari selbst, ohne Home-Bildschirm, geht Push auf dem iPhone nicht.)
- **Android / Desktop (Chrome, Edge, Firefox):** *Einstellungen → Push-Benachrichtigungen → Aktivieren*.
- **Test senden** prüft die Zustellung. Jedes Gerät einzeln aktivieren.

## 8b. Telegram, Browser, Google Drive (optional)

- **Telegram-Bot:** docs/TELEGRAM.md — `TELEGRAM_BOT_TOKEN` (BotFather), dann *Einstellungen → Telegram →
  Webhook einrichten*, `/start` an den Bot, `TELEGRAM_CHAT_ID` eintragen, Redeploy. Sprachnachrichten
  optional mit `TRANSCRIBE_API_KEY` (Groq, kostenlos).
- **Browser-Agent:** läuft ohne weitere Einstellungen in der eigenen Funktion `api/browser.ts`
  (Chromium via @sparticuz/chromium, max. 60 s pro Schritt). Abschalten: `JARVIS_BROWSER=off`. → docs/BROWSER.md
- **Google Drive:** Drive API im Google-Cloud-Projekt aktivieren, Scope `drive.file` im
  Zustimmungsbildschirm ergänzen, dann in JARVIS *Einstellungen → Google → Neu verbinden*. → docs/SETUP_GOOGLE.md

## 9. Kosten im Blick

*Rückblick* zeigt die geschätzten Claude-Kosten der Woche. Zusätzlich in der
Anthropic Console unter *Settings → Limits* ein **monatliches Ausgabenlimit** setzen.
Lange Unterhaltungen fasst JARVIS ab 60 000 Tokens automatisch zusammen
(`JARVIS_COMPACT_AT_TOKENS`, optional).

## Sicherheit

- Die URL ist öffentlich erreichbar — geschützt durch das Zugangstoken
  (256 Bit Zufall), Session-Cookies (`HttpOnly`, `Secure`, `SameSite=Strict`),
  CSRF-Token, Origin-Prüfung und Rate-Limits. Token niemals teilen.
- OAuth-Tokens liegen AES-256-GCM-verschlüsselt in Neon; der Schlüssel existiert
  nur als Vercel-Environment-Variable.
- Das Rate-Limit zählt pro Serverless-Instanz (bei einem Nutzer unkritisch).
- Token kompromittiert? Neues `JARVIS_ACCESS_TOKEN` setzen und redeployen;
  bestehende Sessions laufen nach spätestens 7 Tagen ab.

## Limits (Hobby-Tarif)

| | |
|---|---|
| Laufzeit pro Anfrage | max. 300 s (in `vercel.json` gesetzt) — lange Agent-Läufe stoppen vorher am Schritt-Limit |
| Cron | 1× täglich eingebaut — Takt alle 5 Min. über cron-job.org (Schritt 7) |
| Neon Free | 0,5 GB Speicher — ohne Google Drive liegen Dateien in der DB (Quote `JARVIS_DB_FILE_QUOTA_MB`, Standard 150 MB) |
| Request-/Antwortgröße | 4,5 MB — Uploads/Downloads laufen deshalb in Teilen |
| Funktionsgröße | 250 MB — Chromium liegt nur in `api/browser.ts` |

## Fehlerbehebung

| Symptom | Lösung |
|---|---|
| `{"error":"JARVIS konnte nicht starten","detail":"Ungültige Konfiguration …"}` | Die genannte Environment Variable fehlt/ist falsch → setzen → Redeploy |
| „Auf Vercel ist DATABASE_URL … erforderlich" | Schritt 4 (Neon verbinden) + Redeploy |
| Anmeldung klappt, aber jede Aktion: „Ungültiger Origin" | `JARVIS_PUBLIC_URL` stimmt nicht exakt mit der aufgerufenen URL überein |
| Google: `redirect_uri_mismatch` | Weiterleitungs-URI aus Schritt 6 fehlt im OAuth-Client |
| Logs ansehen | Vercel → Projekt → **Logs** (Secrets werden in Logs geschwärzt) |
