# Artikel-Eingang

Hier legt der n8n-Workflow **„Website: News-Artikel aus Notion veröffentlichen"**
je Artikel eine Auftragsdatei ab. Der GitHub-Workflow
`.github/workflows/news-veroeffentlichen.yml` baut daraus mit
`tools/artikel-veroeffentlichen.py` die fertige Seite.

**Nicht von Hand pflegen** — Quelle ist die Notion-Datenbank „Inhalte-Kalender"
unter 🗓️ Mediaplanung. Was hier liegt, wird bei jedem Lauf erneut verarbeitet;
das Skript ist idempotent.

## Die Status-Kette in Notion

| Status | wer setzt ihn | was passiert |
|---|---|---|
| Geplant / In Arbeit / Entwurf | Mensch | nichts, die Automatik schaut weg |
| **Bereit zur Prüfung** | Mensch | n8n überarbeitet den Text und legt hier einen Auftrag mit `"status": "pruefung"` ab |
| **Bereit zur Veröffentlichung** | Automatik | der Entwurf steht im Web (noindex, unverlinkt), die URL steht im Feld `Link` |
| **Freigegeben** | Mensch | n8n setzt `"status": "freigegeben"`, der Artikel wird verlinkt und indexierbar |
| **Veröffentlicht** | Automatik | fertig |

Die Überarbeitung in Schritt 2 betrifft Form und Aufbau — Zwischenüberschriften,
Absatzlängen, Kurzfassung, Typografie. Sie darf keine Fakten hinzufügen; dafür
gibt es die Prüfstufe.

Dateiname: `<notionId>.json`

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
| `quellbild` | — | Pfad des Originals unter `data/artikel-eingang/bilder/` (JPG, PNG oder WebP). Das Skript wandelt es nach `bild` um (Breite höchstens 2400 px, Qualität 82) und **löscht das Original danach**. Fehlt das Feld, muss `bild` schon unter `assets/img/news/` liegen. |
| `markdown` | ja | Fließtext: `##` Zwischenüberschrift, `>` Zitat, `-` Liste, `[Text](URL)`, `**fett**` |
| `spiel` | — | `{"datum": "04.10.2026", "feld": "spielberichtUrl"}` — verlinkt den Artikel beim Spiel im Spielplan und im Startseiten-Widget |

## So muss die Notion-Seite aussehen

Der n8n-Workflow liest den Seiteninhalt als Markdown und zerlegt ihn nach festen
Regeln. Was nicht passt, wird nicht geraten: der Artikel geht zurück auf
**Entwurf**, und unter dem Seitentext steht ein Absatz „Automatik: …" mit dem
Grund.

| Im Text | wird zu |
|---|---|
| `## Artikel` als Überschrift | alles **davor** (Hinweisboxen, Notizen) wird ignoriert; fehlt sie, zählt die ganze Seite |
| `**Überschrift:** …` | H1 der Seite (ohne diese Zeile: Titel mit Punkt) |
| `**Lead:** …` | Vorspann unter der H1 — **Pflicht** |
| `Meta-Description: …` (irgendwo, auch in einer Box) | Beschreibung für Suchmaschinen und Teilen; ohne: die ersten 155 Zeichen des Leads |
| Box mit „Das Wichtigste in Kürze" und `- `-Punkten | Kurzfassung oben auf der Seite |
| `###` oder `##` | Zwischenüberschrift |
| `>` | Zitat |
| `[Text](URL)` | Link (eigene Adressen relativ, fremde mit neuem Tab) |
| alle anderen Boxen | ignoriert |

Weitere Pflichtangaben stehen in den **Eigenschaften** der Zeile: `Termin`
(= Veröffentlichungsdatum, steht im Dateinamen), `Team`, `Titel`; optional
`Top-News`. Typografie gleicht das Skript an: gerade und deutsche
Anführungszeichen, `–` und `-` als Gedankenstrich `—`.

**Bild:** in Drive als `News_<JJJJ-MM-TT>_<Kurzname>.<jpg|png|webp>` ablegen,
mit **demselben Datum wie `Termin`**. Aus dem Kurzname wird die Adresse der
Seite (`News_2026-09-21_Saisonstart-Neunte-Saison.jpg` → `…/2026-09-21_profis_saisonstart-neunte-saison.html`).
Liegen mehrere Dateien mit demselben Datum, bricht die Automatik ab und sagt
welche.

**Vorberichte und Spielberichte** zu **Auswärtsspielen** verlinkt die
Automatik auch im Spielplan und im Startseiten-Widget, wenn der Kurzname mit
`vorbericht` bzw. `spielbericht` beginnt, das Team „Profis" ist und `Termin`
auf den Spieltag fällt. Bei Heimspielen gibt es einen Hinweis statt einer
Verlinkung — die haben ihre eigene Spieltagsseite.

**Neu bauen:** Wer nach der Prüfung noch am Text ändern will, leert das Feld
`Link` und setzt den Status erneut auf „Bereit zur Prüfung".

Das Feld `bild` bestimmt die Hero-CSS-Klasse (`hero-news-<Dateiname ohne
Endung>`) und darüber auch den Namen des Share-Bildes. Das ist kein Zufall,
sondern notwendig: `build-head-meta.py` sucht das Share-Bild unter
`assets/img/share/news-<Klassensuffix>.jpg`, `build-share-images.py` legt es
unter dem Dateinamen des Hero-Bildes ab. Weichen beide voneinander ab, fällt
`og:image` still auf das Standardbild zurück.
