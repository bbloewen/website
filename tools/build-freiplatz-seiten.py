#!/usr/bin/env python3
"""Erzeugt je Freiplatz eine eigene, indexierbare Seite.

Ausgangslage: Alle sechs Plätze teilten sich eine einzige Adresse,
trainieren/freiplatz.html?platz=<slug>. Diese Hülle steht auf noindex, und das
war richtig — eine Seite, deren ganzer Inhalt am Query-Parameter hängt, hat für
den Index keine sinnvolle einzelne Fassung. Die Folge war aber, dass kein
einzelner Platz auffindbar war: Wer "Freiplatz Nordpark Erfurt" sucht, findet
höchstens die Übersicht.

Seit dem 25.08.2026 bekommt deshalb jeder feste Platz eine eigene Adresse:

    trainieren/freiplatz/<slug>.html

Der slug ist derselbe wie in data/freiplaetze.json, im Dateinamen des QR-Codes
und im Court-Hunt-Backend — er darf sich nicht ändern, sonst zeigen gedruckte
Aufkleber ins Leere (siehe tools/build-freiplatz-qr.py).

Was hier statisch steht und was nicht:

  statisch   Überschrift, Beschreibung, Adresse, Foto, Zugangshinweis,
             Brotkrumen, Rücklink — also alles, was eine Suchmaschine lesen soll.
  per JS     Karte und Check-in. Beide brauchen ohnehin JavaScript (Leaflet und
             Geolocation); js/freiplaetze.js hängt sie über initPlatzseite() in
             die vorhandenen Container ein und lässt den statischen Inhalt in
             Ruhe. Erkannt wird das an data-platz-slug.

Die Event-Spots am mobilen Korb bekommen bewusst keine eigene Seite: Sie gelten
einen Tag. Für sie bleibt die Hülle mit ?platz=, und platzUrl() in
js/freiplaetze.js unterscheidet die beiden Fälle am Präfix 'event-'.

Aufruf:
  python3 tools/build-freiplatz-seiten.py
  python3 tools/build-freiplatz-seiten.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import bild_masse, esc, maps_url, mit_links, spielbar

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "freiplaetze.json"
VORLAGE = REPO / "trainieren" / "freiplatz.html"
ZIELORDNER = REPO / "trainieren" / "freiplatz"

INHALT_START = "<!--FREIPLATZ:inhalt-->"
INHALT_ENDE = "<!--/FREIPLATZ:inhalt-->"


def medien(f):
    """Spiegelt medienBlock(). Das QR-Overlay bleibt drin: Es zeigt auf Google
    Maps und ist fuer Leute am Rechner gedacht, die den Weg aufs Handy holen."""
    qr = (f'<img class="freiplatz-qr" src="{esc(f["qr"])}"{bild_masse(f["qr"])} '
          f'alt="QR-Code mit der Wegbeschreibung zum {esc(f["name"])}" loading="lazy" />'
          if f.get("qr") else "")
    if f.get("foto"):
        return ('<div class="card-media card-media-photo freiplatz-media">'
                f'<img src="{esc(f["foto"])}"{bild_masse(f["foto"])} alt="{esc(f["name"])}" loading="lazy" />'
                f'{qr}</div>')
    return ('<div class="card-media freiplatz-photo-placeholder freiplatz-media">'
            f'<i data-lucide="image" class="icon-22"></i><span>Foto folgt</span>{qr}</div>')


def inhalt(f):
    banner = ""
    detail = ""
    if not spielbar(f):
        banner = ('<div class="freiplatz-zugang-banner"><i data-lucide="lock" class="icon-16"></i> '
                  f'{esc(f.get("zugangHinweis") or "Zugang eingeschränkt")}</div>')
        if f.get("zugangDetail"):
            detail = ('<p class="freiplatz-zugang-detail">'
                      f'{mit_links(f["zugangDetail"], f.get("zugangLinks"))}</p>')

    return (
        f'{INHALT_START}\n'
        f'      <h1 class="t-h2">{esc(f["name"])}</h1>\n'
        f'      <p class="t-body mt-3">{esc(f["beschreibung"])}</p>\n'
        f'      <a class="freiplatz-adresse-link mt-4" href="{maps_url(f)}" target="_blank" rel="noopener">'
        f'<i data-lucide="map-pin" class="icon-16"></i> {esc(f["adresse"])}</a>\n'
        f'      {medien(f)}\n'
        + (f'      {banner}\n' if banner else "")
        + (f'      {detail}\n' if detail else "")
        + '      <div id="freiplatz-karte" class="freiplaetze-map freiplaetze-map-klein"></div>\n'
        '      <div class="freiplatz-checkin" id="freiplatz-checkin"></div>\n'
        '      <div class="freiplatz-maengel">\n'
        '        <p>Ist am Platz etwas kaputt — Korb, Netz oder Belag?</p>\n'
        '        <a class="btn btn-ghost" href="https://maengelmelder.erfurt.de/" target="_blank" rel="noopener">'
        '<i data-lucide="wrench" class="icon-16"></i> Beschädigung melden</a>\n'
        '        <p class="freiplatz-maengel-fuss">Die Plätze gehören der Stadt Erfurt, '
        'sie kümmert sich um Reparaturen.</p>\n'
        '      </div>\n'
        '      <p class="mt-5"><a class="card-link" href="/trainieren/freiplaetze.html">'
        '<i data-lucide="arrow-left" class="icon-14"></i> Alle Freiplätze in Erfurt</a></p>\n'
        f'      {INHALT_ENDE}'
    )


def titel(f):
    """Nur der Platzname. Kein zusaetzliches "in Erfurt": Das Wort steht schon im
    Suffix "Basketball Loewen Erfurt", und zweimal derselbe Ort im Titel liest
    sich wie ein Platzhalter. Damit bleibt der laengste Titel bei 58 Zeichen."""
    return f["name"]


def beschreibung(f):
    """Description aus Beschreibung und Adresse, hart auf 155 Zeichen begrenzt."""
    ort = f["adresse"].split(",")[0].strip()
    text = f"{f['beschreibung']} Adresse: {ort}, Erfurt."
    if len(text) <= 155:
        return text
    # Zu lang: Beschreibung am letzten Satzzeichen vor der Grenze kappen, damit
    # kein Wort mitten entzweigeht.
    schwanz = f" … {ort}, Erfurt."
    rest = f["beschreibung"][:155 - len(schwanz)]
    schnitt = max(rest.rfind(" "), 0) or len(rest)
    return rest[:schnitt].rstrip(" .,;–—") + schwanz


def seite(f, vorlage):
    t = vorlage

    # noindex muss weg -- genau das ist der Zweck dieser Seiten.
    t = re.sub(r"<!-- noindex:.*?-->\n", "", t, flags=re.S)
    t = re.sub(r'<meta name="robots" content="noindex"\s*/?>\n', "", t)

    t = re.sub(r"<title>.*?</title>",
               f"<title>{esc(titel(f))} — Basketball Löwen Erfurt</title>", t, count=1, flags=re.S)
    t = re.sub(r'(<meta name="description" content=")(.*?)(")',
               lambda m: m.group(1) + esc(beschreibung(f)) + m.group(3), t, count=1, flags=re.S)

    # Relative Pfade: die neuen Seiten liegen eine Ebene tiefer. Alle Verweise in
    # der Vorlage sind absolut (/js/..., /css/...), deshalb ist hier nichts zu
    # tun -- diese Zusicherung wird unten geprueft.
    ersatz = (f'<div class="container container-narrow" data-platz-slug="{esc(f["slug"])}">\n'
              f'      {inhalt(f)}\n'
              '    </div>')
    t, n = re.subn(
        r'<div class="container container-narrow">\s*<span class="eyebrow">.*?</div>\s*</div>',
        lambda m: ersatz, t, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("trainieren/freiplatz.html: Inhaltsblock nicht gefunden — Vorlage umgebaut?")
    return t


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = p.parse_args()

    vorlage = VORLAGE.read_text(encoding="utf-8")
    for pfad in re.findall(r'(?:href|src)="(\.\./|\./)', vorlage):
        raise SystemExit("trainieren/freiplatz.html enthält relative Pfade — "
                         "die neuen Seiten liegen eine Ebene tiefer und brauchen absolute.")

    daten = json.loads(DATEN.read_text(encoding="utf-8"))
    plaetze = daten.get("freiplaetze", [])
    if not plaetze:
        raise SystemExit("data/freiplaetze.json: keine Plätze gefunden")

    ZIELORDNER.mkdir(exist_ok=True)
    geschrieben = offen = 0
    for f in plaetze:
        ziel = ZIELORDNER / f"{f['slug']}.html"
        neu = seite(f, vorlage)
        alt = ziel.read_text(encoding="utf-8") if ziel.exists() else None
        if alt == neu:
            continue
        if args.check:
            print(f"  zu ändern: {ziel.relative_to(REPO)}")
            offen += 1
            continue
        ziel.write_text(neu, encoding="utf-8")
        geschrieben += 1

    if args.check:
        print(f"  {offen} von {len(plaetze)} Platzseiten zu ändern")
        return 1 if offen else 0
    print(f"  {geschrieben} geschrieben, {len(plaetze) - geschrieben} unverändert "
          f"({len(plaetze)} Platzseiten)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
