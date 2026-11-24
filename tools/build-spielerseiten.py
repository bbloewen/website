#!/usr/bin/env python3
"""Erzeugt je Profispieler eine eigene, indexierbare Seite — und den Kader-Block.

Ausgangslage (Search Console, 90 Tage bis 22.11.2026): Wir bekommen
Impressionen auf die Namen unserer Spieler — Ilias Amin 55, Leif Ibrahim 58,
Florian Gut 77, Samuel Nellessen 15, Lorenz Schiller 13, Bastian Rehbein 11,
Paul Bude 15, Lilly Feistkorn 7, Alexandra Offhaus 9 — und landen damit auf
saison/profis.html, einer Seite über die ganze Mannschaft. Deren Klickrate
liegt bei 5,1 % auf Position 2,9. Wer einen Namen sucht, will die Person, nicht
den Kader.

Seit dem 24.11.2026 bekommt deshalb jeder Spieler eine eigene Adresse:

    saison/profis/spieler/<slug>.html

Eine gepflegte Quelle: data/kader-profis.json. Dieses Skript baut daraus
beides — die Einzelseiten UND den Kader-Block auf saison/profis.html zwischen
<!--KADER:auto--> und <!--/KADER:auto-->. Damit können Karte und Einzelseite
nicht auseinanderlaufen. Die Trainer-Karten darunter bleiben von Hand gepflegt,
sie stehen außerhalb der Marker.

Das Alter steht in keiner der beiden Ausgaben als Zahl: js/player-age.js
rechnet es im Browser aus geburtsjahr und geburtsmonat, sonst wäre es nach dem
nächsten Geburtstag falsch.

'seite': false in den Daten nimmt einen Spieler aus den Einzelseiten heraus; er
bleibt als Karte im Kader. Gedacht für den Fall, dass jemand keine eigene Seite
haben soll.

Die Vorlage ist saison/profis.html selbst: Kopf, Navigation, Fußzeile und
Skripte kommen damit automatisch mit. Alle Pfade dort sind absolut — die neuen
Seiten liegen zwei Ebenen tiefer, deshalb wird das unten geprüft.

Aufruf:
  python3 tools/build-spielerseiten.py
  python3 tools/build-spielerseiten.py --check    # schreibt nichts
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "kader-profis.json"
VORLAGE = REPO / "saison" / "profis.html"
ZIELORDNER = REPO / "saison" / "profis" / "spieler"
START = "<!--KADER:auto-->"
END = "<!--/KADER:auto-->"


def esc(s):
    return html.escape(str(s), quote=True)


def vorname(name):
    """Nur der Vorname — so sprechen wir über die eigenen Spieler."""
    return name.split()[0]


def alter_span(s):
    return (f'<span class="panini-age" data-birth-year="{s["geburtsjahr"]}" '
            f'data-birth-month="{s["geburtsmonat"]}">–</span>')


def karte(s):
    """Eine Panini-Karte, Markup unverändert gegenüber der Handfassung vom
    24.11.2026 — ergänzt nur um den Link auf die Einzelseite."""
    rahmen = [
        f'<div class="panini-photo-frame panini-photo-frame-0">'
        f'<img src="{esc(s["foto"])}" width="{s["fotoBreite"]}" height="{s["fotoHoehe"]}" '
        f'alt="{esc(s["fotoAlt"])}" title="{esc(s["fotoTitel"])}" loading="lazy" /></div>'
    ]
    if s.get("aktionsfoto"):
        rahmen.append(
            f'<div class="panini-photo-frame panini-photo-frame-1">'
            f'<img src="{esc(s["aktionsfoto"])}" width="{s["aktionsfotoBreite"]}" '
            f'height="{s["aktionsfotoHoehe"]}" alt="{esc(s["aktionsfotoAlt"])}" '
            f'loading="lazy" /></div>')
    zeilen = "".join(f"<li>{z}</li>" for z in [f"Alter: {alter_span(s)}"] + s["steckbrief"])
    rahmen.append(f'<div class="panini-photo-frame panini-photo-frame-2">'
                  f'<ul class="panini-steckbrief">{zeilen}</ul></div>')
    mehr = ""
    if s.get("seite", True):
        mehr = (f'<a class="card-link" href="/saison/profis/spieler/{esc(s["slug"])}.html">'
                f'Mehr zu {esc(vorname(s["name"]))} '
                f'<i data-lucide="arrow-right" class="icon-14"></i></a>')
    return (
        f'<div class="panini-wrap" data-step="0"><div class="panini-card">'
        f'<div class="panini-card-photo"><span class="panini-card-number">{s["nr"]}</span>'
        f'{"".join(rahmen)}'
        f'<span class="panini-card-badge">{s["nr"]}</span></div>'
        f'<div class="panini-card-info"><div class="panini-card-name">{esc(s["name"])}</div>'
        f'<div class="panini-card-meta">{esc(s["position"])} · {esc(s["groesse"])}</div>'
        f'{mehr}</div></div></div>'
    )


def titel(s):
    """Der Name führt, dahinter die Einordnung — danach wird gesucht."""
    return f'{s["name"]} — Basketball Löwen Erfurt'


def beschreibung(s):
    teile = [t for t in s["steckbrief"] if not t.lower().startswith("vorheriger")]
    masse = " ".join(re.sub(r"<[^>]+>", "", t) for t in teile)
    return (f'{s["name"]}, Nummer {s["nr"]} der Basketball Löwen Erfurt: '
            f'{s["position"]}, {masse.strip()}. Kader, Werdegang und die nächsten '
            f'Heimspiele in der ProB.').replace("  ", " ")


def inhalt(s):
    fotos = (f'<img src="{esc(s["foto"])}" width="{s["fotoBreite"]}" height="{s["fotoHoehe"]}" '
             f'alt="{esc(s["name"])}" class="spieler-portraet" />')
    if s.get("aktionsfoto"):
        fotos += (f'<img src="{esc(s["aktionsfoto"])}" width="{s["aktionsfotoBreite"]}" '
                  f'height="{s["aktionsfotoHoehe"]}" alt="{esc(s["aktionsfotoAlt"])}" '
                  f'loading="lazy" class="spieler-aktion" />')
    daten = "".join(f"<li>{z}</li>" for z in [
        f'Trikotnummer: {s["nr"]}',
        f'Position: {esc(s["position"])}',
        f'Alter: {alter_span(s)}',
    ] + s["steckbrief"])
    return f'''<div class="container container-narrow">
        <span class="eyebrow">Kader</span>
        <h1 class="t-h1">{esc(s["name"])}</h1>
        <p class="t-body" style="color:var(--text-secondary)">{esc(s["position"])} · {esc(s["groesse"])} · Nummer {s["nr"]} der Basketball Löwen Erfurt in der BARMER 2. Basketball Bundesliga ProB.</p>
        <div class="spieler-fotos">{fotos}</div>
        <ul class="panini-steckbrief spieler-daten">{daten}</ul>
        <p class="t-body"><a href="/saison/profis.html">Zurück zum Kader</a> · <a href="/saison/spielplan.html">Spielplan und Heimspiele</a> · <a href="/saison/profis/gameday/">Game Day</a></p>
      </div>'''


def seite(s, vorlage):
    t = vorlage
    t = re.sub(r"<title>.*?</title>", f"<title>{esc(titel(s))}</title>", t, count=1, flags=re.S)
    t = re.sub(r'(<meta name="description" content=")(.*?)(")',
               lambda m: m.group(1) + esc(beschreibung(s)) + m.group(3), t, count=1, flags=re.S)
    # Der SEO:auto-Block der Vorlage gehoert zur Kaderseite; build-head-meta.py
    # schreibt ihn fuer die neue Seite neu. Hier faellt er weg, damit nicht die
    # Canonicals der Profiseite auf der Spielerseite stehen bleiben.
    t = re.sub(r"<!-- SEO:auto START.*?<!-- SEO:auto END -->\n", "", t, flags=re.S)
    neu, n = re.subn(r"<main id=\"main\">.*?</main>",
                     lambda m: f'<main id="main">\n  <section class="section">\n      {inhalt(s)}\n  </section>\n  </main>',
                     t, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("saison/profis.html: <main> nicht gefunden — Vorlage umgebaut?")
    return neu


def kaderblock(spieler):
    return START + "\n        " + "\n".join(karte(s) for s in spieler) + "\n      " + END


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    vorlage = VORLAGE.read_text(encoding="utf-8")
    if re.search(r'(?:href|src)="(?:\.\./|\./)', vorlage):
        raise SystemExit("saison/profis.html enthält relative Pfade — die Spielerseiten "
                         "liegen zwei Ebenen tiefer und brauchen absolute.")

    spieler = json.loads(DATEN.read_text(encoding="utf-8"))["spieler"]
    if not spieler:
        raise SystemExit("data/kader-profis.json: kein Kader gefunden")

    # 1. Kader-Block auf der Profiseite
    if START not in vorlage or END not in vorlage:
        raise SystemExit(f"saison/profis.html: {START} … {END} fehlen — Marker einsetzen.")
    neu_block = kaderblock(spieler)
    profis_neu = re.sub(re.escape(START) + r".*?" + re.escape(END),
                        lambda m: neu_block, vorlage, count=1, flags=re.S)
    block_geaendert = profis_neu != vorlage
    if block_geaendert and not args.check:
        VORLAGE.write_text(profis_neu, encoding="utf-8")
        vorlage = profis_neu

    # 2. Einzelseiten
    ZIELORDNER.mkdir(parents=True, exist_ok=True)
    geschrieben = unveraendert = uebersprungen = geloescht = 0
    for s in spieler:
        if not s.get("seite", True):
            uebersprungen += 1
            # Die Datei muss weg, nicht nur ungebaut bleiben: Wer den Schalter
            # umlegt, will die Seite aus dem Netz haben, nicht nur aus dem Lauf.
            weg = ZIELORDNER / f'{s["slug"]}.html'
            if weg.is_file():
                geloescht += 1
                if not args.check:
                    weg.unlink()
            continue
        ziel = ZIELORDNER / f'{s["slug"]}.html'
        neu = seite(s, vorlage)
        alt = ziel.read_text(encoding="utf-8") if ziel.exists() else None
        if alt == neu:
            unveraendert += 1
            continue
        geschrieben += 1
        if not args.check:
            ziel.write_text(neu, encoding="utf-8")

    stand = "zu schreiben" if args.check else "geschrieben"
    print(f"  Kader-Block {'zu ändern' if block_geaendert else 'unverändert'}; "
          f"{geschrieben} Spielerseite(n) {stand}, {unveraendert} unverändert, "
          f"{uebersprungen} ohne eigene Seite ({geloescht} davon zu entfernen)")
    return 1 if (args.check and (geschrieben or block_geaendert or geloescht)) else 0


if __name__ == "__main__":
    sys.exit(main())
