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

from seo_common import REPO, seiten_heros

OUT_DIR = REPO / "assets" / "img" / "share"
SIZE = (1200, 630)
QUALITY = 82

# Standard-Share-Bild für Seiten ohne Hero: das erste Bild des Startseiten-Sliders
# (bis 11.11.2026 hero-startseite-alt.webp, ein altes Motiv)
DEFAULT_SOURCE = REPO / "assets" / "img" / "startseite-hero-1.webp"
DEFAULT_NAME = "og-default.jpg"

# Einzelne Unterseiten mit eigenem Hero-Bild, aber ohne News-Artikel-Struktur
STATIC_PAGE_SOURCES = {
    "presse": REPO / "assets" / "img" / "hero-presse.webp",
}

# Spieltagsinfo: je Ausgabe das Titelbild (assets/spieltagsinfo/ausgabe-N/<cover>)
def _spieltagsinfo_quellen():
    import json
    pfad = REPO / "data" / "spieltagsinfo.json"
    if not pfad.exists():
        return {}
    out = {}
    for a in json.loads(pfad.read_text(encoding="utf-8"))["ausgaben"]:
        quelle = REPO / "assets" / "spieltagsinfo" / f"ausgabe-{a['nr']}" / a["cover"]
        if quelle.exists():
            out[f"spieltagsinfo-ausgabe-{a['nr']}"] = quelle
    return out


STATIC_PAGE_SOURCES.update(_spieltagsinfo_quellen())

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
    # Teamfoto Löwinnen (Share-Bild der Damen-Seite): Köpfe am oberen Rand
    "team-damen-offiziell": 0.12,
}

def news_sources():
    """{css-suffix: Quellpfad} aus assets/img/news/ ableiten."""
    news_dir = REPO / "assets" / "img" / "news"
    return {p.stem: p for p in sorted(news_dir.glob("*.webp"))}


def crop_to(src: Path, dest: Path, ax=None, ay=None):
    """Auf 1200x630 beschneiden und als JPG speichern.

    Horizontal mittig, vertikal nach Anker (siehe default_anchor). Seiten-Heros
    geben ax/ay aus ihrer CSS-background-position mit, damit das Share-Bild
    denselben Ausschnitt zeigt wie der Hero auf der Seite.
    """
    with Image.open(src) as im:
        im = im.convert("RGB")
        target_ratio = SIZE[0] / SIZE[1]
        w, h = im.size
        ratio = w / h
        if ratio > target_ratio:            # zu breit -> links/rechts beschneiden
            new_w = int(h * target_ratio)
            left = int(round((w - new_w) * (0.5 if ax is None else ax)))
            im = im.crop((left, 0, left + new_w, h))
        else:                               # zu hoch -> oben/unten beschneiden
            new_h = int(w / target_ratio)
            anchor = ANCHOR_OVERRIDES.get(src.stem, default_anchor(ratio) if ay is None else ay)
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

    jobs = [(DEFAULT_SOURCE, OUT_DIR / DEFAULT_NAME, None, 0.6)]
    for stem, src in news_sources().items():
        jobs.append((src, OUT_DIR / f"news-{stem}.jpg", None, None))
    for name, src in STATIC_PAGE_SOURCES.items():
        jobs.append((src, OUT_DIR / f"{name}.jpg", None, None))
    for name, (src, ax, ay) in seiten_heros().items():
        jobs.append((src, OUT_DIR / name, ax, ay))

    missing_src = [j[0] for j in jobs if not j[0].exists()]
    if missing_src:
        for s in missing_src:
            print(f"FEHLT als Quelle: {s.relative_to(REPO)}", file=sys.stderr)
        return 1

    if args.check:
        for src, dest, _, _ in jobs:
            state = "vorhanden" if dest.exists() else "FEHLT"
            print(f"  {state:10} {dest.relative_to(REPO)}  <- {src.relative_to(REPO)}")
        return 0

    total = 0
    for src, dest, ax, ay in jobs:
        size = crop_to(src, dest, ax, ay)
        total += size
        print(f"  {dest.relative_to(REPO)}  {size // 1024} KB")
    print(f"\n{len(jobs)} Share-Bilder, zusammen {total // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
