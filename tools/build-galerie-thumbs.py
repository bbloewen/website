#!/usr/bin/env python3
"""Erzeugt Vorschaubilder für die Bildergalerien.

Warum:

Die Galerien lieferten die Fotos in Originalgröße aus — und zeigten sie in
Kacheln von 240 mal 160 Pixeln (`.camp-gallery-photo` in css/site.css). Die
LÖWENPARK-Galerie allein wog damit 8,2 MB für 23 Vorschaubilder, einzelne
Dateien über 600 KB. Über alle fünf Galerien waren es rund 16 MB, die niemand in
dieser Auflösung zu sehen bekam.

Das Skript legt neben jedes Foto ein Vorschaubild mit 480 Pixeln Breite (das
Doppelte der Kachelbreite, damit es auch auf hochauflösenden Bildschirmen scharf
bleibt) unter `assets/img/thumbs/` und schreibt den Pfad als `thumb` in die
Galerie-Datei. `js/camp-galerie.js` nimmt für den Streifen `thumb`, für die
Lightbox weiter das Original — groß angesehen wird ja das ganze Bild.

Vorhandene Vorschaubilder werden nicht neu erzeugt, solange das Original nicht
neuer ist. Neue Fotos in einer Galerie-Datei brauchen also nur einen Lauf.

Aufruf:
  python3 tools/build-galerie-thumbs.py
  python3 tools/build-galerie-thumbs.py --check    # schreibt nichts
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
THUMBS = REPO / "assets" / "img" / "thumbs"
# 2× der Kachelbreite von 240px aus .camp-gallery-photo.
BREITE = 480
QUALITAET = 72


def thumb_pfad(src):
    return f"/assets/img/thumbs/{Path(src).stem}.webp"


def erzeuge(src, check):
    """Gibt zurück, was zu tun war: 'neu', 'aktuell' oder 'fehlt' (Original weg)."""
    quelle = REPO / src.lstrip("/")
    if not quelle.is_file():
        return "fehlt"
    ziel = REPO / thumb_pfad(src).lstrip("/")
    if ziel.is_file() and ziel.stat().st_mtime >= quelle.stat().st_mtime:
        return "aktuell"
    if check:
        return "neu"
    from PIL import Image
    THUMBS.mkdir(parents=True, exist_ok=True)
    with Image.open(quelle) as bild:
        bild = bild.convert("RGB")
        if bild.width > BREITE:
            hoehe = round(bild.height * BREITE / bild.width)
            bild = bild.resize((BREITE, hoehe), Image.LANCZOS)
        bild.save(ziel, "WEBP", quality=QUALITAET, method=6)
    return "neu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    dateien = sorted((REPO / "data").glob("*galerie*.json"))
    neu = aktuell = fehlend = json_geaendert = 0
    gespart = 0

    for pfad in dateien:
        daten = json.loads(pfad.read_text(encoding="utf-8"))
        bilder = daten.get("bilder") or []
        if not bilder:
            continue
        veraendert = False
        for b in bilder:
            src = b.get("src")
            if not src:
                continue
            stand = erzeuge(src, args.check)
            if stand == "fehlt":
                print(f"  ACHTUNG {pfad.name}: {src} existiert nicht", file=sys.stderr)
                fehlend += 1
                continue
            neu += stand == "neu"
            aktuell += stand == "aktuell"
            t = thumb_pfad(src)
            if b.get("thumb") != t:
                b["thumb"] = t
                veraendert = True
            gross = (REPO / src.lstrip("/"))
            klein = (REPO / t.lstrip("/"))
            if gross.is_file() and klein.is_file():
                gespart += gross.stat().st_size - klein.stat().st_size
        if veraendert and not args.check:
            pfad.write_text(json.dumps(daten, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
            json_geaendert += 1
        elif veraendert:
            print(f"  zu ändern: {pfad.name}")
            json_geaendert += 1

    if args.check:
        print(f"  {neu} Vorschaubilder zu erzeugen, {json_geaendert} Galerie-Datei(en) "
              f"zu ändern, {aktuell} aktuell")
        return 1 if (neu or json_geaendert) else 0
    print(f"  {neu} Vorschaubilder erzeugt, {aktuell} aktuell, "
          f"{json_geaendert} Galerie-Datei(en) aktualisiert; "
          f"{gespart / 1024 / 1024:.1f} MB weniger in den Streifen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
