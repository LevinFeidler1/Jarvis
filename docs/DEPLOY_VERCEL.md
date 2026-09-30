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

## 7. Erinnerungen zuverlässig auslösen

Vercel hat keinen dauerhaft laufenden Prozess. JARVIS löst fällige Erinnerungen deshalb aus:

- **automatisch, solange die App offen ist** (alle 30 s),
- **per Vercel Cron** einmal täglich (06:00 UTC — mehr erlaubt der Hobby-Tarif nicht),
- **optional minutengenau** über einen kostenlosen externen Cron-Dienst:
  <https://cron-job.org> → *Create cronjob*
  - URL: `https://<projektname>.vercel.app/api/cron/tick`
  - Zeitplan: alle 5 Minuten
  - *Advanced → Headers*: `Authorization` = `Bearer <CRON_SECRET>`

Ohne gültiges `CRON_SECRET` antwortet der Endpunkt mit 401.

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
| Cron | 1× täglich (siehe Schritt 7 für mehr) |
| Neon Free | 0,5 GB Speicher — für JARVIS mehr als genug |

## Fehlerbehebung

| Symptom | Lösung |
|---|---|
| `{"error":"JARVIS konnte nicht starten","detail":"Ungültige Konfiguration …"}` | Die genannte Environment Variable fehlt/ist falsch → setzen → Redeploy |
| „Auf Vercel ist DATABASE_URL … erforderlich" | Schritt 4 (Neon verbinden) + Redeploy |
| Anmeldung klappt, aber jede Aktion: „Ungültiger Origin" | `JARVIS_PUBLIC_URL` stimmt nicht exakt mit der aufgerufenen URL überein |
| Google: `redirect_uri_mismatch` | Weiterleitungs-URI aus Schritt 6 fehlt im OAuth-Client |
| Logs ansehen | Vercel → Projekt → **Logs** (Secrets werden in Logs geschwärzt) |
