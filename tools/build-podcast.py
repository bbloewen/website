#!/usr/bin/env python3
"""Schreibt den Podcast-Bereich und die Podcast-Kachel statisch in news/aktuelles.html.

Quelle: data/podcast.json (erzeugt von tools/podcast-sync.py aus dem Podigee-Feed) und
data/podcast-artikel.json (Folgennummer -> Adresse des News-Artikels, von Hand gepflegt).

Zwei Bloecke in news/aktuelles.html, jeweils zwischen Markern:
  <!--PODCAST:bereich-->...<!--/PODCAST:bereich-->   Abschnitt mit den letzten fuenf Folgen (id="podcast")
  <!--PODCAST:kachel-->...<!--/PODCAST:kachel-->     Kachel in der rechten Seitenleiste (letzte Folge)

Warum statisch: Ein Crawler ohne JavaScript soll die Folgen sehen (wie bei Community-Events und Spielplan).

Aufruf:
  python3 tools/build-podcast.py
  python3 tools/build-podcast.py --check
"""

import argparse
import json
import re
import sys
from datetime import date

from seo_common import REPO, esc

ZIEL = REPO / "news" / "aktuelles.html"
DATEN = REPO / "data" / "podcast.json"
ARTIKEL = REPO / "data" / "podcast-artikel.json"
ANZAHL = 5

MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
          "November", "Dezember"]


def datum_de(iso):
    d = date.fromisoformat(iso)
    return f"{d.day:02d}.{d.month:02d}.{d.year}"


def dauer_text(minuten):
    h, m = divmod(int(minuten), 60)
    return f"{h} Std. {m:02d} Min." if h else f"{m} Min."


def kuerzen(text, limit):
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    kurz = text[:limit].rsplit(" ", 1)[0].rstrip(",;:.-– ")
    return kurz + " …"


def alt_text(f):
    return f"Cover der Tip-Off-Folge {f['nr']}: {f['titel']}"


def folge_karte(f, artikel, daten):
    bild = (f'<img loading="lazy" src="{esc(f["bild"])}" width="900" height="900" alt="{esc(alt_text(f))}" />') if f.get("bild") else ""
    a_url = artikel.get(str(f["nr"]))
    if bild and a_url:
        bild = f'<a href="{esc(a_url)}" tabindex="-1" aria-hidden="true" style="display:block;height:100%">{bild}</a>'
    # Cover sind quadratisch: Kachel auf 1:1 statt der festen 180 px der News-Kacheln, sonst wird das Cover beschnitten.
    media = f'<div class="card-media-photo" style="height:auto;aspect-ratio:1/1">{bild}</div>' if bild else ""
    links = []
    if a_url:
        links.append(f'<a class="card-link" href="{esc(a_url)}">Zum Artikel '
                     f'<i data-lucide="arrow-right" class="icon-14"></i></a>')
    quellen = (f'<a href="{esc(daten["spotify"])}" target="_blank" rel="noopener">Spotify</a> · '
               f'<a href="{esc(daten["apple"])}" target="_blank" rel="noopener">Apple Podcasts</a>')
    links.append(f'<span class="t-body-sm" style="color:var(--text-muted)">{quellen}</span>')
    return (
        f'<div class="card">{media}<div class="card-body">'
        f'<span class="card-label">Folge {f["nr"]} · {datum_de(f["datum"])} · {dauer_text(f["minuten"])}</span>'
        f'<h3 style="font-size:18px">{esc(f["titel"])}</h3>'
        f'<p>{esc(kuerzen(f["kurztext"], 240))}</p>'
        f'<div style="display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin-top:10px">{"".join(links)}</div>'
        f'</div></div>'
    )


def bereich_html(daten, artikel):
    folgen = daten["folgen"][:ANZAHL]
    karten = "\n          ".join(folge_karte(f, artikel, daten) for f in folgen)
    return (
        '<section class="section bg-subtle" id="podcast" style="scroll-margin-top:96px">\n'
        '    <div class="container">\n'
        '      <span class="eyebrow" style="display:block;margin-bottom:8px">Podcast</span>\n'
        '      <h2 class="t-h2">Tip-Off: die letzten Folgen</h2>\n'
        '      <p class="t-body" style="max-width:62ch;margin:8px 0 24px;color:var(--text-secondary)">'
        'Der Podcast der Basketball Löwen Erfurt mit Johannes Wiese und Florian Gut, präsentiert von dotflow.</p>\n'
        '      <div class="grid-3">\n          '
        f'{karten}\n'
        '      </div>\n'
        '    </div>\n'
        '  </section>'
    )


def kachel_html(daten, artikel):
    f = daten["folgen"][0]
    a_url = artikel.get(str(f["nr"])) or "#podcast"
    bild = ""
    if f.get("bild"):
        bild = (f'<a href="{esc(a_url)}" style="display:block;margin:8px 0 10px"><img loading="lazy" '
                f'src="{esc(f["bild"])}" width="900" height="900" alt="{esc(alt_text(f))}" '
                f'style="display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:8px" /></a>')
    zeilen = [
        '<div class="info-tile">',
        '            <div class="insta-sidebar-block" style="margin:0;padding:0;border:none">',
        '              <h3>Tip-Off, der Podcast</h3>',
        f'              {bild}',
        f'              <p class="t-body-sm" style="color:var(--text-muted);margin:2px 0 4px">'
        f'Folge {f["nr"]} · {datum_de(f["datum"])}</p>',
        f'              <p class="t-body-sm" style="margin:0 0 8px"><strong>{esc(f["titel"])}</strong></p>',
        f'              <p class="t-body-sm" style="color:var(--text-muted);margin:0 0 8px">'
        f'{esc(kuerzen(f["kurztext"], 150))}</p>',
    ]
    if artikel.get(str(f["nr"])):
        zeilen.append(f'              <a class="card-link mt-1" href="{esc(artikel[str(f["nr"])])}">Zum Artikel '
                      f'<i data-lucide="arrow-right" class="icon-14"></i></a>')
    zeilen += [
        '              <a class="card-link mt-1" style="display:block" href="#podcast">Alle Folgen '
        '<i data-lucide="arrow-down" class="icon-14"></i></a>',
        f'              <p class="t-body-sm" style="margin:10px 0 0;color:var(--text-muted)">'
        f'<a href="{esc(daten["spotify"])}" target="_blank" rel="noopener">Spotify</a> · '
        f'<a href="{esc(daten["apple"])}" target="_blank" rel="noopener">Apple Podcasts</a></p>',
        '            </div>',
        '          </div>',
    ]
    return "\n".join(zeilen)


def ersetze(text, name, inhalt):
    start, ende = f"<!--PODCAST:{name}-->", f"<!--/PODCAST:{name}-->"
    if start not in text or ende not in text:
        raise SystemExit(f"Marker {start} fehlt in {ZIEL}")
    a = text.index(start)
    b = text.index(ende) + len(ende)
    return text[:a] + f"{start}{inhalt}{ende}" + text[b:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    artikel = json.loads(ARTIKEL.read_text(encoding="utf-8")) if ARTIKEL.exists() else {}
    if not daten.get("folgen"):
        print("Keine Folgen in data/podcast.json")
        return 0

    alt = ZIEL.read_text(encoding="utf-8")
    neu = ersetze(alt, "bereich", bereich_html(daten, artikel))
    neu = ersetze(neu, "kachel", kachel_html(daten, artikel))
    if neu == alt:
        print("aktuelles.html: Podcast unveraendert")
        return 0
    if args.check:
        print("aktuelles.html: Podcast-Bloecke weichen ab")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print("aktuelles.html: Podcast-Bloecke geschrieben")
    return 0


if __name__ == "__main__":
    sys.exit(main())
