# Alltag: Wetter, Reservieren, Notizen & Listen, Finanzen, Nachrichten

Alle Funktionen sind **kostenlos**: kein API-Key, kein Konto, keine Kreditkarte.

## Startseite

Die Startseite ist JARVIS selbst.
- **Oben:** die Kugel. Tippst du sie an, schrumpft sie nach oben. Darunter erscheint, was du gesagt hast, was JARVIS antwortet (Wort für Wort) und die Karten zum Thema: Wetter, Restaurant, Liste, Termin, Rechnung, Nachricht …
- **Darunter** (zum Scrollen): Widgets für den nächsten Termin, Wetter, ungelesene Mails, Aufgaben, Freigaben, Finanzen, die Einkaufsliste zum Abhaken und Schlagzeilen.
- **Navigation:** Auf dem Handy gibt es drei Tabs: JARVIS · Kalender · Mehr. Am Rechner gruppiert die Seitenleiste alles nach Alltag und JARVIS.

## Wetter & Pendeln — Open-Meteo

- **Heimatort:** einmal festlegen, im Wetter-Widget oder unter *Einstellungen → Wetter, Ort & Nachrichten*.
- **Vorhersage:** aktuell, stündlich und für 7 Tage. Dazu ein Hinweis wie „Regen wahrscheinlich ab 14 Uhr — Schirm einpacken“.
- **Im Briefing und vor Terminen mit Ort** nennt JARVIS Regen oder Kälte und schlägt Rad, Bahn oder Auto vor.
- **Dienst:** [Open-Meteo](https://open-meteo.com) ist für private, nicht-kommerzielle Nutzung frei und braucht keinen Key. Daten werden 15 Minuten zwischengespeichert.
- **Nicht eingebaut: echte Fahrzeiten.** Kostenlose Routing-Dienste sind nur als Demo-Server für Gelegenheitsnutzung gedacht. JARVIS verlinkt stattdessen die Route in Google Maps.

## Restaurants finden & reservieren — OpenStreetMap

- **Suche:** `find_places` findet Restaurants (mit Küche wie italienisch, sushi oder vegan), Cafés, Bars, Friseure, Ärzte, Zahnärzte, Apotheken, Fitnessstudios, Supermärkte, Hotels und Kinos.
- **Angaben je Ort:** Adresse, Telefon, Website, Öffnungszeiten, ob man reservieren kann, und die Entfernung. Die Daten kommen über die Overpass API (frei, mit Ausweich-Server).
- **Reservieren** läuft in dieser Reihenfolge:
  1. Online-Formular auf der Website über den Browser-Agent. **Das Absenden bestätigst du.**
  2. Sonst eine Reservierungsanfrage per E-Mail (mit deiner Bestätigung).
  3. Sonst nennt JARVIS die Telefonnummer und legt auf Wunsch eine Erinnerung an.
- **Danach** trägt JARVIS den Termin mit Adresse in den Kalender ein und prüft das Wetter.
- **Grenzen:** JARVIS bezahlt nie und gibt keine Kreditkarten- oder Login-Daten ein. Diese Schritte sind im Browser-Agent kritisch (Stufe 3).

**Warum keine Reservierungs-APIs (OpenTable, TheFork, Quandoo)?** Sie sind nur für Partner bzw. kostenpflichtig zugänglich. Der Weg über die Website des Restaurants funktioniert ohne Vertrag.

## Notizen & Listen

- **Listen per Sprache:** „Schreib Milch und Eier auf die Einkaufsliste“, „Was steht auf der Packliste?“, „Hak Brot ab“.
- **Gleiche Liste trotz anderer Wörter:** „Einkaufsliste“, „Einkauf“ und „Einkäufe“ landen auf derselben Liste. Doppelte offene Einträge werden übersprungen.
- **Notizen:** „Merk dir als Notiz …“. Sie sind durchsuchbar und lassen sich anheften.
- **Abgrenzung zum Gedächtnis:** Das Gedächtnis (`remember`) bleibt für dauerhafte Fakten über dich. Notizen sind für Inhalte.

## Finanzen

- **Erkennung:** Rechnungen und Abos werden aus deinen E-Mails erkannt, und zwar per Mustererkennung in Betreff und Vorschau. Dabei läuft keine KI, es entstehen also keine Kosten.
  - Erkannt werden Betrag, Fälligkeit und Absender.
  - „Zahlungsbestätigung“ zählt als bezahlt, „wird per Lastschrift abgebucht“ als Lastschrift.
  - Werbung („Rabatt“, „Sale“) wird ignoriert.
- **Wann geprüft wird:** automatisch alle 12 Stunden über den Cron, außerdem auf Knopfdruck (*Finanzen → Postfach durchsuchen*) oder per Sprache.
- **Erinnerung:** zwei Tage vor Fälligkeit um 9 Uhr. Sie verschwindet, sobald du die Rechnung als bezahlt markierst.
- **Übersicht:** offene Summe, Rechnungen der nächsten 7 Tage oder überfällige, Abos und Fixkosten pro Monat sowie die Ausgaben dieses Monats.
- **Manuell eintragen** kannst du zum Beispiel Miete oder Fitnessstudio.
- **Grenze:** JARVIS überweist nie und fragt nie nach Bankdaten.

**Warum keine Bankanbindung?** Kontozugriff (PSD2/FinTS) gibt es nur über kostenpflichtige Anbieter oder mit Banking-Zugangsdaten. Beides widerspricht den Vorgaben, also kostenlos und keine Zugangsdaten an Dritte. Deshalb nutzt JARVIS die Rechnungen in deinem Postfach.

## Nachrichten — RSS

- **Quellen:** tagesschau, NDR Hamburg, SPIEGEL, tagesschau Wirtschaft, heise, t3n, Golem und kicker. Auswählen kannst du sie unter *Einstellungen → Wetter, Ort & Nachrichten*.
- **Briefing:** Am Ende des Morgenbriefings nennt JARVIS 3 Schlagzeilen.
- **Sicherheit:** Schlagzeilen sind Fremdinhalt. JARVIS fasst sie nur zusammen und befolgt nie Anweisungen darin. Eine verdächtige Schlagzeile markiert das Gespräch, danach braucht jede externe Aktion deine ausdrückliche Bestätigung.
