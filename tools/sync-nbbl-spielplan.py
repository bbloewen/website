#!/usr/bin/env python3
"""Gleicht den NBBL-Spielplan (data/spielplan-saison.json, Block "nbbl") mit der Liga ab.

Quelle ist dieselbe Schnittstelle, aus der nbbl-basketball.de seine Spielpläne baut
(api.bbl.scb.world/v2/schedule, öffentlicher Schlüssel aus der NBBL-Webseite; die
Tabelle holt n8n „Website: Tabelle NBBL automatisch aktualisieren“ von dort).

Anlass (Marko, 11.11.2026): Die Liga verlegt Spiele, am 11.11. standen 5 von 8 Terminen
der B-Division falsch auf der Website. Seitdem läuft dieses Skript im Workflow
spieltagsseiten-nachbauen.yml vor build-kalender.py mit.

Regeln:
  * Jedes Spiel der Liga wird übernommen (Datum, Anwurf in Ortszeit, Gegner, Heim/Auswärts,
    Halle, Endstand). Heimspiele in der Riethsporthalle bekommen kein "ort" (Standard).
  * Eigene Zusatzfelder einer bestehenden Zeile (z. B. ein von Hand gesetzter Ort, wenn die
    Liga keine Halle nennt) bleiben erhalten; die Zeile wird über Gegner + Heim/Auswärts
    und das nächstliegende Datum zugeordnet.
  * Platzhalter ("Noch offen") bleiben nur für Termine nach dem letzten angesetzten
    Ligaspiel stehen, frühere sind durch die Ansetzungen erledigt.
  * Schlägt der Abruf fehl, bleibt die Datei unverändert (Exit 0), damit der übrige Bau läuft.

Aufruf:
  python3 tools/sync-nbbl-spielplan.py
  python3 tools/sync-nbbl-spielplan.py --check   # nur zeigen, was sich ändern würde
"""

import argparse
import json
import re
import sys
import urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

from seo_common import REPO

API = "https://api.bbl.scb.world/v2/schedule?seasonId=2026&teamId={team}"
API_KEY = "8dc905d70eac940c38313e1284b2d5c0"   # öffentlich, steht im Quelltext von nbbl-basketball.de
TEAM_ID = 1232                                   # Basketball Löwen Erfurt (NBBL)
DATEI = REPO / "data" / "spielplan-saison.json"
BERLIN = ZoneInfo("Europe/Berlin")
PLATZHALTER = "Noch offen"
STANDARD_HALLE = "Riethsporthalle"


def abrufen():
    req = urllib.request.Request(API.format(team=TEAM_ID),
                                 headers={"x-api-key": API_KEY, "User-Agent": "basketball-loewen-website"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def datum_von(eintrag):
    t, m, j = eintrag["datum"].split(".")
    return date(int(j), int(m), int(t))


def aus_liga(spiel):
    """Ligaspiel -> Zeile im Format von spielplan-saison.json."""
    zeit = datetime.fromisoformat(spiel["scheduledTime"].replace("Z", "+00:00")).astimezone(BERLIN)
    heim = spiel["homeTeam"]["id"] == TEAM_ID
    e = {
        "datum": zeit.strftime("%d.%m.%Y"),
        "zeit": zeit.strftime("%H:%M"),
        "gegner": (spiel["guestTeam"] if heim else spiel["homeTeam"])["name"].strip(),
        "heim": heim,
    }
    if e["zeit"] == "00:00":            # Liga hat noch keine Anwurfzeit
        del e["zeit"]
    halle = ((spiel.get("stadium") or {}).get("name") or "").strip()
    if halle and "not set" not in halle and not halle.startswith(STANDARD_HALLE):
        e["ort"] = halle
    ergebnis = (spiel.get("results") or {}).get("finalScore")
    if spiel.get("completed") and ergebnis and len(ergebnis) == 2:
        e["ergebnis"] = f"{ergebnis[0]} : {ergebnis[1]}"
    return e


def zusammenfuehren(alt, liga):
    """Ligaspiele mit den bisherigen Zeilen verbinden (Zusatzfelder, Platzhalter)."""
    offen = [e for e in alt if e.get("gegner") != PLATZHALTER]
    neu = []
    for e in liga:
        d = datum_von(e)
        kandidaten = [a for a in offen if a.get("gegner", "").lower() == e["gegner"].lower()
                      and bool(a.get("heim")) == e["heim"]]
        if kandidaten:
            a = min(kandidaten, key=lambda a: abs((datum_von(a) - d).days))
            if abs((datum_von(a) - d).days) <= 60:
                offen.remove(a)
                for k, v in a.items():
                    if k in ("datum", "zeit", "gegner", "heim"):
                        continue
                    if k == "ergebnis":
                        # Von Hand eingetragener Endstand eines vergangenen Spiels, den die Liga
                        # noch nicht führt, bleibt; sonst gilt der Liga-Stand.
                        if "ergebnis" not in e and datum_von(a) == d and d <= date.today():
                            e["ergebnis"] = v
                        continue
                    e.setdefault(k, v)
        neu.append(e)
    letzter = max((datum_von(e) for e in neu), default=None)
    for a in alt:
        if a.get("gegner") == PLATZHALTER and (letzter is None or datum_von(a) > letzter):
            neu.append(a)
    neu.sort(key=lambda e: (datum_von(e), e.get("zeit", "")))
    return neu


REIHENFOLGE = ["datum", "zeit", "gegner", "heim", "ort", "ergebnis"]


def zeile(e):
    """Eine Zeile je Spiel, Felder in fester Reihenfolge (wie von Hand gepflegt)."""
    schluessel = [k for k in REIHENFOLGE if k in e] + [k for k in e if k not in REIHENFOLGE]
    return "      { " + ", ".join(f"{json.dumps(k)}: {json.dumps(e[k], ensure_ascii=False)}"
                                 for k in schluessel) + " }"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    try:
        spiele = abrufen()
    except Exception as fehler:      # Netz/Schnittstelle: Bau nicht aufhalten
        print(f"  NBBL-Spielplan nicht abrufbar ({fehler}), unverändert.", file=sys.stderr)
        return 0
    liga = [aus_liga(s) for s in spiele
            if s.get("scheduledTime") and not s.get("isHidden")]
    if len(liga) < 3:
        print(f"  NBBL-Schnittstelle liefert nur {len(liga)} Spiele, unverändert.", file=sys.stderr)
        return 0

    text = DATEI.read_text(encoding="utf-8")
    daten = json.loads(text)
    alt = daten["nbbl"]["spiele"]
    neu = zusammenfuehren(alt, liga)

    # Nur den Spiele-Block des NBBL-Abschnitts ersetzen, die übrige Datei bleibt Zeichen für Zeichen.
    start = text.index('"nbbl": {')
    a = text.index('"spiele": [', start)
    b = text.index("\n    ]", a)
    block = '"spiele": [\n' + ",\n".join(zeile(e) for e in neu)
    neu_text = text[:a] + block + text[b:]
    json.loads(neu_text)

    if neu_text == text:
        print("  NBBL-Spielplan unverändert.")
        return 0
    alt_set = {json.dumps(e, sort_keys=True, ensure_ascii=False) for e in alt}
    for e in neu:
        if json.dumps(e, sort_keys=True, ensure_ascii=False) not in alt_set:
            print(f"  neu/geändert: {e['datum']} {e.get('zeit', '--:--')} "
                  f"{'Heim' if e['heim'] else 'Auswärts'} {e['gegner']} {e.get('ergebnis', '')}")
    if not args.check:
        DATEI.write_text(neu_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
