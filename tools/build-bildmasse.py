#!/usr/bin/env python3
"""Ergänzt width und height an jedem <img>, das auf eine Datei im Repo zeigt.

Warum:

Am 26.08.2026 hatten 623 von 629 img-Tags kein width/height. Ohne diese beiden
Angaben kennt der Browser das Seitenverhältnis erst, wenn das Bild da ist — bis
dahin hat das Bild die Höhe null und alles darunter rutscht beim Laden nach
unten. Das ist Cumulative Layout Shift, und CLS ist ein Rankingsignal. Zwei
Zahlen im Markup lösen es vollständig: der Browser reserviert den Platz sofort.

Was das Skript anfasst und was nicht:

  * Nur `<img>` mit einem absoluten Pfad auf eine wirklich vorhandene Datei im
    Repo (`/assets/...`). Externe Bilder und per JavaScript erzeugte Kacheln
    kann es nicht erreichen.
  * Vorhandene width/height bleiben unangetastet — von Hand gesetzte Werte
    gehören dem Menschen, nicht dem Skript.
  * SVG nur, wenn ein `viewBox` ein Verhältnis hergibt. Logos ohne viewBox
    bleiben ohne Maße; dort ist die Größe ohnehin per CSS gesetzt.

Die Maße sind die echten Pixelmaße der Datei. Dass ein Bild per CSS auf 100 %
oder in einen `object-fit: cover`-Rahmen gezwungen wird, ändert daran nichts:
CSS gewinnt gegen die Attribute, das Verhältnis dient nur der Platzreservierung.

Reihenfolge: **nach** allen Seitengeneratoren laufen lassen (Spieltagsseiten,
Gameday-Hub, Freiplatz-Seiten, Partner-Wall, Trainingszeiten, Home-News), sonst
schreiben die ihre Kacheln ohne Maße zurück.

Aufruf:
  python3 tools/build-bildmasse.py
  python3 tools/build-bildmasse.py --check    # schreibt nichts
"""

import argparse
import re
import sys
from pathlib import Path

from seo_common import BASE, REPO, tracked_html

# partials/ werden von build-partials.py in die Seiten kopiert und müssen
# deshalb mitbehandelt werden, sonst kommen Bilder ohne Maße zurück.
EXTRA = ["partials/header.html", "partials/footer.html"]

IMG = re.compile(r"<img\b[^>]*>", re.I)
SRC = re.compile(r'\bsrc="([^"]+)"')
HAT_MASS = re.compile(r"\b(width|height)\s*=", re.I)

_cache = {}


def masse(rel_url):
    """(breite, hoehe) der Bilddatei oder None."""
    if rel_url in _cache:
        return _cache[rel_url]
    url = rel_url.split("?")[0]
    # Auch die eigene Domain absolut geschrieben (kommt in den Insta-Archiv-Seiten vor).
    if url.startswith(BASE):
        url = url[len(BASE) - 1:]
    pfad = REPO / url.lstrip("/")
    ergebnis = None
    if pfad.exists() and pfad.is_file():
        if pfad.suffix.lower() == ".svg":
            m = re.search(r'viewBox="([\d.\-\s]+)"', pfad.read_text(encoding="utf-8", errors="ignore"))
            if m:
                teile = m.group(1).split()
                if len(teile) == 4:
                    b, h = float(teile[2]), float(teile[3])
                    if b > 0 and h > 0:
                        ergebnis = (int(round(b)), int(round(h)))
        else:
            try:
                from PIL import Image
                with Image.open(pfad) as bild:
                    ergebnis = bild.size
            except Exception:
                ergebnis = None
    _cache[rel_url] = ergebnis
    return ergebnis


def ergaenze(text):
    """Gibt (neuer Text, Anzahl ergänzt, Anzahl ohne Maße) zurück."""
    ergaenzt = 0
    ohne = 0

    def ersetze(m):
        nonlocal ergaenzt, ohne
        tag = m.group(0)
        if HAT_MASS.search(tag):
            return tag
        s = SRC.search(tag)
        if not s or not (s.group(1).startswith("/") or s.group(1).startswith(BASE)):
            ohne += 1
            return tag
        mm = masse(s.group(1))
        if not mm:
            ohne += 1
            return tag
        ergaenzt += 1
        # Direkt hinter src einsetzen, damit die Attributreihenfolge über alle
        # Seiten gleich aussieht und Diffs lesbar bleiben.
        einschub = f' width="{mm[0]}" height="{mm[1]}"'
        return tag[:s.end()] + einschub + tag[s.end():]

    return IMG.sub(ersetze, text), ergaenzt, ohne


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    dateien = [f for f in tracked_html()] + EXTRA
    geschrieben = offen = summe = rest = 0
    for rel in dateien:
        pfad = REPO / rel
        if not pfad.exists():
            continue
        alt = pfad.read_text(encoding="utf-8")
        neu, n, o = ergaenze(alt)
        summe += n
        rest += o
        if neu == alt:
            continue
        if args.check:
            print(f"  zu ändern: {rel} (+{n})")
            offen += 1
            continue
        pfad.write_text(neu, encoding="utf-8")
        geschrieben += 1

    if args.check:
        print(f"  {offen} Datei(en) zu ändern, {summe} Maße zu ergänzen")
        return 1 if offen else 0
    print(f"  {summe} Maße ergänzt in {geschrieben} Datei(en); "
          f"{rest} img ohne ermittelbare Maße (extern oder ohne viewBox)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
