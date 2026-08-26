#!/usr/bin/env python3
"""Hält den Termin des Court-Hunt Day auf trainieren/court-hunt.html aktuell.

Der Court-Hunt Day ist seit dem 26.08.2026 gesetzt: **jeder zweite Samstag im
Juni**, deutschlandweit, zum ersten Mal am 12.06.2027. Die Regel ist der Termin —
nicht ein einzelnes Datum. Das hat einen praktischen Grund: Ein festes Datum im
HTML wäre am 13.06.2027 falsch, und niemand würde es merken. Dieses Skript
rechnet den nächsten Termin aus der Regel aus und schreibt ihn zwischen die
Marker.

Warum der zweite Samstag im Juni:

  * Wetter. Der ganze Tag ist draußen. Der Juni ist in Deutschland belastbar,
    April und Mai sind Glückssache.
  * Ferien. Pfingsten wandert mit Ostern; 2027 liegt es am 16./17.05., die
    Pfingstferien in Bayern und Baden-Württemberg reichen bis Ende Mai. Der
    erste Juni-Samstag wäre der erste nach den Ferien — Familien kommen da
    gerade zurück. Der zweite hat eine volle Schulwoche davor, und über Schulen
    läuft ein Teil der Ansprache.
  * Eigene Saison. Das letzte Heimspiel der Pro-B-Saison liegt im März, die
    Playoffs im April und Mai. Im Juni hat der Verein selbst Luft.
  * Krämerbrückenfest. Erfurts größtes Fest liegt immer am dritten
    Juni-Wochenende. Der zweite Samstag ist damit dauerhaft genau eine Woche
    davor — geprüft für 2027 bis 2032, der Abstand bleibt konstant, weil beide
    Termine am Wochentagsraster des Monats hängen. Kein Konflikt, und die Stadt
    ist in der Woche davor schon in Feststimmung.

Aufruf:
  python3 tools/build-court-hunt-day.py
  python3 tools/build-court-hunt-day.py --check    # schreibt nichts
"""

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "trainieren" / "court-hunt.html"
START = "<!--COURTHUNTDAY:termin-->"
ENDE = "<!--/COURTHUNTDAY:termin-->"

# Erster Court-Hunt Day. Vorher gibt es keinen, danach zählt nur noch die Regel.
ERSTES_JAHR = 2027

WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
          "Juli", "August", "September", "Oktober", "November", "Dezember"]


def zweiter_samstag_im_juni(jahr):
    d = date(jahr, 6, 1)
    d += timedelta((5 - d.weekday()) % 7)   # erster Samstag
    return d + timedelta(7)                 # zweiter


def naechster_termin(heute):
    """Der nächste Court-Hunt Day — der laufende Tag zählt noch dazu."""
    jahr = max(heute.year, ERSTES_JAHR)
    termin = zweiter_samstag_im_juni(jahr)
    if termin < heute:
        termin = zweiter_samstag_im_juni(jahr + 1)
    return termin


def lang(d):
    return f"{WOCHENTAGE[d.weekday()]}, {d.day}. {MONATE[d.month - 1]} {d.year}"


def block(heute):
    termin = naechster_termin(heute)
    erstmals = termin.year == ERSTES_JAHR
    satz = (f"Der nächste Court-Hunt Day ist <strong>{lang(termin)}</strong>"
            + (" — der erste überhaupt." if erstmals else "."))
    return (f'      <p class="t-body mt-3">{satz} Der Termin steht ein für alle Mal: '
            "Court-Hunt Day ist immer der zweite Samstag im Juni.</p>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    alt = ZIEL.read_text(encoding="utf-8")
    if START not in alt or ENDE not in alt:
        raise SystemExit(f"Marker {START} fehlt in {ZIEL.relative_to(REPO)} — "
                         "Abschnitt von Hand entfernt?")
    a, b = alt.index(START), alt.index(ENDE) + len(ENDE)
    neu = alt[:a] + START + "\n" + block(date.today()) + "\n" + ENDE + alt[b:]

    termin = naechster_termin(date.today())
    if neu == alt:
        print(f"  unverändert (nächster Termin: {termin.strftime('%d.%m.%Y')})")
        return 0
    if args.check:
        print(f"  zu ändern (nächster Termin: {termin.strftime('%d.%m.%Y')})")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben (nächster Termin: {termin.strftime('%d.%m.%Y')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
