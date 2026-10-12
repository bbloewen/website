# Hinweise für Claude in diesem Repo (Basketball Löwen Erfurt)

Dieses Repo ist die Webseite basketball-loewen.com (statisches HTML/CSS/JS auf GitHub Pages,
Python-Generatoren unter `tools/`, Automatisierung in n8n, Inhalte in Notion). Marko schreibt Deutsch.
Merge, Veröffentlichen und alles mit Außenwirkung erst auf seine ausdrückliche Ansage.

## Dauerkartenpreise: Regel und die vier Stellen

**Regel (Stand 12.10.2026, seit dem Tag automatisiert):** Dauerkarte = Ausgangspreis × (verbleibende Heimspiele − 1) / 13,
aufgerundet auf volle Euro. Die Saison hat 14 Heimspiele, ursprünglich „14 zum Preis von 13“. Ein Heimspiel
„verbleibt“, bis es 4 Stunden nach Anpfiff vorbei ist (wie beim Umschalten des Game Hubs). **Nach jedem
gespielten Heimspiel sinkt jeder Preis um einen weiteren Einzelpreis, ohne dass jemand etwas tun muss.**
Stand nach dem ersten Heimspiel (Basispreis, vor 30 % Mitgliedsrabatt): Kategorie 1 / ermäßigt 192 / 168,
Kategorie 2 144 / 107, Kategorie 3 126 / 96 / Kinder 60, Fanblock 126 / 96, Rollstuhl 96, VIP 1.191 / 457.

Kategorie 2 ermäßigt (115, nicht 13 × 8,50) und VIP (eigener Anker, Catering) liegen nicht auf der Einzelpreis-
Regel; sie werden anteilig gekürzt, ebenfalls **aufgerundet auf volle Euro** (Entscheidung Marko, 12.10.2026).

**Gerechnet wird nur an einer Stelle:** `tools/build-dauerkartenpreise.py` schreibt `data/dauerkarte-preise.json`
(Blöcke `stand`, `preise`) und die `data-base`-Werte in `tickets/dauerkarte.html`. Von Hand gepflegt wird nur der
Block `basis` (Ausgangspreise) in der JSON. Das Skript läuft im Workflow `spieltagsseiten-nachbauen.yml` (täglich
und alle 20 Minuten am Abend, vor dem Hub-Bau) und in `tools/bauen.sh`. Die Leser:

1. `tickets/dauerkarte.html` (das `prices`-Objekt liest die `data-base`-Werte) und der Game Hub (liest `data-base`).
2. n8n „Ticketing: Bestellprozess - Dauerkartenbestellung verarbeiten“ (`HyUXW4kbhaQVbG0A`): Node
   „Dauerkartenpreise laden“ holt die JSON, „Preis serverseitig berechnen“ rechnet damit (Rückfallliste bei
   Fehler), „Mitgliedsrabatt verifizieren“ nutzt dieselbe Tabelle. **Änderungen am Workflow erst nach `publish_workflow`.**
3. n8n „Dauerkarten: pretix-Standardpreise nachziehen“ (`Tgrxrv7iFW5WP8nd`, alle 30 Minuten): setzt `default_price`
   der Dauer-Items 37 bis 47 und ihrer Variationen in pretix, nur bei Abweichung. Item 91 (Stehplatz-Dauer) bleibt 0 €.
4. Doku: `TICKETING-BACKEND.md` und in Notion „Ticketing/ Sitzplan & Bestellungen“, „Ticketpreise 2026/27“
   (die Notion-Seite „Themen-Spieltage“ nennt ebenfalls Preise).

**Ändert sich die Regel oder ein Ausgangspreis, nur `basis` bzw. das Skript anfassen**, dann
`python3 tools/build-dauerkartenpreise.py` laufen lassen und vorher bei Marko bestätigen. Gespielte Heimspiele
schließt der Knoten „Ausgeschlossene Subevents ermitteln“ aus neuen Dauerkarten aus; bestehende Dauerkarten
bleiben unberührt.

## Weitere feste Regeln

- **n8n:** Änderungen an einem aktiven Workflow wirken erst nach `publish_workflow`. HTTP-Knoten bekommen
  ihre Zugangsdaten nicht automatisch, `credentials` mit ID mitgeben. Temporäre Test-Workflows danach archivieren.
- **Generatoren** (`tools/*.py`) lesen nur git-getrackte Dateien: neue Dateien erst `git add`, dann bauen.
  `tools/bauen.sh` verändert nebenbei Pressepakete (`assets/presse/*.zip`) und Instagram-Archivseiten;
  die gehören nicht in fremde PRs.
- **News-Artikel** laufen über den Skill `.claude/skills/news-artikel` und die Notion-Mediaplanung
  (Status Text fertig → Bereit zum Review → Freigegeben → Veröffentlicht, setzt nur der Workflow).
  Immer „Basketball Löwen Erfurt“ in Titel/Lead und erster Nennung, eigene Links in Notion voll ausschreiben.
- **Datum nie raten:** Wochentag und Datum ausrechnen und bestätigen lassen.
