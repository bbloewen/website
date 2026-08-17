#!/usr/bin/env python3
"""Gemeinsame Grundlagen für die SEO-Skripte in tools/.

Hier liegt die *eine* Definition davon, welche Seiten zählen und welche
kanonische URL eine Datei hat. Sitemap, Canonical-Tags und Open-Graph-Tags
müssen sich zwingend einig sein — Sitemap-URL und rel=canonical einer Seite
dürfen nie auseinanderlaufen, sonst hebeln sie sich gegenseitig aus.

Konkreter Anlass: /news/newsletter/ und /news/newsletter/index.html liefern
beide HTTP 200 ohne Redirect (GitHub Pages), sind also zwei URLs mit gleichem
Inhalt. Wir legen uns site-weit auf die Verzeichnisform fest.
"""

import re
import subprocess
from pathlib import Path

BASE = "https://basketball-loewen.com/"
REPO = Path(__file__).resolve().parent.parent

NOINDEX_RE = re.compile(r'<meta\s+name=["\']robots["\']\s+content=["\'][^"\']*noindex', re.I)

# Weiterleitungs-Stubs tragen diese Markierung in der ersten Zeile. Sie sind
# keine Seiten, sondern Wegweiser von einer alten auf eine neue URL, und muessen
# deshalb aus *allen* Build-Schritten heraus: kein Header/Footer, kein
# Canonical auf sich selbst, kein Sitemap-Eintrag.
REDIRECT_MARKER = "<!-- REDIRECT-STUB -->"


def is_redirect_stub(rel):
    with (REPO / rel).open(encoding="utf-8") as fh:
        return REDIRECT_MARKER in fh.read(200)


def tracked_html():
    """Von Git verfolgte HTML-Dateien, ohne partials/ und ohne Redirect-Stubs.

    Bewusst git statt Verzeichnis-Scan: lokale Arbeitsartefakte (wie früher
    tools/familienrabatt-rechner.html) landen so nie versehentlich in Sitemap,
    Canonicals oder Share-Tags.
    """
    out = subprocess.run(
        ["git", "ls-files", "-z", "*.html"],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout
    # Auf dem Datenträger vorhandene Dateien filtern: git ls-files liest den
    # Index, der auch noch geloeschte Dateien enthaelt, solange die Loeschung
    # nicht gestaged ist. Ohne diesen Filter brechen die Skripte mit
    # FileNotFoundError ab.
    return sorted(
        f for f in out.split("\0")
        if f
        and not f.startswith("partials/")
        and (REPO / f).is_file()
        and not is_redirect_stub(f)
    )


def read(rel):
    return (REPO / rel).read_text(encoding="utf-8")


def is_indexable(rel, text=None):
    """False für Seiten mit noindex (Checkout, Zahlung, Suche, Platzhalter)."""
    head = (text if text is not None else read(rel))[:4000]
    return not NOINDEX_RE.search(head)


def url_path(rel):
    """Dateipfad -> kanonischer URL-Pfad (index.html wird zur Verzeichnisform)."""
    if rel == "index.html":
        return ""
    if rel.endswith("/index.html"):
        return rel[: -len("index.html")]
    return rel


def canonical_url(rel):
    """Vollständige kanonische URL einer Seite."""
    return BASE + url_path(rel)


def indexable_pages():
    """[(relativer Pfad, Dateiinhalt)] aller indexierbaren Seiten."""
    pages = []
    for rel in tracked_html():
        text = read(rel)
        if is_indexable(rel, text):
            pages.append((rel, text))
    return pages
