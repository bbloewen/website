#!/usr/bin/env python3
"""Schreibt die Leistungen der Pakete (Bundles) aus data/pakete.json in die Seiten.

Warum: Die Pakete (Club 100, Löwenstarker Partner, weitere Bundles) pflegt 305 im
Produktkatalog › Konfiguration (crm-db Migration 594–596, Marko 28.11.2026). Beim Klick auf
„Auf der Website veröffentlichen“ legt n8n („305: Website“) data/pakete.json ab; dieses
Skript baut daraus feste HTML-Blöcke, damit die Leistungen ohne JavaScript im
ausgelieferten HTML stehen.

Platzhalter in den Seiten (auch in partials/):
  <!--PAKET:BU-CLUB100--><!--/PAKET:BU-CLUB100-->      ganzer Abschnitt mit den Leistungen
  <span data-paket="BU-CLUB100" data-feld="preis_monat">49,00 €</span>   einzelner Preis
    (Felder: preis, preis_monat, budget, vip_preis)
Ohne data/pakete.json bleibt alles, wie es ist.

Aufruf:
  python3 tools/build-pakete.py
  python3 tools/build-pakete.py --check
"""

import argparse
import json
import re
import sys

from seo_common import REPO, esc

DATEN = REPO / "data" / "pakete.json"
AUSLASSEN = {"_import", "node_modules", ".git", "assets", "data", "tools", "docs"}


def euro(v):
    if v is None or v == "":
        return ""
    s = f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def datum(stand):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(stand or ""))
    return f"{m.group(3)}.{m.group(2)}.{m.group(1)}" if m else ""


def liste(bausteine, preis_feld=None, praefix=""):
    zeilen = []
    for b in bausteine:
        preis = ""
        if preis_feld and b.get(preis_feld) not in (None, ""):
            preis = f'<span class="paket-preis">{esc(praefix + euro(b[preis_feld]))}</span>'
        text = f'<span class="paket-text">{esc(b["text"])}</span>' if b.get("text") else ""
        zeilen.append(f'<li><span class="paket-kopf"><span class="paket-titel">{esc(b.get("titel", ""))}</span>{preis}</span>{text}</li>')
    return "<ul class=\"paket-liste\">" + "".join(zeilen) + "</ul>"


def abschnitt(p, stand):
    karten = []
    if p.get("standard"):
        karten.append(("Immer dabei", "", liste(p["standard"])))
    if p.get("wahl"):
        if p.get("budget") not in (None, ""):
            intro = f"Leistungen im Wert von bis zu {euro(p['budget'])} sind inklusive. Darüber hinaus gilt der Aufpreis."
        elif p.get("wahl_anzahl"):
            intro = f"{p['wahl_anzahl']} Leistungen nach Wahl sind inklusive."
        else:
            intro = "Leistungen nach Wahl."
        karten.append(("Ihre Wahl im Paket", intro, liste(p["wahl"], "listenpreis", "Wert ")))
    if p.get("aufpreis"):
        karten.append(("Zusätzlich buchbar", "", liste(p["aufpreis"], "preis")))
    if p.get("preis_monat") not in (None, "") and p.get("preis") not in (None, ""):
        preis = f"{euro(p['preis'])} pro Saison, das sind {euro(p['preis_monat'])} im Monat"
    elif p.get("preis") not in (None, ""):
        preis = f"{euro(p['preis'])} pro Saison"
    else:
        preis = ""
    if p.get("vip_preis") not in (None, ""):
        preis += f"; jede weitere VIP-Dauerkarte {euro(p['vip_preis'])}"
    k_html = "".join(
        f'<div class="card paket-karte"><div class="card-body"><h3 class="t-h4">{esc(t)}</h3>'
        + (f'<p class="t-body-sm paket-intro">{esc(i)}</p>' if i else "") + l + "</div></div>"
        for t, i, l in karten)
    return (
        f'<section class="section paket-leistungen" id="leistungen" data-bundle="{esc(p["bundle"])}" style="scroll-margin-top:96px">'
        '<div class="container">'
        '<span class="eyebrow">Leistungen</span>'
        f'<h2 class="t-h2">Das steckt im <span class="kw">Paket</span>.</h2>'
        f'<p class="t-h4" style="margin:4px 0 0">{esc(p.get("name", ""))}</p>'
        + (f'<p class="t-body-sm">{esc(preis)} (netto, zzgl. MwSt.).</p>' if preis else "")
        + f'<div class="paket-raster">{k_html}</div>'
        f'<p class="t-caption paket-stand">Alle Preise netto, zzgl. MwSt. Stand: {esc(datum(stand))}.</p>'
        '</div>'
        '<style>.paket-raster{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:16px}'
        '.paket-liste{list-style:none;margin:8px 0 0;padding:0}.paket-liste li{padding:8px 0;border-top:1px solid var(--border-subtle,#e5e7eb)}'
        '.paket-liste li:first-child{border-top:0}.paket-kopf{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.paket-titel{font-weight:600}.paket-preis{white-space:nowrap;font-variant-numeric:tabular-nums}'
        '.paket-text{display:block;font-size:.875rem;color:var(--text-secondary)}.paket-intro{margin:4px 0 0;color:var(--text-secondary)}.paket-stand{margin-top:12px;color:var(--text-muted)}</style>'
        '</section>'
    )


def bearbeite(text, pakete, stand):
    def block(m):
        code = m.group(1)
        p = pakete.get(code)
        inhalt = abschnitt(p, stand) if p else ""
        return f"<!--PAKET:{code}-->{inhalt}<!--/PAKET:{code}-->"
    text = re.sub(r"<!--PAKET:([A-Za-z0-9._-]+)-->.*?<!--/PAKET:\1-->", block, text, flags=re.S)

    def feld(m):
        code, f = m.group(2), m.group(3)
        p = pakete.get(code)
        wert = euro(p.get(f)) if p and p.get(f) not in (None, "") else m.group(4)
        return f"{m.group(1)}{wert}</span>"
    return re.sub(r'(<span data-paket="([A-Za-z0-9._-]+)" data-feld="([a-z_]+)">)([^<]*)</span>', feld, text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if not DATEN.exists():
        print("  keine data/pakete.json, nichts zu tun")
        return 0
    d = json.loads(DATEN.read_text(encoding="utf-8"))
    pakete = {p["bundle"]: p for p in d.get("pakete", [])}
    zu_aendern = []
    for datei in sorted(REPO.rglob("*.html")):
        if set(datei.relative_to(REPO).parts) & AUSLASSEN:
            continue
        alt = datei.read_text(encoding="utf-8")
        if "<!--PAKET:" not in alt and "data-paket=" not in alt:
            continue
        neu = bearbeite(alt, pakete, d.get("stand"))
        if neu != alt:
            zu_aendern.append(datei)
            if not args.check:
                datei.write_text(neu, encoding="utf-8")
    if not zu_aendern:
        print(f"  unverändert, {len(pakete)} Paket(e)")
        return 0
    if args.check:
        print("  zu ändern: " + ", ".join(str(x.relative_to(REPO)) for x in zu_aendern))
        return 1
    print(f"  geschrieben: {len(zu_aendern)} Seite(n), {len(pakete)} Paket(e)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
