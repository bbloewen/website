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

Was das Skript NICHT mehr tut: Bis zum 26.08.2026 baute es zusätzlich
druckfertige HTML-Seiten (A6-Aufkleber, A3-Event-Schild) unter tools/druck/.
Die lagen als ganz normale Seiten mit HTTP 200 im Netz — ohne noindex, ohne
Canonical, ohne Description, mit fünf h1 — und fielen aus jeder Prüfung heraus,
weil tools/druck/ in seo_common.AUSGENOMMEN steht. Auf Markos Ansage entfernt:
die Aufkleber entstehen ohnehin außerhalb der Website, dafür braucht es keine
HTML-Seite im öffentlichen Verzeichnis. Die QR-Codes selbst bleiben hier, sie
sind der eigentliche Zweck.

Der slug ist der stabile Schlüssel: Er steht in data/freiplaetze.json, im
Dateinamen des QR-Codes, im Query-Parameter der Platzseite und später als
Platz-Schlüssel im Court-Hunt-Backend. Wird er nachträglich geändert, zeigen
gedruckte Aufkleber ins Leere.

Aufruf:
  python3 tools/build-freiplatz-qr.py                 # beide QR-Sätze
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


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="nichts schreiben, nur berichten")
    args = p.parse_args()

    zaehler = qr_saetze(args.check)
    print(f"  QR-Codes: {zaehler['geschrieben']} geschrieben, {zaehler['unveraendert']} unveraendert, "
          f"{zaehler['wuerde schreiben']} offen")

    return 1 if args.check and zaehler["wuerde schreiben"] else 0


if __name__ == "__main__":
    sys.exit(main())
