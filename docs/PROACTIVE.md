# Proaktiver Butler (Mail-Hinweise & Vorschläge)

Bei jedem Cron-Takt (alle 5 Minuten über cron-job.org, lokal alle 30 s, gedrosselt auf ~5 Min.)
prüft JARVIS **neue** E-Mails aller Postfächer (Gmail + IMAP) und macht daraus Vorschläge:

| Kategorie | Vorschlag | „Annehmen“ führt aus |
|---|---|---|
| Terminanfrage | „Terminanfrage von X für Do 14:00 — du bist frei. Zusagen?“ (Kalender wird geprüft) | Antwort-Mail (Entwurf sichtbar) + Kalendereintrag ohne Gäste |
| Kundenanfrage / Lead | „Neue Anfrage von Y — Antwortentwurf liegt bereit“ | Antwort senden |
| Rechnung / Frist | „Rechnung Z · 84,20 € · fällig am …“ | Aufgabe anlegen — standardmäßig **automatisch**, mit „Rückgängig“ |
| Antwort nötig | „Antwort nötig: …“ | Antwort senden (wenn Entwurf) |
| Newsletter / Werbung | gebündelt: „5 Newsletter — archivieren?“ | alle archivieren |

- **Annehmen** = die auf der Karte gezeigten Aktionen laufen durch dasselbe Berechtigungs-Gate
  wie im Chat (der Klick ist die Bestätigung). Kritische Aktionen (Stufe 3) werden nur vorbereitet
  und müssen im Chat ausdrücklich bestätigt werden. **Bearbeiten** öffnet den Chat mit Kontext,
  **Ignorieren** verwirft.
- Vorschläge erscheinen auf der **Startseite** (Widget „Vorschläge aus deinen Mails“) und als **Push** („💡 3 neue Vorschläge“).

## Kosten

- Klassifizierung mit kleinem Modell (`JARVIS_TRIAGE_MODEL`, Standard `claude-haiku-4-5`),
  mehrere Mails pro Anfrage, nur Absender/Betreff/Anfang des Textes (max. 600 Zeichen).
- Nur neue Mails seit dem Einschalten; jede Mail genau einmal.
- Tageslimit `JARVIS_TRIAGE_DAILY_LIMIT` (Standard 150 Mails/Tag). Verbrauch erscheint im Wochenrückblick.
- Abschaltbar unter *Einstellungen → Proaktive Hinweise*.

## Lernen

Ignorierst du Vorschläge eines Absenders dreimal (ohne je einen anzunehmen), kommen von ihm
keine Vorschläge dieser Art mehr. Ignorierst du eine ganze Kategorie sechsmal, wird sie
stummgeschaltet und JARVIS legt dazu einen Gedächtniseintrag (Regel, „vermutet“) an.
Beides ist unter *Einstellungen → Proaktive Hinweise* sichtbar und mit einem Klick wieder aufhebbar.

## Sicherheit

- Mailinhalte gehen als `external_data` an das kleine Modell; dessen Ausgabe wird streng geprüft
  (Schema, Kategorien, Datumsformate) — Unpassendes wird verworfen.
- Antworten gehen immer an den ursprünglichen Absender; das Modell wählt keine Empfänger.
- Mails mit typischen Manipulationsmustern bekommen **keine** vorbereiteten Aktionen, nur einen Warnhinweis.
- Eine Mail ist erst nach dem Klick „Annehmen“ beantwortet — vorher passiert nichts außer
  (falls eingeschaltet) dem Anlegen von Aufgaben für Rechnungen/Fristen.
