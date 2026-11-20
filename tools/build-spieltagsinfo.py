#!/usr/bin/env python3
"""Baut die Übersicht aller Ausgaben der digitalen Spieltagsinfo.

Ziel:   saison/profis/gameday/spieltagsinfo/index.html
Quelle: data/spieltagsinfo.json (Ausgaben) und data/heimspiele.json (welches
        Heimspiel zu welcher Ausgabe gehört, Feld spieltagsinfo)

Anlass (20.11.2026): Andrés Heft verlinkt in der Fußzeile „Alle Ausgaben“ auf
diese Adresse, und build-head-meta.py kennt sie schon fürs Vorschaubild. Die
Seite selbst fehlte bis dahin.

Je Ausgabe eine Karte, neueste zuerst: Titelbild (vorschau.webp, sonst das
Cover der Ausgabe), Titel, Heimspiel mit Datum, Beschreibung, „Online lesen“
und, wenn freigegeben, das PDF. Kopf, Fuß und SEO-Block übernimmt das Skript
aus der bestehenden Datei, wie build-gameday-hub.py, damit build-partials.py
und build-head-meta.py nicht bei jedem Lauf überschrieben werden.

Aufruf:
  python3 tools/build-spieltagsinfo.py           # schreibt bei Änderung
  python3 tools/build-spieltagsinfo.py --check   # nur prüfen (Rückgabe 1 = zu ändern)
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import attr as esc

REPO = Path(__file__).resolve().parent.parent
AUSGABEN = REPO / "data" / "spieltagsinfo.json"
HEIMSPIELE = REPO / "data" / "heimspiele.json"
ZIEL = REPO / "saison" / "profis" / "gameday" / "spieltagsinfo" / "index.html"

LEER_HEADER = '<div id="site-header-placeholder"></div>'
LEER_FOOTER = '<div id="site-footer-placeholder"></div>'
SEO_START = "<!-- SEO:auto START"
SEO_ENDE = "<!-- SEO:auto END -->"

TITEL = "Spieltagsinfo: alle Ausgaben — Basketball Löwen Erfurt"
BESCHREIBUNG = ("Alle Ausgaben der digitalen Spieltagsinfo der Basketball Löwen Erfurt: "
                "Kader, Tabelle, Spielplan und Geschichten aus dem Verein zu jedem Heimspiel.")


def heimspiele():
    daten = json.loads(HEIMSPIELE.read_text(encoding="utf-8"))
    liste = daten if isinstance(daten, list) else next(v for v in daten.values() if isinstance(v, list))
    return liste


def spiele_je_ausgabe():
    je = {}
    for s in heimspiele():
        nr = s.get("spieltagsinfo")
        if nr:
            je.setdefault(int(nr), []).append(s)
    return je


def bild(nr, ausgabe):
    vorschau = REPO / "assets" / "spieltagsinfo" / f"ausgabe-{nr}" / "vorschau.webp"
    if vorschau.exists():
        return f"/assets/spieltagsinfo/ausgabe-{nr}/vorschau.webp"
    if ausgabe.get("cover"):
        return f"/assets/spieltagsinfo/ausgabe-{nr}/{ausgabe['cover']}"
    return ""


def karte(ausgabe, spiele):
    nr = ausgabe["nr"]
    url = f"/saison/profis/gameday/spieltagsinfo/ausgabe-{nr}/"
    src = bild(nr, ausgabe)
    media = ""
    if src:
        # Ohne width/height: tools/build-bildmasse.py trägt sie später in der Kette nach.
        media = (f'          <a class="card-media" href="{url}" tabindex="-1" aria-hidden="true" '
                 f'style="height:220px;padding:0;display:block">'
                 f'<img loading="lazy" decoding="async" src="{src}" alt="" '
                 f'style="width:100%;height:100%;object-fit:cover;object-position:top;display:block" /></a>\n')
    spiel = ""
    if spiele:
        teile = []
        for s in spiele:
            seite = s.get("seiteSlug")
            text = f"{esc(s['gegner'])} am {esc(s['datum'])}"
            teile.append(f'<a href="/saison/profis/gameday/{esc(seite)}.html">{text}</a>' if seite else text)
        spiel = f'            <p class="t-caption" style="margin:0 0 8px">Heimspiel gegen {", ".join(teile)}</p>\n'
    pdf = ""
    if ausgabe.get("pdf"):
        pdf = (f'              <a class="card-link" href="/assets/spieltagsinfo/{esc(ausgabe["pdf"])}" download>'
               f'PDF herunterladen <i data-lucide="file-text" class="icon-14"></i></a>\n')
    return f"""        <div class="card hoverable">
{media}          <div class="card-body">
            <span class="card-label">Ausgabe {nr}</span>
            <h2 class="t-h4" style="margin:4px 0 6px"><a href="{url}" style="color:inherit;text-decoration:none">{esc(ausgabe['titel'])}</a></h2>
{spiel}            <p>{esc(ausgabe.get('beschreibung', ''))}</p>
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <a class="card-link" href="{url}">Online lesen <i data-lucide="arrow-right" class="icon-14"></i></a>
{pdf}            </div>
          </div>
        </div>"""


def uebernehmen(muster, leer):
    if not ZIEL.exists():
        return leer
    m = re.search(muster, ZIEL.read_text(encoding="utf-8"), re.S)
    return m.group(0) if m else leer


def seite():
    daten = json.loads(AUSGABEN.read_text(encoding="utf-8"))
    je = spiele_je_ausgabe()
    ausgaben = sorted(daten["ausgaben"], key=lambda a: a["nr"], reverse=True)
    karten = "\n".join(karte(a, je.get(a["nr"], [])) for a in ausgaben)

    header = uebernehmen(r'<div id="site-header-placeholder">.*?</div>\s*(?=<main|\Z)', LEER_HEADER).rstrip()
    footer = uebernehmen(r'<div id="site-footer-placeholder">.*?</div>\s*(?=<script|\Z)', LEER_FOOTER).rstrip()
    seo = uebernehmen(re.escape(SEO_START) + r".*?" + re.escape(SEO_ENDE), "")
    if seo:
        seo += "\n"

    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>{esc(TITEL)}</title>
<meta name="description" content="{esc(BESCHREIBUNG)}" />
<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/css/colors_and_type.css?v=1785398309" />
<link rel="stylesheet" href="/css/site.css?v=1792352138" />
<script data-goatcounter="https://goatcounter-production-5d8c.up.railway.app/count"
        async src="//goatcounter-production-5d8c.up.railway.app/count.js"></script>
<!-- ANALYTICS:ahrefs — Vergleichstest neben GoatCounter, gestartet 25.08.2026.
     Cookiefrei, kein Zugriff auf den Endgeraetespeicher (im Skript geprueft:
     kein localStorage, kein Cookie). Empfaenger Ahrefs Pte Ltd, Singapur;
     Standardvertragsklauseln Modul 2 am 25.08.2026 abgeschlossen, Abschnitt 4
     der Datenschutzerklaerung. Entfernen: Block zwischen den beiden Markern
     loeschen, in allen Seiten. -->
<script src="https://analytics.ahrefs.com/analytics.js" data-key="5TVH543YAI/GzTMbTLbbbg" async></script>
<!--/ANALYTICS:ahrefs-->
{seo}</head>
<body data-nav-group="gameday">
<a class="skip-link" href="#main">Zum Inhalt springen</a>
{header}
<main id="main">
  <section class="section">
    <div class="container">
      <div class="section-head">
        <div class="head-text">
          <span class="eyebrow">Spieltagsinfo · Saison {esc(daten['saison'])}</span>
          <h1 class="t-h2">Alle Ausgaben</h1>
          <p class="t-body mt-3">Zu jedem Heimspiel der Basketball Löwen Erfurt gibt es die digitale Spieltagsinfo: Kader der Löwen und der Gäste, Ligastand, Spielplan und Geschichten aus dem Verein. Hier stehen alle Ausgaben der Saison.</p>
        </div>
      </div>
      <div class="grid-3">
{karten}
      </div>
      <div style="display:flex;justify-content:center;margin-top:24px">
        <a class="btn btn-ghost btn-sm" href="/saison/profis/gameday/">Zum nächsten Heimspiel</a>
      </div>
    </div>
  </section>
</main>
{footer}
<script src="/js/vendor/lucide-icons.js?v=1791710586"></script>
<script src="/js/nav.js?v=1791838361"></script>
<script src="/js/include.js?v=1787854261"></script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()
    neu = seite()
    alt = ZIEL.read_text(encoding="utf-8") if ZIEL.exists() else None
    if neu == alt:
        print("  unverändert")
        return 0
    if args.check:
        print("  zu ändern")
        return 1
    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    ZIEL.write_text(neu, encoding="utf-8")
    print("  geschrieben")
    return 0


if __name__ == "__main__":
    sys.exit(main())
