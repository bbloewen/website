#!/usr/bin/env python3
"""Schreibt die Trainingszeiten statisch in trainieren/trainingszeiten.html.

Warum:

Die Seite hatte bis zum 26.08.2026 nur 604 Zeichen sichtbaren Text — Überschrift,
Vorspann, Filterleiste. Von den 26 Trainingsgruppen in
`data/trainingszeiten.json` stand **eine einzige** im ausgelieferten HTML; alles
andere baute erst `js/trainingszeiten.js` beim Laden. Damit fehlte genau die
Information, nach der gesucht wird: Wochentag, Uhrzeit, Halle, Jahrgang. Für
„basketball training erfurt" oder „basketball für kinder erfurt" war die Seite
inhaltlich leer.

Was hier bewusst NICHT passiert:

Das interaktive Kachel-Markup aus `cardHTML()` wird **nicht** gespiegelt. Es hängt
an einem halben Dutzend Nachschlagetabellen (Team-Label, Jahrgangs-Logik,
Maps-Link, Probetrainings-Link, Vereins-Badge) — zwei Fassungen davon würden
garantiert auseinanderlaufen. Stattdessen steht hier eine schlichte, vollständig
lesbare Liste. Beim Laden ersetzt `render()` den Container per `innerHTML`
komplett, für Besucher mit JavaScript ändert sich also nichts. Ohne JavaScript
stehen jetzt alle Zeiten als Text da statt einer leeren Seite.

Aufruf:
  python3 tools/build-trainingszeiten-liste.py
  python3 tools/build-trainingszeiten-liste.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import esc

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "trainingszeiten.json"
ZIEL = REPO / "trainieren" / "trainingszeiten.html"
CONTAINER = "trainingszeiten-grid"
START = f"<!--TRAINING:{CONTAINER}-->"
ENDE = f"<!--/TRAINING:{CONTAINER}-->"

# Gleiche Beschriftung wie vereinLabel in js/trainingszeiten.js.
VEREIN = {
    "loewen": "Basketball Löwen",
    "loewinnen": "Basketball Löwinnen",
    "bc-erfurt": "BC Erfurt",
    "usv-erfurt": "USV Erfurt",
    "big-gotha": "BIG Gotha",
}

WOCHENTAG = {"Mo": "Montag", "Di": "Dienstag", "Mi": "Mittwoch", "Do": "Donnerstag",
             "Fr": "Freitag", "Sa": "Samstag", "So": "Sonntag"}


def zeile(g):
    verein = VEREIN.get(g.get("verein"), g.get("verein") or "")
    kopf = f'{esc(g["team"])} <span class="training-row-jahrgang">({esc(g["jahrgang"])})</span>'
    if g.get("termine"):
        termine = "".join(
            '<div class="training-slot">'
            f'<span>{esc(WOCHENTAG.get(t["tag"], t["tag"]))}, {esc(t["zeit"])}</span> '
            f'<span class="training-slot-ort">{esc(t["ort"])}</span>'
            "</div>"
            for t in g["termine"])
    else:
        hinweis = g.get("hinweis") or "Zeiten folgen in Kürze"
        termine = f'<div class="training-slot"><em>{esc(hinweis)}</em></div>'
    trainer = (f'<div class="training-row-trainer-label">Trainer:innen:</div>'
               f'<div>{esc(g["trainer"])}</div>') if g.get("trainer") else ""
    return (
        f'        <div class="card training-row" data-verein="{esc(g.get("verein") or "")}" '
        f'data-jahre="{esc(",".join(str(j) for j in g.get("jahre", [])))}">'
        f'<div><div class="training-row-team">{kopf}</div>'
        f'<div class="training-row-zeiten">{termine}</div></div>'
        f'<div class="training-row-trainer">'
        f'<span class="team-badge">{esc(verein)}</span>{trainer}</div>'
        "</div>"
    )


def block(gruppen):
    return "\n".join(zeile(g) for g in gruppen)


def einbauen(text, inhalt):
    neu = f"{START}\n{inhalt}\n{ENDE}"
    if START in text and ENDE in text:
        a, b = text.index(START), text.index(ENDE) + len(ENDE)
        return text[:a] + neu + text[b:]
    # Erster Lauf: leerer Container. Nicht über das schließende </div> matchen —
    # die eingesetzten Zeilen enthalten selbst </div>.
    leer = re.compile(r'(<div[^>]*\bid="' + re.escape(CONTAINER) + r'"[^>]*>)\s*(</div>)')
    m = leer.search(text)
    if not m:
        raise SystemExit(f"Container id={CONTAINER} nicht leer und ohne Marker — "
                         "Seite von Hand umgebaut?")
    return text[:m.start()] + m.group(1) + neu + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    gruppen = json.loads(DATEN.read_text(encoding="utf-8"))["gruppen"]
    if not gruppen:
        raise SystemExit("data/trainingszeiten.json: keine Gruppen")

    alt = ZIEL.read_text(encoding="utf-8")
    neu = einbauen(alt, block(gruppen))
    termine = sum(len(g.get("termine") or []) for g in gruppen)

    if neu == alt:
        print(f"  unverändert ({len(gruppen)} Gruppen, {termine} Termine)")
        return 0
    if args.check:
        print(f"  zu ändern ({len(gruppen)} Gruppen, {termine} Termine)")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben ({len(gruppen)} Gruppen, {termine} Termine)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
