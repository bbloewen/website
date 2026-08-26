#!/usr/bin/env python3
"""Schreibt die Sponsorenkacheln statisch in partner/sponsoring.html und index.html.

Warum überhaupt:

Bis zum 26.08.2026 standen auf `partner/sponsoring.html` sechs leere `<div>`, die
erst per JavaScript aus `data/sponsoren.json` gefüllt wurden. Im ausgelieferten
HTML kam damit **kein einziger der 23 Partnernamen** vor — nicht CATL, nicht die
Stadtwerke, nicht die KoWo. Eine Suchmaschine sah eine Sponsorenseite ohne
Sponsoren, und ein Partner, der seinen eigenen Firmennamen sucht, konnte uns
darüber nicht finden. Dieselbe Lücke wie beim Spielplan, bei den Freiplätzen und
bei der Insta-Startseite (siehe die Fixhistorie in tools/README.md).

Wie der Fix funktioniert:

Die Kacheln werden hier gebaut und zwischen Markern in die Seite geschrieben.
Beim Laden ersetzt das Inline-Skript der Seite den Inhalt der Container per
`innerHTML` sowieso komplett — für Besucher ändert sich also nichts, die
Filter-Chips arbeiten unverändert auf dem JS-Ergebnis. Ohne JavaScript bleibt
jetzt eine lesbare Kachelwand stehen statt einer leeren Seite.

Das Kachel-Markup spiegelt `partnerTileHTML()` aus js/partner-tile.js. Ändert
sich dort etwas, muss es hier mit — deshalb prüft das Skript beim Start, dass die
JS-Funktion noch so aussieht wie erwartet, und bricht sonst ab. Lieber ein
klarer Abbruch als zwei Fassungen, die stillschweigend auseinanderlaufen.

Aufruf:
  python3 tools/build-partner-wall.py
  python3 tools/build-partner-wall.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from pathlib import Path

from seo_common import esc

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "sponsoren.json"
TILE_JS = REPO / "js" / "partner-tile.js"

# Container-id -> (Seite, tier-Filter, alphabetisch sortieren)
# Reihenfolge und Filter sind aus den Inline-Skripten der beiden Seiten
# übernommen; hauptpartner-grid filtert nicht auf tier, sondern auf das manuell
# gepflegte Flag hauptpartner (s. js/home-hauptpartner.js).
ZIELE = [
    ("partner/sponsoring.html", "partner-wall", "top", False),
    ("partner/sponsoring.html", "partner-wall-foerderpartner", "wirkungspartner", True),
    ("partner/sponsoring.html", "partner-wall-performance", "performance", False),
    ("partner/sponsoring.html", "partner-wall-partner", "partner", False),
    ("partner/sponsoring.html", "partner-wall-basis", "basis", False),
    ("partner/sponsoring.html", "partner-wall-weitere", "weitere", False),
    ("index.html", "hauptpartner-grid", "@hauptpartner", True),
]

# Zusicherung gegen Drift: diese Zeilen müssen in js/partner-tile.js stehen.
JS_ANKER = [
    "var front = p.logo ?",
    'if (tier === \'wirkungspartner\') back += \'<span class="partner-tag">Wirkungspartner</span>\';',
    "var cls = 'partner-tile partner-tile-' + tier;",
]


def kachel(p):
    """Spiegelt partnerTileHTML() aus js/partner-tile.js."""
    tier = p.get("tier") or ""
    if p.get("logo"):
        front = f'<img src="{esc(p["logo"])}" alt="{esc(p["name"])}" loading="lazy" />'
    else:
        front = esc(p["name"])
    back = ""
    if tier == "wirkungspartner":
        back += '<span class="partner-tag">Wirkungspartner</span>'
    if p.get("claim"):
        back += f'<p>„{esc(p["claim"])}“</p>'
    if p.get("beschreibung"):
        back += f'<span class="partner-desc">{esc(p["beschreibung"])}</span>'
    inner = ('<div class="partner-tile-inner">'
             f'<div class="partner-tile-front">{front}</div>'
             f'<div class="partner-tile-back">{back}</div>'
             "</div>")
    cls = f"partner-tile partner-tile-{tier}"
    if p.get("website"):
        return (f'<a class="{cls}" data-tier="{esc(tier)}" href="{esc(p["website"])}" '
                f'target="_blank" rel="noopener">{inner}</a>')
    return f'<div class="{cls}" data-tier="{esc(tier)}">{inner}</div>'


def auswahl(partner, filt, sortieren):
    if filt == "@hauptpartner":
        treffer = [p for p in partner if p.get("logo") and p.get("hauptpartner")]
    else:
        treffer = [p for p in partner if p.get("tier") == filt]
    if sortieren:
        treffer.sort(key=lambda p: p["name"].lower())
    return treffer


def ersetze(text, container_id, inhalt):
    """Füllt genau den einen Container.

    Zwei Fälle, bewusst getrennt: Beim ersten Lauf ist der Container leer, dann
    wird zwischen die beiden Tags geschrieben. Danach stehen die Marker drin und
    nur noch der Bereich dazwischen wird getauscht. Über das schließende
    `</div>` zu matchen wäre hier falsch — die Kacheln enthalten selbst `</div>`,
    ein nicht-greedy Muster würde beim zweiten Lauf mitten in der eigenen
    Ausgabe abschneiden und die Seite zerlegen.
    """
    start, ende = f"<!--PARTNER:{container_id}-->", f"<!--/PARTNER:{container_id}-->"
    neu_block = f"{start}\n{inhalt}\n{ende}"

    if start in text and ende in text:
        a = text.index(start)
        b = text.index(ende) + len(ende)
        return text[:a] + neu_block + text[b:]

    leer = re.compile(
        r'(<div[^>]*\bid="' + re.escape(container_id) + r'"[^>]*>)\s*(</div>)')
    m = leer.search(text)
    if not m:
        raise SystemExit(f"Container id={container_id} ist weder leer noch mit Markern "
                         "versehen — Seite von Hand umgebaut?")
    return text[:m.start()] + m.group(1) + neu_block + m.group(2) + text[m.end():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    js = TILE_JS.read_text(encoding="utf-8")
    for anker in JS_ANKER:
        if anker not in js:
            raise SystemExit("js/partner-tile.js hat sich geändert — kachel() in diesem "
                             "Skript muss nachgezogen werden, bevor es wieder läuft.")

    partner = json.loads(DATEN.read_text(encoding="utf-8"))["partner"]
    nach_seite = {}
    for seite, cid, filt, sortieren in ZIELE:
        treffer = auswahl(partner, filt, sortieren)
        html = "\n".join("        " + kachel(p) for p in treffer)
        nach_seite.setdefault(seite, []).append((cid, html, len(treffer)))

    geschrieben = offen = 0
    for seite, aufgaben in nach_seite.items():
        pfad = REPO / seite
        alt = pfad.read_text(encoding="utf-8")
        neu = alt
        for cid, html, n in aufgaben:
            neu = ersetze(neu, cid, html)
        if neu == alt:
            print(f"  unverändert: {seite}")
            continue
        if args.check:
            print(f"  zu ändern: {seite}")
            offen += 1
            continue
        pfad.write_text(neu, encoding="utf-8")
        anzahl = ", ".join(f"{cid}={n}" for cid, _, n in aufgaben)
        print(f"  geschrieben: {seite} ({anzahl})")
        geschrieben += 1

    if args.check:
        return 1 if offen else 0
    print(f"  {geschrieben} Seite(n) geschrieben, {len(partner)} Partner in der Datenquelle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
