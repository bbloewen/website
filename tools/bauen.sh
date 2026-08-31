#!/bin/sh
# Ganze Baukette in der Reihenfolge, in der sie laufen muss.
#
# Die Reihenfolge ist nicht beliebig:
#   1. Seitengeneratoren zuerst — sie schreiben ganze Seiten bzw. Bloecke neu.
#   2. build-partials.py danach, es kopiert Header/Footer in jede Seite.
#   3. build-bildmasse.py NACH allen Generatoren: die schreiben ihre Kacheln ohne
#      width/height zurueck, die Masse muessen also zuletzt drauf.
#   4. build-head-meta.py und build-sitemap.py am Ende, sie lesen Titel,
#      Description und noindex der fertigen Seiten.
#   build-lucide-icons und build-galerie-thumbs stehen vorn: sie erzeugen
#   Dateien (Icon-Buendel, Vorschaubilder), auf die die Seiten dann verweisen.
#
# --check reicht das Flag an alle Skripte weiter (schreibt nichts).
set -e
cd "$(dirname "$0")/.."
F="$1"
for s in build-lucide-icons build-galerie-thumbs \
         build-gameday-hub build-spieltagsseiten build-freiplatz-seiten \
         build-partner-wall build-trainingszeiten-liste build-home-news \
         build-spielplan-liste build-news-list build-freiplaetze \
         build-instagram-archiv build-partials build-bildmasse \
         build-head-meta build-sitemap; do
  printf '%s\n' "$s"
  python3 "tools/$s.py" $F
done
