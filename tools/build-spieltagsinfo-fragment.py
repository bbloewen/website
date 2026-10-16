#!/usr/bin/env python3
"""Leitet aus jeder fertigen Spieltagsinfo-Ausgabe ein einbettbares Fragment ab.

Hintergrund (Marko, 15.10.2026): Das Heft soll direkt auf der Spieltagsseite
stehen und nicht nur verlinkt sein -- eine Seite statt zweier, und die 85 %
der Leute, die den Link nicht anklicken, sehen es trotzdem. Seit ein Heft nur
noch fuer ein Spiel gilt, gibt es dabei auch keinen doppelten Text mehr.

Das Problem dabei ist das CSS aus Andre Grenzdoerffers Satz: Es bringt 324
Selektoren mit, darunter 17 auf Elementebene (`html`, `body`, `h2`, `p`, `a`,
`table`, `main`, `footer` ...) und einen `:root`-Block mit eigenen Variablen.
Unveraendert eingebettet wuerde es die Spieltagsseite ueberschreiben. Dieses
Skript sperrt deshalb das komplette Heft-CSS in den Container `.sti` ein:

  html, body  ->  .sti                 (der Container ist die neue Seite)
  :root       ->  .sti                 (Variablen gelten nur noch im Heft)
  h2          ->  .sti h2
  .card       ->  .sti .card           (loest zugleich die vier Namens-
                                        kollisionen btn/card/eyebrow/kw)
  @font-face  ->  unveraendert         (gehoert nicht in einen Container)
  @media      ->  Inhalt gleich behandelt

Eingang:  saison/profis/gameday/spieltagsinfo/ausgabe-N/index.html
Ausgang:  data/spieltagsinfo/ausgabe-N.html  (CSS + Inhalt, ohne Kopf/Leiste/Fuss)

Das Fragment liest tools/build-spieltagsseiten.py und baut es in die
Spieltagsseite des zugehoerigen Heimspiels ein.

Aufruf:
  python3 tools/build-spieltagsinfo-fragment.py
  python3 tools/build-spieltagsinfo-fragment.py --check
"""

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
AUSGABEN = REPO / "saison" / "profis" / "gameday" / "spieltagsinfo"
ZIEL_DIR = REPO / "data" / "spieltagsinfo"
CONTAINER = "sti"

# Diese Bloecke bleiben unangetastet: @font-face gehoert global, @keyframes auch.
UNVERAENDERT = ("@font-face", "@keyframes", "@-webkit-keyframes", "@import", "@charset", "@page")


def selektor_einsperren(sel: str) -> str:
    """Einen einzelnen Selektor unter den Container haengen."""
    sel = sel.strip()
    if not sel:
        return sel
    # Der Container ersetzt das Seitengeruest, statt darin zu stecken.
    if sel in ("html", "body", ":root", "html body"):
        return f".{CONTAINER}"
    if sel.startswith(("html ", "body ")):
        return f".{CONTAINER} {sel.split(' ', 1)[1]}"
    # ":root" mitten im Selektor (selten, aber moeglich)
    sel = sel.replace(":root", f".{CONTAINER}")
    return f".{CONTAINER} {sel}"


def regel_einsperren(selektoren: str) -> str:
    return ", ".join(selektor_einsperren(s) for s in selektoren.split(","))


def css_einsperren(css: str) -> str:
    """Alle Regeln des Heft-CSS unter .sti haengen, At-Regeln beruecksichtigt."""
    out = []
    i = 0
    while i < len(css):
        # At-Regel mit eigenem Block (@media, @supports, @font-face ...)
        m = re.match(r"\s*(@[a-zA-Z-]+[^{;]*)([{;])", css[i:])
        if m:
            kopf, zeichen = m.group(1), m.group(2)
            start = i + m.end()
            if zeichen == ";":                      # @import o. ae., kein Block
                out.append(css[i:start])
                i = start
                continue
            tiefe, j = 1, start
            while j < len(css) and tiefe:
                if css[j] == "{":
                    tiefe += 1
                elif css[j] == "}":
                    tiefe -= 1
                j += 1
            inhalt = css[start:j - 1]
            if kopf.strip().startswith(UNVERAENDERT):
                out.append(css[i:j])                # unveraendert uebernehmen
            else:
                out.append(kopf + "{" + css_einsperren(inhalt) + "}")
            i = j
            continue
        # Normale Regel
        m = re.match(r"([^{}@]+)\{([^{}]*)\}", css[i:])
        if m:
            out.append(regel_einsperren(m.group(1)) + "{" + m.group(2) + "}")
            i += m.end()
            continue
        out.append(css[i])
        i += 1
    return "".join(out)


def fragment_bauen(seite: Path) -> str:
    html = seite.read_text(encoding="utf-8")
    m_css = re.search(r"<style>(.*?)</style>", html, re.S)
    m_body = re.search(r"<body>(.*)</body>", html, re.S)
    if not (m_css and m_body):
        raise SystemExit(f"{seite.relative_to(REPO)}: <style> oder <body> fehlt")

    inhalt = m_body.group(1)
    # Leiste und Fuss der eigenstaendigen Seite gehoeren nicht ins Fragment --
    # die Spieltagsseite hat Navigation und Footer selbst.
    inhalt = re.sub(r'<div class="sitebar noprint">.*?</div>\s*', "", inhalt, flags=re.S)
    inhalt = re.sub(r'<footer class="pagefoot noprint">.*?</footer>\s*', "", inhalt, flags=re.S)

    # Die Seite hat ihre eigene H1 (der Gegner im Hero). Die Heft-Ueberschrift wird
    # deshalb zur H2 -- zwei H1 auf einer Seite sind ein Strukturfehler, und das Heft
    # ist hier ein Abschnitt, nicht das Dokument.
    inhalt = re.sub(r'<h1(\s[^>]*)?>', lambda m: '<h2' + (m.group(1) or '') + ' class="sti-h1">', inhalt)
    inhalt = inhalt.replace("</h1>", "</h2>")

    css = css_einsperren(m_css.group(1))
    # Alle Regeln, die auf h1 zielen, muessen die umbenannte Ueberschrift treffen --
    # im Heft ist das ".cover h1" (clamp(40px,12vw,64px)). Ohne diese Zeile schrumpft
    # die Titelzeile auf h2-Groesse.
    css = re.sub(r'(?<![a-zA-Z0-9_-])h1(?![a-zA-Z0-9_-])', '.sti-h1', css)
    return (f"<style>{css}</style>\n"
            f'<div class="{CONTAINER}">\n{inhalt.strip()}\n</div>\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    seiten = sorted(AUSGABEN.glob("ausgabe-*/index.html"))
    if not seiten:
        print("  keine Ausgaben gefunden")
        return 0

    geschrieben = unveraendert = 0
    for seite in seiten:
        nr = seite.parent.name.replace("ausgabe-", "")
        frag = fragment_bauen(seite)
        ziel = ZIEL_DIR / f"ausgabe-{nr}.html"
        alt = ziel.read_text(encoding="utf-8") if ziel.exists() else None
        if alt == frag:
            unveraendert += 1
            continue
        if args.check:
            print(f"  wuerde schreiben: {ziel.relative_to(REPO)} ({len(frag) // 1024} KB)")
            geschrieben += 1
            continue
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(frag, encoding="utf-8")
        print(f"  {ziel.relative_to(REPO)}  {len(frag) // 1024} KB")
        geschrieben += 1

    print(f"  {geschrieben} Fragment(e) geschrieben, {unveraendert} unverändert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
