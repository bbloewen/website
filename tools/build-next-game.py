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
beim Laden weiterhin per innerHTML -- fuer Besucher aendert sich nichts,
Klick-Punkte arbeiten unveraendert auf dem JS-Ergebnis. Spiegelt die dortige
Logik (aktuelles Spiel + naechste zwei, Heim/Auswaerts-CTAs); aendert sich
das Skript, muss es hier mit -- deshalb der Ankerpruef beim Start.

Aufruf:
  python3 tools/build-next-game.py
  python3 tools/build-next-game.py --check
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta

from seo_common import REPO, esc

ZIEL = REPO / "index.html"
DATEN_HEIM = REPO / "data" / "heimspiele.json"
DATEN_SAISON = REPO / "data" / "spielplan-saison.json"
CONTAINER = "next-game-card"

MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
          "September", "Oktober", "November", "Dezember"]

JS_ANKER = [
    "'<span class=\"eyebrow\">' + label + '</span>' +",
    "ctaPrimary = '<a class=\"btn btn-primary btn-sm\" style=\"color:#fff\" href=\"' + g.livestream + '\" target=\"_blank\" rel=\"noopener\"><i data-lucide=\"video\" style=\"width:14px;height:14px\"></i> Zum Livestream</a>';",
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


def badge_html(g):
    return '<span class="venue-heim">Heimspiel</span>' if g["heim"] else '<span class="venue-auswaerts">Auswärts</span>'


def slide_html(g, i, label, ist_aktuell, ist_naechstes_heimspiel, heute):
    matchup = f'Basketball Löwen – {esc(g["gegner"])}' if g["heim"] else f'{esc(g["gegner"])} – Basketball Löwen'
    venue = "Riethsporthalle" if g["heim"] else esc(g.get("halle") or g.get("ort") or "")
    d = g["date"]
    date_str = f"{d.day}. {MONATE[d.month - 1]} {d.year}"

    if not g["heim"] and g.get("livestream"):
        cta_primary = (
            f'<a class="btn btn-primary btn-sm" style="color:#fff" href="{esc(g["livestream"])}" target="_blank" rel="noopener">'
            '<i data-lucide="video" style="width:14px;height:14px"></i> Zum Livestream</a>'
        )
    elif ist_naechstes_heimspiel:
        cta_primary = (
            '<a class="btn btn-primary btn-sm" style="color:#fff" href="/saison/profis/gameday/">'
            '<i data-lucide="ticket" style="width:14px;height:14px"></i> Tickets &amp; Gameday</a>'
        )
    else:
        cta_primary = (
            '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html">'
            '<i data-lucide="ticket" style="width:14px;height:14px"></i> Dauerkarte kaufen</a>'
        )

    ergebnis_html = ""
    if ist_aktuell:
        bericht_link = ""
        if g.get("spielberichtUrl"):
            bericht_label = "Vorbericht" if g["date"] >= heute else "Nachbericht"
            bericht_link = (
                f'<a class="card-link" href="{esc(g["spielberichtUrl"])}">{bericht_label} '
                '<i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>'
            )
        ergebnis_html = (
            '<div class="fixture-result-row" style="margin-bottom:12px">'
            f'<div class="fixture-result">{esc(g.get("ergebnis") or "– – : – –")}</div>'
            f"{bericht_link}</div>"
        )

    return (
        f'<div class="next-game-slide{" is-active" if i == 0 else ""}">'
        f'<span class="eyebrow">{label}</span>'
        f'<h3 class="t-h4" style="margin:10px 0 6px">{matchup}</h3>'
        '<p class="t-body-sm" style="margin-bottom:12px;display:flex;flex-direction:column;gap:4px">'
        f"{badge_html(g)}"
        f'<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="calendar" style="width:14px;height:14px"></i>{date_str}, {esc(g["zeit"])} Uhr</span>'
        + (f'<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="map-pin" style="width:14px;height:14px"></i>{venue}</span>' if venue else "")
        + "</p>"
        + ergebnis_html
        + f'<div style="display:flex;gap:10px;flex-wrap:wrap">{cta_primary}<a class="btn btn-ghost btn-sm" href="/saison/spielplan.html">Zum Spielplan</a></div>'
        + "</div>"
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

    naechstes_heimspiel = None
    for g in alle:
        if g["heim"] and g.get("spielberichtUrl") and g["date"] >= heute:
            naechstes_heimspiel = g
            break

    labels_kommend = ["Nächstes Spiel", "Übernächstes Spiel"]
    slides = []
    for i, g in enumerate(slides_daten):
        ist_aktuell = g is aktuell
        label = "Aktuelles Spiel" if ist_aktuell else labels_kommend[kommende.index(g)]
        slides.append(slide_html(g, i, label, ist_aktuell, g is naechstes_heimspiel, heute))

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
