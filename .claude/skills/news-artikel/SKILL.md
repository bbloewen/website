---
name: news-artikel
description: News-Artikel für basketball-loewen.com in der Notion-Mediaplanung schreiben, überarbeiten und zur Veröffentlichung freigeben. Nutzen, wenn Marko einen Artikel, Vorbericht, Spielbericht oder eine Pressemitteilung für die Webseite will, Änderungen an einem Entwurf verlangt oder sagt, ein Artikel soll veröffentlicht werden.
---

# News-Artikel: schreiben, ändern, freigeben

Der Artikel lebt in **Notion** (🗓️ Mediaplanung → Inhalte-Kalender). Ein n8n-Workflow
liest ihn dort alle 10 Minuten, baut die Seite, legt sie als unverlinkten Entwurf
(noindex) online und schickt Marko eine Mail. Dieser Skill arbeitet **nur in Notion**.
Er fasst weder das Repo noch den n8n-Workflow an und setzt den Status
„Veröffentlicht“ nie selbst.

Technische Details und Feldlisten: `data/artikel-eingang/README.md`.

## Die Status-Kette

| Status | wer | Bedeutung |
|---|---|---|
| Geplant / In Arbeit / Entwurf | Mensch oder Skill | Automatik schaut weg |
| **Text fertig** | Skill | Auslöser: Workflow baut den Entwurf, trägt den Link ein, setzt „Bereit zum Review“, mailt Marko |
| **Bereit zum Review** | Workflow | Entwurf ist online, Marko prüft |
| **Freigegeben** | Skill, auf Markos Ansage | Workflow veröffentlicht **ab dem Termin** (liegt der in der Vergangenheit: sofort), nimmt das noindex weg, verlinkt |
| **Veröffentlicht** | Workflow | erst gesetzt, wenn die Seite wirklich ohne noindex online ist |

Der Skill setzt also höchstens **Text fertig** und **Freigegeben**. Nie „Veröffentlicht“:
Das würde auf der Webseite nichts bewirken.

## 1. Neuen Artikel anlegen

1. **Datum prüfen, nicht raten.** Wenn Marko „Mittwoch nächste Woche“ sagt: Wochentag und
   Datum ausrechnen, ausschreiben („Mittwoch, 07.10.2026“) und bestätigen lassen.
   `Termin` ist das Veröffentlichungsdatum und steht im Dateinamen.
2. **Zeile im Inhalte-Kalender** (Datenbank `f0795b29f1b540cb9fc04002f1ea6afd`,
   Datenquelle `f8e3777f-4d5b-4f8f-95e1-edb083cc02f2`) mit diesen Eigenschaften:
   `Titel`, `Termin`, `Team` (Profis, Damen, Nachwuchs, Club oder Partner),
   `Kanal` = News-Artikel, `Top-News` (nur wenn Marko es will), `Status` = Entwurf.
3. **Seitentext** in genau diesem Aufbau (der Parser rät nichts):

   ```
   Callout-Box (wird ignoriert): Meta-Description, Quelle der Fakten, Bildhinweis
   ## Artikel
   **Überschrift:** …
   **Lead:** …
   Callout „Das Wichtigste in Kürze“ mit drei bis fünf Punkten (- …)
   ### Zwischenüberschrift
   Absätze …
   ```

   Die Hinweisbox enthält eine Zeile `Meta-Description: …` (höchstens 155 Zeichen)
   und die **Quelle der Fakten**. Alles, was vor `## Artikel` steht, bleibt unveröffentlicht.
4. **Hero-Bild** in Drive, Ordner „Bilder, Webseite, Newsartikel“, Dateiname
   `News_<JJJJ-MM-TT>_<Kurzname>.<jpg|png|webp>` mit **demselben Datum wie `Termin`**.
   Nur ein Bild je Datum. Bei Vor- und Spielberichten beginnt der Kurzname mit
   `Vorbericht-` bzw. `Spielbericht-`, dann wird der Artikel auch im Spielplan verlinkt
   (nur Profis, Auswärtsspiele).
5. **Status auf „Text fertig“ setzen**, erst wenn Text, Eigenschaften und Bild stimmen.
   Dann kommt innerhalb von etwa 10 bis 20 Minuten Markos Review-Mail.

## 2. Änderungen nach dem Review

Der Entwurf wird aus einem gespeicherten Auftrag gebaut, nicht live aus Notion gelesen.
Ein geänderter Text ohne Neubau würde also den **alten** Stand veröffentlichen.

Bei jeder inhaltlichen Änderung nach „Bereit zum Review“:
1. Text in Notion ändern.
2. Feld **Link** leeren.
3. Status auf **Text fertig** setzen. Der Workflow baut neu und mailt erneut.
4. Erst nach Markos neuem OK weiter mit „Freigeben“.

Die zwei Schritte (Änderung und Freigabe) nie in einem Zug machen.

## 3. Freigeben

Sagt Marko „passt, kann raus“ und der Entwurf ist nach dem letzten Neubau geprüft:
nur den Status auf **Freigegeben** setzen und Marko sagen, ab wann der Artikel
sichtbar ist (am Termin, bei vergangenem Termin sofort). Den Rest erledigt der Workflow.

Steht der Status noch auf „Text fertig“ (kein Entwurf gebaut), erst abwarten bzw. nach
dem Entwurf fragen. Der Workflow meldet in dem Fall selbst per Mail „kein Entwurf“.

## Redaktionsregeln

### Inhalt
- **Keine neuen Fakten.** Nur, was in der Vorlage, der Episodenbeschreibung, dem
  Spielbericht oder Markos Angaben steht. Quelle in die Hinweisbox schreiben.
- **Keine wörtlichen Zitate** von Personen, wenn sie nicht freigegeben vorliegen.
- Ton, Ansprache und Absatzlänge wie in den bestehenden Artikeln unter `news/artikel/`; im Zweifel dort einen ähnlichen Artikel als Vorbild lesen.

### Kategorie und Eyebrow: kommt aus dem Team, nie aus freier Wahl
Die Zeile über der Überschrift („Aktuelles · Club“) und das Label in den Kacheln
(„07.10.2026 · Club“) setzt der Workflow aus dem Feld **Team**. Wer den Artikel
schreibt, muss darüber nicht nachdenken und trägt nichts dergleichen in den Text ein.

| Team in Notion | Eyebrow / Kachel-Label |
|---|---|
| Profis | Profis |
| Damen | Damen |
| Nachwuchs | Nachwuchs |
| Club | **Club** (nicht „Verein“: so heißt es auch in der Navigation) |
| Partner | Partner |

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
voll** schreiben (`https://basketball-loewen.com/saison/spielplan.html`): Notion macht aus
relativen Pfaden kaputte `app.notion.com/…`-Adressen. Die Automatik macht eigene
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

### Hinweisbox, Vorlage im Kopf
Vor `## Artikel` steht immer eine Box mit: Status-Zeile („Entwurf, Veröffentlichung
geplant: TT.MM.JJJJ“), `Meta-Description:`, Bildname, Zielkeywords, Quelle der Fakten.

## Vor „Text fertig“ kurz abhaken
- [ ] Datum und Wochentag bestätigt, `Termin` gesetzt
- [ ] `Team`, `Titel`, `Kanal` = News-Artikel gesetzt (Team bestimmt Eyebrow und Kachel-Label, siehe Tabelle)
- [ ] `**Überschrift:**` und `**Lead:**` vorhanden
- [ ] Meta-Description höchstens 155 Zeichen, mit „Basketball Löwen Erfurt“
- [ ] Erste Nennung im Fließtext mit vollem Namen
- [ ] Partner und Organisationen verlinkt, keine geratenen Adressen
- [ ] Hero in Drive mit dem Datum von `Termin`, nur ein Bild
- [ ] Quelle der Fakten in der Hinweisbox
