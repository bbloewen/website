#!/usr/bin/env python3
"""Erzeugt die iCal-Dateien (.ics) fuer Apple Kalender, Outlook, Android und alle anderen.

Marko, 11.10.2026: Die Kalender-Links der Seite fuehrten nur in den Google Kalender; wer iCal
nutzt, soll auch bedient werden. Zwei Arten von Dateien:

  kalender/spiel/<team>-<JJJJ-MM-TT>.ics   ein einzelner Termin (Link am Kalender-Icon)
  kalender/loewen-<team>.ics               abonnierbarer Kalender je Team (damen, nbbl; die Profis
                                           haben den Liga-Kalender, s. spielplan.html)

  kalender/camp/<Startdatum>.ics           ein Feriencamp (aus den Karten in trainieren/feriencamps.html)

Quellen: data/heimspiele.json (Profis-Heimspiele), data/spielplan-saison.json (Profis auswaerts,
Damen, NBBL). Die Regeln fuer Titel, Halle und Reihenfolge entsprechen js/spielplan.js; fuer die
NBBL gilt die Hallenregel von dort (Riethsporthalle nur am Tag eines Pro-B-Heimspiels, sonst
Sporthalle am Suedpark).

Gleiche Termine behalten beim erneuten Bauen dieselbe UID (<team>-<Datum>@basketball-loewen.com),
ein erneuter Import legt sie also nicht doppelt an. Spiele ohne Uhrzeit sind ganztaegige Termine.
Keine Erinnerung (VALARM), bewusst die neutrale Voreinstellung.

Feriencamps: Termin, Titel und Halle liest das Skript aus den Karten (`camp-slider-card`) in
trainieren/feriencamps.html -- aus dem Google-Kalender-Link der Karte (Feld `dates`, Ende
exklusiv) und der Hallenzeile. Jede Karte braucht daneben den Link
`<a class="kal-ics" href="/kalender/camp/<Startdatum JJJJ-MM-TT>.ics">iCal</a>`; fehlt er, meldet das
Skript es.

Dateien, die beim Lauf nicht mehr entstehen (Spiel verschoben), werden aus kalender/spiel/ entfernt.

Aufruf:
  python3 tools/build-kalender.py
  python3 tools/build-kalender.py --check
"""

import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE = "https://basketball-loewen.com"
OUT = REPO / "kalender"
DAUER = timedelta(hours=2)

LABEL = {"profis": "Basketball Löwen", "damen": "CATL Basketball Löwinnen", "nbbl": "Basketball Löwen NBBL"}
TEAMNAME = {"profis": "Profis (ProB)", "damen": "Damen (Regionalliga)", "nbbl": "NBBL (U19)"}
RIETH = "Riethsporthalle, Essener Straße 20, 99089 Erfurt"
SUEDPARK = "Sporthalle am Südpark, Erfurt"

VTIMEZONE = """BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE"""


def dmy(s):
    t, m, j = (int(x) for x in s.split("."))
    return date(j, m, t)


def esc(text):
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\n").replace("\n", "\\n"))


def fold(zeile):
    """Zeilen laut RFC 5545 auf 75 Oktette umbrechen (Folgezeilen mit fuehrendem Leerzeichen)."""
    roh = zeile.encode("utf-8")
    if len(roh) <= 75:
        return zeile
    teile, i, erste = [], 0, True
    while i < len(roh):
        grenze = 75 if erste else 74
        stueck = roh[i:i + grenze]
        while True:  # nicht mitten in einem UTF-8-Zeichen trennen
            try:
                stueck.decode("utf-8")
                break
            except UnicodeDecodeError:
                stueck = stueck[:-1]
        teile.append(stueck.decode("utf-8"))
        i += len(stueck)
        erste = False
    return "\r\n ".join(teile)


def spiele():
    heim = json.loads((REPO / "data" / "heimspiele.json").read_text(encoding="utf-8"))["spiele"]
    saison = json.loads((REPO / "data" / "spielplan-saison.json").read_text(encoding="utf-8"))
    proB_heimtage = {dmy(s["datum"]) for s in heim}
    out = []

    def add(team, s, ist_heim, ort, url):
        d = dmy(s["datum"])
        zeit = s.get("zeit")
        gegner = s["gegner"]
        offen = gegner.strip().lower() == "noch offen"
        out.append({"team": team, "date": d, "zeit": zeit, "heim": ist_heim, "gegner": gegner, "offen": offen,
                    "ort": ort, "url": url})

    for s in heim:
        add("profis", s, True, RIETH, f"{BASE}/saison/profis/gameday/{s['seiteSlug']}.html")
    for s in saison["profisAuswaerts"]:
        ort = f"{s['halle']}, {s['adresse']}" if s.get("halle") and s.get("adresse") else s.get("ort", "")
        add("profis", s, False, ort, f"{BASE}/saison/spielplan.html?team=profis")
    for s in saison["damen"]["spiele"]:
        add("damen", s, bool(s.get("heim")), RIETH if s.get("heim") else s.get("ort", ""),
            f"{BASE}/saison/spielplan.html?team=damen")
    for s in saison["nbbl"]["spiele"]:
        heim = bool(s.get("heim"))
        if heim:
            ort = RIETH if dmy(s["datum"]) in proB_heimtage else SUEDPARK
        else:
            ort = s.get("ort", "")
        add("nbbl", s, heim, ort, f"{BASE}/saison/spielplan.html?team=nbbl")
    out.sort(key=lambda g: (g["date"], g["zeit"] or "", g["team"]))
    return out


def dateiname(g):
    return f"{g['team']}-{g['date'].isoformat()}"


def vevent(g):
    label = LABEL[g["team"]]
    if g["offen"]:
        titel = f"{label}: Gegner noch offen"
    elif g["heim"]:
        titel = f"{label} – {g['gegner']}"
    else:
        titel = f"{g['gegner']} – {label}"
    beschr = ("Heimspiel" if g["heim"] else "Auswärtsspiel") + f" · {TEAMNAME[g['team']]}"
    if g["offen"]:
        beschr += "\nGegner und Uhrzeit werden von der Liga noch festgelegt."
    beschr += f"\nAlle Infos: {g['url']}"
    zeilen = ["BEGIN:VEVENT", f"UID:{dateiname(g)}@basketball-loewen.com", "DTSTAMP:20261011T000000Z", "SEQUENCE:0"]
    if g["zeit"]:
        h, m = (int(x) for x in g["zeit"].split(":")[:2])
        start = datetime(g["date"].year, g["date"].month, g["date"].day, h, m)
        ende = start + DAUER
        zeilen += [f"DTSTART;TZID=Europe/Berlin:{start:%Y%m%dT%H%M%S}", f"DTEND;TZID=Europe/Berlin:{ende:%Y%m%dT%H%M%S}"]
    else:
        zeilen += [f"DTSTART;VALUE=DATE:{g['date']:%Y%m%d}", f"DTEND;VALUE=DATE:{g['date'] + timedelta(days=1):%Y%m%d}"]
    zeilen.append(f"SUMMARY:{esc(titel)}")
    if g["ort"]:
        zeilen.append(f"LOCATION:{esc(g['ort'])}")
    zeilen += [f"DESCRIPTION:{esc(beschr)}", f"URL:{g['url']}", "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT"]
    return zeilen


def kalender(events, name=None):
    kopf = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Basketball Löwen Erfurt//Spielplan//DE", "CALSCALE:GREGORIAN"]
    if name:
        kopf += [f"X-WR-CALNAME:{esc(name)}", "X-WR-TIMEZONE:Europe/Berlin",
                 "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H"]
    zeilen = kopf + VTIMEZONE.split("\n")
    for g in events:
        zeilen += vevent(g)
    zeilen.append("END:VCALENDAR")
    return "\r\n".join(fold(z) for z in zeilen) + "\r\n"


def camps():
    """Feriencamps aus trainieren/feriencamps.html (ganztaegige Termine)."""
    import html as _html
    import re
    import urllib.parse
    text = (REPO / "trainieren" / "feriencamps.html").read_text(encoding="utf-8")
    bloecke = re.split(r'(?=<div class="card hoverable camp-slider-card">)', text)[1:]
    out, ohne_link = [], []
    for b in bloecke:
        b = b.split('<div class="card hoverable camp-slider-card">', 1)[-1]
        b = re.split(r'</section>|<div class="card hoverable camp-slider-card">', b)[0]
        h3 = re.search(r"<h3>(.*?)</h3>", b, re.S)
        g = re.search(r'href="(https://calendar\.google\.com[^"]*)"', b)
        if not (h3 and g):
            continue
        titel = _html.unescape(re.sub(r"<[^>]+>", "", h3.group(1))).strip()
        q = urllib.parse.parse_qs(urllib.parse.urlparse(_html.unescape(g.group(1))).query)
        try:
            a, e = q["dates"][0].split("/")
            start = datetime.strptime(a, "%Y%m%d").date()
            ende = datetime.strptime(e, "%Y%m%d").date()
        except (KeyError, ValueError):
            continue
        ort = re.search(r"map-pin[^>]*></i>\s*([^<]*)</a>", b)
        ort = f"{ort.group(1).strip()}, Erfurt" if ort else ""
        details = (q.get("details") or [""])[0]
        key = start.isoformat()
        if f"/kalender/camp/{key}.ics" not in b:
            ohne_link.append(titel)
        out.append({"key": key, "titel": titel, "start": start, "ende": ende, "ort": ort, "details": details})
    return out, ohne_link


def camp_kalender(c):
    zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Basketball Löwen Erfurt//Feriencamps//DE", "CALSCALE:GREGORIAN",
              "BEGIN:VEVENT", f"UID:camp-{c['key']}@basketball-loewen.com", "DTSTAMP:20261011T000000Z", "SEQUENCE:0",
              f"DTSTART;VALUE=DATE:{c['start']:%Y%m%d}", f"DTEND;VALUE=DATE:{c['ende']:%Y%m%d}",
              f"SUMMARY:{esc(c['titel'] + ' – Basketball Löwen Erfurt')}"]
    if c["ort"]:
        zeilen.append(f"LOCATION:{esc(c['ort'])}")
    beschr = (c["details"] + "\n" if c["details"] else "") + f"Alle Infos: {BASE}/trainieren/feriencamps.html"
    zeilen += [f"DESCRIPTION:{esc(beschr)}", f"URL:{BASE}/trainieren/feriencamps.html", "STATUS:CONFIRMED", "TRANSP:TRANSPARENT",
               "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(fold(z) for z in zeilen) + "\r\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    alle = spiele()
    soll = {}
    for g in alle:
        soll[OUT / "spiel" / f"{dateiname(g)}.ics"] = kalender([g])
    # Abo-Kalender nur fuer Damen und NBBL: die Profis abonniert man beim offiziellen Kalender der
    # Liga (webcal://api.2basketballbundesliga.de/cal/563, Knopf unter dem Spielplan).
    for team in ("damen", "nbbl"):
        soll[OUT / f"loewen-{team}.ics"] = kalender([g for g in alle if g["team"] == team], f"Basketball Löwen – {TEAMNAME[team]}")

    camp_liste, camp_ohne_link = camps()
    for c in camp_liste:
        soll[OUT / "camp" / f"{c['key']}.ics"] = camp_kalender(c)
    for titel in camp_ohne_link:
        print(f"  HINWEIS: Camp-Karte '{titel}' hat keinen iCal-Link (<a class=\"kal-ics\" href=\"/kalender/camp/<Startdatum>.ics\">iCal</a>)", file=sys.stderr)

    geaendert = []
    for pfad, inhalt in soll.items():
        alt = pfad.read_bytes().decode("utf-8") if pfad.exists() else None
        if alt != inhalt:
            geaendert.append(pfad)
            if not args.check:
                pfad.parent.mkdir(parents=True, exist_ok=True)
                with open(pfad, "w", encoding="utf-8", newline="") as f:
                    f.write(inhalt)
    veraltet = [p for sub in ("spiel", "camp") if (OUT / sub).exists() for p in (OUT / sub).glob("*.ics") if p not in soll]
    for p in veraltet:
        if not args.check:
            p.unlink()
    print(f"  {len(soll)} Dateien ({len(alle)} Termine), {len(geaendert)} {'zu ändern' if args.check else 'geschrieben'}, "
          f"{len(veraltet)} veraltete entfernt")
    return 1 if (args.check and (geaendert or veraltet)) else 0


if __name__ == "__main__":
    sys.exit(main())
