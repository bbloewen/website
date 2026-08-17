#!/usr/bin/env python3
"""Baut Header und Footer beim Build in jede Seite ein.

Warum: Header und Footer wurden bisher ausschliesslich per js/include.js im
Browser nachgeladen. Im ausgelieferten HTML stand damit **kein einziger
Navigationslink** -- die Startseite hatte 17 interne Links, alle aus dem
Seiteninhalt. Ein Crawler ohne JavaScript sieht deshalb eine Sammlung
unverbundener Einzelseiten. Der Ahrefs-Crawl vom 17.08.2026 hat das bestaetigt:
40 von 90 URLs als "Orphan page (has no incoming internal links)", 13 als "Page
has no outgoing links", 2 Canonicals ohne eingehende Links -- also 55 der 47
Fehler und einiger Warnungen aus einer einzigen Ursache.

Google rendert JavaScript und findet die Links meist trotzdem, aber langsamer und
unzuverlaessiger, und die Verteilung der Linkkraft bleibt unsicher. Fuer eine
Seite, die gerade erst indexiert wird, ist das der groesste strukturelle Hebel.

partials/header.html und partials/footer.html bleiben die einzige Quelle. An der
Pflege aendert sich nichts: Partial bearbeiten, Skript laufen lassen.

js/include.js laedt die Partials weiterhin nach, aber nur wenn der Platzhalter
leer ist -- so bleibt eine noch nicht gebaute Seite funktionsfaehig und es wird
nichts doppelt eingefuegt.

Aufruf:
  python3 tools/build-partials.py
  python3 tools/build-partials.py --check
"""

import argparse
import re
import sys

from seo_common import REPO, tracked_html

PARTIALS = {
    "header": REPO / "partials" / "header.html",
    "footer": REPO / "partials" / "footer.html",
}


def block(name, inhalt):
    """Selbstbegrenzender Block, damit ein zweiter Lauf ihn eindeutig wiederfindet."""
    return (
        f'<div id="site-{name}-placeholder"><!--PARTIAL:{name}-->\n'
        f"{inhalt.rstrip()}\n"
        f"<!--/PARTIAL:{name}--></div>"
    )


def apply_partial(text, name, inhalt):
    neu = block(name, inhalt)
    # Schon gebaut? Dann den bestehenden Block ersetzen. Das END-Kommentar kommt
    # genau einmal vor, deshalb ist das non-greedy Muster eindeutig.
    gebaut = re.compile(
        rf'<div id="site-{name}-placeholder"><!--PARTIAL:{name}-->.*?<!--/PARTIAL:{name}--></div>',
        re.S,
    )
    if gebaut.search(text):
        return gebaut.sub(lambda _: neu, text, count=1)
    leer = f'<div id="site-{name}-placeholder"></div>'
    if leer in text:
        return text.replace(leer, neu, 1)
    return None  # Platzhalter fehlt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    inhalte = {n: p.read_text(encoding="utf-8") for n, p in PARTIALS.items()}
    geaendert, unveraendert, probleme = [], [], []

    for rel in tracked_html():
        pfad = REPO / rel
        alt = pfad.read_text(encoding="utf-8")
        neu = alt
        for name, inhalt in inhalte.items():
            ergebnis = apply_partial(neu, name, inhalt)
            if ergebnis is None:
                probleme.append(f"{rel}: Platzhalter site-{name}-placeholder fehlt")
                neu = None
                break
            neu = ergebnis
        if neu is None:
            continue
        if neu == alt:
            unveraendert.append(rel)
        else:
            geaendert.append(rel)
            if not args.check:
                pfad.write_text(neu, encoding="utf-8")

    for p in probleme:
        print(f"  ACHTUNG {p}", file=sys.stderr)
    print(f"  {len(geaendert)} Seiten {'zu bauen' if args.check else 'gebaut'}, "
          f"{len(unveraendert)} unveraendert, {len(probleme)} mit Problem")
    return 1 if (args.check and geaendert) else 0


if __name__ == "__main__":
    sys.exit(main())
