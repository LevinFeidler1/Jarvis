# Telegram-Bot

Über Telegram schreibst du JARVIS von überall: Text, Sprachnachrichten, Fotos und Dateien. Briefings, Erinnerungen, Vorschläge und Bestätigungen kommen als Nachricht mit Knöpfen.

**Kosten:** keine. Die Telegram Bot API ist kostenlos, braucht keine Kreditkarte und keine eigene Telefonnummer für den Bot. (Dein normales Telegram-Konto reicht.)

## Einrichtung (ca. 5 Minuten)

1. **Bot anlegen:** In Telegram **@BotFather** öffnen → `/newbot` → Namen (z. B. „JARVIS“) und Benutzernamen (muss auf `bot` enden, z. B. `levin_jarvis_bot`) wählen. BotFather schickt dir ein Token `123456789:AA…`.
2. Optional bei BotFather: `/setprivacy` → *Enable* (Standard), `/setjoingroups` → *Disable* (der Bot soll in keine Gruppen).
3. **Vercel:** *Settings → Environment Variables* → `TELEGRAM_BOT_TOKEN` = Token. Neu deployen.
4. **Webhook:** In JARVIS → *Einstellungen → Telegram* → **Webhook einrichten**. (Braucht die https-Adresse aus `JARVIS_PUBLIC_URL`.)
5. **Chat-ID:** Deinem Bot in Telegram `/start` schreiben. Solange `TELEGRAM_CHAT_ID` fehlt, antwortet er nur mit deiner Chat-ID — auf sonst nichts.
6. **Vercel:** `TELEGRAM_CHAT_ID` = diese Zahl eintragen, neu deployen. Danach **Test senden** in den Einstellungen.

### Sprachnachrichten (optional, kostenlos)

Telegram schickt Sprachnachrichten als Audio. Zum Umwandeln in Text nutzt JARVIS einen OpenAI-kompatiblen Whisper-Dienst. Standard ist **Groq** (Free Tier, Anmeldung mit Google/GitHub, keine Kreditkarte):

1. <https://console.groq.com> → *API Keys* → *Create API Key*.
2. Vercel: `TRANSCRIBE_API_KEY` = Key. (`TRANSCRIBE_API_URL` / `TRANSCRIBE_MODEL` nur ändern, wenn du einen anderen Dienst nimmst.)

Ohne Key antwortet JARVIS auf Sprachnachrichten mit der Bitte, zu schreiben. Die Audiodatei wird nicht gespeichert, nur der erkannte Text landet im Chat.

## Befehle

| Befehl | Wirkung |
|---|---|
| `/neu` | neue Unterhaltung (sonst geht es im letzten Gespräch weiter; nach 12 h Pause automatisch neu) |
| `/heute` | Briefing für heute |
| `/stopp` | Not-Aus: alle Automationen anhalten |
| `/weiter` | Automationen wieder starten |
| `/hilfe` | Übersicht |

## Sicherheit

- **Nur dein Chat:** Updates von anderen Chats/Absendern werden ohne Antwort verworfen — auch gefälschte Knopf-Klicks.
- **Webhook-Secret:** Telegram schickt bei jedem Aufruf den Header `X-Telegram-Bot-Api-Secret-Token`. Der Wert wird per HMAC aus `JARVIS_ENCRYPTION_KEY` abgeleitet (keine zusätzliche Variable). Ohne korrekten Header: 401. Das Bot-Token steht nie in Logs oder Fehlermeldungen.
- **Jedes Update genau einmal:** Telegram wiederholt Webhooks; die `update_id` wird in `telegram_updates` gemerkt.
- **Gleiche Regeln wie in der App:** Telegram-Nachrichten laufen durch denselben Agenten, dieselbe Berechtigungs-Engine und dieselben Bestätigungen.
  - Stufe 2 (Senden, Einladen, Löschen …): Knöpfe **Ausführen / Verwerfen**. Ausgeführt wird exakt die vorbereitete Aktion.
  - Stufe 3 (kritisch): **nie per Telegram bestätigbar** — weder per Knopf noch per „ja“. Es gibt nur *Verwerfen* und einen Link in die App.
- **Externe Inhalte bleiben Daten:** Empfangene Dateien werden als Datei gespeichert (Quelle „telegram“), ihr Inhalt erreicht das Modell nur über `read_file` als `external_data`. **Weitergeleitete** Nachrichten stammen von Dritten und werden ebenfalls als `external_data` markiert; bei Manipulationsmustern wird die Unterhaltung als „verdächtig“ markiert (höhere Bestätigungsstufen).
- Dateien bis 20 MB (Grenze der Bot API) bzw. `JARVIS_MAX_FILE_MB`.

## Technik

- `POST /api/telegram` (öffentlich, Secret-Header) antwortet sofort mit 200; auf Vercel arbeitet der Agent per `waitUntil` weiter (bis `maxDuration` 300 s).
- Benachrichtigungen: `InAppNotificationProvider.addMirror` → jede Benachrichtigung geht zusätzlich an Telegram (abschaltbar in den Einstellungen). Vorschläge kommen einzeln mit **Annehmen / Ignorieren** (max. 5 pro Durchlauf), wartende Bestätigungen aus Automationen mit Knöpfen.
- Code: `src/telegram/api.ts` (Bot-API-Client), `bot.ts` (Logik), `transcribe.ts` (Whisper).

## Warum kein WhatsApp und kein Signal?

| Dienst | Problem | Entscheidung |
|---|---|---|
| **WhatsApp** | Die offizielle WhatsApp Cloud API braucht ein Meta-Business-Konto, eine **eigene Telefonnummer** für den Bot und verlangt für die meisten Nachrichten außerhalb des 24-h-Fensters Gebühren (Templates, Zahlungsmittel). Inoffizielle Bibliotheken (Web-Protokoll) verstoßen gegen die Nutzungsbedingungen, können zur Sperrung deiner Nummer führen und brauchen einen dauerhaft laufenden Prozess — auf Vercel nicht möglich. | nicht eingebaut |
| **Signal** | Es gibt keine offizielle Bot-API. `signal-cli` braucht eine **zweite Telefonnummer** und einen dauerhaft laufenden Dienst (kein Serverless). | nicht eingebaut |

**Kostenlose Alternative:** Telegram (dieser Bot) — offizielle, kostenlose Bot-API, Webhooks passen zu Vercel, keine zweite Nummer. Dazu Web-Push über die installierte JARVIS-App.
