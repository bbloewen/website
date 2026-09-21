#!/usr/bin/env python3
"""Schreibt das Newsletter-Archiv statisch in news/newsletter/index.html.

Warum: #newsletter-archiv-list wurde ausschliesslich per JavaScript aus
data/newsletter-archiv.json gefuellt. Ohne JavaScript blieb der Container leer
UND die "erste Ausgabe in Vorbereitung"-Meldung (#newsletter-archiv-empty)
unsichtbar (per class="hidden"), weil sie nur bei leerem Ergebnis per JS
eingeblendet wird -- ein Besucher ohne JS sah also buchstaeblich nichts.
Dieses Skript haelt beides synchron: Liste fuellen ODER die Leer-Meldung
sichtbar machen, je nachdem was aktuell stimmt.

Aufruf:
  python3 tools/build-newsletter-archiv.py
  python3 tools/build-newsletter-archiv.py --check
"""

import argparse
import json
import re
import sys

from seo_common import REPO, esc

ZIEL = REPO / "news" / "newsletter" / "index.html"
DATEN = REPO / "data" / "newsletter-archiv.json"
CONTAINER = "newsletter-archiv-list"
EMPTY_ID = "newsletter-archiv-empty"

JS_ANKER = [
    "'<a class=\"card hoverable\" href=\"' + a.url + '\" style=\"display:block;padding:20px;margin-bottom:14px\">' +",
]


def ausgabe_html(a):
    return (
        f'<a class="card hoverable" href="{esc(a["url"])}" style="display:block;padding:20px;margin-bottom:14px">'
        f'<span class="card-label">{esc(a["datum"])}</span>'
        f'<h3 style="font-size:18px">{esc(a["titel"])}</h3>'
        f'<p class="t-body-sm mt-1">{esc(a["teaser"])}</p></a>'
    )


def ersetze(text, container_id, inhalt):
    start, ende = f"<!--NEWSLETTER:{container_id}-->", f"<!--/NEWSLETTER:{container_id}-->"
    neu_block = f"{start}{inhalt}{ende}"
    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]
    muster = re.compile(r'(<div[^>]*\bid="' + re.escape(container_id) + r'"[^>]*>)\s*(</div>)')
    m = muster.search(text)
    if not m:
        raise SystemExit(f"Container id={container_id} nicht gefunden")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def setze_empty_sichtbar(text, sichtbar):
    """Schaltet die class="hidden" am Leer-Hinweis synchron zur Liste."""
    muster = re.compile(r'(<p class=")([^"]*)(" id="' + re.escape(EMPTY_ID) + r'")')
    m = muster.search(text)
    if not m:
        raise SystemExit(f"#{EMPTY_ID} nicht gefunden")
    klassen = [k for k in m.group(2).split() if k != "hidden"]
    if not sichtbar:
        klassen.append("hidden")
    neu_attr = m.group(1) + " ".join(klassen) + m.group(3)
    return text[:m.start()] + neu_attr + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    js = ZIEL.read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("Inline-Skript in news/newsletter/index.html hat sich geändert — "
                              "dieses Skript muss nachgezogen werden, bevor es wieder läuft.")

    ausgaben = json.loads(DATEN.read_text(encoding="utf-8")).get("ausgaben", [])
    inhalt = "".join(ausgabe_html(a) for a in ausgaben)

    alt = js
    neu = ersetze(alt, CONTAINER, inhalt)
    neu = setze_empty_sichtbar(neu, sichtbar=not ausgaben)

    if neu == alt:
        print(f"  unverändert, {len(ausgaben)} Ausgabe(n)")
        return 0
    if args.check:
        print("  zu ändern: news/newsletter/index.html")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben, {len(ausgaben)} Ausgabe(n)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
