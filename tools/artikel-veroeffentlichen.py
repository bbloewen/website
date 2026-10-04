#!/usr/bin/env python3
"""Baut aus einem Auftrag (JSON) eine fertige News-Artikelseite.

Warum: News-Artikel entstehen in der Notion-Mediaplanung (Datenbank
"Inhalte-Kalender" unter 🗓️ Mediaplanung). Bis 04.10.2026 hat sie jemand von
Hand in eine HTML-Datei uebertragen -- Vorlage kopieren, Absaetze mit den
richtigen Klassen versehen, Eintrag in data/news.json schreiben, Hero-Klasse
ins CSS, Generatoren laufen lassen. Fuenf Schritte, von denen jeder einzeln
vergessen werden kann; beim Leverkusen-Vorbericht sind zwei davon beim ersten
Anlauf schiefgegangen (s. unten).

Dieses Skript ist der Uebersetzer zwischen beiden Welten: n8n liest Notion und
legt einen Auftrag ab, hier wird daraus die Seite. Die Formatierung steckt
damit an einer Stelle -- in Python, neben den anderen Generatoren -- und nicht
als zweite Kopie in einem n8n-Code-Node, wo sie unbemerkt auseinanderlaufen
wuerde (genau das Problem der Insta-Archiv-Vorlage, s. tools/README.md).

Zwei Stufen, gesteuert ueber "status" im Auftrag:

  pruefung     Die Seite entsteht unter ihrer endgueltigen URL, bekommt aber
               <meta name="robots" content="noindex"> und KEINEN Eintrag in
               data/news.json. Sie ist damit erreichbar, wer die Adresse hat,
               taucht aber nirgends auf: nicht auf der Startseite, nicht unter
               Aktuelles, nicht in den Team-Feeds, nicht in der Sitemap
               (seo_common.is_indexable filtert noindex-Seiten heraus, und die
               Listen lesen ausschliesslich news.json). Genau die Stufe, die es
               vorher schon von Hand gab -- "Datei liegt fertig, noindex,
               wartet auf den 23.09.".

  freigegeben  noindex faellt weg, der Eintrag in data/news.json kommt dazu.
               Ab jetzt ist der Artikel verlinkt und wird indexiert.

Derselbe Auftrag kann beide Male laufen; der zweite Lauf aendert nur, was sich
unterscheidet.

Zwei Fallen, die hier mit abgeraeumt sind:

  * Share-Bild. build-head-meta.py sucht es unter
    assets/img/share/news-<Suffix der Hero-CSS-Klasse>.jpg,
    build-share-images.py legt es unter dem DATEINAMEN des Hero-Bildes ab.
    Stimmen beide nicht ueberein, faellt og:image still auf og-default.jpg
    zurueck. Die Hero-Klasse wird deshalb hier zwingend aus dem Bildnamen
    gebildet, nicht frei gewaehlt.
  * Cache-Buster. Die ?v=-Werte der CSS- und JS-Dateien stehen in der Vorlage,
    wie auch in tools/build-spieltagsseiten.py. Damit sie nicht wie in der
    Insta-Vorlage einfrieren, werden sie beim Bauen gegen index.html
    abgeglichen und von dort uebernommen.

Nach diesem Skript muss die uebliche Kette laufen (tools/bauen.sh, mindestens
build-share-images, build-partials, build-head-meta, build-news-list,
build-home-news, build-team-news, build-article-nav, build-bildmasse,
build-sitemap). Wichtig: die Generatoren lesen nur git-getrackte Dateien --
eine neue, noch nicht mit "git add" vorgemerkte Artikeldatei bekommt sonst
weder SEO-Block noch Sitemap-Eintrag.

Aufruf:
  python3 tools/artikel-veroeffentlichen.py auftrag.json
  python3 tools/artikel-veroeffentlichen.py auftrag.json --check
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

from seo_common import REPO, esc

VORLAGE = REPO / "tools" / "vorlagen" / "news-artikel.html.vorlage"
NEWS_JSON = REPO / "data" / "news.json"
CSS = REPO / "css" / "site.css"
ARTIKEL_DIR = REPO / "news" / "artikel"
BILD_DIR = REPO / "assets" / "img" / "news"
INDEX = REPO / "index.html"

STATUS = ("pruefung", "freigegeben")
TEAMS = ("profis", "damen", "nachwuchs", "club", "partner")

# "team" im Auftrag ist das Schlagwort im DATEINAMEN (2026-10-07_club_...). In
# data/news.json bedeutet "team" etwas anderes: der Feed, in dem der Artikel
# erscheint. js/team-news.js und tools/build-team-news.py zeigen dort Artikel
# mit team == <Seite> UND alle Artikel OHNE team ("allgemein"). Ein Artikel mit
# team "club" stuende deshalb auf keiner Teamseite -- ein Vereinsartikel muss
# das Feld weglassen. So machen es die vier bestehenden Vereinsartikel
# (04.10.2026 am Podcast-Artikel aufgefallen, bevor er live ging).
NEWS_TEAM = ("profis", "damen", "baskidball")

PFLICHT = ("status", "datum", "team", "slug", "titel", "lead",
           "beschreibung", "kategorie", "bild", "markdown")

NOINDEX = '<meta name="robots" content="noindex, follow" />\n'


# ----------------------------------------------------------------- Typografie
#
# "gegebenenfalls aufbereiten, sodass die Artikel relativ gleich aussehen"
# (Marko, 04.10.2026). Wer in Notion schreibt, tippt gerade Anfuehrungszeichen
# und Bindestriche; auf der Seite stehen deutsche Gaensefuesschen und
# Geviertstriche. Das hier vereinheitlicht beides, ohne in Links, Zahlen oder
# Bindestrich-Woerter zu greifen.

def typografie(text):
    # Reihenfolge ist wichtig. Notion schliesst deutsche Anfuehrungszeichen mit
    # einem GERADEN Zeichen: „Mike". Wuerde zuerst paarweise nach geraden
    # Zeichen gesucht, paarte die Regel zwei Schlusszeichen miteinander und
    # machte aus  „Tip-Off", ... „Loewen"  den Unsinn  „Tip-Off„, ... „Loewen“
    # (am Leverkusen-Vorbericht aufgefallen, 04.10.2026).
    # 1. „x" mit geradem Schlusszeichen -> „x“
    text = re.sub(r'\u201e([^\u201e\u201c"\n]+)"', "\u201e\\1\u201c", text)
    # 2. "x" -> „x“  (nur paarweise, damit ein einzelnes Zoll-Zeichen bleibt)
    text = re.sub(r'"([^"\n]+)"', "\u201e\\1\u201c", text)
    # 3. 'x' -> ‚x'
    text = re.sub(r"(?<![\w])'([^'\n]+)'(?![\w])", "\u201a\\1\u2018", text)
    # 4. Gedankenstrich: Notion tippt " - " und " – ", die Seite fuehrt " — "
    text = re.sub(r" (?:-{1,2}|\u2013) ", " \u2014 ", text)
    # 5. "..." -> …
    text = text.replace("...", "\u2026")
    return text


# ------------------------------------------------------------------- Markdown
#
# Bewusst eine kleine Teilmenge, genau das, was in den bisherigen Artikeln
# vorkommt. Alles andere soll auffallen, statt still als Text durchzurutschen.

LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
FETT_RE = re.compile(r"\*\*([^*]+)\*\*")
KURSIV_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")


def inline(text):
    """Fett, kursiv und Links. Erst maskieren, dann die Auszeichnung setzen."""
    text = html.escape(text, quote=False)

    def link(m):
        beschriftung, ziel = m.group(1), m.group(2)
        # Eigene Seiten relativ verlinken, fremde in einem neuen Tab oeffnen.
        ziel = re.sub(r"^https?://(?:www\.)?basketball-loewen\.com", "", ziel)
        if ziel.startswith("/"):
            return f'<a href="{esc(ziel)}">{beschriftung}</a>'
        return f'<a href="{esc(ziel)}" target="_blank" rel="noopener">{beschriftung}</a>'

    text = LINK_RE.sub(link, text)
    text = FETT_RE.sub(r"<strong>\1</strong>", text)
    text = KURSIV_RE.sub(r"<em>\1</em>", text)
    return text


def markdown_zu_html(md):
    """Markdown-Teilmenge -> Artikel-HTML mit den Klassen der Seite."""
    zeilen = typografie(md).replace("\r\n", "\n").split("\n")
    raus, liste = [], []

    def liste_schliessen():
        if liste:
            punkte = "".join(f"<li>{inline(p)}</li>" for p in liste)
            raus.append(f'<ul class="t-body mt-4">{punkte}</ul>')
            liste.clear()

    for roh in zeilen:
        z = roh.strip()
        if not z:
            liste_schliessen()
            continue
        if z.startswith("- ") or z.startswith("* "):
            liste.append(z[2:].strip())
            continue
        liste_schliessen()
        if z.startswith("#### ") or z.startswith("### "):
            # Notion-Schreibende benutzen H3 fuer Zwischenueberschriften; auf der
            # Seite ist das die t-h3-Stufe, dieselbe wie bei ## -- die Artikel
            # haben nur eine Ebene unterhalb der H1.
            raus.append(f'<h2 class="t-h3 mt-6">{inline(z.lstrip("#").strip())}</h2>')
        elif z.startswith("## "):
            raus.append(f'<h2 class="t-h3 mt-6">{inline(z[3:].strip())}</h2>')
        elif z.startswith("> "):
            raus.append(f'<blockquote class="pull-quote">{inline(z[2:].strip())}</blockquote>')
        elif z.startswith("# "):
            raise SystemExit(
                "  FEHLER: '# ' im Text. Die H1 kommt aus dem Feld \"h1\" bzw. "
                '"titel", im Fliesstext bitte mit "## " anfangen.'
            )
        else:
            raus.append(f'<p class="t-body mt-4">{inline(z)}</p>')
    liste_schliessen()
    return "\n      ".join(raus)


# ----------------------------------------------------------------- Bausteine

def hero_klasse(bild):
    """Hero-CSS-Klasse aus dem Bildnamen -- s. Kopfkommentar (Share-Bild)."""
    return "hero-news-" + Path(bild).stem


def main_block(a):
    h1 = a.get("h1") or (a["titel"] if a["titel"].endswith(".") else a["titel"] + ".")
    punkte = "".join(
        f"\n          <li>{inline(typografie(p))}</li>" for p in a.get("kurzfassung", [])
    )
    kurzfassung = ""
    if punkte:
        tag = ".".join(reversed(a["datum"].split("-")))
        kurzfassung = (
            '      <div class="article-summary">\n'
            f'        <span class="article-summary-label">{tag}: Das Wichtigste in Kürze</span>\n'
            f"        <ul>{punkte}\n        </ul>\n"
            "      </div>\n"
        )
    return (
        '<main id="main">  <section class="hero-photo hero-article hero-half '
        f'{hero_klasse(a["bild"])}">\n'
        '    <div class="container">\n'
        f'    <span class="eyebrow">Aktuelles · {esc(a["kategorie"])}</span>\n'
        f"    <h1>{inline(typografie(h1))}</h1>\n"
        f'    <p class="lead">{inline(typografie(a["lead"]))}</p>\n'
        "    </div>\n"
        "  </section>\n"
        '  <section class="section">\n'
        '    <div class="container container-narrow">\n'
        f"{kurzfassung}"
        f'      {markdown_zu_html(a["markdown"])}\n'
        '      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border);'
        'display:flex;align-items:center;justify-content:center;gap:20px">\n'
        '        <span id="article-nav-prev"><!--ARTICLENAV:article-nav-prev-->'
        "<!--/ARTICLENAV:article-nav-prev--></span>\n"
        '        <a class="btn btn-outline-orange btn-sm" href="/news/newsletter/">'
        "Newsletter abonnieren</a>\n"
        '        <span id="article-nav-next"><!--ARTICLENAV:article-nav-next-->'
        "<!--/ARTICLENAV:article-nav-next--></span>\n"
        "      </div>\n"
        "    </div>\n"
        "  </section>\n"
        "</main>"
    )


ASSET_RE = re.compile(r'(/(?:css|js)/[A-Za-z0-9/_.-]+?)\?v=(\d+)')


def cache_buster_abgleichen(seite):
    """?v=-Werte aus index.html uebernehmen -- s. Kopfkommentar."""
    aktuell = dict(ASSET_RE.findall(INDEX.read_text(encoding="utf-8")))
    return ASSET_RE.sub(
        lambda m: f"{m.group(1)}?v={aktuell.get(m.group(1), m.group(2))}", seite
    )


def seite_bauen(a):
    seite = VORLAGE.read_text(encoding="utf-8")
    titel = a.get("seitentitel") or a["titel"]
    seite = seite.replace("__TITLE__", esc(f"{titel} — Basketball Löwen Erfurt"))
    seite = seite.replace("__DESCRIPTION__", esc(typografie(a["beschreibung"])))
    seite = seite.replace("__MAIN__", main_block(a))
    if a["status"] == "pruefung":
        seite = seite.replace("</head>", NOINDEX + "</head>", 1)
    return cache_buster_abgleichen(seite)


def css_ergaenzen(a, schreiben):
    """Hero-Klasse in css/site.css eintragen, falls sie noch fehlt."""
    klasse = hero_klasse(a["bild"])
    t = CSS.read_text(encoding="utf-8")
    if f".hero-photo.{klasse} " in t:
        return False
    # Die Hero-Klassen stehen als Block beieinander, neueste oben.
    anker = re.search(r"^\.hero-photo\.hero-news-[a-z0-9-]+ \{", t, re.M)
    if not anker:
        raise SystemExit("  FEHLER: kein hero-news-Block in css/site.css gefunden.")
    zeile = (f".hero-photo.{klasse} {{ --hero-photo-url: "
             f"url('/assets/img/news/{a['bild']}'); background-position: center center; }}\n")
    if schreiben:
        CSS.write_text(t[: anker.start()] + zeile + t[anker.start():], encoding="utf-8")
    return True


def news_json_pflegen(a, url, schreiben):
    """Eintrag anlegen/aktualisieren (freigegeben) oder entfernen (pruefung)."""
    roh = NEWS_JSON.read_text(encoding="utf-8")
    d = json.loads(roh)
    vorher = json.dumps(d["artikel"], ensure_ascii=False)
    d["artikel"] = [e for e in d["artikel"] if e.get("url") != url]

    if a["status"] == "freigegeben":
        d["artikel"].insert(0, {
            "datum": ".".join(reversed(a["datum"].split("-"))),
            "kategorie": a["kategorie"],
            "tint": a.get("tint", "tint-orange"),
            "icon": a.get("icon", "newspaper"),
            "titel": typografie(a["titel"]),
            "kurztext": typografie(a.get("kurztext") or a["beschreibung"]),
            "url": url,
            "bild": f"/assets/img/news/{a['bild']}",
            "topNews": bool(a.get("topNews", False)),
        })
        if a["team"] in NEWS_TEAM:
            d["artikel"][0]["team"] = a["team"]

    if json.dumps(d["artikel"], ensure_ascii=False) == vorher:
        return False
    if schreiben:
        NEWS_JSON.write_text(
            json.dumps(d, ensure_ascii=False, indent=2) + ("\n" if roh.endswith("\n") else ""),
            encoding="utf-8",
        )
    return True


SPIELPLAN = REPO / "data" / "spielplan-saison.json"
HEIMSPIELE = REPO / "data" / "heimspiele.json"


def spielplan_pflegen(a, url, schreiben):
    """Vor-/Nachbericht beim Spiel verlinken -- nur in der Stufe "freigegeben".

    Zweite Stelle, an der ein Artikel verlinkt wird, und zwar an news.json
    vorbei: das Dokument-Icon im Startseiten-Widget und im Spielplan liest
    spielberichtUrl bzw. nachberichtUrl aus data/spielplan-saison.json. Ohne
    diesen Schritt bliebe ein Vorbericht in der Pruefstufe ueber das Widget
    doch erreichbar -- beim Leverkusen-Spiel genau so aufgefallen.

    Der Auftrag nennt dafuer "spiel": { "datum": "04.10.2026", "feld":
    "spielberichtUrl" }. Die Datei haelt ein Spiel je Zeile, deshalb wird hier
    zeilenweise ersetzt und nicht neu serialisiert -- ein json.dumps() wuerde
    die ganze Datei umformatieren.
    """
    spiel = a.get("spiel")
    if not spiel:
        return False
    feld = spiel.get("feld", "spielberichtUrl")
    if feld not in ("spielberichtUrl", "nachberichtUrl"):
        raise SystemExit('  FEHLER: spiel.feld muss spielberichtUrl oder nachberichtUrl sein.')

    t = SPIELPLAN.read_text(encoding="utf-8")
    zeilen = t.split("\n")
    # Nur im Block "profisAuswaerts" suchen. Die Datei fuehrt auch Damen und
    # NBBL, und die spielen oft am selben Tag -- ein Treffer ueber die ganze
    # Datei waere dann nicht eindeutig gewesen.
    von = next((i for i, z in enumerate(zeilen) if '"profisAuswaerts"' in z), None)
    if von is None:
        print("  WARNUNG: kein Block profisAuswaerts in data/spielplan-saison.json.", file=sys.stderr)
        return False
    bis = next((i for i in range(von + 1, len(zeilen)) if zeilen[i].strip() in ("]", "],")), len(zeilen))
    treffer = [i for i in range(von + 1, bis) if f'"datum": "{spiel["datum"]}"' in zeilen[i]]
    if not treffer:
        # Heimspiele stehen in data/heimspiele.json und haben eine eigene
        # Spieltagsseite; ein Vorbericht zu einem anderen Termin findet ebenfalls
        # keine Zeile. Beides ist kein Grund, den ganzen Lauf scheitern zu lassen.
        print(f'  Hinweis: kein Auswaertsspiel am {spiel["datum"]} -- keine Verlinkung im Spielplan.')
        return False
    if len(treffer) > 1:
        raise SystemExit(
            f'  FEHLER: {len(treffer)} Auswaertsspiele am {spiel["datum"]} in '
            "data/spielplan-saison.json (erwartet: hoechstens eines)."
        )
    i = treffer[0]
    alt = zeilen[i]
    ohne = re.sub(r',\s*"' + feld + r'": "[^"]*"', "", alt)
    if a["status"] == "freigegeben":
        neu = re.sub(r"\s*\}", f', "{feld}": "{url}" }}', ohne, count=1)
    else:
        neu = ohne
    if neu == alt:
        return False
    if schreiben:
        zeilen[i] = neu
        SPIELPLAN.write_text("\n".join(zeilen), encoding="utf-8")
    return True


HERO_MAX_BREITE = 2400
HERO_QUALITAET = 82


def bild_bereitstellen(a, schreiben):
    """Hero-Bild aus dem Eingang in assets/img/news/ ablegen -- als WebP.

    n8n legt das Original unter a["quellbild"] ab (data/artikel-eingang/bilder/),
    so wie es in Drive liegt: JPG, PNG oder WebP. Die Seite verwendet fuer alle
    Bilder ausser den Share-Bildern ausschliesslich WebP; die Umwandlung gehoert
    hierher und nicht nach n8n, weil hier Pillow ohnehin installiert ist.

    Nach dem Umwandeln wird das Original geloescht. Das macht den Schritt
    idempotent: beim naechsten Lauf (z. B. bei der Freigabe) gibt es keine Quelle
    mehr, und das fertige WebP bleibt unangetastet.
    """
    quelle = a.get("quellbild")
    if not quelle:
        return False
    q = REPO / quelle
    if not q.is_file():
        return False
    ziel = BILD_DIR / a["bild"]
    if schreiben:
        ziel.parent.mkdir(parents=True, exist_ok=True)
        if q.suffix.lower() == ".webp":
            ziel.write_bytes(q.read_bytes())          # schon WebP: nicht neu kodieren
        else:
            from PIL import Image                     # nur hier noetig
            with Image.open(q) as im:
                im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
                if im.width > HERO_MAX_BREITE:
                    hoehe = round(im.height * HERO_MAX_BREITE / im.width)
                    im = im.resize((HERO_MAX_BREITE, hoehe), Image.LANCZOS)
                im.save(ziel, "WEBP", quality=HERO_QUALITAET, method=6)
        q.unlink()
    return True


def pruefe(a):
    fehlt = [f for f in PFLICHT if not a.get(f)]
    if fehlt:
        raise SystemExit(f"  FEHLER: Pflichtfelder fehlen: {', '.join(fehlt)}")
    if a["status"] not in STATUS:
        raise SystemExit(f"  FEHLER: status muss {' oder '.join(STATUS)} sein.")
    if a["team"] not in TEAMS:
        raise SystemExit(f"  FEHLER: team muss eines von {', '.join(TEAMS)} sein.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a["datum"]):
        raise SystemExit("  FEHLER: datum muss JJJJ-MM-TT sein.")
    if not re.fullmatch(r"[a-z0-9-]+", a["slug"]):
        raise SystemExit("  FEHLER: slug darf nur a-z, 0-9 und Bindestriche enthalten.")
    quelle = a.get("quellbild")
    if not (BILD_DIR / a["bild"]).is_file() and not (quelle and (REPO / quelle).is_file()):
        raise SystemExit(
            f"  FEHLER: Hero-Bild fehlt: weder assets/img/news/{a['bild']} noch das Original "
            f"{quelle or '(kein quellbild im Auftrag)'}"
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("auftrag", help="JSON-Datei mit dem Artikelauftrag")
    ap.add_argument("--check", action="store_true", help="nur melden, nichts schreiben")
    args = ap.parse_args()

    a = json.loads(Path(args.auftrag).read_text(encoding="utf-8"))
    pruefe(a)

    name = f"{a['datum']}_{a['team']}_{a['slug']}.html"
    ziel = ARTIKEL_DIR / name
    url = f"/news/artikel/{name}"
    schreiben = not args.check

    bild_neu = bild_bereitstellen(a, schreiben)
    seite = seite_bauen(a)
    seite_neu = not ziel.is_file() or ziel.read_text(encoding="utf-8") != seite
    if seite_neu and schreiben:
        ziel.write_text(seite, encoding="utf-8")

    css_neu = css_ergaenzen(a, schreiben)
    news_neu = news_json_pflegen(a, url, schreiben)
    spiel_neu = spielplan_pflegen(a, url, schreiben)

    wort = "zu ändern" if args.check else "geschrieben"
    print(f"  {name}: {'Seite ' + wort if seite_neu else 'Seite unverändert'}"
          f"{', CSS-Hero-Klasse ' + wort if css_neu else ''}"
          f"{', news.json ' + wort if news_neu else ''}"
          f"{', Spielplan-Verlinkung ' + wort if spiel_neu else ''}"
          f"{', Hero-Bild nach WebP ' + wort if bild_neu else ''}")
    print(f"  Status: {a['status']}"
          + (" (noindex, nicht verlinkt)" if a["status"] == "pruefung" else " (verlinkt, indexierbar)"))
    print(f"  URL: https://basketball-loewen.com{url}")
    return 1 if (args.check and (seite_neu or css_neu or news_neu or spiel_neu or bild_neu)) else 0


if __name__ == "__main__":
    sys.exit(main())
