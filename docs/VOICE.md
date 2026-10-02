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

## Schnell antworten (Streaming)

JARVIS wartet nicht, bis die ganze Antwort fertig ist:

- Der Server reicht die Text-Stücke des Modells sofort weiter (`text`-Events im NDJSON-Stream,
  `src/core/llm.ts` → `src/core/agent.ts`).
- Die App schneidet daraus ganze Sätze (`createSplitter` in `public/jarvis.js`). „am 14. Oktober“, „z. B.“
  oder „Dr. Weber“ werden dabei nicht zerschnitten, sehr kurze Sätze werden zusammengelegt.
- Jeder fertige Satz kommt sofort in die Sprech-Warteschlange. Mit ElevenLabs wird der nächste Satz schon
  geladen, während der aktuelle läuft.
- Im Chat erscheint der Text live, während er entsteht.

Der erste Satz ist dadurch meist nach 1–2 Sekunden zu hören statt erst nach der ganzen Antwort.

## Dazwischenreden

Während JARVIS spricht, kannst du einfach losreden. Er hört dann sofort auf und hört dir zu.

- **Nur, wenn das Mikrofon schon erlaubt ist.** Mitten im Satz kommt nie eine Berechtigungsabfrage.
- Das Mikrofon läuft mit Echo-Unterdrückung. In den ersten 0,5 s misst die App den Raum und das Echo der
  eigenen Stimme. Erst eine deutlich lautere Stimme, die länger als ca. ¼ Sekunde anhält, unterbricht.
- **Abschalten:** Einstellungen → Sprache → „Dazwischenreden“. Das ist sinnvoll, wenn du ohne Kopfhörer
  in einem lauten Raum bist.
- Geprüft im Browser mit einem künstlichen Mikrofon (Chromium `--use-fake-device-for-media-stream`):
  JARVIS bricht ab und wechselt auf „Hört zu“.

## Schnellstart vom Homescreen

Die Adresse **`https://<deine-app>.vercel.app/#jarvis?listen`** öffnet JARVIS und hört sofort zu.

- **Ist das Mikrofon schon erlaubt,** geht es direkt los.
- **Sonst** verlangt der Browser einen Tipp: Der Status zeigt dann „Tippen zum Sprechen“ und der Kern pulsiert.
  Das ist eine Browser-Regel für Mikrofon und Ton, kein Fehler.

**Android (Chrome):** App-Symbol lange drücken → „Mit JARVIS sprechen“. Den Eintrag kannst du auch als eigenes
Symbol auf den Homescreen ziehen. Weitere Kurzbefehle dort: Notizen & Listen, Kalender, Finanzen
(`shortcuts` im `manifest.webmanifest`).

**iPhone:** iOS kennt für Web-Apps keine solchen Kurzbefehle.

- **Kurzbefehle-App:** neuer Kurzbefehl → „URL öffnen“ → die Adresse oben eintragen.
- **Ab iPhone 15 Pro:** Den Kurzbefehl legst du unter Einstellungen → Aktionstaste auf die Aktionstaste.

Einschränkung: Kurzbefehle öffnen Safari, nicht die Homescreen-App. iOS trennt beide Anmeldungen, du meldest dich in
Safari also einmal extra an.

## Gesprächsmodus

Nach jeder Antwort hört JARVIS automatisch wieder zu. Sagst du nichts, endet das Gespräch nach ca. 7 Sekunden.
Du beendest es auch mit „Danke, das war’s“, „Stopp“ oder dem ✕ oben links. Die letzte Antwort und die Karte
bleiben stehen, bis du das Gespräch schließt.

## Grenzen (Vercel Hobby)

- Audio-Upload höchstens 4 MB pro Aufnahme (ca. 25 Sekunden). Die Aufnahme stoppt nach 25 Sekunden automatisch.
- Pro Satz höchstens 600 Zeichen Sprachausgabe. Lange Antworten werden gekürzt („Den Rest findest du im Chat.“).
