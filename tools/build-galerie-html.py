#!/usr/bin/env python3
"""Schreibt die Bildergalerie-Streifen (js/camp-galerie.js) statisch in ihre Seiten.

Warum überhaupt:

Alle sechs Galerien (Feriencamps, LÖWENPARK, Netzwerktreffen, Fanclub,
Ehrenamt, Community-Events) wurden ausschließlich im Browser aus den
`data/*-galerie.json`-Dateien in einen leeren `.news-slider-track` gerendert.
Im ausgelieferten HTML stand damit kein einziges Foto, kein Alt-Text, kein
Event-Label -- dieselbe Lücke, die für die Event-Liste, die Freiplätze, die
News und die Partnerwand schon behoben wurde (s. deren Build-Skripte), hier
aber nie. Ein Crawler ohne JavaScript sah nur einen leeren Streifen.

Wie der Fix funktioniert:

Gleiche Bauart wie build-partner-wall.py: Die Kacheln werden hier gebaut und
zwischen Markern in die Seite geschrieben. Beim Laden ersetzt initCampGallery()
den Inhalt des Streifens per innerHTML sowieso komplett -- für Besucher ändert
sich also nichts, Slider/Lightbox/Event-Filter arbeiten unverändert auf dem
JS-Ergebnis. Ohne JavaScript bleibt jetzt ein lesbarer Foto-Streifen stehen
statt eines leeren Containers.

Das Kachel-Markup spiegelt den .map()-Block in initCampGallery() aus
js/camp-galerie.js. Ändert sich dort etwas, muss es hier mit -- deshalb prüft
das Skript beim Start, dass die JS-Funktion noch so aussieht wie erwartet, und
bricht sonst ab.

Aufruf:
  python3 tools/build-galerie-html.py
  python3 tools/build-galerie-html.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import REPO, esc

JS = REPO / "js" / "camp-galerie.js"

# Seite -> (Container-id, Galerie-Datei). Kein campSlug/showComingSoon nötig --
# keiner der sechs initCampGallery()-Aufrufe in den Seiten nutzt diese Parameter
# (geprüft per grep über alle *.html).
ZIELE = [
    ("trainieren/feriencamps.html", "camp-gallery-overview", "camp-galerie.json"),
    ("trainieren/loewenpark.html", "loewenpark-gallery", "loewenpark-galerie.json"),
    ("partner/netzwerktreffen.html", "netzwerktreffen-gallery", "netzwerktreffen-galerie.json"),
    ("fans/fanclub.html", "fanclub-gallery", "fanclub-galerie.json"),
    ("fans/ehrenamt.html", "ehrenamt-gallery", "ehrenamt-galerie.json"),
    ("fans/community-events.html", "community-events-gallery", "community-events-galerie.json"),
]

# Zusicherung gegen Drift: diese Zeilen müssen in js/camp-galerie.js stehen.
JS_ANKER = [
    "var klein = b.thumb || b.src;",
    'var event = b.event ? \'<span class="camp-gallery-event">\'',
    'return \'<div class="camp-gallery-photo" data-lightbox-src="\'',
]


def kachel(b):
    """Spiegelt den .map()-Block in initCampGallery() aus js/camp-galerie.js."""
    klein = b.get("thumb") or b["src"]
    event_attr = f' data-lightbox-event="{esc(b["event"])}"' if b.get("event") else ""
    event_span = f'<span class="camp-gallery-event">{esc(b["event"])}</span>' if b.get("event") else ""
    return (
        f'<div class="camp-gallery-photo" data-lightbox-src="{esc(b["src"])}" '
        f'data-lightbox-alt="{esc(b.get("alt", ""))}"{event_attr}>'
        f'<img src="{esc(klein)}" width="480" height="320" alt="{esc(b.get("alt", ""))}" loading="lazy" />'
        f'{event_span}</div>'
    )


def ersetze(text, container_id, inhalt):
    """Füllt den .news-slider-track innerhalb des Containers mit gegebener id.

    Zwei Fälle, bewusst getrennt (gleiche Logik wie build-partner-wall.py):
    Beim ersten Lauf ist der Track leer, dann wird zwischen die beiden Tags
    geschrieben. Danach stehen die Marker drin und nur noch der Bereich
    dazwischen wird getauscht.
    """
    start, ende = f"<!--GALERIE:{container_id}-->", f"<!--/GALERIE:{container_id}-->"
    neu_block = f"{start}\n{inhalt}\n        {ende}" if inhalt else f"{start}{ende}"

    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]

    id_pos = text.find(f'id="{container_id}"')
    if id_pos == -1:
        raise SystemExit(f"Container id={container_id} nicht gefunden")
    fenster_ende = id_pos + 2000
    m = re.compile(r'<div class="news-slider-track">\s*</div>').search(text, id_pos, fenster_ende)
    if not m:
        raise SystemExit(f"Container id={container_id}: news-slider-track ist weder leer noch "
                          "mit Markern versehen -- Seite von Hand umgebaut?")
    ersatz = f'<div class="news-slider-track">{neu_block}</div>'
    return text[:m.start()] + ersatz + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    js = JS.read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/camp-galerie.js hat sich geändert — kachel() in diesem "
                              "Skript muss nachgezogen werden, bevor es wieder läuft.")

    geschrieben = offen = unveraendert = 0
    for seite, container_id, datei in ZIELE:
        bilder = json.loads((REPO / "data" / datei).read_text(encoding="utf-8")).get("bilder", [])
        bilder = bilder[:50]
        html = "\n".join("        " + kachel(b) for b in bilder)

        pfad = REPO / seite
        alt_inhalt = pfad.read_text(encoding="utf-8")
        neu = ersetze(alt_inhalt, container_id, html)

        if neu == alt_inhalt:
            print(f"  unverändert: {seite} ({len(bilder)} Fotos)")
            unveraendert += 1
            continue
        if args.check:
            print(f"  zu ändern: {seite} ({len(bilder)} Fotos)")
            offen += 1
            continue
        pfad.write_text(neu, encoding="utf-8")
        print(f"  geschrieben: {seite} ({len(bilder)} Fotos)")
        geschrieben += 1

    if args.check:
        return 1 if offen else 0
    print(f"  {geschrieben} Seite(n) geschrieben, {unveraendert} unverändert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
