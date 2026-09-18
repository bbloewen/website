#!/usr/bin/env python3
"""Schreibt die Community-Events-Liste statisch in fans/community-events.html.

Warum: Die Kacheln wurden ausschliesslich im Browser aus
data/community-events.json in einen leeren Container gerendert (js/community-
events.js). Im ausgelieferten HTML stand damit kein einziger Eventname, kein
Datum, kein Ort -- fuer einen Crawler ohne JavaScript war der Abschnitt leer
(Website-Feedback MF, 18.09.2026, "Inhalte sollen im HTML stehen, nicht nur im
JSON, wegen SEO").

Gleiche Bauart wie build-freiplaetze.py / build-news-list.py: Das JavaScript
rendert die Kacheln beim Laden weiterhin selbst und ueberschreibt den
statischen Stand (u.a. fuer den Sprung zum laufenden Event). Die statische
Fassung ist nur fuer Crawler ohne JavaScript da und kann deshalb nicht falsch
werden, nur aelter -- sie wird taeglich mitgebaut, sobald der n8n-Workflow
"Website: Community-Events abrufen" data/community-events.json neu committet
(.github/workflows/freiplaetze-nachbauen.yml beobachtet diese Datei bereits).

Aufruf:
  python3 tools/build-community-events.py
  python3 tools/build-community-events.py --check
"""

import argparse
import html
import json
import re
import sys
from datetime import datetime
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from seo_common import REPO

ZIEL = REPO / "fans" / "community-events.html"
QUELLE = REPO / "data" / "community-events.json"

BERLIN = ZoneInfo("Europe/Berlin")
WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

CATEGORY_ICON = {
    "Straßenfest": ("flag", "tint-blue"),
    "Turnier": ("trophy", "tint-orange"),
    "Vereinsfest": ("party-popper", "tint-violet"),
}
FALLBACK_DESCRIPTION = "Die Basketball Löwen Erfurt sind mit dabei — Details folgen in Kürze."


def berliner_zeit(wert):
    """ISO-Zeitstempel in Berliner Zeit (gleiche Regel wie build-freiplaetze.py)."""
    zeit = datetime.fromisoformat(str(wert).replace("Z", "+00:00"))
    return zeit.replace(tzinfo=BERLIN) if zeit.tzinfo is None else zeit.astimezone(BERLIN)


def date_label(ev):
    """Wie dateLabel() im JavaScript: "Fr, 18.09.26, 16:00–19:00 Uhr"."""
    start = berliner_zeit(ev["start"])
    text = f'{WOCHENTAGE_KURZ[start.weekday()]}, {start:%d.%m.%y}'
    if not ev.get("isDatetime"):
        return text
    zeit = f'{start:%H:%M}'
    if ev.get("end"):
        zeit += f'–{berliner_zeit(ev["end"]):%H:%M}'
    return f"{text}, {zeit} Uhr"


def calendar_link(ev):
    start = berliner_zeit(ev["start"])
    ende = berliner_zeit(ev["end"]) if ev.get("end") else start
    fmt = "%Y%m%dT%H%M%S" if ev.get("isDatetime") else "%Y%m%d"
    params = {
        "action": "TEMPLATE",
        "text": ev.get("name", ""),
        "dates": f"{start.strftime(fmt)}/{ende.strftime(fmt)}",
        "location": ev.get("location", ""),
        "ctz": "Europe/Berlin",
    }
    return "https://calendar.google.com/calendar/render?" + urlencode(params, quote_via=quote)


def card_html(ev):
    e = html.escape
    icon, tint = CATEGORY_ICON.get(ev.get("category", ""), ("calendar", "tint-neutral"))
    if ev.get("heroImage"):
        media = (
            f'<div class="card-media card-media-photo" style="height:180px">'
            f'<img src="{e(ev["heroImage"])}" alt="{e(ev.get("name", ""))}" loading="lazy" /></div>'
        )
    else:
        media = (
            f'<div class="card-media {tint}" style="height:180px">'
            f'<i data-lucide="{icon}" class="icon-32"></i></div>'
        )
    location = ev.get("location") or ""
    display_location = re.sub(r",\s*(Deutschland|Germany)$", "", location)
    location_html = (
        f'<a class="t-caption" style="display:flex;align-items:center;gap:4px;margin:0 0 10px;'
        f'color:var(--text-muted)" href="https://www.google.com/maps/search/?api=1&amp;query='
        f'{quote(location)}" target="_blank" rel="noopener">'
        f'<i data-lucide="map-pin" class="icon-12"></i> {e(display_location)}</a>'
        if location else ""
    )
    court_hunt_html = (
        f'<a class="badge badge-orange" style="margin-bottom:10px" '
        f'href="/trainieren/freiplatz.html?platz={quote(ev["spotSlug"])}">'
        f'<i data-lucide="target" class="icon-12"></i> Court-Hunt-Spot: mobiler Korb vor Ort</a>'
        if ev.get("courtHunt") and ev.get("spotSlug") else ""
    )
    description = e(ev.get("description") or FALLBACK_DESCRIPTION)
    return (
        f'<div class="card hoverable camp-slider-card" data-start="{e(ev["start"])}" '
        f'data-end="{e(ev.get("end") or "")}">'
        + media
        + '<div class="card-body">'
        + f'<span class="card-label">{e(ev.get("name", ""))}</span>'
        + f'<h3 style="display:flex;align-items:center;gap:8px">{e(date_label(ev))} '
        + f'<a href="{calendar_link(ev)}" target="_blank" rel="noopener" title="Ins Kalender eintragen" '
        + 'style="display:inline-flex;color:var(--color-brand-orange-text)">'
        + '<i data-lucide="calendar-plus" class="icon-18"></i></a></h3>'
        + location_html
        + court_hunt_html
        + f'<p>{description}</p>'
        + '</div></div>'
    )


def events_schreiben(seite, events):
    karten = "\n".join("          " + card_html(ev) for ev in events)
    inhalt = (f"<!--COMMUNITY:events-->\n{karten}\n        <!--/COMMUNITY:events-->"
              if events else "<!--COMMUNITY:events--><!--/COMMUNITY:events-->")
    return re.sub(
        r"<!--COMMUNITY:events-->.*?<!--/COMMUNITY:events-->", lambda _: inhalt, seite,
        count=1, flags=re.S,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    events = json.loads(QUELLE.read_text(encoding="utf-8")).get("events", [])
    events = sorted(events, key=lambda ev: ev["start"])

    alt = ZIEL.read_text(encoding="utf-8")
    if "<!--COMMUNITY:events-->" not in alt:
        marker = '<div class="news-slider-track"></div>'
        ziel_stelle = alt.find('id="community-events-termine"')
        if ziel_stelle == -1 or marker not in alt[ziel_stelle:]:
            print("  ACHTUNG Container #community-events-termine nicht gefunden", file=sys.stderr)
            return 1
        einfuegestelle = alt.index(marker, ziel_stelle)
        alt = (
            alt[:einfuegestelle]
            + '<div class="news-slider-track"><!--COMMUNITY:events--><!--/COMMUNITY:events--></div>'
            + alt[einfuegestelle + len(marker):]
        )

    neu = events_schreiben(alt, events)

    fehlend = [ev["name"] for ev in events if html.escape(ev["name"]) not in neu]
    if fehlend:
        print(f"  ACHTUNG {len(fehlend)} Events fehlen im Ergebnis: {fehlend}", file=sys.stderr)
        return 1

    if neu == ZIEL.read_text(encoding="utf-8"):
        print(f"  unverändert, {len(events)} Events verlinkt")
        return 0
    if args.check:
        print(f"  zu bauen: {len(events)} Events")
        return 1

    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(events)} Events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
