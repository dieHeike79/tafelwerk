# Cafeteria – Speiseplan

Kleine statische Webseite (kein Backend, kein Build). Der Speiseplan kommt aus einer CSV-Datei,
im Livebetrieb aus einem Google Sheet, das der Chef pflegt.

```
site/                  ← wird 1:1 veröffentlicht
  index.html, style.css, app.js
.github/workflows/deploy.yml   ← Deploy nach GitHub Pages bei Push auf main
dev-server.mjs         ← lokaler Webserver
```

## Lokal ansehen

```powershell
node dev-server.mjs
```

Dann <http://localhost:5173> öffnen. `#2026-12-21` hinter der URL springt zur jeweiligen Woche.

## Google Sheet einrichten (einmalig)

1. Neues Google Sheet mit der Kopfzeile:
   `Datum | Freigegeben | Gericht 1 | Englisch 1 | Gericht 2 | Englisch 2 | Gericht 3 | Englisch 3 | Gericht 4 | Englisch 4 | Hinweis | Hinweis Englisch`
   (die Kopfzeile am besten fixieren und nicht umbenennen). Die Spalte *Datum* als **Nur Text** oder im Format `yyyy-mm-dd` anlegen,
   die Spalte *Freigegeben* als Kontrollkästchen (*Einfügen → Kontrollkästchen*).
2. *Datei → Freigeben → Im Web veröffentlichen* → Tabellenblatt wählen → Format **CSV** → veröffentlichen.
3. Die erzeugte URL in `site/app.js` bei `CONFIG.csvUrl` eintragen.
4. Das Sheet selbst bleibt **privat**; nur der Chef bekommt Bearbeitungsrechte. Google-Konto mit 2-Faktor-Login schützen.

## Wöchentlich einpflegen (Chef)

- Eine Zeile pro Tag, Montag bis Freitag. Einfach die Zeilen der Vorwoche kopieren und Datum/Gerichte ändern.
- **Freigabe:** Nur Tage mit gesetztem Haken in *Freigegeben* erscheinen auf der Seite. Ohne Haken (oder leer) bleibt der
  Tag unsichtbar, die Seite zeigt dann „Noch nicht geplant" bzw. „Der Menüplan für diese Woche folgt".
  Für eine ganze Woche die fünf Kästchen markieren und einmal anhaken.
  Fehlt die Spalte *Freigegeben* ganz, zeigt die Seite bewusst gar nichts an.
- **Feiertag / geschlossen:** in der Spalte *Hinweis* den Grund eintragen (z. B. `Tag der Deutschen Einheit`).
  Die Gerichte dieses Tages werden dann nicht angezeigt.
- **Englische Übersetzung:** in die Spalte direkt neben dem Gericht (`Englisch 1` neben `Gericht 1` usw.).
  Sie erscheint kleiner und grau unter dem deutschen Namen. Bei *Hinweis* heißt die Spalte `Hinweis Englisch`.
  Bleibt die englische Zelle leer, wird nur die deutsche Zeile gezeigt.
- Kennzeichnungen (vegan, Allergene …) schreibt er direkt in den Gerichtsnamen.
- Änderungen sind nach wenigen Minuten sichtbar (Google aktualisiert die Veröffentlichung verzögert).

## Entwürfe wirklich geheim halten (optional)

Der Haken in *Freigegeben* steuert nur, was die **Seite anzeigt**. Die veröffentlichte CSV enthält weiterhin alle Zeilen,
und ihre URL steht im öffentlichen Code. Wer sie öffnet, kann auch unfreigegebene Entwürfe lesen.
Sollen Entwürfe nicht einsehbar sein, zwei Tabellenblätter verwenden:

- **Entwurf:** hier pflegt der Chef alles, inklusive Haken. Dieses Blatt wird **nicht** veröffentlicht.
- **Veröffentlicht:** enthält nur die freigegebenen Zeilen, per Formel in Zelle A1 (Beispiel für Spalten A–L):

  ```
  =IFERROR({Entwurf!A1:L1; FILTER(Entwurf!A2:L; Entwurf!B2:B)}; Entwurf!A1:L1)
  ```

  Nur dieses Blatt wird per *Im Web veröffentlichen* als CSV freigegeben, und seine `gid` steht in der URL in `app.js`.

## Veröffentlichen (GitHub Pages)

1. Repo anlegen, Code auf `main` pushen.
2. *Settings → Pages → Source: GitHub Actions*.
3. Eigene Domain: *Settings → Pages → Custom domain* eintragen und beim Domain-Anbieter einen
   `CNAME`-Eintrag (Subdomain) auf `<github-user>.github.io` setzen. *Enforce HTTPS* aktivieren.
4. Empfohlen: Domain in den GitHub-Kontoeinstellungen verifizieren.

## Noch offen

- Name der Cafeteria (`CONFIG.title` in `app.js`), Logo und endgültige Farben
- Impressum/Datenschutz sind als Entwurf angelegt (`site/impressum.html`, `site/datenschutz.html`): Angaben prüfen,
  ggf. USt-IdNr. ergänzen. Keine Rechtsberatung.
- Subdomain festlegen und Repo/Deploy einrichten

## Feste Inhalte (nicht im Sheet)

Öffnungszeiten und Adresse stehen direkt in `site/index.html` (Abschnitte `.hours`). Bei Änderungen dort anpassen und pushen.
