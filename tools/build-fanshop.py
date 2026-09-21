#!/usr/bin/env python3
"""Schreibt die Fanshop-Kacheln statisch in fanshop.html.

Warum:

Sowohl die Gutschein-Betragsreihe (#fanshop-giftcard-rows) als auch die
Partner-Teaser (#fanshop-products, 10 Kacheln zu Kaffee, Accessoires,
Fortyoneunit und den Erfurt-Mitte-Kategorien) wurden ausschliesslich per
JavaScript aus data/fanshop.json gefuellt. Im ausgelieferten HTML stand damit
kein einziger Partnername, kein Produktlink -- ein Crawler ohne JavaScript sah
zwei leere Container. Dieselbe Luecke wie zuvor bei Event-Liste, Freiplaetzen,
News, Partnerwand und den Bildergalerien, hier mit demselben Muster behoben.

Wie der Fix funktioniert:

Die Kacheln werden hier gebaut und zwischen Markern in die Seite geschrieben.
Beim Laden ersetzt das Inline-Skript der Seite den Inhalt beider Container per
innerHTML sowieso komplett -- fuer Besucher aendert sich nichts, Warenkorb und
Klick-Tracking arbeiten unveraendert auf dem JS-Ergebnis. Ohne JavaScript
bleiben jetzt lesbare Kacheln stehen statt leerer Container.

Das Kachel-Markup spiegelt teaserHTML()/die Gutschein-Zeile aus dem Inline-
Skript in fanshop.html. Aendert sich dort etwas, muss es hier mit -- deshalb
prueft das Skript beim Start, dass das Skript noch so aussieht wie erwartet,
und bricht sonst ab.

Aufruf:
  python3 tools/build-fanshop.py
  python3 tools/build-fanshop.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import REPO, bild_masse, esc

ZIEL = REPO / "fanshop.html"
DATEN = REPO / "data" / "fanshop.json"

# Zusicherung gegen Drift: diese Zeilen muessen im Inline-Skript stehen.
JS_ANKER = [
    "if (!t.soldOut) return '';",
    "return '<div class=\"ribbon-corner\"><span class=\"card-media-ribbon fanshop-teaser-stamp-soldout\">Ausverkauft</span></div>';",
    "if (t.kind === 'category') {",
    "return '<div class=\"fanshop-giftcard-amount-row\"><strong>' + formatMoney(p.price) + '</strong>' +",
]


def with_utm(url, content):
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}utm_source=basketball-loewen&utm_medium=referral&utm_campaign=fanshop&utm_content={content}"


def stamp_html(t):
    if not t.get("soldOut"):
        return ""
    return '<div class="ribbon-corner"><span class="card-media-ribbon fanshop-teaser-stamp-soldout">Ausverkauft</span></div>'


def teaser_html(t):
    """Spiegelt teaserHTML() aus dem Inline-Skript in fanshop.html."""
    img = (f'<div class="fanshop-product-img fanshop-teaser-img"><img loading="lazy" src="{esc(t["image"])}"'
           f'{bild_masse(t["image"])} alt="{esc(t["name"])}" />{stamp_html(t)}</div>')
    shop = f'<span class="fanshop-teaser-shop">Zum Shop von {esc(t["shopName"])} <i data-lucide="arrow-up-right" class="icon-14"></i></span>'
    if t["kind"] == "category":
        hero_url = esc(with_utm(t["url"], t["utm"]))
        more_url = esc(with_utm(t["moreUrl"], t["utm"] + "-weitere"))
        return (
            '<div class="card fanshop-product fanshop-teaser">'
            f'<a class="fanshop-teaser-hero" href="{hero_url}" target="_blank" rel="noopener" data-track="{esc(t["track"])}">'
            f'{img}<h4>{esc(t["name"])}</h4>{shop}</a>'
            f'<a class="fanshop-teaser-more" href="{more_url}" target="_blank" rel="noopener" data-track="{esc(t["track"])}-weitere">'
            f'{esc(t["moreLabel"])} <i data-lucide="arrow-right" class="icon-12"></i></a>'
            "</div>"
        )
    url = esc(with_utm(t["url"], t["utm"]))
    return (f'<a class="card fanshop-product fanshop-teaser" href="{url}" target="_blank" rel="noopener" '
            f'data-track="{esc(t["track"])}">{img}<h4>{esc(t["name"])}</h4>{shop}</a>')


def giftcard_row_html(p):
    """Spiegelt die Gutschein-Zeile aus dem Inline-Skript in fanshop.html."""
    preis = f'{p["price"]:.2f}'.replace(".", ",") + " €"
    return (
        f'<div class="fanshop-giftcard-amount-row"><strong>{preis}</strong>'
        f'<button type="button" class="btn btn-sm btn-outline-orange giftcard-toggle-btn" '
        f'data-product="{esc(p["id"])}" aria-pressed="false"><i data-lucide="plus" class="icon-16"></i>Hinzufügen</button></div>'
    )


def ersetze(text, container_id, inhalt):
    """Fuellt genau den einen Container (gleiche Logik wie build-partner-wall.py)."""
    start, ende = f"<!--FANSHOP:{container_id}-->", f"<!--/FANSHOP:{container_id}-->"
    neu_block = f"{start}\n{inhalt}\n        {ende}" if inhalt else f"{start}{ende}"

    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]

    muster = re.compile(r'(<div[^>]*\bid="' + re.escape(container_id) + r'"[^>]*>)\s*(</div>)')
    m = muster.search(text)
    if not m:
        raise SystemExit(f"Container id={container_id} ist weder leer noch mit Markern "
                         "versehen -- Seite von Hand umgebaut?")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    js = ZIEL.read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("Inline-Skript in fanshop.html hat sich geändert — dieses Skript "
                              "muss nachgezogen werden, bevor es wieder läuft.")

    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    teaser_html_block = "\n".join("        " + teaser_html(t) for t in daten.get("teasers", []))
    giftcard_html_block = "\n".join("        " + giftcard_row_html(p) for p in daten.get("gutscheine", []))

    alt = js
    neu = ersetze(alt, "fanshop-products", teaser_html_block)
    neu = ersetze(neu, "fanshop-giftcard-rows", giftcard_html_block)

    if neu == alt:
        print(f"  unverändert, {len(daten.get('teasers', []))} Teaser + {len(daten.get('gutscheine', []))} Gutscheine")
        return 0
    if args.check:
        print("  zu ändern: fanshop.html")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(daten.get('teasers', []))} Teaser + {len(daten.get('gutscheine', []))} Gutscheine")
    return 0


if __name__ == "__main__":
    sys.exit(main())
