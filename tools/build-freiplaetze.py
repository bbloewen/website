#!/usr/bin/env python3
"""Schreibt die Freiplatz-Liste statisch in trainieren/freiplaetze.html.

Warum: Die sechs Freiplätze wurden ausschliesslich im Browser aus
data/freiplaetze.json in leere Container gerendert. Im ausgelieferten HTML stand
damit **kein einziger Platzname und keine einzige Adresse** -- fuer einen
Crawler ohne JavaScript war die Seite 210 Woerter Einleitung und sonst nichts.

Das ist ausgerechnet auf der Seite mit dem staerksten lokalen Inhalt, den wir
haben: sechs benannte, mit Adresse belegte oeffentliche Basketballplaetze in
Erfurt, die sonst niemand gesammelt anbietet. Genau dieser Text ist es, der auf
"basketballplatz erfurt", "streetball erfurt" oder "3x3 erfurt" einzahlt.

Gleiche Bauart wie build-news-list.py: Das JavaScript rendert die Kacheln beim
Laden weiterhin selbst und ueberschreibt den statischen Stand. Die statische
Fassung ist nur fuer Crawler ohne JavaScript da und kann deshalb nicht falsch
werden, nur aelter.

Bewusster Unterschied zur JS-Fassung: **ohne Medienblock**. Die Kacheln binden
Karten-iframes ein; statisch vorgerendert wuerden drei Google-Maps-iframes beim
ersten Aufbau laden, nur um Sekundenbruchteile spaeter vom JavaScript ersetzt zu
werden. Bilder tragen zur Auffindbarkeit hier nichts bei -- der Text tut es.

Aufruf:
  python3 tools/build-freiplaetze.py
  python3 tools/build-freiplaetze.py --check
"""

import argparse
import html
import json
import re
import sys

from seo_common import REPO

ZIEL = REPO / "trainieren" / "freiplaetze.html"
QUELLE = REPO / "data" / "freiplaetze.json"

# Zwei Container, zwei Bloecke: offene Plaetze und solche mit eingeschraenktem
# Zugang. Die Trennung stammt aus dem JavaScript (spielbar()) und wird hier
# nachgebaut, damit beide Fassungen dieselbe Reihenfolge zeigen.
CONTAINER = {
    "offen": '<div class="grid-2" id="freiplaetze-grid">',
    "weitere": '<div class="grid-2" id="freiplaetze-grid-weitere">',
}


def spielbar(f):
    return f.get("zugang") != "eingeschraenkt"


def maps_url(f):
    return f"https://www.google.com/maps/search/?api=1&query={f['lat']},{f['lng']}"


def platz_url(slug):
    return "/trainieren/freiplatz.html?platz=" + slug


def mit_links(text, links):
    """[Beschriftung] im Text zu Links aufloesen -- wie mitLinks() im JavaScript.

    Nur https-Ziele werden verlinkt, alles andere bleibt schlichter Text.
    """
    links = links or {}

    def ersetze(m):
        ziel = links.get(m.group(1), "")
        if not str(ziel).startswith("https://"):
            return html.escape(m.group(1))
        return (f'<a href="{html.escape(ziel)}" target="_blank" rel="noopener">'
                f"{html.escape(m.group(1))}</a>")

    return re.sub(r"\[([^\]]+)\]", ersetze, html.escape(text))


def kachel(f):
    e = html.escape
    teile = ['<div class="card freiplatz-card">']
    if not spielbar(f):
        teile.append(
            '<div class="freiplatz-zugang-banner"><i data-lucide="lock" class="icon-16"></i> '
            + e(f.get("zugangHinweis") or "Zugang eingeschränkt") + "</div>"
        )
    teile.append('<div class="card-body">')
    teile.append(f"<h3>{e(f['name'])}</h3>")
    teile.append(f"<p>{e(f.get('beschreibung', ''))}</p>")
    if not spielbar(f) and f.get("zugangDetail"):
        teile.append('<p class="freiplatz-zugang-detail">'
                     + mit_links(f["zugangDetail"], f.get("zugangLinks")) + "</p>")
    teile.append(
        f'<a class="freiplatz-adresse-link" href="{maps_url(f)}" target="_blank" rel="noopener">'
        f'<i data-lucide="map-pin" class="icon-16"></i> {e(f["adresse"])}</a>'
    )
    teile.append(
        f'<a class="card-link" href="{platz_url(f["slug"])}">'
        + ("Platz öffnen und einchecken" if spielbar(f) else "Platz ansehen")
        + ' <i data-lucide="arrow-right" class="icon-14"></i></a>'
    )
    teile.append("</div></div>")
    return "".join(teile)


def block(name, plaetze):
    start, ende = f"<!--FREIPLAETZE:{name}-->", f"<!--/FREIPLAETZE:{name}-->"
    karten = "\n".join("        " + kachel(f) for f in plaetze)
    inhalt = f"{start}\n{karten}\n      {ende}" if plaetze else f"{start}{ende}"
    return CONTAINER[name] + inhalt + "</div>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    plaetze = json.loads(QUELLE.read_text(encoding="utf-8")).get("freiplaetze", [])
    gruppen = {
        "offen": [f for f in plaetze if spielbar(f)],
        "weitere": [f for f in plaetze if not spielbar(f)],
    }

    alt = ZIEL.read_text(encoding="utf-8")
    neu = alt
    for name, gruppe in gruppen.items():
        neuer = block(name, gruppe)
        gebaut = re.compile(
            re.escape(CONTAINER[name]) + rf"<!--FREIPLAETZE:{name}-->.*?<!--/FREIPLAETZE:{name}--></div>",
            re.S,
        )
        if gebaut.search(neu):
            neu = gebaut.sub(lambda _: neuer, neu, count=1)
        elif CONTAINER[name] + "</div>" in neu:
            neu = neu.replace(CONTAINER[name] + "</div>", neuer, 1)
        else:
            print(f"  ACHTUNG Container {CONTAINER[name]} nicht gefunden", file=sys.stderr)
            return 1

    fehlend = [f["name"] for f in plaetze if html.escape(f["name"]) not in neu]
    if fehlend:
        print(f"  ACHTUNG {len(fehlend)} Plätze fehlen im Ergebnis: {fehlend}", file=sys.stderr)
        return 1

    if neu == alt:
        print(f"  unverändert, {len(plaetze)} Plätze verlinkt")
        return 0
    if args.check:
        print(f"  zu bauen: {len(plaetze)} Plätze")
        return 1

    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(gruppen['offen'])} offene + {len(gruppen['weitere'])} eingeschränkte Plätze")
    return 0


if __name__ == "__main__":
    sys.exit(main())
