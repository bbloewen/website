#!/usr/bin/env python3
"""Bringt Insta-Archivseiten nach, die aus dem Behold-Feed gefallen sind.

Hintergrund: die Archivseiten unter news/insta-archiv/ erzeugt der n8n-Workflow
"Website: News - Social Instagram abrufen" (GpAS0ONrenHrcTwS). Er kennt aber nur
die letzten 20 auswertbaren Posts je Account. Aeltere Seiten bleiben fuer immer
auf dem Stand, den die Vorlage beim letzten Lauf hatte -- der Workflow fasst sie
nie wieder an.

Am 17.08.2026 wurde die Vorlage ueberarbeitet (Open Graph, GoatCounter,
alt-Text, Umlaut, Unicode-Fettschrift raus). Die 10 Seiten im Feed hat der
Workflow selbst neu geschrieben; die 8 aus dem Feed gefallenen Seiten haengen
zurueck. Genau die holt dieses Skript nach.

Weil diese Seiten nicht mehr im Feed sind, kann der Workflow das Ergebnis nicht
ueberschreiben -- der Fix ist dauerhaft. Seiten MIT og:title werden
uebersprungen, das Skript ist also beliebig oft wiederholbar und faehrt auch
kuenftigen Feed-Abgaengen hinterher.

Aufruf:
  python3 tools/fix-insta-archiv-legacy.py
  python3 tools/fix-insta-archiv-legacy.py --check
"""

import argparse
import html
import json
import re
import sys
import unicodedata

from seo_common import BASE, REPO, attr

ARCHIV = REPO / "news" / "insta-archiv"
SITE_NAME = "Basketball Löwen Erfurt"
DEFAULT_IMAGE = BASE + "assets/img/share/og-default.jpg"


def feed_ids():
    """Post-IDs, die aktuell im Behold-Feed stehen.

    Wichtig fuers Share-Bild: Beholds Bild-URLs sind signiert und verfallen,
    sobald ein Post aus dem Feed faellt. Am 17.08.2026 geprueft -- alle 8 Seiten
    ausserhalb des Feeds liefern HTTP 400, alle 10 im Feed liefern 200. Fuer die
    abgelaufenen Seiten muss og:image daher auf das eigene Standard-Share-Bild
    zeigen, sonst zeigt die Link-Vorschau gar kein Bild.
    """
    ids = set()
    for name in ("instagram-loewen.json", "instagram-loewenpark.json"):
        data = json.loads((REPO / "data" / name).read_text(encoding="utf-8"))
        for p in data.get("archivePosts", []):
            ids.add(p["id"])
    return ids


def post_id(file_name):
    return file_name.rsplit("-", 1)[-1].replace(".html", "")


GOATCOUNTER = (
    '<script data-goatcounter="https://goatcounter-production-5d8c.up.railway.app/count"\n'
    '        async src="//goatcounter-production-5d8c.up.railway.app/count.js"></script>'
)

# Mathematical Alphanumeric Symbols: 13 Bloecke à 52 Zeichen (A-Z, dann a-z).
# Dieselbe Zuordnung wie in der Workflow-Vorlage -- Instagram-Captions nutzen
# diese Zeichen als Fettschrift-Ersatz, Google liest sie nicht als Text.
LETTER_BLOCKS = [
    0x1D400, 0x1D434, 0x1D468, 0x1D49C, 0x1D4D0, 0x1D504, 0x1D538,
    0x1D56C, 0x1D5A0, 0x1D5D4, 0x1D608, 0x1D63C, 0x1D670,
]
DIGIT_BLOCKS = [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6]
LETTERLIKE = {
    0x212C: "B", 0x2130: "E", 0x2131: "F", 0x210B: "H", 0x2110: "I",
    0x2112: "L", 0x2133: "M", 0x211B: "R", 0x212F: "e", 0x210A: "g",
    0x2134: "o", 0x212D: "C", 0x210C: "H", 0x2111: "I", 0x211C: "R",
    0x2128: "Z", 0x2102: "C", 0x210D: "H", 0x2115: "N", 0x2119: "P",
    0x211A: "Q", 0x211D: "R", 0x2124: "Z",
}


def de_bold(s):
    out = []
    for ch in s:
        cp = ord(ch)
        if cp in LETTERLIKE:
            out.append(LETTERLIKE[cp])
            continue
        mapped = None
        for base in LETTER_BLOCKS:
            if base <= cp < base + 52:
                off = cp - base
                mapped = chr(65 + off) if off < 26 else chr(97 + off - 26)
                break
        if mapped is None:
            for db in DIGIT_BLOCKS:
                if db <= cp < db + 10:
                    mapped = chr(48 + cp - db)
                    break
        out.append(mapped if mapped is not None else ch)
    # NFC: aus "a" + kombinierendem Umlaut wird ein echtes "ä"
    return unicodedata.normalize("NFC", "".join(out))


def clean(raw_attr_value):
    """HTML-Attributwert -> entschaerfter, entfetteter Klartext."""
    return de_bold(html.unescape(raw_attr_value)).strip()


def truncate(s, max_len):
    if len(s) <= max_len:
        return s
    return s[: max_len - 3].rstrip() + "..."


MEDIA_RE = re.compile(
    r'\s*<div class="insta-detail-media"><img [^>]*/></div>\n?', re.S
)


def fix_post_image(text, file_name):
    """Beitragsbild auf die lokale Kopie umstellen, sonst Bildspalte entfernen.

    Seit 17.08.2026 sichert der Workflow jedes Beitragsbild als
    assets/img/insta/<name>.jpg. Fuer aeltere Posts gibt es keine Kopie und
    Beholds URL ist tot -- dann faellt die Bildspalte weg statt ein kaputtes Bild
    zu zeigen.

    Legt jemand spaeter ein passend benanntes JPG in den Ordner (z. B. manuell
    aus Instagram gesichert), stellt der naechste Lauf das Bild wieder her.
    """
    stem = file_name.replace(".html", "")
    local_rel = f"assets/img/insta/{stem}.jpg"
    exists = (REPO / local_rel).exists()
    m = MEDIA_RE.search(text)

    if exists:
        img = (f'        <div class="insta-detail-media"><img src="/{local_rel}" '
               f'alt="{attr(current_title(text))}" loading="lazy" /></div>\n')
        if m:
            text = text[: m.start()] + "\n" + img.rstrip("\n") + "\n" + text[m.end():]
        text = text.replace(" insta-detail-grid-textonly", "")
        return text

    if m:
        text = text[: m.start()] + "\n" + text[m.end():]
    if "insta-detail-grid-textonly" not in text:
        text = text.replace(
            '<div class="insta-detail-grid">',
            '<div class="insta-detail-grid insta-detail-grid-textonly">', 1
        )
    return text


def current_title(text):
    m = re.search(r"<h1>(.*?)</h1>", text, re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else ""


def fix_share_image(text, expired):
    """og:image/twitter:image auf das Standardbild setzen, wenn die Behold-URL tot ist.

    Laeuft unabhaengig davon, ob die Seite sonst schon aktuell ist -- auch die vom
    Workflow erzeugten Seiten laufen irgendwann aus dem Feed und brauchen das dann.
    """
    if not expired:
        return text
    for prop in ('property="og:image"', 'name="twitter:image"'):
        text = re.sub(
            r'(<meta ' + re.escape(prop) + r' content=")https://behold\.pictures/[^"]*(")',
            r"\1" + DEFAULT_IMAGE + r"\2",
            text,
        )
    return text


def fix(rel_name, text):
    """Gibt den korrigierten Seitentext zurueck, oder None wenn nichts zu tun ist."""
    if "og:title" in text:
        return None

    m_title = re.search(r"<title>(.*?)</title>", text, re.S)
    m_desc = re.search(r'<meta name="description" content="(.*?)" />', text, re.S)
    m_canon = re.search(r'<link rel="canonical" href="(.*?)" />', text)
    m_img = re.search(r'<img src="(.*?)" alt="[^"]*" />', text)
    if not (m_title and m_desc and m_canon and m_img):
        return f"UNVOLLSTAENDIG: {rel_name}"

    # Vereinsname-Suffix abtrennen, Rest entfetten
    raw_title = clean(m_title.group(1))
    raw_title = re.sub(r"\s*—\s*Basketball L(ö|oe)wen Erfurt\s*$", "", raw_title).strip()
    title = truncate(raw_title, 65)
    desc = truncate(clean(m_desc.group(1)), 155)
    canonical = m_canon.group(1)
    image = m_img.group(1)

    new = text
    # <title> und description mit entfettetem Text und Umlaut im Vereinsnamen
    new = new.replace(m_title.group(0), f"<title>{attr(title)} — {SITE_NAME}</title>")
    new = new.replace(
        m_desc.group(0), f'<meta name="description" content="{attr(desc)}" />'
    )

    # Share-Tags direkt hinter das Canonical, wie in der Workflow-Vorlage
    canon_tag = f'<link rel="canonical" href="{canonical}" />'
    share = "\n".join([
        canon_tag,
        '<meta property="og:type" content="article" />',
        f'<meta property="og:site_name" content="{SITE_NAME}" />',
        '<meta property="og:locale" content="de_DE" />',
        f'<meta property="og:title" content="{attr(title)}" />',
        f'<meta property="og:description" content="{attr(desc)}" />',
        f'<meta property="og:url" content="{canonical}" />',
        f'<meta property="og:image" content="{image}" />',
        f'<meta property="og:image:alt" content="{attr(title)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{attr(title)}" />',
        f'<meta name="twitter:description" content="{attr(desc)}" />',
        f'<meta name="twitter:image" content="{image}" />',
    ])
    new = new.replace(canon_tag, share, 1)

    # GoatCounter ergaenzen (fehlte auf allen Archivseiten)
    if "goatcounter" not in new:
        new = new.replace("</head>", GOATCOUNTER + "\n</head>", 1)

    # H1 entfetten -- die regenerierten Seiten haben ebenfalls Klartext im H1,
    # sonst stehen entfettete und gefettete Ueberschriften nebeneinander.
    # Der Beitragstext in den <p>-Absaetzen bleibt das Original-Zitat.
    m_h1 = re.search(r"<h1>(.*?)</h1>", new, re.S)
    if m_h1:
        new = new.replace(m_h1.group(0), f"<h1>{attr(title)}</h1>", 1)

    # alt-Text am Beitragsbild (war leer)
    new = new.replace(
        m_img.group(0), f'<img src="{image}" alt="{attr(title)}" />', 1
    )
    return new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    in_feed = feed_ids()
    changed, skipped, problems, image_fixed = [], [], [], []
    for path in sorted(ARCHIV.glob("*.html")):
        original = path.read_text(encoding="utf-8")
        result = fix(path.name, original)
        if isinstance(result, str) and result.startswith("UNVOLLSTAENDIG"):
            problems.append(result)
            continue
        text = original if result is None else result
        expired = post_id(path.name) not in in_feed
        text = fix_share_image(text, expired)
        text = fix_post_image(text, path.name)
        if result is not None:
            changed.append(path.name)
        elif text != original:
            image_fixed.append(path.name)
        else:
            skipped.append(path.name)
        if text != original and not args.check:
            path.write_text(text, encoding="utf-8")

    for p in problems:
        print(f"  ACHTUNG {p}", file=sys.stderr)
    for n in changed:
        print(f"  {'zu korrigieren' if args.check else 'korrigiert'}: {n}")
    for n in image_fixed:
        print(f"  {'Bildverweise zu korrigieren' if args.check else 'Bildverweise korrigiert'}: {n}")
    print(f"\n  {len(changed)} nachgezogen, {len(image_fixed)} nur Share-Bild, "
          f"{len(skipped)} schon aktuell (vom n8n-Workflow erzeugt)")
    return 1 if (args.check and (changed or image_fixed)) else 0


if __name__ == "__main__":
    sys.exit(main())
