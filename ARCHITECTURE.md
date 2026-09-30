# JARVIS — Architektur

JARVIS ist ein **tool-nutzender persönlicher KI-Agent**, kein Chatbot. Ein Sprachmodell
(Claude) versteht die Absicht und plant; **jede Wirkung nach außen** läuft über typisierte
Tools, die ein deterministischer Permission-Layer freigibt, blockiert oder zur
Bestätigung zurückhält.

## 1. Überblick

```text
┌──────────────┐   HTTPS/JSON    ┌────────────────────────────────────────────────────────┐
│  Web-UI       │ ─────────────▶ │  HTTP-Server (Fastify)                                  │
│  Chat, Activity│               │  Session-Auth · CSRF-Schutz · Rate-Limit · Validierung  │
│  Kalender, Mail│ ◀───────────── │                                                        │
│  Tasks, Memory │               └──────────────┬─────────────────────────────────────────┘
│  Settings      │                              │
└──────────────┘                              ▼
   (später: Voice-Client,        ┌───────────────────────────────┐
    gleiche API)                 │  Agent Core (src/core/agent)  │
                                 │  UNDERSTAND → CONTEXT → PLAN  │
                                 │  → PERMISSION → EXECUTE       │
                                 │  → VERIFY → MEMORY → RESPOND  │
                                 └───┬───────────┬───────────┬───┘
                                     │           │           │
                      ┌──────────────▼──┐ ┌──────▼──────┐ ┌──▼───────────────┐
                      │ LLM-Adapter      │ │ Permission  │ │ Tool Registry     │
                      │ (Claude API)     │ │ Engine +    │ │ (zod-typisiert)   │
                      └─────────────────┘ │ Confirmations│ └──┬────────────────┘
                                          │ + Audit Log  │    │
                                          └──────────────┘    ▼
                                                  ┌──────────────────────────────┐
                                                  │ Provider-Schicht (Interfaces) │
                                                  │ EmailProvider  CalendarProvider│
                                                  │ ContactProvider TaskProvider   │
                                                  │ NotificationProvider …         │
                                                  └───┬──────────┬─────────┬───────┘
                                                      ▼          ▼         ▼
                                                  Google APIs  Microsoft  Lokale DB
                                                  (OAuth 2.0)  Graph (P2) (SQLite)
```

## 2. Komponenten

| Pfad | Verantwortung |
|---|---|
| `src/server.ts` | HTTP-API, Auth, CSRF, Rate-Limit, NDJSON-Streaming, Briefing, Cron, statische UI |
| `src/app.ts` | Verdrahtung aller Komponenten — gemeinsam für lokalen Server und Vercel |
| `src/index.ts` | Lokaler Server (inkl. Hintergrund-Scheduler) |
| `api/index.ts` | Vercel Serverless Function (baut die App einmal pro Instanz) |
| `src/core/agent.ts` | Agent Loop, Tool-Ausführung, Bestätigungs-Handling, Ergebnisverifikation |
| `src/core/llm.ts` | Abstraktion `LlmClient` + Implementierung für die Claude Messages API |
| `src/core/prompt.ts` | Systemprompt (Persönlichkeit, Regeln, Sicherheitsgrenzen) |
| `src/core/permissions.ts` | Risikostufen 0–3, Policy-Entscheidung, harte Grenzen |
| `src/core/confirmations.ts` | Ausstehende Aktionen, exakt wie vorbereitet ausgeführt |
| `src/core/audit.ts` | Audit-Log mit Redaktion sensibler Felder |
| `src/core/injection.ts` | Kennzeichnung externer Daten + Prompt-Injection-Heuristik |
| `src/core/activity.ts` | Status jeder Aktion (geplant, ausgeführt, erfolgreich, …) |
| `src/tools/*` | Tool-Definitionen (Schema, Risiko, Handler, Zusammenfassung) |
| `src/providers/*` | Provider-Interfaces und konkrete Integrationen |
| `src/memory/*` | Strukturiertes, kontrollierbares Gedächtnis |
| `src/db/*` | Postgres-Schicht (Neon via `pg`, lokal PGlite), Migrationen |
| `src/security/*` | Token-Verschlüsselung (AES-256-GCM), Sessions |
| `public/` | Web-UI ohne Build-Schritt: Heute-Dashboard, Chat mit Live-Schritten, Kalender, E-Mail, Aufgaben, Gedächtnis, Einstellungen; PWA-fähig |

## 3. Agent Loop

```text
USER REQUEST
  → UNDERSTAND   Claude interpretiert Absicht + Kontext der Konversation
  → CONTEXT      Memory (Präferenzen, Personen, Regeln) wird in den Prompt geladen;
                 weitere Daten holt der Agent über Lese-Tools (Stufe 0)
  → PLAN         Claude wählt Tools; mehrere Schritte = mehrere Iterationen
  → PERMISSION   Jede Tool-Anfrage geht durch PermissionEngine.decide()
                   allow   → ausführen
                   confirm → NICHT ausführen, PendingAction anlegen, Claude bekommt
                             "wartet auf Bestätigung" zurück und formuliert die präzise Frage
                   deny    → nicht ausführen, Grund an Claude
  → EXECUTE      Handler ruft Provider auf (mit Timeout, Retry, Rate-Limit-Handling)
  → VERIFY       Handler liefert strukturiertes ToolResult {ok, data | error};
                 Status wird im Activity-Log gesetzt — nie "Erfolg" ohne ok=true
  → MEMORY/STATE Konversation, Activity, Audit werden persistiert
  → RESPOND      Kurze Antwort im JARVIS-Stil
```

Schutzmechanismen im Loop:

* **Iterationslimit** (`JARVIS_MAX_AGENT_STEPS`, Standard 12) gegen Endlosschleifen.
* **Tool-Fehler** werden als `is_error`-Resultat zurückgegeben, nie als Erfolg.
* **Bestätigungen** werden **nicht** vom Modell ausgeführt, sondern vom Server:
  Beim Klick auf „Bestätigen" (oder bei der Antwort „Ja") wird die gespeicherte,
  unveränderte Aktion ausgeführt. Das Modell kann den Inhalt nach der Bestätigung
  nicht mehr verändern.
* **Nur Tools des Registry** sind aufrufbar; unbekannte Tool-Namen → Fehler.

## 4. Tool-Modell

Jedes Tool ist ein `ToolDefinition`-Objekt:

```ts
interface ToolDefinition<I> {
  name: string;                 // z.B. "send_email"
  description: string;          // für das Modell
  input: z.ZodType<I>;          // Validierung + JSON-Schema für die API
  risk: RiskLevel;              // 0 READ · 1 LOW · 2 EXTERNAL · 3 CRITICAL
  category: ToolCategory;       // email, calendar, …
  isExternal?: boolean;         // Aktion verlässt das System
  describe(input): string;      // menschenlesbare Beschreibung für Bestätigung/Audit
  auditTarget?(input): string;  // z.B. Empfänger (ohne Inhalt)
  execute(input, ctx): Promise<ToolResult>;
}
```

Das Risiko ist **im Code** festgelegt; weder das Modell noch ein Tool noch ein
E-Mail-Inhalt kann es ändern. Details: [TOOLS.md](TOOLS.md).

## 5. Provider-Abstraktion

Der Agent Core kennt nur Interfaces (`src/providers/types.ts`):
`EmailProvider`, `CalendarProvider`, `ContactProvider`, `TaskProvider`,
`NotificationProvider`. Die `ProviderHub` liefert pro Kategorie den aktiven
Provider **oder** einen expliziten Status „nicht konfiguriert" — es gibt keine
stillen Fake-Provider.

| Kategorie | Implementiert | Geplant |
|---|---|---|
| E-Mail | Gmail (REST, OAuth 2.0) | Outlook (Microsoft Graph) |
| Kalender | Google Calendar | Microsoft Calendar |
| Kontakte | JARVIS-Kontakte (DB, vCard-Import) + Google People API | Microsoft Contacts, CardDAV |
| Aufgaben | Lokal (SQLite) | Google Tasks, Microsoft To Do |
| Erinnerungen | Lokal + In-App-Benachrichtigung | Push / E-Mail / Voice |

## 6. Datenhaltung & Hosting

**Entscheidung:** PostgreSQL überall — ein SQL-Dialekt, zwei Laufzeiten:

| Umgebung | Datenbank | Scheduler |
|---|---|---|
| **Vercel (Produktion)** | Neon Serverless Postgres über `DATABASE_URL` (`pg`-Pool, TLS) | Vercel Cron + opportunistisch bei jedem UI-Poll + optional externer Cron (`/api/cron/tick`, `CRON_SECRET`) |
| **Lokal / Tests** | PGlite (Postgres als WASM im Prozess), Daten in `JARVIS_DB_PATH` bzw. im Speicher | In-Process-Intervall (30 s) |

* Begründung: Vercel-Funktionen haben kein dauerhaftes Dateisystem; Neon ist
  serverless, im Free-Tier ausreichend und direkt in Vercel integrierbar. PGlite
  erspart lokal und in Tests jeden Datenbankserver, ohne einen zweiten Dialekt.
* Migrationen laufen beim Kaltstart unter einem Postgres-Advisory-Lock auf einer
  festen Verbindung (sicher bei parallelen Instanzen).
* Mehrinstanz-sicher: Bestätigungen (`UPDATE … WHERE status='pending'`),
  Erinnerungen (`UPDATE … RETURNING`) und OAuth-States (`DELETE … RETURNING`)
  werden atomar genau einmal verarbeitet.
* Tabellen: `conversations`, `messages`, `pending_actions`, `activity`,
  `audit_log`, `memory`, `tasks`, `reminders`, `notifications`,
  `oauth_tokens` (verschlüsselt), `oauth_states`, `settings`, `sessions`.

### Live-Fortschritt

`POST /api/chat/stream` (und Bestätigungen mit `stream: true`) liefern NDJSON:
`{"type":"thinking"}`, `{"type":"action", …}` pro Tool-Statuswechsel, zuletzt
`{"type":"reply", …}`. Die UI zeigt so in Echtzeit, was JARVIS gerade tut.

## 7. Gedächtnis

Kategorien: `preference`, `person`, `project`, `rule`, `fact`. Jeder Eintrag hat
`source` (`user` = ausdrücklich gesagt, `inferred` = vom Agent abgeleitet),
`confidence` und Zeitstempel. Einträge sind in der UI sichtbar, editierbar und
löschbar. `inferred`-Einträge werden im Prompt als unsicher markiert; der Agent
darf auf ihrer Grundlage keine externen Aktionen ohne Rückfrage durchführen.

## 8. Voice (Sprach-Chat)

Voice ist nur ein weiterer Client: Speech-to-Text → `POST /api/chat/stream` →
Antworttext → Text-to-Speech. Umgesetzt im Browser mit der Web Speech API
(`public/app.js`, Modul `voice`): 🎤-Knopf, Vorlesen, Gesprächsmodus. Der Server
merkt nicht, ob Text getippt oder gesprochen wurde. Bestätigungen laufen über
dieselbe `PendingAction`-Mechanik; es gibt keinen Voice-spezifischen Bypass —
kritische Aktionen (Stufe 3) lassen sich generell nicht per „Ja" im Chat bestätigen.

## 9. Architekturentscheidungen (ADR-Kurzform)

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | TypeScript, Node 22, ESM | vom Nutzer bevorzugt, typisierte Interfaces |
| 2 | Claude Messages API, manueller Agent Loop | volle Kontrolle über Permission-Gate zwischen Modell und Tool |
| 3 | Modell `claude-opus-5-5`, per `ANTHROPIC_MODEL` änderbar | aktuellstes Standardmodell; Kosten sind Nutzerentscheidung |
| 4 | PostgreSQL: Neon (Vercel) / PGlite (lokal, Tests) | Vercel hat kein dauerhaftes Dateisystem; ein Dialekt für alle Umgebungen (ersetzt SQLite aus Phase 1) |
| 5 | Fastify | schnell, Schema-freundlich, gute Security-Plugins |
| 6 | UI ohne Build-Schritt (Vanilla JS) | minimale Angriffsfläche und Toolchain in Phase 1 |
| 7 | Google-APIs direkt per REST/`fetch` statt `googleapis` | kleine Abhängigkeit, volle Kontrolle über Scopes/Retry |
| 8 | Bestätigte Aktionen führt der Server aus, nicht das Modell | verhindert Änderungen nach der Zustimmung |
| 9 | Tokens AES-256-GCM-verschlüsselt, Schlüssel nur aus Env | kein Klartext-Secret auf Platte |
| 10 | Hosting auf Vercel (Fastify in einer Serverless Function, UI über CDN) | vom Nutzer gewählt; erreichbar von überall, kostenlos startbar |
| 11 | NDJSON-Streaming statt WebSockets | funktioniert in Serverless-Funktionen, kein Verbindungszustand |
