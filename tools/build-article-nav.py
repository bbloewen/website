#!/usr/bin/env python3
"""Schreibt die Vorheriger/Nächster-Artikel-Pfeile statisch in jede News-Seite.

Warum: #article-nav-prev/#article-nav-next auf jeder Artikelseite wurden
ausschliesslich per JavaScript aus data/news.json gefuellt (js/article-nav.js)
-- im ausgelieferten HTML zwei leere <span>, kein interner Link zum
Nachbarartikel. Gleiche Luecke wie an den anderen Stellen der Seite, hier mit
demselben Muster behoben (wichtig fuers Crawling: interne Verlinkung zwischen
Artikeln hilft, neue Artikel schnell zu finden).

Anders als die anderen Build-Skripte hier: jede der ~16 Artikelseiten bekommt
ihren EIGENEN, individuellen Nachbarn (zirkulaer wie im Original -- am
neuesten Artikel zeigt "weiter" auf den aeltesten und umgekehrt), nicht
dieselbe Liste ueberall.

Aufruf:
  python3 tools/build-article-nav.py
  python3 tools/build-article-nav.py --check
"""

import argparse
import json
import re
import sys

from seo_common import REPO, esc, veroeffentlicht

DATEN = REPO / "data" / "news.json"

JS_ANKER = [
    "var newer = items.length > 1 ? items[(idx - 1 + items.length) % items.length] : null;",
    "'<a class=\"article-nav-arrow\" href=\"' + older.url + '\" aria-label=\"Vorheriger Artikel: ' + older.titel + '\">",
]


def arrow_html(direction, ziel):
    icon = "chevron-left" if direction == "prev" else "chevron-right"
    label = "Vorheriger" if direction == "prev" else "Nächster"
    return (f'<a class="article-nav-arrow" href="{esc(ziel["url"])}" aria-label="{label} Artikel: {esc(ziel["titel"])}">'
            f'<i data-lucide="{icon}" style="width:18px;height:18px"></i></a>')


def ersetze(text, container_id, inhalt):
    start, ende = f"<!--ARTICLENAV:{container_id}-->", f"<!--/ARTICLENAV:{container_id}-->"
    neu_block = f"{start}{inhalt}{ende}"
    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]
    muster = re.compile(r'(<span[^>]*\bid="' + re.escape(container_id) + r'"[^>]*>)\s*(</span>)')
    m = muster.search(text)
    if not m:
        raise SystemExit(f"Container id={container_id} nicht gefunden")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    js = (REPO / "js" / "article-nav.js").read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/article-nav.js hat sich geändert — dieses Skript "
                              "muss nachgezogen werden, bevor es wieder läuft.")

    artikel = json.loads(DATEN.read_text(encoding="utf-8"))["artikel"]
    items = sorted(artikel, key=veroeffentlicht, reverse=True)

    geschrieben = unveraendert = fehlend = 0
    for idx, a in enumerate(items):
        pfad = REPO / a["url"].lstrip("/")
        if not pfad.is_file():
            print(f"  ACHTUNG Artikel nicht gefunden: {a['url']}", file=sys.stderr)
            fehlend += 1
            continue
        if not pfad.read_text(encoding="utf-8").count('id="article-nav-prev"'):
            continue  # Seite hat (noch) keine Nav-Slots, z.B. Insta-Archiv-Duplikate

        older = items[(idx + 1) % len(items)] if len(items) > 1 else None
        newer = items[(idx - 1 + len(items)) % len(items)] if len(items) > 1 else None

        alt = pfad.read_text(encoding="utf-8")
        neu = ersetze(alt, "article-nav-prev", arrow_html("prev", older) if older else "")
        neu = ersetze(neu, "article-nav-next", arrow_html("next", newer) if newer else "")

        if neu == alt:
            unveraendert += 1
            continue
        if args.check:
            print(f"  zu ändern: {a['url']}")
            geschrieben += 1
            continue
        pfad.write_text(neu, encoding="utf-8")
        geschrieben += 1

    if args.check:
        return 1 if geschrieben else 0
    print(f"  {geschrieben} Seite(n) geschrieben, {unveraendert} unverändert" +
          (f", {fehlend} nicht gefunden" if fehlend else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
