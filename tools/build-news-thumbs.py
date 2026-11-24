#!/usr/bin/env python3
"""Erzeugt Vorschaubilder für die News-Kacheln.

Warum:

Die News-Kacheln lieferten die Artikelbilder in Originalgröße aus und zeigten
sie in Kacheln von 348 mal 180 Pixeln (`.card-media-photo` in css/site.css,
gemessen bei 1400 px Fensterbreite). `news/aktuelles.html` lud damit 50 Bilder
mit zusammen 9,7 MB, die niemand in dieser Auflösung zu sehen bekam. Dieselben
Bilder stehen auch auf der Startseite und auf den Team-Seiten.

Das Skript legt neben jedes Artikelbild ein Vorschaubild mit 720 Pixeln Breite
(das Doppelte der Kachelbreite, damit es auch auf hochauflösenden Bildschirmen
scharf bleibt) unter `assets/img/thumbs/news/` und schreibt den Pfad als `thumb`
in `data/news.json`. Dieselbe Bauart wie build-galerie-thumbs.py, nur mit
eigenem Unterordner: Die Galerie-Vorschaubilder liegen flach in
`assets/img/thumbs/` und werden mit 480 px erzeugt — gleiche Dateinamen in
einem Topf würden sich gegenseitig in der falschen Größe überschreiben.

Die Artikelseite selbst bekommt weiter das Originalbild, groß angesehen wird ja
das ganze Bild. Ebenso die Teilbilder für Facebook und WhatsApp.

Leser von `thumb` (alle mit Rückfall auf `bild`, damit nichts bricht, solange
ein Artikel noch kein Vorschaubild hat):
  tools/build-news-list.py, tools/build-home-news.py, tools/build-team-news.py,
  news/aktuelles.html (das eigene Skript in der Seite), js/home-news-feed.js,
  js/team-news.js

Vorhandene Vorschaubilder werden nicht neu erzeugt, solange das Original nicht
neuer ist. Ein neuer Artikel braucht also nur einen Lauf.

Aufruf:
  python3 tools/build-news-thumbs.py
  python3 tools/build-news-thumbs.py --check    # schreibt nichts
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
THUMBS = REPO / "assets" / "img" / "thumbs" / "news"
QUELLE = REPO / "data" / "news.json"
# 2x der Kachelbreite von 348px aus .card-media-photo.
BREITE = 720
QUALITAET = 72


def thumb_pfad(src):
    return f"/assets/img/thumbs/news/{Path(src).stem}.webp"


def erzeuge(src, check):
    """Gibt zurück, was zu tun war: 'neu', 'aktuell' oder 'fehlt' (Original weg)."""
    quelle = REPO / src.split("?")[0].lstrip("/")
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

    daten = json.loads(QUELLE.read_text(encoding="utf-8"))
    artikel = daten if isinstance(daten, list) else daten.get("artikel") or daten.get("news") or []

    neu = aktuell = fehlend = 0
    veraendert = False
    gespart = 0

    for a in artikel:
        src = a.get("bild")
        if not src:
            continue
        stand = erzeuge(src, args.check)
        if stand == "fehlt":
            print(f"  ACHTUNG: {src} existiert nicht", file=sys.stderr)
            fehlend += 1
            continue
        neu += stand == "neu"
        aktuell += stand == "aktuell"
        t = thumb_pfad(src)
        if a.get("thumb") != t:
            a["thumb"] = t
            veraendert = True
        gross = REPO / src.split("?")[0].lstrip("/")
        klein = REPO / t.lstrip("/")
        if gross.is_file() and klein.is_file():
            gespart += gross.stat().st_size - klein.stat().st_size

    if veraendert and not args.check:
        QUELLE.write_text(json.dumps(daten, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8")

    if args.check:
        print(f"  {neu} Vorschaubilder zu erzeugen, {aktuell} aktuell, "
              f"news.json {'zu ändern' if veraendert else 'unverändert'}")
        return 1 if (neu or veraendert) else 0
    print(f"  {neu} Vorschaubilder erzeugt, {aktuell} aktuell, {fehlend} Original(e) fehlen; "
          f"{gespart / 1024 / 1024:.1f} MB weniger in den Kacheln")
    return 0


if __name__ == "__main__":
    sys.exit(main())
