#!/usr/bin/env python3
"""Schreibt die Instagram-Archiv-Uebersicht statisch in news/instagram-archiv.html.

Warum: Der Ahrefs-Crawl vom 24.08.2026 meldete 22 von 24 Fehlern als Orphan
Pages -- 20 davon die Insta-Archivseiten unter news/insta-archiv/. Die
Instagram-Kacheln auf der Startseite und unter "Aktuelles" entstehen erst im
Browser (js/home-news-feed.js) und verlinken ausserdem nur die aktuell im
Behold-Feed stehenden Posts (js/aktuelles.html) -- im ausgelieferten HTML zeigt
kein einziger Link auf eine Archivseite, und aeltere, aus dem Feed gefallene
Posts waeren so oder so nie erreichbar.

Datenquelle ist bewusst der Ordner news/insta-archiv/ selbst, nicht
data/instagram-loewen.json / data/instagram-loewenpark.json: die Feed-Dateien
enthalten nur die aktuellen Behold-Posts (8 Stand 25.08.2026), waehrend auf der
Platte 20 Archivseiten liegen. Aeltere Beitraege fallen aus dem Feed, ihre Seite
bleibt -- eine feed-basierte Liste wuerde also 12 Seiten stillschweigend
auslassen.

Titel, Datum und Account-Kanal stehen bereits vollstaendig im HTML jeder
Archivseite (siehe Vorlage im n8n-Workflow "Website: News - Social Instagram
abrufen", GpAS0ONrenHrcTwS): <h1> traegt den Titel, die Meta-Zeile direkt
darunter "D. Monat JJJJ [· N Likes] [· N Kommentare]" traegt das Datum. Das ist
zuverlaessiger als der urspruenglich erwogene Weg ueber Feed-timestamp/
Commit-Datum: Feed-timestamp fehlt fuer laengst aus dem Feed gefallene Posts,
und das Commit-Datum vieler Dateien stammt vom Bulk-Commit "Website-Launch
vorbereiten" (27.07.2026), der alle Altdateien gleichzeitig anfasste -- das
waere fuer alle betroffenen Posts dasselbe falsche Datum.

Vorschaubild: assets/img/insta/<Dateiname ohne .html>.jpg, wenn vorhanden --
derselbe lokale Cache, den js/aktuelles.html und tools/fix-insta-archiv-legacy.py
bereits nutzen (12 von 20 Posts haben ein echtes Bild; aeltere Posts, fuer die
nie ein Bild gesichert wurde, fallen auf das og:image jeder Archivseite zurueck,
in der Praxis das Standard-Share-Bild).

Bewusst ohne JavaScript: anders als build-news-list.py/build-freiplaetze.py gibt
es kein Frontend-Skript, das dieselbe Liste im Browser nochmal rendert -- die
Archiv-Uebersicht ist rein statisch und wird nur von diesem Skript gepflegt.

Eigentumsgrenze: Dieses Skript LIEST nur news/insta-archiv/*.html, schreibt dort
nichts hinein. Diese Seiten gehoeren dem n8n-Workflow, solange ein Post im
Behold-Feed steht (siehe SKIP_PREFIXES in build-head-meta.py).

Aufruf:
  python3 tools/build-instagram-archiv.py
  python3 tools/build-instagram-archiv.py --check
"""

import argparse
import html
import re
import sys

from seo_common import REPO, bild_masse, text_of

ARCHIV = REPO / "news" / "insta-archiv"
ZIEL = REPO / "news" / "instagram-archiv.html"
CONTAINER = '<div class="grid-3" id="instagram-archiv-grid">'
START = "<!--INSTAARCHIV:auto-->"
END = "<!--/INSTAARCHIV:auto-->"

ACCOUNT_LABELS = {
    "loewen": "@basketball.loewen",
    "loewenpark": "@loewenpark.hallenmeister",
}

MONATE = {
    "Januar": 1, "Februar": 2, "März": 3, "April": 4, "Mai": 5, "Juni": 6,
    "Juli": 7, "August": 8, "September": 9, "Oktober": 10, "November": 11,
    "Dezember": 12,
}

H1_RE = re.compile(r"<h1>(.*?)</h1>", re.S)
DATE_RE = re.compile(
    r'style="color:var\(--text-muted\);margin-bottom:16px">'
    r"(\d{1,2})\.\s+(\w+)\s+(\d{4})"
)
OG_IMAGE_RE = re.compile(r'<meta property="og:image" content="(.*?)" />')


def eintrag(pfad):
    """Ein Beitrag als dict, oder None wenn Titel/Datum nicht gefunden wurden."""
    text = pfad.read_text(encoding="utf-8")
    m_h1 = H1_RE.search(text)
    m_datum = DATE_RE.search(text)
    if not (m_h1 and m_datum):
        return None

    tag, monatsname, jahr = m_datum.groups()
    monat = MONATE.get(monatsname)
    if monat is None:
        return None

    stem = pfad.stem
    account = stem.split("-", 1)[0]
    local_image = REPO / "assets" / "img" / "insta" / f"{stem}.jpg"
    if local_image.exists():
        bild = f"/assets/img/insta/{stem}.jpg"
    else:
        m_img = OG_IMAGE_RE.search(text)
        bild = m_img.group(1) if m_img else "/assets/img/share/og-default.jpg"

    return {
        "datei": pfad.name,
        "sortkey": (int(jahr), monat, int(tag)),
        "datum_anzeige": f"{tag}. {monatsname} {jahr}",
        "account_label": ACCOUNT_LABELS.get(account, "@basketball.loewen"),
        "titel": text_of(m_h1.group(1)),
        "bild": bild,
        "url": f"/news/insta-archiv/{pfad.name}",
    }


def karte(e):
    return (
        f'<a class="card hoverable" href="{e["url"]}" style="text-decoration:none;color:inherit">'
        f'<div class="card-media-photo"><img loading="lazy" src="{html.escape(e["bild"], quote=True)}"{bild_masse(e["bild"])} alt="" '
        f"onerror=\"this.onerror=null;this.src='/assets/img/share/og-default.jpg'\" /></div>"
        f'<div class="card-body">'
        f'<span class="card-label">{html.escape(e["datum_anzeige"])} · {html.escape(e["account_label"])}</span>'
        f'<h3 style="font-size:18px">{html.escape(e["titel"])}</h3>'
        f'<span class="card-link">Beitrag ansehen <i data-lucide="arrow-right" class="icon-14"></i></span>'
        f"</div></a>"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    dateien = sorted(ARCHIV.glob("*.html"))
    eintraege, probleme = [], []
    for pfad in dateien:
        e = eintrag(pfad)
        if e is None:
            probleme.append(pfad.name)
        else:
            eintraege.append(e)

    for p in probleme:
        print(f"  ACHTUNG {p}: Titel oder Datum nicht gefunden, ausgelassen", file=sys.stderr)

    eintraege.sort(key=lambda e: (e["sortkey"], e["datei"]), reverse=True)
    karten = "\n".join("            " + karte(e) for e in eintraege)
    block = f"{CONTAINER}{START}\n{karten}\n            {END}</div>"

    alt = ZIEL.read_text(encoding="utf-8")
    gebaut = re.compile(re.escape(CONTAINER) + re.escape(START) + r".*?" + re.escape(END) + r"</div>", re.S)
    if gebaut.search(alt):
        neu = gebaut.sub(lambda _: block, alt, count=1)
    elif CONTAINER + "</div>" in alt:
        neu = alt.replace(CONTAINER + "</div>", block, 1)
    else:
        print(f"  ACHTUNG Container {CONTAINER} in {ZIEL.name} nicht gefunden", file=sys.stderr)
        return 1

    fehlend = [e["url"] for e in eintraege if e["url"] not in neu]
    if fehlend:
        print(f"  ACHTUNG {len(fehlend)} Archivseiten fehlen im Ergebnis: {fehlend}", file=sys.stderr)
        return 1

    if len(dateien) != len(eintraege):
        print(f"  ACHTUNG nur {len(eintraege)} von {len(dateien)} Archivseiten verarbeitet", file=sys.stderr)

    if neu == alt:
        print(f"  unverändert, {len(eintraege)} Beiträge verlinkt")
        return 0

    if args.check:
        print(f"  zu bauen: {len(eintraege)} Beiträge")
        return 1

    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben: {len(eintraege)} Beiträge verlinkt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
