#!/usr/bin/env python3
"""Macht aus André Grenzdörffers Handy-Version (eine einzige HTML-Datei mit
allem als base64 eingebettet) die Web-Fassung einer Spieltagsinfo-Ausgabe.

Eingang:  die HTML-Datei aus dem Satz (ca. 9 MB, Bilder/Schriften/Logos als data:-URI)
Ausgang:  saison/profis/gameday/spieltagsinfo/ausgabe-<N>/index.html
          assets/spieltagsinfo/ausgabe-<N>/*.webp|png|svg
          (das PDF legt man separat nach assets/spieltagsinfo/ablegen, siehe --pdf)

Was passiert:
  * Bilder raus aus dem HTML: JPEG -> WebP in Anzeigegroesse, Logos als SVG,
    GiroCodes als 2-Farben-PNG. Jedes <img> bekommt width/height (kein
    Layout-Sprung), lazy-loading und decoding=async; das Titelbild wird per
    <link rel=preload> vorgeladen.
  * Schriften: die fuenf eingebetteten Lexend-TTFs fliegen raus, es gelten die
    Dateien unter /css/fonts/ (gleiche Schnitte, im Browser-Cache der Seite).
  * Kopf: <title>, Description, robots, Favicon, GoatCounter, Preload; Canonical,
    Open Graph und JSON-LD setzt anschliessend build-head-meta.py.
  * Links: Verweise auf basketball-loewen.com werden seitenintern (ohne neues
    Fenster), Anzeigen-Links bekommen rel="sponsored noopener".
  * Umbenennung Spieltagsheft -> Spieltagsinfo (Ausgabe N, Saison).
  * QR-Codes werden ausgewertet: fuehrt einer auf eine URL, wird das Bild
    anklickbar; GiroCodes (SEPA-Zahlungscode) bleiben Bild und bekommen daneben
    den Knopf zur Spendenseite.

Sicherung: Enthaelt die Quelle noch Entwurfs-Spuren ("Entwurf", "nicht
hinterlegt", "Platz fuer ..."), bricht das Skript ab. Mit --erlaube-entwurf
schreibt es trotzdem, setzt dann aber robots=noindex, damit nichts versehentlich
in Google landet. Fuer den Veroeffentlichungslauf also ohne das Flag.

Aufruf:
  python3 tools/optimiere-spieltagsinfo.py QUELLE.html --ausgabe 1 \
      --titel-datum 11.10.2026 --gegner "Porsche BBA Ludwigsburg" [--pdf QUELLE.pdf]
"""

import argparse
import base64
import hashlib
import io
import re
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets" / "spieltagsinfo"
SEITEN = REPO / "saison" / "profis" / "gameday" / "spieltagsinfo"
BASE = "https://basketball-loewen.com"

DATA_RE = re.compile(r"data:([a-z0-9/+.\-]+);base64,([A-Za-z0-9+/=]+)")
ENTWURF_RE = re.compile(r"Entwurf|nicht hinterlegt|Platz für|bitte bestätigen", re.I)

# Schrift-Schnitte, die die Seite selbst ausliefert (css/fonts/lexend-v26-latin-*.ttf)
SCHRIFTEN = {300: "300", 400: "regular", 600: "600", 800: "800", 900: "900"}

# Maximale Breite je Verwendung (CSS-Pixel x 2 fuer Retina, begrenzt durch die Spaltenbreite 760)
MAX_BREITE = {"cover": 1200, "logo": 240, "foto": 1200, "anzeige": 1000,
              "edfoto": 300, "karte": 800}


def slug(text):
    text = text.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:48] or "bild"


def qr_text(img):
    """Inhalt eines QR-Codes im Bild (oder None). OpenCV ist optional."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    arr = np.array(img.convert("RGB"))
    for scale in (1, 2):
        a = arr if scale == 1 else cv2.resize(arr, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        ok, infos, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(a)
        if ok:
            texte = [t for t in infos if t]
            if texte:
                return texte[0]
    return None


class Bilder:
    """Legt extrahierte Dateien ab und merkt sich, was wohin ging (Hash -> URL)."""

    def __init__(self, zielordner, urlbasis):
        self.ziel = zielordner
        self.url = urlbasis
        self.bekannt = {}
        self.zaehler = 0
        self.log = []
        self.qr = {}          # URL -> dekodierter QR-Text
        zielordner.mkdir(parents=True, exist_ok=True)

    def ablegen(self, mime, daten, name, art):
        """Gibt (url, breite, hoehe) zurueck."""
        h = hashlib.sha1(daten).hexdigest()
        schluessel = (h, art)
        if schluessel in self.bekannt:
            return self.bekannt[schluessel]

        self.zaehler += 1
        stamm = f"{self.zaehler:02d}-{slug(name)}"

        if mime == "image/svg+xml":
            datei = self.ziel / f"{stamm}.svg"
            text = daten.decode("utf-8")
            m = re.search(r'viewBox="([\d.\s\-]+)"', text)
            w, hh = 0, 0
            if m:
                v = [float(x) for x in m.group(1).split()]
                w, hh = round(v[2]), round(v[3])
            datei.write_text(text, encoding="utf-8")
            res = (f"{self.url}/{datei.name}", w, hh)
        else:
            im = Image.open(io.BytesIO(daten))
            im.load()
            text = qr_text(im)
            ist_giro = bool(text and text.startswith("BCD"))
            if art == "girocode" or ist_giro:
                # 2-Farben-PNG in Originalgroesse: bleibt scharf und scannbar
                datei = self.ziel / f"{stamm}.png"
                q = im.convert("L").point(lambda p: 0 if p < 128 else 255).convert("1")
                q.save(datei, "PNG", optimize=True)
                res = (f"{self.url}/{datei.name}", im.width, im.height)
            else:
                grenze = MAX_BREITE.get(art, MAX_BREITE["foto"])
                alpha = im.mode in ("RGBA", "LA", "P") and "transparency" in im.info or im.mode == "RGBA"
                if im.width > grenze:
                    im = im.resize((grenze, round(im.height * grenze / im.width)), Image.LANCZOS)
                if not alpha:
                    im = im.convert("RGB")
                datei = self.ziel / f"{stamm}.webp"
                qual = 85 if art in ("anzeige", "logo") else 78
                im.save(datei, "WEBP", quality=qual, method=6)
                res = (f"{self.url}/{datei.name}", im.width, im.height)
            if text:
                self.qr[res[0]] = text
        self.bekannt[schluessel] = res
        self.log.append(f"{datei.name:52} {datei.stat().st_size // 1024:5d} KB")
        return res


def kopf(titel, beschreibung, noindex, preload_cover):
    robots = '<meta name="robots" content="noindex, nofollow" />\n' if noindex else ""
    fonts = "\n".join(
        f'<link rel="preload" href="/css/fonts/lexend-v26-latin-{SCHRIFTEN[w]}.ttf" as="font" type="font/ttf" crossorigin />'
        for w in (300, 800)
    )
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{titel}</title>
<meta name="description" content="{beschreibung}" />
{robots}<meta name="theme-color" content="#00122D" />
<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
{fonts}
<link rel="preload" href="{preload_cover}" as="image" fetchpriority="high" />
"""


def fontfaces():
    return "".join(
        "@font-face{font-family:'Lexend';font-weight:%d;font-style:normal;font-display:swap;"
        "src:url(/css/fonts/lexend-v26-latin-%s.ttf) format('truetype');}" % (w, d)
        for w, d in SCHRIFTEN.items()
    )


ZUSATZ_CSS = """
img{height:auto;max-width:100%}
.sitebar{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:10px 64px 10px 16px;background:var(--navy);color:#fff;font-size:13px}
.sitebar a{color:#fff;font-weight:600;text-decoration:none}
.sitebar a:hover{text-decoration:underline}
.sitebar .dl{margin-left:auto}
.cover .top{padding-right:0}
.qrlink{display:inline-block}
.pagefoot{background:var(--navy);color:#fff;padding:28px 20px;font-size:14px}
.pagefoot .in{max-width:760px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 22px}
.pagefoot a{color:#fff;font-weight:600}
.gcard .btn{margin-top:4px}
@media print{.sitebar,.pagefoot{display:none}}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("quelle", type=Path)
    ap.add_argument("--ausgabe", type=int, required=True)
    ap.add_argument("--titel-datum", required=True, help="z. B. 11.10.2026")
    ap.add_argument("--gegner", required=True)
    ap.add_argument("--saison", default="2026/27")
    ap.add_argument("--pdf", type=Path)
    ap.add_argument("--erlaube-entwurf", action="store_true")
    args = ap.parse_args()

    n = args.ausgabe
    html = args.quelle.read_text(encoding="utf-8")
    ordner = SEITEN / f"ausgabe-{n}"
    urlbasis = f"/assets/spieltagsinfo/ausgabe-{n}"
    bilder = Bilder(ASSETS / f"ausgabe-{n}", urlbasis)

    # --- Entwurfs-Spuren ---------------------------------------------------
    sichtbar = DATA_RE.sub("", html)
    funde = sorted(set(m.group(0) for m in ENTWURF_RE.finditer(sichtbar)))
    noindex = False
    if funde:
        if not args.erlaube_entwurf:
            print("ABBRUCH: Die Quelle enthaelt Entwurfs-Spuren:", ", ".join(funde), file=sys.stderr)
            return 1
        noindex = True
        print("ACHTUNG: Entwurfs-Spuren (" + ", ".join(funde) + ") -> Seite wird noindex.", file=sys.stderr)

    # --- Entwurfs-Banner und Menue-Skriptzeug ------------------------------
    html = re.sub(r'<div class="draft">.*?</div>\s*', "", html, flags=re.S)
    html = re.sub(r"\.draft\{[^}]*\}\s*", "", html)

    # --- Schriften ---------------------------------------------------------
    html = re.sub(r"(?:@font-face\{[^}]*data:font[^}]*\})+", fontfaces(), html)

    # --- Hintergrundbilder im CSS (Krallen) und Cover ------------------------
    def css_bild(m):
        mime, b64 = m.group(1), m.group(2)
        art = "logo"
        url, w, hgt = bilder.ablegen(mime, base64.b64decode(b64), "krallen", art)
        return url

    cover_url = {}

    def cover(m):
        url, w, hgt = bilder.ablegen(m.group(1), base64.b64decode(m.group(2)), "titel-cover", "cover")
        cover_url["u"] = url
        return f"background-image:url({url})"

    html = re.sub(r"background-image:url\(data:([a-z/+]+);base64,([A-Za-z0-9+/=]+)\)", cover, html, count=1)
    html = re.sub(r"url\(data:([a-z/+]+);base64,([A-Za-z0-9+/=]+)\)",
                  lambda m: f"url({css_bild(m)})", html)

    # --- <img>: Klasse der Umgebung bestimmt die Zielgroesse ----------------
    def img(m):
        tag = m.group(0)
        mime, b64 = re.search(r"src=\"data:([a-z0-9/+.\-]+);base64,([A-Za-z0-9+/=]+)\"", tag).groups()
        alt = (re.search(r'alt="([^"]*)"', tag) or [None, "bild"])[1]
        vor = html[max(0, m.start() - 400):m.start()]
        if "GiroCode" in alt:
            art = "girocode"
        elif "Anzeige" in alt:
            art = "anzeige"
        elif mime == "image/svg+xml" or alt == "Basketball Löwen":
            art = "logo"
        elif 'class="edfoto"' in vor[-80:]:
            art = "edfoto"
        elif "swecard" in vor[-200:]:
            art = "karte"
        else:
            art = "foto"
        url, w, hgt = bilder.ablegen(mime, base64.b64decode(b64), alt, art)
        eager = art == "logo" and "top" in vor[-40:]
        extra = f' width="{w}" height="{hgt}"' if w and hgt else ""
        extra += "" if eager else ' loading="lazy" decoding="async"'
        neu = re.sub(r'src="data:[^"]+"', f'src="{url}"', tag)
        neu = neu.replace("<img ", f"<img{extra} ", 1)
        return neu

    html = re.sub(r"<img [^>]*src=\"data:[^>]*>", img, html)

    # --- Rest-Pruefung: darf kein data: mehr uebrig sein ---------------------
    rest = DATA_RE.findall(html)
    if rest:
        print(f"ABBRUCH: {len(rest)} eingebettete Dateien nicht erfasst", file=sys.stderr)
        return 1

    # --- Texte: Spieltagsheft -> Spieltagsinfo -----------------------------
    ersetzen = [
        ("Dieses Spieltagsheft erscheint ab heute <b>zu jedem Heimspiel digital</b>. Ihr findet es auch zum Herunterladen auf basketball-loewen.com.",
         "Diese Spieltagsinfo erscheint ab heute <b>zu jedem Heimspiel digital</b>. Ihr findet sie auch zum Herunterladen auf basketball-loewen.com."),
        ('<span class="tag">Spieltagsheft · Saison 2026/27</span>',
         f'<span class="tag">Spieltagsinfo · Ausgabe {n} · Saison {args.saison}</span>'),
        ("<p>Spieltagsheft Nr. 1 · Saison 2026/27 · 11.10.2026</p>",
         f"<p>Spieltagsinfo · Ausgabe {n} · Saison {args.saison} · {args.titel_datum}</p>"),
    ]
    for alt, neu in ersetzen:
        if alt not in html:
            print(f"  Hinweis: Textstelle nicht gefunden (bei neuer Ausgabe evtl. anders): {alt[:60]}…", file=sys.stderr)
        html = html.replace(alt, neu)
    # --- Links ---------------------------------------------------------------
    # Seitenintern: ohne neues Fenster
    def intern(m):
        a = m.group(0)
        a = a.replace(f'href="{BASE}/', 'href="/').replace(f'href="{BASE}"', 'href="/"')
        return re.sub(r'\s+target="_blank"|\s+rel="noopener"', "", a)
    html = re.sub(r'<a [^>]*href="https://basketball-loewen\.com[^"]*"[^>]*>', intern, html)
    # Anzeigen: bezahlte Links
    def anzeige(m):
        return m.group(0).replace('rel="noopener"', 'rel="sponsored noopener"')
    html = re.sub(r'(<span class="ad-label">Anzeige</span>\s*<a [^>]*>)', anzeige, html)
    html = re.sub(r'(<p class="ad-label">Anzeige</p>\s*<a [^>]*>)', anzeige, html)

    # QR-Codes auswerten: URL -> anklickbar
    for url, text in bilder.qr.items():
        if not re.match(r"https?://", text):
            print(f"  QR (Zahlungscode, kein Link): {url}")
            continue
        for m in re.finditer(rf'<img [^>]*src="{re.escape(url)}"[^>]*>', html):
            davor = html[:m.start()]
            if davor.rfind("<a ") > davor.rfind("</a>"):
                ziel = re.search(r'href="([^"]*)"', davor[davor.rfind("<a "):]).group(1)
                print(f"  QR in Anzeige schon verlinkt: {ziel}  (QR-Ziel: {text})")
            else:
                html = html[:m.start()] + f'<a class="qrlink" href="{text}" rel="noopener">{m.group(0)}</a>' + html[m.end():]
                print(f"  QR -> anklickbar gemacht: {text}")
            break

    # GiroCode Nachwuchs -> Knopf zur Spendenseite
    html = html.replace(
        "<p>Basketball Löwen e.V.<br><b>IBAN DE68 8205 1000 0163 1313 76</b><br>BIC HELADEF1WEM</p></div>",
        '<p>Basketball Löwen e.V.<br><b>IBAN DE68 8205 1000 0163 1313 76</b><br>BIC HELADEF1WEM</p>'
        '<a class="btn" href="/spenden.html">Online spenden</a></div>', 1)

    # --- Kopf, Leiste, Fuss ----------------------------------------------------
    beschreibung = (f"Spieltagsinfo Ausgabe {n} zum Heimspiel der Basketball Löwen gegen {args.gegner} "
                    f"am {args.titel_datum}: Kader, Ligastand, Spielplan und Neuigkeiten aus Erfurt.")
    titel = f"Spieltagsinfo Ausgabe {n} · {args.gegner} · {args.titel_datum} — Basketball Löwen Erfurt"

    css = re.search(r"<style>.*?</style>", html, re.S).group(0)
    css = css.replace("</style>", ZUSATZ_CSS + "</style>")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)

    pdfname = f"ausgabe-{n}-spieltagsinfo.pdf"
    pdf_ziel = ASSETS / pdfname
    if args.pdf:
        pdf_ziel.parent.mkdir(parents=True, exist_ok=True)
        pdf_ziel.write_bytes(args.pdf.read_bytes())
    pdf_mb = pdf_ziel.stat().st_size / 1048576 if pdf_ziel.exists() else None
    pdf_link = (f'<a class="dl" href="/assets/spieltagsinfo/{pdfname}" download>PDF herunterladen'
                f'{f" ({pdf_mb:.1f} MB)" if pdf_mb else ""}</a>') if pdf_mb else ""

    leiste = ('<div class="sitebar noprint"><a href="/">Basketball Löwen</a>'
              '<a href="/saison/profis/gameday/spieltagsinfo/">Alle Spieltagsinfos</a>' + pdf_link + "</div>\n")
    fuss = ('<footer class="pagefoot noprint"><div class="in">'
            '<a href="/saison/profis/gameday/spieltagsinfo/">Alle Ausgaben</a>'
            '<a href="/saison/profis/gameday/">Gameday &amp; Tickets</a>'
            + (f'<a href="/assets/spieltagsinfo/{pdfname}" download>PDF herunterladen</a>' if pdf_mb else "") +
            '<a href="/impressum.html">Impressum</a><a href="/datenschutz.html">Datenschutz</a>'
            "</div></footer>\n")

    analytics = ANALYTICS
    out = (kopf(titel, beschreibung, noindex, cover_url.get("u", ""))
           + css + "\n" + analytics + "</head>\n<body>\n" + leiste + body.strip() + "\n" + fuss + "</body>\n</html>\n")

    ordner.mkdir(parents=True, exist_ok=True)
    (ordner / "index.html").write_text(out, encoding="utf-8")

    print("\n".join(bilder.log))
    gesamt = sum(p.stat().st_size for p in (ASSETS / f"ausgabe-{n}").iterdir())
    print(f"\nHTML {len(out) // 1024} KB (vorher {len(html) // 1024 // 1024 + 8} MB), Bilder {gesamt // 1024} KB "
          f"in {len(bilder.log)} Dateien")
    return 0


def _analytics():
    """Statistik-Block (GoatCounter + ahrefs) 1:1 von der Gameday-Seite uebernehmen,
    damit ein spaeteres Ausschalten ueber die Marker in allen Seiten greift."""
    q = (REPO / "saison" / "profis" / "gameday" / "index.html").read_text(encoding="utf-8")
    m = re.search(r"<script data-goatcounter.*?<!--/ANALYTICS:ahrefs-->\n", q, re.S)
    if not m:
        raise SystemExit("Statistik-Block auf der Gameday-Seite nicht gefunden")
    return m.group(0)


ANALYTICS = _analytics()

if __name__ == "__main__":
    sys.exit(main())
