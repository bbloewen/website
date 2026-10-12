# Hinweise für Claude in diesem Repo (Basketball Löwen Erfurt)

Dieses Repo ist die Webseite basketball-loewen.com (statisches HTML/CSS/JS auf GitHub Pages,
Python-Generatoren unter `tools/`, Automatisierung in n8n, Inhalte in Notion). Marko schreibt Deutsch.
Merge, Veröffentlichen und alles mit Außenwirkung erst auf seine ausdrückliche Ansage.

## Dauerkartenpreise: Regel und die vier Stellen

**Regel (Stand 12.10.2026):** Dauerkarte = Einzelpreis × (verbleibende Heimspiele − 1). Die Saison hat
14 Heimspiele; ursprünglich „14 zum Preis von 13“ (× 13). Nach dem ersten gespielten Heimspiel (11.10.)
gilt × 12, **nach jedem weiteren gespielten Heimspiel sinkt jeder Preis um einen weiteren Einzelpreis.**
Das nächste Mal nach dem Spiel am 18.10. Aktuell (Basispreis, vor 30 % Mitgliedsrabatt):

| Tarif | Preis | Einzelpreis |
|---|---|---|
| Kategorie 1 / ermäßigt | 192 / 168 | 16 / 14 |
| Kategorie 2 / ermäßigt | 144 / 107 | 12 / 8,50 |
| Kategorie 3 / ermäßigt / Kinder | 126 / 96 / 60 | 10,50 / 8 / 5 |
| Fanblock / ermäßigt | 126 / 96 | 10,50 / 8 |
| Rollstuhlplatz | 96 | 8 |
| VIP / ermäßigt | 1.191 / 457 | 119 / – |

Kategorie 2 ermäßigt (war 115, nicht 13 × 8,50) und VIP (eigener Anker, Catering) liegen nicht auf der
Regel: anteilig × 12/13, **aufgerundet auf volle Euro** (Entscheidung Marko, 12.10.2026). Bei der nächsten
Kürzung dieselbe Methode und vorher bei Marko bestätigen lassen.

**Die Preise stehen an vier Stellen, immer alle zusammen ändern:**

1. `tickets/dauerkarte.html`: sichtbare Preise, `data-base`, `prices`-Objekt im Skript. Der Game Hub
   (`saison/profis/gameday/index.html`) liest die `data-base`-Werte beim Bauen (`tools/bauen.sh`), dort
   nichts von Hand ändern.
2. n8n-Workflow „Ticketing: Bestellprozess - Dauerkartenbestellung verarbeiten“ (`HyUXW4kbhaQVbG0A`):
   zwei identische `PRICES`-Blöcke in „Preis serverseitig berechnen“ und „Mitgliedsrabatt verifizieren“.
   Der Server rechnet selbst. **Nach jeder Änderung veröffentlichen**, sonst läuft die alte Fassung.
3. pretix, Event `saison2627`: `default_price` der Dauer-Items und Variationen (Items 37 bis 47; Item 91
   Stehplatz-Dauer bleibt 0 €). Nach dem Setzen per API nachlesen.
4. Doku: `TICKETING-BACKEND.md` und in Notion die Seiten „Ticketing/ Sitzplan & Bestellungen“ und
   „Ticketpreise 2026/27“ (Notion-Seite „Themen-Spieltage“ nennt ebenfalls Preise).

Reihenfolge beim Ändern: n8n und pretix zuerst, Webseite zuletzt (die Webseite schickt keine Summe, der
Server rechnet). Gespielte Heimspiele schließt der Knoten „Ausgeschlossene Subevents ermitteln“ aus neuen
Dauerkarten aus; bestehende Dauerkarten bleiben unberührt.

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
