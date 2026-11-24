#!/usr/bin/env python3
"""Erzeugt Weiterleitungsseiten für alte Adressen.

Warum: Die Search Console meldete am 24.11.2026 109 Adressen als "Nicht
gefunden (404)". Darunter war viel Erbe aus dem WordPress vor dem Relaunch
(/sponsoren/, /verein/, /tickets/, /trainingszeiten/, /nachwuchs/ …), unsere
eigene frühere Ordnerstruktur (/saison/profis/, /saison/tabelle/ …) und zehn
News-Artikel, deren Infix von _verein_ auf _club_, _profis_ oder _partner_
gewechselt ist. Jede dieser Adressen hatte einmal Verweise von außen und eine
Position bei Google — mit einem 404 ist beides verloren.

GitHub Pages kann keinen 301 schicken. Deshalb legt dieses Skript je Eintrag
eine kleine Seite an mit:

  * <link rel="canonical"> auf das Ziel — das ist das Signal, das Google
    auswertet; es behandelt eine solche Seite wie eine dauerhafte Weiterleitung
    und überträgt die Stärke der alten Adresse.
  * <meta http-equiv="refresh" content="0; url=…"> — leitet Besucher sofort
    weiter, auch ohne JavaScript.
  * einen sichtbaren Link, falls beides nicht greift. Niemand landet in einer
    Sackgasse.

Die Seiten stehen bewusst NICHT in der Sitemap (tools/build-sitemap.py liest
nur Seiten mit Inhalt) und bekommen keinen Header und keine Fußzeile: Sie sind
Wegweiser, keine Seiten. Aus demselben Grund tragen sie kein noindex — mit
noindex würde Google dem canonical nicht folgen und die alte Adresse fiele
ersatzlos aus dem Index.

Gepflegt wird data/weiterleitungen.json. Eine neue Zeile dort, einmal laufen
lassen, fertig. Das Skript prüft bei jedem Lauf, dass jedes Ziel wirklich
existiert — eine Weiterleitung ins Leere wäre schlimmer als der 404.

Aufruf:
  python3 tools/build-weiterleitungen.py
  python3 tools/build-weiterleitungen.py --check    # schreibt nichts
"""

import argparse
import html
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATEN = REPO / "data" / "weiterleitungen.json"
BASE = "https://basketball-loewen.com"


def ziel_datei(nach):
    p = nach.lstrip("/")
    if p.endswith("/") or not p:
        p += "index.html"
    return REPO / p


def quell_datei(von):
    p = von.lstrip("/")
    if p.endswith("/") or not p:
        p += "index.html"
    return REPO / p


def seite(nach):
    url = BASE + nach
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="canonical" href="{html.escape(url, quote=True)}" />
<meta http-equiv="refresh" content="0; url={html.escape(nach, quote=True)}" />
<title>Diese Seite ist umgezogen</title>
<style>body{{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:4rem auto;max-width:34rem;padding:0 1.5rem;line-height:1.6;color:#00122D}}a{{color:#B55709}}</style>
</head>
<body>
<h1>Diese Seite ist umgezogen</h1>
<p>Du wirst gleich weitergeleitet. Falls nicht: <a href="{html.escape(nach, quote=True)}">hier geht es weiter</a>.</p>
<script>location.replace({json.dumps(nach)});</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    daten = json.loads(DATEN.read_text(encoding="utf-8"))["weiterleitungen"]
    if not daten:
        raise SystemExit("data/weiterleitungen.json: keine Einträge")

    # Ziele pruefen, bevor irgendetwas geschrieben wird.
    fehlend = [(v, n) for v, n in daten.items() if not ziel_datei(n).is_file()]
    if fehlend:
        for v, n in fehlend:
            print(f"  ZIEL FEHLT: {v} -> {n}", file=sys.stderr)
        raise SystemExit("Weiterleitung ins Leere — abgebrochen, nichts geschrieben.")

    # Eine Weiterleitung darf keine echte Seite ueberschreiben.
    echte = [v for v in daten if quell_datei(v).is_file()
             and "umgezogen" not in quell_datei(v).read_text(encoding="utf-8", errors="ignore")[:900]]
    if echte:
        for v in echte:
            print(f"  ACHTUNG: {v} ist eine echte Seite — nicht überschrieben", file=sys.stderr)

    neu = aktuell = 0
    for von, nach in daten.items():
        if von in echte:
            continue
        ziel = quell_datei(von)
        inhalt = seite(nach)
        if ziel.is_file() and ziel.read_text(encoding="utf-8") == inhalt:
            aktuell += 1
            continue
        neu += 1
        if not args.check:
            ziel.parent.mkdir(parents=True, exist_ok=True)
            ziel.write_text(inhalt, encoding="utf-8")

    stand = "zu schreiben" if args.check else "geschrieben"
    print(f"  {neu} Weiterleitung(en) {stand}, {aktuell} aktuell, "
          f"{len(echte)} übersprungen (echte Seite)")
    return 1 if (args.check and neu) else 0


if __name__ == "__main__":
    sys.exit(main())
