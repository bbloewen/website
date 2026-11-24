#!/usr/bin/env python3
"""Bereitet die Liveticker-Daten eines Heimspiels für die 3D-Highlights auf der Spieltagsseite auf.

Anlass (Marko, 24.11.2026): Aus den Liveticker-Daten eine 3D-Nachstellung der besten Szenen bauen, erst als
Prototyp beim Spielbericht. Die Liga liefert je Aktion Werfer, Vorlage, Wurfart, Ergebnis, Spielstand, Zeit und
bei Würfen die Wurfposition. Laufwege, Ballweg und Körperbewegung fehlen; die Szene ist eine Nachstellung.

Quelle: Liga-Liveticker https://live.2basketballbundesliga.de (Spiel-ID aus dem Feld "livescore" in
data/heimspiele.json). Anfangsdaten über /init/<id>, Aktionen über socket.io ("history"). Aktionen haben die
Form [1, id, viertel, team(1=Heim,2=Gast), spieler, spieler2, restsekunden, nr1, nr2, art, info1, info2, info3,
ergebnis, punkteHeim, punkteGast, x, y]; art 3 = Zweier, 4 = Dreier; info3 51 Sprungwurf, 52 Korbleger,
53 Dunk, 54 Alley-Oop-Dunk, 55 Tip-In; ergebnis 1 Treffer, 0 daneben, sonst geblockt (spieler2 = Blocker).
x/y sind Pixel auf dem Halbfeld-Bild des Tickers (276 x 198 px, Korb bei 138/30, ca. 18,4 px je Meter).

Ausgabe: data/spiel-3d/<id>.json mit Spielinfo, allen Würfen (in Metern, Korb = Ursprung) und den
ausgewählten Highlights der Löwen. Eigene Spieler nur mit Vornamen, Gegner nur mit Nummer.

Aufruf:
  python3 tools/build-spiel-3d.py                 # alle gespielten Heimspiele ohne Datei
  python3 tools/build-spiel-3d.py --spiel 2006196 # ein Spiel (auch neu)
"""

import argparse
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "data" / "spiel-3d"
BASIS = "https://live.2basketballbundesliga.de"
LOEWEN_TEAM_ID = "563"
PX_JE_M = 18.4
KORB_PX = (138.0, 30.0)
KORB_ABSTAND_GRUNDLINIE = 1.575
WURFART = {51: "sprungwurf", 52: "korbleger", 53: "dunk", 54: "alleyoop", 55: "tipin"}
try:  # wie livescore-ids.py: lokal fehlen Python unter macOS oft die Stammzertifikate
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = ssl.create_default_context()


def holen(url, daten=None, timeout=35):
    req = urllib.request.Request(url, data=daten, headers={"User-Agent": "loewen-website/1.0",
                                                           "Content-Type": "text/plain;charset=UTF-8"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode("utf-8")


def ticker_verlauf(spiel):
    """Alle Nachrichten des Spiels über socket.io (Engine.IO 4, polling)."""
    url = f"{BASIS}/socket.io/?game={spiel}&EIO=4&transport=polling"
    sid = json.loads(holen(url)[1:])["sid"]
    url_s = f"{url}&sid={sid}"
    holen(url_s, b"40")
    holen(url_s)
    holen(url_s, f'42["history","{spiel}"]'.encode())
    roh = holen(url_s)
    nachrichten = []
    for paket in roh.split("\x1e"):
        if not paket.startswith("42"):
            continue
        try:
            d = json.loads(paket[2:])
        except ValueError:
            continue
        if len(d) > 1 and isinstance(d[1], list) and d[1]:
            nachrichten.append(d[1])
    return nachrichten


def meter(x, y):
    """Ticker-Pixel -> Meter. Ursprung = Korbmitte auf dem Boden, x quer (rechts +), z ins Feld (weg vom Korb +)."""
    return round((x - KORB_PX[0]) / PX_JE_M, 2), round((y - KORB_PX[1]) / PX_JE_M, 2)


def groessen_aus_kader():
    try:
        kader = json.loads((REPO / "data" / "kader-profis.json").read_text("utf-8"))["spieler"]
    except (OSError, KeyError, ValueError):
        return {}
    aus = {}
    for s in kader:
        m = re.search(r"(\d),(\d+)\s*m", s.get("groesse", ""))
        if m:
            aus[s["name"].lower()] = round(float(f"{m.group(1)}.{m.group(2)}"), 2)
    return aus


def aufbereiten(spiel):
    ini = json.loads(holen(f"{BASIS}/init/{spiel}"))
    loewen = 1 if str(ini["teamA"]["id"]) == LOEWEN_TEAM_ID else 2
    gegner_name = (ini["teamB"] if loewen == 1 else ini["teamA"])["caption"]
    groessen = groessen_aus_kader()
    spieler_roh = ini.get("player", {})

    def person(pid, team):
        p = spieler_roh.get(str(pid)) or {}
        nr = str(p.get("num", "")).strip()
        if team == loewen:
            name = (p.get("name") or "").strip()
            return {"team": "loewen", "nr": nr, "name": name.split(" ")[0] if name else f"#{nr}",
                    "groesse": groessen.get(name.lower(), 1.95)}
        return {"team": "gegner", "nr": nr, "name": f"#{nr}" if nr else "Gegner", "groesse": 1.95}

    aktionen = {}
    for n in ticker_verlauf(spiel):
        if n[0] == 1 and len(n) >= 16:
            aktionen[n[1]] = n
    folge = sorted(aktionen.values(), key=lambda a: a[1])

    wuerfe, kandidaten = [], []
    stand = [0, 0]
    for a in folge:
        vorher = list(stand)
        # Nicht jede Aktion trägt den Spielstand (Rebounds, Fouls stehen auf 0:0); nur vorwärts übernehmen.
        if isinstance(a[14], int) and isinstance(a[15], int) and a[14] >= stand[0] and a[15] >= stand[1] and a[14] + a[15] > 0:
            stand = [a[14], a[15]]
        if a[9] not in (3, 4) or len(a) < 18 or not (a[16] or a[17]):
            continue
        team = a[3]
        if a[13] == 1:
            ergebnis = "treffer"
        elif a[13] == 0 or not a[5]:
            ergebnis = "daneben"
        else:
            ergebnis = "geblockt"
        assist = a[5] if (ergebnis == "treffer" and a[5]) else 0
        blocker = a[5] if ergebnis == "geblockt" else 0
        x, z = meter(a[16], a[17])
        punkte_l = stand[0] if loewen == 1 else stand[1]
        punkte_g = stand[1] if loewen == 1 else stand[0]
        w = {
            "id": a[1], "viertel": a[2], "rest": a[6], "team": "loewen" if team == loewen else "gegner",
            "punkte": 3 if a[9] == 4 else 2, "art": "dreier" if a[9] == 4 else WURFART.get(a[12], "sprungwurf"),
            "ergebnis": ergebnis, "x": x, "z": z,
            "werfer": person(a[4], team), "vorlage": person(assist, team) if assist else None,
            "blocker": person(blocker, 3 - team) if blocker else None,
            "stand": [punkte_l, punkte_g],
        }
        wuerfe.append(w)

        # Highlight-Wertung nur für Szenen der Löwen
        vorher_l = vorher[0] if loewen == 1 else vorher[1]
        vorher_g = vorher[1] if loewen == 1 else vorher[0]
        punkte, grund = 0, []
        if w["team"] == "loewen" and ergebnis == "treffer":
            punkte = {"dunk": 10, "alleyoop": 12, "tipin": 5, "korbleger": 3, "sprungwurf": 2, "dreier": 6}[w["art"]]
            if assist:
                punkte += 1
            if vorher_l <= vorher_g and punkte_l > punkte_g:
                punkte += 4
                grund.append("Führung")
        elif w["team"] == "gegner" and ergebnis == "geblockt" and blocker:
            punkte = 7
            grund.append("Block")
        if punkte:
            if a[2] >= 4 and a[6] <= 120 and abs(punkte_l - punkte_g) <= 6:
                punkte += 8
                grund.append("Schlussphase")
            if a[6] <= 3:
                punkte += 8
                grund.append("Sirene")
            kandidaten.append((punkte, w["id"], grund, (w["blocker"] or w["werfer"])["name"]))

    # Höchstens zwei Szenen je Spieler, damit das Best-of mehrere Löwen zeigt
    beste, je_spieler = [], {}
    for k in sorted(kandidaten, key=lambda k: (-k[0], k[1])):
        if je_spieler.get(k[3], 0) < 2 and len(beste) < 8:
            beste.append(k)
            je_spieler[k[3]] = je_spieler.get(k[3], 0) + 1
    auswahl = {k[1]: k[2] for k in beste}
    highlights = [dict(w, grund=auswahl[w["id"]]) for w in wuerfe if w["id"] in auswahl]

    return {
        "spiel": spiel,
        "quelle": f"{BASIS}/g/{spiel}",
        "heim": loewen == 1,
        "gegner": gegner_name,
        "endstand": [stand[0], stand[1]] if loewen == 1 else [stand[1], stand[0]],
        "wuerfe": wuerfe,
        "highlights": highlights,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spiel", help="Liveticker-Spiel-ID")
    args = ap.parse_args()
    ZIEL.mkdir(parents=True, exist_ok=True)
    if args.spiel:
        ids = [args.spiel]
    else:
        heim = json.loads((REPO / "data" / "heimspiele.json").read_text("utf-8"))
        heim = heim if isinstance(heim, list) else heim.get("spiele", [])
        ids = []
        for g in heim:
            m = re.search(r"/g/(\d+)", g.get("livescore") or "")
            if m and g.get("ergebnis") and not (ZIEL / f"{m.group(1)}.json").exists():
                ids.append(m.group(1))
    for spiel in ids:
        try:
            daten = aufbereiten(spiel)
        except Exception as e:  # Ticker nicht erreichbar: beim nächsten Lauf wieder versuchen
            print(f"{spiel}: übersprungen ({e})", file=sys.stderr)
            continue
        (ZIEL / f"{spiel}.json").write_text(json.dumps(daten, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
        print(f"{spiel}: {len(daten['wuerfe'])} Würfe, {len(daten['highlights'])} Highlights")


if __name__ == "__main__":
    main()
