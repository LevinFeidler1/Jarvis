# Google einrichten (Gmail, Kalender, Kontakte)

Dauer: ca. 10 Minuten. Du brauchst nur dein eigenes Google-Konto.

## Was du brauchst

| | |
|---|---|
| **Account** | Dein Google-Konto (privates Gmail oder Google Workspace) |
| **APIs** | Gmail API, Google Calendar API, People API |
| **OAuth-Client** | Typ „Webanwendung" |
| **Env-Variablen** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JARVIS_PUBLIC_URL` |

### OAuth-Scopes (Least Privilege)

| Scope | Zweck |
|---|---|
| `https://www.googleapis.com/auth/gmail.modify` | E-Mails lesen, labeln, archivieren, Entwürfe, senden, Papierkorb. **Kein** endgültiges Löschen. |
| `https://www.googleapis.com/auth/calendar.events` | Termine lesen und schreiben. Keine Kalender-Freigaben/-Einstellungen. |
| `https://www.googleapis.com/auth/contacts` | Kontakte lesen, anlegen, ändern |
| `https://www.googleapis.com/auth/contacts.other.readonly` | „Weitere Kontakte" (Personen, mit denen du gemailt hast) lesen |
| `https://www.googleapis.com/auth/drive.file` | Google Drive: **nur** Dateien, die JARVIS selbst anlegt (Ordner „JARVIS“) oder die du mit JARVIS öffnest. Der Rest deines Drives bleibt unsichtbar. |
| `openid`, `email` | Anzeige, welches Konto verbunden ist |
| *optional* `https://www.googleapis.com/auth/drive.readonly` | Nur wenn `JARVIS_DRIVE_READ_ALL=true`: ganzes Drive **lesend** durchsuchen. Standardmäßig aus (Least Privilege). |

## Schritt für Schritt

1. **Projekt anlegen**
   <https://console.cloud.google.com/> → oben Projektauswahl → *Neues Projekt* → Name z.B. `jarvis` → *Erstellen*.

2. **APIs aktivieren** (im Projekt `jarvis`)
   *APIs & Dienste → Bibliothek* → nacheinander suchen und **Aktivieren**:
   - Gmail API
   - Google Calendar API
   - People API
   - Google Drive API

3. **OAuth-Zustimmungsbildschirm** (*Google Auth Platform* bzw. *APIs & Dienste → OAuth-Zustimmungsbildschirm*)
   - *Branding*: App-Name `JARVIS`, deine E-Mail als Support- und Entwickler-Kontakt.
   - *Zielgruppe*:
     - **Google Workspace**: „Intern" wählen — keine Prüfung, keine Ablaufzeit. Fertig.
     - **Privates Gmail**: „Extern" wählen. Unter *Testnutzer* **deine eigene Adresse** hinzufügen.
   - *Datenzugriff*: *Bereiche hinzufügen* → die Scopes aus der Tabelle oben eintragen
     (inkl. `drive.file`; `drive.readonly` nur, wenn du das ganze Drive durchsuchbar machen willst).

   > **Hinweis für private Gmail-Konten:** Solange die App im Status *Testen* ist,
   > laufen Refresh-Tokens nach **7 Tagen** ab — JARVIS meldet dann
   > „Google-Zugriff wurde widerrufen oder ist abgelaufen" und du klickst in den
   > Einstellungen erneut auf *Verbinden*. Alternativ unter *Zielgruppe* auf
   > *App veröffentlichen* klicken: Für die private Nutzung (unter 100 Nutzer)
   > funktioniert das ohne Google-Verifizierung; beim Verbinden erscheint dann
   > einmalig die Warnung „Google hat diese App nicht überprüft" →
   > *Erweitert → Weiter zu JARVIS*. Da es deine eigene App ist, ist das unbedenklich.

4. **OAuth-Client erstellen**
   *Clients* (bzw. *Anmeldedaten*) → *Client erstellen* → **Webanwendung**
   - Name: `JARVIS local`
   - *Autorisierte Weiterleitungs-URIs* (beide eintragen, wenn du lokal und auf Vercel arbeitest):
     `http://localhost:3000/api/integrations/google/callback`
     `https://<projektname>.vercel.app/api/integrations/google/callback`
     (muss exakt `JARVIS_PUBLIC_URL` + `/api/integrations/google/callback` sein)
   - *Erstellen* → Client-ID und Clientschlüssel kopieren.

5. **In `.env` eintragen** — bzw. auf Vercel unter *Settings → Environment Variables* (nie committen)

   ```dotenv
   GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   JARVIS_PUBLIC_URL=http://localhost:3000
   ```

6. **JARVIS neu starten** (`npm start`, auf Vercel: *Redeploy*) → *Einstellungen → Integrationen →
   Google → Verbinden* → Konto wählen → alle Berechtigungen bestätigen.
   Danach steht dort „verbunden" mit deiner Adresse.

7. **Testen** im Chat:
   - „Was steht diese Woche an?" (Kalender lesen)
   - „Was muss ich heute beantworten?" (E-Mails lesen)
   - „Finde Anna in meinen Kontakten." (Kontakte)
   - „Schreib mir selbst eine Test-Mail." → JARVIS fragt vor dem Senden nach.

## Sicherheit

- Tokens werden mit AES-256-GCM verschlüsselt in der lokalen Datenbank gespeichert
  (`JARVIS_ENCRYPTION_KEY`). Ohne den Schlüssel sind sie unbrauchbar.
- *Trennen* in den Einstellungen löscht die Tokens und widerruft den Zugriff bei Google.
  Zusätzlich jederzeit möglich unter <https://myaccount.google.com/permissions>.
- Der Clientschlüssel gehört nur in `.env` bzw. deinen Secret-Manager.
- Für Zugriff von überall: Deployment auf Vercel, siehe [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

## Fehlerbehebung

| Meldung | Ursache / Lösung |
|---|---|
| `redirect_uri_mismatch` | Weiterleitungs-URI im Client stimmt nicht exakt mit `JARVIS_PUBLIC_URL/api/integrations/google/callback` überein |
| `access_denied` / „App wird getestet" | Deine Adresse fehlt unter *Testnutzer* |
| „Google hat kein Refresh-Token geliefert" | Unter <https://myaccount.google.com/permissions> JARVIS entfernen, dann erneut verbinden |
| „Keine Berechtigung bei Google" (403) | API im Projekt nicht aktiviert oder Scope beim Verbinden abgewählt |

## Google Drive nachrüsten (bestehende Verbindung)

Wenn Google schon verbunden war, bevor es Drive in JARVIS gab:

1. Google Cloud Console → *APIs & Dienste → Bibliothek* → **Google Drive API** aktivieren.
2. *Google Auth Platform → Datenzugriff → Bereiche hinzufügen* →
   `https://www.googleapis.com/auth/drive.file` eintragen → *Aktualisieren* → *Speichern*.
3. Optional fürs Durchsuchen des **ganzen** Drives (nur lesend): zusätzlich
   `https://www.googleapis.com/auth/drive.readonly` eintragen und in Vercel
   `JARVIS_DRIVE_READ_ALL=true` setzen → Redeploy.
4. In JARVIS: *Einstellungen → Integrationen → Google →* **„Neu verbinden“** (der Knopf erscheint,
   solange die Drive-Berechtigung fehlt) → alle Häkchen setzen.

Danach landen neue Dateien in deinem Drive im Ordner **„JARVIS“**; Bearbeitungen werden
dort als Versionen derselben Datei gespeichert (Drive → Datei → *Versionen verwalten*).
Dateien, die vorher in der JARVIS-Datenbank lagen, bleiben dort.

**Warum `drive.file` und nicht voller Zugriff?** Mit `drive.file` kann JARVIS deine übrigen
Dokumente weder lesen noch ändern oder löschen — ein manipulierter Auftrag (Prompt Injection)
kann also nichts außerhalb des JARVIS-Ordners anrichten. Schreibender Vollzugriff (`drive`) wird nie angefragt.
