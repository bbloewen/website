# Build- und SEO-Skripte

Alle Skripte sind **wiederholbar** (ein zweiter Lauf ändert nichts) und kennen
`--check`: dann schreiben sie nichts, berichten nur und geben Exitcode 1 zurück,
wenn etwas zu tun wäre. Sie arbeiten ausschließlich auf **von Git verfolgten**
HTML-Dateien, damit lokale Arbeitsdateien nie versehentlich mitverarbeitet werden.

Gemeinsame Grundlage: `seo_common.py` — dort steht die *eine* Definition davon,
welche Seiten zählen und welche kanonische URL eine Datei hat. Sitemap und
Canonical dürfen nie auseinanderlaufen.

## Wann was laufen muss

| Was du geändert hast | Skript |
|---|---|
| Seite hinzugefügt oder gelöscht | `build-sitemap.py` |
| `partials/header.html` oder `footer.html` | `build-partials.py` |
| `<title>` oder `<meta name="description">` einer Seite | `build-head-meta.py` |
| `data/news.json` (Artikel ergänzt/geändert) | `build-news-list.py` |
| `data/freiplaetze.json` (Platz ergänzt/geändert) | `build-freiplaetze.py` |
| Neue Insta-Archivseite unter `news/insta-archiv/` | `build-instagram-archiv.py` |
| Neues Artikel-Hero in `assets/img/news/` | `build-share-images.py`, dann `build-head-meta.py` |
| `data/heimspiele.json` (Spieltermine) | `build-head-meta.py` |
| `data/freiplaetze.json` (Platz ergänzt, Koordinaten geändert) | `build-freiplatz-qr.py` |

Alles auf einmal, in dieser Reihenfolge:

```bash
python3 tools/build-partials.py && \
python3 tools/build-instagram-archiv.py && \
python3 tools/build-news-list.py && \
python3 tools/build-freiplaetze.py && \
python3 tools/build-share-images.py && \
python3 tools/build-head-meta.py && \
python3 tools/build-sitemap.py
```

`build-head-meta.py` zuletzt vor der Sitemap, weil es Titel und Description
ausliest und `og:`-Angaben daraus ableitet.

## Die Skripte im Einzelnen

**`build-sitemap.py`** — erzeugt `sitemap.xml` aus dem Git-Stand, mit `lastmod`
aus dem letzten Commit je Datei. Seiten mit `noindex` fallen automatisch raus.
Ersetzt die frühere Handpflege, die um 8 Seiten hinterherhing.

**`build-partials.py`** — baut Header und Footer aus `partials/` in jede Seite
ein. Notwendig, weil sie vorher nur per `js/include.js` im Browser nachgeladen
wurden: im ausgelieferten HTML stand dann kein einziger Navigationslink.
`include.js` lädt weiterhin nach, aber nur wenn der Platzhalter leer ist.

**`build-news-list.py`** — schreibt die Artikelliste statisch in
`news/aktuelles.html`. Das JavaScript rendert sie beim Laden weiterhin selbst und
überschreibt den statischen Stand mit identischer Ausgabe — die statische Fassung
ist nur für Crawler ohne JavaScript da und kann daher nicht falsch werden, nur
älter.

**`build-head-meta.py`** — pflegt Canonical, Open Graph, Twitter Cards und JSON-LD
in einem markierten Block vor `</head>`. `news/insta-archiv/` bleibt ausgespart,
diese Seiten gehören dem n8n-Workflow `GpAS0ONrenHrcTwS`.

**`build-share-images.py`** — erzeugt die Share-Bilder 1200×630 unter
`assets/img/share/`. Bewusst als **JPG**, nicht WebP: WhatsApp und mehrere
Vorschau-Renderer zeigen WebP-`og:image` unzuverlässig. Hochformat-Motive werden
oben angesetzt, sonst schneidet der Zuschnitt Köpfe ab.

**`build-freiplatz-qr.py`** — erzeugt beide QR-Sätze zu den Freiplätzen: den
Wegbeschreibungs-Code fürs Kachelbild (`assets/img/freiplaetze/qr-<slug>.svg`)
und den Court-Hunt-Code für den Aufkleber am Platz
(`assets/img/freiplaetze/hunt/qr-<slug>.svg`, Ziel `freiplatz.html?platz=<slug>`).
Mit `--aufkleber` kommt die A6-Druckvorlage dazu, mit `--event <slug>
--event-name "..."` ein A3-Schild für den mobilen Korb bei Straßenfesten.
Plätze mit eingeschränktem Zugang bekommen bewusst keinen Spiel-Code.

**`build-instagram-archiv.py`** — schreibt die Übersichtsliste statisch in
`news/instagram-archiv.html`. Quelle ist der Ordner `news/insta-archiv/` selbst,
nicht `data/instagram-loewen.json`/`data/instagram-loewenpark.json` — die
Feed-Dateien kennen nur die aktuellen Behold-Posts, während auf der Platte auch
längst aus dem Feed gefallene Archivseiten liegen. Titel und Datum liest das
Skript aus dem `<h1>` bzw. der Datumszeile jeder Archivseite; das Vorschaubild
ist `assets/img/insta/<Dateiname>.jpg`, wenn vorhanden, sonst das `og:image` der
Seite. Liest die Archivseiten nur — sie gehören weiterhin dem n8n-Workflow
`GpAS0ONrenHrcTwS`.

**`fix-insta-archiv-legacy.py`** — zieht Insta-Archivseiten nach, die aus dem
Behold-Feed gefallen sind. Der n8n-Workflow kennt nur die letzten 20 Posts je
Account und fasst ältere Seiten nie wieder an. Läuft nur bei Bedarf.

**`build-freiplaetze.py`** — schreibt die Freiplatz-Liste statisch in
`trainieren/freiplaetze.html`. Die sechs Plätze wurden vorher ausschließlich im
Browser aus `data/freiplaetze.json` gerendert; im ausgelieferten HTML stand kein
einziger Platzname und keine Adresse. Gleiche Bauart wie `build-news-list.py`:
Das JavaScript überschreibt den statischen Stand mit identischem Inhalt, die
statische Fassung ist nur für Crawler ohne JavaScript da. Bewusst ohne
Medienblock — Karten-iframes würden beim ersten Aufbau laden und Sekunden später
ersetzt, ohne für die Auffindbarkeit etwas beizutragen.
