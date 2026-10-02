# Sprachmodus & Kontextkarten

Die Startseite der App ist **JARVIS**: ein lebendiger Partikel-Kern (WebGL), den du antippst, um zu sprechen.
JARVIS hört zu, denkt nach (die Werkzeuge erscheinen live als Chips) und antwortet mit Stimme. Die Worte
leuchten im Takt der Sprache auf.

## Kontextkarten

Spricht JARVIS über etwas, das er gerade nachgeschlagen hat, gleitet unten eine passende Karte herein.
Gleichzeitig fliegt ein Partikelstrom vom Kern zur Karte, und der Kern färbt sich passend ein.

| Thema | Karte |
| --- | --- |
| Termine | Kalender: Datum, große Uhrzeit, Tagesleiste mit deinen anderen Terminen, Ort mit Route, Teilnehmer |
| Rechnungen / Zahlungen | Finanzen: Betrag in Gold, Absender, Fälligkeit (aus dem Postfach erkannt) |
| E-Mails | Absender, Betreff, Vorschau; Öffnen oder Antworten |
| Aufgaben | Fälligkeit, Priorität; direkt erledigen |
| Kontakte | Anrufen oder E-Mail mit einem Tipp |
| Dateien | Format und Größe; öffnet die Vorschau |
| Freigaben (Stufe 2) | **Zum Ausführen halten** (1,2 s). Stufe 3 bleibt ausdrücklich im Chat. |

**So funktioniert es:**

1. Der Server sammelt aus den Werkzeug-Ergebnissen der aktuellen Antwort die anzeigbaren Dinge
   (`src/core/context-cards.ts`). Er erkennt sie an ihrer Form, also nicht an einem bestimmten Werkzeug.
2. Er übernimmt nur Anzeigefelder: keine Mail-Texte und keine Dateiinhalte, alles längenbegrenzt, höchstens 12 Einträge.
3. Die App zerlegt die Antwort in Sätze. Für jeden Satz sucht sie den passenden Eintrag, zuerst über Stichwörter
   aus Titel oder Namen, sonst über das Thema (z. B. „Termin“, „Rechnung“). Die Karte öffnet sich in dem Moment,
   in dem JARVIS den Satz spricht.

Inhalte aus Mails, Dateien und Webseiten bleiben dabei reine Anzeige. Sie werden als Text gerendert
(`textContent`) und lösen nie selbst Aktionen aus.

## Spracherkennung (kostenlos)

- **Mit `TRANSCRIBE_API_KEY`** (Groq Free Tier, keine Kreditkarte): Die App nimmt auf, erkennt das Satzende
  automatisch (Pegel-Erkennung) und lässt Whisper transkribieren. Das funktioniert in allen Browsern, auch auf dem iPhone.
- **Ohne Key:** Die Spracherkennung des Browsers wird genutzt (Chrome, Edge, Safari).

## Stimme

- **Mit `ELEVENLABS_API_KEY`** (ElevenLabs Free, keine Kreditkarte):
  - Modell `eleven_flash_v2_5` mit deutscher Aussprache.
  - Satz für Satz, der nächste Satz wird schon vorgeladen. Der Kern pulsiert mit dem echten Pegel der Stimme.
  - Die Stimme wählst du über `ELEVENLABS_VOICE_ID` (Voice Library → „ID kopieren“).
  - Das Gratis-Kontingent reicht für ca. 10.000 Zeichen im Monat. Das sind grob 15–20 Minuten gesprochene Antworten.
- **Kontingent leer oder Key ungültig:** JARVIS schaltet für 30 Minuten automatisch auf die Gerätestimme um,
  ohne Fehlermeldung.
- **Ohne Key:** Es spricht die Gerätestimme. Am natürlichsten klingen „Google Deutsch“ (Chrome) und die
  „Premium“-Stimmen von iOS/macOS (Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen).

### Warum kein ElevenLabs-„Agent“ (Conversational AI)?

- **Kosten:** Die Agent-Minuten sind im Gratis-Tarif sehr knapp. Danach ist ein Bezahltarif nötig.
- **Sicherheit:** Ein ElevenLabs-Agent würde mit einem eigenen Sprachmodell antworten. Er könnte also an
  JARVIS’ Freigabe-Stufen, dem Audit-Log und den Werkzeugen vorbei handeln.

Deshalb bleibt das Denken bei JARVIS (gleiches Modell, gleiche Regeln wie im Chat). ElevenLabs liefert nur die Stimme.

## Gesprächsmodus

Nach jeder Antwort hört JARVIS automatisch wieder zu. Sagst du nichts, endet das Gespräch nach ca. 7 Sekunden.
Du beendest es auch mit „Danke, das war’s“, „Stopp“ oder dem ✕ oben links. Die letzte Antwort und die Karte
bleiben stehen, bis du das Gespräch schließt.

## Grenzen (Vercel Hobby)

- Audio-Upload höchstens 4 MB pro Aufnahme (ca. 25 Sekunden). Die Aufnahme stoppt nach 25 Sekunden automatisch.
- Pro Satz höchstens 600 Zeichen Sprachausgabe. Lange Antworten werden gekürzt („Den Rest findest du im Chat.“).
