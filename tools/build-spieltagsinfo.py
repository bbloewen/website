#!/usr/bin/env python3
"""Baut die Uebersichtsseite aller Spieltagsinfo-Ausgaben.

Seite:    /saison/profis/gameday/spieltagsinfo/   (saison/profis/gameday/spieltagsinfo/index.html)
Quelle:   data/spieltagsinfo.json  (Ausgaben)  +  data/heimspiele.json (Feld "spieltagsinfo")

Die Seite je Ausgabe (…/ausgabe-N/) wird NICHT hier gebaut: sie kommt als fertiges
HTML aus tools/optimiere-spieltagsinfo.py. Dieses Skript legt nur die Uebersicht an
und erzeugt je Ausgabe ein Vorschaubild (assets/spieltagsinfo/ausgabe-N/vorschau.webp)
aus dem Titelbild.

Header, Footer und der SEO-Block werden aus der bestehenden Datei uebernommen
(gleiche Begruendung wie in build-gameday-hub.py): Dieses Skript schreibt die Seite
komplett neu, build-partials.py und build-head-meta.py laufen danach.
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "spieltagsinfo.json"
HEIMSPIELE = REPO / "data" / "heimspiele.json"
ZIEL = REPO / "saison" / "profis" / "gameday" / "spieltagsinfo" / "index.html"
ASSETS = REPO / "assets" / "spieltagsinfo"

LEER_HEADER = '<div id="site-header-placeholder"></div>'
LEER_FOOTER = '<div id="site-footer-placeholder"></div>'
SEO_START = "<!-- SEO:auto START"
SEO_ENDE = "<!-- SEO:auto END -->"

VORSCHAU_BREITE = 480
VORSCHAU_ANKER = 0.2


def esc(s):
    return html.escape(str(s), quote=True)


def ausgabe_url(nr):
    return f"/saison/profis/gameday/spieltagsinfo/ausgabe-{nr}/"


def pdf_url(a):
    return f"/assets/spieltagsinfo/{a['pdf']}"


def vorschau(a):
    """Vorschaubild aus dem Titelbild (einmal erzeugen, danach nur pruefen)."""
    quelle = ASSETS / f"ausgabe-{a['nr']}" / a["cover"]
    ziel = ASSETS / f"ausgabe-{a['nr']}" / "vorschau.webp"
    if not quelle.exists():
        return None
    if not ziel.exists() or ziel.stat().st_mtime < quelle.stat().st_mtime:
        with Image.open(quelle) as im:
            im = im.convert("RGB")
            # Titelbilder sind Hochformat; die Karte braucht Querformat 3:2. Zuschnitt
            # mit Anker im oberen Bilddrittel, dort liegen die Gesichter.
            hoehe = round(im.width * 2 / 3)
            if im.height > hoehe:
                oben = round((im.height - hoehe) * VORSCHAU_ANKER)
                im = im.crop((0, oben, im.width, oben + hoehe))
            h = round(im.height * VORSCHAU_BREITE / im.width)
            im.resize((VORSCHAU_BREITE, h), Image.LANCZOS).save(ziel, "WEBP", quality=78, method=6)
    with Image.open(ziel) as im:
        w, h = im.size
    return f"/assets/spieltagsinfo/ausgabe-{a['nr']}/vorschau.webp", w, h


def spiele_je_ausgabe():
    daten = json.loads(HEIMSPIELE.read_text(encoding="utf-8"))
    out = {}
    for s in daten.get("spiele", []):
        n = s.get("spieltagsinfo")
        if n:
            out.setdefault(int(n), []).append(s)
    return out


def karte(a, spiele):
    v = vorschau(a)
    bild = ""
    if v:
        url, w, h = v
        bild = (f'<div class="card-media-photo"><a href="{ausgabe_url(a["nr"])}" tabindex="-1" aria-hidden="true" style="display:block;height:100%">'
                f'<img loading="lazy" decoding="async" src="{url}" width="{w}" height="{h}" alt="" />'
                f'</a></div>')
    if spiele:
        gegner = " · ".join(s["gegner"] for s in spiele)
        label = f"Ausgabe {a['nr']} · Heimspiel {spiele[0]['datum']}"
    else:
        gegner = a["titel"]
        label = f"Ausgabe {a['nr']}"
    seiten = f", {a['seiten']} Seiten" if a.get("seiten") else ""
    return f"""        <article class="card">
          {bild}
          <div class="card-body">
            <span class="card-label">{esc(label)}</span>
            <h3 class="t-h4" style="margin:6px 0 8px"><a href="{ausgabe_url(a['nr'])}" style="text-decoration:none;color:inherit">{esc(gegner)}</a></h3>
            <p class="t-body-sm">{esc(a['beschreibung'])}</p>
            <p style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:12px">
              <a class="card-link" href="{ausgabe_url(a['nr'])}">Online lesen <i data-lucide="arrow-right" class="icon-14"></i></a>
              <a class="card-link" href="{pdf_url(a)}" download>PDF (DIN A5{seiten}) <i data-lucide="download" class="icon-14"></i></a>
            </p>
          </div>
        </article>"""


def inhalt(daten):
    spiele = spiele_je_ausgabe()
    ausgaben = sorted(daten["ausgaben"], key=lambda a: -a["nr"])
    karten = "\n".join(karte(a, spiele.get(a["nr"], [])) for a in ausgaben)
    return f"""  <section class="hero-photo hero-tickets hero-half">
    <div class="container">
      <div class="hero-lg-grid">
        <div>
          <span class="eyebrow">Gameday · Saison {esc(daten['saison'])}</span>
          <h1 style="font-size:clamp(22px,3.4vw,40px);white-space:normal">Die <span class="kw">Spieltagsinfo</span><span class="swoosh" aria-hidden="true"></span>.</h1>
          <p class="lead">Zu den Heimspielen der Basketball Löwen: Kader, Ligastand, Spielplan und Geschichten aus dem Verein.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <div class="head-text" style="max-width:none">
          <span class="eyebrow">Alle Ausgaben</span>
          <h2 class="t-h2">Heimspiel für Heimspiel</h2>
          <p class="t-body mt-3">Jede Ausgabe gibt es als Seite zum Lesen auf dem Handy und als PDF im DIN-A5-Format zum Herunterladen und Ausdrucken. Sie erscheint zu den Heimspielen der Profis in der Riethsporthalle; eine Ausgabe kann auch für mehrere Spiele gelten. Das Spiel selbst findest du im <a href="/saison/spielplan.html?team=profis">Spielplan</a> und auf der <a href="/saison/profis/gameday/">Gameday-Seite</a> mit Tickets.</p>
        </div>
      </div>
      <div class="grid-3 mt-5">
{karten}
      </div>
    </div>
  </section>"""


def uebernehmen(muster, leer):
    """Header, Footer und SEO-Block aus der bestehenden Datei retten."""
    if not ZIEL.exists():
        return leer
    m = re.search(muster, ZIEL.read_text(encoding="utf-8"), re.S)
    return m.group(0) if m else leer


def seite(daten):
    header = uebernehmen(r'<div id="site-header-placeholder">.*?</div>\s*(?=<main|\Z)', LEER_HEADER).rstrip()
    footer = uebernehmen(r'<div id="site-footer-placeholder">.*?</div>\s*(?=<script|\Z)', LEER_FOOTER).rstrip()
    seo = uebernehmen(re.escape(SEO_START) + r".*?" + re.escape(SEO_ENDE), "")
    if seo:
        seo += "\n"
    n = len(daten["ausgaben"])
    beschreibung = (f"Spieltagsinfo der Basketball Löwen Erfurt: alle {n} Ausgaben der Saison {daten['saison']} "
                    f"mit Kader, Ligastand und Spielplan, online lesen oder als PDF laden.")
    if n == 1:
        beschreibung = (f"Spieltagsinfo der Basketball Löwen Erfurt: Ausgabe 1 der Saison {daten['saison']} "
                        f"mit Kader, Ligastand und Spielplan, online lesen oder als PDF laden.")
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>Spieltagsinfo zu den Heimspielen — Basketball Löwen Erfurt</title>
<meta name="description" content="{esc(beschreibung)}" />
<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/css/colors_and_type.css?v=1785398309" />
<link rel="stylesheet" href="/css/site.css?v=1791105764" />
{ANALYTICS}{seo}</head>
<body data-nav-group="gameday" class="hide-mobile-cta">
<a class="skip-link" href="#main">Zum Inhalt springen</a>
{header}
<main id="main">
{inhalt(daten)}
</main>
{footer}
<script src="/js/vendor/lucide-icons.js?v=1791549139"></script>
<script src="/js/nav.js?v=1789585539"></script>
<script src="/js/include.js?v=1787854261"></script>
</body>
</html>
"""


def _analytics():
    q = (REPO / "saison" / "profis" / "gameday" / "index.html").read_text(encoding="utf-8")
    m = re.search(r"<script data-goatcounter.*?<!--/ANALYTICS:ahrefs-->\n", q, re.S)
    if not m:
        raise SystemExit("Statistik-Block auf der Gameday-Seite nicht gefunden")
    return m.group(0)


ANALYTICS = _analytics()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    neu = seite(daten)
    alt = ZIEL.read_text(encoding="utf-8") if ZIEL.exists() else None
    hinweis = f"{len(daten['ausgaben'])} Ausgabe(n)"
    if neu == alt:
        print(f"  unverändert ({hinweis})")
        return 0
    if args.check:
        print(f"  zu ändern ({hinweis})")
        return 1
    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben ({hinweis})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
