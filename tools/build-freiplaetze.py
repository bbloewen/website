#!/usr/bin/env python3
"""Schreibt die Freiplatz-Liste statisch in trainieren/freiplaetze.html.

Warum: Die Freiplätze wurden ausschliesslich im Browser aus
data/freiplaetze.json in leere Container gerendert. Im ausgelieferten HTML stand
damit **kein einziger Platzname und keine einzige Adresse** -- fuer einen
Crawler ohne JavaScript war die Seite 210 Woerter Einleitung und sonst nichts.

Das ist ausgerechnet auf der Seite mit dem staerksten lokalen Inhalt, den wir
haben: sechs benannte, mit Adresse belegte oeffentliche Basketballplaetze in
Erfurt, die sonst niemand gesammelt anbietet. Genau dieser Text ist es, der auf
"basketballplatz erfurt", "streetball erfurt" oder "3x3 erfurt" einzahlt.

Gleiche Bauart wie build-news-list.py: Das JavaScript rendert die Kacheln beim
Laden weiterhin selbst und ueberschreibt den statischen Stand. Die statische
Fassung ist nur fuer Crawler ohne JavaScript da und kann deshalb nicht falsch
werden, nur aelter.

Seit 25.08.2026 schreibt das Skript zusaetzlich die Court-Hunt-Spots (mobiler
Korb bei Strassenfesten) in denselben Seiten-Abschnitt. Quelle dafuer ist
data/community-events.json, die der n8n-Workflow "Website: Community-Events
abrufen" taeglich schreibt -- vergangene Spots bleiben dort erhalten, in die
Seite kommen aber nur laufende und kommende. Weil die Datei taeglich neu
committet wird, baut die GitHub-Action den statischen Stand taeglich mit.

Bewusster Unterschied zur JS-Fassung: **ohne Medienblock**. Die Kacheln binden
Karten-iframes ein; statisch vorgerendert wuerden drei Google-Maps-iframes beim
ersten Aufbau laden, nur um Sekundenbruchteile spaeter vom JavaScript ersetzt zu
werden. Bilder tragen zur Auffindbarkeit hier nichts bei -- der Text tut es.

Aufruf:
  python3 tools/build-freiplaetze.py
  python3 tools/build-freiplaetze.py --check
"""

import argparse
import html
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from seo_common import REPO

ZIEL = REPO / "trainieren" / "freiplaetze.html"
QUELLE = REPO / "data" / "freiplaetze.json"
EVENTS = REPO / "data" / "community-events.json"

# Wochentage von Hand statt ueber locale: Auf dem GitHub-Runner ist de_DE nicht
# installiert, strftime("%A") lieferte dort englische Namen.
WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

# Spot-Zeiten kommen seit 25.08.2026 als UTC mit Z aus dem Notion-Sync und
# werden hier in Berliner Zeit angezeigt -- das Fest findet in Erfurt statt.
BERLIN = ZoneInfo("Europe/Berlin")

# Zwei Container, zwei Bloecke: offene Plaetze und solche mit eingeschraenktem
# Zugang. Die Trennung stammt aus dem JavaScript (spielbar()) und wird hier
# nachgebaut, damit beide Fassungen dieselbe Reihenfolge zeigen.
CONTAINER = {
    "offen": '<div class="grid-2" id="freiplaetze-grid">',
    "weitere": '<div class="grid-2" id="freiplaetze-grid-weitere">',
}


def spielbar(f):
    return f.get("zugang") != "eingeschraenkt"


def maps_url(f):
    return f"https://www.google.com/maps/search/?api=1&query={f['lat']},{f['lng']}"


def platz_url(slug):
    """Spiegelt platzUrl() in js/freiplaetze.js.

    Feste Plaetze haben seit dem 25.08.2026 eine eigene, indexierbare Seite;
    Event-Spots am mobilen Korb gelten nur einen Tag und bleiben auf der
    parametergesteuerten Huelle. Merkmal ist der Praefix 'event-'.
    """
    if slug.startswith("event-"):
        return "/trainieren/freiplatz.html?platz=" + slug
    return f"/trainieren/freiplatz/{slug}.html"


def mit_links(text, links):
    """[Beschriftung] im Text zu Links aufloesen -- wie mitLinks() im JavaScript.

    Nur https-Ziele werden verlinkt, alles andere bleibt schlichter Text.
    """
    links = links or {}

    def ersetze(m):
        ziel = links.get(m.group(1), "")
        if not str(ziel).startswith("https://"):
            return html.escape(m.group(1))
        return (f'<a href="{html.escape(ziel)}" target="_blank" rel="noopener">'
                f"{html.escape(m.group(1))}</a>")

    return re.sub(r"\[([^\]]+)\]", ersetze, html.escape(text))


def kachel(f):
    e = html.escape
    teile = ['<div class="card freiplatz-card">']
    if not spielbar(f):
        teile.append(
            '<div class="freiplatz-zugang-banner"><i data-lucide="lock" class="icon-16"></i> '
            + e(f.get("zugangHinweis") or "Zugang eingeschränkt") + "</div>"
        )
    teile.append('<div class="card-body">')
    teile.append(f"<h3>{e(f['name'])}</h3>")
    teile.append(f"<p>{e(f.get('beschreibung', ''))}</p>")
    if not spielbar(f) and f.get("zugangDetail"):
        teile.append('<p class="freiplatz-zugang-detail">'
                     + mit_links(f["zugangDetail"], f.get("zugangLinks")) + "</p>")
    teile.append(
        f'<a class="freiplatz-adresse-link" href="{maps_url(f)}" target="_blank" rel="noopener">'
        f'<i data-lucide="map-pin" class="icon-16"></i> {e(f["adresse"])}</a>'
    )
    teile.append(
        f'<a class="card-link" href="{platz_url(f["slug"])}">'
        + ("Platz öffnen und einchecken" if spielbar(f) else "Platz ansehen")
        + ' <i data-lucide="arrow-right" class="icon-14"></i></a>'
    )
    teile.append("</div></div>")
    return "".join(teile)


def berliner_zeit(wert):
    """ISO-Zeitstempel in Berliner Zeit.

    Ohne Zeitzonen-Angabe (Altbestand vor dem 25.08.2026) gilt die Angabe als
    Ortszeit -- genauso liest sie der Browser mit new Date().
    """
    zeit = datetime.fromisoformat(str(wert).replace("Z", "+00:00"))
    return zeit.replace(tzinfo=BERLIN) if zeit.tzinfo is None else zeit.astimezone(BERLIN)


def spots_lesen(jetzt):
    """Alle Court-Hunt-Spots aus den Community-Events, chronologisch.

    Vergangene bleiben mit drin (vorbei=True) statt zu verschwinden -- Aufkleber
    und geteilte Links sollen nicht ins Leere zeigen, und wer den Streifen
    zurueckscrollt, soll die Geschichte des Spiels sehen koennen.
    """
    if not EVENTS.exists():
        return []
    events = json.loads(EVENTS.read_text(encoding="utf-8")).get("events", [])
    spots = []
    for e in events:
        if not (e.get("courtHunt") and e.get("spotSlug") and e.get("spotVon") and e.get("spotBis")):
            continue
        if not isinstance(e.get("lat"), (int, float)) or not isinstance(e.get("lng"), (int, float)):
            continue
        try:
            von, bis = berliner_zeit(e["spotVon"]), berliner_zeit(e["spotBis"])
        except ValueError:
            continue
        spots.append({
            "slug": e["spotSlug"], "name": e.get("name", "Court-Hunt-Spot"),
            "adresse": re.sub(r",\s*(Deutschland|Germany)$", "", e.get("location", "")),
            "lat": e["lat"], "lng": e["lng"],
            "von": von, "bis": bis, "laeuft": von <= jetzt <= bis, "vorbei": bis < jetzt,
        })
    spots.sort(key=lambda sp: sp["von"])
    return spots


def spot_zeit_text(sp):
    """Wie spotZeitText() im JavaScript: "Samstag, 12.09., 06:00 bis 22:00 Uhr"."""
    von, bis = sp["von"], sp["bis"]
    return (f"{WOCHENTAGE[von.weekday()]}, {von:%d.%m.}, {von:%H:%M} bis {bis:%H:%M} Uhr")


def spot_kachel(sp):
    e = html.escape
    vorbei_klasse = " ist-vorbei" if sp["vorbei"] else ""
    if sp["vorbei"]:
        status, zeile = "Vorbei", f'War aktiv am {e(spot_zeit_text(sp))}.'
    elif sp["laeuft"]:
        status, zeile = "Heute aktiv", f'Jetzt aktiv: {e(spot_zeit_text(sp))} — 50 Punkte am mobilen Korb.'
    else:
        status, zeile = "Court-Hunt-Spot", f'Aktiv am {e(spot_zeit_text(sp))} — dann gibt es hier 50 Punkte.'
    teile = [
        f'<div class="card hoverable camp-slider-card{vorbei_klasse}">',
        '<div class="card-media tint-violet" style="height:140px">'
        '<i data-lucide="calendar-clock" class="icon-32"></i></div>',
        '<div class="card-body">',
        f'<span class="card-label">{status}</span>',
        f'<h3>{e(sp["name"])}</h3>',
        f'<p class="freiplatz-spot-zeit"><i data-lucide="calendar-clock" class="icon-16"></i> {zeile}</p>',
    ]
    if sp["adresse"]:
        teile.append(
            f'<a class="freiplatz-adresse-link" href="{maps_url(sp)}" target="_blank" rel="noopener">'
            f'<i data-lucide="map-pin" class="icon-16"></i> {e(sp["adresse"])}</a>'
        )
    teile.append(
        f'<a class="card-link" href="{platz_url(sp["slug"])}">'
        + ("Spot öffnen und einchecken" if sp["laeuft"] else "Spot ansehen")
        + ' <i data-lucide="arrow-right" class="icon-14"></i></a>'
    )
    teile.append("</div></div>")
    return "".join(teile)


def spots_schreiben(seite, spots):
    """Spot-Kacheln in den Slider schreiben und den Abschnitt auf-/zuklappen.

    Ohne Spots bleibt der Abschnitt versteckt -- eine leere Ueberschrift
    "Spots an Veranstaltungstagen" waere schlechter als gar keine.
    """
    karten = "\n".join("          " + spot_kachel(sp) for sp in spots)
    inhalt = (f"<!--COURTHUNT:spots-->\n{karten}\n        <!--/COURTHUNT:spots-->"
              if spots else "<!--COURTHUNT:spots--><!--/COURTHUNT:spots-->")
    seite = re.sub(
        r"<!--COURTHUNT:spots-->.*?<!--/COURTHUNT:spots-->", lambda _: inhalt, seite,
        count=1, flags=re.S,
    )
    return re.sub(
        r'<section class="section" id="court-hunt-spots"( hidden)?>',
        '<section class="section" id="court-hunt-spots"' + ("" if spots else " hidden") + ">",
        seite, count=1,
    )


def block(name, plaetze):
    start, ende = f"<!--FREIPLAETZE:{name}-->", f"<!--/FREIPLAETZE:{name}-->"
    karten = "\n".join("        " + kachel(f) for f in plaetze)
    inhalt = f"{start}\n{karten}\n      {ende}" if plaetze else f"{start}{ende}"
    return CONTAINER[name] + inhalt + "</div>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    plaetze = json.loads(QUELLE.read_text(encoding="utf-8")).get("freiplaetze", [])
    gruppen = {
        "offen": [f for f in plaetze if spielbar(f)],
        "weitere": [f for f in plaetze if not spielbar(f)],
    }

    alt = ZIEL.read_text(encoding="utf-8")
    neu = alt
    for name, gruppe in gruppen.items():
        neuer = block(name, gruppe)
        gebaut = re.compile(
            re.escape(CONTAINER[name]) + rf"<!--FREIPLAETZE:{name}-->.*?<!--/FREIPLAETZE:{name}--></div>",
            re.S,
        )
        if gebaut.search(neu):
            neu = gebaut.sub(lambda _: neuer, neu, count=1)
        elif CONTAINER[name] + "</div>" in neu:
            neu = neu.replace(CONTAINER[name] + "</div>", neuer, 1)
        else:
            print(f"  ACHTUNG Container {CONTAINER[name]} nicht gefunden", file=sys.stderr)
            return 1

    spots = spots_lesen(datetime.now(BERLIN))
    neu = spots_schreiben(neu, spots)

    fehlend = [f["name"] for f in plaetze if html.escape(f["name"]) not in neu]
    if fehlend:
        print(f"  ACHTUNG {len(fehlend)} Plätze fehlen im Ergebnis: {fehlend}", file=sys.stderr)
        return 1

    if neu == alt:
        print(f"  unverändert, {len(plaetze)} Plätze + {len(spots)} Spots verlinkt")
        return 0
    if args.check:
        print(f"  zu bauen: {len(plaetze)} Plätze + {len(spots)} Spots")
        return 1

    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(gruppen['offen'])} offene + {len(gruppen['weitere'])} eingeschränkte Plätze"
          f", {len(spots)} Court-Hunt-Spots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
