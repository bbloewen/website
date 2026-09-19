#!/usr/bin/env python3
"""Prüft die Verlinkung der Website — intern, extern und auf Konsistenz.

Warum es dieses Skript gibt:

Beim Anlegen einer Seite wird der Link auf einen genannten Verein, Partner oder
eine Organisation regelmäßig vergessen (Markos Ansage, 19.09.2026). Das fällt
niemandem auf, weil nichts kaputtgeht — die Seite sieht richtig aus, es fehlt
nur der Weg nach draußen. Dieses Skript macht solche Lücken sichtbar und prüft
bei der Gelegenheit gleich mit, ob die vorhandenen Links überhaupt noch
funktionieren.

Drei Prüfungen:

  1. INTERN     tote interne Links und verwaiste indexierbare Seiten
                (keine andere Seite verlinkt sie).
  2. KONSISTENZ Namen, die woanders verlinkt sind, hier aber nur als Text
                stehen. Die Namensliste entsteht aus data/sponsoren.json und aus
                allen Ankertexten, die im Repo schon auf eine fremde Adresse
                zeigen — das Skript braucht also keine gepflegte Liste und
                lernt neue Organisationen von selbst dazu.
  3. EXTERN     HTTP-Status aller externen Adressen. Langsam (Netz), deshalb nur
                mit --extern.

Bewusst nicht gemeldet:

  * news/insta-archiv/ — diese Seiten schreibt der n8n-Workflow aus seiner
    eigenen Vorlage, Änderungen im Repo wären beim nächsten Beitrag wieder weg.
  * Nennungen innerhalb eines Ankertexts — die sind ja verlinkt.
  * Namen mit eigener Unterseite (INTERNE_SEITE): ein interner Link dorthin
    zählt genauso wie der externe. "SPORT VERNETZT" steht so in jeder
    Navigation und wäre sonst ein Dauerfehlalarm auf jeder Seite.

Aufruf:
  python3 tools/check-links.py
  python3 tools/check-links.py --extern     # zusätzlich alle externen Adressen abrufen

Rückgabewert 1, sobald etwas gefunden wurde.
"""

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

from seo_common import REPO, is_indexable, read, tracked_html

# Namen mit eigener Unterseite: ein interner Link dorthin genügt.
INTERNE_SEITE = {
    "SPORT VERNETZT": "/trainieren/sportvernetzt.html",
    "BasKIDball": "/trainieren/baskidball.html",
}

# Ankertexte, die keine Organisationsnamen sind.
KEIN_NAME = ("mehr", "hier", "zur", "zum", "alle", "folge", "beschädigung", "aufbau",
             "abbau", "die beste", "weitere", "jetzt", "ansehen", "melden", "kontakt",
             "website", "mail", "anrufen", "route")

# Plattformen: dort steht der Name im Profilnamen, nicht als Organisationsnennung.
KEINE_ORG_HOSTS = ("google.com", "instagram.com", "facebook.com", "youtube.com",
                   "wa.me", "x.com", "linkedin.com", "maps.")

A_TAG = re.compile(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S)
HREF = re.compile(r'href="([^"]+)"')


def host_von(url):
    return urlparse(url).netloc.lower().removeprefix("www.")


def ist_organisationsname(name, url):
    if not name or not (4 <= len(name) <= 38):
        return False
    if name[0].islower() or name[0] in "@#":
        return False
    if name.rstrip().endswith((".", "!", "?", ":")):
        return False
    if re.search(r"\d{5}|Straße|Str\.|Weg\b|Platz,|,\s*Erfurt", name):
        return False
    if name.lower().startswith(KEIN_NAME):
        return False
    return not any(x in host_von(url) for x in KEINE_ORG_HOSTS)


def namensliste(texte):
    """Name -> externe Adresse, aus den Partnerdaten und allen gesetzten Links."""
    paare = {}
    daten = json.loads((REPO / "data" / "sponsoren.json").read_text(encoding="utf-8"))

    def flach(x):
        if isinstance(x, dict):
            if x.get("name") and (x.get("website") or x.get("url")):
                yield x
            for v in x.values():
                yield from flach(v)
        elif isinstance(x, list):
            for v in x:
                yield from flach(v)

    for e in flach(daten):
        url = e.get("website") or e.get("url")
        if ist_organisationsname(e["name"], url):
            paare[e["name"]] = url

    for text in texte.values():
        for url, anker in A_TAG.findall(text):
            if not url.startswith("http"):
                continue
            name = re.sub(r"<[^>]+>", "", anker).strip()
            if ist_organisationsname(name, url):
                paare.setdefault(name, url)
    return paare


def text_ohne_anker(text):
    """Sichtbarer Text ohne Ankertexte — eine Nennung im Linktext ist verlinkt."""
    for muster in (r"<script.*?</script>", r"<style.*?</style>", r"<!--.*?-->",
                   r"<a\b[^>]*>.*?</a>"):
        text = re.sub(muster, " ", text, flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text))


def ziel_datei(url, quelle):
    pfad = url.split("#")[0].split("?")[0]
    if not pfad:
        return None
    if pfad.startswith("/"):
        pfad = pfad.lstrip("/")
    else:
        pfad = str((Path(quelle).parent / pfad).resolve().relative_to(REPO)) \
            if (REPO / Path(quelle).parent / pfad).resolve().is_relative_to(REPO) else pfad
    if pfad.endswith("/") or not pfad:
        pfad += "index.html"
    return pfad


def pruefe_intern(texte, partials):
    tot, eingehend = [], defaultdict(set)
    for quelle, text in {**texte, **partials}.items():
        for href in HREF.findall(text):
            if href.startswith(("mailto:", "tel:", "javascript:", "#", "data:", "webcal:", "http")):
                continue
            # In JS-Vorlagen zusammengesetzte Adressen (' + a.url + ') sind keine
            # Links im HTML-Sinn -- sie entstehen erst zur Laufzeit.
            if any(z in href for z in ("' +", '" +', "${", "{{")):
                continue
            ziel = ziel_datei(href, quelle)
            if ziel is None:
                continue
            if (REPO / ziel).exists():
                eingehend[ziel].add(quelle)
            else:
                tot.append((quelle, href))
    waisen = [p for p in texte
              if p != "index.html" and is_indexable(p, texte[p])
              and not {q for q in eingehend.get(p, set()) if q != p}]
    return tot, waisen


def pruefe_konsistenz(texte):
    paare = namensliste(texte)
    funde = defaultdict(list)
    for name, url in paare.items():
        ziel = host_von(url)
        intern = INTERNE_SEITE.get(name)
        muster = re.compile(r"\b" + re.escape(name) + r"\b")
        for rel, text in texte.items():
            if rel.startswith("news/insta-archiv/"):
                continue
            if not muster.search(text_ohne_anker(text)):
                continue
            hrefs = HREF.findall(text)
            if ziel in {host_von(u) for u in hrefs if u.startswith("http")}:
                continue
            if intern and any(h.startswith(intern) for h in hrefs):
                continue
            funde[name].append(rel)
    return paare, funde


def pruefe_extern(texte):
    urls = set()
    for text in texte.values():
        for u in HREF.findall(text):
            if u.startswith("http") and "basketball-loewen.com" not in u:
                if not any(x in u for x in ("calendar.google.com", "google.com/maps", "wa.me")):
                    urls.add(u.replace("&amp;", "&"))
    def status(u):
        # Umlaut-Domains vor dem Abruf nach Punycode wandeln. curl bricht sonst
        # mit "Connection reset by peer" ab, obwohl der Link im Browser
        # funktioniert -- Browser wandeln selbst um. Betraf
        # www.flächen-thüringen.de auf partner/sponsoring.html.
        abruf = u
        teile = urlparse(u)
        if any(ord(z) > 127 for z in teile.netloc):
            try:
                abruf = teile._replace(
                    netloc=teile.netloc.encode("idna").decode()).geturl()
            except UnicodeError:
                pass
        r = subprocess.run(["curl", "-sS", "-o", "/dev/null", "-m", "15", "-L",
                            "-A", "Mozilla/5.0", "-w", "%{http_code}", abruf],
                           capture_output=True, text=True)
        return (r.stdout.strip() or "000"), u

    # Parallel, sonst dauert der Durchlauf bei ueber hundert Adressen Minuten.
    # 403/429/999 sind Bot-Sperren, keine kaputten Links -- sie zaehlen als
    # erreichbar, sonst meldet das Skript jedes Mal dieselben Fehlalarme.
    with ThreadPoolExecutor(max_workers=12) as pool:
        ergebnisse = list(pool.map(status, sorted(urls)))
    kaputt = [(c, u) for c, u in ergebnisse if c not in ("200", "403", "429", "999")]
    return len(urls), sorted(kaputt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extern", action="store_true",
                    help="zusätzlich alle externen Adressen abrufen (langsam)")
    args = ap.parse_args()

    texte = {rel: read(rel) for rel in tracked_html()}
    partials = {p: (REPO / p).read_text(encoding="utf-8")
                for p in subprocess.run(["git", "ls-files", "partials/*.html"],
                                        capture_output=True, text=True,
                                        cwd=REPO).stdout.split()}
    gefunden = False

    tot, waisen = pruefe_intern(texte, partials)
    print(f"INTERN      {len(texte)} Seiten · {len(tot)} tote Links · {len(waisen)} verwaist")
    for quelle, href in tot:
        print(f"  tot       {quelle} → {href}")
    for p in waisen:
        print(f"  verwaist  {p}")
    gefunden |= bool(tot or waisen)

    paare, funde = pruefe_konsistenz(texte)
    stellen = sum(len(v) for v in funde.values())
    print(f"KONSISTENZ  {len(paare)} bekannte Namen · {len(funde)} davon irgendwo unverlinkt "
          f"· {stellen} Stellen")
    for name, seiten in sorted(funde.items(), key=lambda x: -len(x[1])):
        print(f"  {len(seiten):3d}× {name}  →  {paare[name]}")
        for p in seiten:
            print(f"        {p}")
    gefunden |= bool(funde)

    if args.extern:
        anzahl, kaputt = pruefe_extern(texte)
        print(f"EXTERN      {anzahl} Adressen geprüft · {len(kaputt)} nicht erreichbar")
        for code, u in kaputt:
            print(f"  {code}  {u}")
        gefunden |= bool(kaputt)
    else:
        print("EXTERN      übersprungen (mit --extern mitprüfen)")

    return 1 if gefunden else 0


if __name__ == "__main__":
    sys.exit(main())
