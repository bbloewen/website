#!/usr/bin/env python3
"""Baut die Firmenevent-Einladung: partner/basketballevent-einladung.html und
partner/basketballevent-umfrage.html.

Hintergrund (Marko, 19.10.2026): Die Seite entstand im Oktober 2026 als
Einladung von crestcom zum Heimspiel gegen Reutlingen und war an rund vierzig
Stellen auf diesen einen Sponsor getauft — Texte, Dateinamen, Bildnamen und die
vier n8n-Webhooks. Heiko Kuehnst moechte dieselbe Aktion fuer seine Mandanten,
und danach kommen weitere. Statt die Seite jedes Mal zu kopieren, steht die
Aktion jetzt in data/firmenevents.json und dieses Skript baut daraus die Seiten.

Die Adresse bleibt ueber alle Aktionen gleich:
  https://basketball-loewen.com/partner/basketballevent-einladung.html
Damit ist der Link wiederverwendbar, und niemand muss sich pro Sponsor eine
neue Adresse merken. Genau eine Aktion in der Datendatei hat "aktiv": true,
die steht auf der Seite; die uebrigen bleiben als Beleg stehen, was wann galt.

Was aus der Datendatei kommt und was nicht:
  aus data/firmenevents.json   Sponsor, Logo, Logohoehe, Ansprache, Block,
                               Kategorie, VIP-Zahl, Spanne der Mitarbeitenden,
                               Kontingent, Anmeldeschluss
  aus data/heimspiele.json     Gegner, Datum, Uhrzeit, Spieltagsseite, ics
  fest in diesem Skript        Aufbau, Fotos, FAQ-Geruest, Formular, Umfrage

Die Logohoehe ist der Grund, warum sie ueberhaupt in den Daten steht: Eine
Wortmarke wie crestcom (1200x167, also 7:1) traegt bei 28 Pixeln Hoehe und wird
200 Pixel breit. Ein kompaktes Logo wie das von Heiko Kuehnst (1200x829, also
1,4:1) waere bei derselben Hoehe nur 40 Pixel breit — das Monogramm schrumpft,
der Schriftzug darunter ist nicht mehr lesbar. Ab 40 Pixeln setzt das Skript
zusaetzlich die Klasse .cc-sponsor-hoch, die der weissen Pille mehr Luft gibt.

Backend: fuenf n8n-Webhooks, die den Schluessel der Aktion mitbekommen und daran
Kontingent, Anmeldeschluss und Empfaenger festmachen (frueher crestcom-*):
  firmenevent-kontingent         GET  ?aktion=<slug>
  firmenevent-anmeldung          POST {aktion, firma, ansprechpartner, ...}
  firmenevent-umfrage-erstellen  POST {aktion}
  firmenevent-umfrage-stimme     POST {aktion, umfrage, antwort, name}
  firmenevent-umfrage-ergebnis   GET  ?aktion=<slug>&id=<umfrage>&k=<token>

Header, Footer und der SEO-Block werden wie bei den Spieltagsseiten aus der
bestehenden Datei uebernommen, damit dieses Skript nicht zunichtemacht, was
build-partials.py und build-head-meta.py danach eintragen.

Die Datenschutzerklaerung fasst dieses Skript NICHT an. Abschnitt 6 und 7 dort
sind bewusst allgemein formuliert — welcher Partner einlaedt, zu welchem Spiel
und wie gross das Kontingent ist, legen wir fest und ist keine Frage des
Datenschutzes (Marko, 19.10.2026). Eine kurze Fassung, die den jeweiligen
Partner und das Kontingent nannte, ist deshalb wieder entfallen.

Aufruf:
  python3 tools/build-basketballevent.py
  python3 tools/build-basketballevent.py --check
"""

import argparse
import html
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
AKTIONEN_DATEI = REPO / "data" / "firmenevents.json"
HEIMSPIELE_DATEI = REPO / "data" / "heimspiele.json"
EINLADUNG = REPO / "partner" / "basketballevent-einladung.html"
UMFRAGE = REPO / "partner" / "basketballevent-umfrage.html"

BASIS = "https://basketball-loewen.com"
EINLADUNG_URL = f"{BASIS}/partner/basketballevent-einladung.html"
UMFRAGE_URL = f"{BASIS}/partner/basketballevent-umfrage.html"
HALLE = "Riethsporthalle Erfurt"
HALLE_ADRESSE = "Essener Straße 20, 99089 Erfurt"
HALLE_MAPS = ("https://www.google.com/maps/search/?api=1&amp;query="
              "Riethsporthalle+Erfurt+Essener+Stra%C3%9Fe+20+99089+Erfurt")
MDR_BEITRAG = ("https://www.ardmediathek.de/video/mdr-thueringen-journal/"
               "erfurter-loewen-schaffen-ersten-sieg-der-saison/mdr/"
               "Y3JpZDovL21kci5kZS9iZWl0cmFnL2Ntcy84ZTY2YmI0ZC02NGMxLTQ5NjUtYWU4Yy00ZGI4MWM2ZjYyOTE")

WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

LEER_HEADER = '<div id="site-header-placeholder"></div>'
LEER_FOOTER = '<div id="site-footer-placeholder"></div>'
LEER_SEO = ""

# Die acht Bilder des Sliders. Neutral benannt, weil sie zu jedem Heimspiel
# passen und auch auf der Startseite verwendet werden.
IMPRESSIONEN = [
    ("1", "Volle Riethsporthalle beim Heimspiel der Basketball Löwen Erfurt, Zuschauer auf den Rängen"),
    ("2", "Spieler der Basketball Löwen Erfurt und Fans jubeln gemeinsam mit erhobenen Armen"),
    ("3", "Löwen-Spieler beim Dunk am Korb vor den Zuschauerrängen"),
    ("4", "Trainer und Spieler besprechen sich in einer Auszeit"),
    ("5", "Das Team der Basketball Löwen Erfurt im Kreis nach dem Spiel"),
    ("6", "Trainer erklärt dem Team in der Auszeit die nächsten Spielzüge"),
    ("7", "Spieler der Basketball Löwen Erfurt klatscht zu den Fans"),
    ("8", "Spieler bedankt sich mit Applaus bei den Zuschauern"),
]


# ---------------------------------------------------------------- Daten lesen

def lade_aktion():
    """Die eine aktive Aktion plus das zugehoerige Heimspiel."""
    daten = json.loads(AKTIONEN_DATEI.read_text(encoding="utf-8"))
    aktive = [a for a in daten["aktionen"] if a.get("aktiv")]
    if len(aktive) != 1:
        raise SystemExit(
            f"data/firmenevents.json: genau eine Aktion muss \"aktiv\": true sein, "
            f"gefunden: {len(aktive)}"
        )
    aktion = aktive[0]

    spiele = json.loads(HEIMSPIELE_DATEI.read_text(encoding="utf-8"))["spiele"]
    treffer = [g for g in spiele if g.get("slug") == aktion["spiel"]]
    if not treffer:
        raise SystemExit(
            f"data/firmenevents.json: Spiel \"{aktion['spiel']}\" steht nicht in data/heimspiele.json"
        )
    return aktion, treffer[0]


def datum_teile(spiel, aktion):
    """Alle Datums- und Zeitangaben an einer Stelle, damit sie auf beiden Seiten
    gleich lauten."""
    d = datetime.strptime(spiel["datum"], "%d.%m.%Y")
    zeit = spiel.get("zeit", "17:00")
    stunde, minute = (int(x) for x in zeit.split(":"))
    anpfiff = d.replace(hour=stunde, minute=minute)
    einlass = anpfiff - timedelta(minutes=aktion.get("einlassVorlaufMinuten", 60))
    schluss = datetime.fromisoformat(aktion["anmeldeschluss"])
    return {
        "wochentag": WOCHENTAGE[d.weekday()],
        "datum": spiel["datum"],
        "zeit": zeit,
        "lang": f"{WOCHENTAGE[d.weekday()]}, {spiel['datum']} · {zeit} Uhr",
        "einlass": einlass.strftime("%H:%M"),
        "ics_start": anpfiff.strftime("%Y%m%dT%H%M%S"),
        "ics_ende": (anpfiff + timedelta(hours=2)).strftime("%Y%m%dT%H%M%S"),
        "schluss_lang": f"{WOCHENTAGE[schluss.weekday()]}, {schluss.strftime('%d.%m.%Y')}, {schluss.strftime('%H:%M')} Uhr",
        "schluss_kurz": f"{schluss.strftime('%d.%m.%Y')} um {schluss.strftime('%H:%M')} Uhr",
    }


def quote(text):
    """Fuer Werte, die in einen JavaScript-String gehen."""
    return text.replace("\\", "\\\\").replace("'", "\\'")


# ------------------------------------------------------------- Seitenbausteine

def sponsor_pille(sponsor):
    """Logo des Sponsors in der weissen Pille ueber der Ueberschrift.

    Die Hoehe kommt aus den Daten (s. Modulkopf). Ab 40 Pixeln bekommt die Pille
    ueber .cc-sponsor-hoch etwas mehr Innenabstand, sonst sitzt ein hohes Logo
    an den Raendern auf."""
    hoehe = int(sponsor.get("logoHoehe", 28))
    klasse = "cc-sponsor cc-sponsor-hoch" if hoehe >= 40 else "cc-sponsor"
    return (
        f'<a class="{klasse}" style="--cc-logo-hoehe:{hoehe}px" href="{sponsor["website"]}" '
        f'target="_blank" rel="noopener" '
        f'aria-label="{html.escape(sponsor["name"])}, Partner der Basketball Löwen Erfurt">\n'
        f'          <span class="cc-sponsor-label">Eingeladen von</span>\n'
        f'          <img src="{sponsor["logo"]}" alt="{html.escape(sponsor.get("logoAlt", sponsor["name"]))}" />\n'
        f'        </a>'
    )


def spielpanel(spiel, zeit, gegner):
    kalender_titel = f"Basketball Löwen Erfurt – {spiel['gegner']}"
    from urllib.parse import quote as urlquote
    google = (
        "https://calendar.google.com/calendar/render?action=TEMPLATE"
        f"&amp;text={urlquote(kalender_titel)}"
        f"&amp;dates={zeit['ics_start']}/{zeit['ics_ende']}"
        "&amp;details=Heimspiel%20der%20Basketball%20L%C3%B6wen%20Erfurt%20in%20der%20Riethsporthalle."
        "&amp;location=Essener%20Stra%C3%9Fe%2020%2C%2099089%20Erfurt&amp;ctz=Europe/Berlin"
    )
    return f"""      <div class="cc-match" aria-label="Das Spiel im Überblick">
        <div class="cc-match-row">
          <i data-lucide="calendar" class="icon-24"></i>
          <div class="cc-match-text"><strong>{zeit['wochentag']}, {zeit['datum']} · {zeit['zeit']} Uhr</strong><span>Einlass ab {zeit['einlass']} Uhr</span></div>
          <details class="kal-menu"><summary class="cc-match-link" title="In Kalender eintragen" aria-label="In Kalender eintragen"><i data-lucide="calendar-plus" class="icon-18"></i></summary><div class="kal-menu-liste"><a href="{google}" target="_blank" rel="noopener">Google Kalender</a><a href="/kalender/spiel/profis-{spiel['slug']}.ics">Apple / Outlook (.ics)</a></div></details>
        </div>
        <div class="cc-match-row">
          <i data-lucide="map-pin" class="icon-24"></i>
          <div class="cc-match-text"><strong>{HALLE}</strong><span>{HALLE_ADRESSE}</span></div>
          <a class="cc-match-link" href="{HALLE_MAPS}" target="_blank" rel="noopener" title="Route in Google Maps öffnen" aria-label="Route in Google Maps öffnen"><i data-lucide="navigation" class="icon-18"></i></a>
        </div>
        <div class="cc-match-row">
          <i data-lucide="trophy" class="icon-24"></i>
          <div class="cc-match-text"><strong>gegen {gegner}</strong><span>ProB, 2. Basketball Bundesliga</span></div>
          <a class="cc-match-link" href="/saison/profis/gameday/{spiel['seiteSlug']}.html" title="Alle Infos zum Spieltag" aria-label="Alle Infos zum Spieltag"><i data-lucide="arrow-right" class="icon-18"></i></a>
        </div>
      </div>"""


def formular(aktion, zeit):
    s = aktion["sponsor"]
    kurz = html.escape(s["kurz"])
    return f"""      <div class="cc-form-card" id="anmeldung">
        <div class="cc-state" id="cc-state-zu" hidden>
          <h2 class="t-h4">Die Anmeldung ist geschlossen</h2>
          <p class="t-body">Der Anmeldeschluss war am {zeit['schluss_kurz']}. Wenn Sie noch Interesse haben, schreiben Sie uns an <a href="mailto:tickets@basketball-loewen.com">tickets@basketball-loewen.com</a>. Wir prüfen, was möglich ist.</p>
        </div>
        <div class="cc-state" id="cc-state-voll" hidden>
          <h2 class="t-h4">Alle Tickets sind vergeben</h2>
          <p class="t-body">Das Kontingent von {aktion['kontingent']} Tickets ist ausgeschöpft. Schreiben Sie uns an <a href="mailto:tickets@basketball-loewen.com">tickets@basketball-loewen.com</a>, wir setzen Sie auf die Warteliste.</p>
        </div>
        <div class="cc-state" id="cc-state-danke" hidden>
          <div class="tile-icon cc-danke-icon"><i data-lucide="check" class="icon-24"></i></div>
          <h2 class="t-h4">Vielen Dank, wir haben Ihre Anmeldung erhalten.</h2>
          <p class="t-body">Eine Bestätigung ist unterwegs an <strong id="cc-danke-mail"></strong>. Wir stimmen die Anmeldung mit {kurz} ab und melden uns mit den Tickets.</p>
        </div>

        <form id="cc-form" novalidate>
          <div class="cc-form-head">
            <h2 class="t-h4">Jetzt anmelden</h2>
            <p>Anmeldeschluss: {zeit['schluss_lang']}</p>
          </div>
          <input type="text" name="website" id="cc-website" class="cc-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
          <input type="hidden" name="umfrage" id="cc-umfrage" value="" />

          <div class="field">
            <label for="cc-firma">Firma *</label>
            <input type="text" id="cc-firma" name="firma" autocomplete="organization" required />
          </div>
          <div class="cc-row">
            <div class="field">
              <label for="cc-ap-name">Ansprechpartner *</label>
              <input type="text" id="cc-ap-name" name="ansprechpartner" autocomplete="name" required />
            </div>
            <div class="field">
              <label for="cc-ap-mail">E-Mail *</label>
              <input type="email" id="cc-ap-mail" name="ap_email" autocomplete="email" required />
            </div>
          </div>
          <div class="field">
            <label for="cc-ap-tel">Telefon</label>
            <input type="tel" id="cc-ap-tel" name="ap_telefon" autocomplete="tel" />
          </div>
          <div class="field-checkbox cc-same">
            <input type="checkbox" id="cc-gf-same" name="gf_same" />
            <label for="cc-gf-same">Der Ansprechpartner ist die Geschäftsführung</label>
          </div>
          <div class="cc-row" id="cc-gf-row">
            <div class="field">
              <label for="cc-gf-name">Geschäftsführung *</label>
              <input type="text" id="cc-gf-name" name="gf_name" required />
            </div>
            <div class="field">
              <label for="cc-gf-mail">E-Mail Geschäftsführung</label>
              <input type="email" id="cc-gf-mail" name="gf_email" />
            </div>
          </div>
          <div class="cc-row cc-row-ma">
            <div class="field">
              <label for="cc-ma">Mitarbeitende ({aktion['maMin']} bis {aktion['maMax']}) *</label>
              <div class="cc-stepper">
                <button type="button" class="cc-step" id="cc-minus" aria-label="Eine Person weniger">−</button>
                <input type="number" id="cc-ma" name="mitarbeitende" min="{aktion['maMin']}" max="{aktion['maMax']}" step="1" value="{aktion['maMin']}" inputmode="numeric" required />
                <button type="button" class="cc-step" id="cc-plus" aria-label="Eine Person mehr">+</button>
              </div>
            </div>
            <p class="cc-summary" id="cc-summary" aria-live="polite"></p>
          </div>

          <div class="field-checkbox cc-consent">
            <input type="checkbox" id="cc-datenschutz" name="datenschutz" required />
            <label for="cc-datenschutz">Ich habe die <a href="/datenschutz.html#einladung-anmeldung" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen und bin einverstanden, dass meine Angaben zur Abwicklung gespeichert und mit {kurz} abgestimmt werden. *</label>
          </div>

          <button type="submit" class="btn btn-primary btn-lg btn-block" id="cc-submit">Verbindlich anmelden</button>
          <div class="form-status error" id="cc-error" role="alert"></div>
          <p class="cc-form-hint">Noch unklar, wer mitkommt? <a href="#umfrage">Erst das Team fragen</a></p>
          <p class="cc-form-hint cc-form-help">Falls etwas schiefgeht oder Sie Fragen haben, schreiben Sie uns an <a href="mailto:tickets@basketball-loewen.com">tickets@basketball-loewen.com</a>.</p>
        </form>
      </div>"""


def erwartung(aktion):
    """Die vier Kacheln "Was Sie sonst noch erwartet"."""
    s = aktion["sponsor"]
    kurz = html.escape(s["kurz"])
    name = html.escape(s["name"])
    vip = "zwei" if aktion["vipTickets"] == 2 else str(aktion["vipTickets"])
    return f"""  <section class="section bg-subtle" id="erwartung">
    <div class="container">
      <span class="eyebrow">Ihr Abend</span>
      <h2 class="t-h2 mb-5">Was Sie sonst noch erwartet</h2>
      <div class="grid-4">
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="crown"></i></div>
            <h3 class="t-h4">VIP-Bereich für {vip}</h3>
          </div>
          <p class="t-body-sm">Geschäftsführung und eine Begleitung erleben das Spiel im VIP-Bereich direkt am Parkett, mit Catering.</p>
          <a class="card-link mt-2" href="/saison/profis/gameday/#seatplan-root">VIP im Hallenplan <i data-lucide="arrow-right" class="icon-14"></i></a>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="book-open"></i></div>
            <h3 class="t-h4">Regelkunde vor dem Anpfiff</h3>
          </div>
          <p class="t-body-sm">Basketball ist für manche im Team neu? Wer rechtzeitig anreist, bekommt vor dem Anpfiff eine kurze Regelkunde und versteht ab dem ersten Ballwechsel, worum es geht.</p>
          <a class="card-link mt-2" href="/saison/profis/gameday/{aktion['_seiteSlug']}.html">Alles zum Spieltag <i data-lucide="arrow-right" class="icon-14"></i></a>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="handshake"></i></div>
            <h3 class="t-h4">Meet &amp; Greet mit den Profispielern</h3>
          </div>
          <p class="t-body-sm">Nach dem Spiel treffen Sie und Ihr Team die Profispieler der Basketball Löwen Erfurt persönlich, ein Abend, über den im Büro noch gesprochen wird.</p>
          <a class="card-link mt-2" href="/saison/profis.html">Unsere Profis kennenlernen <i data-lucide="arrow-right" class="icon-14"></i></a>
        </div>
        <div class="info-tile info-tile-row info-tile-row-divided">
          <div class="info-tile-row-head">
            <div class="tile-icon"><i data-lucide="heart-handshake"></i></div>
            <h3 class="t-h4">Kostenlos durch {kurz}</h3>
          </div>
          <p class="t-body-sm">{name} trägt die Kosten. Für Ihr Unternehmen sind die Tickets kostenlos, ohne versteckte Gebühren und ohne Verpflichtung.</p>
          <a class="card-link mt-2" href="{s['website']}" target="_blank" rel="noopener">Mehr zu {kurz} <i data-lucide="arrow-up-right" class="icon-14"></i></a>
        </div>
      </div>
      <p class="t-body cc-hall-note">Die Riethsporthalle fasst 1.580 Zuschauerinnen und Zuschauer und ist bei Heimspielen im Schnitt mit über 1.100 gefüllt. Sie sitzen mittendrin, nicht daneben.</p>
    </div>
  </section>"""


def faq(aktion, zeit):
    s = aktion["sponsor"]
    kurz = html.escape(s["kurz"])
    name = html.escape(s["name"])
    fragen = [
        ("Was kostet die Teilnahme für unser Unternehmen?",
         f"Nichts. {name} lädt Sie ein und trägt die Kosten für die VIP-Tickets der Geschäftsführung "
         f"und ihrer Begleitung sowie für die Tickets Ihrer Mitarbeitenden."),
        ("Wie viele Tickets können wir anfordern?",
         f"Zwei VIP-Tickets für die Geschäftsführung und eine Begleitung, dazu {aktion['maMin']} bis "
         f"{aktion['maMax']} Tickets für Mitarbeitende in Block {aktion['block']} ({aktion['kategorie']}). "
         f"Insgesamt gibt es für die Aktion {aktion['kontingent']} Tickets."),
        ("Wie bekommen wir die Tickets?",
         f"Wir stimmen Ihre Anmeldung mit {kurz} ab und senden die Tickets per E-Mail an Ihren "
         f"Ansprechpartner. Er kann sie an die Mitarbeitenden weitergeben."),
        ("Wann sollten wir in der Halle sein?",
         f"Die Riethsporthalle öffnet um {zeit['einlass']} Uhr, der Anpfiff ist um {zeit['zeit']} Uhr. "
         f"Wer rechtzeitig kommt, kann vor dem Spiel an der Regelkunde teilnehmen und sich in Ruhe "
         f"umsehen. Nach dem Spiel gibt es das Meet &amp; Greet mit den Profispielern."),
        ("Gibt es ein Meet &amp; Greet mit den Profispielern?",
         "Ja. Nach dem Spiel treffen Sie und Ihre Mitarbeitenden die Profispieler der "
         "Basketball Löwen Erfurt persönlich."),
        ("Wir kennen uns mit Basketball nicht aus. Ist das ein Problem?",
         "Im Gegenteil. Die kurze Regelkunde vor dem Spiel erklärt das Wichtigste, den Rest "
         "übernimmt die Stimmung in der Halle."),
        ("Wo finden wir die Halle?",
         f"Die Riethsporthalle liegt in der {HALLE_ADRESSE}. "
         f'<a href="{HALLE_MAPS}" target="_blank" rel="noopener">Route in Google Maps öffnen</a>.'),
        ("Bis wann müssen wir uns anmelden?",
         f"Anmeldeschluss ist {zeit['schluss_lang']}. Das Kontingent wird in der Reihenfolge der "
         f"Anmeldungen vergeben, eine frühe Anmeldung lohnt sich also."),
    ]
    zeilen = "\n".join(
        f"        <details>\n"
        f"          <summary>{frage}</summary>\n"
        f"          <p class=\"t-body\">{antwort}</p>\n"
        f"        </details>"
        for frage, antwort in fragen
    )
    return f"""  <section class="section bg-subtle">
    <div class="container cc-faq-wrap">
      <div>
        <span class="eyebrow">Häufige Fragen</span>
        <h2 class="t-h2 mb-5">Alles Wichtige zur Einladung</h2>
      </div>
      <div class="cc-faq">
{zeilen}
      </div>
    </div>
  </section>"""


def slider():
    folien = "\n".join(
        f'          <figure class="cc-slide"><img src="/assets/img/heimspiel-impression-{nr}.webp" '
        f'width="1200" height="800" loading="lazy" decoding="async" alt="{alt}" /></figure>'
        for nr, alt in IMPRESSIONEN
    )
    return f"""  <section class="section cc-slider-section" aria-label="Eindrücke vom Heimspiel">
    <div class="container">
      <span class="eyebrow">Eindrücke</span>
      <h2 class="t-h2 mb-5">So fühlt sich ein Heimspiel an</h2>
      <div class="cc-slider">
        <div class="cc-slider-track" id="cc-slider-track" tabindex="0" aria-label="Fotos vom Heimspiel, seitlich scrollbar">
{folien}
        </div>
        <button type="button" class="cc-slider-arrow prev" aria-label="Vorheriges Bild"><i data-lucide="chevron-left" class="icon-18"></i></button>
        <button type="button" class="cc-slider-arrow next" aria-label="Nächstes Bild"><i data-lucide="chevron-right" class="icon-18"></i></button>
      </div>
    </div>
  </section>"""


def skript_einladung(aktion, spiel, zeit):
    """Das Inline-Skript der Landingpage: Formular, Kontingent, Team-Umfrage, Slider."""
    s = aktion["sponsor"]
    teiltext = (
        f"Hey, wer hat Lust mitzukommen? Wir sind von {s['name']} zum Basketball eingeladen: "
        f"Basketball Löwen Erfurt, {zeit['wochentag']}, {zeit['datum']}, {zeit['zeit']} Uhr, "
        f"{HALLE}. Bitte kurz abstimmen: "
    )
    betreff = f"Wer kommt mit zum Basketball? {zeit['wochentag']}, {zeit['datum']}"
    return f"""<script>
(function () {{
  var API = 'https://ticketing.basketball-loewen.com/webhook/';
  var AKTION = '{quote(aktion["slug"])}';
  var SEITE = '{UMFRAGE_URL}';
  var MA_MIN = {aktion['maMin']};
  var form = document.getElementById('cc-form');
  var maInput = document.getElementById('cc-ma');
  var summary = document.getElementById('cc-summary');
  var errorBox = document.getElementById('cc-error');
  var submitBtn = document.getElementById('cc-submit');
  var geladen = Date.now();
  var maMax = {aktion['maMax']};

  var params = new URLSearchParams(location.search);
  var quelle = params.get('ref') || params.get('utm_source') || params.get('q') || '';
  var umfrage = (params.get('u') || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
  document.getElementById('cc-umfrage').value = umfrage;

  function zeigeSumme() {{
    var n = parseInt(maInput.value, 10);
    var ok = n >= MA_MIN && n <= maMax;
    summary.textContent = ok
      ? 'Ihre Auswahl: {aktion['vipTickets']} VIP-Tickets + ' + n + ' Tickets Block {aktion['block']} = ' + (n + {aktion['vipTickets']}) + ' Tickets'
      : 'Bitte wählen Sie zwischen ' + MA_MIN + ' und ' + maMax + ' Mitarbeitenden.';
  }}

  function setze(wert) {{
    var n = parseInt(wert, 10);
    if (isNaN(n)) n = MA_MIN;
    maInput.value = Math.max(MA_MIN, Math.min(maMax, n));
    zeigeSumme();
  }}

  var vorgabe = parseInt(params.get('ma'), 10);
  if (vorgabe) maInput.value = Math.max(MA_MIN, Math.min(maMax, vorgabe));
  var gfRow = document.getElementById('cc-gf-row');
  form.gf_same.addEventListener('change', function () {{
    gfRow.hidden = form.gf_same.checked;
    form.gf_name.required = !form.gf_same.checked;
  }});
  document.getElementById('cc-minus').addEventListener('click', function () {{ setze((parseInt(maInput.value, 10) || MA_MIN) - 1); }});
  document.getElementById('cc-plus').addEventListener('click', function () {{ setze((parseInt(maInput.value, 10) || MA_MIN - 1) + 1); }});
  maInput.addEventListener('input', zeigeSumme);
  maInput.addEventListener('change', function () {{ setze(maInput.value); }});
  zeigeSumme();

  function zustand(id) {{
    document.getElementById(id).hidden = false;
    form.hidden = true;
  }}

  // Stand des Kontingents: schließt das Formular, wenn der Anmeldeschluss vorbei oder alles vergeben ist.
  fetch(API + 'firmenevent-kontingent?aktion=' + encodeURIComponent(AKTION)).then(function (r) {{ return r.json(); }}).then(function (s) {{
    if (!s || s.ok !== true) return;
    if (!s.offen) {{ zustand('cc-state-zu'); return; }}
    if (s.voll) {{ zustand('cc-state-voll'); return; }}
    maMax = Math.min({aktion['maMax']}, s.rest - {aktion['vipTickets']});
    maInput.max = maMax;
    setze(maInput.value);
  }}).catch(function () {{ /* Formular bleibt offen, der Server prüft beim Absenden erneut */ }});

  function meldung(text) {{
    errorBox.textContent = text;
    errorBox.classList.add('visible');
  }}

  var FELDNAMEN = {{
    firma: 'Firma', ansprechpartner: 'Ansprechpartner', ap_email: 'E-Mail des Ansprechpartners',
    gf_name: 'Geschäftsführung', gf_email: 'E-Mail der Geschäftsführung',
    mitarbeitende: 'Anzahl Mitarbeitende', datenschutz: 'Einverständnis zum Datenschutz'
  }};
  var MAILMUSTER = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{{2,}}$/;

  form.addEventListener('submit', function (e) {{
    e.preventDefault();
    errorBox.classList.remove('visible');

    var fehlt = [];
    if (!form.firma.value.trim()) fehlt.push(FELDNAMEN.firma);
    if (!form.ansprechpartner.value.trim()) fehlt.push(FELDNAMEN.ansprechpartner);
    if (!MAILMUSTER.test(form.ap_email.value.trim())) fehlt.push(FELDNAMEN.ap_email);
    var gfGleich = form.gf_same.checked;
    if (!gfGleich && !form.gf_name.value.trim()) fehlt.push(FELDNAMEN.gf_name);
    if (!gfGleich && form.gf_email.value.trim() && !MAILMUSTER.test(form.gf_email.value.trim())) fehlt.push(FELDNAMEN.gf_email);
    var n = parseInt(maInput.value, 10);
    if (!(n >= MA_MIN && n <= maMax)) fehlt.push(FELDNAMEN.mitarbeitende);
    if (!form.datenschutz.checked) fehlt.push(FELDNAMEN.datenschutz);
    if (fehlt.length) {{ meldung('Bitte prüfen Sie: ' + fehlt.join(', ') + '.'); return; }}

    submitBtn.disabled = true;
    var label = submitBtn.textContent;
    submitBtn.textContent = 'Wird gesendet …';

    var payload = {{
      aktion: AKTION,
      firma: form.firma.value.trim(),
      ansprechpartner: form.ansprechpartner.value.trim(),
      ap_email: form.ap_email.value.trim(),
      ap_telefon: form.ap_telefon.value.trim(),
      gf_name: gfGleich ? form.ansprechpartner.value.trim() : form.gf_name.value.trim(),
      gf_email: gfGleich ? form.ap_email.value.trim() : form.gf_email.value.trim(),
      mitarbeitende: n,
      anmerkung: '',
      datenschutz: true,
      quelle: quelle,
      umfrage: form.umfrage.value,
      website: form.website.value,
      elapsedMs: Date.now() - geladen
    }};

    fetch(API + 'firmenevent-anmeldung', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify(payload)
    }}).then(function (res) {{
      if (!res.ok) throw new Error('Serverfehler');
      return res.json();
    }}).then(function (antwort) {{
      if (antwort.ok) {{
        document.getElementById('cc-danke-mail').textContent = payload.ap_email;
        zustand('cc-state-danke');
        if (window.goatcounter && window.goatcounter.count) {{
          window.goatcounter.count({{ path: 'firmenevent-anmeldung-' + AKTION, title: 'Firmenevent Anmeldung', event: true }});
        }}
        document.getElementById('anmeldung').scrollIntoView({{ behavior: 'smooth', block: 'center' }});
        return;
      }}
      if (antwort.grund === 'geschlossen') {{ zustand('cc-state-zu'); return; }}
      if (antwort.grund === 'kontingent') {{
        meldung(antwort.rest > MA_MIN + {aktion['vipTickets']}
          ? 'Für so viele Tickets reicht das Kontingent nicht mehr. Bitte wählen Sie höchstens ' + (antwort.rest - {aktion['vipTickets']}) + ' Mitarbeitende.'
          : 'Das Kontingent ist leider ausgeschöpft. Schreiben Sie uns an tickets@basketball-loewen.com, wir setzen Sie auf die Warteliste.');
        return;
      }}
      var liste = [];
      var f = antwort.fehler || [];
      for (var k = 0; k < f.length; k++) liste.push(FELDNAMEN[f[k]] || f[k]);
      meldung('Bitte prüfen Sie: ' + (liste.length ? liste.join(', ') : 'Ihre Angaben') + '.');
    }}).catch(function () {{
      meldung('Das Senden hat leider nicht geklappt. Bitte versuchen Sie es noch einmal oder schreiben Sie uns an tickets@basketball-loewen.com.');
    }}).then(function () {{
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }});
  }});

  /* ---------- Team-Umfrage ---------- */
  var pollStart = document.getElementById('cc-poll-start');
  var pollShare = document.getElementById('cc-poll-share');
  var pollErr = document.getElementById('cc-poll-error');
  var pollBtn = document.getElementById('cc-poll-create');

  function zeigeUmfrage(u) {{
    var link = SEITE + '?u=' + u.id;
    var text = '{quote(teiltext)}' + link;
    document.getElementById('cc-poll-link').value = link;
    document.getElementById('cc-poll-wa').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    document.getElementById('cc-poll-mail').href = 'mailto:?subject=' + encodeURIComponent('{quote(betreff)}') + '&body=' + encodeURIComponent(text);
    document.getElementById('cc-poll-result').href = '/partner/basketballevent-umfrage.html?u=' + u.id + '&k=' + u.token;
    pollStart.hidden = true;
    pollShare.hidden = false;
  }}

  // Der Speicher haengt am Schluessel der Aktion: eine Umfrage aus einer frueheren
  // Aktion darf auf der neuen Seite nicht wieder auftauchen.
  var SPEICHER = 'firmeneventUmfrage-' + AKTION;
  try {{
    var gespeichert = JSON.parse(localStorage.getItem(SPEICHER) || 'null');
    if (gespeichert && gespeichert.id && gespeichert.token) zeigeUmfrage(gespeichert);
  }} catch (err) {{ /* ohne Speicher einfach neu starten */ }}

  pollBtn.addEventListener('click', function () {{
    pollErr.classList.remove('visible');
    pollBtn.disabled = true;
    fetch(API + 'firmenevent-umfrage-erstellen', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ aktion: AKTION, website: '', elapsedMs: Date.now() - geladen }})
    }}).then(function (r) {{ return r.json(); }}).then(function (a) {{
      if (!a.ok) throw new Error('abgelehnt');
      var u = {{ id: a.id, token: a.token }};
      try {{ localStorage.setItem(SPEICHER, JSON.stringify(u)); }} catch (err) {{ /* egal */ }}
      zeigeUmfrage(u);
      if (window.goatcounter && window.goatcounter.count) {{
        window.goatcounter.count({{ path: 'firmenevent-umfrage-erstellt-' + AKTION, title: 'Firmenevent Umfrage erstellt', event: true }});
      }}
    }}).catch(function () {{
      pollErr.textContent = 'Die Umfrage konnte nicht angelegt werden. Bitte versuchen Sie es noch einmal.';
      pollErr.classList.add('visible');
    }}).then(function () {{ pollBtn.disabled = false; }});
  }});

  document.getElementById('cc-poll-copy').addEventListener('click', function () {{
    var feld = document.getElementById('cc-poll-link');
    var btn = this;
    feld.select();
    function fertig() {{ btn.textContent = 'Kopiert'; setTimeout(function () {{ btn.textContent = 'Kopieren'; }}, 2000); }}
    if (navigator.clipboard && navigator.clipboard.writeText) {{
      navigator.clipboard.writeText(feld.value).then(fertig, function () {{ document.execCommand('copy'); fertig(); }});
    }} else {{ document.execCommand('copy'); fertig(); }}
  }});

  /* ---------- Foto-Slider ---------- */
  var track = document.getElementById('cc-slider-track');
  function schritt(richtung) {{
    var slide = track.querySelector('.cc-slide');
    var breite = slide ? slide.getBoundingClientRect().width + 14 : 400;
    track.scrollBy({{ left: richtung * breite, behavior: 'smooth' }});
  }}
  document.querySelector('.cc-slider-arrow.prev').addEventListener('click', function () {{ schritt(-1); }});
  document.querySelector('.cc-slider-arrow.next').addEventListener('click', function () {{ schritt(1); }});
}})();
</script>"""


# ------------------------------------------------------------- Seitengeruest

def extract_platzhalter(pfad, name, leer):
    """Header/Footer unveraendert uebernehmen — sonst setzt dieser Lauf zurueck,
    was build-partials.py zuletzt eingetragen hat."""
    if not pfad.exists():
        return leer
    text = pfad.read_text(encoding="utf-8")
    m = re.search(
        r'<div id="site-' + name + r'-placeholder">(?:<!--PARTIAL:' + name + r'-->.*?<!--/PARTIAL:' + name + r'-->)?</div>',
        text, re.S,
    )
    return m.group(0) if m else leer


def extract_seo_block(pfad):
    """Dasselbe fuer den SEO:auto-Block von build-head-meta.py."""
    if not pfad.exists():
        return LEER_SEO
    text = pfad.read_text(encoding="utf-8")
    m = re.search(
        r"<!-- SEO:auto START \(tools/build-head-meta\.py — nicht von Hand ändern\) -->.*?<!-- SEO:auto END -->\n?",
        text, re.S,
    )
    return m.group(0) if m else LEER_SEO


KOPF = """<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>{titel}</title>
<meta name="description" content="{description}" />
{robots}<link rel="icon" href="/assets/logo/loewen-logo-4c.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/assets/logo/favicon-16.png" />
<link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/css/colors_and_type.css?v=1785398309" />
<link rel="stylesheet" href="/css/site.css?v={css_version}" />
<!-- Klickmessung je Aktion (Marko, 19.10.2026): Die Adresse der Seite bleibt ueber alle
     Sponsorenaktionen gleich, darum wuerde GoatCounter sonst alle Aufrufe in einen Topf
     werfen. Diese Funktion haengt den Marker aus ?ref= an den gemeldeten Pfad; fehlt er,
     steht der Schluessel der laufenden Aktion da. In der Statistik erscheinen dadurch
     Zeilen wie "/partner/basketballevent-einladung.html?ref={aktion_slug}". Muss vor dem
     GoatCounter-Skript stehen, sonst ist der Treffer schon gezaehlt. -->
<script>
window.goatcounter = {{ path: function (p) {{
  var r = (new URLSearchParams(location.search).get('ref') || '{aktion_slug}').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  return r ? p + '?ref=' + r : p;
}} }};
</script>
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
<body data-nav-group="partner">
<a class="skip-link" href="#main">Zum Inhalt springen</a>
{header}
"""

FUSS = """{footer}
<script src="/js/vendor/lucide-icons.js?v=1791710586"></script>
<script src="/js/nav.js?v=1791838361"></script>
<script src="/js/include.js?v=1787854261"></script>
{inline}
</body>
</html>
"""


def css_version():
    """Dieselbe Cache-Buster-Nummer wie die uebrigen Seiten, damit eine
    CSS-Aenderung auch hier ankommt."""
    m = re.search(r'/css/site\.css\?v=(\d+)', (REPO / "index.html").read_text(encoding="utf-8"))
    return m.group(1) if m else "1"


def baue_einladung(aktion, spiel, zeit):
    s = aktion["sponsor"]
    gegner = html.escape(spiel["gegner"])
    name = html.escape(s["name"])
    ansprache = html.escape(s.get("ansprache", "Kunde"))
    vip_wort = "zwei" if aktion["vipTickets"] == 2 else str(aktion["vipTickets"])

    description = (f"Firmenevent in Erfurt: {name} lädt Sie zum Basketball-Heimspiel am "
                   f"{zeit['datum']} ein. VIP-Ticket für die Geschäftsführung, Plätze für bis zu "
                   f"{aktion['maMax']} Mitarbeitende.")
    lead = (f"Als {ansprache} von {name} erleben Sie und Ihre Mitarbeitenden das Heimspiel der "
            f"Basketball Löwen Erfurt: {vip_wort} VIP-Tickets für Geschäftsführung und Begleitung, "
            f"Plätze für bis zu {aktion['maMax']} Mitarbeitende, dazu Regelkunde und Meet &amp; Greet "
            f"mit den Profispielern. Für Ihr Unternehmen kostenlos.")

    hero = f"""  <section class="hero-photo hero-firmenevent hero-static">
    <div class="container cc-hero-grid">
      <div class="cc-hero-intro">
        {sponsor_pille(s)}
        <h1><span class="kw">Firmenevent in Erfurt:<span class="swoosh" aria-hidden="true"></span></span> Ihr Team live beim Basketball.</h1>
        <p class="lead">{lead}</p>
      </div>

{spielpanel(spiel, zeit, gegner)}

{formular(aktion, zeit)}
    </div>
  </section>"""

    feature = f"""  <section class="section">
    <div class="container">
      <div class="cc-feature">
        <figure class="cc-feature-photo"><img src="/assets/img/heimspiel-impression-4.webp" width="1200" height="800" loading="lazy" decoding="async" alt="Trainer und Spieler der Basketball Löwen Erfurt besprechen sich in einer Auszeit an der Bank" /></figure>
        <div class="cc-feature-text">
          <span class="eyebrow">Block {aktion['block']}</span>
          <h2 class="t-h2">Direkt über der Bank: das Team hautnah erleben</h2>
          <p class="t-body">Ihre Mitarbeitenden sitzen in Block {aktion['block']}, {aktion['kategorie']}, direkt über der Bank der Löwen. Sie erleben die Mannschaft aus nächster Nähe, auch in den Auszeiten, wenn Trainer und Spieler direkt unter Ihnen die nächsten Spielzüge besprechen.</p>
          <a class="btn btn-outline-orange cc-mdr" href="{MDR_BEITRAG}" target="_blank" rel="noopener"><i data-lucide="play-circle" class="icon-18"></i> So fühlt es sich an: Beitrag im MDR Thüringen Journal</a>
        </div>
      </div>
    </div>
  </section>"""

    umfrage_block = """  <section class="section" id="umfrage">
    <div class="container cc-poll">
      <div class="cc-poll-text">
        <span class="eyebrow">Team-Umfrage</span>
        <h2 class="t-h2">Hey, wer hat Lust mitzukommen?</h2>
        <p class="t-body">Sie wissen noch nicht, wie viele aus Ihrem Team dabei sind? Starten Sie mit einem Klick eine Umfrage und teilen Sie den Link per WhatsApp, E-Mail oder Teams. Ihre Kolleginnen und Kollegen antworten mit zwei Klicks, Sie sehen die Zusagen live und melden Ihr Team danach mit der richtigen Zahl an.</p>
        <ol class="cc-poll-steps">
          <li><span aria-hidden="true">1</span> Umfrage starten und Link teilen</li>
          <li><span aria-hidden="true">2</span> Kolleginnen und Kollegen stimmen ab</li>
          <li><span aria-hidden="true">3</span> Zusagen übernehmen und anmelden</li>
        </ol>
      </div>
      <div class="cc-poll-box">
        <div id="cc-poll-start">
          <h3>Neue Umfrage</h3>
          <p class="t-body-sm">Es sind keine Angaben nötig. Sie bekommen einen Link zum Teilen und einen privaten Link für die Ergebnisse. Hinweise zum Datenschutz stehen in der <a href="/datenschutz.html#team-umfrage">Datenschutzerklärung</a>.</p>
          <button type="button" class="btn btn-primary btn-lg btn-block" id="cc-poll-create">Team-Umfrage starten</button>
          <div class="form-status error" id="cc-poll-error" role="alert"></div>
        </div>
        <div id="cc-poll-share" hidden>
          <h3>Ihre Umfrage läuft</h3>
          <p class="t-body-sm">Teilen Sie diesen Link mit Ihrem Team:</p>
          <div class="cc-copy">
            <input type="text" id="cc-poll-link" readonly aria-label="Link zur Umfrage" />
            <button type="button" class="btn btn-ghost" id="cc-poll-copy">Kopieren</button>
          </div>
          <div class="cc-share-btns">
            <a class="btn btn-primary" id="cc-poll-wa" href="#" target="_blank" rel="noopener"><i data-lucide="message-circle" class="icon-16"></i> WhatsApp</a>
            <a class="btn btn-ghost" id="cc-poll-mail" href="#"><i data-lucide="mail" class="icon-16"></i> E-Mail</a>
          </div>
          <p class="t-body-sm cc-poll-result-note">Ihr privater Link zu den Ergebnissen, nur für Sie. Speichern Sie ihn oder lassen Sie diese Seite offen:</p>
          <a class="btn btn-outline-orange" id="cc-poll-result" href="#" target="_blank" rel="noopener">Ergebnisse ansehen</a>
        </div>
      </div>
    </div>
  </section>"""

    kopf = KOPF.format(
        titel="Firmenevent Erfurt: Basketball live — Basketball Löwen Erfurt",
        description=html.escape(description, quote=True),
        robots="",
        css_version=css_version(),
        aktion_slug=aktion["slug"],
        seo_block=extract_seo_block(EINLADUNG),
        header=extract_platzhalter(EINLADUNG, "header", LEER_HEADER),
    )
    fuss = FUSS.format(
        footer=extract_platzhalter(EINLADUNG, "footer", LEER_FOOTER),
        inline=skript_einladung(aktion, spiel, zeit),
    )
    teile = [hero, feature, erwartung(aktion), umfrage_block, faq(aktion, zeit), slider()]
    return kopf + '<main id="main">\n' + "\n\n".join(teile) + "\n</main>\n" + fuss


def baue_umfrage(aktion, spiel, zeit):
    s = aktion["sponsor"]
    name = html.escape(s["name"])
    gegner = html.escape(spiel["gegner"])

    inhalt = f"""<main id="main">
  <section class="section">
    <div class="container">
      <div class="cc-vote">
        <div class="cc-vote-card" id="cc-admin" hidden style="margin-bottom:24px">
          <span class="eyebrow">Nur für Sie sichtbar</span>
          <h2 class="t-h3">Ergebnis Ihrer Umfrage</h2>
          <div class="cc-results">
            <div class="cc-result-num"><strong id="cc-ja">0</strong><span>Zusagen</span></div>
            <div class="cc-result-num"><strong id="cc-nein">0</strong><span>Absagen</span></div>
          </div>
          <div id="cc-names-wrap" hidden>
            <p class="t-body-sm" style="margin-bottom:6px">Zugesagt haben:</p>
            <ul class="cc-names" id="cc-names"></ul>
          </div>
          <p class="t-body-sm" id="cc-admin-hint" style="margin:0 0 16px"></p>
          <a class="btn btn-primary btn-lg btn-block" id="cc-admin-go" href="/partner/basketballevent-einladung.html#anmeldung">Jetzt anmelden</a>
          <button type="button" class="btn btn-link" id="cc-refresh" style="margin-top:8px">Ergebnis aktualisieren</button>
        </div>

        <div class="cc-vote-card" id="cc-vote-card">
          <span class="eyebrow">Einladung von {name}</span>
          <h1 class="t-h2">Hey, wer hat Lust mitzukommen?</h1>
          <p class="t-body">Unser Unternehmen ist von <a href="{s['website']}" target="_blank" rel="noopener">{name}</a> zum Heimspiel der Basketball Löwen Erfurt eingeladen. Bitte sagen Sie kurz zu oder ab.</p>
          <div class="cc-vote-facts">
            <span>{zeit['wochentag']}, {zeit['datum']} · {zeit['zeit']} Uhr</span>
            <span>{HALLE}, {HALLE_ADRESSE}</span>
            <span>Basketball Löwen Erfurt gegen {gegner}</span>
          </div>

          <div id="cc-vote-form">
            <input type="text" id="cc-vote-website" class="cc-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
            <div class="field">
              <label for="cc-vote-name">Ihr Name (optional)</label>
              <input type="text" id="cc-vote-name" maxlength="60" autocomplete="name" />
            </div>
            <div class="cc-vote-btns">
              <button type="button" class="btn btn-primary btn-lg" data-antwort="ja">Ich bin dabei</button>
              <button type="button" class="btn btn-ghost btn-lg" data-antwort="nein">Leider nicht</button>
            </div>
            <div class="form-status error" id="cc-vote-error" role="alert"></div>
            <p class="cc-vote-note">Ihre Antwort und Ihr Name sind nur für die Person sichtbar, die die Umfrage gestartet hat. Mehr dazu in der <a href="/datenschutz.html#team-umfrage">Datenschutzerklärung</a>.</p>
          </div>

          <div id="cc-vote-done" hidden>
            <h2 class="t-h4" id="cc-vote-done-title">Danke für Ihre Antwort.</h2>
            <p class="t-body" id="cc-vote-done-text">Ihre Antwort ist angekommen.</p>
          </div>
          <div id="cc-vote-unknown" hidden>
            <h2 class="t-h4">Diese Umfrage gibt es nicht</h2>
            <p class="t-body">Bitte prüfen Sie den Link, den Sie erhalten haben.</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
"""

    kopf = KOPF.format(
        titel="Wer kommt mit? Team-Umfrage — Basketball Löwen Erfurt",
        description=html.escape(
            f"Team-Umfrage zur Einladung von {s['name']}: Wer kommt am {zeit['datum']} mit zum "
            f"Heimspiel der Basketball Löwen Erfurt?", quote=True),
        robots='<meta name="robots" content="noindex, follow" />\n',
        css_version=css_version(),
        aktion_slug=aktion["slug"],
        seo_block=extract_seo_block(UMFRAGE),
        header=extract_platzhalter(UMFRAGE, "header", LEER_HEADER),
    )
    fuss = FUSS.format(
        footer=extract_platzhalter(UMFRAGE, "footer", LEER_FOOTER),
        inline=skript_umfrage(aktion),
    )
    return kopf + inhalt + fuss


def skript_umfrage(aktion):
    """Abstimmungsseite. Uebernimmt die Logik der crestcom-Fassung eins zu eins,
    nur die Webhook-Namen sind generisch und tragen den Schluessel der Aktion.

    Die Seite bedient zwei Rollen in einem Dokument: Wer nur ?u= im Link hat,
    sieht die Abstimmung; wer zusaetzlich den privaten Schluessel ?k= hat (die
    Person, die die Umfrage gestartet hat), sieht darueber das Ergebnis."""
    return f"""<script>
(function () {{
  var API = 'https://ticketing.basketball-loewen.com/webhook/';
  var AKTION = '{quote(aktion["slug"])}';
  var MA_MIN = {aktion['maMin']};
  var MA_MAX = {aktion['maMax']};
  var params = new URLSearchParams(location.search);
  var id = (params.get('u') || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
  var token = (params.get('k') || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
  var geladen = Date.now();
  var voteForm = document.getElementById('cc-vote-form');
  var unknown = document.getElementById('cc-vote-unknown');
  var errorBox = document.getElementById('cc-vote-error');

  function zeigeUnbekannt() {{ voteForm.hidden = true; document.getElementById('cc-vote-done').hidden = true; unknown.hidden = false; }}
  if (!id) {{ zeigeUnbekannt(); return; }}

  function ergebnis() {{
    fetch(API + 'firmenevent-umfrage-ergebnis?aktion=' + encodeURIComponent(AKTION) + '&id=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(token))
      .then(function (r) {{ return r.json(); }}).then(function (e) {{
        if (!e.exists) {{ zeigeUnbekannt(); return; }}
        if (!e.admin) return;
        var ja = e.ja || 0;
        document.getElementById('cc-ja').textContent = ja;
        document.getElementById('cc-nein').textContent = e.nein || 0;
        var liste = document.getElementById('cc-names');
        liste.textContent = '';
        (e.namen || []).forEach(function (n) {{ var li = document.createElement('li'); li.textContent = n; liste.appendChild(li); }});
        document.getElementById('cc-names-wrap').hidden = !(e.namen && e.namen.length);
        var go = document.getElementById('cc-admin-go');
        var hint = document.getElementById('cc-admin-hint');
        if (ja >= 1) {{
          var ma = Math.max(MA_MIN, Math.min(MA_MAX, ja));
          go.href = '/partner/basketballevent-einladung.html?ma=' + ma + '&u=' + encodeURIComponent(id) + '#anmeldung';
          go.textContent = ja >= MA_MIN ? 'Mit ' + ma + ' Mitarbeitenden anmelden' : 'Jetzt anmelden';
          hint.textContent = ja < MA_MIN
            ? 'Für die Anmeldung gelten mindestens ' + MA_MIN + ' Mitarbeitende. Die Zahl lässt sich im Formular anpassen.'
            : 'Die Zahl der Zusagen übernehmen wir ins Formular. Sie können sie dort noch ändern.';
        }} else {{
          go.href = '/partner/basketballevent-einladung.html?u=' + encodeURIComponent(id) + '#anmeldung';
          go.textContent = 'Zur Anmeldung';
          hint.textContent = 'Noch keine Zusagen. Teilen Sie den Link der Umfrage noch einmal im Team.';
        }}
        document.getElementById('cc-admin').hidden = false;
      }}).catch(function () {{ /* Ergebnis bleibt ausgeblendet */ }});
  }}
  ergebnis();
  document.getElementById('cc-refresh').addEventListener('click', ergebnis);

  function fertig(antwort) {{
    voteForm.hidden = true;
    document.getElementById('cc-vote-done').hidden = false;
    document.getElementById('cc-vote-done-title').textContent = antwort === 'ja' ? 'Schön, dass Sie dabei sind.' : 'Schade, vielleicht beim nächsten Mal.';
    document.getElementById('cc-vote-done-text').textContent = antwort === 'ja'
      ? 'Ihre Zusage ist angekommen. Die Person, die die Umfrage gestartet hat, meldet sich mit den weiteren Infos.'
      : 'Ihre Absage ist angekommen. Danke für die schnelle Rückmeldung.';
  }}

  // Der Schluessel traegt die Aktion, damit eine Stimme aus einer frueheren
  // Aktion die neue Abstimmung nicht als "schon abgestimmt" ausblendet.
  var SPEICHER = 'feStimme_' + AKTION + '_' + id;
  try {{
    var frueher = localStorage.getItem(SPEICHER);
    if (frueher) fertig(frueher);
  }} catch (err) {{ /* ohne Speicher einfach abstimmen lassen */ }}

  var buttons = voteForm.querySelectorAll('[data-antwort]');
  Array.prototype.forEach.call(buttons, function (btn) {{
    btn.addEventListener('click', function () {{
      var antwort = btn.getAttribute('data-antwort');
      errorBox.classList.remove('visible');
      Array.prototype.forEach.call(buttons, function (b) {{ b.disabled = true; }});
      fetch(API + 'firmenevent-umfrage-stimme', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          aktion: AKTION,
          umfrage: id,
          name: document.getElementById('cc-vote-name').value.trim(),
          antwort: antwort,
          website: document.getElementById('cc-vote-website').value,
          elapsedMs: Date.now() - geladen
        }})
      }}).then(function (r) {{ return r.json(); }}).then(function (a) {{
        if (a.ok) {{
          try {{ localStorage.setItem(SPEICHER, antwort); }} catch (err) {{ /* egal */ }}
          fertig(antwort);
          ergebnis();
          return;
        }}
        if (a.grund === 'unbekannt') {{ zeigeUnbekannt(); return; }}
        throw new Error('abgelehnt');
      }}).catch(function () {{
        errorBox.textContent = 'Das hat leider nicht geklappt. Bitte versuchen Sie es noch einmal.';
        errorBox.classList.add('visible');
        Array.prototype.forEach.call(buttons, function (b) {{ b.disabled = false; }});
      }});
    }});
  }});
}})();
</script>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    aktion, spiel = lade_aktion()
    aktion["_seiteSlug"] = spiel["seiteSlug"]
    zeit = datum_teile(spiel, aktion)

    geschrieben = 0
    for pfad, neu in ((EINLADUNG, baue_einladung(aktion, spiel, zeit)),
                      (UMFRAGE, baue_umfrage(aktion, spiel, zeit))):
        alt = pfad.read_text(encoding="utf-8") if pfad.exists() else None
        if alt == neu:
            continue
        geschrieben += 1
        if args.check:
            print(f"  zu bauen: {pfad.relative_to(REPO)}")
            continue
        pfad.parent.mkdir(parents=True, exist_ok=True)
        pfad.write_text(neu, encoding="utf-8")
        print(f"  geschrieben: {pfad.relative_to(REPO)}")

    print(f"  Aktion „{aktion['slug']}“ ({aktion['sponsor']['name']}), Spiel {spiel['datum']} "
          f"gegen {spiel['gegner']} — {geschrieben} von 2 Seiten "
          f"{'zu ändern' if args.check else 'geschrieben'}")
    return 1 if (args.check and geschrieben) else 0


if __name__ == "__main__":
    sys.exit(main())
