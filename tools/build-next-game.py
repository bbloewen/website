#!/usr/bin/env python3
"""Schreibt das Spieltags-Widget im Startseiten-Hero statisch.

Warum: #next-game-card wird zur Laufzeit per JavaScript befuellt
(js/home-next-game.js). Im ausgelieferten HTML stuenden sonst nur
Platzhalter -- kein Gegner, kein Datum, kein CTA-Link -- auf der
wichtigsten Seite der Domain. Gleiche Luecke wie zuvor bei Event-Liste,
Freiplaetzen, News, Partnerwand, Bildergalerien und Fanshop, hier mit
demselben Muster behoben.

Wie der Fix funktioniert: Die Slides werden hier gebaut und zwischen
Markern in die Seite geschrieben. js/home-next-game.js ersetzt den Inhalt
beim Laden weiterhin per innerHTML -- fuer Besucher aendert sich nichts.
Die Ueberschrift bekommt hier eine konservative feste Schriftgroesse
(15px, passt auch fuer lange Gegnernamen); js/home-next-game.js passt sie
nach dem Laden per echter Pixel-Messung (fitSlide/fitOneLine) noch feiner an.
Spiegelt sonst die dortige Logik (aktuelles Spiel + naechste zwei,
Eyebrow/Zeilen je Spiel); aendert sich das Skript, muss es hier mit --
deshalb der Ankerpruef beim Start.

Aufruf:
  python3 tools/build-next-game.py
  python3 tools/build-next-game.py --check
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode

from seo_common import REPO, esc

ZIEL = REPO / "index.html"
DATEN_HEIM = REPO / "data" / "heimspiele.json"
DATEN_SAISON = REPO / "data" / "spielplan-saison.json"
CONTAINER = "next-game-card"

WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]  # Index = Python weekday()+1 % 7 (So=0)
RIETHSPORTHALLE_MAPS_URL = "https://www.google.com/maps/search/?api=1&query=Essener+Stra%C3%9Fe+20%2C+99089+Erfurt"
TABELLE_URL = "/saison/tabelle.html#tabelle-profis"
GENERISCHER_LIVESTREAM_URL = "https://sporteurope.tv/catl-basketball-loewen"

JS_ANKER = [
    "var GENERISCHER_LIVESTREAM_URL = 'https://sporteurope.tv/catl-basketball-loewen';",
    "var label = g.heim ? (++heimZaehler + '. Heimspiel') : 'Auswärts mit Gebrüll';",
]


def cutoff_dienstag(d):
    # Python date.weekday(): Montag=0 ... Sonntag=6 -- auf JS-Wochentagslogik
    # (getDay(): Sonntag=0 ... Samstag=6) umgerechnet, damit dieselbe Formel
    # wie in js/home-next-game.js gilt.
    js_tag = (d.weekday() + 1) % 7
    tage_bis = (2 - js_tag + 7) % 7
    if tage_bis == 0:
        tage_bis = 7
    return d + timedelta(days=tage_bis)


def lade_spiele():
    heim = json.loads(DATEN_HEIM.read_text(encoding="utf-8"))["spiele"]
    saison = json.loads(DATEN_SAISON.read_text(encoding="utf-8"))["profisAuswaerts"]
    alle = []
    for s in heim:
        g = dict(s)
        g["heim"] = True
        g["date"] = datetime.strptime(s["datum"], "%d.%m.%Y").date()
        alle.append(g)
    for s in saison:
        g = dict(s)
        g["heim"] = False
        g["date"] = datetime.strptime(s["datum"], "%d.%m.%Y").date()
        alle.append(g)
    alle.sort(key=lambda g: (g["date"], g["zeit"]))
    return alle


def gcal_stamp(d):
    return d.strftime("%Y%m%dT%H%M%S")


def calendar_link(g):
    stunde, minute = (int(x) for x in (g.get("zeit") or "00:00").split(":"))
    start = datetime(g["date"].year, g["date"].month, g["date"].day, stunde, minute)
    ende = start + timedelta(hours=2)
    text = f'Basketball Löwen – {g["gegner"]}' if g["heim"] else f'{g["gegner"]} – Basketball Löwen'
    params = {
        "action": "TEMPLATE",
        "text": text,
        "dates": f"{gcal_stamp(start)}/{gcal_stamp(ende)}",
        "details": "Heimspiel der Basketball Löwen Erfurt in der Riethsporthalle." if g["heim"] else "Auswärtsspiel der Basketball Löwen Erfurt.",
        "ctz": "Europe/Berlin",
    }
    if g["heim"]:
        params["location"] = "Essener Straße 20, 99089 Erfurt"
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


def venue_maps_link(g):
    if g["heim"]:
        return RIETHSPORTHALLE_MAPS_URL
    q = g.get("adresse") or g.get("ort")
    return f"https://www.google.com/maps/search/?api=1&query={quote(q)}" if q else None


def slide_html(g, i, label, heute):
    matchup = f'Basketball Löwen – {esc(g["gegner"])}' if g["heim"] else f'{esc(g["gegner"])} – Basketball Löwen'
    venue = "Riethsporthalle" if g["heim"] else esc(g.get("halle") or g.get("ort") or "")
    venue_link = venue_maps_link(g)
    d = g["date"]
    js_tag = (d.weekday() + 1) % 7
    kurz_datum = f"{WOCHENTAGE[js_tag]}, {d.day:02d}.{d.month:02d}."

    termin_html = (
        f'<a href="{calendar_link(g)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">'
        '<i data-lucide="calendar" style="width:14px;height:14px;flex-shrink:0"></i>'
        f'{kurz_datum}, <strong>{esc(g["zeit"])} Uhr</strong></a>'
        + (f', <a href="{esc(venue_link)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">{venue}</a>' if venue else "")
    )

    if g.get("spielberichtUrl"):
        bericht_label = "Vorbericht" if g["date"] >= heute else "Nachbericht"
        bericht_icon = f'<a class="cal-link" href="{esc(g["spielberichtUrl"])}" title="Zum {bericht_label}"><i data-lucide="file-text" style="width:14px;height:14px"></i></a>'
    else:
        bericht_icon = '<span class="cal-link" style="opacity:.4;cursor:default" title="Spielbericht folgt"><i data-lucide="file-text" style="width:14px;height:14px"></i></span>'

    livestream_url = esc(g.get("livestream") or GENERISCHER_LIVESTREAM_URL)

    if g["heim"]:
        cta_html = (
            '<a class="btn btn-primary btn-sm" style="color:#fff" href="/saison/profis/gameday/">'
            '<i data-lucide="ticket" style="width:14px;height:14px"></i> Tickets</a>'
            '<a class="btn btn-ghost btn-sm" href="/tickets/dauerkarte.html">Dauerkarte</a>'
        )
    else:
        cta_html = (
            '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html">'
            '<i data-lucide="ticket" style="width:14px;height:14px"></i> Heimspiel-Dauerkarte</a>'
        )

    return (
        f'<div class="next-game-slide{" is-active" if i == 0 else ""}">'
        f'<span class="eyebrow">{label}</span>'
        f'<h3 class="t-h4" style="margin:10px 0 6px;white-space:nowrap;overflow:hidden;font-size:15px">{matchup}</h3>'
        f'<p class="t-body-sm next-game-termin" style="margin-bottom:10px;white-space:nowrap;overflow:hidden">{termin_html}</p>'
        f'<div class="fixture-result-row" style="margin-bottom:12px;flex-wrap:wrap">'
        f'<div class="fixture-result">{esc(g.get("ergebnis") or "– – : – –")}</div>'
        f'<a class="cal-link" href="{TABELLE_URL}" title="Zur Tabelle" style="margin-left:8px"><i data-lucide="list-ordered" style="width:14px;height:14px"></i></a>'
        f'{bericht_icon}'
        f'<a class="card-link" href="{livestream_url}" target="_blank" rel="noopener" style="margin-left:4px"><i data-lucide="video" style="width:14px;height:14px"></i> Zum Livestream</a>'
        "</div>"
        f'<div style="display:flex;gap:10px;flex-wrap:wrap">{cta_html}</div>'
        "</div>"
    )


def dot_html(g, i, gesamt):
    return (f'<button class="news-dot{" is-active" if i == 0 else ""}" data-slide-to="{i}" '
            f'aria-label="Spiel {i + 1} von {gesamt}: gegen {esc(g["gegner"])}"></button>')


def ersetze(text, container_id, inhalt):
    start, ende = f"<!--NEXTGAME:{container_id}-->", f"<!--/NEXTGAME:{container_id}-->"
    neu_block = f"{start}{inhalt}{ende}"
    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]
    muster = re.compile(r'(<div[^>]*\bid="' + re.escape(container_id) + r'"[^>]*>).*?(</div>)', re.S)
    m = muster.search(text)
    if not m:
        raise SystemExit(f"Container id={container_id} nicht gefunden")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    js = (REPO / "js" / "home-next-game.js").read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/home-next-game.js hat sich geändert — dieses Skript "
                              "muss nachgezogen werden, bevor es wieder läuft.")

    heute = datetime.now().date()
    alle = lade_spiele()

    vergangene = [g for g in alle if g["date"] <= heute]
    aktuell = None
    if vergangene:
        letztes = vergangene[-1]
        if heute < cutoff_dienstag(letztes["date"]):
            aktuell = letztes

    kommende = [g for g in alle if g["date"] > heute][:2]
    slides_daten = ([aktuell] if aktuell else []) + kommende

    if not slides_daten:
        neu = ersetze(ZIEL.read_text(encoding="utf-8"), CONTAINER, "")
        ZIEL.write_text(neu, encoding="utf-8")
        print("  geschrieben: kein Spiel im Widget")
        return 0

    heim_zaehler = 0
    slides = []
    for i, g in enumerate(slides_daten):
        if g["heim"]:
            heim_zaehler += 1
            label = f"{heim_zaehler}. Heimspiel"
        else:
            label = "Auswärts mit Gebrüll"
        slides.append(slide_html(g, i, label, heute))

    dots = ""
    if len(slides_daten) > 1:
        dots = '<div class="news-dots">' + "".join(dot_html(g, i, len(slides_daten)) for i, g in enumerate(slides_daten)) + "</div>"

    inhalt = f'<div class="next-game-slides">{"".join(slides)}</div>{dots}'

    alt = ZIEL.read_text(encoding="utf-8")
    neu = ersetze(alt, CONTAINER, inhalt)

    if neu == alt:
        print(f"  unverändert, {len(slides_daten)} Spiel(e) im Widget")
        return 0
    if args.check:
        print("  zu ändern: index.html")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(slides_daten)} Spiel(e) im Widget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
