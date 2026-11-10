# Artikel-Eingang

Hier legt **Löwen OS 305** (crm-db, Tabellen `mediaplan` und `artikel`) je Artikel eine
Auftragsdatei ab. Geschrieben wird sie vom n8n-Workflow **„305: Website (Mediaplanung,
Newsartikel)“** (`XCiGF4dCG99mvKhu`). Der GitHub-Workflow
`.github/workflows/news-veroeffentlichen.yml` baut daraus mit
`tools/artikel-veroeffentlichen.py` die fertige Seite.

**Nicht von Hand pflegen.** Quelle ist der Artikel in 305 (Bereich Website → Artikel).
Was hier liegt, wird bei jedem Lauf erneut verarbeitet; das Skript ist idempotent.

**Notion ist seit 02.11.2026 nur noch Spiegel.** Die frühere Strecke „Website: News-Artikel
aus Notion veröffentlichen“ (n8n `slyQfEyuRkujoQHz`) ist abgeschaltet; ein Status, der in
Notion gesetzt wird, bewirkt nichts. Ältere Aufträge heißen noch `<notionId>.json`, neue
`305-<artikel-id>.json`.

## Die Status-Kette in 305

| Status am Artikel | wer setzt ihn | was passiert |
|---|---|---|
| Entwurf | Mensch (mit KI-Chat) | nichts, der Text entsteht in 305 |
| **Prüfung** | Knopf „Zur Prüfung“ | 305 schreibt den Auftrag mit `"status": "pruefung"`, die Action legt den Entwurf an (noindex, unverlinkt); die Adresse steht am Artikel und in der Mediaplanung |
| **Freigegeben** | Knopf „Freigeben“ | ab dem Termin (mit Uhrzeit auf die Minute, sonst ab Mitternacht; liegt er zurück: sofort) setzt der Workflow im nächsten 10-Minuten-Lauf `"status": "freigegeben"`, der Artikel wird verlinkt und indexierbar |
| **Veröffentlicht** | Automatik | sobald der Artikel in `data/news.json` steht |

**„Freigabe durch“:** Steht an Artikel oder Mediaplan-Zeile eine Mailadresse, kann nur diese
Person freigeben; leer heißt, die berechtigten Personen in 305 (in der Regel Marko).

Ein veröffentlichter Artikel wird in 305 geändert und mit „aktualisieren“ neu an die Website
gegeben; „löschen“ zieht ihn zurück (Seite, `news.json` und Spielplan-Link verschwinden).

**Zwei Aufträge gleichzeitig** (zwei Freigaben im selben Lauf) können die Action an einem
Push-Konflikt scheitern lassen (10.11.2026). Dann `gh workflow run news-veroeffentlichen.yml
-R bbloewen/website --ref main` anstoßen.

Das Team „Club" erscheint als Kategorie „Club" (Eyebrow und Kachel-Label, wie in der Navigation) ohne Feed-Team
(`team` fehlt = allgemein), alle anderen Teams übernehmen ihren Feed-Schlüssel.

Die Überarbeitung in Schritt 2 betrifft Form und Aufbau — Zwischenüberschriften,
Absatzlängen, Kurzfassung, Typografie. Sie darf keine Fakten hinzufügen; dafür
gibt es die Prüfstufe.

Dateiname: `<notionId>.json`

## Redaktionsregeln

Schreiben, Ändern und Freigeben läuft über den Skill `.claude/skills/news-artikel/SKILL.md`.
Dort stehen auch die Regeln: immer „Basketball Löwen Erfurt“ in Titel/Lead, Meta-Description
und erster Nennung; Partner und Organisationen mit gesicherter Adresse verlinken
(Partner aus `data/sponsoren.json`); keine neuen Fakten; „Veröffentlicht“ setzt nur der Workflow.

## Vor- und Spielberichte

Kanal **Spielbericht** in der Mediaplanung. Eyebrow und Kachel-Label heißen dann
„Spielbericht“, auch bei Team Profis. Zu jedem Spiel gibt es zwei Zeilen: Vorbericht
(Freitag vor dem Spiel, bei Freitagsspielen der Spieltag, nur Datum) und Spielbericht
(Spieltag, Spielbeginn plus 4 Stunden, mit Uhrzeit). Ein Termin mit Uhrzeit gilt auf die
Minute: erst dann wird ein freigegebener Artikel verlinkt. Das Feld `Anlass` („Vorbericht:
Heimspiel gegen X am So 11.10.2026, 17:00 Uhr (Halle)“) liefert Art, Gegner und Spieldatum
(`spiel.datum`), und bei mehreren Hero-Bildern am selben Datum die Zuordnung. Details im
Skill `news-artikel`.

## Felder

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `notionId` | — | Seiten-ID in Notion, nur zur Nachverfolgung |
| `status` | ja | `pruefung` (noindex, nicht verlinkt) oder `freigegeben` |
| `datum` | ja | `JJJJ-MM-TT`, Tag der Veröffentlichung — steht im Dateinamen und als `datePublished` im JSON-LD |
| `team` | ja | `profis`, `damen`, `nachwuchs`, `club` oder `partner` |
| `slug` | ja | Kleinbuchstaben, Ziffern, Bindestriche |
| `titel` | ja | Überschrift in den Kacheln und Listen |
| `seitentitel` | — | kürzere Fassung für `<title>`; ohne dieses Feld wird `titel` genommen |
| `h1` | — | Überschrift auf der Seite; ohne dieses Feld `titel` mit Punkt am Ende |
| `lead` | ja | Vorspann unter der H1 |
| `beschreibung` | ja | Meta-Description und Vorschautext beim Teilen |
| `kurztext` | — | Teaser in den Kacheln; ohne dieses Feld `beschreibung` |
| `kurzfassung` | — | Liste der Punkte für „Das Wichtigste in Kürze" |
| `kategorie` | ja | Zeile über der H1 und Label in der Kachel, z. B. `Profis` |
| `icon`, `tint` | — | Kachel-Icon (lucide) und Farbton, Standard `newspaper` / `tint-orange` |
| `topNews` | — | `true` = große Kachel auf der Startseite |
| `bild` | ja | Zieldateiname unter `assets/img/news/` (immer `.webp`) |
| `quellbild` | — | Pfad des Originals unter `data/artikel-eingang/bilder/` (JPG, PNG oder WebP). Das Skript wandelt es nach `bild` um (Breite höchstens 2400 px, Qualität 82) und **löscht das Original danach**. Fehlt das Feld, muss `bild` schon unter `assets/img/news/` liegen. Ein **Hochformat** (JPG/PNG) baut das Skript seit 11.10.2026 selbst ins Hero-Format um: 2400 × 900, Foto mittig (oberer Teil), seitlich weich in eine unscharfe Vergrößerung auslaufend. |
| `heroPosition` | — | CSS `background-position` des Heros, Standard `center center`; z. B. `center 30%`, wenn die Szene im oberen Bildteil liegt |
| `markdown` | ja | Fließtext: `##` Zwischenüberschrift, `>` Zitat, `-` Liste, `[Text](URL)`, `**fett**` |
| `spiel` | — | `{"datum": "04.10.2026", "feld": "spielberichtUrl"}` — verlinkt den Artikel beim Profi-Spiel an diesem Tag. `feld`: `spielberichtUrl` (oder `vorberichtUrl`) = Vorbericht, `nachberichtUrl` = Spielbericht. Auswärtsspiel: gleichnamiges Feld in `data/spielplan-saison.json` (Spielplan, Startseiten-Widget). Heimspiel: `vorberichtUrl` bzw. `nachberichtUrl` in `data/heimspiele.json` (Berichtskarte auf der Spieltagsseite); dort bleibt `spielberichtUrl` immer die Spieltagsseite selbst. Zurückziehen entfernt die Verlinkung wieder |

## Bild

Das Hero-Bild kommt in 305 an den Artikel (Upload oder Link aus Google Drive/Fotos) und liegt
als Original unter `data/artikel-eingang/bilder/`; das Skript wandelt es in das WebP unter
`assets/img/news/` um (siehe Feld `quellbild`).

**Vorberichte und Spielberichte** zu **Auswärtsspielen** verlinkt die Automatik auch im
Spielplan und im Startseiten-Widget (Feld `spiel`). Bei Heimspielen gibt es einen Hinweis statt
einer Verlinkung — die haben ihre eigene Spieltagsseite.

Das Feld `bild` bestimmt die Hero-CSS-Klasse (`hero-news-<Dateiname ohne
Endung>`) und darüber auch den Namen des Share-Bildes. Das ist kein Zufall,
sondern notwendig: `build-head-meta.py` sucht das Share-Bild unter
`assets/img/share/news-<Klassensuffix>.jpg`, `build-share-images.py` legt es
unter dem Dateinamen des Hero-Bildes ab. Weichen beide voneinander ab, fällt
`og:image` still auf das Standardbild zurück.
