#!/usr/bin/env python3
"""Erzeugt die Share-Bilder (Open Graph / Twitter Cards) unter assets/img/share/.

Bewusste Ausnahme von der WebP-Regel: Share-Bilder werden als **JPG** abgelegt.
WhatsApp und mehrere Vorschau-Renderer zeigen WebP-og:image unzuverlässig oder
gar nicht — hier geht Kompatibilität vor Dateigröße. Alle übrigen Bilder der
Seite bleiben WebP.

Format 1200x630 (Facebook/LinkedIn/WhatsApp-Standard, von X/Twitter als
summary_large_image ebenfalls akzeptiert), mittig beschnitten.

Aufruf:
  python3 tools/build-share-images.py
  python3 tools/build-share-images.py --check   # nur prüfen, was fehlen würde
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

from seo_common import REPO

OUT_DIR = REPO / "assets" / "img" / "share"
SIZE = (1200, 630)
QUALITY = 82

# Standard-Share-Bild für alle Seiten ohne eigenes Motiv
DEFAULT_SOURCE = REPO / "assets" / "img" / "hero-startseite-alt.webp"
DEFAULT_NAME = "og-default.jpg"

# Vertikaler Anker beim Beschneiden: 0.0 = oberer Rand, 0.5 = Mitte, 1.0 = unterer Rand.
# Ein reiner Mittelschnitt köpft Hochformat-Motive (beim ersten Lauf war aus dem
# Cheftrainer-Porträt ein Rumpf ohne Kopf geworden). Gesichter liegen im obereren
# Bilddrittel, deshalb je steiler das Hochformat, desto weiter oben ansetzen.
def default_anchor(ratio):
    if ratio >= 1.4:
        return 0.40
    if ratio >= 1.0:
        return 0.28
    return 0.12          # echtes Hochformat


# Feinjustierung einzelner Motive nach Sichtprüfung (Dateiname ohne Endung)
ANCHOR_OVERRIDES = {
    # Vier Personen stehen im unteren Bilddrittel vor dem Wandlogo; der
    # Hochformat-Standardanker (0.12) schnitt sie am unteren Rand an.
    "damen-regionalliga": 0.45,
}

def news_sources():
    """{css-suffix: Quellpfad} aus assets/img/news/ ableiten."""
    news_dir = REPO / "assets" / "img" / "news"
    return {p.stem: p for p in sorted(news_dir.glob("*.webp"))}


def crop_to(src: Path, dest: Path):
    """Auf 1200x630 beschneiden und als JPG speichern.

    Horizontal wird mittig geschnitten, vertikal nach Anker (siehe default_anchor).
    """
    with Image.open(src) as im:
        im = im.convert("RGB")
        target_ratio = SIZE[0] / SIZE[1]
        w, h = im.size
        ratio = w / h
        if ratio > target_ratio:            # zu breit -> links/rechts beschneiden
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            im = im.crop((left, 0, left + new_w, h))
        else:                               # zu hoch -> oben/unten beschneiden
            new_h = int(w / target_ratio)
            anchor = ANCHOR_OVERRIDES.get(src.stem, default_anchor(ratio))
            top = int(round((h - new_h) * anchor))
            im = im.crop((0, top, w, top + new_h))
        im = im.resize(SIZE, Image.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return dest.stat().st_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    jobs = [(DEFAULT_SOURCE, OUT_DIR / DEFAULT_NAME)]
    for stem, src in news_sources().items():
        jobs.append((src, OUT_DIR / f"news-{stem}.jpg"))

    missing_src = [s for s, _ in jobs if not s.exists()]
    if missing_src:
        for s in missing_src:
            print(f"FEHLT als Quelle: {s.relative_to(REPO)}", file=sys.stderr)
        return 1

    if args.check:
        for src, dest in jobs:
            state = "vorhanden" if dest.exists() else "FEHLT"
            print(f"  {state:10} {dest.relative_to(REPO)}  <- {src.relative_to(REPO)}")
        return 0

    total = 0
    for src, dest in jobs:
        size = crop_to(src, dest)
        total += size
        print(f"  {dest.relative_to(REPO)}  {size // 1024} KB")
    print(f"\n{len(jobs)} Share-Bilder, zusammen {total // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
