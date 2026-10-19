#!/usr/bin/env python3
"""Holt die Folgen des Podcasts "Tip-Off" aus dem Podigee-Feed und schreibt data/podcast.json.

Quelle: https://tip-off.podigee.io/feed/mp3 -- der Feed, aus dem Spotify, Apple Podcasts und
Amazon ihre Folgen beziehen (Marko 19.10.2026: "aus Spotify"). Er ist oeffentlich und enthaelt je Folge
Titel, Datum, Dauer, Cover und die Shownotes. Ein Transkript liefert er nicht.

Die Cover laedt dieses Skript einmal herunter und legt sie als WebP unter assets/img/podcast/ ab. Die
Seite bindet also nie ein Bild von einem fremden Server ein (kein Datenabfluss beim Seitenaufruf).

Aufruf:
  python3 tools/podcast-sync.py            # schreibt data/podcast.json und neue Cover
  python3 tools/podcast-sync.py --check    # schreibt nichts, Exit 1 bei Abweichung
"""

import argparse
import html
import json
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FEED = "https://tip-off.podigee.io/feed/mp3"
ZIEL = REPO / "data" / "podcast.json"
BILDER = REPO / "assets" / "img" / "podcast"
SPOTIFY = "https://open.spotify.com/show/3PlQclLrCA1G5sBTSCMl16"
APPLE = "https://podcasts.apple.com/us/podcast/tip-off-der-podcast-der-basketball-l%C3%B6wen-erfurt/id6818511703"

NS = {
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "content": "http://purl.org/rss/1.0/modules/content/",
}

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()


def holen(url):
    req = urllib.request.Request(url, headers={"User-Agent": "basketball-loewen.com podcast-sync"})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as r:
        return r.read()


def klartext(fragment):
    """Shownotes (HTML oder Text) -> Zeilen ohne Tags, leere Zeilen bleiben als Absatztrenner."""
    t = html.unescape(fragment or "")
    t = re.sub(r"<!\[CDATA\[|\]\]>", "", t)
    t = re.sub(r"<br\s*/?>|</p>|</li>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    return [z.rstrip() for z in t.replace("\r", "").split("\n")]


def aufbereiten(notizen):
    """Kurztext = erster Absatz, Themen = die Aufzaehlung unter "EPISODE n:"."""
    zeilen = klartext(notizen)
    absatz, themen, im_themenblock = [], [], False
    for z in zeilen:
        s = z.strip()
        if re.match(r"^EPISODE\s*\d+\s*:?\s*$", s, re.I):
            im_themenblock = True
            continue
        if im_themenblock:
            if s.startswith("-"):
                themen.append(s.lstrip("-• ").strip())
                continue
            if not s:
                if themen:
                    im_themenblock = False
                continue
        if not im_themenblock and not themen:
            if s:
                absatz.append(s)
            elif absatz:
                # erster Absatz endet an der ersten Leerzeile; weitere Zeilen (z. B. "Dazu: ...") bleiben getrennt
                absatz.append("")
    teile = [p.strip() for p in "\n".join(absatz).split("\n\n")]
    teile = [p.replace("\n", " ").strip() for p in teile if p.strip()]
    # Zeilen bis zur Leerzeile gehoeren zusammen; "Dazu:" haengt im Feed ohne Leerzeile am ersten Absatz.
    return {"kurztext": " ".join(teile[:1]) if teile else "", "zusatz": " ".join(teile[1:2]) if len(teile) > 1 else "", "themen": themen}


def dauer_minuten(text):
    text = (text or "").strip()
    if ":" in text:
        teile = [int(x) for x in text.split(":")]
        sek = 0
        for t in teile:
            sek = sek * 60 + t
    else:
        sek = int(text or 0)
    return max(1, round(sek / 60))


def cover_ablegen(url, nr):
    """Cover als WebP (900 px) ablegen, falls noch nicht vorhanden. Gibt den Seitenpfad zurueck."""
    ziel = BILDER / f"folge-{nr}.webp"
    if not ziel.exists():
        from PIL import Image
        import io
        bild = Image.open(io.BytesIO(holen(url))).convert("RGB")
        bild.thumbnail((900, 900))
        BILDER.mkdir(parents=True, exist_ok=True)
        bild.save(ziel, "WEBP", quality=82, method=6)
    return f"/assets/img/podcast/folge-{nr}.webp"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    wurzel = ET.fromstring(holen(FEED))
    kanal = wurzel.find("channel")
    folgen = []
    for it in kanal.findall("item"):
        titel = (it.findtext("title") or "").strip()
        nr_text = it.findtext("itunes:episode", namespaces=NS)
        m = re.match(r"^#\s*(\d+)\s*:\s*(.*)$", titel)
        nr = int(nr_text) if nr_text and nr_text.strip().isdigit() else (int(m.group(1)) if m else None)
        if nr is None:
            continue
        kurz_titel = m.group(2).strip() if m else titel
        notizen = it.findtext("description") or it.findtext("itunes:summary", namespaces=NS) or ""
        auf = aufbereiten(notizen)
        bild_el = it.find("itunes:image", NS)
        bild_url = bild_el.get("href") if bild_el is not None else None
        bild = None
        if bild_url:
            if args.check:
                bild = f"/assets/img/podcast/folge-{nr}.webp"
            else:
                bild = cover_ablegen(bild_url, nr)
        folgen.append({
            "nr": nr,
            "titel": kurz_titel,
            "datum": parsedate_to_datetime(it.findtext("pubDate")).date().isoformat(),
            "minuten": dauer_minuten(it.findtext("itunes:duration", namespaces=NS)),
            "kurztext": auf["kurztext"],
            "zusatz": auf["zusatz"],
            "themen": auf["themen"],
            "podigee": (it.findtext("link") or "").strip(),
            "bild": bild,
        })
    folgen.sort(key=lambda f: f["nr"], reverse=True)

    daten = {
        "hinweis": "Automatisch erzeugt von tools/podcast-sync.py aus dem Podigee-Feed. Nicht von Hand aendern. "
                   "Der Artikel zu einer Folge steht in data/podcast-artikel.json.",
        "feed": FEED,
        "spotify": SPOTIFY,
        "apple": APPLE,
        "folgen": folgen,
    }
    neu = json.dumps(daten, ensure_ascii=False, indent=2) + "\n"
    alt = ZIEL.read_text(encoding="utf-8") if ZIEL.exists() else ""
    if neu == alt:
        print(f"podcast.json unveraendert ({len(folgen)} Folgen)")
        return 0
    if args.check:
        print("podcast.json weicht vom Feed ab")
        return 1
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"podcast.json geschrieben ({len(folgen)} Folgen)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
