#!/usr/bin/env python3
"""Schreibt die Top-News-Kacheln statisch in die Startseite.

Warum:

Das News-Bento auf `index.html` entsteht komplett per JavaScript
(`js/home-news-feed.js`) aus drei Quellen: unseren Artikeln (`data/news.json`,
nur `topNews`) und den beiden Instagram-Feeds. Im ausgelieferten HTML stand
deshalb **keine einzige Schlagzeile und kein Link auf einen News-Artikel** — die
stärkste Seite der Website verlinkte die Artikel nicht. Jeder Artikel hatte
genau einen internen Link, den von `news/aktuelles.html`.

Was hier geschrieben wird und was nicht:

Nur die eigenen Artikel mit `topNews: true`. Die Instagram-Kacheln bleiben
absichtlich JS-only: ihre Inhalte wechseln täglich über n8n/Behold, ein
statischer Abzug wäre nach einem Tag falsch, und ihre Zielseiten
(`news/insta-archiv/`) sind über `news/instagram-archiv.html` ohnehin verlinkt
und in der Sitemap.

Geschrieben wird in den Desktop-Track. Beim Laden ersetzt `home-news-feed.js`
dessen `innerHTML` komplett und mischt dann alle drei Quellen — für Besucher
ändert sich nichts. Der Mobile-Track bleibt leer: dieselben Links ein zweites
Mal im HTML brächten für Suchmaschinen keinen Gewinn, und ohne JavaScript
genügt eine Fassung.

Das Kachel-Markup spiegelt `tileHtml()` aus js/home-news-feed.js; ändert sich
dort etwas, muss es hier mit. Das Skript prüft das beim Start.

Aufruf:
  python3 tools/build-home-news.py
  python3 tools/build-home-news.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

from seo_common import bild_masse, esc

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "news.json"
FEED_JS = REPO / "js" / "home-news-feed.js"
ZIEL = REPO / "index.html"
CONTAINER = "news-slider-track-desktop"
START = f"<!--NEWS:{CONTAINER}-->"
ENDE = f"<!--/NEWS:{CONTAINER}-->"

# Wie viele Artikel das JS fest für News reserviert (takeMax(newsItems, 3)).
ANZAHL = 3
# Rollen-Klassen der Desktop-Kacheln, aus desktopRoles in home-news-feed.js.
ROLLEN = ["news-tile-featured", "news-tile-side", "news-tile-small",
          "news-tile-small", "news-tile-small"]

JS_ANKER = [
    "var desktopRoles = ['news-tile-featured', 'news-tile-side', 'news-tile-small'",
    "'<div class=\"news-tile-overlay\">' +",
    "takeMax(newsItems, 3)",
]


def datum(s):
    tag, monat, jahr = (int(x) for x in s.split("."))
    return date(jahr, monat, tag)


def kachel(a, rolle):
    """Spiegelt tileHtml() aus js/home-news-feed.js für item.external = false."""
    klasse = "news-tile" + (f" {rolle}" if rolle else "")
    label = f'{esc(a["datum"])} · Weiterlesen' if a.get("datum") else "Weiterlesen"
    return (
        f'<a class="{klasse}" href="{esc(a["url"])}">'
        f'<img src="{esc(a.get("bild") or "")}"{bild_masse(a.get("bild") or "")} alt="" '
        "onerror=\"this.onerror=null;this.src='/assets/img/share/og-default.jpg'\" />"
        '<div class="news-tile-overlay">'
        f'<h3 class="news-tile-headline">{esc(a["titel"])}</h3>'
        f'<p class="news-tile-teaser">{esc(a.get("kurztext") or "")}</p>'
        f'<span class="news-tile-link">{label} '
        '<i data-lucide="arrow-right" style="width:14px;height:14px"></i></span>'
        "</div></a>"
    )


def block(artikel):
    kacheln = "".join(kachel(a, ROLLEN[i] if i < len(ROLLEN) else None)
                      for i, a in enumerate(artikel))
    return f'        <div class="news-bento">{kacheln}</div>'


def einbauen(text, inhalt):
    neu = f"{START}\n{inhalt}\n{ENDE}"
    if START in text and ENDE in text:
        a, b = text.index(START), text.index(ENDE) + len(ENDE)
        return text[:a] + neu + text[b:]
    leer = re.compile(r'(<div[^>]*\bid="' + re.escape(CONTAINER) + r'"[^>]*>)\s*(</div>)')
    m = leer.search(text)
    if not m:
        raise SystemExit(f"Container id={CONTAINER} nicht leer und ohne Marker — "
                         "Startseite von Hand umgebaut?")
    return text[:m.start()] + m.group(1) + neu + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    js = FEED_JS.read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/home-news-feed.js hat sich geändert — kachel() in "
                             "diesem Skript muss nachgezogen werden.")

    artikel = [a for a in json.loads(DATEN.read_text(encoding="utf-8"))["artikel"]
               if a.get("topNews")]
    artikel.sort(key=lambda a: datum(a["datum"]), reverse=True)
    artikel = artikel[:ANZAHL]
    if not artikel:
        raise SystemExit("data/news.json: kein Artikel mit topNews")

    alt = ZIEL.read_text(encoding="utf-8")
    neu = einbauen(alt, block(artikel))
    titel = ", ".join(a["titel"][:28] for a in artikel)

    if neu == alt:
        print(f"  unverändert ({len(artikel)} Artikel)")
        return 0
    if args.check:
        print(f"  zu ändern ({len(artikel)} Artikel)")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben ({len(artikel)} Artikel: {titel})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
