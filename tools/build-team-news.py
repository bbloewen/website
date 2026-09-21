#!/usr/bin/env python3
"""Schreibt die "Aktuelles zu ..."-News-Feeds statisch in ihre Seiten.

Warum: [data-team-news="profis"] (saison/profis.html) und
[data-team-news-compact="baskidball"] (trainieren/baskidball.html) wurden
ausschliesslich per JavaScript aus data/news.json gefuellt (js/team-news.js).
Im ausgelieferten HTML stand auf beiden Seiten kein einziger Artikeltitel,
kein Link -- gleiche Luecke wie zuvor bei Event-Liste, Freiplaetzen, News,
Partnerwand, Bildergalerien, Fanshop und dem Heimspiel-Widget, hier mit
demselben Muster behoben.

Wie der Fix funktioniert: Die Karten werden hier gebaut und zwischen Markern
in die Seite geschrieben. js/team-news.js ersetzt den Inhalt beim Laden
weiterhin per innerHTML. Spiegelt pickForTeam() und die beiden Kartenformen
aus js/team-news.js; aendert sich das Skript, muss es hier mit.

Aufruf:
  python3 tools/build-team-news.py
  python3 tools/build-team-news.py --check
"""

import argparse
import json
import re
import sys

from seo_common import REPO, esc, veroeffentlicht

DATEN = REPO / "data" / "news.json"

# (Seite, Such-Attribut, team-Feld, Limit, Modus)
ZIELE = [
    ("saison/profis.html", 'data-team-news="profis"', "profis", 3, "cards"),
    ("trainieren/baskidball.html", 'data-team-news-compact="baskidball"', "baskidball", 3, "compact"),
]

JS_ANKER = [
    "var teamArtikel = artikel.filter(function (a) { return a.team === team; }).sort(byDateDesc);",
    "'<a class=\"insta-sidebar-item\" href=\"' + a.url + '\">' +",
]


def pick_for_team(artikel, team, limit):
    team_artikel = sorted((a for a in artikel if a.get("team") == team), key=veroeffentlicht, reverse=True)
    allgemein = sorted((a for a in artikel if not a.get("team")), key=veroeffentlicht, reverse=True)
    return (team_artikel + allgemein)[:limit]


def card_html(a):
    return (
        '<div class="card hoverable"><div class="card-body">'
        f'<span class="card-label">{esc(a["datum"])}</span>'
        f'<h3 style="font-size:17px">{esc(a["titel"])}</h3>'
        f'<p>{esc(a["kurztext"])}</p>'
        f'<a class="card-link" href="{esc(a["url"])}">weiterlesen <i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>'
        "</div></div>"
    )


def compact_html(a):
    img = f'<img src="{esc(a["bild"])}" alt="" loading="lazy" />' if a.get("bild") else ""
    return (
        f'<a class="insta-sidebar-item" href="{esc(a["url"])}">{img}'
        f'<span><strong style="display:block;font-weight:var(--weight-bold);color:var(--text-primary);margin-bottom:2px">{esc(a["titel"])}</strong>{esc(a["datum"])}</span></a>'
    )


def ersetze(text, marker_key, such_attr, inhalt):
    start, ende = f"<!--TEAMNEWS:{marker_key}-->", f"<!--/TEAMNEWS:{marker_key}-->"
    neu_block = f"{start}{inhalt}{ende}"
    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]
    muster = re.compile(r'(<div[^>]*\b' + re.escape(such_attr) + r'[^>]*>)\s*(</div>)')
    m = muster.search(text)
    if not m:
        raise SystemExit(f"Container [{such_attr}] nicht gefunden")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    js = (REPO / "js" / "team-news.js").read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/team-news.js hat sich geändert — dieses Skript "
                              "muss nachgezogen werden, bevor es wieder läuft.")

    artikel = json.loads(DATEN.read_text(encoding="utf-8"))["artikel"]

    geschrieben = unveraendert = 0
    for seite, such_attr, team, limit, modus in ZIELE:
        shown = pick_for_team(artikel, team, limit)
        render = card_html if modus == "cards" else compact_html
        inhalt = "".join(render(a) for a in shown)

        pfad = REPO / seite
        alt = pfad.read_text(encoding="utf-8")
        neu = ersetze(alt, f"{team}-{modus}", such_attr, inhalt)

        if neu == alt:
            print(f"  unverändert: {seite} ({len(shown)} Artikel)")
            unveraendert += 1
            continue
        if args.check:
            print(f"  zu ändern: {seite} ({len(shown)} Artikel)")
            geschrieben += 1
            continue
        pfad.write_text(neu, encoding="utf-8")
        print(f"  geschrieben: {seite} ({len(shown)} Artikel)")
        geschrieben += 1

    if args.check:
        return 1 if geschrieben else 0
    print(f"  {geschrieben} Seite(n) geschrieben, {unveraendert} unverändert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
