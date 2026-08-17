#!/usr/bin/env python3
"""Schreibt die News-Artikel-Liste statisch in news/aktuelles.html.

Warum: die Liste wurde ausschliesslich im Browser aus data/news.json aufgebaut.
Im ausgelieferten HTML stand damit **kein einziger** Link auf /news/artikel/ --
der Ahrefs-Crawl vom 17.08.2026 meldete die 13 Artikel deshalb als "Orphan page
(has no incoming internal links)". Zusammen mit den 18 Insta-Archivseiten waren
das genau die 31 verbliebenen Orphan-Meldungen, nachdem der Build-Schritt fuer
Header und Footer die uebrigen 9 beseitigt hatte.

Bewusst ohne Aenderung am JavaScript: das Skript in aktuelles.html rendert die
Liste beim Laden weiterhin selbst und ueberschreibt den statischen Stand mit
identischer Ausgabe. Damit ist die Seite fuer Besucher immer aktuell, auch wenn
jemand data/news.json aendert, ohne dieses Skript laufen zu lassen -- die
statische Fassung ist nur fuer Crawler ohne JavaScript da und kann nicht
"falsch" werden, nur aelter.

Reihenfolge und Markup sind bewusst identisch zur JS-Ausgabe in
news/aktuelles.html, damit es beim Laden nicht sichtbar umspringt.

Aufruf:
  python3 tools/build-news-list.py
  python3 tools/build-news-list.py --check
"""

import argparse
import html
import json
import re
import sys

from seo_common import REPO

ZIEL = REPO / "news" / "aktuelles.html"
QUELLE = REPO / "data" / "news.json"
CONTAINER = '<div class="grid-2" id="news-grid">'
START = "<!--NEWS:auto-->"
END = "<!--/NEWS:auto-->"


def sortdatum(artikel):
    """Deutsches Datum TT.MM.JJJJ sortierbar machen (wie parseGermanDate im JS)."""
    teile = (artikel.get("datum") or "").split(".")
    if len(teile) != 3:
        return (0, 0, 0)
    return (int(teile[2]), int(teile[1]), int(teile[0]))


def karte(a):
    label = f"{a['datum']} · {a['kategorie']}" if a.get("datum") else a.get("kategorie", "")
    return (
        f'<a class="card hoverable" href="{a["url"]}" style="text-decoration:none;color:inherit">'
        f'<div class="card-media-photo"><img loading="lazy" src="{a["bild"]}" alt="" /></div>'
        f'<div class="card-body">'
        f'<span class="card-label">{html.escape(label)}</span>'
        f'<h3 style="font-size:18px">{html.escape(a["titel"])}</h3>'
        f'<p>{html.escape(a.get("kurztext", ""))}</p>'
        f'<span class="card-link">weiterlesen <i data-lucide="arrow-right" class="icon-14"></i></span>'
        f"</div></a>"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    artikel = json.loads(QUELLE.read_text(encoding="utf-8")).get("artikel", [])
    artikel = sorted(artikel, key=sortdatum, reverse=True)
    karten = "\n".join("            " + karte(a) for a in artikel)
    block = f"{CONTAINER}{START}\n{karten}\n            {END}</div>"

    alt = ZIEL.read_text(encoding="utf-8")
    gebaut = re.compile(re.escape(CONTAINER) + re.escape(START) + r".*?" + re.escape(END) + r"</div>", re.S)
    if gebaut.search(alt):
        neu = gebaut.sub(lambda _: block, alt, count=1)
    elif CONTAINER + "</div>" in alt:
        neu = alt.replace(CONTAINER + "</div>", block, 1)
    else:
        print(f"  ACHTUNG Container {CONTAINER} in {ZIEL.name} nicht gefunden", file=sys.stderr)
        return 1

    fehlend = [a["url"] for a in artikel if a["url"] not in neu]
    if fehlend:
        print(f"  ACHTUNG {len(fehlend)} Artikel-URLs fehlen im Ergebnis", file=sys.stderr)

    if neu == alt:
        print(f"  unverändert, {len(artikel)} Artikel verlinkt")
        return 0

    if args.check:
        print(f"  zu bauen: {len(artikel)} Artikel")
        return 1

    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(artikel)} Artikel verlinkt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
