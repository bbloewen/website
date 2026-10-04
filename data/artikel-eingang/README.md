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
| `bild` | ja | Dateiname unter `assets/img/news/`, muss vorher committet sein |
| `markdown` | ja | Fließtext: `##` Zwischenüberschrift, `>` Zitat, `-` Liste, `[Text](URL)`, `**fett**` |
| `spiel` | — | `{"datum": "04.10.2026", "feld": "spielberichtUrl"}` — verlinkt den Artikel beim Spiel im Spielplan und im Startseiten-Widget |

Das Feld `bild` bestimmt die Hero-CSS-Klasse (`hero-news-<Dateiname ohne
Endung>`) und darüber auch den Namen des Share-Bildes. Das ist kein Zufall,
sondern notwendig: `build-head-meta.py` sucht das Share-Bild unter
`assets/img/share/news-<Klassensuffix>.jpg`, `build-share-images.py` legt es
unter dem Dateinamen des Hero-Bildes ab. Weichen beide voneinander ab, fällt
`og:image` still auf das Standardbild zurück.
