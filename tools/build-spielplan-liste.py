#!/usr/bin/env python3
"""Schreibt die 14 Heimspiele statisch in teams-saison/spielplan.html.

Anlass: Der Ahrefs-Crawl vom 25.08.2026 hat alle 14 Spieltagsseiten als
"Orphan page" gemeldet -- ohne einen einzigen eingehenden internen Link. Die
Adressen standen zwar im JSON-LD in der <head>, im Koerper der Seite aber nicht
ein einziges Mal als href: Die Spielplan-Liste entsteht erst im Browser in
js/spielplan.js (renderDayList schreibt in #spielplan-tage), und dort verlinkt
sie die Spieltagsseite nur ueber ein Icon.

Damit war der Spielplan fuer einen Menschen mit JavaScript ein Verzeichnis, fuer
Google eine leere Seite -- und die 14 Seiten hingen ohne Linkfluss in der
Sitemap. Es ist dasselbe Muster, das schon bei Navigation, News-Liste,
Freiplaetzen, Instagram-Archiv und Court-Hunt aufgeraeumt wurde: Inhalt, der nur
im JavaScript existiert.

Bewusst nur die Heimspiele, nicht der volle Spielplan: Auswaertsspiele und die
Termine von Damen und U19 zeigen auf keine eigene Seite, tragen also keinen Link
bei. Den vollen, filterbaren Plan baut weiterhin das JavaScript -- es ersetzt
den Inhalt von #spielplan-tage beim Laden komplett. Wer ohne JavaScript kommt,
sieht ab jetzt wenigstens die Heimspiele statt einer leeren Seite; vorher war da
nichts.

Die Markup-Struktur spiegelt gameRowHTML() aus js/spielplan.js, damit der
statische Stand nicht fuer den Moment vor dem Laden kaputt aussieht. Aendert
sich dort die Struktur, muss sie hier mitgezogen werden -- deshalb bleibt der
Block hier absichtlich schlank.

Aufruf:
  python3 tools/build-spielplan-liste.py
  python3 tools/build-spielplan-liste.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SEITE = REPO / "teams-saison" / "spielplan.html"
DATEN = REPO / "data" / "heimspiele.json"

START = "<!--SPIELPLAN:heimspiele-->"
ENDE = "<!--/SPIELPLAN:heimspiele-->"
BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(ENDE), re.S)

# Container, in den js/spielplan.js seine Liste schreibt.
CONTAINER = '<div id="spielplan-tage"></div>'

WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

# Gleiche Adresse wie RIETHSPORTHALLE_MAPS_URL in js/spielplan.js.
MAPS = ("https://www.google.com/maps/search/?api=1&amp;query="
        "Essener+Stra%C3%9Fe+20%2C+99089+Erfurt")


def esc(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def spiel_zeile(s):
    """Eine Heimspiel-Karte. Der Gegnername ist der Link -- als Ankertext ist er
    genau das, wonach gesucht wird, und deutlich mehr wert als ein Icon."""
    tag, monat, jahr = (int(t) for t in s["datum"].split("."))
    d = date(jahr, monat, tag)
    zeit = s.get("zeit") or ""
    datum_text = f"{WOCHENTAGE[(d.weekday() + 1) % 7]}, {s['datum']}"
    if zeit:
        datum_text += f", {zeit} Uhr"

    ziel = f"/teams-saison/spiel/{s['seiteSlug']}.html"
    paarung = f"Basketball Löwen – {s['gegner']}"

    return (
        '<div class="card fixture-day" data-teams="profis">'
        '<div class="fixture-day-game" data-team="profis" data-heim="1">'
        '<div class="fixture-day-meta">'
        f'<div class="fixture-time">{esc(datum_text)}</div>'
        f'<div class="fixture-venue-line"><a href="{MAPS}" target="_blank" rel="noopener">'
        '<i data-lucide="map-pin" style="width:14px;height:14px"></i> Riethsporthalle</a></div>'
        '<span class="venue-heim">Heimspiel</span>'
        '</div>'
        '<div class="fixture-mid">'
        '<a class="team-badge team-badge-profis" href="/teams-saison/profis.html">Pro B</a>'
        f'<div class="matchup"><a href="{esc(ziel)}">{esc(paarung)}</a></div>'
        '</div>'
        '<div class="fixture-day-actions">'
        '<div class="fixture-result-row">'
        f'<div class="fixture-result">{esc(s.get("ergebnis") or "– – : – –")}</div>'
        '</div>'
        f'<a class="btn btn-outline-orange btn-sm" href="{esc(ziel)}">Zum Spiel '
        '<i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>'
        '</div>'
        '</div>'
        '</div>'
    )


def block():
    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    spiele = [s for s in daten.get("spiele", []) if s.get("seiteSlug")]
    if not spiele:
        raise SystemExit("data/heimspiele.json: kein Spiel mit seiteSlug gefunden")
    spiele.sort(key=lambda s: tuple(reversed([int(t) for t in s["datum"].split(".")])))
    zeilen = "\n        ".join(spiel_zeile(s) for s in spiele)
    return START + "\n        " + zeilen + "\n      " + ENDE, len(spiele)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = p.parse_args()

    text = SEITE.read_text(encoding="utf-8")
    neu, anzahl = block()

    if BLOCK_RE.search(text):
        ziel = BLOCK_RE.sub(lambda _: neu, text)
    elif CONTAINER in text:
        ziel = text.replace(CONTAINER, f'<div id="spielplan-tage">{neu}</div>')
    else:
        raise SystemExit(
            "In teams-saison/spielplan.html fehlt weder Block noch "
            f'{CONTAINER} -- wurde die Seite umgebaut?'
        )

    if ziel == text:
        print(f"  unverändert, {anzahl} Heimspiele verlinkt")
        return 0
    if args.check:
        print(f"  zu ändern: {anzahl} Heimspiele")
        return 1
    SEITE.write_text(ziel, encoding="utf-8")
    print(f"  geschrieben, {anzahl} Heimspiele verlinkt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
