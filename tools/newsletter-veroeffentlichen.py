#!/usr/bin/env python3
"""Baut die Webfassung einer Löwen-Post-Ausgabe und trägt sie ins Archiv ein (Marko 24.11.2026).

Quelle: data/newsletter-eingang/<ausgabe>.json, abgelegt von n8n nach dem Versand aus 305
(crm-db Migration 521, loewen_post_archiv_offen). Inhalt: ausgabe (JJJJ-MM), nr, monat, betreff,
versendet_am (JJJJ-MM-TT) und bausteine (dieselben Rubriken wie in der Mail: Karten, Liste, Text,
höchstens ein CTA je Rubrik).

Ergebnis:
  news/newsletter/<ausgabe>_ausgabe-<nr>.html   Webfassung im Seitenlayout (Kopf, Fuß, Zählskripte von feedback.html)
  data/newsletter-archiv.json                    Eintrag {datum, titel, teaser, url}, neueste zuerst
Danach baut tools/build-newsletter-archiv.py die Liste „Vergangene Ausgaben“ statisch.

Idempotent: jeder Lauf baut alle Ausgaben im Eingang neu.

Aufruf:
  python3 tools/newsletter-veroeffentlichen.py            # alle Ausgaben im Eingang
  python3 tools/newsletter-veroeffentlichen.py <datei>    # nur diese
"""

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EINGANG = REPO / "data" / "newsletter-eingang"
ARCHIV = REPO / "data" / "newsletter-archiv.json"
VORLAGE = REPO / "news" / "newsletter" / "feedback.html"
SEITE = "https://basketball-loewen.com"


def esc(s):
    return (str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def du(s):
    # [[du|Sie]] -> du-Fassung (die Webfassung spricht wie die Mail mit Du an)
    return re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\1", str(s or ""))


def absatz(s):
    teile = [x.strip() for x in re.split(r"\n\s*\n", du(s)) if x.strip()]
    return "".join('<p class="t-body mt-2">' + re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", esc(x)).replace("\n", "<br>") + "</p>" for x in teile)


def url(u):
    u = str(u or "").strip()
    return u if re.match(r"^https://[^\s\"<>]+$", u) else ""


def karte(k):
    bild = url(k.get("bild"))
    zeile = f'<span class="card-label">{esc(du(k["zeile"]))}</span>' if k.get("zeile") else ""
    titel = f'<h3 style="font-size:20px;margin:6px 0 0">{esc(du(k["titel"]))}</h3>' if k.get("titel") else ""
    inhalt = zeile + titel + absatz(k.get("text"))
    if bild and k.get("bild_klein"):
        return (f'<div class="card" style="display:flex;gap:16px;padding:16px;margin-top:12px;align-items:flex-start">'
                f'<img src="{esc(bild)}" alt="{esc(k.get("bild_alt") or k.get("titel") or "")}" loading="lazy" style="width:120px;height:auto;border-radius:8px;flex:none">'
                f'<div>{inhalt}</div></div>')
    dunkel = ' style="background:var(--color-navy,#00122D);color:#fff;margin-top:12px;overflow:hidden;padding:0"' if k.get("dunkel") else ' style="margin-top:12px;overflow:hidden;padding:0"'
    bild_html = f'<img src="{esc(bild)}" alt="{esc(k.get("bild_alt") or k.get("titel") or "")}" loading="lazy" style="display:block;width:100%;height:auto">' if bild else ""
    farbe = ' style="padding:18px 20px;color:#fff"' if k.get("dunkel") else ' style="padding:18px 20px"'
    return f'<div class="card"{dunkel}>{bild_html}<div{farbe}>{inhalt}</div></div>'


def rubrik(r, grau):
    if r.get("an") is False or r.get("art") == "feedback":
        return ""
    karten = [k for k in (r.get("karten") or []) if k.get("an") is not False and (k.get("titel") or k.get("text") or k.get("bild"))]
    liste = r.get("liste") or []
    if not karten and not liste and not r.get("text"):
        return ""
    teile = str(r.get("titel") or "").split(" · ")
    sw = r.get("art") == "schwerpunkt"
    banner = (f'<div style="display:flex;margin-bottom:4px"><span style="width:6px;flex:none;background:{"#00122D" if sw else "#E5710B"}"></span>'
              f'<h2 style="flex:1;margin:0;background:{"#B55709" if sw else "#00122D"};color:#fff;padding:12px 16px;font-size:18px;letter-spacing:.04em;text-transform:uppercase">'
              f'{esc(du(teile[0]))}' + (f'<span style="font-weight:400;text-transform:none;letter-spacing:0;color:{"#FFE3C7" if sw else "#F7A35C"}"> &nbsp;{esc(du(" · ".join(teile[1:])))}</span>' if len(teile) > 1 else "") + "</h2></div>")
    h = banner + "".join(karte(k) for k in karten)
    if liste:
        if r.get("liste_titel"):
            h += f'<h3 style="font-size:17px;margin:18px 0 6px">{esc(du(r["liste_titel"]))}</h3>'
        zeilen = ""
        for z in liste:
            m = z.get("marke")
            kreis = (f'<span aria-label="{"Sieg" if m == "S" else "Niederlage"}" style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border:1.5px solid {"#067647" if m == "S" else "#B42318"};color:{"#067647" if m == "S" else "#B42318"};border-radius:50%;font-size:11px;font-weight:700">{m}</span>' if m in ("S", "N") else "")
            zeilen += f'<tr><td style="width:30px;padding:5px 0">{kreis}</td><td style="padding:5px 8px 5px 0">{esc(du(z.get("text")))}</td><td style="padding:5px 0;text-align:right;font-weight:700;white-space:nowrap">{esc(du(z.get("wert")))}</td></tr>'
        h += f'<table style="width:100%;border-collapse:collapse">{zeilen}</table>'
    if r.get("text"):
        h += f'<div style="margin-top:14px">{absatz(r["text"])}</div>'
    c = r.get("cta") or {}
    if url(c.get("link")) and str(c.get("text") or "").strip():
        klasse = "btn btn-primary" if c.get("stil") == "voll" else "btn btn-outline-orange"
        h += f'<div style="text-align:center;margin-top:28px"><a class="{klasse}" href="{esc(url(c["link"]))}">{esc(du(c["text"]))}</a></div>'
    hintergrund = "background:#EEF1F6;" if grau else ""
    return f'<section class="section" style="{hintergrund}padding:32px 0"><div class="container container-narrow">{h}</div></section>'


def datum_de(iso):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    return f"{m.group(3)}.{m.group(2)}.{m.group(1)}" if m else ""


def seite(a):
    b = a["bausteine"]
    ausgabe, nr, monat = a["ausgabe"], a.get("nr") or b.get("nr") or 1, a.get("monat") or b.get("monat") or ""
    titel = f"Löwen-Post {monat}".strip()
    einstieg = du(b.get("einstieg") or "")
    teaser = re.split(r"(?<=[.!?])\s", einstieg.strip())[0] if einstieg else ""
    teaser = teaser[:1].upper() + teaser[1:]
    v = VORLAGE.read_text(encoding="utf-8")
    v = re.sub(r"<title>.*?</title>", f"<title>{esc(titel)} — Basketball Löwen Erfurt</title>", v, count=1, flags=re.S)
    v = re.sub(r'<meta name="description" content="[^"]*" />', f'<meta name="description" content="{esc((titel + ": " + teaser)[:155])}" />', v, count=1)
    v = v.replace('<meta name="robots" content="noindex, nofollow" />', '<meta name="robots" content="index, follow" />')
    i, j = v.index('<main id="main">'), v.index("</main>") + len("</main>")
    kopf = (f'<section class="section" style="padding-bottom:16px"><div class="container container-narrow">'
            f'<span class="eyebrow">Löwen-Post · Ausgabe {esc(nr)} · {esc(datum_de(a.get("versendet_am")))}</span>'
            f'<h1 class="t-h2" style="margin:8px 0 12px">Die Löwen-<span class="kw">Post</span>.</h1>'
            f'<p class="t-body"><b>{esc(monat)}</b></p><p class="t-body mt-2">Liebe Löwen-Fans,</p>{absatz(einstieg)}</div></section>')
    rubriken, grau = "", True
    for r in b.get("rubriken") or []:
        x = rubrik(r, grau)
        if x:
            rubriken += x
            grau = not grau
    gruss = du(b.get("gruss") if b.get("gruss") is not None else "Viele Grüße vom Parkett\nMarko\nBasketball Löwen Erfurt")
    fuss = (f'<section class="section" style="padding:28px 0"><div class="container container-narrow">'
            + (f'<p class="t-body"><b>{esc(gruss.splitlines()[0])}</b><br>' + "<br>".join(esc(x) for x in gruss.splitlines()[1:]) + "</p>" if gruss.strip() else "")
            + '<p class="t-body mt-4"><a href="/news/newsletter/">Alle Ausgaben und Anmeldung zur Löwen-Post</a></p></div></section>')
    main = '<main id="main">' + kopf + rubriken + fuss + "</main>"
    v = v[:i] + main + v[j:]
    # das Feedback-Skript der Vorlage gehört nicht in die Webfassung
    v = re.sub(r"<script>\s*// Feedback aus der Löwen-Post.*?</script>", "", v, flags=re.S)
    return titel, teaser, v


def main():
    dateien = [Path(x) for x in sys.argv[1:]] or sorted(EINGANG.glob("*.json"))
    archiv = json.loads(ARCHIV.read_text(encoding="utf-8")) if ARCHIV.exists() else {"ausgaben": []}
    ausgaben = {x.get("url"): x for x in archiv.get("ausgaben", [])}
    for d in dateien:
        a = json.loads(d.read_text(encoding="utf-8"))
        if not re.match(r"^\d{4}-\d{2}$", a.get("ausgabe", "")) or (a.get("bausteine") or {}).get("art") != "loewen-post":
            print("übersprungen:", d)
            continue
        nr = a.get("nr") or a["bausteine"].get("nr") or 1
        rel = f"news/newsletter/{a['ausgabe']}_ausgabe-{nr}.html"
        titel, teaser, html = seite(a)
        (REPO / rel).write_text(html, encoding="utf-8")
        ausgaben["/" + rel] = {"datum": datum_de(a.get("versendet_am")), "titel": titel, "teaser": teaser, "url": "/" + rel, "ausgabe": a["ausgabe"]}
        print("gebaut:", rel)
    archiv["ausgaben"] = sorted(ausgaben.values(), key=lambda x: x.get("ausgabe") or x.get("url"), reverse=True)
    ARCHIV.write_text(json.dumps(archiv, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    subprocess.run([sys.executable, str(REPO / "tools" / "build-newsletter-archiv.py")], check=True)


if __name__ == "__main__":
    main()
