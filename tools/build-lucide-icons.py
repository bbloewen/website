#!/usr/bin/env python3
"""Baut ein eigenes, kleines Icon-Bündel statt der ganzen Lucide-Bibliothek.

Warum:

Auf jeder der 100 Seiten stand
`<script src="/js/vendor/lucide-icons.js?v=1787766492"></script>`. Drei Probleme in einer
Zeile:

  1. **419 KB** für rund 30 sichtbare Icons pro Seite — die komplette Bibliothek
     mit über 1.500 Symbolen, synchron geladen, auf jeder Seite.
  2. **`@latest`.** Eine Änderung bei Lucide nimmt schlagartig jedes Icon der
     Website mit, ohne dass wir etwas angefasst hätten. Kein Versionsstand, auf
     den man zurückgehen könnte.
  3. **Fremdhost im kritischen Pfad.** Jeder Besucher baut eine Verbindung zu
     unpkg auf und schickt dabei seine IP-Adresse dorthin.

Dieses Skript sammelt die tatsächlich benutzten `data-lucide`-Namen aus allen
Dateien im Repo, holt genau diese Symbole einmalig von `lucide-static` und
schreibt sie mit einem kleinen Ersatz für `lucide.createIcons()` nach
`js/vendor/lucide-icons.js`. Damit bleibt kein Fremdhost und keine offene
Versionsangabe.

Der Ersatz verhält sich wie das Original, gegen die echte Ausgabe abgeglichen:
Platzhalter werden durch ein `<svg>` ersetzt, die Attribute des Platzhalters
wandern mit, `class` wird um `lucide lucide-<name>` ergänzt, `aria-hidden="true"`
kommt dazu, und `data-lucide` bleibt auch am fertigen `<svg>` stehen. Deshalb
greift der Selektor nur auf Nicht-SVG-Elemente zu — sonst würde ein zweiter
Aufruf von `createIcons()` die Symbole ineinander verschachteln.

Fehlt ein Symbol im Bündel (neuer Name im HTML, Skript noch nicht gelaufen),
bleibt der Platzhalter stehen und das Skript meldet es beim nächsten Lauf.

Aufruf:
  python3 tools/build-lucide-icons.py
  python3 tools/build-lucide-icons.py --check    # schreibt nichts
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "js" / "vendor" / "lucide-icons.js"
VERSION = "1.34.0"
QUELLE = f"https://unpkg.com/lucide-static@{VERSION}/icons/%s.svg"

# Wo nach data-lucide gesucht wird: alles, was Markup erzeugt oder enthält.
ENDUNGEN = (".html", ".js", ".py", ".json")
NAME = re.compile(r"""data-lucide=\\?["']([a-z0-9-]+)""")


def benutzte_namen():
    dateien = subprocess.run(["git", "ls-files"], cwd=REPO,
                             capture_output=True, text=True).stdout.split()
    namen = set()
    for rel in dateien:
        if not rel.endswith(ENDUNGEN):
            continue
        # Das erzeugte Bündel selbst zählt nicht mit, sonst frisst es sich selbst.
        if rel == "js/vendor/lucide-icons.js":
            continue
        text = (REPO / rel).read_text(encoding="utf-8", errors="ignore")
        namen |= set(NAME.findall(text))
    return sorted(namen)


def hole(name):
    # Über curl statt urllib: Pythons SSL-Zertifikatsspeicher ist auf diesem Rechner
    # nicht eingerichtet (CERTIFICATE_VERIFY_FAILED), curl bringt seinen eigenen mit.
    lauf = subprocess.run(["curl", "-sfL", "--max-time", "30", QUELLE % name],
                          capture_output=True, text=True)
    if lauf.returncode != 0:
        raise SystemExit(f"Icon {name}: Abruf fehlgeschlagen ({QUELLE % name})")
    svg = lauf.stdout
    # Nur den Inhalt zwischen den svg-Tags, in einer Zeile.
    m = re.search(r"<svg\b[^>]*>(.*?)</svg>", svg, re.S)
    if not m:
        raise SystemExit(f"Icon {name}: unerwartetes Format von lucide-static")
    inhalt = re.sub(r"\s+", " ", m.group(1)).strip()
    inhalt = re.sub(r"\s*/>", "/>", inhalt)
    return inhalt


SHIM = """/* Erzeugt von tools/build-lucide-icons.py — nicht von Hand ändern.
   Enthält nur die %(anzahl)d Symbole, die im Repo wirklich vorkommen, aus
   lucide-static %(version)s. Ersetzt die %(alt)d KB grosse Gesamtbibliothek von
   unpkg; Begründung im Kopf des Skripts. */
(function () {
  var ICONS = %(icons)s;

  var ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24"'
    + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
    + ' stroke-linecap="round" stroke-linejoin="round"';

  function createIcons() {
    /* :not(svg) ist entscheidend: das fertige <svg> behaelt data-lucide (so
       verhaelt sich auch das Original), ein zweiter Aufruf wuerde die Symbole
       sonst ineinander verschachteln. */
    var platzhalter = document.querySelectorAll('[data-lucide]:not(svg)');
    for (var i = 0; i < platzhalter.length; i++) {
      var el = platzhalter[i];
      var name = el.getAttribute('data-lucide');
      var inhalt = ICONS[name];
      if (!inhalt) continue;   // unbekannter Name: Platzhalter stehen lassen
      var huelle = document.createElement('div');
      huelle.innerHTML = '<svg ' + ATTRS + '>' + inhalt + '</svg>';
      var svg = huelle.firstChild;
      for (var a = 0; a < el.attributes.length; a++) {
        var attr = el.attributes[a];
        if (attr.name === 'class') continue;
        svg.setAttribute(attr.name, attr.value);
      }
      svg.setAttribute('class',
        ('lucide lucide-' + name + ' ' + (el.getAttribute('class') || '')).trim());
      svg.setAttribute('aria-hidden', 'true');
      el.parentNode.replaceChild(svg, el);
    }
  }

  window.lucide = { createIcons: createIcons, icons: ICONS };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createIcons);
  } else {
    createIcons();
  }
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    namen = benutzte_namen()
    if not namen:
        raise SystemExit("kein data-lucide im Repo gefunden — Selektor kaputt?")

    vorhanden = {}
    if ZIEL.exists():
        m = re.search(r"var ICONS = (\{.*?\});", ZIEL.read_text(encoding="utf-8"), re.S)
        if m:
            try:
                vorhanden = json.loads(m.group(1))
            except ValueError:
                vorhanden = {}

    fehlt = [n for n in namen if n not in vorhanden]
    ueberzaehlig = [n for n in vorhanden if n not in namen]
    if not fehlt and not ueberzaehlig:
        print(f"  unverändert ({len(namen)} Symbole)")
        return 0
    if args.check:
        print(f"  zu ändern: +{len(fehlt)} / -{len(ueberzaehlig)} Symbole")
        return 1

    icons = {n: (vorhanden.get(n) or hole(n)) for n in namen}
    inhalt = SHIM % {
        "anzahl": len(icons),
        "version": VERSION,
        "alt": 410,
        "icons": json.dumps(icons, ensure_ascii=False, indent=2, sort_keys=True),
    }
    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    ZIEL.write_text(inhalt, encoding="utf-8")
    print(f"  geschrieben: {len(icons)} Symbole, {len(inhalt) // 1024} KB "
          f"(+{len(fehlt)} neu, -{len(ueberzaehlig)} entfallen)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
