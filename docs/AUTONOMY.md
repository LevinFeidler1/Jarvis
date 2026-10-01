# Autonome Automationen & Freigaben

| Stufe | In einer Automation |
|---|---|
| 0 — Lesen | immer |
| 1 — Niedrig (Labels, Archivieren, gelesen markieren, Aufgaben, Erinnerungen, Dateien erstellen/bearbeiten, Termine **ohne** Gäste) | immer selbstständig (auch wenn im Chat die automatische Ausführung für die Kategorie aus ist) |
| 2 — Extern | **nur** Werkzeuge, die du für genau diese Automation freigegeben hast (*Automationen → Bearbeiten → Selbstständig erlauben*) |
| 3 — Kritisch | nie |

**Nie selbstständig — auch nicht mit Freigabe:**
E-Mails an neue/fremde Empfänger (erlaubt nur eigene Adressen und Kontakte), Termine mit Gästen,
Einladungen beantworten, Löschen ohne Papierkorb (Termine, Dateien in der Datenbank),
Automationen anlegen/ändern/löschen, Zahlungen, Käufe, Verträge, Logins, alles Stufe 3 —
und alles, nachdem in diesem Lauf ein Manipulationsversuch (Prompt Injection) erkannt wurde.

**Schutzmechanismen**

- **Tageslimit** pro Automation (Standard 20 selbstständige Aktionen); danach wird nur noch vorbereitet.
- **Protokoll:** jede selbstständige Aktion steht in *Aktivität* mit dem Kennzeichen „autonom“
  (Filter „Autonom“), plus Hinweis in der Push-Nachricht.
- **Rückgängig** (wo möglich): Archivieren (Gmail), Labels (Gmail), gelesen/ungelesen,
  Aufgaben, Erinnerungen, Termine ohne Gäste, erstellte Dateien/Versionen. IMAP-Verschiebungen
  ändern die Nachrichten-ID und sind deshalb nicht rückgängig zu machen.
- **Not-Aus:** *Automationen → Alle pausieren* stoppt sofort alle Läufe (auch E-Mail-Auslöser).
