#!/usr/bin/env python3
"""Baut den immergrünen Gameday-Hub: saison/profis/gameday/index.html

Warum diese Seite existiert — und warum an genau dieser Adresse:

Die Vorgänger-Agentur hatte unter `/saison/profis/gameday/` eine Seite, die
immer das aktuelle Heimspiel zeigte. Sie liefert seit Wochen 404 und sammelt
**trotzdem 474 Impressionen pro Woche** und Platz 4 für „riethsporthalle"
(2.400 Suchen im Monat) — so viel Alter, Links und Klickhistorie hat eine
immergrüne Adresse über Jahre gebündelt. Deshalb wurde der Bereich am
26.08.2026 von `teams-saison/` in `saison/` umbenannt: Der Hub besetzt die
historische Adresse wieder, ohne Weiterleitung (die es laut Markos Entscheidung
nicht gibt).

Die vierzehn Spieltagsseiten können das nicht leisten. Jede fängt bei null an,
teilt den internen Linkfluss durch vierzehn, und ihr Thema ist nach dem Spiel
vorbei. Der Hub sammelt die Autorität, die Spieltagsseiten tragen Detail und
Lebenszyklus. Beides zusammen, nicht das eine statt des anderen.

Bauart wie tools/build-spieltagsseiten.py: Die Seite wird bei jedem Lauf
komplett neu geschrieben, weil sich „das nächste Heimspiel" täglich ändern kann.
Header, Footer und der SEO:auto-Block werden unverändert aus der bestehenden
Datei übernommen — sonst würde jeder Lauf zunichtemachen, was build-partials.py
und build-head-meta.py zuletzt eingetragen haben. Das Skript muss deshalb **vor**
build-partials.py laufen.

Aufruf:
  python3 tools/build-gameday-hub.py
  python3 tools/build-gameday-hub.py --check    # schreibt nichts
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

from seo_common import attr as esc
from seo_common import gcal_link
from seo_common import ziel_url

REPO = Path(__file__).resolve().parent.parent
QUELLE = REPO / "data" / "heimspiele.json"
ZIEL = REPO / "saison" / "profis" / "gameday" / "index.html"

WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
          "Juli", "August", "September", "Oktober", "November", "Dezember"]

# Gleiche Adresse wie RIETHSPORTHALLE_MAPS_URL in js/spielplan.js.
MAPS = ("https://www.google.com/maps/search/?api=1&amp;query="
        "Essener+Stra%C3%9Fe+20%2C+99089+Erfurt")

LEER_HEADER = '<div id="site-header-placeholder"></div>'
LEER_FOOTER = '<div id="site-footer-placeholder"></div>'

SEO_START = "<!-- SEO:auto START"
SEO_ENDE = "<!-- SEO:auto END -->"


def spiele():
    daten = json.loads(QUELLE.read_text(encoding="utf-8"))
    liste = [s for s in daten.get("spiele", []) if s.get("seiteSlug")]
    if not liste:
        raise SystemExit("data/heimspiele.json: kein Spiel mit seiteSlug")
    liste.sort(key=lambda s: datum(s))
    return liste


def datum(s):
    tag, monat, jahr = (int(x) for x in s["datum"].split("."))
    return date(jahr, monat, tag)


def lang_datum(s):
    d = datum(s)
    return f"{WOCHENTAGE[d.weekday()]}, {d.day}. {MONATE[d.month - 1]} {d.year}"


def kurz_datum(s):
    d = datum(s)
    return f"{WOCHENTAGE[d.weekday()][:2]}, {s['datum']}"


def naechstes(liste, heute):
    """Das nächste Heimspiel — heute zählt noch dazu.

    Ist die Saison vorbei, bleibt das letzte Spiel stehen statt einer leeren
    Seite. Der Hub soll nie inhaltslos sein; er ist die Adresse, die rankt.
    """
    kuenftig = [s for s in liste if datum(s) >= heute]
    return (kuenftig[0], True) if kuenftig else (liste[-1], False)


def hero(s, kommt):
    zeit = s.get("zeit")
    zeile = lang_datum(s) + (f" · {zeit} Uhr" if zeit else "")
    label = "Nächstes Heimspiel" if kommt else "Letztes Heimspiel der Saison"
    knopf = (f'<a class="btn btn-primary" href="{esc(ziel_url(s))}">Tickets und alle Infos zum Spiel</a>'
             if s.get("ticketUrl") else
             f'<a class="btn btn-primary" href="{esc(ziel_url(s))}">Alle Infos zum Spiel</a>')
    # Zeit- und Ort-Zeile getrennt, Kalenderlink vorn in der Zeit-Zeile (Marko,
    # 27.08.2026) -- wie auf den Spieltagsseiten, hier aber mit ausgeschriebenem
    # Wochentag statt abgekuerzt (lang_datum() liefert den bereits so).
    kalender_link = gcal_link(s["gegner"], datum(s), zeit) if zeit else None
    zeit_zeile = (
        f'<p class="lead"><a href="{kalender_link}" target="_blank" rel="noopener" '
        f'title="Ins Kalender eintragen" style="display:inline-flex;vertical-align:middle;color:inherit">'
        f'<i data-lucide="calendar-plus" class="icon-16"></i></a> {esc(zeile)}</p>'
        if kalender_link else f'<p class="lead">{esc(zeile)}</p>'
    )
    return f"""  <section class="hero-photo hero-tickets hero-half">
    <div class="container">
      <div class="hero-lg-grid">
        <div>
          <span class="eyebrow">{label} · Basketball Löwen Erfurt</span>
          <h1 class="nowrap-lg" style="font-size:clamp(20px,5vw,56px)"><span class="kw">{esc(s['gegner'])}<span class="swoosh" aria-hidden="true"></span></span>.</h1>
          {zeit_zeile}
          <a class="hero-location" href="{MAPS}" target="_blank" rel="noopener"><i data-lucide="map-pin" class="icon-16"></i> Riethsporthalle, Essener Straße 20, 99089 Erfurt</a>
        </div>
        <div style="display:flex;align-items:center;justify-content:center">
          {knopf}
        </div>
      </div>
    </div>
  </section>"""


def halle():
    """Die Halle als eigener Abschnitt — der Grund, warum diese Seite für
    „riethsporthalle" ranken kann (2.400 Suchen im Monat, wir auf Platz 4).

    Der Blockplan ist derselbe wie auf den Spieltagsseiten und der Dauerkarte
    (js/seat-picker.js, Nur-Ansicht): eine zweite, eigene Darstellung derselben
    Halle würde auseinanderlaufen, sobald sich ein Block ändert. Das alte Bild
    assets/img/riethsporthalle-blockplan.webp stammt aus der Zeit vor dem
    Redesign und ist damit hier raus.

    Weil der Plan JavaScript braucht, steht die Blockaufteilung zusätzlich als
    Text da — das ist der Teil, den eine Suchmaschine liest, und genau die
    Lücke, die auf dieser Seite schon mehrfach aufgefallen ist.

    Bewusst ohne Anfahrt, Straßenbahnlinie und Parken: Diese Angaben stehen
    nirgends im Repo, und erfundene Verkehrsangaben auf einer Vereinsseite sind
    schlimmer als keine. Sobald Marko sie liefert, gehören sie hierher.

    seatplan-root steckt seit 27.08.2026 in einem max-width:480px-Wrapper --
    ungebremst war der Blockplan hier ~870px hoch und schob die Preisboxen aus
    termine() weit nach unten. Aenderung an dieser Stelle immer synchron mit der
    Handfassung in saison/profis/gameday/index.html halten.
    """
    return """  <section class="section">
    <div class="container container-narrow">
      <div class="section-head">
        <div class="head-text" style="max-width:none">
          <span class="eyebrow">Die Halle</span>
          <h2 class="t-h2">Riethsporthalle Erfurt</h2>
        </div>
      </div>
      <p class="t-body">Alle Heimspiele der Basketball Löwen finden in der Riethsporthalle im
      Erfurter Norden statt — die Profis in der Pro B, die Löwinnen in der Regionalliga und die
      U19 in der NBBL. Wer zu einem Löwen-Heimspiel geht, geht hierher.</p>
      <a class="freiplatz-adresse-link mt-4" href="__MAPS__" target="_blank" rel="noopener"><i data-lucide="map-pin" class="icon-16"></i> Essener Straße 20, 99089 Erfurt</a>
      <div style="max-width:480px;margin:0 auto"><div id="seatplan-root" class="mt-5"></div></div>
      <p class="t-body mt-5">Auf der einen Seite des Spielfelds liegen die <strong>Blöcke D, E und
      F</strong>, gegenüber die <strong>Blöcke A, B und C</strong>. Mittig zum Spielfeld sitzt man
      in <strong>Kategorie 1</strong> — das sind Block E und die Reihen 6 bis 12 von Block B.
      <strong>Kategorie 2</strong> sind die Blöcke D und F sowie die Reihen 6 bis 12 von Block C,
      <strong>Kategorie 3</strong> die Reihen 6 bis 12 von Block A. Direkt am Parkett stehen die
      fünf vorderen Reihen: der <strong>Fanblock</strong> vor Block A, <strong>Courtside</strong>
      vor Block C und der <strong>VIP-Bereich</strong> vor Block B. Dazu kommen 248
      <strong>Stehplätze</strong> an der Längsseite. <strong>Rollstuhlplätze</strong> gibt es in
      Reihe 6 der Blöcke D, E und F und in Reihe 1 von Block A, jeweils mit Begleitkarte.</p>
      <p class="t-body-sm mt-3" style="color:var(--text-secondary)">Welcher Platz noch frei ist,
      siehst du beim Kauf auf der Seite des jeweiligen Spiels.</p>
      <p class="mt-5"><a class="card-link" href="/trainieren/freiplatz/riethsporthalle.html">Der Freiplatz an der Riethsporthalle <i data-lucide="arrow-right" class="icon-14"></i></a></p>
    </div>
  </section>""".replace("__MAPS__", MAPS)


def termine(liste, aktuelles):
    """Die weiteren Heimspiele — mit den Preisboxen als zweite Spalte.

    Struktur seit dem 27.08.2026 von Hand umgebaut (Commits rund um die
    Nav-Umstellung): Die Preisboxen sitzen nicht mehr in einem eigenen
    Abschnitt darunter, sondern als `aside` im `ticket-layout` neben der
    Spielliste — dasselbe Muster wie auf tickets.html. Dieser Generator war
    danach eine Version hinterher und hätte die Handarbeit beim nächsten Lauf
    stillschweigend überschrieben; genau das ist am 27.08. einmal passiert und
    wurde zurückgesetzt. Deshalb ist die Handfassung hier die Vorlage.

    Der Gegner-Name ist der Ankertext — genau danach wird gesucht, und er ist
    mehr wert als „mehr erfahren".

    Preisboxen und Erklärfenster sind wortgleich von tickets.html übernommen.
    Ändern sich dort Preise oder Rabatte, muss es hier mit.
    """
    zeilen = []
    for s in liste:
        if s["seiteSlug"] == aktuelles["seiteSlug"]:
            continue
        zeit = f" · {s['zeit']} Uhr" if s.get("zeit") else ""
        zeilen.append(
            '            <div class="ticket-row">'
            '<div>'
            f'<div class="ticket-row-title"><strong>{esc(kurz_datum(s))}</strong>{esc(zeit)} · '
            f'<a href="{esc(ziel_url(s))}">Löwen gegen {esc(s["gegner"])}</a></div>'
            '</div>'
            f'<div class="tactions"><a class="btn btn-outline-orange btn-sm" href="{esc(ziel_url(s))}">'
            'Zum Spiel <i data-lucide="arrow-right" class="icon-14"></i></a></div>'
            '</div>'
        )
    if not zeilen:
        return ""
    return TERMINE_VORLAGE.replace("__ZEILEN__", "\n".join(zeilen))


TERMINE_VORLAGE = '  <section class="section bg-subtle">\n    <div class="container">\n      <div class="section-head">\n        <div class="head-text" style="max-width:none">\n          <span class="eyebrow">Saison 2026/2027</span>\n          <h2 class="t-h2">Die weiteren Heimspiele</h2>\n          <p class="t-body mt-3">Vierzehn Heimspiele von Oktober bis März. Jedes hat seine eigene\n          Seite — vor dem Spiel mit Vorbericht und Kartenkauf, danach mit Ergebnis und Bericht.</p>\n        </div>\n      </div>\n      <div class="ticket-layout mt-5">\n        <div>\n          <div class="ticket-list">\n__ZEILEN__\n          </div>\n          <p class="mt-5"><a class="card-link" href="/saison/spielplan.html">Der komplette Spielplan mit Auswärtsspielen <i data-lucide="arrow-right" class="icon-14"></i></a></p>\n        </div>\n\n        <aside style="display:flex;flex-direction:column;gap:20px">\n          <div class="ticket-sidebar" style="position:static">\n            <div>\n              <span class="eyebrow">Preis pro Saison</span>\n              <h3 class="t-h4" style="margin:6px 0 8px">Dauerkarte</h3>\n              <div style="display:flex;gap:8px;flex-wrap:wrap">\n                <button type="button" class="badge badge-orange" id="overview-member-badge" style="border:none;cursor:pointer;font-family:inherit">\n                  -30 % Mitglieder des Basketball Löwen e.V.\n                </button>\n                <button type="button" class="badge badge-orange" id="overview-discount-badge" style="border:none;cursor:pointer;font-family:inherit">\n                  -20 % Frühbucher bis 31.08.\n                </button>\n              </div>\n            </div>\n            <p class="t-body-sm" style="margin:12px 0">Mit der Dauerkarte sicherst du dir deinen festen Platz für die ganze Saison — Spiel für Spiel derselbe Blick aufs Parkett.</p>\n            <div class="price-row"><span>Kategorie 1</span><strong>208,00 €</strong></div>\n            <div class="price-row"><span>Kategorie 1 (ermäßigt)</span><strong>182,00 €</strong></div>\n            <div class="price-row"><span>Kategorie 2</span><strong>156,00 €</strong></div>\n            <div class="price-row"><span>Kategorie 2 (ermäßigt)</span><strong>115,00 €</strong></div>\n            <div class="price-row"><span>VIP</span><strong>1.000,00 €</strong></div>\n            <a class="btn btn-primary btn-sm" style="margin-top:12px;width:100%;justify-content:center" href="/tickets/dauerkarte.html">Dauerkarte kaufen</a>\n          </div>\n          <div class="ticket-sidebar" style="position:static">\n            <span class="eyebrow">Preis pro Spiel</span>\n            <h3 class="t-h4" style="margin:6px 0 14px">Einzelticket</h3>\n            <p class="t-body-sm mb-3">Bei Einzeltickets wählst du deine Kategorie, nicht mehr deinen festen Platz — den sicherst du dir mit der Dauerkarte. Preise und Sitzplatzwahl stehen auf der Seite des jeweiligen Spiels.</p>\n            <div class="price-row"><span>Kategorie 1</span><strong>16,00 €</strong></div>\n            <div class="price-row"><span>Kategorie 1 (ermäßigt)</span><strong>14,00 €</strong></div>\n            <div class="price-row"><span>Kategorie 2</span><strong>12,00 €</strong></div>\n            <div class="price-row"><span>Kategorie 2 (ermäßigt)</span><strong>8,50 €</strong></div>\n          </div>\n        </aside>\n      </div>\n\n      <div class="modal-backdrop" id="overview-discount-modal-backdrop">\n        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="overview-discount-modal-title">\n          <button class="modal-close" aria-label="Schließen" id="overview-discount-modal-close"><i data-lucide="x"></i></button>\n          <div class="modal-icon"><i data-lucide="percent"></i></div>\n          <span class="eyebrow" id="overview-discount-modal-title">Frühbucherrabatt</span>\n          <h3 class="t-h3" style="margin:8px 0 12px">Je früher, desto günstiger.</h3>\n          <p class="t-body-sm">Bestellst du bis zum 31.08.2026, sparst du 20&nbsp;%. Ab dem 01.09.2026 gilt der reguläre Preis.</p>\n          <p class="t-body-sm mt-3">Die hier angezeigten Preise enthalten den Rabatt bereits automatisch bis zum Stichtag.</p>\n        </div>\n      </div>\n\n      <div class="modal-backdrop" id="overview-member-modal-backdrop">\n        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="overview-member-modal-title">\n          <button class="modal-close" aria-label="Schließen" id="overview-member-modal-close"><i data-lucide="x"></i></button>\n          <div class="modal-icon"><i data-lucide="percent"></i></div>\n          <span class="eyebrow" id="overview-member-modal-title">Mitgliedsrabatt</span>\n          <h3 class="t-h3" style="margin:8px 0 12px">Dauerhaft 30 % für Mitglieder des Basketball Löwen e.V.</h3>\n          <p class="t-body-sm">Mitglieder des Basketball Löwen e.V. erhalten dauerhaft 30&nbsp;% Rabatt auf die Dauerkarte.</p>\n          <p class="t-body-sm mt-3">Mitglieder unserer Kooperationsvereine (BC Erfurt, USV Erfurt, BIG Gotha) erhalten bei der Dauerkarte stattdessen den ermäßigten Satz.</p>\n          <p class="t-body-sm mt-3">Bis zum 31.08.2026 lässt sich der Mitgliedsrabatt mit dem Frühbucherrabatt kombinieren — macht zusammen 50&nbsp;% Rabatt. Ab dem 01.09.2026 gilt nur noch der Mitgliedsrabatt von 30&nbsp;%.</p>\n          <p class="t-body-sm mt-3">Nachweis der Mitgliedschaft beim Kauf erforderlich.</p>\n        </div>\n      </div>\n    </div>\n  </section>'


def uebernehmen(muster, leer):
    """Header-, Footer- oder SEO-Block aus der bestehenden Datei retten.

    Gleiche Begruendung wie in build-spieltagsseiten.py: Dieses Skript baut die
    Seite komplett neu. Ohne diese Funktion setzt jeder Lauf zurueck, was
    build-partials.py und build-head-meta.py eingetragen haben.
    """
    if not ZIEL.exists():
        return leer
    t = ZIEL.read_text(encoding="utf-8")
    m = re.search(muster, t, re.S)
    return m.group(0) if m else leer


def seite(liste, heute):
    aktuell, kommt = naechstes(liste, heute)
    zeit = f", {aktuell['zeit']} Uhr" if aktuell.get("zeit") else ""
    description = (f"Nächstes Heimspiel der Basketball Löwen Erfurt: gegen {aktuell['gegner']} "
                   f"am {aktuell['datum']}{zeit} in der Riethsporthalle. Tickets & Dauerkarte.")
    if len(description) > 155:
        description = (f"Heimspiele der Basketball Löwen Erfurt in der Riethsporthalle: "
                       f"nächster Gegner {aktuell['gegner']} am {aktuell['datum']}. Tickets & Dauerkarte.")

    # rstrip, damit der zweite Lauf dasselbe Ergebnis liefert: das \s* der Regex
    # zieht sonst den Zeilenumbruch mit, den die Vorlage selbst schon setzt, und
    # die Datei waechst bei jedem Lauf um eine Leerzeile.
    header = uebernehmen(r'<div id="site-header-placeholder">.*?</div>\s*(?=<main|\Z)', LEER_HEADER).rstrip()
    footer = uebernehmen(r'<div id="site-footer-placeholder">.*?</div>\s*(?=<script|\Z)', LEER_FOOTER).rstrip()
    seo = uebernehmen(re.escape(SEO_START) + r".*?" + re.escape(SEO_ENDE), "")
    if seo:
        seo += "\n"

    inhalt = "\n\n".join(x for x in [
        hero(aktuell, kommt), halle(), termine(liste, aktuell),
    ] if x)

    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>Game Day und Tickets — Basketball Löwen Erfurt</title>
<meta name="description" content="{esc(description)}" />
<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/css/colors_and_type.css?v=1785398309" />
<link rel="stylesheet" href="/css/site.css?v=1787846983" />
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
{seo}</head>
<body data-nav-group="saison" class="hide-mobile-cta">
<a class="skip-link" href="#main">Zum Inhalt springen</a>
{header}
<main id="main">
{inhalt}
</main>
{footer}
<script src="/js/seat-picker.js?v=1787760512"></script>
<script>
  /* Blockplan in der Nur-Ansicht: derselbe Plan wie auf den Spieltagsseiten, aber ohne
     Warenkorb und ohne Klick (readonly, s. js/seat-picker.js). Diese Seite gehoert keinem
     Spiel, deshalb bewusst kein seatStatusUrl -- ein Belegungsstand ohne Spiel waere
     erfunden. Preise stehen hier nur, weil der Plan daran erkennt, welche Bereiche
     ueberhaupt eigene Kacheln bekommen; angezeigt wird in dieser Ansicht keiner. */
  document.addEventListener('DOMContentLoaded', function () {{
    new SeatPicker(document.getElementById('seatplan-root'), {{
      mode: 'blocks',
      readonly: true,
      headline: 'Die Bl\u00f6cke in der Riethsporthalle',
      planUrl: '/assets/seating/riethsporthalle-seatingplan.json?v=1786585000',
      northZones: ['D', 'E', 'F'],
      southZones: ['A', 'B', 'C'],
      prices: {{
        'Kategorie I': {{ normal: 16 }},
        'Kategorie II': {{ normal: 12 }},
        'Kategorie III': {{ normal: 10.5 }},
        'Fanblock': {{ normal: 10.5 }},
        'C unten': {{ normal: 12 }},
        'VIP': {{ normal: 119 }}
      }}
    }});

    /* Rabatt-Erklaerfenster, wortgleich wie in tickets.html. */
    function wireBadgeModal(badgeId, backdropId, closeId) {{
      var backdrop = document.getElementById(backdropId);
      document.getElementById(badgeId).addEventListener('click', function () {{ backdrop.classList.add('open'); }});
      document.getElementById(closeId).addEventListener('click', function () {{ backdrop.classList.remove('open'); }});
      backdrop.addEventListener('click', function (e) {{ if (e.target === backdrop) backdrop.classList.remove('open'); }});
    }}
    wireBadgeModal('overview-discount-badge', 'overview-discount-modal-backdrop', 'overview-discount-modal-close');
    wireBadgeModal('overview-member-badge', 'overview-member-modal-backdrop', 'overview-member-modal-close');
    document.addEventListener('keydown', function (e) {{
      if (e.key !== 'Escape') return;
      ['overview-discount-modal-backdrop', 'overview-member-modal-backdrop'].forEach(function (id) {{
        document.getElementById(id).classList.remove('open');
      }});
    }});
  }});
</script>
<script src="/js/vendor/lucide-icons.js?v=1787766492"></script>
<script src="/js/nav.js?v=1787760037"></script>
<script src="/js/include.js?v=1785398309"></script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="nur berichten, nichts schreiben")
    args = ap.parse_args()

    liste = spiele()
    heute = date.today()
    aktuell, kommt = naechstes(liste, heute)
    neu = seite(liste, heute)
    alt = ZIEL.read_text(encoding="utf-8") if ZIEL.exists() else None

    hinweis = f"nächstes Heimspiel: {aktuell['gegner']} am {aktuell['datum']}"
    if not kommt:
        hinweis = f"Saison vorbei, letztes Spiel: {aktuell['gegner']} am {aktuell['datum']}"

    if neu == alt:
        print(f"  unverändert ({hinweis})")
        return 0
    if args.check:
        print(f"  zu ändern ({hinweis})")
        return 1
    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    ZIEL.write_text(neu, encoding="utf-8")
    print(f"  geschrieben ({hinweis})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
