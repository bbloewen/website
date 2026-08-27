#!/usr/bin/env python3
"""Erzeugt/pflegt eine Seite je Heimspiel unter saison/profis/gameday/<seiteSlug>.html.

Marko-Vorgabe 25.08.2026: "Jedes Heimspiel bekommt eine Adresse — und behält sie
sein ganzes Leben." Vor dem Spiel Ankündigung+Ticketverkauf, danach Ergebnis+
Bericht+Impressionen, dieselbe URL. Diese eine Seite ist damit der einzige
Heimatort eines Spiels — nicht mehr saison/spielplan.html (das wird zum
reinen Verzeichnis) und nicht news/artikel/ (das bleibt Vereinsnews).

Vier Phasen, hergeleitet statt von Hand gepflegt (phase()):
  angekuendigt  Spiel liegt in der Zukunft, noch keine ticketUrl gesetzt
  vorverkauf    Spiel liegt in der Zukunft, ticketUrl ist gesetzt
  spieltag      heute ist Spieltag
  danach        Spiel liegt in der Vergangenheit

Der Ticketkauf (Saalplan/Kategorien/Kasse) ist direkt eingebettet — dieselbe
SeatPicker-Komponente, die vorher in der ungebundenen tickets/einzelticket.html
lief (?spiel=<slug>, nie verlinkt). Jede Spieltagsseite kennt ihr Spiel bereits
zur Bauzeit, deshalb kein Fetch/URL-Parameter mehr nötig — die Werte stehen
direkt im Skript.

Bericht-Block: redaktioneller Inhalt (Ergebnis, Rückblick, Impressionen), den
dieses Skript NIE überschreibt. Bei jedem Lauf wird die Seite komplett neu
zusammengesetzt (Phase kann sich geändert haben), aber der Inhalt des
<!--BERICHT:auto-->...<!--/BERICHT:auto-->-Blocks wird vor dem Neubau aus der
bestehenden Datei ausgelesen und unverändert wieder eingesetzt. Nur bei der
allerersten Erzeugung einer Seite steht dort ein Platzhalter.

seiteSlug wird nur einmalig erzeugt, wenn er in data/heimspiele.json fehlt, und
danach nie mehr angetastet (auch wenn sich die Schreibweise des Gegners später
ändert) — s. Hinweis in der JSON-Datei selbst.

Aufruf:
  python3 tools/build-spieltagsseiten.py
  python3 tools/build-spieltagsseiten.py --check
"""

import argparse
import html
import json
import re
import sys
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

from seo_common import REPO

QUELLE = REPO / "data" / "heimspiele.json"
ZIEL_DIR = REPO / "saison" / "profis" / "gameday"
BERLIN = ZoneInfo("Europe/Berlin")

MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
          "August", "September", "Oktober", "November", "Dezember"]

RIETHSPORTHALLE_MAPS_URL = (
    "https://www.google.com/maps/search/?api=1&query="
    "Riethsporthalle+Erfurt+Essener+Stra%C3%9Fe+20+99089+Erfurt"
)

BERICHT_PLATZHALTER = "      <p>Ergebnis und Bericht folgen nach dem Spiel.</p>"

UMLAUT_MAP = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"})


def slugify(text):
    """Nur als Fallback, falls seiteSlug fehlt -- danach steht der Wert fest."""
    text = text.translate(UMLAUT_MAP)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text


def parse_dmy(s):
    d, m, y = s.split(".")
    return datetime(int(y), int(m), int(d), tzinfo=BERLIN).date()


def lang_datum(d):
    return f"{d.day}. {MONATE[d.month - 1]} {d.year}"


def phase_of(game, today):
    spieldatum = parse_dmy(game["datum"])
    if spieldatum < today:
        return "danach"
    if spieldatum == today:
        return "spieltag"
    if game.get("ticketUrl"):
        return "vorverkauf"
    return "angekuendigt"


def sichere_seitenslugs(daten):
    """Ergänzt seiteSlug nur dort, wo er fehlt -- schreibt die Datei nur dann neu."""
    geaendert = False
    for g in daten["spiele"]:
        if not g.get("seiteSlug"):
            g["seiteSlug"] = f"{g['slug']}-{slugify(g['gegner'])}"
            geaendert = True
            print(f"  seiteSlug neu vergeben: {g['seiteSlug']}")
    if geaendert:
        QUELLE.write_text(json.dumps(daten, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return daten


def extract_bericht(pfad):
    if not pfad.exists():
        return BERICHT_PLATZHALTER
    text = pfad.read_text(encoding="utf-8")
    m = re.search(r"<!--BERICHT:auto-->\n(.*?)\n\s*<!--/BERICHT:auto-->", text, re.S)
    return m.group(1) if m else BERICHT_PLATZHALTER


LEER_HEADER = '<div id="site-header-placeholder"></div>'
LEER_FOOTER = '<div id="site-footer-placeholder"></div>'
LEER_SEO = ""


def extract_seo_block(pfad):
    """SEO:auto-Block (Canonical/OG/JSON-LD) unveraendert uebernehmen, aus
    demselben Grund wie extract_platzhalter: dieses Skript baut die Seite komplett
    neu, wuerde also sonst bei jedem Lauf zunichtemachen, was build-head-meta.py
    zuletzt eingetragen hat. Fehlt der Block (Seite noch nie durch build-head-meta.py
    gelaufen), bleibt er leer -- build-head-meta.py ergaenzt ihn beim naechsten Lauf."""
    if not pfad.exists():
        return LEER_SEO
    text = pfad.read_text(encoding="utf-8")
    m = re.search(
        r"<!-- SEO:auto START \(tools/build-head-meta\.py — nicht von Hand ändern\) -->.*?<!-- SEO:auto END -->\n?",
        text, re.S,
    )
    return m.group(0) if m else LEER_SEO


def extract_platzhalter(pfad, name, leer):
    """Header/Footer-Platzhalter unveraendert aus der bestehenden Datei uebernehmen.

    Wichtig: dieses Skript baut die Seite bei jedem Lauf komplett neu zusammen
    (die Phase kann sich geaendert haben) -- ohne diese Funktion wuerde jeder Lauf
    die von build-partials.py eingefuegten Header/Footer wieder auf die leeren
    Platzhalter zuruecksetzen, und build-partials.py muesste jedes Mal erneut
    laufen, nur um das rueckgaengig zu machen (genau das ist beim allerersten
    Zusammenspiel der beiden Skripte am 25.08.2026 passiert -- s. Reihenfolge
    unten in main()/README). Ist die Datei noch neu oder der Block unvollstaendig,
    bleibt der leere Platzhalter stehen, den build-partials.py beim naechsten Lauf
    dann fuellt."""
    if not pfad.exists():
        return leer
    text = pfad.read_text(encoding="utf-8")
    m = re.search(
        r'<div id="site-' + name + r'-placeholder">(?:<!--PARTIAL:' + name + r'-->.*?<!--/PARTIAL:' + name + r'-->)?</div>',
        text, re.S,
    )
    return m.group(0) if m else leer


PRETIX_ITEM_CATEGORY_MAP = {
    23: "Stehplatz", 24: "Kategorie I", 25: "Kategorie II",
    27: "Fanblock", 28: "Kategorie III",
    29: "Kategorie II", 30: "Kategorie II", 31: "Kategorie II", 32: "C unten",
    33: "Kategorie I", 34: "Rollstuhlplatz", 35: "Kategorie I", 40: "VIP",
}

PREISLISTE_HTML = """            <h3 class="t-h4 mb-3">Preise</h3>
            <div class="price-row"><span>Kategorie 1</span><strong>16,00 €</strong></div>
            <div class="price-row"><span>Kategorie 1 (ermäßigt)</span><strong>14,00 €</strong></div>
            <div class="price-row"><span>Kategorie 2</span><strong>12,00 €</strong></div>
            <div class="price-row"><span>Kategorie 2 (ermäßigt)</span><strong>8,50 €</strong></div>
            <div class="price-row"><span>Kategorie 3</span><strong>10,50 €</strong></div>
            <div class="price-row"><span>Kategorie 3 (ermäßigt)</span><strong>8,00 €</strong></div>
            <div class="price-row"><span>Kategorie 3 (Kinder 7–14)</span><strong>5,00 €</strong></div>
            <div class="price-row"><span>Fanblock</span><strong>10,50 €</strong></div>
            <div class="price-row"><span>Fanblock (ermäßigt)</span><strong>8,00 €</strong></div>
            <div class="price-row"{stehplatz_class}><span>Stehplatz</span><strong>8,00 €</strong></div>
            <div class="price-row"><span>Rollstuhlfahrer (inkl. Begleitkarte)<br><span class="t-caption" style="color:var(--text-muted)">nur Block A, D, E, F</span></span><strong>8,00 €</strong></div>
            <div class="price-row"><span>VIP</span><strong>119,00 €</strong></div>"""

WISSENSWERTES_HTML = """      <span class="eyebrow" style="display:block;margin-top:40px;margin-bottom:16px">Wissenswertes</span>
      <div class="grid-3">
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="percent"></i></div>
            <h3 class="t-h4">Ermäßigungen</h3>
          </div>
          <p class="t-body-sm">Beim Einzelticket gilt der ermäßigte Satz für Studierende, Azubis, FSJ, Menschen mit Behinderung ab 50&nbsp;% und Rentner*innen (jeweils mit Nachweis beim Einlass). Für Kinder von 7 bis 14 Jahren gibt es bei Tickets in Block A zusätzlich 25&nbsp;% Rabatt auf den ermäßigten Preis — schon ab dem ersten Kind.</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="armchair"></i></div>
            <h3 class="t-h4">Vorteile</h3>
          </div>
          <p class="t-body-sm">Einen <strong>festen Sitzplatz</strong> gibt es ab dieser Saison nicht mehr beim Einzelticket — nur noch mit der Dauerkarte. Beim Einzelticket wählst du frei innerhalb deines gebuchten Blocks, pro Spiel neu.</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="smartphone"></i></div>
            <h3 class="t-h4">Dein Ticket</h3>
          </div>
          <p class="t-body-sm">Digital als QR-Code per E-Mail — zum Einlass einfach aufs Handy holen oder ausdrucken. Der Kauf läuft direkt und sicher über unseren Ticketanbieter pretix.</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="door-open"></i></div>
            <h3 class="t-h4">Einlass</h3>
          </div>
          <p class="t-body-sm">Eine Stunde vor Spielbeginn öffnen sich die Türen der Riethsporthalle. Kinder bis 6 Jahre haben freien Eintritt (ohne Anspruch auf einen eigenen Sitzplatz).</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="scale"></i></div>
            <h3 class="t-h4">Rechtliches</h3>
          </div>
          <p class="t-body-sm">Alle Regelungen zu Kauf, Rücknahme und Verlust findest du in unseren <a href="/agb.html">AGB</a>.</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="chart-no-axes-column"></i></div>
            <h3 class="t-h4">Auslastung</h3>
          </div>
          <div id="seatplan-occupancy"><p class="t-body-sm" style="color:var(--text-muted)">Wird geladen …</p></div>
        </div>
      </div>"""


def kauf_section(game):
    """Saalplan + Preise + Kasse -- identisch zur bisherigen tickets/einzelticket.html,
    nur mit fest eingebetteten Spieldaten statt Fetch+?spiel=-Parameter."""
    stehplatz_class = ' style="text-decoration:line-through;opacity:.55"' if game.get("stehplatzBuchbar") is False else ""
    game_json = json.dumps({
        "gegner": game["gegner"],
        "datum": game["datum"],
        "zeit": game["zeit"],
        "subeventId": game["subeventId"],
        "stehplatzBuchbar": game.get("stehplatzBuchbar", True),
        "zahlungPausiert": game.get("zahlungPausiert", False),
    }, ensure_ascii=False)
    return f"""  <section class="section">
    <div class="container">
      <div class="buy-grid">
          <div class="buy-prices-col">
{PREISLISTE_HTML.format(stehplatz_class=stehplatz_class)}
          </div>
          <div class="buy-thumb-col">
            <div id="seatplan-root"></div>
          </div>
          <div class="buy-cart-col">
            <h3 class="t-h4 mb-1">Deine Auswahl</h3>
            <p class="t-caption" style="color:var(--text-muted);margin-bottom:14px">Einzelticket für den {html.escape(game["datum"])}</p>
            <div id="seatplan-cart"></div>
            <div class="seatplan-cart-total"><span>Gesamt</span><span id="seatplan-total">0,00 €</span></div>
            <button class="btn btn-primary btn-sm" id="seatplan-cta" style="margin-top:16px;width:100%;justify-content:center" disabled>Weiter zur Kasse</button>
          </div>
      </div>
{WISSENSWERTES_HTML}
    </div>
  </section>

  <section class="section bg-subtle">
    <div class="container container-narrow">
      <span class="eyebrow" style="display:block;text-align:center;margin-bottom:6px">Kontakt</span>
      <h2 class="t-h2 text-center mb-5">Fragen zum Ticket?</h2>
      <div class="contact-person-card contact-person-card-centered">
        <div>
          <a href="mailto:tickets@basketball-loewen.com">tickets@basketball-loewen.com</a>
        </div>
      </div>
    </div>
  </section>

  <script src="/js/voucher-utils.js?v=1786873000"></script>
  <script src="/js/seat-picker.js?v=1787760512"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function () {{
      /* Spieldaten liegen fest in dieser Seite -- kein Fetch/?spiel=-Parameter
         mehr noetig, die Seite kennt ihr Spiel bereits (s. tools/build-spieltagsseiten.py). */
      var game = {game_json};
      var eventLabel = 'Basketball Löwen Erfurt – ' + game.gegner + ', {html.escape(lang_datum(parse_dmy(game["datum"])))}';
      var picker = new SeatPicker(document.getElementById('seatplan-root'), {{
        mode: 'blocks',
        nachwuchsBeitrag: true,
        nachwuchsAmount: 2,
        planUrl: '/assets/seating/riethsporthalle-seatingplan.json?v=1786585000',
        seatStatusUrl: {('"https://poetic-patience-production-9290.up.railway.app/webhook/einzelticket-sitzplatz-status?subevent=' + str(game["subeventId"]) + '"') if game.get("subeventId") else "null"},
        pretixEvent: 'saison2627',
        pretixItemCategoryMap: {json.dumps(PRETIX_ITEM_CATEGORY_MAP)},
        reservedSeats: [
          {{ zone: 'A', rows: ['1'], excludeSeatNumbers: ['1', '2', '3', '4', '5', '6', '7', '19', '20'] }}
        ],
        nvSeats: [
          {{ zone: 'A', rows: ['1', '2', '3'], maxSeatNumber: 7 }}
        ],
        northZones: ['D', 'E', 'F'],
        southZones: ['A', 'B', 'C'],
        prices: {{
          'Kategorie I': {{ normal: 16, ermaessigt: 14 }},
          'Kategorie II': {{ normal: 12, ermaessigt: 8.5 }},
          'Kategorie III': {{ normal: 10.5, ermaessigt: 8, kind: 5 }},
          'Fanblock': {{ normal: 10.5, ermaessigt: 8 }},
          'C unten': {{ normal: 12, ermaessigt: 8.5 }},
          'Rollstuhlplatz': {{ normal: 8 }},
          'VIP': {{ normal: 119 }}
        }},
        standingPrice: 8,
        standingBookable: game.stehplatzBuchbar !== false,
        cartEl: document.getElementById('seatplan-cart'),
        totalEl: document.getElementById('seatplan-total'),
        ctaEl: document.getElementById('seatplan-cta'),
        occupancyEl: document.getElementById('seatplan-occupancy')
      }});

      document.getElementById('seatplan-cta').addEventListener('click', function () {{
        var summary = picker.getSummary();
        sessionStorage.setItem('bl_cart', JSON.stringify({{
          productType: 'einzelticket',
          eventLabel: eventLabel,
          pretixEventSlug: 'saison2627',
          pretixSubeventId: game.subeventId,
          spielDatum: game.datum,
          gegner: game.gegner,
          lines: summary.lines,
          total: summary.total,
          voucher: summary.voucher,
          notiz: summary.notiz,
          zahlungPausiert: game.zahlungPausiert
        }}));
        window.location.href = '/tickets/checkout.html';
      }});
    }});
  </script>
"""


def angekuendigt_section(game, d):
    return f"""  <section class="section">
    <div class="container">
      <span class="eyebrow" style="display:block;margin-bottom:16px">Heimspiel-Infos</span>
      <div class="grid-3">
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="calendar"></i></div>
            <h3 class="t-h4">Termin</h3>
          </div>
          <p class="t-body-sm">{html.escape(lang_datum(d))} · {html.escape(game["zeit"])} Uhr</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="map-pin"></i></div>
            <h3 class="t-h4">Halle</h3>
          </div>
          <p class="t-body-sm"><a href="{RIETHSPORTHALLE_MAPS_URL}" target="_blank" rel="noopener">Riethsporthalle, Essener Straße 20, 99089 Erfurt</a></p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="ticket"></i></div>
            <h3 class="t-h4">Vorverkauf</h3>
          </div>
          <p class="t-body-sm">Der Ticketverkauf für dieses Spiel hat noch nicht begonnen — wir kündigen den Start rechtzeitig hier und über unsere Kanäle an. Mit der <a href="/tickets/dauerkarte.html">Dauerkarte</a> sicherst du dir schon jetzt einen festen Platz für die ganze Saison.</p>
        </div>
      </div>
    </div>
  </section>
"""


def spieltag_zusatz_section():
    return """  <section class="section bg-subtle">
    <div class="container">
      <span class="eyebrow" style="display:block;margin-bottom:16px">Heute ist Spieltag</span>
      <div class="grid-3">
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="car"></i></div>
            <h3 class="t-h4">Anfahrt</h3>
          </div>
          <p class="t-body-sm"><a href="%s" target="_blank" rel="noopener">Riethsporthalle, Essener Straße 20, 99089 Erfurt</a> — Anfahrt per Auto oder ÖPNV, Parkplätze direkt an der Halle.</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="door-open"></i></div>
            <h3 class="t-h4">Einlass</h3>
          </div>
          <p class="t-body-sm">Die Türen öffnen eine Stunde vor Spielbeginn.</p>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="party-popper"></i></div>
            <h3 class="t-h4">Rahmenprogramm</h3>
          </div>
          <p class="t-body-sm">Details zum Rahmenprogramm folgen kurzfristig.</p>
        </div>
      </div>
    </div>
  </section>
""" % RIETHSPORTHALLE_MAPS_URL


def bericht_section(bericht_inhalt):
    return f"""  <section class="section">
    <div class="container container-narrow">
      <span class="eyebrow" style="display:block;margin-bottom:16px">Ergebnis &amp; Bericht</span>
<!--BERICHT:auto-->
{bericht_inhalt}
      <!--/BERICHT:auto-->
    </div>
  </section>
"""


def build_page(game, phase, bericht_inhalt, header_html=LEER_HEADER, footer_html=LEER_FOOTER, seo_block=LEER_SEO):
    d = parse_dmy(game["datum"])
    gegner = html.escape(game["gegner"])
    url = f"https://basketball-loewen.com/saison/profis/gameday/{game['seiteSlug']}.html"

    phase_label = {
        "angekuendigt": "Angekündigt",
        "vorverkauf": "Vorverkauf läuft",
        "spieltag": "Heute Spieltag",
        "danach": "Ergebnis & Bericht",
    }[phase]

    if phase == "danach":
        description = f"Ergebnis und Spielbericht: Basketball Löwen Erfurt gegen {game['gegner']} am {game['datum']}."
        lead = f"{lang_datum(d)} · {game['zeit']} Uhr · Riethsporthalle"
    elif phase == "spieltag":
        description = f"Heute Heimspiel: Basketball Löwen Erfurt gegen {game['gegner']} in der Riethsporthalle."
        lead = f"Heute, {game['zeit']} Uhr · Riethsporthalle"
    elif phase == "vorverkauf":
        description = f"Tickets für Basketball Löwen Erfurt gegen {game['gegner']} am {game['datum']} — Saalplan, Preise, Kategorien."
        lead = f"{lang_datum(d)} · {game['zeit']} Uhr · Riethsporthalle"
    else:
        description = f"Heimspiel gegen {game['gegner']} am {game['datum']} in der Riethsporthalle. Alle Infos zum Spieltag."
        lead = f"{lang_datum(d)} · {game['zeit']} Uhr · Riethsporthalle"

    sections = []
    if phase == "angekuendigt":
        sections.append(angekuendigt_section(game, d))
    if phase in ("vorverkauf", "spieltag"):
        sections.append(kauf_section(game))
    if phase == "spieltag":
        sections.append(spieltag_zusatz_section())
    if phase == "danach":
        sections.append(bericht_section(bericht_inhalt))

    main_content = "\n".join(sections)

    # Phase "angekuendigt" heisst: Spiel steht im Kalender, der Vorverkauf ist
    # aber noch nicht offen. Diese Seiten tragen nur Gegner, Datum und den
    # Hinweis "Vorverkauf noch nicht begonnen" -- rund 60 Woerter, von denen die
    # Haelfte auf allen dreizehn Seiten identisch ist. Google sieht darin
    # Beinah-Dubletten und indexiert davon typisch eine. Auf Markos Ansage
    # (26.08.2026) bleiben sie deshalb bis zum Vorverkaufsstart auf noindex; die
    # Sichtbarkeit traegt in der Zeit der immergruene Gameday-Hub. Sobald eine
    # ticketUrl gesetzt ist, wechselt die Phase und die Seite wird von sich aus
    # indexierbar -- kein zusaetzlicher Handgriff, und build-sitemap.py nimmt sie
    # dann automatisch auf.
    robots = ('<!-- noindex: Vorverkauf noch nicht offen, die Seite traegt bis dahin zu\n'
              '     wenig eigenen Inhalt (s. Kommentar in tools/build-spieltagsseiten.py).\n'
              '     Faellt automatisch weg, sobald data/heimspiele.json eine ticketUrl hat. -->\n'
              '<meta name="robots" content="noindex" />\n') if phase == "angekuendigt" else ""

    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>{gegner} — Basketball Löwen Erfurt</title>
<meta name="description" content="{html.escape(description)}" />
{robots}<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/css/colors_and_type.css?v=1785398309" />
<link rel="stylesheet" href="/css/site.css?v=1787752095" />
<link rel="stylesheet" href="/css/seat-picker.css?v=1787760512" />
<script data-goatcounter="https://goatcounter-production-5d8c.up.railway.app/count"
        async src="//goatcounter-production-5d8c.up.railway.app/count.js"></script>
<!-- ANALYTICS:ahrefs — Vergleichstest neben GoatCounter, gestartet 25.08.2026.
     Cookiefrei, kein Zugriff auf den Endgeraetespeicher (im Skript geprueft:
     kein localStorage, kein Cookie). Empfaenger Ahrefs Pte Ltd, Singapur;
     Standardvertragsklauseln Modul 2 am 25.08.2026 abgeschlossen, Abschnitt 4
     der Datenschutzerklaerung. Entfernen: Block zwischen den beiden Markern
     loeschen, in allen Seiten. -->
<script src="https://analytics.ahrefs.com/analytics.js" data-key="5TVH543YAI/GzTMbTLbbbg" async></script>
<!--/ANALYTICS:ahrefs-->
{seo_block}</head>
<body data-nav-group="saison" class="hide-mobile-cta">
<a class="skip-link" href="#main">Zum Inhalt springen</a>
{header_html}
<main id="main">
  <section class="hero-photo hero-tickets hero-half">
    <div class="container">
      <div class="hero-lg-grid">
        <div>
          <span class="eyebrow">Heimspiel Basketball Löwen Erfurt · {phase_label}</span>
          <h1 class="nowrap-lg" style="font-size:clamp(20px,5vw,56px)"><span class="kw">{gegner}<span class="swoosh" aria-hidden="true"></span></span>.</h1>
          <p class="lead">{html.escape(lead)}</p>
          <a class="hero-location" href="{RIETHSPORTHALLE_MAPS_URL}" target="_blank" rel="noopener"><i data-lucide="map-pin" class="icon-16"></i> Riethsporthalle, Essener Straße 20, 99089 Erfurt</a>
        </div>
        <div style="display:flex;align-items:center;justify-content:center">
          <a class="btn btn-primary" href="/tickets/dauerkarte.html">Dauerkarte kaufen und festen Platz sichern</a>
        </div>
      </div>
    </div>
  </section>

{main_content}
</main>
{footer_html}
<script src="/js/vendor/lucide-icons.js?v=1787766492"></script>
<script src="/js/nav.js?v=1787760037"></script>
<script src="/js/include.js?v=1785398309"></script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    daten = json.loads(QUELLE.read_text(encoding="utf-8"))
    daten = sichere_seitenslugs(daten)
    today = datetime.now(BERLIN).date()

    ZIEL_DIR.mkdir(parents=True, exist_ok=True)
    geschrieben, unveraendert = [], []
    for game in daten["spiele"]:
        phase = phase_of(game, today)
        pfad = ZIEL_DIR / f"{game['seiteSlug']}.html"
        bericht = extract_bericht(pfad)
        header_html = extract_platzhalter(pfad, "header", LEER_HEADER)
        footer_html = extract_platzhalter(pfad, "footer", LEER_FOOTER)
        seo_block = extract_seo_block(pfad)
        neu = build_page(game, phase, bericht, header_html, footer_html, seo_block)
        alt = pfad.read_text(encoding="utf-8") if pfad.exists() else None
        if neu == alt:
            unveraendert.append((game["seiteSlug"], phase))
            continue
        geschrieben.append((game["seiteSlug"], phase))
        if not args.check:
            pfad.write_text(neu, encoding="utf-8")

    for slug, phase in geschrieben:
        print(f"  {'zu bauen' if args.check else 'geschrieben'}: {slug} ({phase})")
    print(f"\n  {len(geschrieben)} Seiten {'zu ändern' if args.check else 'geschrieben'}, "
          f"{len(unveraendert)} unverändert")
    return 1 if (args.check and geschrieben) else 0


if __name__ == "__main__":
    sys.exit(main())
