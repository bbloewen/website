#!/usr/bin/env python3
"""Holt die MDL-Spielpläne unserer eigenen Nachwuchsteams von basketball-bund.net
und schreibt sie nach data/nachwuchs-spielplan.json.

Warum kein Browser/Scraper: basketball-bund.net rendert die Spielpläne zwar über
eine Angular-SPA (static/#/liga/<id>/spielplan), die SPA ruft dafür aber intern
eine oeffentliche, unauthentifizierte JSON-API auf:
  https://www.basketball-bund.net/rest/competition/spielplan/id/<ligaId>
Gefunden über die Netzwerk-Analyse einer echten Seitenladung (27.09.2026,
Marko-Hinweis "hier sind doch auch die Ergebnisse sichtbar"). Ein normaler
Skript-Abruf (urllib, kein Browser) bekommt exakt dieselben Daten wie die
Website selbst -- kein Reverse-Engineering, keine Login-Umgehung, oeffentliche
Ligadaten, wie sie auch unangemeldet auf basketball-bund.net sichtbar sind.

Vorsicht Team-Namen: in manchen Ligen (z.B. U14) treten sowohl "Basketball
Löwen Erfurt" als auch "BIG Gotha" als jeweils EIGENE Mannschaften an -- die
beiden sind dort nicht dieselbe Kooperation wie bei U15/U17. TEAMS unten
filtert deshalb pro Liga exakt einen Teamnamen, nicht "beide Vereine".

Diese Datei ist ein einmaliger, manueller Abruf -- fuer dauerhaft aktuelle
Werte (neue Ergebnisse jede Woche) braucht es einen wiederkehrenden Abruf,
z.B. taeglich per n8n-Workflow, aehnlich wie data/community-events.json.

Aufruf:
  python3 tools/fetch-nachwuchs-spielplan.py
"""

import json
import ssl
import urllib.request
from pathlib import Path
from urllib.error import URLError

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "data" / "nachwuchs-spielplan.json"

API = "https://www.basketball-bund.net/rest/competition/spielplan/id/{}"

# Auf manchen lokalen Python-Installationen (python.org-Installer auf macOS,
# ohne "Install Certificates.command") fehlt urllib das CA-Bundle fuer TLS-
# Verifizierung -- certifi liefert eins, falls installiert. Auf GitHub Actions
# (ubuntu-latest) ist das Standard-Bundle bereits vollstaendig, daher hier nur
# ein optionaler Fallback, kein zusaetzlicher Pflicht-Dependency.
try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

# team = dieselben Team-Keys wie in data/trainingszeiten.json / js/trainingszeiten.js
# (TEAM_KEY), damit Kachel und Trainingszeiten-Deep-Link zueinander passen.
TEAMS = [
    {"team": "U12m/1", "ligaId": 53255, "unserName": "Basketball Löwen Erfurt"},
    {"team": "U13m", "ligaId": 53252, "unserName": "Basketball Löwen Erfurt"},
    {"team": "U14m", "ligaId": 53248, "unserName": "Basketball Löwen Erfurt"},
    {"team": "U15m", "ligaId": 53244, "unserName": "Basketball Löwen Erfurt"},
    {"team": "U17m", "ligaId": 53240, "unserName": "BIG Gotha"},
]


def fetch(liga_id):
    url = API.format(liga_id)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (basketball-loewen.com)"})
    with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
        return json.load(resp)


def normiere(match, unser_name):
    heim = match["homeTeam"]["teamname"]
    gast = match["guestTeam"]["teamname"]
    ist_heim = heim == unser_name
    gegner = gast if ist_heim else heim
    return {
        "datum": match["kickoffDate"],
        "zeit": match.get("kickoffTime"),
        "heim": ist_heim,
        "gegner": gegner,
        "ergebnis": match.get("result"),
        "abgesagt": bool(match.get("abgesagt")),
    }


def main():
    teams_out = {}
    fehler = []
    for t in TEAMS:
        try:
            antwort = fetch(t["ligaId"])
        except URLError as e:
            fehler.append(f"{t['team']} (Liga {t['ligaId']}): {e}")
            continue
        liga = antwort["data"]
        matches = liga.get("matches") or []
        unsere = [
            normiere(m, t["unserName"])
            for m in matches
            if t["unserName"] in (m["homeTeam"]["teamname"], m["guestTeam"]["teamname"])
        ]
        unsere.sort(key=lambda s: (s["datum"], s["zeit"] or ""))
        teams_out[t["team"]] = {
            "ligaId": t["ligaId"],
            "liganame": liga["ligaData"]["liganame"],
            "spiele": unsere,
        }

    out = {
        "hinweis": (
            "Quelle: basketball-bund.net REST-API "
            "(rest/competition/spielplan/id/<ligaId>), oeffentlich ohne Login "
            "abrufbar -- Details im Skriptkopf von tools/fetch-nachwuchs-spielplan.py. "
            "Manuell abgerufen, kein automatischer wiederkehrender Abruf eingerichtet; "
            "Stand kann veralten, bis das nachgeholt ist (siehe Skriptkopf)."
        ),
        "teams": teams_out,
    }
    ZIEL.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n = sum(len(v["spiele"]) for v in teams_out.values())
    print(f"  geschrieben ({len(teams_out)} Teams, {n} Spiele)")
    if fehler:
        print("  Fehler bei:")
        for f in fehler:
            print(f"    {f}")


if __name__ == "__main__":
    main()
