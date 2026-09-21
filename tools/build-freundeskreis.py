#!/usr/bin/env python3
"""Schreibt die Freundeskreis-Galerie statisch in partner/freundeskreis.html.

Warum: #freundeskreis-gallery wurde ausschliesslich per JavaScript aus
data/freundeskreis.json gefuellt -- kein einziger Name im ausgelieferten HTML.
Gleiche Luecke wie an den anderen Stellen der Seite, hier mit demselben Muster
behoben. Spiegelt das Inline-Skript in partner/freundeskreis.html; aendert
sich dort etwas, muss es hier mit.

Aufruf:
  python3 tools/build-freundeskreis.py
  python3 tools/build-freundeskreis.py --check
"""

import argparse
import json
import re
import sys

from seo_common import REPO, esc

ZIEL = REPO / "partner" / "freundeskreis.html"
DATEN = REPO / "data" / "freundeskreis.json"
CONTAINER = "freundeskreis-gallery"
FOTO_VERSION = "1785398309"

ICON_SRC = {
    "green": "/assets/icons/basketball-gruen.webp",
    "gold": "/assets/icons/basketball-gold.webp",
    "blue": "/assets/icons/basketball-blau.webp",
}

JS_ANKER = [
    "var slot = 1;",
    "'<div class=\"freundeskreis-star freundeskreis-star-' + colorClass + '",
]


def mitglied_html(m):
    stars = []
    slot = 1
    def add_star(color, label):
        nonlocal slot
        html = (f'<div class="freundeskreis-star freundeskreis-star-{color} freundeskreis-star-slot-{slot}" '
                f'data-tooltip="{esc(label)}" aria-label="{esc(label)}" tabindex="0">'
                f'<img loading="lazy" src="{ICON_SRC[color]}" alt="" width="14" height="14" /></div>')
        slot += 1
        return html
    stars.append(add_star("green", "Freundeskreis"))
    if m.get("sponsor"):
        stars.append(add_star("gold", "Sponsor"))
    if m.get("gesellschafter"):
        stars.append(add_star("blue", "Gesellschafter"))

    if m.get("foto"):
        avatar_inner = f'<img loading="lazy" class="freundeskreis-avatar-photo" src="{esc(m["foto"])}?v={FOTO_VERSION}" alt="" width="88" height="88" />'
    else:
        avatar_inner = esc(m["initialen"])
    has_photo = " has-photo" if m.get("foto") else ""

    return (
        '<div class="freundeskreis-card">'
        f'<div class="freundeskreis-avatar"><div class="freundeskreis-avatar-circle{has_photo}">{avatar_inner}</div>'
        f'{"".join(stars)}</div>'
        f'<p class="freundeskreis-card-name">{esc(m["vorname"])}</p></div>'
    )


def ersetze(text, container_id, inhalt):
    start, ende = f"<!--FREUNDESKREIS:{container_id}-->", f"<!--/FREUNDESKREIS:{container_id}-->"
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    js = ZIEL.read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("Inline-Skript in partner/freundeskreis.html hat sich geändert — "
                              "dieses Skript muss nachgezogen werden, bevor es wieder läuft.")

    mitglieder = json.loads(DATEN.read_text(encoding="utf-8")).get("mitglieder", [])
    inhalt = "".join(mitglied_html(m) for m in mitglieder)

    alt = js
    neu = ersetze(alt, CONTAINER, inhalt)

    if neu == alt:
        print(f"  unverändert, {len(mitglieder)} Mitglied(er)")
        return 0
    if args.check:
        print("  zu ändern: partner/freundeskreis.html")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben, {len(mitglieder)} Mitglied(er)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
