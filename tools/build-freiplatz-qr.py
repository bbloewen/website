#!/usr/bin/env python3
"""Erzeugt die QR-Codes rund um die Freiplätze — Wegbeschreibung und Court-Hunt.

Es gibt zwei QR-Sätze, und sie dürfen nicht verwechselt werden:

  wegbeschreibung  assets/img/freiplaetze/qr-<slug>.svg
                   zeigt auf Google Maps und sitzt als kleines Overlay im
                   Kachelbild der Übersichtsseite. Für Leute am Rechner, die
                   den Weg aufs Handy holen wollen.

  hunt             assets/img/freiplaetze/hunt/qr-<slug>.svg
                   zeigt auf die eigene Seite des Platzes
                   (/trainieren/freiplatz/<slug>.html) und klebt am Platz
                   selbst. Das ist der Einstieg ins Spiel: scannen, einchecken,
                   Punkte sammeln.

Dazu baut das Skript druckfertige Aufkleber (A6) und Event-Schilder (A3) als
HTML — Chrome druckt sie als PDF, ohne dass ein weiteres Werkzeug nötig wäre:

  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \\
      --no-pdf-header-footer --print-to-pdf=aufkleber.pdf aufkleber.html

Chrome ignoriert dabei die @page-Groesse und legt jede Karte auf eine
Standardseite (Letter). Die Karte selbst hat die richtigen Masse und steht
mittig mit gestrichelter Schnittkante — also auf A4 ohne Skalierung ("100 %",
nicht "an Seite anpassen") drucken und ausschneiden. Das A3-Schild fuers Event
druckt man umgekehrt mit "an Seitengroesse anpassen" auf A3.

Der slug ist der stabile Schlüssel: Er steht in data/freiplaetze.json, im
Dateinamen des QR-Codes, im Query-Parameter der Platzseite und später als
Platz-Schlüssel im Court-Hunt-Backend. Wird er nachträglich geändert, zeigen
gedruckte Aufkleber ins Leere.

Aufruf:
  python3 tools/build-freiplatz-qr.py                 # beide QR-Sätze
  python3 tools/build-freiplatz-qr.py --aufkleber     # + A6-Druckvorlagen
  python3 tools/build-freiplatz-qr.py --event hopfenbergfest-2026-09-12 \\
      --event-name "Hopfenbergfest"                   # A3-Schild für den Korb
  python3 tools/build-freiplatz-qr.py --check         # schreibt nichts
"""

import argparse
import json
import sys
from pathlib import Path

import qrcode
import qrcode.image.svg

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "freiplaetze.json"
QR_WEG = REPO / "assets" / "img" / "freiplaetze"
QR_HUNT = QR_WEG / "hunt"
DRUCK = REPO / "tools" / "druck"
BASIS = "https://basketball-loewen.com"


def qr_svg(inhalt):
    """QR als SVG-Pfad — Parameter wie beim ersten Satz vom 20.08.2026
    (box_size=10, border=1), damit beide Sätze gleich aussehen."""
    code = qrcode.QRCode(box_size=10, border=1)
    code.add_data(inhalt)
    code.make(fit=True)
    bild = code.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    from io import BytesIO
    puffer = BytesIO()
    bild.save(puffer)
    return puffer.getvalue().decode("utf-8")


def schreibe(pfad, inhalt, check):
    vorhanden = pfad.read_text(encoding="utf-8") if pfad.is_file() else None
    if vorhanden == inhalt:
        return "unveraendert"
    if check:
        return "wuerde schreiben"
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text(inhalt, encoding="utf-8")
    return "geschrieben"


def plaetze():
    return json.loads(DATEN.read_text(encoding="utf-8"))["freiplaetze"]


def qr_saetze(check):
    zaehler = {"geschrieben": 0, "unveraendert": 0, "wuerde schreiben": 0}
    for f in plaetze():
        slug = f["slug"]
        weg = f"https://www.google.com/maps/search/?api=1&query={f['lat']},{f['lng']}"
        # Seit dem 25.08.2026 hat jeder feste Platz eine eigene Adresse. Der
        # QR-Code zeigt direkt dorthin statt auf die parametergesteuerte
        # Huelle -- ein Sprung weniger und die kanonische Adresse. Bereits
        # gedruckte Aufkleber mit dem alten Ziel bleiben gueltig: die Huelle
        # leitet feste Plaetze auf ihre Seite weiter (js/freiplaetze.js).
        hunt = f"{BASIS}/trainieren/freiplatz/{slug}.html"
        zaehler[schreibe(QR_WEG / f"qr-{slug}.svg", qr_svg(weg), check)] += 1
        # Plätze mit eingeschränktem Zugang gehören nicht zum Spiel — für sie
        # gibt es folgerichtig auch keinen Aufkleber.
        if f.get("zugang") != "eingeschraenkt":
            zaehler[schreibe(QR_HUNT / f"qr-{slug}.svg", qr_svg(hunt), check)] += 1
    return zaehler


AUFKLEBER_CSS = """
@page { size: %(format)s; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Lexend', system-ui, sans-serif; color: #00122D; }
.seite { page-break-after: always; display: flex; align-items: center; justify-content: center; }
.karte {
  width: %(breite)s; height: %(hoehe)s;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: %(polster)s; background: #fff;
  /* Schnittkante: Chrome druckt auf Standardformat, die Karte selbst hat die
     richtigen Masse — an dieser Linie schneiden. */
  outline: 1px dashed #C2C8D5;
}
.karte img.logo { height: %(logo)s; margin-bottom: %(luft)s; }
.karte h1 { font-size: %(titel)s; font-weight: 800; margin: 0 0 .4em; line-height: 1.1; }
.karte p { font-size: %(text)s; margin: 0 0 .8em; line-height: 1.4; color: #3C4557; }
.karte .qr { width: %(qr)s; height: %(qr)s; }
.karte .platz { font-size: %(text)s; font-weight: 700; color: #B55709; margin-top: .6em; }
.karte .foerderer { font-size: %(klein)s; color: #6B7488; margin-top: 1.2em; }
"""

MASSE = {
    "a6": {"format": "A6", "breite": "105mm", "hoehe": "148mm", "polster": "10mm",
           "logo": "16mm", "luft": "6mm", "titel": "20pt", "text": "11pt", "qr": "52mm", "klein": "8pt"},
    "a3": {"format": "A3", "breite": "297mm", "hoehe": "420mm", "polster": "28mm",
           "logo": "45mm", "luft": "16mm", "titel": "56pt", "text": "26pt", "qr": "150mm", "klein": "16pt"},
}


def druckseite(karten, format_name):
    css = AUFKLEBER_CSS % MASSE[format_name]
    logo = (REPO / "assets" / "logo" / "loewen-logo-4c.svg").as_uri()
    inhalt = "\n".join(
        f'<div class="seite"><div class="karte">'
        f'<img class="logo" src="{logo}" alt="Basketball Löwen Erfurt">'
        f'<h1>{k["titel"]}</h1><p>{k["text"]}</p>{k["qr"]}'
        f'<div class="platz">{k["platz"]}</div>'
        f'<div class="foerderer">Ein Projekt der E.E.S.T. Foundation · eest.foundation</div>'
        f'</div></div>'
        for k in karten
    )
    return (f'<!doctype html><html lang="de"><head><meta charset="utf-8">'
            f'<title>Court-Hunt — Druckvorlage</title><style>{css}</style></head>'
            f'<body>{inhalt}</body></html>\n')


def aufkleber(check):
    karten = []
    for f in plaetze():
        if f.get("zugang") == "eingeschraenkt":
            continue
        karten.append({
            "titel": "Court-Hunt",
            "text": "Scan mich: einchecken, Punkte sammeln, Freikarte fürs Heimspiel gewinnen.",
            "qr": qr_svg(f"{BASIS}/trainieren/freiplatz.html?platz={f['slug']}").replace(
                "<svg", '<svg class="qr"', 1),
            "platz": f["name"],
        })
    return schreibe(DRUCK / "court-hunt-aufkleber-a6.html", druckseite(karten, "a6"), check)


def event_schild(slug, name, check):
    karte = {
        "titel": "Court-Hunt",
        "text": "Scan mich: heute 50 Punkte am mobilen Korb. Einchecken, sammeln, Freikarte gewinnen.",
        "qr": qr_svg(f"{BASIS}/trainieren/freiplatz.html?platz={slug}").replace(
            "<svg", '<svg class="qr"', 1),
        "platz": name,
    }
    return schreibe(DRUCK / f"court-hunt-event-{slug}-a3.html", druckseite([karte], "a3"), check)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="nichts schreiben, nur berichten")
    p.add_argument("--aufkleber", action="store_true", help="A6-Druckvorlage mitbauen")
    p.add_argument("--event", help="Slug eines Event-Spots, erzeugt ein A3-Schild")
    p.add_argument("--event-name", default="", help="Anzeigename des Events fürs Schild")
    args = p.parse_args()

    zaehler = qr_saetze(args.check)
    print(f"  QR-Codes: {zaehler['geschrieben']} geschrieben, {zaehler['unveraendert']} unveraendert, "
          f"{zaehler['wuerde schreiben']} offen")

    if args.aufkleber:
        print(f"  Aufkleber A6: {aufkleber(args.check)}")

    if args.event:
        if not args.event_name:
            print("  --event braucht --event-name", file=sys.stderr)
            return 1
        print(f"  Event-Schild A3: {event_schild(args.event, args.event_name, args.check)}")

    return 1 if args.check and zaehler["wuerde schreiben"] else 0


if __name__ == "__main__":
    sys.exit(main())
