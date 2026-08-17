#!/usr/bin/env python3
"""Erzeugt sitemap.xml aus dem tatsächlichen Repo-Stand.

Warum ein Generator statt Handpflege: die handgepflegte Sitemap war am 17.08.2026
um 8 Seiten hinterher (satzung.html, beitragsordnung.html, der Artikel zum neuen
Cheftrainer, 5 Insta-Archiv-Seiten). Bei jeder neuen Seite driftet sie erneut.

Regeln:
  * nur von Git verfolgte *.html (siehe seo_common.py) — lokale Arbeitsartefakte
    draußen, ohne dass man an eine Ausnahmeliste denken muss
  * partials/ nie (Header/Footer-Fragmente, werden per include.js eingebunden)
  * Seiten mit noindex im <head> automatisch raus (Checkout, Zahlung, Bestätigung,
    Newsletter-Bestätigung, interne Suche, Platzhalter-Templates)
  * <lastmod> aus dem letzten Commit der Datei
  * index.html wird zur Verzeichnisform (news/newsletter/ statt
    news/newsletter/index.html), das Root-index.html zu /

Aufruf:
  python3 tools/build-sitemap.py            # schreibt sitemap.xml
  python3 tools/build-sitemap.py --check    # schreibt nichts, zeigt nur die Differenz
                                            # Exitcode 1, wenn Abweichung besteht
"""

import argparse
import re
import subprocess
import sys
from datetime import date, datetime

from seo_common import BASE, REPO, tracked_html, is_indexable, url_path

SITEMAP = REPO / "sitemap.xml"

# priority: erste passende Regel gewinnt
PRIORITY_RULES = [
    (lambda p: p == "", "1.0"),                          # Startseite
    (lambda p: p.startswith("news/insta-archiv/"), "0.5"),  # gespiegelte Insta-Posts
]
DEFAULT_PRIORITY = "0.7"


def lastmod(rel):
    """Datum des letzten Commits; Fallback Dateimtime für noch nicht committete Seiten."""
    out = subprocess.run(
        ["git", "log", "-1", "--format=%cI", "--", rel],
        cwd=REPO, capture_output=True, text=True,
    ).stdout.strip()
    if out:
        return out[:10]
    ts = (REPO / rel).stat().st_mtime
    return datetime.fromtimestamp(ts).date().isoformat()


def priority(path):
    for matches, value in PRIORITY_RULES:
        if matches(path):
            return value
    return DEFAULT_PRIORITY


def build():
    entries = []
    for rel in tracked_html():
        if not is_indexable(rel):
            continue
        path = url_path(rel)
        entries.append((path, lastmod(rel), priority(path)))
    # Startseite zuerst, danach alphabetisch — stabile Diffs
    entries.sort(key=lambda e: (e[0] != "", e[0]))

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path, mod, prio in entries:
        lines += [
            "  <url>",
            f"    <loc>{BASE}{path}</loc>",
            f"    <lastmod>{mod}</lastmod>",
            f"    <priority>{prio}</priority>",
            "  </url>",
        ]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n", entries


def existing_locs():
    if not SITEMAP.exists():
        return set()
    return set(re.findall(r"<loc>(.*?)</loc>", SITEMAP.read_text(encoding="utf-8")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="nur vergleichen, nichts schreiben")
    args = ap.parse_args()

    xml, entries = build()
    new = {f"{BASE}{p}" for p, _, _ in entries}
    old = existing_locs()

    added, removed = sorted(new - old), sorted(old - new)
    for u in added:
        print(f"  + {u}")
    for u in removed:
        print(f"  - {u}")
    if not added and not removed:
        print("  keine URL-Änderung")

    missing_lastmod = [p for p, m, _ in entries if not m]
    if missing_lastmod:
        print(f"WARNUNG: {len(missing_lastmod)} Einträge ohne lastmod", file=sys.stderr)

    print(f"\n{len(entries)} indexierbare URLs "
          f"(+{len(added)} / -{len(removed)} gegenüber sitemap.xml)")

    if args.check:
        changed = bool(added or removed) or (
            SITEMAP.exists() and SITEMAP.read_text(encoding="utf-8") != xml
        )
        if changed:
            print("sitemap.xml ist nicht aktuell — ohne --check neu erzeugen.")
        return 1 if changed else 0

    SITEMAP.write_text(xml, encoding="utf-8")
    print(f"sitemap.xml geschrieben ({date.today().isoformat()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
