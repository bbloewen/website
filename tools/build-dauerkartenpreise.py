#!/usr/bin/env python3
"""Rechnet die Dauerkartenpreise aus den noch ausstehenden Heimspielen.

Regel (Marko, 12.10.2026): Die Dauerkarte war mit einem Spiel Rabatt kalkuliert (14 Spiele
zum Preis von 13). Nach jedem gespielten Heimspiel sinkt der Preis um einen weiteren
Einzelpreis: Preis = Ausgangspreis x zuBezahlendeSpiele / 13, aufgerundet auf volle Euro,
mit zuBezahlendeSpiele = verbleibende Heimspiele - 1 (mindestens 1).

Ein Heimspiel gilt als verbleibend, bis es 4 Stunden nach Anpfiff vorbei ist -- dieselbe
Regel, nach der der Gameday-Hub aufs naechste Spiel umschaltet (build-gameday-hub.py,
spielende()), damit sich beides im selben Moment aendert.

Was geschrieben wird:

  data/dauerkarte-preise.json   Bloecke "stand" und "preise" (Ausgangspreise "basis" bleiben
                                von Hand gepflegt und werden nie angefasst)
  tickets/dauerkarte.html       die data-base-Werte und der sichtbare Preis der zwoelf Zeilen

Lesen tun diese Preise ausserdem der n8n-Workflow der Dauerkartenbestellung (der Server rechnet
mit der JSON) und der n8n-Workflow "Dauerkarten: pretix-Standardpreise nachziehen". Der Game
Hub bekommt sie ueber tickets/dauerkarte.html (build-gameday-hub.py liest data-base). Deshalb
muss dieses Skript VOR build-gameday-hub.py laufen (bauen.sh und der Workflow
spieltagsseiten-nachbauen.yml halten diese Reihenfolge).

Aufruf:
  python3 tools/build-dauerkartenpreise.py
  python3 tools/build-dauerkartenpreise.py --check     # schreibt nichts, Exit 1 bei Abweichung
"""

import argparse
import importlib.util
import json
import re
import sys
from fractions import Fraction
from math import ceil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
JSON_DATEI = REPO / "data" / "dauerkarte-preise.json"
SEITE = REPO / "tickets" / "dauerkarte.html"

SPIELE_AUSGANGSPREIS = 13  # der Ausgangspreis gilt fuer 14 Spiele zum Preis von 13

ZEILE_RE = re.compile(r'(<strong id="dk-price-)([a-z0-9-]+)(" data-base=")([0-9.]+)(">)([^<]*)(</strong>)')


def hub_modul():
    """build-gameday-hub.py hat einen Bindestrich im Namen -- per Pfad laden, damit die
    Regel 'Spiel vorbei' (spielende()) nur an einer Stelle steht."""
    spec = importlib.util.spec_from_file_location("hub", Path(__file__).with_name("build-gameday-hub.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def preise_rechnen(basis, zu_bezahlen):
    """{id: Ausgangspreis} -> {id: Preis in vollen Euro}, ohne Gleitkomma (Bruchrechnung)."""
    ergebnis = {}
    for schluessel, wert in basis.items():
        exakt = Fraction(str(wert)) * zu_bezahlen / SPIELE_AUSGANGSPREIS
        ergebnis[schluessel] = ceil(exakt)
    return ergebnis


def eur(betrag):
    """1191 -> '1.191,00 €' (deutsche Schreibweise wie auf allen Preisseiten)."""
    return f"{betrag:,.2f} €".replace(",", "#").replace(".", ",").replace("#", ".")


def json_text(daten):
    return json.dumps(daten, ensure_ascii=False, indent=2) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    hub = hub_modul()
    liste = hub.spiele()
    jetzt = hub.jetzt_berlin()
    verbleibend = sum(1 for s in liste if hub.spielende(s) > jetzt)
    zu_bezahlen = max(verbleibend - 1, 1)

    daten = json.loads(JSON_DATEI.read_text(encoding="utf-8"))
    preise = preise_rechnen(daten["basis"], zu_bezahlen)
    daten["stand"] = {"verbleibendeHeimspiele": verbleibend, "zuBezahlendeSpiele": zu_bezahlen}
    daten["preise"] = preise

    fehlt = [k for k in preise if f'id="dk-price-{k}"' not in SEITE.read_text(encoding="utf-8")]
    if fehlt:
        raise SystemExit("tickets/dauerkarte.html: keine Zeile zu " + ", ".join(fehlt)
                         + " -- Preise in data/dauerkarte-preise.json und die Seite passen nicht zusammen.")

    alt_json = JSON_DATEI.read_text(encoding="utf-8")
    neu_json = json_text(daten)

    alt_html = SEITE.read_text(encoding="utf-8")

    def zeile(m):
        schluessel = m.group(2)
        if schluessel not in preise:
            return m.group(0)
        betrag = preise[schluessel]
        return f"{m.group(1)}{schluessel}{m.group(3)}{betrag}{m.group(5)}{eur(betrag)}{m.group(7)}"

    neu_html = ZEILE_RE.sub(zeile, alt_html)

    zusammen = ", ".join(f"{k} {v}" for k, v in preise.items())
    geaendert = (alt_json != neu_json) or (alt_html != neu_html)
    kopf = f"{verbleibend} Heimspiele verbleibend, {zu_bezahlen} zu bezahlen"
    if not geaendert:
        print(f"  unveraendert ({kopf})")
        return 0
    if args.check:
        print(f"  zu aendern ({kopf}): {zusammen}")
        return 1
    JSON_DATEI.write_text(neu_json, encoding="utf-8")
    SEITE.write_text(neu_html, encoding="utf-8")
    print(f"  geschrieben ({kopf}): {zusammen}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
