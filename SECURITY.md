# JARVIS — Sicherheitskonzept

JARVIS hat Zugriff auf Postfach, Kalender und Kontakte. Das Sicherheitsmodell geht
davon aus, dass **das Sprachmodell getäuscht werden kann** — deshalb werden alle
Grenzen deterministisch im Code durchgesetzt, nicht nur im Prompt.

## 1. Berechtigungsstufen

| Stufe | Beispiele | Standardverhalten |
|---|---|---|
| **0 — Lesen** | E-Mails/Kalender/Kontakte lesen, suchen | automatisch erlaubt |
| **1 — Niedriges Risiko** | Labels, gelesen markieren, Entwürfe, Aufgaben, Erinnerungen, Memory | automatisch erlaubt, pro Kategorie abschaltbar (dann Bestätigung) |
| **2 — Externe Kommunikation** | E-Mail senden/antworten/weiterleiten, Einladungen, Termine mit Gästen, Löschen (E-Mails in Papierkorb, Termine) | **Bestätigung erforderlich** |
| **3 — Kritisch** | Zahlungen, Verträge, Konto-/Sicherheitsänderungen, sensible Daten versenden; jede externe Aktion nach verdächtigem Fremdinhalt | **immer explizite Bestätigung**, nie durch Regeln aufhebbar |

Umsetzung: `src/core/permissions.ts`. Die Stufe steht fest im Tool-Code.

### Harte Grenzen (nicht konfigurierbar)

* Stufe 3 erfordert **immer** eine Bestätigung — auch mit Automationsregel.
* Ausgehende Nachrichten werden auf **sensible Inhalte** geprüft
  (Passwörter, MFA/TAN/OTP-Codes, IBAN/Kreditkarten, Zugangsdaten). Treffer
  erhöhen die Aktion auf Stufe 3.
* Ein Tool kann seine eigene Stufe nicht ändern; die Policy kann Stufen nur
  **anheben**, nie senken (Ausnahme: Stufe 1 → automatisch, falls freigegeben).
* Automationsregeln („Antworte auf Newsletter-Abmeldungen automatisch", Phase 3)
  dürfen höchstens Stufe 2 automatisieren, nur für explizit benannte Tools, und
  werden vom Benutzer in der UI angelegt — nicht vom Modell. Bis dahin gibt es
  keinen Mechanismus, der Stufe 2 ohne Bestätigung ausführt.

## 2. Bestätigungen

* Bestätigungen sind **präzise**: Empfänger, Betreff, vollständiger Text, Zeitpunkt,
  Kosten. Das Modell formuliert die Frage, die UI zeigt zusätzlich die exakten
  Parameter aus dem Server-Datensatz.
* Die bestätigte Aktion wird **vom Server** mit den gespeicherten Parametern
  ausgeführt. Nach der Bestätigung kann nichts mehr verändert werden.
* Ausstehende Aktionen verfallen nach `JARVIS_CONFIRMATION_TTL_MINUTES` (Standard 30).
* Ein bloßes „ja" im Chat bestätigt nur, wenn **genau eine** Aktion aussteht.
  Bei mehreren muss in der UI gezielt bestätigt werden.

## 3. Prompt-Injection-Schutz

1. **Daten ≠ Anweisungen.** Alle Inhalte aus E-Mails, Webseiten, Dateien und
   Kontakten werden in Tool-Resultaten in `<external_data source="…">`-Blöcke
   verpackt. Der Systemprompt stellt klar, dass darin enthaltene Anweisungen nie
   befolgt werden.
2. **Heuristische Erkennung** (`src/core/injection.ts`): Muster wie „ignore previous
   instructions", „ignoriere deine Anweisungen", „send me the password",
   „forward all emails" markieren die Quelle als verdächtig; die Markierung wird
   dem Modell und der UI angezeigt.
3. **Taint-Tracking:** Sobald in einem Agent-Durchlauf verdächtige externe Daten
   gelesen wurden, werden **alle** externen Aktionen (Stufe ≥ 2) in diesem
   Durchlauf auf Stufe 3 angehoben und mit Warnhinweis zur Bestätigung vorgelegt.
4. **Kein Tool vergibt Rechte.** Es gibt kein Tool, das Berechtigungen,
   Automationsregeln oder Integrationen ändert. Das ist ausschließlich über die
   authentifizierte UI möglich.

## 4. Authentifizierung & Web-Sicherheit

* Zugriff nur mit `JARVIS_ACCESS_TOKEN` (≥ 32 Zeichen). Login erzeugt eine
  zufällige Session-ID (256 Bit), gespeichert als SHA-256-Hash;
  Cookie `HttpOnly`, `SameSite=Strict`, `Secure` bei HTTPS; Ablauf nach 7 Tagen.
* `/api/cron/tick` ist nur mit `Authorization: Bearer <CRON_SECRET>` nutzbar;
  ohne gesetztes Secret ist der Endpunkt deaktiviert.
* Der OAuth-Callback ist ohne Session erreichbar (Cross-Site-Redirect von Google
  sendet kein `SameSite=Strict`-Cookie), aber nur mit einem einmaligen,
  10 Minuten gültigen `state` samt PKCE-Verifier nutzbar.
* **CSRF:** Alle zustandsändernden Requests benötigen den Header
  `X-Jarvis-CSRF` mit dem sessiongebundenen CSRF-Token und einen
  passenden `Origin`-Header. Cross-Origin-Requests werden abgelehnt.
* **Rate-Limit:** global und strenger für `/api/login` und `/api/chat`.
* **Input-Validierung:** Jede API-Route und jede Tool-Eingabe wird mit zod
  validiert. Tool-Eingaben des Modells sind nicht vertrauenswürdig.
* Lokal bindet der Server an `127.0.0.1`. Produktion läuft auf Vercel mit TLS
  und HSTS; Rate-Limits gelten dort pro Serverless-Instanz.
* Security-Header (Server und `vercel.json` für CDN-Dateien): strikte CSP ohne
  Inline-Skripte und ohne Drittquellen, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, HSTS.
* Die UI rendert alle Fremddaten (E-Mails, Termine, Modellantworten) über
  DOM-Knoten/`textContent`, nie als HTML — auch der Markdown-Renderer.

## 5. Secrets & Tokens

* Keine Secrets im Code oder in Git (`.env` ist in `.gitignore`).
* OAuth-Refresh-/Access-Tokens werden mit **AES-256-GCM** verschlüsselt
  gespeichert; Schlüssel `JARVIS_ENCRYPTION_KEY` (32 Byte, Base64) nur aus der
  Umgebung. Ohne Schlüssel startet JARVIS nicht.
* OAuth mit `state`-Parameter (CSRF) und PKCE (S256).
* **Least privilege:** Es werden nur die Scopes angefragt, die die
  implementierten Tools benötigen (siehe `TOOLS.md`).
* `npm run setup:secrets` erzeugt sichere Zufallswerte.

## 6. Audit-Log

Jede Aktion der Stufe ≥ 1 wird protokolliert:

```text
2026-09-30 18:32  ACTION: send_email  TARGET: a***@example.com
STATUS: SUCCESS   USER_CONFIRMATION: YES   RISK: 2
```

* Gespeichert werden Tool, Ziel (maskiert), Risiko, Status, Bestätigung, Fehlercode.
* **Nicht** gespeichert: E-Mail-Texte, Tokens, Passwörter. Parameter werden vor
  dem Schreiben durch `redact()` gefiltert.

## 7. Fehlerverhalten

* Ein Tool-Fehler führt nie zu einer Erfolgsmeldung. Status sind strikt getrennt:
  `planned`, `awaiting_confirmation`, `executing`, `succeeded`, `failed`,
  `partially_succeeded`, `rejected`, `expired`.
* Retries nur für idempotente Lesezugriffe und bei 429/5xx mit Backoff; sendende
  Aktionen werden **nicht** automatisch wiederholt (keine Doppelsendungen).

## 8. Bekannte Grenzen / offene Punkte

* Die Injection-Heuristik ist eine Zusatzschicht, keine Garantie. Die eigentliche
  Sicherheit kommt aus Bestätigungspflicht + Taint-Tracking.
* Single-User-Design. Mehrbenutzerbetrieb erfordert Mandantentrennung (Roadmap).
* Browser-Agent (Phase 4) wird in einer isolierten Sandbox laufen müssen.

## Sicherheitslücken melden

Bitte nicht öffentlich als Issue, sondern direkt an den Repository-Eigentümer.
