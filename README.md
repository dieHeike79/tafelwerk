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

Im Terminal (macOS: *Terminal*, Windows: *PowerShell*) im Projektordner:

```sh
node dev-server.mjs
```

Dann <http://localhost:5173> öffnen (beenden mit `Ctrl+C`). `#2026-12-21` hinter der URL springt zur jeweiligen Woche.

## Google Sheet einrichten (einmalig)

**Eine Zeile pro Gericht**, vier Zeilen pro Tag (Suppe, Gericht 1–3). Kopfzeile:

`Datum | Freigegeben | Position | Gericht | Englisch | Allergene | Kennzeichnung | Preis klein | Preis groß`

1. Neues Google Sheet, die Datei `menu.sample.csv` importieren (*Datei → Importieren → Hochladen*, Trennzeichen Komma).
   Sie enthält die Kopfzeile und **Beispieldaten** (alle Gerichte, Allergene und Preise darin sind erfunden und werden ersetzt).
   Die Kopfzeile am besten fixieren und nicht umbenennen. Die Spalte *Datum* im Format `yyyy-mm-dd` oder als **Nur Text**,
   die Spalte *Freigegeben* als Kontrollkästchen (*Einfügen → Kontrollkästchen*).
2. *Datei → Freigeben → Im Web veröffentlichen* → Tabellenblatt wählen → Format **CSV** → veröffentlichen.
3. Die erzeugte URL in `site/app.js` bei `CONFIG.csvUrl` eintragen.
4. Das Sheet selbst bleibt **privat**; nur der Chef bekommt Bearbeitungsrechte. Google-Konto mit 2-Faktor-Login schützen.

## Wöchentlich einpflegen (Chef)

Pro Tag vier Zeilen mit demselben Datum, Spalte *Position*: `Suppe`, `Gericht 1`, `Gericht 2`, `Gericht 3`.
Am einfachsten die 20 Zeilen der Vorwoche kopieren und Datum und Gerichte ändern.

| Spalte | Eingabe |
|---|---|
| *Freigegeben* | Haken setzen = erscheint auf der Seite. Ohne Haken bleibt die **Zeile** unsichtbar (Entwurf). Für eine ganze Woche die Zeilen markieren und einmal anhaken. Fehlt die Spalte ganz, zeigt die Seite bewusst nichts an. |
| *Position* | `Suppe`, `Gericht 1`, `Gericht 2`, `Gericht 3` (mehr Gerichte: `Gericht 4` usw.) oder `Hinweis` (siehe unten). Die Reihenfolge der Zeilen ist egal. |
| *Gericht* / *Englisch* | Deutscher Name und englische Übersetzung (erscheint kleiner und grau darunter, darf leer sein). **Allergene direkt am Bestandteil:** das Kürzel in eckigen Klammern hinter das Wort schreiben, z. B. `Geflügelbällchen in Sahnesauce[a1,g] dazu Kartoffelpüree[g] und Erbsen-Möhrengemüse`. Die Seite macht daraus kleine, hochgestellte Kürzel direkt am Wort (das Leerzeichen davor entfällt, ein fehlendes danach wird ergänzt). Das geht in *Gericht* und in *Englisch*. |
| *Allergene* | Kürzel aus dem Tabellenblatt *Allergene*, durch Komma getrennt: Buchstaben für Allergene, Zahlen für Zusatzstoffe, z. B. `a1,g,1,3`. Sie stehen klein und hochgestellt am Namen (erst Allergene, dann Zusatzstoffe). Die Spalte *Allergene* gilt für das ganze Gericht und wird hinter den Namen gesetzt; Kürzel, die schon in eckigen Klammern am Bestandteil stehen, werden dort nicht wiederholt, alles Übrige aus der Spalte bleibt sichtbar. Beides lässt sich mischen. Unter dem Plan erscheinen automatisch zwei Legenden, *Allergene* und *Zusatzstoffe*, jeweils nur für die Kürzel der Woche. Ein Kürzel, das im Tabellenblatt fehlt (oder ein Wort wie `Gluten`), wird unverändert angezeigt, damit nie etwas verschwindet. |
| *Kennzeichnung* | `vegan`, `vegetarisch`, `glutenfrei`, mehrere mit Komma oder Schrägstrich (`vegan, glutenfrei`). Erscheint als Pille hinter „Suppe" / „Gericht 1": vegan kräftig grün, vegetarisch hell grün, glutenfrei braun. Was eingetragen ist, wird angezeigt (`vegan / vegetarisch` zeigt beide). |
| *Preis klein* / *Preis groß* | z. B. `5,50`, `5.5` oder `5,50 €`; die Seite zeigt immer `5,50 €`. Sind beide gefüllt, steht darunter „Klein" bzw. „Groß". Gibt es nur eine Portion, nur eine der Zellen füllen: Der Preis steht dann ohne Beschriftung rechts. |

**Allergen-Kürzel pflegt der Chef selbst** in einem zweiten Tabellenblatt namens *Allergene* im selben Google Sheet:

`Allergen | Name de | Name en`

- Eine Zeile pro Kürzel, z. B. `a1 | Weizen | Wheat`. Die Reihenfolge der Zeilen ist die Reihenfolge in der Legende und an den Gerichten.
- **Zusatzstoffe** stehen im selben Tabellenblatt, mit einer **Zahl** als Kürzel, z. B. `1 | mit Konservierungsstoff | with preservative`.
  Rein numerische Kürzel zeigt die Seite automatisch in einer eigenen Legende „Zusatzstoffe", alle anderen unter „Allergene".
  Welche Nummer wofür steht, legt der Betrieb fest; die Seite erfindet keine Zuordnung.
- Einrichten: `allergene.sample.csv` (die 14 Pflichtallergene a–n als Startwert) in ein neues Tabellenblatt importieren und anpassen.
  Dann dieses Blatt wie das Menü *Im Web veröffentlichen* (CSV) und die URL in `site/app.js` bei `CONFIG.allergensUrl` eintragen.
- Solange `allergensUrl` leer ist, gilt eine eingebaute Standardliste a–n.
- Ist die Tabelle konfiguriert, aber nicht erreichbar (und im Browser nichts gespeichert), zeigt die Seite die Kürzel mit dem Hinweis,
  dass die Erklärung gerade fehlt. Eine Ersatzliste gibt es bewusst nicht, damit nie ein Kürzel falsch erklärt wird.

**Feiertag / geschlossen:** eine Zeile mit *Position* `Hinweis`, in *Gericht* den Grund (z. B. `Tag der Deutschen Einheit`),
in *Englisch* die Übersetzung. Die Gerichte dieses Tages werden dann nicht angezeigt. Samstag und Sonntag brauchen keine Zeilen.

Änderungen sind nach wenigen Minuten sichtbar (Google aktualisiert die Veröffentlichung verzögert).

## Entwürfe wirklich geheim halten (optional)

Der Haken in *Freigegeben* steuert nur, was die **Seite anzeigt**. Die veröffentlichte CSV enthält weiterhin alle Zeilen,
und ihre URL steht im öffentlichen Code. Wer sie öffnet, kann auch unfreigegebene Entwürfe lesen.
Sollen Entwürfe nicht einsehbar sein, zwei Tabellenblätter verwenden:

- **Entwurf:** hier pflegt der Chef alles, inklusive Haken. Dieses Blatt wird **nicht** veröffentlicht.
- **Veröffentlicht:** enthält nur die freigegebenen Zeilen, per Formel in Zelle A1 (Beispiel für Spalten A–I):

  ```
  =IFERROR({Entwurf!A1:I1; FILTER(Entwurf!A2:I; Entwurf!B2:B)}; Entwurf!A1:I1)
  ```

  Nur dieses Blatt wird per *Im Web veröffentlichen* als CSV freigegeben, und seine `gid` steht in der URL in `app.js`.

## Veröffentlichen (GitHub Pages)

1. Repo anlegen, Code auf `main` pushen.
2. *Settings → Pages → Source: GitHub Actions*.
3. Eigene Domain `cafeteria.dieheike.de`: beim Domain-Anbieter einen DNS-Eintrag **CNAME** `cafeteria` →
   `<github-user>.github.io` setzen (ohne Pfad, ohne `https://`). Dann *Settings → Pages → Custom domain*
   `cafeteria.dieheike.de` eintragen und, sobald das Zertifikat bereit ist (kann einige Minuten dauern),
   *Enforce HTTPS* aktivieren. Die Datei `site/CNAME` hält den Domainnamen im Repo fest.
4. Empfohlen: Domain in den GitHub-Kontoeinstellungen verifizieren.

## Noch offen

- Logo und endgültige Farben (Name steht in `CONFIG.title` in `app.js` sowie in den Kopfzeilen von Impressum/Datenschutz)
- Impressum/Datenschutz sind als Entwurf angelegt (`site/impressum.html`, `site/datenschutz.html`): Angaben prüfen,
  ggf. USt-IdNr. ergänzen. Keine Rechtsberatung.

## Feste Inhalte (nicht im Sheet)

Öffnungszeiten und Adresse stehen direkt in `site/index.html`, und zwar an drei Stellen. Bei Änderungen alle drei anpassen und pushen:

- Abschnitte `.hours` (Öffnungszeiten, „Hier finden Sie uns“)
- Druckkopf `.print-head` (Zeile „Mittagstisch von … bis … Uhr“)
- Druck-Fußzeile `.print-note` (Adresse, Telefon, E-Mail)
