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

import html
import re
import subprocess
from pathlib import Path

BASE = "https://basketball-loewen.com/"
REPO = Path(__file__).resolve().parent.parent

NOINDEX_RE = re.compile(r'<meta\s+name=["\']robots["\']\s+content=["\'][^"\']*noindex', re.I)


# Druckvorlagen sind keine Webseiten: kein Header, kein Footer, keine
# Navigation, und in Google haben sie nichts verloren. Sie werden deshalb aus
# allen Build-Schritten herausgehalten -- sonst meldet build-partials.py bei
# jedem Lauf einen fehlenden Platzhalter, den es dort nie geben wird.
AUSGENOMMEN = ("partials/", "tools/druck/")


def tracked_html():
    """Von Git verfolgte HTML-Dateien, ohne partials/ und Druckvorlagen.

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
        if f and not f.startswith(AUSGENOMMEN) and (REPO / f).is_file()
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


# ---------------------------------------------------------------- HTML-Helfer
#
# Diese vier Funktionen lagen bis 26.08.2026 als wortgleiche (oder fast
# wortgleiche) Kopien in mehreren Build-Skripten -- gefunden bei einem
# Konsistenz-Check. maps_url() hatte in build-freiplaetze.py sogar eine
# unentdeckte Abweichung: & statt &amp; im href-Attribut, technisch ungültiges
# HTML. Eine Quelle, ein Fix.

def esc(text):
    """Text -> HTML-sicherer Text (kein Attribut-Kontext, keine '-Maskierung)."""
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def attr(value):
    """Text -> sicherer HTML-Attributwert (inkl. '-Maskierung)."""
    return html.escape(value, quote=True)


def text_of(fragment):
    """HTML-Fragment -> reiner Text (Tags weg, Entities aufgelöst)."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def maps_url(f):
    """Google-Maps-Suchlink für ein Objekt mit lat/lng, attribut-sicher escaped."""
    return f"https://www.google.com/maps/search/?api=1&amp;query={f['lat']},{f['lng']}"


def ziel_url(s):
    """Adresse der Spieltagsseite eines Heimspiels (data/heimspiele.json-Eintrag)."""
    return f"/saison/profis/gameday/{s['seiteSlug']}.html"


def spielbar(f):
    """Ist ein Freiplatz frei zugänglich (zählt im Court-Hunt)?"""
    return f.get("zugang") != "eingeschraenkt"


def mit_links(text, links):
    """[Beschriftung] im Text gegen die Ziele aus links auflösen -- wie
    mitLinks() in js/freiplaetze.js. Nur https-Ziele werden zu einem Link,
    alles andere bleibt schlichter Text.
    """
    links = links or {}

    def ersetze(m):
        beschriftung = m.group(1)
        ziel = links.get(beschriftung)
        if ziel and ziel.startswith("https://"):
            return f'<a href="{esc(ziel)}" target="_blank" rel="noopener">{esc(beschriftung)}</a>'
        return esc(beschriftung)

    return re.sub(r"\[([^\]]+)\]", ersetze, esc(text))

_MASSE_CACHE = {}


def bild_masse(url):
    """` width="W" height="H"` für ein Bild im Repo, sonst leerer String.

    Gehört an jedes <img>, das ein Generator schreibt. Ohne die beiden Angaben
    kennt der Browser das Seitenverhältnis erst, wenn das Bild geladen ist, und
    alles darunter rutscht beim Laden nach unten — Cumulative Layout Shift, und
    CLS ist ein Rankingsignal.

    Warum der Helfer hier steht und nicht nur in build-bildmasse.py: Solange die
    Generatoren ihre Kacheln ohne Maße schreiben, entfernt jeder Generatorlauf,
    was build-bildmasse.py zuvor ergänzt hat — die Baukette ändert dann bei jedem
    Durchlauf dieselben Dateien hin und her. build-bildmasse.py ist für die von
    Hand geschriebenen Seiten da, dieser Helfer für die generierten.

    Nimmt sowohl `/assets/...` als auch die eigene Domain absolut geschrieben —
    letzteres steht so in den Insta-Archiv-Seiten.
    """
    if not url:
        return ""
    if url in _MASSE_CACHE:
        return _MASSE_CACHE[url]
    pfad_teil = url.split("?")[0]
    if pfad_teil.startswith(BASE):
        pfad_teil = "/" + pfad_teil[len(BASE):]
    ergebnis = ""
    if pfad_teil.startswith("/"):
        pfad = REPO / pfad_teil.lstrip("/")
        if pfad.is_file():
            if pfad.suffix.lower() == ".svg":
                m = re.search(r'viewBox="([\d.\-\s]+)"',
                              pfad.read_text(encoding="utf-8", errors="ignore"))
                if m:
                    teile = m.group(1).split()
                    if len(teile) == 4 and float(teile[2]) > 0 and float(teile[3]) > 0:
                        ergebnis = (f' width="{round(float(teile[2]))}"'
                                    f' height="{round(float(teile[3]))}"')
            else:
                try:
                    from PIL import Image
                    with Image.open(pfad) as bild:
                        ergebnis = f' width="{bild.size[0]}" height="{bild.size[1]}"'
                except Exception:
                    ergebnis = ""
    _MASSE_CACHE[url] = ergebnis
    return ergebnis
