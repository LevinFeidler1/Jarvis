# JARVIS — Tools

Alle Tools sind in `src/tools/` definiert und in `src/tools/registry.ts` registriert.
Die Registry ist eingefroren: Zur Laufzeit können keine Tools hinzukommen, und
kein Tool kann Berechtigungen, Integrationen oder Automationsregeln ändern.

**Stufen:** 0 = Lesen (automatisch) · 1 = niedriges Risiko (automatisch, abschaltbar)
· 2 = externe Kommunikation (Bestätigung) · 3 = kritisch (immer Bestätigung).
„↑" = Stufe steigt abhängig von der Eingabe (z.B. Termin mit Gästen).

Jede Eingabe wird mit zod validiert. Ausgehender Text wird auf sensible
Inhalte geprüft (→ Stufe 3). Nach verdächtigem Fremdinhalt werden alle
externen Aktionen der Unterhaltung auf Stufe 3 angehoben.

## E-Mail (`src/tools/email.ts`) — Provider: Gmail + beliebig viele IMAP/SMTP-Postfächer

Alle Postfächer werden zu einer Sicht zusammengeführt (`src/providers/multi-email.ts`).
E-Mail-IDs haben die Form `<postfach>|<id>`, damit jede Aktion im richtigen Postfach landet.
Lese-Tools haben den Filter `account`, sendende Tools `from_account`. Antworten gehen immer vom
Postfach der Original-Mail. Ist der Absender unklar, schlägt die Vorprüfung (`precheck`) fehl,
**bevor** eine Bestätigung angefragt wird — JARVIS fragt nach. Einrichtung: [docs/SETUP_MAIL.md](docs/SETUP_MAIL.md).

| Tool | Stufe | Beschreibung |
|---|---|---|
| `list_email_accounts` | 0 | Verbundene Postfächer + Standard-Absender |
| `list_emails` | 0 | Posteingang mit Filtern (ungelesen, Absender, Zeitraum, Label) |
| `search_emails` | 0 | Suche über alle Ordner |
| `read_email` | 0 | Vollständige E-Mail inkl. Anhänge-Liste, Newsletter-Erkennung |
| `draft_email` | 1 | Entwurf im Postfach anlegen (auch als Antwort im Thread) |
| `send_email` | 2 | Neue E-Mail senden |
| `reply_email` | 2 | Im Thread antworten (In-Reply-To/References korrekt gesetzt) |
| `forward_email` | 2 | Weiterleiten |
| `archive_email` | 1 | Aus dem Posteingang entfernen |
| `mark_as_read` / `mark_as_unread` | 1 | Gelesen-Status |
| `label_email` | 1 | Labels setzen/entfernen (Gmail) bzw. in Ordner verschieben (IMAP); fehlende werden angelegt |
| `delete_email` | 2 | In den Papierkorb (keine endgültige Löschung möglich) |

`summarize_email` ist kein eigenes Tool: Zusammenfassen und Kategorisieren
erledigt das Modell selbst auf Basis von `read_email`/`list_emails`.

## Kalender (`src/tools/calendar.ts`) — Provider: Google Calendar

| Tool | Stufe | Beschreibung |
|---|---|---|
| `get_events` | 0 | Termine im Zeitraum |
| `search_events` | 0 | Freitextsuche |
| `find_free_slots` | 0 | Freie Slots (Dauer, Arbeitszeit, Puffer, nur Werktage), deterministisch berechnet |
| `create_event` | 1 ↑2 | Termin anlegen; mit Gästen → Einladungen → Bestätigung; meldet Konflikte |
| `update_event` | 1 ↑2 | Verschieben/Ändern; hat der Termin Gäste → Bestätigung. Prüft live, ob Gäste existieren |
| `invite_attendees` | 2 | Gäste hinzufügen + einladen |
| `delete_event` | 2 | Termin löschen |
| `respond_to_invitation` | 2 | Zusagen/Absagen/Vielleicht |

## Kontakte (`src/tools/personal.ts`) — Provider: JARVIS-Kontakte (+ Google People API, wenn verbunden)

JARVIS-Kontakte liegen in der eigenen Datenbank (Seite *Kontakte*: anlegen, bearbeiten,
löschen, vCard-Import/-Export) und funktionieren ohne Google. Ist Google verbunden,
durchsucht `search_contact` beide Quellen; fällt Google aus, gibt es die lokalen
Treffer plus eine ehrliche Warnung.

| Tool | Stufe | Beschreibung |
|---|---|---|
| `search_contact` | 0 | JARVIS-Kontakte + Google-Kontakte + „weitere Kontakte" (Korrespondenzpartner) + Gedächtnisnotizen |
| `get_contact` | 0 | Einzelner Kontakt (`jarvis:…` oder `people/…`) |
| `create_contact` | 1 | Kontakt anlegen — standardmäßig in JARVIS, `save_to: "google"` nur auf Wunsch |
| `update_contact` | 1 | Kontakt ändern (Name, E-Mails, Telefon, Firma, Rolle, Notizen) |

## Aufgaben & Erinnerungen — Provider: lokal (SQLite)

| Tool | Stufe | Beschreibung |
|---|---|---|
| `list_tasks` | 0 | Offene/erledigte Aufgaben, sortiert nach Priorität & Fälligkeit |
| `create_task` / `update_task` / `complete_task` / `delete_task` | 1 | Aufgabenverwaltung |
| `create_reminder` | 1 | Erinnerung zu Zeitpunkt (In-App-Benachrichtigung via Scheduler) |
| `list_reminders` | 0 | Geplante Erinnerungen |
| `cancel_reminder` | 1 | Erinnerung stornieren |
| `send_notification` | 1 | In-App-Benachrichtigung (nicht extern) |

## Gedächtnis

| Tool | Stufe | Beschreibung |
|---|---|---|
| `remember` | 1 | Präferenz/Person/Projekt/Regel/Fakt speichern; `source=user` nur bei ausdrücklicher Aussage |
| `recall` | 0 | Gedächtnis durchsuchen |
| `forget` | 1 | Eintrag löschen |

## System & Web

| Tool | Stufe | Beschreibung |
|---|---|---|
| `get_integration_status` | 0 | Welche Konten sind verbunden |
| `web_search` | 0 | Server-Tool der Claude API (`web_search_20260209`); abschaltbar mit `JARVIS_WEB_SEARCH=false` |

## Automationen & Rückblick (`src/tools/automation.ts`)

Automationen laufen ohne Zutun des Benutzers (Zeitplan oder neue E-Mail) durch
denselben Agent und dasselbe Permission-System; das Ergebnis kommt als Push.

| Tool | Stufe | Beschreibung |
|---|---|---|
| `list_automations` | 0 | Eingerichtete Automationen mit Status |
| `create_automation` | 2 | Neue Automation (Zeitplan: Uhrzeit + Wochentage; E-Mail: Absender/Betreff enthält) — immer mit Bestätigung |
| `set_automation_enabled` | 2 | Pausieren/aktivieren |
| `delete_automation` | 2 | Löschen |
| `get_week_review` | 0 | Wochenrückblick: Erledigtes, Offenes, nächste Woche, geschätzte API-Kosten |

## Geplant (siehe ROADMAP.md)

`open_page`, `navigate`, `click`, `type`, `extract_information`, `download_file`
(Browser-Agent, Phase 4) · `search_files`, `read_file`, `create_file`,
`update_file`, `summarize_file` (Google Drive / OneDrive, Phase 2b) · Outlook,
Microsoft Calendar/Contacts (Microsoft Graph).

## Tool-Ergebnisse

```json
{ "ok": true,  "status": "succeeded" | "partially_succeeded", "data": { … } }
{ "ok": false, "status": "failed", "code": "NOT_CONFIGURED" | "AUTH_FAILED" | "RATE_LIMITED" | …, "error": "…" }
{ "ok": false, "status": "awaiting_confirmation", "action_id": "…", "executed": false, … }
```

Ergebnisse mit Fremdinhalten werden in `<external_data source="…" trust="untrusted">`
verpackt und auf Prompt Injection gescannt.

## OAuth-Scopes (Google)

| Scope | Wofür | Warum nicht breiter |
|---|---|---|
| `gmail.modify` | lesen, labeln, archivieren, Entwürfe, senden, Papierkorb | `https://mail.google.com/` erlaubt endgültiges Löschen — nicht nötig |
| `calendar.events` | Termine lesen/schreiben | `calendar` würde auch Kalender-Freigaben/Einstellungen erlauben |
| `contacts` | Kontakte lesen/anlegen/ändern | — |
| `contacts.other.readonly` | Korrespondenzpartner finden („Sarah") | nur lesend |
| `openid`, `email` | verbundenes Konto anzeigen | — |

## IMAP/SMTP

Keine OAuth-Scopes: Zugriff per Postfach-Passwort, verschlüsselt gespeichert (Tabelle
`email_accounts`, AES-256-GCM, AAD `imap:<id>`). Server-Presets für 1&1/IONOS und All-Inkl in
`src/providers/imap/accounts.ts`.

## Neues Tool hinzufügen

1. `defineTool({...})` in der passenden Datei unter `src/tools/` — mit zod-Schema,
   fester `risk`, `describe()` (präzise, für Bestätigungen), ggf. `riskFor`,
   `auditTarget`, `outgoingText`, `isExternal`.
2. Fremdinhalte mit `external(source, data, texts)` zurückgeben.
3. In `createDefaultRegistry()` aufnehmen.
4. Tests in `tests/` ergänzen (mindestens: Permission-Stufe, Fehlerfall).
