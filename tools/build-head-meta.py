#!/usr/bin/env python3
"""Pflegt Canonical-, Open-Graph-, Twitter- und JSON-LD-Angaben im <head>.

Alles landet in einem markierten Block direkt vor </head>. Der Block wird bei
jedem Lauf komplett neu geschrieben — das Skript ist damit beliebig oft
wiederholbar und die Angaben können nicht auseinanderlaufen.

Nicht angetastet werden die Seiten unter news/insta-archiv/: die erzeugt der
n8n-Workflow "Website: News - Social Instagram abrufen" (GpAS0ONrenHrcTwS)
täglich neu und würde einen hier eingefügten Block beim nächsten Lauf
überschreiben. Deren head-Angaben stehen in der Workflow-Vorlage.

Warum statisch und nicht per include.js: Facebook, WhatsApp und Instagram
führen beim Erzeugen der Link-Vorschau kein JavaScript aus. Open-Graph-Tags
müssen im ausgelieferten HTML stehen.

Aufruf:
  python3 tools/build-head-meta.py
  python3 tools/build-head-meta.py --check    # nichts schreiben, nur berichten
"""

import argparse
import html
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from seo_common import BASE, REPO, canonical_url, indexable_pages

START = "<!-- SEO:auto START (tools/build-head-meta.py — nicht von Hand ändern) -->"
END = "<!-- SEO:auto END -->"
BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n?", re.S)

SKIP_PREFIXES = ("news/insta-archiv/",)

SITE_NAME = "Basketball Löwen Erfurt"
DEFAULT_IMAGE = BASE + "assets/img/share/og-default.jpg"

ORG = {
    "@type": "SportsOrganization",
    "@id": BASE + "#organization",
    "name": "Basketball Löwen Erfurt",
    "alternateName": ["Basketball Löwen e.V.", "CATL Basketball Löwen", "Basketball Löwinnen Erfurt"],
    "sport": "Basketball",
    "foundingDate": "2018",
    "url": BASE,
    # Raster statt SVG: Googles Parser verarbeitet SVG-Logos in strukturierten
    # Daten nicht zuverlässig. Die Seite selbst nutzt weiterhin das SVG.
    "logo": BASE + "assets/logo/android-chrome-512x512.png",
    "image": DEFAULT_IMAGE,
    "email": "info@basketball-loewen.com",
    "telephone": "+49 175 6100411",
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "Leipziger Straße 71",
        "postalCode": "99085",
        "addressLocality": "Erfurt",
        "addressRegion": "Thüringen",
        "addressCountry": "DE",
    },
    "sameAs": [
        "https://www.instagram.com/basketball.loewen/",
        "https://www.facebook.com/basketball.loewen.erfurt/",
        "https://www.youtube.com/channel/UCKV_um0lxsTkidR1Gaazlvw",
    ],
}

PUBLISHER = {
    "@type": "SportsOrganization",
    "name": ORG["name"],
    "logo": {"@type": "ImageObject", "url": ORG["logo"]},
}

RIETHSPORTHALLE = {
    "@type": "SportsActivityLocation",
    "name": "Riethsporthalle",
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "Essener Straße 20",
        "postalCode": "99089",
        "addressLocality": "Erfurt",
        "addressRegion": "Thüringen",
        "addressCountry": "DE",
    },
}

# Kein "sport"-Feld: schema.org definiert sport nur auf SportsOrganization,
# SportsEvent und SportsTeam, nicht auf Place-Typen wie SportsActivityLocation.
# Der Ahrefs-Crawl vom 25.08.2026 hat es als "Unexpected property" gemeldet --
# sechsmal auf der Freiplatz-Seite, je einmal auf den beiden LOEWENPARK-Seiten.
# Die Sportart steht ohnehin im Namen, in der Beschreibung und im Namen der
# ItemList.
LOEWENPARK = {
    "@type": "SportsActivityLocation",
    "name": "LÖWENPARK",
    "description": "Trainingsstandort der Basketball Löwen Erfurt am Südpark.",
    "address": {
        "@type": "PostalAddress",
        "postalCode": "99089",
        "addressLocality": "Erfurt",
        "addressRegion": "Thüringen",
        "addressCountry": "DE",
    },
}

# Erstes Pfadsegment -> Breadcrumb-Bezeichnung (Formulierung aus partials/header.html)
SECTIONS = {
    "club": ("Club", "club/ueber-uns.html"),
    "teams-saison": ("Teams", "teams-saison/profis.html"),
    "trainieren": ("Trainieren", "trainieren/loewenpark.html"),
    "partner": ("Partner", "partner/sponsoring.html"),
    "news": ("News", "news/aktuelles.html"),
    "fans": ("Fans", "fans/fanclub.html"),
    "tickets": ("Tickets", "tickets.html"),
    "mitglied-werden": ("Mitglied werden", "mitglied-werden.html"),
}

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
DESC_RE = re.compile(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']\s*/?>', re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
HERO_NEWS_RE = re.compile(r"hero-news-([a-z0-9-]+)")
ARTICLE_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})_")


def text_of(fragment):
    """HTML-Fragment -> reiner Text (Tags weg, Entities aufgelöst)."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def attr(value):
    """Text -> sicherer HTML-Attributwert."""
    return html.escape(value, quote=True)


def jsonld(nodes):
    """@graph-Block als <script>-Tag. < wird maskiert, damit kein Tag entsteht."""
    payload = json.dumps(
        {"@context": "https://schema.org", "@graph": nodes},
        ensure_ascii=False, separators=(",", ":"),
    ).replace("<", "\\u003c")
    return f'<script type="application/ld+json">{payload}</script>'


def share_image(rel, text):
    """Seitenspezifisches Share-Bild, sonst das Standardbild."""
    m = HERO_NEWS_RE.search(text)
    if m and (REPO / "assets" / "img" / "share" / f"news-{m.group(1)}.jpg").exists():
        return f"{BASE}assets/img/share/news-{m.group(1)}.jpg"
    return DEFAULT_IMAGE


def breadcrumb(rel, page_title):
    """BreadcrumbList: Start > Bereich > Seite. None für die Startseite."""
    if rel == "index.html":
        return None
    items = [{"@type": "ListItem", "position": 1, "name": "Start", "item": BASE}]
    seg = rel.split("/")[0]
    pos = 2
    if "/" in rel and seg in SECTIONS:
        label, landing = SECTIONS[seg]
        if landing != rel:
            items.append({"@type": "ListItem", "position": pos,
                          "name": label, "item": BASE + landing})
            pos += 1
    items.append({"@type": "ListItem", "position": pos,
                  "name": page_title, "item": canonical_url(rel)})
    return {"@type": "BreadcrumbList", "itemListElement": items}


def heimspiele():
    """Rohdaten aus data/heimspiele.json, unveraendert (Liste von dicts)."""
    return json.loads((REPO / "data" / "heimspiele.json").read_text(encoding="utf-8")).get("spiele", [])


def _spiel_event_node(g, mainEntityOfPage_url):
    """Ein SportsEvent-Knoten fuer genau ein Heimspiel.

    startDate mit echtem Berliner Offset (Sommer +02:00, Winter +01:00) — eine
    feste Zeitzone würde die Spiele von November bis März um eine Stunde
    verschieben.

    offers nur, wenn das Spiel eine ticketUrl hat (Vorverkauf ist offen). Ein
    Offer mit InStock fuer nicht verkaufbare Spiele waere eine Falschangabe in
    den strukturierten Daten.

    mainEntityOfPage bindet das Event an genau seine eigene Spieltagsseite --
    seit 25.08.2026 (Marko: "eine Adresse fuer den ganzen Lebenszyklus") gibt es
    dieses Event nur noch dort, nicht mehr zusaetzlich auf spielplan.html/tickets.html.
    """
    berlin = ZoneInfo("Europe/Berlin")
    d, m, y = g["datum"].split(".")
    hh, mm = g["zeit"].split(":")
    start = datetime(int(y), int(m), int(d), int(hh), int(mm), tzinfo=berlin)
    node = {
        "@type": "SportsEvent",
        "name": f"Basketball Löwen Erfurt – {g['gegner']}",
        "description": f"Heimspiel der Basketball Löwen Erfurt gegen {g['gegner']} "
                       f"in der Riethsporthalle.",
        "startDate": start.isoformat(),
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": RIETHSPORTHALLE,
        "homeTeam": {"@type": "SportsTeam", "name": "Basketball Löwen Erfurt"},
        "awayTeam": {"@type": "SportsTeam", "name": g["gegner"]},
        "organizer": {"@id": ORG["@id"]},
        "mainEntityOfPage": {"@type": "WebPage", "@id": mainEntityOfPage_url},
    }
    if g.get("ticketUrl"):
        node["offers"] = {
            "@type": "Offer",
            "url": BASE + g["ticketUrl"].lstrip("/"),
            "availability": "https://schema.org/InStock",
            "priceCurrency": "EUR",
        }
    return node


def spiel_event_for(rel):
    """SportsEvent fuer die Spieltagsseite teams-saison/spiel/<seiteSlug>.html."""
    seite_slug = rel.split("/")[-1].removesuffix(".html")
    for g in heimspiele():
        if g.get("seiteSlug") == seite_slug:
            return _spiel_event_node(g, canonical_url(rel))
    return None


def spielplan_itemlist():
    """ItemList mit Verweisen auf alle Spieltagsseiten -- spielplan.html ist nur
    noch Verzeichnis, das SportsEvent selbst lebt allein auf der jeweiligen Seite."""
    spiele = heimspiele()
    items = [
        {
            "@type": "ListItem",
            "position": i,
            "url": BASE + f"teams-saison/spiel/{g['seiteSlug']}.html",
            "name": f"Basketball Löwen Erfurt – {g['gegner']}",
        }
        for i, g in enumerate(spiele, start=1)
        if g.get("seiteSlug")
    ]
    if not items:
        return []
    return [{
        "@type": "ItemList",
        "name": "Heimspiele der Basketball Löwen Erfurt (Profis)",
        "numberOfItems": len(items),
        "itemListElement": items,
    }]


def platz_daten():
    return json.loads((REPO / "data" / "freiplaetze.json").read_text(encoding="utf-8")).get("freiplaetze", [])


def platz_knoten(f, mit_seite=False):
    """Ein Freiplatz als SportsActivityLocation.

    Kein "sport"-Feld -- siehe Kommentar an LOEWENPARK. mit_seite=True setzt
    zusaetzlich url und mainEntityOfPage: Auf der eigenen Platzseite ist der Ort
    das Thema der Seite, in der ItemList der Uebersicht nur ein Listeneintrag.
    """
    strasse = f["adresse"].split(",")[0].strip()
    plz = re.search(r"\b(\d{5})\b", f["adresse"])
    ort = {
        "@type": "SportsActivityLocation",
        "name": f["name"],
        "description": f.get("beschreibung", ""),
        "isAccessibleForFree": f.get("zugang") != "eingeschraenkt",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": strasse,
            "addressLocality": "Erfurt",
            "addressRegion": "Thüringen",
            "addressCountry": "DE",
        },
        "geo": {"@type": "GeoCoordinates",
                "latitude": f["lat"], "longitude": f["lng"]},
    }
    if plz:
        ort["address"]["postalCode"] = plz.group(1)
    if mit_seite:
        seite = f"{BASE}trainieren/freiplatz/{f['slug']}.html"
        ort["url"] = seite
        ort["mainEntityOfPage"] = {"@type": "WebPage", "@id": seite}
        if f.get("foto"):
            ort["image"] = BASE.rstrip("/") + f["foto"]
    return ort


def freiplatz_seite(rel):
    """SportsActivityLocation der einen Platzseite, anhand des Dateinamens."""
    slug = rel.rsplit("/", 1)[-1][: -len(".html")]
    for f in platz_daten():
        if f.get("slug") == slug:
            return [platz_knoten(f, mit_seite=True)]
    return []


def freiplaetze():
    """Die oeffentlichen Basketball-Freiplaetze als ItemList.

    Sechs benannte Plaetze mit Adresse und Koordinaten sind der staerkste lokale
    Inhalt, den die Seite hat -- und das Schema, mit dem Google oeffentliche
    Sportanlagen versteht. Ohne diesen Block bleibt die Seite fuer Google eine
    Textseite ueber Basketball; mit ihm ist sie ein Verzeichnis von sechs Orten
    in Erfurt, an denen man Basketball spielen kann.

    Die Listeneintraege verweisen ueber url auf die eigene Seite des Platzes --
    so haengt die Uebersicht auch in den strukturierten Daten an den sechs
    Einzelseiten, nicht nur ueber die Links im Text.
    """
    orte = []
    for i, f in enumerate(platz_daten(), start=1):
        ort = platz_knoten(f)
        ort["url"] = f"{BASE}trainieren/freiplatz/{f['slug']}.html"
        orte.append({"@type": "ListItem", "position": i, "item": ort})
    if not orte:
        return []
    return [{
        "@type": "ItemList",
        "name": "Öffentliche Basketball-Freiplätze in Erfurt",
        "numberOfItems": len(orte),
        "itemListElement": orte,
    }]


FAQ_ABSCHNITT_RE = re.compile(
    r'<span class="eyebrow">Häufige Fragen</span>(.*?)</section>', re.S)
FAQ_PAAR_RE = re.compile(
    r'<h3[^>]*>(.*?)</h3>\s*<p[^>]*>(.*?)</p>', re.S)


def faq(text):
    """FAQPage aus dem Abschnitt "Häufige Fragen" der Seite selbst.

    Bewusst aus dem sichtbaren HTML gelesen und nicht hier nochmal
    hingeschrieben: Sonst driften die strukturierten Daten von der Seite weg,
    sobald jemand eine Antwort umformuliert -- derselbe Fehler, den die
    handgepflegte sitemap.xml jahrelang gemacht hat.

    Zur Erwartung: Google zeigt FAQ-Rich-Results seit August 2023 nur noch fuer
    behoerdliche und medizinische Quellen an. Der Block bringt hier also keine
    aufklappbaren Treffer in der Suche, sondern macht die Frage-Antwort-Paare
    maschinenlesbar -- was fuer Antwortsysteme zaehlt, die aus der Seite zitieren.
    """
    m = FAQ_ABSCHNITT_RE.search(text)
    if not m:
        return []
    paare = [(text_of(f), text_of(a)) for f, a in FAQ_PAAR_RE.findall(m.group(1))]
    paare = [(f, a) for f, a in paare if f and a]
    if not paare:
        return []
    return [{
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": f,
             "acceptedAnswer": {"@type": "Answer", "text": a}}
            for f, a in paare
        ],
    }]


def nodes_for(rel, text, page_title, social_title, description, image):
    """JSON-LD-Knoten dieser Seite."""
    nodes = []

    if rel == "index.html":
        nodes.append(ORG)
        nodes.append({
            "@type": "WebSite",
            "@id": BASE + "#website",
            "url": BASE,
            "name": SITE_NAME,
            "inLanguage": "de-DE",
            "publisher": {"@id": ORG["@id"]},
            "potentialAction": {
                "@type": "SearchAction",
                "target": {"@type": "EntryPoint",
                           "urlTemplate": BASE + "suche.html?q={search_term_string}"},
                "query-input": "required name=search_term_string",
            },
        })

    if rel.startswith("news/artikel/"):
        m = ARTICLE_DATE_RE.search(rel.split("/")[-1])
        h1 = H1_RE.search(text)
        node = {
            "@type": "NewsArticle",
            "headline": text_of(h1.group(1)) if h1 else page_title,
            "description": description,
            "image": image,
            "inLanguage": "de-DE",
            "mainEntityOfPage": {"@type": "WebPage", "@id": canonical_url(rel)},
            "publisher": PUBLISHER,
            "author": PUBLISHER,
        }
        if m:
            node["datePublished"] = m.group(1)
        nodes.append(node)

    if rel.startswith("teams-saison/spiel/"):
        event = spiel_event_for(rel)
        if event:
            nodes.append(event)

    if rel == "teams-saison/spielplan.html":
        nodes.extend(spielplan_itemlist())

    if rel.startswith("trainieren/loewenpark"):
        nodes.append(LOEWENPARK)

    if rel == "trainieren/freiplaetze.html":
        nodes.extend(freiplaetze())

    if rel.startswith("trainieren/freiplatz/"):
        nodes.extend(freiplatz_seite(rel))

    if rel == "trainieren/court-hunt.html":
        nodes.extend(faq(text))

    crumb = breadcrumb(rel, social_title)
    if crumb:
        nodes.append(crumb)

    return nodes


SUFFIX_RE = re.compile(r"\s*[—–-]\s*Basketball L(ö|oe)wen Erfurt\s*$")


def short_title(page_title):
    """Vereinsnamen-Suffix für Social-Titel entfernen.

    In der Link-Vorschau steht der Vereinsname schon in og:site_name; ihn im
    Titel zu wiederholen kostet nur sichtbare Zeichen. Der <title> im Browser-Tab
    behält das Suffix.
    """
    stripped = SUFFIX_RE.sub("", page_title).strip()
    return stripped or page_title


def block_for(rel, text):
    t = TITLE_RE.search(text)
    d = DESC_RE.search(text)
    page_title = text_of(t.group(1)) if t else SITE_NAME
    social_title = short_title(page_title)
    description = text_of(d.group(1)) if d else ""
    url = canonical_url(rel)
    image = share_image(rel, text)
    og_type = "article" if rel.startswith("news/artikel/") else "website"

    lines = [
        START,
        f'<link rel="canonical" href="{url}" />',
        f'<meta property="og:type" content="{og_type}" />',
        f'<meta property="og:site_name" content="{attr(SITE_NAME)}" />',
        '<meta property="og:locale" content="de_DE" />',
        f'<meta property="og:title" content="{attr(social_title)}" />',
        f'<meta property="og:description" content="{attr(description)}" />',
        f'<meta property="og:url" content="{url}" />',
        f'<meta property="og:image" content="{image}" />',
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        f'<meta property="og:image:alt" content="{attr(social_title)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{attr(social_title)}" />',
        f'<meta name="twitter:description" content="{attr(description)}" />',
        f'<meta name="twitter:image" content="{image}" />',
    ]
    nodes = nodes_for(rel, text, page_title, social_title, description, image)
    if nodes:
        lines.append(jsonld(nodes))
    lines.append(END)
    return "\n".join(lines) + "\n"


def apply_block(text, block):
    if BLOCK_RE.search(text):
        return BLOCK_RE.sub(lambda _: block, text, count=1)
    return text.replace("</head>", block + "</head>", 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    changed, unchanged, skipped, problems = [], [], [], []

    for rel, text in indexable_pages():
        if rel.startswith(SKIP_PREFIXES):
            skipped.append(rel)
            continue
        if "</head>" not in text:
            problems.append(f"{rel}: kein </head> gefunden")
            continue
        if not DESC_RE.search(text):
            problems.append(f"{rel}: keine meta description — og:description bliebe leer")
        new = apply_block(text, block_for(rel, text))
        if new == text:
            unchanged.append(rel)
        else:
            changed.append(rel)
            if not args.check:
                (REPO / rel).write_text(new, encoding="utf-8")

    for p in problems:
        print(f"  ACHTUNG {p}", file=sys.stderr)
    print(f"  {len(changed)} Seiten {'zu ändern' if args.check else 'geschrieben'}, "
          f"{len(unchanged)} unverändert, {len(skipped)} übersprungen "
          f"(news/insta-archiv, gehört dem n8n-Workflow)")
    return 1 if (args.check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
