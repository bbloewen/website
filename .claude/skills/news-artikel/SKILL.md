---
name: news-artikel
description: News-Artikel für basketball-loewen.com in Löwen OS 305 (Bereich Website, Mediaplanung und Artikel) schreiben, überarbeiten und zur Veröffentlichung freigeben. Nutzen, wenn Marko einen Artikel, Vorbericht, Spielbericht oder eine Pressemitteilung für die Webseite will, Änderungen an einem Entwurf verlangt oder sagt, ein Artikel soll veröffentlicht werden.
---

# News-Artikel: schreiben, ändern, freigeben

**Seit 02.11.2026 führt 305 (crm-db).** Mediaplanung und Artikel leben in Löwen OS 305,
Bereich **Website** → **Mediaplanung** und **Artikel** (Tabellen `mediaplan` und `artikel`).
Notion (🗓️ Mediaplanung → Inhalte-Kalender) ist nur noch ein Spiegel zum Ansehen:
**Ein Status, der in Notion gesetzt wird, bewirkt nichts.** Die alte Strecke
„Website: News-Artikel aus Notion veröffentlichen“ (n8n `slyQfEyuRkujoQHz`) ist abgeschaltet
(Fall 10.11.2026: WAID und Tip-Off Folge 3 in Notion auf „Freigegeben“, nichts passierte).

Veröffentlicht wird so: 305 schreibt einen Auftrag nach `data/artikel-eingang/`, die
GitHub Action `news-veroeffentlichen.yml` baut daraus die Seite. Der n8n-Workflow
**„305: Website (Mediaplanung, Newsartikel)“** (`XCiGF4dCG99mvKhu`) gibt alle 10 Minuten
die fälligen Freigaben ans Repo. Dieser Skill setzt nie selbst „Veröffentlicht“ und
schreibt keine Aufträge von Hand ins Repo.

Technische Details und Feldlisten: `data/artikel-eingang/README.md`.

## Die Status-Kette (Artikel in 305)

| Status | wer | Bedeutung |
|---|---|---|
| **Entwurf** | Mensch oder Skill | Text entsteht in 305 (mit KI-Chat und Redaktionsregeln), nichts geht raus |
| **Prüfung** | Knopf „Zur Prüfung“ | 305 legt den Entwurf unverlinkt und mit noindex online (braucht Titel, Lead, Meta-Description, Text, Termin, Team und Hero-Bild) |
| **Freigegeben** | Knopf „Freigeben“, auf Ansage | der Workflow gibt den Artikel **ab dem Termin** ans Repo (Termin mit Uhrzeit auf die Minute, sonst ab Mitternacht, liegt er zurück: sofort), noindex fällt weg, er wird verlinkt |
| **Veröffentlicht** | Automatik | steht, wenn die Seite in `data/news.json` auftaucht |

„Zurück in Arbeit“ holt einen Artikel aus Prüfung oder Freigabe zurück, solange die Freigabe
noch nicht ans Repo ging.

### „Freigabe durch“: wer freigeben darf
An der Mediaplan-Zeile und am Artikel steht optional **„Freigabe durch“** (eine Mailadresse).
- **Leer:** jede berechtigte Person in 305 darf freigeben, in der Regel Marko.
- **Gesetzt:** **nur diese Person** kann freigeben, 305 lehnt alle anderen ab
  („Freigeben darf nur …“). Beispiel: Sponsorenturnier-Artikel von Aaron, Freigabe durch Florian.
  Dann die Person per Mail um Freigabe bitten (Vorschau-Link, was zu prüfen ist, Knopf
  „Freigeben“ in 305 unter Website → Artikel) und nicht selbst freigeben.
- Wer freigeben darf, entscheidet Marko. Den Eintrag nur auf seine Ansage ändern.

## 1. Neuen Artikel anlegen

1. **Datum prüfen, nicht raten.** Wenn Marko „Mittwoch nächste Woche“ sagt: Wochentag und
   Datum ausrechnen, ausschreiben („Mittwoch, 07.10.2026“) und bestätigen lassen.
   Der Termin ist das Veröffentlichungsdatum und steht im Dateinamen.
2. **Zeile in der Mediaplanung** in 305 (Termin, Typ, Titel, Kanäle, Team, Säule, Ziel,
   Keyword, Anlass, Autor, optional Freigabe durch). Typen: Spielvorbericht, Spielbericht,
   Newsartikel, Knowledge.
3. **Artikel aus der Zeile anlegen** (305: „Artikel“ an der Zeile, übernimmt Typ, Titel,
   Team, Termin, Anlass). Felder: Überschrift (H1), Lead, Meta-Description (höchstens
   155 Zeichen), Kurzfassung („Das Wichtigste in Kürze“, drei bis fünf Punkte), Text in
   Markdown (`##` Zwischenüberschrift, `>` Zitat, `-` Liste, `[Text](URL)`, `**fett**`).
   Die Quelle der Fakten gehört in die Nachricht an die KI bzw. den Verlauf, nicht in den Text.
4. **Hero-Bild** am Artikel hochladen oder per Link (Google Drive/Fotos) übernehmen.
   Hochformate baut die Action selbst ins Hero-Format um.
5. **„Zur Prüfung“**, erst wenn Text, Felder und Bild stimmen. Der Entwurf ist nach dem
   nächsten Lauf unter seiner Adresse online (Link steht am Artikel und in der Mediaplanung).
   Marko bzw. die Person aus „Freigabe durch“ den Link zum Prüfen schicken.

Arbeitet Claude ohne die Oberfläche: dieselben DB-Funktionen über einen kurzlebigen
n8n-Workflow (Postgres-Zugang „crm-db (Postgres)“), immer im Namen der Person, die es
angesagt hat: `mediaplan_speichern(p, p_von)`, `artikel_aktion(id, {"aktion": …}, p_von)`
mit `pruefung`, `freigegeben`, `entwurf`, `kopf`, `aktualisieren`, `loeschen`.
Danach den Workflow archivieren.

## 2. Änderungen nach dem Review

Text in 305 am Artikel ändern. Steht er in Prüfung, mit **„Entwurf aktualisieren“** neu
online legen, damit die Vorschau dem gespeicherten Stand entspricht. Erst nach dem neuen
OK freigeben. Änderung und Freigabe nie in einem Zug.

Ein **schon veröffentlichter** Artikel wird in 305 geändert und mit „aktualisieren“ an die
Website gegeben. Ändern sich Titel oder Termin, ändert sich die Adresse; 305 merkt sich die alte.

## 3. Freigeben

Sagt die freigebende Person „passt, kann raus“ und der Entwurf ist nach der letzten
Änderung geprüft: in 305 **„Freigeben“** (bzw. `artikel_aktion` mit `freigegeben`, im Namen
dieser Person). Dann sagen, ab wann der Artikel sichtbar ist: am Termin, bei vergangenem
Termin nach dem nächsten 10-Minuten-Lauf plus etwa 3 Minuten für Action und GitHub Pages.

Prüfen: `data/artikel-eingang/<pfad>.json` hat `"status": "freigegeben"`, die Seite unter
`news/artikel/` enthält kein `noindex` mehr. Laufen zwei Freigaben gleichzeitig, kann eine
Action am Push-Konflikt scheitern (10.11.2026, WAID). Dann `gh workflow run
news-veroeffentlichen.yml -R bbloewen/website --ref main` anstoßen, das Skript ist idempotent.

## Vor- und Spielberichte (Typ Spielvorbericht / Spielbericht)

Für jedes Spiel der Profis gibt es in der Mediaplanung in 305 **zwei Zeilen**, die schon
angelegt sind (Status *Geplant*, Kanal **Spielbericht**, Team Profis). Der Skill schreibt in
diese Zeilen, er legt sie nicht neu an. Den Spielbericht nach dem Spiel legt die
Spielendroutine (n8n `x5YYGGHuaWmteZSk`) seit 09.11.2026 selbst in 305 an.

| Zeile | Termin | Titel (Arbeitstitel) |
|---|---|---|
| **Vorbericht** | der **Freitag vor dem Spiel**, nur Datum (bei Freitagsspielen der Spieltag selbst) | „Vorbericht: Basketball Löwen Erfurt gegen/bei Gegner“ |
| **Spielbericht** | der Spieltag, **Spielbeginn plus 4 Stunden**, mit Uhrzeit | „Spielbericht: Basketball Löwen Erfurt gegen/bei Gegner“ |

- **Der Termin mit Uhrzeit gilt auf die Minute.** Ein freigegebener Spielbericht geht um
  diese Uhrzeit raus (der Workflow prüft alle 10 Minuten), nicht früher. Ein Vorbericht
  ohne Uhrzeit geht ab Mitternacht des Tages online.
- **Das Feld Anlass nicht ändern.** Es beginnt mit „Vorbericht:“ bzw. „Spielbericht:“,
  nennt Gegner, Datum, Uhrzeit und Halle (Muster: „Vorbericht: Auswärtsspiel bei X am Sa
  24.10.2026, 17:30 Uhr (Halle, Ort)“). Daraus liest der Workflow die Art, den Gegner und
  den Spieltag. Das Spieldatum braucht er, weil der Vorbericht am Freitag erscheint und
  trotzdem beim richtigen Spiel im Spielplan und im Startseiten-Widget verlinkt wird.
- **Der Titel darf ersetzt werden** (z. B. „Basketball Löwen gastieren beim Rekordmeister
  in Leverkusen“), „Anlass“ bleibt.
- **Hero-Bild** wie bei jedem Artikel direkt am Artikel in 305 (Upload oder Link), nicht
  mehr über einen Dateinamen in Drive.
- Verlinkung beim Spiel im Spielplan und im Widget macht die Automatik von selbst, nur bei
  Auswärtsspielen. Heimspiele haben ihre eigene Spieltagsseite.
- **Zeitplan:** Vorbericht am besten bis Donnerstag fertig und geprüft (*Zur Prüfung*,
  Review, *Freigeben*), der Spielbericht spätestens bis zur Uhrzeit des Termins.

## Redaktionsregeln

### Inhalt
- **Keine neuen Fakten.** Nur, was in der Vorlage, der Episodenbeschreibung, dem
  Spielbericht oder Markos Angaben steht. Quelle in die Hinweisbox schreiben.
- **Keine wörtlichen Zitate** von Personen, wenn sie nicht freigegeben vorliegen.
- Ton, Ansprache und Absatzlänge wie in den bestehenden Artikeln unter `news/artikel/`; im Zweifel dort einen ähnlichen Artikel als Vorbild lesen.

### Kategorie und Eyebrow: kommt aus dem Team, nie aus freier Wahl
Die Zeile über der Überschrift („Aktuelles · Club“) und das Label in den Kacheln
(„07.10.2026 · Club“) kommen aus **Typ** und **Team** des Artikels in 305. Wer den Artikel
schreibt, muss darüber nicht nachdenken und trägt nichts dergleichen in den Text ein.

| Team | Eyebrow / Kachel-Label |
|---|---|
| Profis | Profis |
| Damen | Damen |
| Nachwuchs | Nachwuchs |
| Club | **Club** (nicht „Verein“: so heißt es auch in der Navigation) |
| Partner | Partner |
| *egal, bei Typ **Spielbericht*** | **Spielbericht** (schlägt das Team) |
| *egal, bei Typ **Spielvorbericht*** | **Vorbericht** (schlägt das Team) |

Deshalb gilt beim Anlegen: das richtige **Team** wählen, mehr nicht. Themen des Vereins
allgemein (Podcast, Sommercamp, Interviews) sind Team **Club**. Ein Artikel zu einem
einzelnen Team gehört diesem Team zugeordnet.

### Name: immer „Basketball Löwen Erfurt“ (SEO)
„Löwen“ allein ist als Suchbegriff zu unspezifisch, „Erfurt“ liefert das Ortssignal.
- **Pflicht:** Titel *oder* Lead, die Meta-Description und die erste Erwähnung im
  Fließtext tragen **„Basketball Löwen Erfurt“**.
- Danach darf es „Basketball Löwen“ oder „die Löwen“ heißen, sonst liest es sich
  gestopft. Ein bis zwei weitere volle Nennungen im Text (z. B. Schlusszeile oder
  Zwischenüberschrift) genügen.
- Eigennamen und Zitate bleiben, wie sie sind („Tip-Off, der Podcast der Basketball Löwen“).
- **Eigene Zwischenüberschriften sind kein Eigenname.** „Folge 1: Wie die Löwen entstanden
  sind“ wird zu „… Wie die Basketball Löwen Erfurt entstanden sind“. Nur wörtliche Titel
  Dritter in Anführungszeichen (z. B. der Titel einer Podcast-Folge) bleiben unverändert.
- Nach dem Schreiben **einmal alle Vorkommen von „Löwen“ durchgehen**: Überschriften,
  Kurzfassung, Lead, Absatzanfänge. Dort, wo „Löwen“ allein steht und kein Eigenname ist,
  entscheiden nach den Regeln oben.

### Verlinken: Organisationen und Personen
Im Fließtext wird **die erste Nennung** jedes Ziels verlinkt, nicht jede. Nicht in
Überschriften und nicht im Lead. Markdown: `[Text](URL)`. Eigene Adressen **immer
voll** schreiben (`https://basketball-loewen.com/saison/spielplan.html`). Die Automatik macht eigene
Adressen auf der Seite wieder relativ, fremde bekommen einen neuen Tab.
Nach dem Schreiben die Seite abrufen und die Links kontrollieren.

1. **Partner und Sponsoren** (immer, auch dotflow): Adresse aus `data/sponsoren.json`,
   Feld `website`. Beispiel: `[dotflow](https://dotflow.com/)`.
2. **Eigene Seiten** (Spielplan, Newsletter, Teamseiten, Podcast-Link im Footer, Spieltagsseite
   bei Heimspielen): Pfad im Repo prüfen, bevor er verlinkt wird.
3. **Andere Organisationen** (Gegner, Liga, Verband, Halle, Stadt, Förderer): auf die
   offizielle Webseite, wenn die Adresse im Repo steht (Spielplan, Presse, Partnerseiten)
   oder Marko sie nennt.
4. **Personen:** nur auf öffentliche, offizielle Seiten (Teamseite des Vereins, Profil bei
   Liga oder Verband, Webseite der Person oder ihrer Firma). **Nie** private Social-Profile
   ohne ausdrückliche Zusage.
5. **Nie eine Adresse raten.** Gibt es keine gesicherte, den Namen unverlinkt lassen und
   Marko in der Antwort die Lücke nennen („Für X habe ich keine Adresse“).

## Vor „Zur Prüfung“ kurz abhaken
- [ ] Datum und Wochentag bestätigt, Termin gesetzt
- [ ] Typ, Team und Titel gesetzt; Typ und Team bestimmen Eyebrow und Kachel-Label, siehe Tabelle
- [ ] Überschrift und Lead vorhanden
- [ ] Meta-Description höchstens 155 Zeichen, mit „Basketball Löwen Erfurt“
- [ ] Erste Nennung im Fließtext mit vollem Namen
- [ ] Partner und Organisationen verlinkt, keine geratenen Adressen
- [ ] Hero-Bild am Artikel
- [ ] Quelle der Fakten im Verlauf des Artikels festgehalten
- [ ] „Freigabe durch“ geklärt: leer (Marko) oder die Person, die Marko genannt hat
