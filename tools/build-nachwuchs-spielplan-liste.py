#!/usr/bin/env python3
"""Schreibt den Spielplan-Slider statisch in saison/nachwuchs.html.

Warum: js/nachwuchs-spielplan.js rendert die Spiel-Kacheln ausschliesslich im
Browser aus data/nachwuchs-spielplan.json in einen leeren Container
(<div class="news-slider-track">). Im ausgelieferten HTML stand damit keine
einzige Begegnung, kein Datum, kein Ergebnis -- fuer einen Crawler ohne
JavaScript war der Abschnitt leer. Gleiche Bauart wie build-community-
events.py / build-freiplaetze.py: das JavaScript rendert beim Laden weiterhin
selbst und ueberschreibt den statischen Stand (u.a. fuer den Sprung zum
naechsten Spiel) -- die statische Fassung ist nur fuer Crawler ohne
JavaScript da und kann deshalb nicht falsch werden, nur aelter.

Aufruf:
  python3 tools/build-nachwuchs-spielplan-liste.py
  python3 tools/build-nachwuchs-spielplan-liste.py --check
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import REPO, esc

ZIEL = REPO / "saison" / "nachwuchs.html"
QUELLE = REPO / "data" / "nachwuchs-spielplan.json"
START = "<!--SPIELPLAN:games-->"
ENDE = "<!--/SPIELPLAN:games-->"

# Gleiche Zuordnung wie TEAM_LABEL/UNSER_NAME in js/nachwuchs-spielplan.js.
TEAM_LABEL = {
    "U12m/1": "MDL U12", "U13m": "MDL U13", "U14m": "MDL U14",
    "U15m": "MDL U15", "U17m": "MDL U17",
}
UNSER_NAME = {
    "U12m/1": "Basketball Löwen", "U13m": "Basketball Löwen", "U14m": "Basketball Löwen",
    "U15m": "Basketball Löwen", "U17m": "BIG Gotha",
}
WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]


def datum_kurz(iso):
    jahr, monat, tag = (int(x) for x in iso.split("-"))
    return f"{tag}. {MONATE_KURZ[monat - 1]}"


def karte_html(spiel, team_key):
    team_label = TEAM_LABEL.get(team_key, team_key)
    unser_name = UNSER_NAME.get(team_key, "Basketball Löwen")
    gegner = spiel["gegner"]
    matchup = f"{esc(unser_name)} – {esc(gegner)}" if spiel["heim"] else f"{esc(gegner)} – {esc(unser_name)}"
    if spiel.get("abgesagt"):
        untenzeile = '<div class="fixture-result-row" style="margin-top:8px"><div class="fixture-result" style="font-size:11px">abgesagt</div></div>'
        zeit_html = "Abgesagt"
    elif spiel.get("ergebnis"):
        untenzeile = f'<div class="fixture-result-row" style="margin-top:8px"><div class="fixture-result">{esc(spiel["ergebnis"])}</div></div>'
        zeit_html = f'{datum_kurz(spiel["datum"])}, {esc(spiel.get("zeit") or "")} Uhr'
    else:
        untenzeile = ""
        zeit_html = f'{datum_kurz(spiel["datum"])}, {esc(spiel.get("zeit") or "")} Uhr'
    return (
        f'<div class="card hoverable camp-slider-card" data-datum="{esc(spiel["datum"])}">'
        f'<div class="card-body">'
        f'<span class="card-label" style="display:flex;align-items:center;gap:8px">{esc(team_label)} · '
        f'{"Heim" if spiel["heim"] else "Auswärts"}</span>'
        f'<h3 style="font-size:17px">{matchup}</h3>'
        f'<p class="t-body-sm" style="color:var(--text-muted)">{zeit_html}</p>'
        f"{untenzeile}"
        f"</div></div>"
    )


def block(daten):
    alle = []
    for team_key, team in (daten.get("teams") or {}).items():
        for spiel in team.get("spiele") or []:
            alle.append((spiel["datum"] + (spiel.get("zeit") or ""), team_key, spiel))
    alle.sort(key=lambda t: t[0])
    return "\n".join("          " + karte_html(spiel, team_key) for _, team_key, spiel in alle), len(alle)


def einbauen(text, inhalt):
    neu = f"{START}{inhalt}{ENDE}" if inhalt else f"{START}{ENDE}"
    if START not in text or ENDE not in text:
        raise SystemExit(f"Marker {START} nicht gefunden — Seite von Hand umgebaut?")
    a = text.index(START)
    b = text.index(ENDE) + len(ENDE)
    return text[:a] + neu + text[b:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    if not QUELLE.exists():
        print("  data/nachwuchs-spielplan.json fehlt, nichts zu tun")
        return 0

    daten = json.loads(QUELLE.read_text(encoding="utf-8"))
    karten, anzahl = block(daten)

    alt = ZIEL.read_text(encoding="utf-8")
    neu = einbauen(alt, "\n" + karten + "\n        " if karten else "")

    if neu == alt:
        print(f"  unverändert ({anzahl} Spiele)")
        return 0
    if args.check:
        print(f"  zu ändern ({anzahl} Spiele)")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben ({anzahl} Spiele)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
