# Weitere Postfächer verbinden (1&1 / IONOS, All-Inkl, …)

JARVIS liest und sendet für **mehrere Postfächer gleichzeitig**:

| Postfach | Weg | Einrichtung |
|---|---|---|
| Gmail (z.B. `lev.feidler@gmail.com`) | Google-API (OAuth) | [SETUP_GOOGLE.md](SETUP_GOOGLE.md) |
| 1&1 / IONOS (z.B. `levin@feidler.de`) | IMAP + SMTP | diese Anleitung |
| All-Inkl (z.B. `levin.feidler@fa-automations.de`) | IMAP + SMTP | diese Anleitung |

Einrichtung **in JARVIS selbst**: *Einstellungen → E-Mail-Konten → Postfach hinzufügen*.
Das Passwort gibst nur du dort ein. Es wird mit AES-256-GCM verschlüsselt gespeichert und nie
wieder angezeigt. Vor dem Speichern testet JARVIS die Anmeldung per IMAP **und** SMTP.
Schlägt der Test fehl, wird nichts gespeichert.

## 1&1 / IONOS (eigene Domain, z.B. feidler.de)

| Feld | Wert |
|---|---|
| Anbieter | „1&1 / IONOS (eigene Domain)“ |
| E-Mail | `levin@feidler.de` |
| Benutzername | `levin@feidler.de` (volle Adresse) |
| Passwort | das Passwort **des Postfachs** (nicht das 1&1-Kundenkonto-Passwort) |
| IMAP | `imap.ionos.de`, Port 993 (SSL) — vorausgefüllt |
| SMTP | `smtp.ionos.de`, Port 465 (SSL) — vorausgefüllt |

Postfach-Passwort vergessen? 1&1 Control-Center → *E-Mail* → Postfach → *Passwort ändern*.
Scheitert die Anmeldung, das Preset „1&1 Mail“ probieren (`imap.1und1.de` / `smtp.1und1.de:587`).

## All-Inkl (z.B. fa-automations.de)

| Feld | Wert |
|---|---|
| Anbieter | „All-Inkl (KAS)“ |
| E-Mail | `levin.feidler@fa-automations.de` |
| Benutzername | die Postfach-Kennung aus dem KAS (z.B. `m0123456`) — oder die E-Mail-Adresse |
| Passwort | Postfach-Passwort |
| IMAP / SMTP | Servername aus dem KAS, z.B. `w0123456.kasserver.com`, Ports 993 / 465 |

Wo steht das? <https://kas.all-inkl.com> → *E-Mail* → *E-Mail-Postfach* → beim Postfach auf
*Details/Bearbeiten*: dort stehen **Postfach-Kennung** (`m…`) und **Server** (`w….kasserver.com`).

## Standard-Absender

Bei mehreren Postfächern legst du unter *E-Mail-Konten* einen **Standard-Absender** fest.

- **Antworten** gehen immer vom Postfach der ursprünglichen E-Mail — egal was Standard ist.
- **Neue E-Mails** gehen vom Standard, außer du sagst etwas anderes („schreib von meiner F&A-Adresse“).
- Ohne Standard und ohne eindeutigen Kontext **fragt JARVIS nach**, bevor er etwas vorbereitet.

Tipp fürs Gedächtnis: *„Geschäftliches immer von levin.feidler@fa-automations.de“* — JARVIS
merkt sich das als Regel.

## Wie JARVIS mit IMAP umgeht

| Aktion | Umsetzung |
|---|---|
| Lesen | Posteingang (bei Suche zusätzlich „Gesendet“ und „Archiv“); Lesen markiert **nicht** als gelesen |
| Label / Sortieren | IMAP kennt keine Labels → die Mail wird in einen **Ordner** dieses Namens verschoben (wird bei Bedarf angelegt) |
| Archivieren | Verschieben nach „Archiv“ |
| Löschen | Verschieben in den Papierkorb (mit Bestätigung) |
| Entwurf | wird im Ordner „Entwürfe“ abgelegt — sichtbar in jedem Mailprogramm |
| Senden | per SMTP, danach Kopie in „Gesendet“ (1&1 und All-Inkl machen das nicht automatisch) |

Die Berechtigungsstufen gelten unverändert: Senden, Antworten, Weiterleiten und Löschen
brauchen immer deine Bestätigung — und die Bestätigung zeigt, **von welchem Postfach** gesendet wird.

## Fehlerbehebung

| Meldung | Lösung |
|---|---|
| „Anmeldung … fehlgeschlagen“ | Benutzername/Passwort prüfen; bei All-Inkl die Kennung `m…` statt der Adresse probieren |
| „Mailserver … nicht erreichbar“ | Servername/Port prüfen (All-Inkl: `w….kasserver.com`) |
| Ein Postfach fehlt in der Übersicht | Die E-Mail-Ansicht zeigt oben eine Warnung mit dem Grund — JARVIS verschweigt nicht erreichbare Postfächer nie |
