#!/usr/bin/env python3
"""Schreibt die 14 Heimspiele statisch in Spielplan und Ticket-Uebersicht.

Anlass: Der Ahrefs-Crawl vom 25.08.2026 hat alle 14 Spieltagsseiten als
"Orphan page" gemeldet -- ohne einen einzigen eingehenden internen Link. Die
Adressen standen zwar im JSON-LD in der <head>, im Koerper der Seite aber nicht
ein einziges Mal als href: Die Spielplan-Liste entsteht erst im Browser in
js/spielplan.js (renderDayList schreibt in #spielplan-tage), und dort verlinkt
sie die Spieltagsseite nur ueber ein Icon.

Damit war der Spielplan fuer einen Menschen mit JavaScript ein Verzeichnis, fuer
Google eine leere Seite -- und die 14 Seiten hingen ohne Linkfluss in der
Sitemap. Es ist dasselbe Muster, das schon bei Navigation, News-Liste,
Freiplaetzen, Instagram-Archiv und Court-Hunt aufgeraeumt wurde: Inhalt, der nur
im JavaScript existiert.

Bewusst nur die Heimspiele, nicht der volle Spielplan: Auswaertsspiele und die
Termine von Damen und U19 zeigen auf keine eigene Seite, tragen also keinen Link
bei. Den vollen, filterbaren Plan baut weiterhin das JavaScript -- es ersetzt
den Inhalt von #spielplan-tage beim Laden komplett. Wer ohne JavaScript kommt,
sieht ab jetzt wenigstens die Heimspiele statt einer leeren Seite; vorher war da
nichts.

Die Markup-Struktur spiegelt gameRowHTML() aus js/spielplan.js, damit der
statische Stand nicht fuer den Moment vor dem Laden kaputt aussieht. Aendert
sich dort die Struktur, muss sie hier mitgezogen werden -- deshalb bleibt der
Block hier absichtlich schlank.

Dasselbe Muster steckt in tickets.html: Auch dort entsteht die Terminliste erst
im Browser, in einem Inline-Skript, das #heimspiele-liste fuellt. Und dort ist es
noch enger -- der Tickets-Knopf ist bei 13 von 14 Spielen `disabled`, weil der
Einzelticketverkauf noch nicht live ist. Selbst im Browser fuehrte also nur ein
einziges Spiel auf seine Seite. Beide Seiten werden deshalb aus derselben
Datenquelle bedient.

Aufruf:
  python3 tools/build-spielplan-liste.py
  python3 tools/build-spielplan-liste.py --check    # schreibt nichts
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "heimspiele.json"

WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

# Gleiche Adresse wie RIETHSPORTHALLE_MAPS_URL in js/spielplan.js.
MAPS_SPIELPLAN = ("https://www.google.com/maps/search/?api=1&amp;query="
                  "Essener+Stra%C3%9Fe+20%2C+99089+Erfurt")
# tickets.html nutzt eine eigene, ausfuehrlichere Suchadresse -- uebernommen,
# damit der statische Stand nicht von der JS-Fassung abweicht.
MAPS_TICKETS = ("https://www.google.com/maps/search/?api=1&amp;query="
                "Riethsporthalle+Erfurt+Essener+Stra%C3%9Fe+20+99089+Erfurt")


def esc(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def spiele():
    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    liste = [s for s in daten.get("spiele", []) if s.get("seiteSlug")]
    if not liste:
        raise SystemExit("data/heimspiele.json: kein Spiel mit seiteSlug gefunden")
    liste.sort(key=lambda s: tuple(reversed([int(x) for x in s["datum"].split(".")])))
    return liste


def datum_text(s, mit_zeit):
    tag, monat, jahr = (int(x) for x in s["datum"].split("."))
    d = date(jahr, monat, tag)
    text = f"{WOCHENTAGE[(d.weekday() + 1) % 7]}, {s['datum']}"
    if mit_zeit and s.get("zeit"):
        text += f", {s['zeit']} Uhr"
    return text


def ziel_url(s):
    return f"/teams-saison/profis/gameday/{s['seiteSlug']}.html"


def paarung(s):
    return f"Basketball Löwen – {s['gegner']}"


def zeile_spielplan(s):
    """Spiegelt gameRowHTML() aus js/spielplan.js. Der Gegnername ist der Link --
    als Ankertext ist er genau das, wonach gesucht wird, und deutlich mehr wert
    als ein Icon."""
    ziel = ziel_url(s)
    return (
        '<div class="card fixture-day" data-teams="profis">'
        '<div class="fixture-day-game" data-team="profis" data-heim="1">'
        '<div class="fixture-day-meta">'
        f'<div class="fixture-time">{esc(datum_text(s, True))}</div>'
        f'<div class="fixture-venue-line"><a href="{MAPS_SPIELPLAN}" target="_blank" rel="noopener">'
        '<i data-lucide="map-pin" style="width:14px;height:14px"></i> Riethsporthalle</a></div>'
        '<span class="venue-heim">Heimspiel</span>'
        '</div>'
        '<div class="fixture-mid">'
        '<a class="team-badge team-badge-profis" href="/teams-saison/profis.html">Pro B</a>'
        f'<div class="matchup"><a href="{esc(ziel)}">{esc(paarung(s))}</a></div>'
        '</div>'
        '<div class="fixture-day-actions">'
        '<div class="fixture-result-row">'
        f'<div class="fixture-result">{esc(s.get("ergebnis") or "– – : – –")}</div>'
        '</div>'
        f'<a class="btn btn-outline-orange btn-sm" href="{esc(ziel)}">Zum Spiel '
        '<i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>'
        '</div>'
        '</div>'
        '</div>'
    )


def zeile_tickets(s):
    """Spiegelt die .ticket-row aus dem Inline-Skript in tickets.html.

    Ein Unterschied ist gewollt: Dort ist der Knopf `disabled`, solange kein
    ticketUrl gesetzt ist. Hier fuehrt er immer auf die Spieltagsseite -- ein
    toter Knopf waere als Link nichts wert, und die Seite gibt es ja. Das
    JavaScript ersetzt den Block beim Laden ohnehin.
    """
    ziel = ziel_url(s)
    return (
        '<div class="ticket-row">'
        '<div>'
        f'<div class="ticket-row-title"><strong>{esc(datum_text(s, False))}</strong> · '
        f'<a href="{esc(ziel)}">{esc(paarung(s))}</a></div>'
        '<div class="ticket-row-meta">'
        f'<span><i data-lucide="clock" class="icon-14"></i> {esc(s.get("zeit") or "")} Uhr</span>'
        f'<a href="{MAPS_TICKETS}" target="_blank" rel="noopener">'
        '<i data-lucide="map-pin" class="icon-14"></i> Riethsporthalle</a>'
        '</div>'
        '</div>'
        f'<div class="tactions"><a class="btn btn-primary btn-sm" href="{esc(ziel)}">Zum Spiel '
        '<i data-lucide="arrow-right" class="icon-14"></i></a></div>'
        '</div>'
    )


# (Datei, Marker-Name, Container-Id, Zeilenbauer, Einrueckung)
ZIELE = [
    (REPO / "teams-saison" / "spielplan.html", "SPIELPLAN", "spielplan-tage",
     zeile_spielplan, "        ", "      "),
    (REPO / "tickets.html", "TICKETS", "heimspiele-liste",
     zeile_tickets, "              ", "            "),
]


def anwenden(pfad, marker, container_id, bauer, ein, aus, spiel_liste, check):
    start = f"<!--{marker}:heimspiele-->"
    ende = f"<!--/{marker}:heimspiele-->"
    text = pfad.read_text(encoding="utf-8")
    block = start + "\n" + ein + (("\n" + ein).join(bauer(s) for s in spiel_liste)) + "\n" + aus + ende

    container = f'<div id="{container_id}"></div>'
    if start in text and ende in text:
        i, j = text.index(start), text.index(ende) + len(ende)
        ziel = text[:i] + block + text[j:]
    elif container in text:
        ziel = text.replace(container, f'<div id="{container_id}">{block}</div>')
    else:
        raise SystemExit(
            f"In {pfad.name} fehlt weder der Block {marker} noch {container} "
            "-- wurde die Seite umgebaut?"
        )

    name = pfad.relative_to(REPO)
    if ziel == text:
        print(f"  {name}: unverändert, {len(spiel_liste)} Heimspiele verlinkt")
        return 0
    if check:
        print(f"  {name}: zu ändern, {len(spiel_liste)} Heimspiele")
        return 1
    pfad.write_text(ziel, encoding="utf-8")
    print(f"  {name}: geschrieben, {len(spiel_liste)} Heimspiele verlinkt")
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = p.parse_args()

    liste = spiele()
    offen = 0
    for pfad, marker, container_id, bauer, ein, aus in ZIELE:
        offen += anwenden(pfad, marker, container_id, bauer, ein, aus, liste, args.check)
    return 1 if offen else 0


if __name__ == "__main__":
    sys.exit(main())
