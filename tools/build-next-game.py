#!/usr/bin/env python3
"""Schreibt das "Nächstes Heimspiel"-Widget im Startseiten-Hero statisch.

Warum: #next-game-card wurde ausschliesslich per JavaScript aus
data/heimspiele.json gefuellt (js/home-next-game.js). Im ausgelieferten HTML
stand nur ein Platzhalter-Eyebrow ("1. Heimspiel"), kein Gegner, kein Datum,
kein Ticket-Link -- auf der wichtigsten Seite der Domain. Gleiche Luecke wie
zuvor bei Event-Liste, Freiplaetzen, News, Partnerwand, Bildergalerien und
Fanshop, hier mit demselben Muster behoben.

Wie der Fix funktioniert: Die Slides werden hier gebaut und zwischen Markern
in die Seite geschrieben. js/home-next-game.js ersetzt den Inhalt beim Laden
weiterhin per innerHTML -- fuer Besucher aendert sich nichts, Klick-Dots
arbeiten unveraendert auf dem JS-Ergebnis. Spiegelt gameSlideHTML() dort;
aendert sich das Skript, muss es hier mit -- deshalb der Ankerpruef beim Start.

Aufruf:
  python3 tools/build-next-game.py
  python3 tools/build-next-game.py --check
"""

import argparse
import json
import re
import sys
from datetime import datetime

from seo_common import REPO, esc

ZIEL = REPO / "index.html"
DATEN = REPO / "data" / "heimspiele.json"
CONTAINER = "next-game-card"

MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
          "September", "Oktober", "November", "Dezember"]

JS_ANKER = [
    "'<span class=\"eyebrow\">' + (i + 1) + '. Heimspiel</span>' +",
    "'<a class=\"btn btn-primary btn-sm\" style=\"color:#fff\" href=\"/tickets/dauerkarte.html\">",
]


def slide_html(spiel, i):
    d = datetime.strptime(spiel["datum"], "%d.%m.%Y").date()
    date_str = f"{d.day}. {MONATE[d.month - 1]} {d.year}"
    return (
        f'<div class="next-game-slide{" is-active" if i == 0 else ""}">'
        f'<span class="eyebrow">{i + 1}. Heimspiel</span>'
        f'<h3 class="t-h4" style="margin:10px 0 6px">Basketball Löwen – {esc(spiel["gegner"])}</h3>'
        '<p class="t-body-sm" style="margin-bottom:16px;display:flex;flex-direction:column;gap:4px">'
        f'<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="calendar" style="width:14px;height:14px"></i>{date_str}, {esc(spiel["zeit"])} Uhr</span>'
        '<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="map-pin" style="width:14px;height:14px"></i>Riethsporthalle</span>'
        "</p>"
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'
        '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html"><i data-lucide="ticket" style="width:14px;height:14px"></i> Dauerkarte kaufen</a>'
        '<a class="btn btn-ghost btn-sm" href="/saison/spielplan.html">Zum Spielplan</a>'
        "</div></div>"
    )


def dot_html(spiel, i, gesamt):
    return (f'<button class="news-dot{" is-active" if i == 0 else ""}" data-slide-to="{i}" '
            f'aria-label="Heimspiel {i + 1} von {gesamt}: gegen {esc(spiel["gegner"])}"></button>')


def ersetze(text, container_id, inhalt):
    start, ende = f"<!--NEXTGAME:{container_id}-->", f"<!--/NEXTGAME:{container_id}-->"
    neu_block = f"{start}{inhalt}{ende}"
    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]
    muster = re.compile(r'(<div[^>]*\bid="' + re.escape(container_id) + r'"[^>]*>).*?(</div>)', re.S)
    m = muster.search(text)
    if not m:
        raise SystemExit(f"Container id={container_id} nicht gefunden")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    js = (REPO / "js" / "home-next-game.js").read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/home-next-game.js hat sich geändert — dieses Skript "
                              "muss nachgezogen werden, bevor es wieder läuft.")

    spiele = json.loads(DATEN.read_text(encoding="utf-8"))["spiele"]
    heute = datetime.now().date()
    kommende = sorted(
        (s for s in spiele if datetime.strptime(s["datum"], "%d.%m.%Y").date() >= heute),
        key=lambda s: datetime.strptime(s["datum"], "%d.%m.%Y").date(),
    )[:3]

    slides = "".join(slide_html(s, i) for i, s in enumerate(kommende))
    dots = ""
    if len(kommende) > 1:
        dots = '<div class="news-dots">' + "".join(dot_html(s, i, len(kommende)) for i, s in enumerate(kommende)) + "</div>"
    inhalt = f'<div class="next-game-slides">{slides}</div>{dots}' if kommende else ""

    alt = ZIEL.read_text(encoding="utf-8")
    neu = ersetze(alt, CONTAINER, inhalt)

    if neu == alt:
        print(f"  unverändert, {len(kommende)} Heimspiel(e) im Widget")
        return 0
    if args.check:
        print("  zu ändern: index.html")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(kommende)} Heimspiel(e) im Widget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
