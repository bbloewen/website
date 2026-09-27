#!/usr/bin/env python3
"""Schreibt das Pressefoto-Raster statisch in presse.html.

Warum ein Raster und kein Slider:

Wer ein Foto fuer einen Artikel sucht, will sehen, was es gibt, und genau
eines herunterladen. Ein Slider zwingt zum Durchblaettern und zeigt nie alles
auf einmal. Das ZIP mit allen Fotos bleibt daneben bestehen -- fuer die, die
wirklich alles wollen.

Wie andere Bausteine auch (build-partner-wall.py, build-galerie-html.py) wird
das Markup hier gebaut und zwischen Marker geschrieben, damit im ausgelieferten
HTML echte Bilder mit Alt-Text stehen und nicht ein leerer Container, den erst
JavaScript fuellt.

Pflege ausschliesslich ueber data/pressefotos.json.
"""
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "pressefotos.json"
SEITE = REPO / "presse.html"
FOTO_DIR = REPO / "assets" / "presse" / "fotos"
START = "<!--PRESSEFOTOS:start-->"
ENDE = "<!--PRESSEFOTOS:ende-->"


def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def bild_masse(pfad):
    """Breite und Hoehe aus der WebP-Datei, damit das Raster beim Laden nicht springt."""
    try:
        roh = pfad.read_bytes()[:40]
        if roh[:4] != b"RIFF" or roh[8:12] != b"WEBP":
            return ""
        kennung = roh[12:16]
        if kennung == b"VP8X":
            b = int.from_bytes(roh[24:27], "little") + 1
            h = int.from_bytes(roh[27:30], "little") + 1
        elif kennung == b"VP8 ":
            b = int.from_bytes(roh[26:28], "little") & 0x3FFF
            h = int.from_bytes(roh[28:30], "little") & 0x3FFF
        elif kennung == b"VP8L":
            bits = int.from_bytes(roh[21:25], "little")
            b = (bits & 0x3FFF) + 1
            h = ((bits >> 14) & 0x3FFF) + 1
        else:
            return ""
        return f' width="{b}" height="{h}"'
    except Exception:
        return ""


def main():
    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    fotos = daten.get("fotos") or []
    text = SEITE.read_text(encoding="utf-8")

    if START not in text or ENDE not in text:
        print("  Marker fehlen in presse.html — nichts geschrieben")
        return

    if not fotos:
        inhalt = '\n        <p class="t-body-sm">folgt in Kürze</p>\n      '
    else:
        kacheln = []
        for f in fotos:
            pfad = FOTO_DIR / f["datei"]
            if not pfad.exists():
                print(f'  fehlt: assets/presse/fotos/{f["datei"]} — übersprungen')
                continue
            url = "/assets/presse/fotos/" + f["datei"]
            # Angezeigt wird die kleine Fassung, heruntergeladen das Original --
            # sonst laedt jeder Seitenbesuch mehrere Megabyte.
            vorschau_datei = f.get("vorschau") or f["datei"]
            vorschau_pfad = FOTO_DIR / vorschau_datei
            vorschau_url = "/assets/presse/fotos/" + vorschau_datei
            alt = f.get("alt") or f.get("titel", "")
            groesse = round(pfad.stat().st_size / 1024)
            kacheln.append(
                f'<figure class="pressefoto">'
                f'<a href="{esc(url)}" download><img loading="lazy" src="{esc(vorschau_url)}"{bild_masse(vorschau_pfad)} alt="{esc(alt)}" /></a>'
                f'<figcaption>'
                f'<span class="pressefoto-titel">{esc(f.get("titel",""))}</span>'
                f'<span class="pressefoto-quelle">Foto: {esc(f.get("fotograf","—"))}</span>'
                f'<a class="card-link" href="{esc(url)}" download>Herunterladen ({groesse} KB) <i data-lucide="arrow-down" class="icon-14"></i></a>'
                f'</figcaption></figure>'
            )
        hinweis = daten.get("nutzung", "")
        inhalt = ("\n        <div class=\"pressefoto-raster\">\n          "
                  + "\n          ".join(kacheln)
                  + "\n        </div>\n"
                  + (f'        <p class="t-body-sm mt-3" style="color:var(--text-muted)">{esc(hinweis)}</p>\n' if hinweis else "")
                  + "      ")

    neu = re.sub(re.escape(START) + r".*?" + re.escape(ENDE),
                 START + inhalt + ENDE, text, flags=re.S)
    if neu != text:
        SEITE.write_text(neu, encoding="utf-8")
        print(f"  geschrieben: {len(fotos)} Pressefoto(s)")
    else:
        print(f"  unverändert, {len(fotos)} Pressefoto(s)")


if __name__ == "__main__":
    main()
