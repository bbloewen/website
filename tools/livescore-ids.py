#!/usr/bin/env python3
"""Traegt den Boxscore-/Liveticker-Link ("livescore") der Profis-Spiele automatisch ein.

Anlass (24.10.2026): Beim Spiel in Fellbach war im Startseiten-Widget kein Boxscore anklickbar, weil
niemand die Spiel-ID des Livetickers eingetragen hatte. Die ID steht erst beim Liga-Liveticker, nicht
in unserer Planung.

Quelle: https://live.2basketballbundesliga.de/games.jsn -- die Spiele der naechsten Tage ueber alle
Ligen, je Spiel mit ID (g), Datum (d) und Team-IDs (t1 = Heim, t2 = Gast). Basketball Loewen Erfurt hat
die Team-ID 563. Das Skript ordnet jedes Loewen-Spiel ueber das Datum einem Eintrag in
  data/heimspiele.json              (Heimspiele, Loewen = t1)
  data/spielplan-saison.json        (profisAuswaerts, Loewen = t2)
zu und setzt dort das Feld "livescore" auf https://live.2basketballbundesliga.de/g/<ID>. Ein schon
vorhandener Link wird nur ersetzt, wenn er auf eine andere ID zeigt.

Aufruf:
  python3 tools/livescore-ids.py            # schreibt
  python3 tools/livescore-ids.py --check    # schreibt nichts, Exit 1 bei Abweichung
"""

import argparse
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUELLE = "https://live.2basketballbundesliga.de/games.jsn"
BASIS = "https://live.2basketballbundesliga.de/g/"
LOEWEN = "563"
HEIM = REPO / "data" / "heimspiele.json"
AUSWAERTS = REPO / "data" / "spielplan-saison.json"

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()


def holen():
    req = urllib.request.Request(QUELLE, headers={"User-Agent": "basketball-loewen.com livescore-ids"})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as r:
        return json.loads(r.read().decode("utf-8"))


def eintragen(text, datum, url, zeilenweise):
    """Setzt livescore fuer das Spiel mit "datum": "<datum>". Gibt (neuer Text, geaendert) zurueck."""
    marke = f'"datum": "{datum}"'
    i = text.find(marke)
    if i < 0:
        return text, False
    if zeilenweise:
        # spielplan-saison.json: ein Spiel pro Zeile { ... }
        ende = text.find("\n", i)
        zeile = text[i:ende]
        m = re.search(r'"livescore": "([^"]*)"', zeile)
        if m:
            if m.group(1) == url:
                return text, False
            neu = zeile.replace(m.group(0), f'"livescore": "{url}"')
        else:
            g = re.search(r'"gegner": "[^"]*", ', zeile)
            if not g:
                return text, False
            neu = zeile[:g.end()] + f'"livescore": "{url}", ' + zeile[g.end():]
        return text[:i] + neu + text[ende:], True
    # heimspiele.json: eingerueckte Objekte, ein Schluessel je Zeile
    ende = text.find("\n    }", i)
    block = text[i:ende]
    m = re.search(r'"livescore": "([^"]*)"', block)
    if m:
        if m.group(1) == url:
            return text, False
        neu = block.replace(m.group(0), f'"livescore": "{url}"')
    else:
        g = re.search(r'"gegner": "[^"]*",\n', block)
        if not g:
            return text, False
        neu = block[:g.end()] + f'      "livescore": "{url}",\n' + block[g.end():]
    return text[:i] + neu + text[ende:], True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    try:
        spiele = holen()
    except Exception as e:
        # Liga-Ticker nicht erreichbar: kein Fehler fuer den ganzen Bau, die Links bleiben wie sie sind.
        print(f"livescore: Quelle nicht erreichbar ({e}), nichts geaendert")
        return 0
    heim_text = HEIM.read_text(encoding="utf-8")
    aus_text = AUSWAERTS.read_text(encoding="utf-8")
    geaendert = []
    for s in spiele:
        if LOEWEN not in (str(s.get("t1")), str(s.get("t2"))) or s.get("l") != "s":
            continue
        url = BASIS + str(s["g"])
        if str(s.get("t1")) == LOEWEN:
            heim_text, ok = eintragen(heim_text, s["d"], url, False)
        else:
            aus_text, ok = eintragen(aus_text, s["d"], url, True)
        if ok:
            geaendert.append(f'{s["d"]} {s["c1"]} - {s["c2"]}: {url}')

    for text in (heim_text, aus_text):
        json.loads(text)  # bricht ab, falls die Textarbeit die JSON zerstoert hat
    if not geaendert:
        print("livescore: nichts zu ergaenzen")
        return 0
    for z in geaendert:
        print("livescore:", z)
    if args.check:
        return 1
    HEIM.write_text(heim_text, encoding="utf-8")
    AUSWAERTS.write_text(aus_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
