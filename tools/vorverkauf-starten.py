#!/usr/bin/env python3
"""Eroeffnet den Einzelticket-Vorverkauf fuer das Heimspiel, das der Hub gerade zeigt.

Hintergrund (Marko, 11.10.2026): Sobald ein Heimspiel 4 Stunden nach Anpfiff vorbei ist, stellt
sich der Gameday-Hub auf das naechste Spiel (build-gameday-hub.py, naechstes()), und fuer dieses
Spiel soll der Vorverkauf starten. "Vorverkauf offen" heisst im Repo: Feld "ticketUrl" in
data/heimspiele.json ist gesetzt -- daran haengen der Kaufbereich auf dem Hub und, ueber den
n8n-Bestellprozess, der Ausschluss des Spiels aus neuen Dauerkarten-Bestellungen.

Dieses Skript setzt fuer das aktuelle Spiel "ticketUrl" (Adresse seiner Spieltagsseite) und
"vorverkaufAb" (heutiges Datum), falls beides fehlt. Es ruft nichts auf pretix auf -- das
Subevent (subeventId) muss dort angelegt sein; ohne subeventId passiert nichts.

Aufruf (laeuft im Workflow spieltagsseiten-nachbauen.yml vor den Bauskripten):
  python3 tools/vorverkauf-starten.py
  python3 tools/vorverkauf-starten.py --check   # nur melden, nichts schreiben
"""

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUELLE = REPO / "data" / "heimspiele.json"


def hub_modul():
    """build-gameday-hub.py hat einen Bindestrich im Namen -- per Pfad laden, damit die
    Umschaltregel (naechstes()) nur an einer Stelle steht."""
    spec = importlib.util.spec_from_file_location("hub", Path(__file__).with_name("build-gameday-hub.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    hub = hub_modul()
    liste = hub.spiele()
    aktuell, kommt = hub.naechstes(liste, hub.jetzt_berlin())
    name = f"{aktuell['gegner']} am {aktuell['datum']}"
    if not kommt:
        print(f"  Saison vorbei, nichts zu tun ({name})")
        return 0
    if aktuell.get("ticketUrl"):
        print(f"  Vorverkauf laeuft schon ({name})")
        return 0
    if not aktuell.get("subeventId"):
        print(f"  ACHTUNG: {name} hat keine subeventId -- Vorverkauf nicht gestartet", file=sys.stderr)
        return 0

    if args.check:
        print(f"  Vorverkauf wuerde starten: {name}")
        return 1

    ticket_url = f"/saison/profis/gameday/{aktuell['seiteSlug']}.html"
    ab = hub.jetzt_berlin().date().isoformat()
    text = QUELLE.read_text(encoding="utf-8")
    # Einfuegen direkt hinter der "subeventId"-Zeile genau dieses Spiels (Format der Datei bleibt)
    muster = re.compile(r'(      "slug": "%s",\n(?:      "[^"\n]+": [^\n]*,\n)*?      "subeventId": %d,\n)' % (re.escape(aktuell["slug"]), int(aktuell["subeventId"])))
    if len(muster.findall(text)) != 1:
        print(f"  FEHLER: Eintrag fuer {name} in data/heimspiele.json nicht eindeutig gefunden", file=sys.stderr)
        return 2
    text = muster.sub(lambda m: m.group(1) + f'      "ticketUrl": "{ticket_url}",\n      "vorverkaufAb": "{ab}",\n', text)
    json.loads(text)  # bleibt gueltiges JSON
    QUELLE.write_text(text, encoding="utf-8")
    print(f"  Vorverkauf gestartet: {name} (ticketUrl {ticket_url}, ab {ab})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
