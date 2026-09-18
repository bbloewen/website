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

from seo_common import BASE, REPO

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
    # Court-Hunt-Spot-Hinweis als schraeges Eckband ueber dem Bild statt als
    # Pillen-Badge im Kartentext -- kuerzerer Text, aber weiterhin ein Link
    # zum Freiplatz (Marko, 18.09.2026).
    court_hunt_ribbon = (
        f'<div class="ribbon-corner"><a class="card-media-ribbon" '
        f'href="/trainieren/freiplatz.html?platz={quote(ev["spotSlug"])}">Court-Hunt-Spot</a></div>'
        if ev.get("courtHunt") and ev.get("spotSlug") else ""
    )
    if ev.get("heroImage"):
        media = (
            f'<div class="card-media card-media-photo" style="height:180px">'
            f'<img src="{e(ev["heroImage"])}" alt="{e(ev.get("name", ""))}" loading="lazy" />'
            + court_hunt_ribbon + '</div>'
        )
    else:
        media = (
            f'<div class="card-media {tint}" style="height:180px">'
            f'<i data-lucide="{icon}" class="icon-32"></i>' + court_hunt_ribbon + '</div>'
        )
    location = ev.get("location") or ""
    display_location = re.sub(r",\s*(Deutschland|Germany)$", "", location)
    display_location = re.sub(r"\b\d{5}\s+(Erfurt)\b", r"\1", display_location)
    # "Online" ist kein Ort mit Maps-Link, sondern ein reiner Hinweis (z.B.
    # Erfurt-Crowd-Seminar per Videocall) -- eigenes Icon, kein <a>.
    if location == "Online":
        location_html = (
            '<span class="t-caption card-location" style="display:flex;align-items:center;gap:4px;'
            'margin:0 0 10px;color:var(--text-muted)"><i data-lucide="map-pin" class="icon-12"></i> '
            '<span class="card-location-text">Online</span></span>'
        )
    elif location:
        location_html = (
            f'<a class="t-caption card-location" style="display:flex;align-items:center;gap:4px;margin:0 0 10px;'
            f'color:var(--text-muted)" href="https://www.google.com/maps/search/?api=1&amp;query='
            f'{quote(location)}" target="_blank" rel="noopener">'
            f'<i data-lucide="map-pin" class="icon-12"></i> <span class="card-location-text">{e(display_location)}</span></a>'
        )
    else:
        location_html = ""
    # Bewusst nicht html.escape()-t (anders als sonst): description darf einen
    # einfachen <a>-Link enthalten (z.B. Verweis auf die Seite des externen
    # Veranstalters mitten im Satz), analog zur JS-Fassung, die description
    # ebenfalls ungeprueft einfuegt. Kommt nur aus unserer eigenen Pflege,
    # nicht direkt aus Notion-Nutzereingaben.
    description = ev.get("description") or FALLBACK_DESCRIPTION
    url_html = (
        f'<a class="card-link mt-2" href="{e(ev["url"])}" target="_blank" rel="noopener">'
        f'Mehr erfahren <i data-lucide="arrow-right" class="icon-14"></i></a>'
        if ev.get("url") else ""
    )
    return (
        f'<div class="card hoverable camp-slider-card" data-start="{e(ev["start"])}" '
        f'data-end="{e(ev.get("end") or "")}">'
        + media
        + '<div class="card-body">'
        # Eventname ist die Ueberschrift der Kachel (h3), Datum/Zeit nur ein
        # Hinweis-Label davor -- gleiche Rollenverteilung wie bei den Court-
        # Hunt-Spot-Kacheln auf freiplaetze.html (Marko, 18.09.2026).
        + f'<span class="card-label" style="display:flex;align-items:center;gap:8px">{e(date_label(ev))} '
        + f'<a href="{calendar_link(ev)}" target="_blank" rel="noopener" title="Ins Kalender eintragen" '
        + 'style="display:inline-flex;color:var(--color-brand-orange-text)">'
        + '<i data-lucide="calendar-plus" class="icon-18"></i></a></span>'
        + f'<h3>{e(ev.get("name", ""))}</h3>'
        + location_html
        + f'<p>{description}</p>'
        + url_html
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


TAG_RE = re.compile(r"<[^>]+>")


def event_ldjson(ev):
    """Ein Event-Objekt nach schema.org, gleiche Bauart wie die SportsEvent-
    Objekte auf den Gameday-Seiten (tools/build-head-meta.py-Aequivalent
    dort ist von Hand in jeder Gameday-Seite gepflegt) -- hier automatisch
    aus den gleichen Feldern, die auch die Kachel fuellen, damit sich Text
    und Strukturdaten nie auseinander entwickeln."""
    obj = {
        "@type": "Event",
        "name": ev.get("name", ""),
        "description": TAG_RE.sub("", ev.get("description") or FALLBACK_DESCRIPTION),
        "startDate": ev["start"],
        "eventStatus": "https://schema.org/EventScheduled",
        "organizer": {"@type": "Organization", "name": "Basketball Löwen Erfurt", "url": BASE},
    }
    if ev.get("end"):
        obj["endDate"] = ev["end"]
    if ev.get("heroImage"):
        obj["image"] = ev["heroImage"]
    location = ev.get("location") or ""
    if location == "Online":
        obj["eventAttendanceMode"] = "https://schema.org/OnlineEventAttendanceMode"
        obj["location"] = {"@type": "VirtualLocation", "url": f"{BASE}fans/community-events.html"}
    elif location:
        obj["eventAttendanceMode"] = "https://schema.org/OfflineEventAttendanceMode"
        place = {"@type": "Place", "name": location, "address": location}
        if ev.get("lat") and ev.get("lng"):
            place["geo"] = {"@type": "GeoCoordinates", "latitude": ev["lat"], "longitude": ev["lng"]}
        obj["location"] = place
    return obj


def events_ldjson_schreiben(seite, events):
    ldjson = json.dumps(
        {"@context": "https://schema.org", "@graph": [event_ldjson(ev) for ev in events]},
        ensure_ascii=False, separators=(",", ":"),
    )
    inhalt = f'<!--COMMUNITY:eventsld--><script type="application/ld+json">{ldjson}</script><!--/COMMUNITY:eventsld-->'
    return re.sub(
        r"<!--COMMUNITY:eventsld-->.*?<!--/COMMUNITY:eventsld-->", lambda _: inhalt, seite,
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

    # Event-Strukturdaten separat von SEO:auto (tools/build-head-meta.py),
    # damit sich die beiden Skripte beim Ueberschreiben nicht in die Quere
    # kommen -- eigener Marker direkt nach dessen Block.
    if "<!--COMMUNITY:eventsld-->" not in alt:
        anker = "<!-- SEO:auto END -->"
        if anker not in alt:
            print("  ACHTUNG SEO:auto END nicht gefunden", file=sys.stderr)
            return 1
        alt = alt.replace(anker, anker + "\n<!--COMMUNITY:eventsld--><!--/COMMUNITY:eventsld-->", 1)

    neu = events_schreiben(alt, events)
    neu = events_ldjson_schreiben(neu, events)

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
