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
| `data/freiplaetze.json` (Platz ergänzt/geändert) | `build-freiplatz-seiten.py`, `build-freiplaetze.py` |
| Neue Insta-Archivseite unter `news/insta-archiv/` | `build-instagram-archiv.py` |
| Neues Artikel-Hero in `assets/img/news/` | `build-share-images.py`, dann `build-head-meta.py` |
| `data/heimspiele.json` (Spieltermine, neues Spiel, Vorverkauf gestartet) | `build-spieltagsseiten.py`, `build-spielplan-liste.py`, dann `build-head-meta.py` |
| `data/freiplaetze.json` (Platz ergänzt, Koordinaten geändert) | `build-freiplatz-qr.py` |

Alles auf einmal, in dieser Reihenfolge:

```bash
python3 tools/build-spieltagsseiten.py && \
python3 tools/build-partials.py && \
python3 tools/build-instagram-archiv.py && \
python3 tools/build-news-list.py && \
python3 tools/build-spielplan-liste.py && \
python3 tools/build-freiplatz-seiten.py && \
python3 tools/build-freiplaetze.py && \
python3 tools/build-share-images.py && \
python3 tools/build-head-meta.py && \
python3 tools/build-sitemap.py
```

`build-spieltagsseiten.py` zuerst, vor `build-partials.py`: es baut jede
Spieltagsseite komplett neu zusammen (die Phase kann sich geändert haben) und
übernimmt Header/Footer/SEO-Block dabei nur unverändert aus der bestehenden
Datei — bei einer neuen Seite sind diese Platzhalter also noch leer, und erst
der nachfolgende `build-partials.py`-/`build-head-meta.py`-Lauf füllt sie.
Andersherum (wie ursprünglich in einem Zwischenstand versucht) setzt jeder
Lauf von `build-spieltagsseiten.py` die von `build-partials.py` gerade erst
eingefügten Header/Footer wieder auf leer zurück.

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

**`build-spieltagsseiten.py`** — erzeugt/pflegt eine Seite je Heimspiel unter
`teams-saison/spiel/<seiteSlug>.html` (Marko, 25.08.2026: "eine Adresse für den
ganzen Lebenszyklus" — vorher Ankündigung, danach Ergebnis+Bericht, dieselbe
URL). Vier Phasen (angekündigt/vorverkauf/spieltag/danach) werden aus `datum`
und `ticketUrl` hergeleitet, nicht von Hand gepflegt. `seiteSlug` wird pro Spiel
nur einmalig erzeugt (Gegnername ohne Sponsorenpräfix + Datum) und danach nie
mehr angetastet, auch wenn sich die Schreibweise des Gegners ändert. Der
redaktionelle Bericht (`<!--BERICHT:auto-->`-Block) wird bei jedem Lauf aus der
bestehenden Datei ausgelesen und unverändert wieder eingesetzt — das Skript
überschreibt ihn nie. Der Ticketkauf (Saalplan/Kategorien/Kasse) ist direkt
eingebettet, dieselbe Komponente, die vorher in der nie verlinkten
`tickets/einzelticket.html` lief (gelöscht).

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

**`build-spielplan-liste.py`** — schreibt die 14 Heimspiele statisch in
`teams-saison/spielplan.html` **und** in `tickets.html`. Anlass war der Ahrefs-Crawl vom 25.08.2026: Alle
14 Spieltagsseiten galten als „Orphan page", weil ihre Adressen im Körper der
Seite nicht ein einziges Mal als `href` standen — nur im JSON-LD im `<head>`.
Die Liste entsteht sonst erst im Browser in `js/spielplan.js` (`renderDayList`
schreibt in `#spielplan-tage`), und dort hängt der Verweis auf die
Spieltagsseite an einem Icon. Bewusst nur die Heimspiele: Auswärtsspiele und die
Termine von Damen und U19 zeigen auf keine eigene Seite. Der Gegnername ist der
Ankertext, weil genau danach gesucht wird. Gleiche Bauart wie
`build-freiplaetze.py` — das JavaScript ersetzt den statischen Stand beim Laden
durch den vollen, filterbaren Plan.

In `tickets.html` steckt dasselbe Muster: Die Terminliste entsteht dort in einem
Inline-Skript, das `#heimspiele-liste` füllt, und der Tickets-Knopf ist bei 13
von 14 Spielen `disabled`, weil der Einzelticketverkauf noch nicht live ist —
selbst im Browser führte also nur ein Spiel auf seine Seite. Der statische Block
verlinkt dort immer die Spieltagsseite; ein toter Knopf wäre als Link nichts
wert.

Die Markup-Struktur spiegelt `gameRowHTML()` aus `js/spielplan.js` und die
`.ticket-row` aus dem Inline-Skript in `tickets.html`. Ändert sich eine der
beiden, muss sie hier mitgezogen werden.

**`build-freiplatz-seiten.py`** — erzeugt je Freiplatz eine eigene, indexierbare
Seite unter `trainieren/freiplatz/<slug>.html`. Vorher teilten sich alle sechs
Plätze die Adresse `trainieren/freiplatz.html?platz=<slug>`; die steht auf
`noindex`, weil eine Seite, deren ganzer Inhalt am Query-Parameter hängt, keine
sinnvolle einzelne Fassung für den Index hat. Folge war, dass kein einzelner
Platz auffindbar war.

Statisch stehen Überschrift, Beschreibung, Adresse, Foto und Zugangshinweis.
Karte und Check-in kommen weiter per JavaScript — `initPlatzseite()` in
`js/freiplaetze.js` erkennt eine statische Seite am Attribut `data-platz-slug`
und hängt beides in die vorhandenen Container, ohne den Inhalt zu überschreiben.

Die Hülle bleibt für die **Event-Spots** am mobilen Korb, die nur einen Tag
gelten. Ruft jemand sie mit dem Slug eines festen Platzes auf, leitet sie auf
dessen Seite weiter — damit bleiben schon gedruckte QR-Codes mit dem alten Ziel
gültig. `platzUrl()` in `js/freiplaetze.js`, `platz_url()` in
`build-freiplaetze.py` und `qr_saetze()` in `build-freiplatz-qr.py`
unterscheiden die beiden Fälle am Präfix `event-`; alle drei müssen zusammen
geändert werden.

Neue Platzseiten müssen zusätzlich von Hand in `data/search-index.json`
eingetragen werden — die Datei wird nicht generiert.

**Achtung Cache:** Die Verweise auf `js/` und `css/` tragen einen
Versionsparameter (`?v=1787678640`). Der wird von **keinem** Skript gestempelt.
Wer eine JavaScript- oder CSS-Datei ändert, muss ihn in allen Seiten, die sie
einbinden, mit hochziehen — sonst liefern Browser- und CDN-Cache weiter die alte
Datei, und die Änderung wirkt lokal, aber nicht live. Genau das ist am
25.08.2026 passiert: Die neuen Platzseiten zeigten live weder Karte noch
Check-in, weil `?v=` unverändert blieb, während lokal alles stimmte.

Hochziehen lässt sich der Parameter mit einem Einzeiler pro geänderter Datei —
Muster und Dateiname anpassen:

    python3 -c "
    import re, subprocess
    from pathlib import Path
    datei, muster = 'js/freiplaetze.js', r'(freiplaetze\.js\?v=)\d+'
    neu = str(int(Path(datei).stat().st_mtime))
    for f in subprocess.run(['git','ls-files','*.html'],capture_output=True,text=True).stdout.split():
        p = Path(f); t = p.read_text(encoding='utf-8')
        t2 = re.sub(muster, lambda m: m.group(1) + neu, t)
        if t2 != t: p.write_text(t2, encoding='utf-8')
    "
