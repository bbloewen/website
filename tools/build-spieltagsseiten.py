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

Aufbau seit 11.10.2026 (mit Marko abgestimmt): Der Hero traegt Termin, Halle, Tickets
und eine Linkzeile (Livestream/Replay, Vereinsseite des Gegners). Darunter, je nach
Daten in data/heimspiele.json: Endstand + Viertelstaende ("ergebnis": "71 : 95",
"viertel": ["20 : 25", ...], Boxscore-Link: "livescore"), Gegner im Ueberblick (Vereinsseite, Liga-Kader per ligaId, Hinspiel-Ergebnis), Teaser-Karten fuer Nachbericht
("nachberichtUrl") und Vorbericht ("vorberichtUrl") -- Titel, Text und Bild kommen aus
data/news.json --, das Spieltagsinfo-Band ("spieltagsinfo") und Zurueck/Weiter zwischen den
Heimspielen. Die frueheren Heimspiel-Infos-Kacheln (Termin/Halle/Tickets) entfallen.

Der Ticketkauf selbst (Saalplan/Kategorien/Kasse) lebt seit 27.08.2026 nicht
mehr hier, sondern auf dem Gameday-Hub (tools/build-gameday-hub.py): weil
ohnehin immer nur für ein Spiel gleichzeitig der Verkauf offen ist, ist der Hub
in dem Moment schon die Kaufseite -- eine zusätzliche Spieltagsseite dafür war
nur ein Umweg. Diese Seite hier zeigt vor dem Spiel nur noch, ob und wo gekauft
werden kann, und verweist dafür auf den Hub.

Bericht-Block: redaktioneller Inhalt (Ergebnis, Rückblick, Impressionen), den
dieses Skript NIE überschreibt. Bei jedem Lauf wird die Seite komplett neu
zusammengesetzt (Phase kann sich geändert haben), aber der Inhalt des
<!--BERICHT:auto-->...<!--/BERICHT:auto-->-Blocks wird vor dem Neubau aus der
bestehenden Datei ausgelesen und unverändert wieder eingesetzt. Nur bei der
allerersten Erzeugung einer Seite steht dort ein Platzhalter.

Dasselbe gilt für Abschnitte mit `<section class="gameday-extra">` zwischen Hero
und Heimspiel-Infos: wer an diesem Spieltag zu Gast ist, welche Aktion läuft.
Sie werden von Hand gepflegt, nicht aus data/heimspiele.json erzeugt, und von
extract_gameday_extra() gerettet. Wer hier einen weiteren handgepflegten
Abschnitt ergänzt, muss ihn genauso in die Rettung aufnehmen — sonst löscht ihn
der nächste Lauf.

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

from seo_common import REPO, gcal_link

QUELLE = REPO / "data" / "heimspiele.json"
ZIEL_DIR = REPO / "saison" / "profis" / "gameday"
BERLIN = ZoneInfo("Europe/Berlin")

MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
          "August", "September", "Oktober", "November", "Dezember"]
WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

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


def hero_datum(d):
    """Wie lang_datum, aber mit ausgeschriebenem Wochentag davor -- nur für den
    Hero-Lead, z. B. "Sonntag, 11. Oktober 2026". Wortgleich zum Gameday-Hub
    (Marko, 27.08.2026: sollte dort genauso ausgeschrieben sein wie dort).
    lang_datum() bleibt für den Kalender-Event-Text und den Heimspiel-Infos-
    Absatz unveraendert."""
    return f"{WOCHENTAGE[d.weekday()]}, {lang_datum(d)}"


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


GAMEDAY_EXTRA_RE = re.compile(
    r'\n  <section class="gameday-extra[^"]*">.*?\n  </section>\n', re.S)


def extract_gameday_extra(pfad):
    """Handgepflegte Spieltags-Abschnitte retten (Marko, 18.09.2026).

    Auf einzelnen Spieltagsseiten steht zwischen Hero und Heimspiel-Infos ein
    Abschnitt `<section class="gameday-extra">` -- wer an diesem Spieltag zu Gast
    ist, welche Aktion laeuft. Beispiele: "Die Erfurt Crowd ist zu Gast" (SWE
    Stadtwerke) und "Das Erfurter Handwerk ist zu Gast". Diese Abschnitte werden
    von Hand gepflegt, nicht aus data/heimspiele.json erzeugt.

    Ohne diese Funktion loescht sie jeder Lauf: das Skript baut die Seite
    vollstaendig neu, und was es nicht kennt, ist weg. Genau das ist am
    18.09.2026 passiert -- beide Abschnitte mussten aus dem Commit davor
    zurueckgeholt werden.

    Mehrere Abschnitte je Seite sind moeglich; sie werden in der gefundenen
    Reihenfolge wieder eingesetzt, an derselben Stelle wie zuvor.
    """
    if not pfad.exists():
        return ""
    return "".join(GAMEDAY_EXTRA_RE.findall(pfad.read_text(encoding="utf-8")))


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


NEWS_DATEI = REPO / "data" / "news.json"
SPIELTAGSINFO_DATEI = REPO / "data" / "spieltagsinfo.json"


def lade_news():
    """data/news.json als {url: artikel} -- Titel, Teaser und Bild der Vor-/Nachberichte
    kommen von dort, damit sie nirgends doppelt gepflegt werden."""
    daten = json.loads(NEWS_DATEI.read_text(encoding="utf-8"))
    return {a["url"]: a for a in daten.get("artikel", []) if a.get("url")}


def teaser(text, grenze=230):
    """Kurztext an einer Wortgrenze kuerzen (nur wenn noetig)."""
    text = " ".join((text or "").split())
    if len(text) <= grenze:
        return text
    return text[:grenze].rsplit(" ", 1)[0].rstrip(",.;:–- ") + " …"


def bild_masse(pfad):
    """(Breite, Hoehe) einer lokalen Bilddatei, sonst None."""
    try:
        from PIL import Image
        with Image.open(REPO / pfad.lstrip("/")) as im:
            return im.size
    except Exception:
        return None


def hero_links(game, phase):
    """Kleine Linkzeile unter der Halle im Hero: Livestream/Replay und Vereinsseite des
    Gegners (die stand bisher unter den Heimspiel-Infos-Kacheln, die entfallen sind)."""
    links = []
    if game.get("livestream"):
        text = "Zum Replay" if phase == "danach" else "Zum Livestream"
        links.append(('<a class="hero-location" href="%s" target="_blank" rel="noopener">'
                      '<i data-lucide="video" class="icon-16"></i> %s</a>') % (html.escape(game["livestream"]), text))
    if game.get("gegnerUrl"):
        links.append(('<a class="hero-location" href="%s" target="_blank" rel="noopener">'
                      '<i data-lucide="external-link" class="icon-16"></i> %s — zur Vereinsseite</a>')
                     % (html.escape(game["gegnerUrl"]), html.escape(game["gegner"])))
    if not links:
        return ""
    return '          <div class="spiel-hero-links">' + "".join(links) + "</div>\n"


def ergebnis_section(game, phase):
    """Endstand und Viertelstaende (nur nach dem Spiel und wenn ergebnis gepflegt ist).

    data/heimspiele.json: "ergebnis": "71 : 95" (Löwen zuerst, es sind Heimspiele) und
    optional "viertel": ["20 : 25", "18 : 22", "15 : 25", "18 : 23"] (bei Verlaengerung
    ein Eintrag mehr). Boxscore-Link: Feld "livescore".

    Seit 11.10.2026 (Marko: "Viertelstaende schon mal auf die Spieltagsseite"): auch in der
    Phase "spieltag". Ist "viertel" schon gepflegt, "ergebnis" aber noch nicht, steht dort
    ein Zwischenstand (Summe der Viertel) unter der Ueberschrift "Zwischenstand". Erst wenn
    "ergebnis" gesetzt ist, heisst es "Endstand". Quelle der Zahlen: n8n-Workflow
    "Website: Liveticker auswerten" (Feld viertelAusLoewenSicht / ergebnisFuerSpielplan)."""
    if phase not in ("spieltag", "danach"):
        return ""
    viertel = game.get("viertel") or []
    if game.get("ergebnis"):
        stand_titel = "Endstand"
        try:
            heim, gast = [x.strip() for x in game["ergebnis"].split(":")]
        except ValueError:
            return ""
    elif viertel:
        stand_titel = "Zwischenstand"
        try:
            heim = str(sum(int(v.split(":")[0]) for v in viertel))
            gast = str(sum(int(v.split(":")[1]) for v in viertel))
        except ValueError:
            return ""
    else:
        return ""
    gegner = html.escape(game["gegner"])
    tabelle = ""
    if viertel:
        kopf = "".join(
            '<th scope="col"><span class="v-lang">%s</span><span class="v-kurz" aria-hidden="true">%s</span></th>'
            % (('%d. Viertel' % (i + 1)) if i < 4 else 'Verlängerung', ('Q%d' % (i + 1)) if i < 4 else 'OT')
            for i in range(len(viertel)))
        zeile_heim = "".join(f"<td>{html.escape(v.split(':')[0].strip())}</td>" for v in viertel)
        zeile_gast = "".join(f"<td>{html.escape(v.split(':')[1].strip())}</td>" for v in viertel)
        tabelle = (f'<div class="spiel-viertel-wrap"><table class="spiel-viertel"><thead><tr><th></th>{kopf}</tr></thead><tbody>'
                   f'<tr><th scope="row">Basketball Löwen</th>{zeile_heim}</tr>'
                   f'<tr><th scope="row">{gegner}</th>{zeile_gast}</tr></tbody></table></div>')
    knoepfe = []
    if game.get("livescore"):
        knoepfe.append(f'<a class="btn btn-ghost-dark btn-sm" href="{html.escape(game["livescore"])}" target="_blank" rel="noopener">'
                       '<i data-lucide="activity" class="icon-16"></i> Boxscore</a>')
    if game.get("livestream"):
        knoepfe.append(f'<a class="btn btn-ghost-dark btn-sm" href="{html.escape(game["livestream"])}" target="_blank" rel="noopener">'
                       '<i data-lucide="video" class="icon-16"></i> '
                       + ('Replay' if (phase == "danach" or game.get("ergebnis")) else 'Livestream') + '</a>')
    knoepfe_html = f'<div class="spiel-ergebnis-actions">{"".join(knoepfe)}</div>' if knoepfe else ""
    return f"""  <section class="section">
    <div class="container">
      <div class="spiel-ergebnis">
        <span class="eyebrow">{stand_titel}</span>
        <div class="spiel-ergebnis-score" role="img" aria-label="{stand_titel}: Basketball Löwen {html.escape(heim)}, {gegner} {html.escape(gast)}">
          <span class="spiel-ergebnis-team">Basketball Löwen</span>
          <span class="spiel-ergebnis-punkte"><b>{html.escape(heim)}</b><span aria-hidden="true">:</span><b>{html.escape(gast)}</b></span>
          <span class="spiel-ergebnis-team">{gegner}</span>
        </div>
        {tabelle}
        {knoepfe_html}
      </div>
    </div>
  </section>
"""


def artikel_aus_datei(url):
    """Notfall, falls der Artikel noch nicht in data/news.json steht (die Veroeffentlichung
    traegt ihn erst nach der Freigabe ein): Titel und Beschreibung aus dem <head> der Seite."""
    pfad = REPO / url.lstrip("/")
    if not pfad.exists():
        return {}
    text = pfad.read_text(encoding="utf-8")
    t = re.search(r"<title>(.*?)</title>", text, re.S)
    d = re.search(r'<meta name="description" content="(.*?)"\s*/?>', text, re.S)
    titel = re.sub(r"\s*[—–-]\s*Basketball L(ö|oe)wen Erfurt\s*$", "", html.unescape(t.group(1)).strip()) if t else ""
    return {"titel": titel, "kurztext": html.unescape(d.group(1)).strip() if d else ""}


def story_karte(label, url, news):
    a = news.get(url) or artikel_aus_datei(url)
    titel = html.escape(a.get("titel") or label)
    kurz = html.escape(teaser(a.get("kurztext", "")))
    datum = f" · {html.escape(a['datum'])}" if a.get("datum") else ""
    media = ""
    if a.get("bild"):
        masse = bild_masse(a["bild"])
        dims = f' width="{masse[0]}" height="{masse[1]}"' if masse else ""
        media = (f'<div class="spiel-story-media"><img loading="lazy" decoding="async" src="{html.escape(a["bild"])}"{dims} alt="" /></div>')
    return f"""      <a class="card hoverable spiel-story{' spiel-story-ohne-bild' if not media else ''}" href="{html.escape(url)}">
        {media}
        <div class="spiel-story-body">
          <span class="card-label">{label}{datum}</span>
          <h3 class="t-h3">{titel}</h3>
          <p class="t-body">{kurz}</p>
          <span class="card-link">{label} lesen <i data-lucide="arrow-right" class="icon-14"></i></span>
        </div>
      </a>"""


def story_section(game, phase, news):
    """Nachbericht (sobald Feld nachberichtUrl gesetzt ist) und Vorbericht (Feld
    vorberichtUrl) als Teaser-Karten ueber die ganze Breite -- Text und Bild aus news.json."""
    karten = []
    if game.get("nachberichtUrl"):   # gesetzt = Bericht ist da, auch am Spieltag selbst zeigen
        karten.append(story_karte("Nachbericht", game["nachberichtUrl"], news))
    if game.get("vorberichtUrl"):
        karten.append(story_karte("Vorbericht", game["vorberichtUrl"], news))
    if not karten:
        return ""
    return f"""  <section class="section">
    <div class="container">
      <span class="eyebrow" style="display:block;margin-bottom:16px">Zum Spiel</span>
      <div class="spiel-story-liste">
{chr(10).join(karten)}
      </div>
    </div>
  </section>
"""


SAISON_DATEI = REPO / "data" / "spielplan-saison.json"


def hinspiel(game):
    """Fruehere Begegnung mit demselben Gegner (Auswaertsspiel, schon gespielt, Ergebnis gepflegt).

    Quelle: data/spielplan-saison.json (profisAuswaerts), Feld "ergebnis" steht dort als
    "Heim : Gast" -- bei einem Auswaertsspiel also Gegner zuerst."""
    daten = json.loads(SAISON_DATEI.read_text(encoding="utf-8"))
    heute_spiel = parse_dmy(game["datum"])
    for a in daten.get("profisAuswaerts", []):
        if a.get("gegner") == game["gegner"] and a.get("ergebnis") and parse_dmy(a["datum"]) < heute_spiel:
            return a
    return None


def gegner_section(game):
    """Gegner im Ueberblick (Marko, 11.10.2026): immer vorhanden, ohne zusaetzliche Pflege.
    Links zur Vereinsseite (gegnerUrl) und zur Liga-Kaderliste (ligaId, 2basketballbundesliga.de),
    dazu das Ergebnis der ersten Begegnung, sobald es eine gibt."""
    gegner = html.escape(game["gegner"])
    fakten = []
    h = hinspiel(game)
    if h:
        try:
            gast = h["ergebnis"].split(":")
            erg = f'{html.escape(h["gegner"])} {html.escape(gast[0].strip())} : {html.escape(gast[1].strip())} Basketball Löwen'
        except IndexError:
            erg = html.escape(h["ergebnis"])
        ort = f", {html.escape(h['ort'])}" if h.get("ort") else ""
        fakten.append(f"Hinspiel ({html.escape(lang_datum(parse_dmy(h['datum'])))}{ort}): {erg}")
    knoepfe = []
    if game.get("gegnerUrl"):
        knoepfe.append(f'<a class="btn btn-ghost" href="{html.escape(game["gegnerUrl"])}" target="_blank" rel="noopener">'
                       '<i data-lucide="external-link" class="icon-16"></i> Vereinsseite</a>')
    if game.get("ligaId"):
        knoepfe.append(f'<a class="btn btn-ghost" href="https://www.2basketballbundesliga.de/teams/kader/{int(game["ligaId"])}/" target="_blank" rel="noopener">'
                       '<i data-lucide="users" class="icon-16"></i> Kader in der Liga</a>')
    if not knoepfe and not fakten:
        return ""
    fakten_html = "".join(f'<p class="t-body">{f}</p>' for f in fakten)
    return f"""  <section class="section">
    <div class="container">
      <div class="spiel-gegner">
        <div class="spiel-naechstes-text">
          <span class="eyebrow">Gegner im Überblick</span>
          <h2 class="t-h3">{gegner}</h2>
          <p class="t-body">Unser Gegner in der ProB Süd.</p>
          {fakten_html}
        </div>
        <div class="spiel-naechstes-actions">{"".join(knoepfe)}</div>
      </div>
    </div>
  </section>
"""


def spieltagsinfo_section(game):
    """Spieltagsinfo (digitale Stadionzeitung) als Band ueber die ganze Breite.

    Die Ausgabe-Nummer steht in data/heimspiele.json (Feld "spieltagsinfo"); eine Ausgabe kann
    fuer mehrere Spiele gelten. PDF-Name und Saison aus data/spieltagsinfo.json."""
    nr = game.get("spieltagsinfo")
    if not nr:
        return ""
    daten = json.loads(SPIELTAGSINFO_DATEI.read_text(encoding="utf-8"))
    ausgabe = next((a for a in daten["ausgaben"] if a["nr"] == nr), None)
    if not ausgabe:
        raise SystemExit(f"data/heimspiele.json: spieltagsinfo {nr} fehlt in data/spieltagsinfo.json")
    url = f"/saison/profis/gameday/spieltagsinfo/ausgabe-{nr}/"
    vorschau = f"/assets/spieltagsinfo/ausgabe-{nr}/vorschau.webp"
    masse = bild_masse(vorschau)
    # Download-Knopf nur, wenn in data/spieltagsinfo.json ein PDF hinterlegt ist.
    # Leeres Feld heisst: Druckfassung noch nicht freigegeben (Entwurfs-Banner).
    pdf_knopf = ""
    if ausgabe.get("pdf"):
        pdf_knopf = ('            <a class="btn btn-ghost-dark" '
                     f'href="/assets/spieltagsinfo/{html.escape(ausgabe["pdf"])}" download>'
                     'PDF herunterladen</a>\n')
    media = ""
    if (REPO / vorschau.lstrip("/")).exists():
        dims = f' width="{masse[0]}" height="{masse[1]}"' if masse else ""
        media = (f'<div class="spiel-band-media"><a href="{url}" tabindex="-1" aria-hidden="true">'
                 f'<img loading="lazy" decoding="async" src="{vorschau}"{dims} alt="" /></a></div>')
    return f"""  <section class="section section-dark">
    <div class="container">
      <div class="spiel-band{'' if media else ' spiel-band-ohne-bild'}">
        {media}
        <div class="spiel-band-body">
          <span class="eyebrow">Spieltagsinfo · Ausgabe {nr} · Saison {html.escape(daten["saison"])}</span>
          <h2 class="t-h2">Alles zum Heimspiel in der Tasche</h2>
          <p class="t-body">Kader der Löwen und der Gäste, Ligastand, Spielplan und Geschichten aus dem Verein.</p>
          <div class="spiel-band-actions">
            <a class="btn btn-primary" style="color:#fff" href="{url}">Online lesen</a>
{pdf_knopf}            <a class="card-link" href="/saison/profis/gameday/spieltagsinfo/">Alle Ausgaben <i data-lucide="arrow-right" class="icon-14"></i></a>
          </div>
        </div>
      </div>
    </div>
  </section>
"""


def bericht_section(bericht_inhalt):
    """Frei geschriebener Text (BERICHT:auto) -- nur zeigen, wenn jemand tatsaechlich etwas
    hineingeschrieben hat; der Platzhalter "folgt nach dem Spiel" steht nicht mehr auf der Seite."""
    if bericht_inhalt.strip() == BERICHT_PLATZHALTER.strip():
        return ""
    return f"""  <section class="section">
    <div class="container container-narrow">
      <span class="eyebrow" style="display:block;margin-bottom:16px">Ergebnis &amp; Bericht</span>
<!--BERICHT:auto-->
{bericht_inhalt}
      <!--/BERICHT:auto-->
    </div>
  </section>
"""


def weiter_section(vorher, naechstes):
    """Naechstes Heimspiel als breites Band (Marko, 11.10.2026: die kleine Eckkarte wirkte
    verloren). Tickets-Knopf nur, wenn fuer das naechste Spiel der Verkauf offen ist (ticketUrl
    gesetzt); das vorherige Spiel nur als Textlink darunter. Ohne naechstes Spiel (Saisonende)
    fuehrt das Band zum Spielplan."""
    if not naechstes and not vorher:
        return ""
    if naechstes:
        d = parse_dmy(naechstes["datum"])
        gegner = html.escape(naechstes["gegner"])
        slug = naechstes["seiteSlug"]
        knoepfe = [f'<a class="btn btn-primary" style="color:#fff" href="/saison/profis/gameday/{slug}.html">Zur Spieltagsseite</a>']
        if naechstes.get("ticketUrl"):
            knoepfe.append('<a class="btn btn-ghost" href="/saison/profis/gameday/"><i data-lucide="ticket" class="icon-16"></i> Tickets</a>')
        band = f"""<div class="spiel-naechstes">
          <div class="spiel-naechstes-text">
            <span class="eyebrow">Nächstes Heimspiel</span>
            <h2 class="t-h3">Basketball Löwen – {gegner}</h2>
            <p class="t-body">{html.escape(lang_datum(d))} · {html.escape(naechstes["zeit"])} Uhr · Riethsporthalle</p>
          </div>
          <div class="spiel-naechstes-actions">{"".join(knoepfe)}</div>
        </div>"""
    else:
        band = """<div class="spiel-naechstes">
          <div class="spiel-naechstes-text">
            <span class="eyebrow">Saison 2026/27</span>
            <h2 class="t-h3">Das war das letzte Heimspiel der Saison</h2>
            <p class="t-body">Alle Spiele der Löwen, Löwinnen und der NBBL im Überblick.</p>
          </div>
          <div class="spiel-naechstes-actions"><a class="btn btn-primary" style="color:#fff" href="/saison/spielplan.html">Zum Spielplan</a></div>
        </div>"""
    zurueck = ""
    if vorher:
        dv = parse_dmy(vorher["datum"])
        zurueck = (f'<p class="spiel-zurueck"><a class="card-link" href="/saison/profis/gameday/{vorher["seiteSlug"]}.html">'
                   f'<i data-lucide="arrow-left" class="icon-14"></i> Vorheriges Heimspiel: {html.escape(vorher["gegner"])} ({html.escape(lang_datum(dv))})</a></p>')
    return f"""  <section class="section bg-subtle">
    <div class="container">
      {band}
      {zurueck}
    </div>
  </section>
"""


def kalender_menue(google_link, d):
    """Kalender im Hero: Google-Icon wie bisher, daneben der Textlink "iCal" fuer die .ics-Datei
    (Apple/Outlook, tools/build-kalender.py: kalender/spiel/profis-<Datum>.ics). Bewusst kein
    Aufklappmenue: der Hero schneidet ueberstehende Elemente ab."""
    return (f'<a href="{google_link}" target="_blank" rel="noopener" title="In Google Kalender eintragen" '
            'style="display:inline-flex;vertical-align:middle;color:inherit"><i data-lucide="calendar-plus" class="icon-16"></i></a> '
            f'<a class="kal-ics" href="/kalender/spiel/profis-{d.isoformat()}.ics" title="In Apple- oder Outlook-Kalender laden (.ics)">iCal</a>')


def build_page(game, phase, bericht_inhalt, header_html=LEER_HEADER, footer_html=LEER_FOOTER,
               seo_block=LEER_SEO, gameday_extra="", vorher=None, naechstes=None, news=None):
    news = news if news is not None else lade_news()
    d = parse_dmy(game["datum"])
    gegner = html.escape(game["gegner"])
    url = f"https://basketball-loewen.com/saison/profis/gameday/{game['seiteSlug']}.html"

    if phase == "danach":
        description = f"Ergebnis und Spielbericht aus der 2. Basketball Bundesliga ProB: Basketball Löwen Erfurt gegen {game['gegner']} am {game['datum']}."
        zeit_text = f"{hero_datum(d)} · {game['zeit']} Uhr"
    elif phase == "spieltag":
        description = f"Heimspiel in der 2. Basketball Bundesliga ProB am {game['datum']}: Basketball Löwen Erfurt gegen {game['gegner']} in der Riethsporthalle."
        zeit_text = f"{hero_datum(d)} · {game['zeit']} Uhr"  # Wochentag und Datum statt "Heute" (Marko, 11.10.2026)
    elif phase == "vorverkauf":
        description = f"Tickets für das ProB-Heimspiel der Basketball Löwen Erfurt gegen {game['gegner']} am {game['datum']} — Saalplan, Preise, Kategorien."
        zeit_text = f"{hero_datum(d)} · {game['zeit']} Uhr"
    else:
        description = f"ProB-Heimspiel gegen {game['gegner']} am {game['datum']} in der Riethsporthalle Erfurt. Alle Infos zum Spieltag."
        zeit_text = f"{hero_datum(d)} · {game['zeit']} Uhr"

    # Zeit- und Ort-Zeile getrennt (Marko, 27.08.2026): die vorherige, kombinierte
    # Lead-Zeile ("Datum · Zeit · Riethsporthalle") war bei langen Gegnernamen zu
    # lang fuer eine Zeile. Kalenderlink vorn in der Zeit-Zeile, Wochentag hier
    # abgekuerzt (hero_datum) -- auf dem Gameday-Hub steht er dagegen ausgeschrieben.
    kalender_link = gcal_link(game["gegner"], d, game["zeit"])

    # Eyebrow endet auf "vs." und nennt den Gegner NICHT mehr namentlich -- die
    # Ueberschrift direkt darunter tut das schon (das war die eigentliche
    # Dopplung: "vs. Gegner" im Eyebrow plus "Gegner." als H1). Das "vs." bleibt
    # bewusst stehen und wird optisch erst durch die Ueberschrift vervollstaendigt
    # (Marko, 27.08.2026, am Beispiel Porsche BBA Ludwigsburg). Trenner als
    # Punkt, wie im Eyebrow des Gameday-Hubs.
    eyebrow = "Heimspiel · Basketball Löwen Erfurt vs."

    # Ein einziger Hero-CTA auf allen Spieltagsseiten (Marko, 27.08.2026):
    # "Tickets kaufen" fuehrt immer zum Gameday-Hub -- der Kauf selbst lebt
    # dort (s. kauf_bereich() in tools/build-gameday-hub.py), nicht mehr hier.
    # Ersetzt den vorherigen, bis Weihnachten befristeten Dauerkarte-CTA.
    tickets_cta = (
        '        <div style="display:flex;align-items:center;justify-content:center">\n'
        '          <a class="btn btn-primary" style="color:#fff" href="/saison/profis/gameday/">'
        '<i data-lucide="ticket" class="icon-16"></i> Tickets kaufen</a>\n'
        '        </div>\n'
    )

    # Aufbau seit 11.10.2026 (Marko): Hero traegt Termin, Halle und Tickets -- die drei
    # Heimspiel-Infos-Kacheln entfallen. Danach: Endstand, Berichte-Teaser, Spieltagsinfo,
    # Zurueck/Weiter. Nach dem Spiel steht das Ergebnis ganz oben.
    sections = [
        ergebnis_section(game, phase),
        story_section(game, phase, news),
        gegner_section(game),
        spieltagsinfo_section(game),
        bericht_section(bericht_inhalt) if phase == "danach" else "",
        weiter_section(vorher, naechstes),
    ]
    sections = [x for x in sections if x]

    main_content = "\n".join(sections)
    # Der gerettete gameday-extra-Abschnitt steht im Original zwischen Hero und
    # Heimspiel-Infos; genau dort wird er wieder eingesetzt, mit demselben
    # Zeilenumbruch-Muster, damit --check ohne Unterschied durchlaeuft.
    if gameday_extra:
        main_content = gameday_extra.strip("\n") + "\n\n" + main_content

    # Kein noindex mehr. Bis zum 27.08.2026 standen die Seiten in der Phase
    # "angekuendigt" auf noindex: sie trugen nur Gegner, Datum und den Hinweis
    # "Vorverkauf noch nicht begonnen", knapp 60 Woerter, davon die Haelfte auf
    # allen dreizehn Seiten gleich -- Beinah-Dubletten, von denen Google typisch
    # eine indexiert. Markos Ansage vom 27.08.2026 hebt das auf: jede
    # Spieltagsseite bekommt Schritt fuer Schritt ihr eigenes Thema, damit
    # entfaellt der Dubletten-Grund. build-sitemap.py nimmt die Seiten dadurch
    # von sich aus auf (78 -> 91 URLs).
    #
    # Nebeneffekt, der der eigentliche Gewinn ist: die SportsEvent-Auszeichnung
    # liegt seit dem Umbau nur noch auf diesen Seiten (s. Kommentar in
    # tools/build-head-meta.py). Solange dreizehn davon auf noindex standen, sah
    # Google genau ein Heimspiel statt vierzehn.

    # Title "Basketball Löwen Erfurt — <Gegner>", nicht "<Gegner> — Basketball
    # Löwen Erfurt" (Markos Ansage 27.08.2026): wir stehen vorn, der Gegner
    # dahinter. Die Kurzform "Löwen" war zwischenzeitlich drin, damit in der
    # Tableiste mehr von der Paarung zu sehen ist -- auf Markos Ansage wieder
    # ausgeschrieben, weil der Markenname in allen 14 Titeln stehen soll.
    # Laengster Fall bleibt mit 49 Zeichen unter der 60-Zeichen-Grenze.
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>Heimspiel in Erfurt: Basketball Löwen – {gegner}</title>
<meta name="description" content="{html.escape(description)}" />
<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/css/colors_and_type.css?v=1785398309" />
<link rel="stylesheet" href="/css/site.css?v=1791837957" />
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
<!-- Nav-Highlight auf "Saison & Teams", nicht auf "Game Day" (Markos Ansage
     27.08.2026): die Seite eines einzelnen Spiels gehoert inhaltlich zum
     Spielplan. "Game Day" leuchtet nur, wenn wirklich der Hub angezeigt wird.
     Und ohne hide-mobile-cta, damit das Ticket-Icon hier auf den Hub zeigt. -->
<body data-nav-group="saison">
<a class="skip-link" href="#main">Zum Inhalt springen</a>
{header_html}
<main id="main">
  <section class="hero-photo hero-tickets hero-half">
    <div class="container">
      <div class="hero-lg-grid">
        <div>
          <span class="eyebrow">{eyebrow}</span>
          <h1 class="nowrap-lg" style="font-size:clamp(20px,5vw,56px)"><span class="kw">{gegner}<span class="swoosh" aria-hidden="true"></span></span>.</h1>
          <p class="lead">{kalender_menue(kalender_link, d)} {html.escape(zeit_text)}</p>
          <a class="hero-location" href="{RIETHSPORTHALLE_MAPS_URL}" target="_blank" rel="noopener"><i data-lucide="map-pin" class="icon-16"></i> Riethsporthalle, Essener Straße 20, 99089 Erfurt</a>
{hero_links(game, phase)}        </div>
{tickets_cta}      </div>
    </div>
  </section>

{main_content}
</main>
{footer_html}
<script src="/js/vendor/lucide-icons.js?v=1791710586"></script>
<script src="/js/nav.js?v=1791753237"></script>
<script src="/js/include.js?v=1787854261"></script>
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
    news = lade_news()
    spiele = sorted(daten["spiele"], key=lambda g: parse_dmy(g["datum"]))
    for pos, game in enumerate(spiele):
        vorher = spiele[pos - 1] if pos > 0 else None
        naechstes = spiele[pos + 1] if pos + 1 < len(spiele) else None
        phase = phase_of(game, today)
        pfad = ZIEL_DIR / f"{game['seiteSlug']}.html"
        bericht = extract_bericht(pfad)
        header_html = extract_platzhalter(pfad, "header", LEER_HEADER)
        footer_html = extract_platzhalter(pfad, "footer", LEER_FOOTER)
        gameday_extra = extract_gameday_extra(pfad)
        seo_block = extract_seo_block(pfad)
        neu = build_page(game, phase, bericht, header_html, footer_html, seo_block, gameday_extra, vorher, naechstes, news)
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
