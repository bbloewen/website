# Ticketing-Backend (pretix + n8n)

Kurzreferenz für das Zusammenspiel zwischen dieser Website, [pretix](https://pretix-production-4263.up.railway.app)
und den n8n-Workflows, die Bestellungen verarbeiten. Die Website selbst enthält keine
Backend-Logik — `js/seat-picker.js` fragt nur Webhooks ab und schickt Formulardaten an
Webhooks. Diese Datei dokumentiert die Teile, die man von außen nicht sieht, aber kennen
muss, um Bugs im Sitzplan/Bestellprozess einzuordnen.

## Warum ein Sitz auf der Website "belegt" erscheint

`js/seat-picker.js` fragt beim Laden `.../webhook/einzelticket-sitzplatz-status` bzw.
`.../webhook/dauerkarte-sitzplatz-status` ab (n8n-Workflow **"Ticketing: Bestellprozess -
Reservierungen abfragen"**). Diese Endpunkte lesen die belegten Sitze **nicht live aus
pretix**, sondern aus einer eigenen n8n-Data-Table (intern "Belegte-Sitze" genannt,
technische ID `Te9OmItDRQ2KzxRC`) — aus Performance-Gründen (eine Live-Abfrage über alle
Sitze bei jedem Seitenaufruf wäre zu langsam).

Diese Tabelle wird **nicht** von den Bestell-Workflows selbst befüllt, sondern von einem
separaten, pretix-webhook-getriebenen Workflow: **"Ticketing: Bestellprozess -
Reservierungen synchronisieren (pretix -> n8n)"**. pretix schickt bei jedem
Order-Event (`order.placed`, `order.paid`, `order.canceled`, ...) einen Webhook-Call an
n8n, der Workflow lädt die volle Order erneut, extrahiert alle aktiven Sitzplätze und
schreibt sie in die Tabelle.

**Konsequenz:** Wenn dieser pretix-Webhook nicht (mehr) feuert, sieht die Website neu
verkaufte Sitze weiterhin als frei — mit dem Risiko einer echten Doppelbelegung, obwohl
in pretix längst eine gültige Order existiert.

## Vorfall 10.08.2026: Webhook lief seit dem 08.08. ins Leere

Bei der Untersuchung einer fehlgeschlagenen Dauerkarten-Bestellung fiel auf, dass eine
bereits erfolgreich in pretix angelegte Order (Sitz Block B, Reihe 12, Platz 14) auf der
Website trotzdem als frei angezeigt wurde. Ursache: pretix' Webhook-Abo
(`GET /api/v1/organizers/xxl/webhooks/`) hatte `limit_events: []` (leer) bei
`all_events: false` — der Webhook war dadurch faktisch für **kein** Event mehr scharf
geschaltet, vermutlich als Nebenwirkung einer der Event-Migrationen dieser Woche (die
alten Events `dauerkarte2627`/`einzeltickets2627` wurden gelöscht und durch das
konsolidierte Event `saison2627` ersetzt — pretix entfernt gelöschte Events
offenbar automatisch aus `limit_events`, ohne das neue Event automatisch nachzutragen).

Der letzte erfolgreiche Lauf dieses Sync-Workflows vor dem Fund lag auf den 08.08.2026,
11:29 Uhr — d. h. der Sync stand seit rund 2 Tagen still, bevor es auffiel.

**Fix:** `limit_events` wurde per `PATCH .../organizers/xxl/webhooks/1/` wieder auf
`["saison2627"]` gesetzt. Die eine betroffene reale Bestellung wurde händisch
nachsynchronisiert (Workflow einmalig mit dem echten `order.placed`-Payload für den
Bestellcode ausgeführt). Ein Abgleich aller 16 zu dem Zeitpunkt existierenden Orders im
Event zeigte, dass alle anderen bereits (händisch, im Rahmen einer separaten
Wiederherstellungsaktion) korrekt synchronisiert waren — kein weiterer Nachtrag nötig.

## Vorfall 11.08.2026: Nur 1 von 28 Sitzplätzen synchronisiert (Race Condition)

Kundin Sabine Dehne bestellte eine Dauerkarte mit 2 Sitzplätzen (Order `GQPTK`,
Block B, Reihe 9, Platz 3+4). Sie meldete, dass nur einer ihrer beiden Plätze auf der
Website als belegt/reserviert erschien — der zweite zeigte sich weiterhin als frei.

**Ursache:** Der Bestell-Workflow ("Ticketing: Bestellprozess - Dauerkartenbestellung
verarbeiten") legt eine pretix-Order zunächst nur mit der **ersten** von 28 Positionen
an (`Create pretix Order`), dann folgt ein Positionen-Loop (`Restliche Positionen
vorbereiten` → `Position hinzufuegen`), der die übrigen 27 Positionen (2 Sitze × 14
Heimspiele, minus die bereits angelegte erste) einzeln nachträgt. pretix feuert den
`order.placed`-Webhook aber **sofort** beim ersten Schritt — Sekunden bevor der
Positionen-Loop überhaupt läuft. Der separate, webhookgetriebene Sync-Workflow
("Ticketing: Bestellprozess - Reservierungen synchronisieren") lädt die Order in genau
diesem Moment und sieht dadurch nur 1 von 28 Positionen. Ein zweiter Sync-Lauf (z. B.
über `order.modified`, wenn die restlichen Positionen fertig sind) fand nicht statt —
pretix feuert dieses Event für nachträglich per API hinzugefügte Positionen offenbar
nicht zuverlässig.

**Fix:** Der Bestell-Workflow selbst kennt die vollständige Liste aller
(Sitzplatz-GUID, Subevent)-Kombinationen bereits aus `Build pretix Order Payload` (dort
werden `initialPositions`/`restSpecs` gebaut) — er muss dafür nicht erst auf pretix
warten. Neue Nodes `Reservierung: Orderdaten sammeln` → `Reservierung: alte Zeilen
loeschen` → `Reservierung: Zeilen aufteilen` → `Reservierung: Zeilen einfuegen` laufen
direkt im Anschluss an `Update Order: pretix angelegt`/`Update Order: nachgetragen` und
schreiben alle Zeilen selbst, unabhängig vom pretix-Webhook-Timing. Der
webhookbasierte Sync-Workflow bleibt für andere Order-Events (Stornierung etc.)
weiterhin aktiv — beide Wege schreiben idempotent (erst löschen, dann einfügen), ein
Überschneiden ist unschädlich.

**Wichtige Detail-Falle beim Testen entdeckt:** Der `deleteRows`-Node gibt bei einer
neuen Order (nichts zu löschen) 0 Items zurück — ohne `alwaysOutputData:true` liefe der
nachfolgende Insert-Schritt dadurch bei **jeder neuen Bestellung** gar nicht erst an.
Nur durch einen Testlauf vor der Veröffentlichung aufgefallen (s. Merksatz unten).

**Backfill:** Die fehlenden 27 Zeilen für Order `GQPTK` wurden händisch nachgetragen
(Datenbasis: `GET .../orders/GQPTK/` direkt aus pretix, alle 28 realen Positionen
waren dort korrekt vorhanden — der Fehler lag ausschließlich im Sync, nicht in der
Bestellung selbst). Ein Abgleich aller Orders mit Status "angelegt" zeigte, dass nur
diese eine reale Order betroffen war.

## Merksatz: Vor Veröffentlichung eines n8n-Workflow-Fixes immer live testen

`test_workflow` mit `prepare_test_pin_data` erlaubt einen Testlauf, bei dem Trigger/
HTTP-Request-/credential-Nodes simuliert werden (keine echten externen Calls), während
Code-/Data-Table-Nodes **echt** laufen — genau das deckte den `alwaysOutputData`-Bug
oben auf, der sonst erst beim nächsten echten Kunden aufgefallen wäre. Gilt für jede
Änderung an einem produktiven Bestell-Workflow, nicht nur für diesen Fall.

## Merksatz für künftige pretix-Event-Migrationen

**Nach jedem Anlegen/Löschen/Umbenennen eines pretix-Events den Webhook-Scope prüfen:**

```
GET https://pretix-production-4263.up.railway.app/api/v1/organizers/xxl/webhooks/
```

`limit_events` muss den/die aktuell aktiven Event-Slug(s) enthalten (aktuell:
`saison2627`). Das gilt zusätzlich zu den bereits bekannten Stolperfallen bei
Event-Migrationen (hartcodierte Item-/Kontingent-/Quota-IDs in n8n-Workflows), die
jeweils separat geprüft werden müssen, wenn Kontingente/Sitzpläne neu aufgesetzt werden.

## Item-/Kontingent-Struktur (Stand 11.08.2026, event `saison2627`)

Jede Preiskategorie existiert als **drei getrennte Items** (eigene IDs, teilen sich aber
die physischen Kontingente je Subevent): `- Einzel` (Vorverkauf), `- Dauer`
(Dauerkarte), `- Abend` (Tageskasse, Einzelticket-Preis + 2,00 € Zuschlag). Live per
`GET /api/v1/organizers/xxl/events/saison2627/items/?page_size=100` verifiziert, nicht
aus dem Gedächtnis übernommen — bei Zweifeln immer neu abfragen, IDs ändern sich bei
jedem Kontingent-/Item-Neuaufbau (s. Merksatz oben).

| Kategorie | Einzel-ID | Dauer-ID | Abend-ID | Preis Einzel (Normal/Erm./Kinder 7-14) |
|---|---|---|---|---|
| Block A (K3) | 28 | 37 | 49 | 10,50 € / 8,00 € / 5,00 € |
| Block B (K1) | 35 | 44 | 55 | 16,00 € / 14,00 € |
| Block C (K2) | 31 | 42 | 50 | 12,00 € / 8,50 € |
| Block CS (K2) — zweites Kat.2-Kontingent, „C oben" | 32 | 46 | 53 | 12,00 € / 8,50 € |
| Block D (K2) | 29 | 43 | 48 | 12,00 € / 8,50 € |
| Block E (K1) | 33 | 41 | 52 | 16,00 € / 14,00 € |
| Block F (K2) | 30 | 45 | 51 | 12,00 € / 8,50 € |
| Fanblock | 27 | 38 | 54 | 10,50 € / 8,00 € |
| VIP | 40 | 47 | 58 | 119,00 € (Dauer 1.290,00 €/495,00 € erm.) |
| Rollstuhlplatz | 34 | 39 | 57 | 8,00 € (Dauer 104,00 €) |
| Stehplatz | 23 | *(kein Dauer-Item)* | 56 | 8,00 € |
| Nachwuchsunterstützung (Addon, `addon_category:3`, an jedem Kategorie-Item) | 19 | – | – | 2,00 € |

Variationen durchgängig `{Normalpreis, Ermäßigt}`, nur **Block A (K3)** zusätzlich
`Kinder 7-14`. Für Stehplatz existiert bewusst kein `- Dauer`-Item (Dauerkarten decken
keinen separaten Stehplatz-Tarif ab).

**Sponsoren-/Partner-Gutscheine** (kategorie-eingeschränkte Freikarten-Codes, z. B. SWE)
nutzen ein eigenes Muster (unbegrenzte Zusatz-Quota je Subevent + Voucher mit
`max_usages`) — vollständig dokumentiert im Abschnitt „Sponsoren-/Partner-Gutscheine
anlegen" der Notion-Seite [Ticketing/ Sitzplan & Bestellungen](https://app.notion.com/p/3aba2418e2d781e2a0addde3c5ada33f),
nicht hier duplizieren.

### Gutschein-Rabatt-Berechnung: gemeinsamer Sub-Workflow (seit 16.08.2026)

Bis 16.08.2026 gab es die Rabatt-Berechnung (Kategorien/Tarif matchen, Rabatt pro
Zeile, Nachwuchsbeitrag-Vollbefreiung) **zweimal unabhängig** als n8n-Code-Node:
einmal im Checkout-Einlösen-Flow (Workflow `5Bi15oYpyehxjhXK`, für die Live-Anzeige),
einmal im Bestell-Workflow selbst (Workflow `HyUXW4kbhaQVbG0A`, serverseitig
maßgeblich für den echten Bestellbetrag). Ein Bug (Nachwuchsbeitrag-Befreiung nur bei
`priceMode=percent/value=100`, nicht bei `priceMode=set/value=0` wie bei echten
Sponsoren-Gutscheinen) wurde zunächst nur in einer Kopie behoben — die andere schlug
dadurch weiterhin fehl.

Beide Workflows rufen die Berechnung jetzt per Execute-Workflow-Node aus dem
gemeinsamen Sub-Workflow **„Ticketing: Gutschein-Rabatt berechnen (Shared)"**
(`QxPE1ikMJWL0fyB7`) auf. Vertrag: Eingabe `{code, voucherRecord, lines: [{category,
tarif, unitPrice, qty}], nachwuchsPresent, nachwuchsAmount, itemCategoryMap}`, Ausgabe
`{valid, reason?, source, code, priceMode, value, itemIds, categories,
tarifRestriction, discountAmount, newTotal, remainingUses, lineDiscounts,
nachwuchsFree}`. Jeder Aufrufer hat einen kleinen Vorbereiten-Node (baut die Eingabe
aus seinem eigenen Kontext) und — nur im Bestell-Workflow nötig — einen
Ergebnis-übernehmen-Node, der die Shared-Antwort zurück in die dort erwartete
`pre`-gemergte Objektform übersetzt (`voucherOk`/`voucherError`/`voucherLineDiscounts`/
`voucherNachwuchsFree`/...). Künftige Änderungen an der Rabatt-Logik nur noch in
`QxPE1ikMJWL0fyB7` vornehmen, nicht in den Aufrufer-Workflows.

## Begleitperson eines Rollstuhlplatzes (Tarif "begleitung", seit 13.08.2026)

Die Preisliste sagt "Rollstuhlfahrer (inkl. Begleitkarte)" — bis 13.08.2026 war das nur
ein Hinweistext im Sitzplan-Popup, der zusätzliche Sitz wurde beim Checkout aber ganz
regulär zum Blockpreis berechnet (kein 0-€-Mechanismus). Jetzt gibt es einen echten
Tarif `begleitung` (0 €, max. 1 pro gebuchtem Rollstuhlplatz):

- **Dauerkarte (`seats`-Modus)**: normaler Tarif-Dropdown-Eintrag am Sitz im Warenkorb
  (`_companionSlotAvailable` in `js/seat-picker.js`), gebunden an dieselbe `zoneLabel`
  wie der Rollstuhlplatz-Sitz.
- **Einzelticket (`blocks`-Modus)**: Rollstuhlplatz ist hier block-unabhängig (pseudo-
  Zone `ROLLSTUHL`, ein gemeinsames Kontingent über alle Blöcke) und hat deshalb selbst
  keinen Block, an den man "eine Begleitperson dazu wählen" könnte. Stattdessen wandelt
  der Käufer eine bereits im Warenkorb liegende NORMALE Ticket-Zeile über deren
  Tarif-Dropdown in `begleitung` um (`_companionSlotsRemaining` in `js/seat-picker.js`,
  cartweit statt pro Block gezählt).
- **Serverseitig** (beide n8n-Workflows, Node "Preis serverseitig berechnen"):
  `tarifPrice()`/`baseTarif()` geben für `begleitung` fest 0 zurück, unabhängig von
  Rabatten. Zusätzlich eine harte Kappung: Anzahl `begleitung`-Zeilen darf die Anzahl
  Rollstuhlplatz-Zeilen in derselben Bestellung nicht überschreiten (sonst `throw`) —
  Backstop gegen einen manipulierten Request, der den Frontend-Cap umgeht. Bei
  Einzelticket zusätzlich in "Sitze zuordnen": Positions-Preis kommt für diesen Tarif
  NIE aus dem Client-Wert `l.unitPrice`, sondern ist hart auf `0.00` gesetzt.

**Getestet:** Dauerkarte-Workflow live via `test_workflow` (positiv: 0-€-Position korrekt
in `Build pretix Order Payload`; negativ: 2 Begleitpersonen bei 1 Rollstuhlplatz korrekt
abgelehnt). Einzelticket-Workflow: nur die Order-Erstellung (Preisberechnung) getestet,
NICHT der Capture-/Zahlungs-Workflow-Teil — dort hätte ein Testlauf ohne vollständige
Pin-Daten für alle credentialed Nodes (PayPal, pretix) eine echte Produktions-Order
anlegen können (s. Vorfall unten), das Risiko wurde bewusst vermieden.

### Vorfall 13.08.2026: `test_workflow` ohne Pin-Daten für PayPal-Nodes = echter Live-Call

Beim Testen der obigen Preisberechnung wurde `test_workflow` für die Einzelticket-
Order-Erstellung ohne Pin-Daten für "PayPal OAuth Token"/"PayPal Order erstellen"
aufgerufen (beide standen in `nodesWithoutSchema` von `prepare_test_pin_data`, ohne
eigene generierbare Schema-Vorlage). Ergebnis: **echter** Call gegen die PayPal-
PRODUKTIV-API (`api.paypal.com`, nicht Sandbox) — eine reale PayPal-Order (16,00 €)
wurde angelegt. Kein finanzieller Schaden (Order wurde nie bestätigt/captured, verfällt
folgenlos), aber ein wichtiger Merksatz: **`test_workflow` pinnt NICHT automatisch
jeden credentialed Node, wenn `prepare_test_pin_data` dafür kein Schema liefern konnte
— fehlt ein Node in der übergebenen `pinData`, kann er live laufen.** Vor jedem Test
prüfen, ob alle Nodes in `nodesWithoutSchema` explizit (auch mit Dummy-Werten) in
`pinData` enthalten sind, sonst lieber gar nicht über diesen Trigger-Knoten testen.

## Vorfall 13.08.2026: Gelöschte Test-Order räumt "Ticketing-ReserviertePlaetze" NICHT auf

Beim Verifizieren eines Gutscheins wurden mehrere echte `testmode:true`-Testbestellungen
für konkrete Sitze angelegt und die pretix-Orders anschließend per `DELETE` (bzw. über
die pretix-Oberfläche) wieder entfernt. Kurz danach meldete Marko, drei Plätze
(Block A, Reihe 1, Platz 1–3) seien auf der Website fälschlich als gebucht markiert.

**Ursache:** Der webhookgetriebene Sync-Workflow ("Ticketing: Bestellprozess -
Reservierungen synchronisieren", s. oben "Warum ein Sitz belegt erscheint") reagiert nur
auf normale Order-Lifecycle-Events (`order.placed`, `order.paid`, `order.canceled`). Ein
hartes Löschen einer Order (API `DELETE` oder pretix-UI) feuert **kein** solches Event —
die zugehörigen Zeilen in der Data Table "Ticketing-ReserviertePlaetze" (`Te9OmItDRQ2KzxRC`)
bleiben deshalb unverändert stehen, auch wenn die Order in pretix längst weg ist. Bei
Dauerkarten-Testbestellungen sind das 14 Zeilen pro Sitz (eine je Subevent).

**Fix (einmalig):** Alle betroffenen Zeilen per `seatGuid`-Filter (`anyCondition`)
gefunden und gelöscht (43 Zeilen über 3 Sitze + eine noch ältere von einem früheren
Test). Danach leer verifiziert.

**Lehre für künftige Testbestellungen mit echten Sitzplätzen:** Nach dem Löschen einer
Test-Order über `DELETE .../orders/{code}/` IMMER zusätzlich die zugehörigen
`Ticketing-ReserviertePlaetze`-Zeilen (Filter auf die verwendete(n) `seatGuid`(s), nicht
nur auf `orderCode` — die Zeilen tragen den Order-Code zwar auch, aber der sichere
Suchschlüssel ist der Sitz) mitlöschen. Sonst bleiben Sitze dauerhaft fälschlich als
belegt markiert, bis es zufällig auffällt.

## Dauerkarte-Preistabelle vervollständigt (13.08.2026)

Die `PRICES`-Konstante in "Preis serverseitig berechnen" (Dauerkarte) kannte lange nur
Kategorie I/II und einen veralteten VIP-Preis (1.000 € pauschal, kein Ermäßigt-Tarif) —
Kategorie III, Fanblock, Rollstuhlplatz und "C unten" fehlten komplett und hätten mit
"Unbekannte Kategorie" abgelehnt. Jetzt vollständig (aktuelle Preise s. Tabelle oben):
Kategorie III `{normal:136.5, ermaessigt:104, kind:65}`, "C unten" identisch zu
Kategorie II (`{normal:156, ermaessigt:115}`), Fanblock identisch zu Kategorie III ohne
Kindertarif, Rollstuhlplatz `{normal:104}`, VIP `{normal:1290, ermaessigt:495}`.
`tarifPrice()` erkennt jetzt zusätzlich `'kind'`-Tarife (vorher nur normal/ermaessigt).

## Testbestellungen haben mehr Nebeneffekte als nur pretix + Reservierungstabelle (13.08.2026)

Nach dem oben beschriebenen Vorfall wurde beim weiteren Aufräumen entdeckt, dass eine
erfolgreiche `testmode:true`-Order im Dauerkarte-Workflow (`HyUXW4kbhaQVbG0A`) noch zwei
weitere Systeme berührt, die beim Löschen der pretix-Order **nicht** automatisch
mitbereinigt werden:

1. **Tracking-Tabellen "Dauerkarten-Bestellungen"/"Einzelticket-Bestellungen"** — werden
   VOR der pretix-Order beschrieben, bleiben nach dem Löschen der Order als verwaiste
   Zeile stehen. Muss separat per Order-Code gesucht und gelöscht werden.
2. **Notion-Kontakt-Sync** — läuft parallel zur Order-Anlage, unabhängig von `testmode`.
   Legt bei neuer Test-E-Mail einen echten Kontakt in der Kontaktpersonen-Datenbank an
   (bzw. taggt einen bestehenden). Für Notion-Kontakte gibt es kein API-Löschen/Archivieren
   über die verfügbaren Tools — muss händisch in der Notion-UI entfernt werden.

**Lehre:** Vor dem ersten Live-Test eines neuen Bestell-Workflows einmal alle Nodes nach
dem "Order angelegt"-Schritt durchsehen (auch parallele Branches!), um die vollständige
Aufräum-Checkliste vorher zu kennen, statt sie nach und nach durch Zufallsfunde zu
entdecken.

## Vorfall 13.08.2026: Rollstuhlplatz-Begleitperson bei Dauerkarte nicht kostenlos berechnet (echte Kundenbestellung betroffen)

Die am selben Tag eingeführte "Begleitperson kostenlos"-Funktion (Tarif `begleitung`)
funktionierte nur beim Einzelticket-Workflow korrekt. Bei der Dauerkarte
(`HyUXW4kbhaQVbG0A`, Node "Preis serverseitig berechnen") kannte `tarifPrice()` den Tarif
`begleitung` gar nicht und liess ihn auf den Normalpreis der Zeilen-**Kategorie**
durchfallen — und diese Kategorie wird für den Begleitperson-Sitz anhand seiner
physischen Blockposition aufgelöst (z. B. "Fanblock" für einen Sitz neben einem
Rollstuhlplatz in Block A), NICHT anhand von "Rollstuhlplatz". Ergebnis: Ein loser
Sitzplatz erschien im Warenkorb korrekt mit 0,00 €, wurde serverseitig aber zum vollen
(ggf. rabattierten) Normalpreis seiner physischen Kategorie berechnet.

**Konkret betroffen:** Order `JBCKH` (Michaela Klugmann, Referenz "whatsapp", einzige
echte Dauerkarte-Bestellung mit Begleitperson seit Feature-Launch) — kommunizierter
Preis 85,20 €, tatsächlicher pretix-Order-Total durch den Bug 194,40 € (Begleitperson-Sitz
fälschlich mit 109,20 € statt 0,00 € berechnet). Das SEPA-Mandat (`DK-P3F7B8`) war noch
nicht eingezogen, kein finanzieller Schaden.

**Fix:**
- Code: `tarifPrice()` prüft jetzt `if (t === 'begleitung') return 0;` als ALLERERSTE
  Zeile, vor jeder Kategorie-Preistabellen-Aufloesung — analog zum bereits korrekten
  Muster im Einzelticket-Workflow (`baseTarif()`/hartes `unitPrice=0` in "Sitze
  zuordnen"), das zur Kontrolle ebenfalls nochmal geprüft und als bereits korrekt
  bestätigt wurde.
- Getestet via `test_workflow` (Webhook-Trigger, echtes JBCKH-Warenkorb-Payload
  nachgebildet) — Begleitperson-Zeile berechnet jetzt korrekt 0,00 €, dann published.
- **Reale Order nachträglich korrigiert:** Position 1 (Begleitperson-Sitz, `positionid:1`)
  per `PATCH .../orderpositions/{id}/` auf `price:"0.00"` gesetzt — pretix hat
  `tax_value` und den Order-`total` automatisch neu berechnet (194,40 € → 85,20 €,
  stimmt jetzt mit dem kommunizierten Preis überein). Keine manuelle Anpassung des
  Order-`total`-Felds nötig.

**Nebenfund bei der Diagnose (kein Bug, aber verwirrend):** Die parallel gemeldete
"1 von 27 Positionen fehlgeschlagen"-Alarm-Mail für dieselbe Order war ein Fehlalarm.
Die als fehlgeschlagen protokollierte Position (Sitz 20, Subevent 16) existierte beim
Nachprüfen über die pretix-API einwandfrei (`positionid:18`, korrekt `0,00 €`) — die
Order hatte alle 29 Positionen vollständig, keine Duplikate, keine Lücke. Vermutete
Ursache: ein verzögerter/wiederholter HTTP-Request, bei dem der erste Versuch serverseitig
erfolgreich war, aber der (überflüssige) Retry auf den inzwischen belegten Sitz traf und
dessen 400-Antwort fälschlich als Ergebnis protokolliert wurde. **Lehre:** Bei einer
"Positionen nachtragen fehlgeschlagen"-Meldung IMMER zuerst die tatsächliche Order in
pretix pruefen (`GET .../orders/{code}/`, Positionsanzahl vs. erwartete Anzahl), bevor man
von einem echten Datenverlust ausgeht — die Meldung allein beweist noch keine fehlende
Position.

## Frühbucherrabatt abgeschafft (31.08.2026)

Der Frühbucherrabatt auf die Dauerkarte (20 %, Stichtag 31.08.2026, mit dem
Mitgliedsrabatt auf zusammen 50 % kombinierbar) ist auf Wunsch des Vereins ersatzlos
entfallen — nicht abgelaufen, sondern entfernt. Es gilt nur noch der dauerhafte
Mitgliedsrabatt von 30 % für Mitglieder des Basketball Löwen e.V.

**Warum das nur zusammen geht:** Der Preis wird an **zwei** Stellen unabhängig
voneinander gerechnet — im Browser für die Warenkorb-Anzeige (`js/seat-picker.js`,
konfiguriert über `dauerkarteDiscount` in `tickets/dauerkarte.html`) und serverseitig im
Bestell-Workflow, der die pretix-Order anlegt. Eine einseitige Änderung hätte
Warenkorb-Anzeige und Order-Total auseinanderlaufen lassen — derselbe Fehlertyp wie beim
Begleitperson-Vorfall (Order `JBCKH`, 13.08.).

**Serverseitig betroffen** (Workflow `HyUXW4kbhaQVbG0A`) waren **zwei** Code-Nodes, die
den Rabatt jeweils mit eigener Konstante kannten — beim Suchen nach `EARLY_BIRD_PERCENT`
fällt der zweite leicht durchs Raster:

1. `Preis serverseitig berechnen` → `tarifPrice()`, die reguläre Preisberechnung
2. `Mitgliedsrabatt verifizieren` → `basePriceFor()`, die **Neu**berechnung für den Fall,
   dass ein beanspruchter Mitgliedsrabatt nicht gegen die Mitgliederliste bestätigt
   werden kann und die Zeile auf den Tarif ohne `_member` zurückfällt

**Wie getestet wurde (und warum nicht per `test_workflow`):** Ein Testlauf über den
Webhook-Trigger schied hier aus. `prepare_workflow_pin_data` liefert für sechs Nodes kein
Schema (u. a. `DK: Order kostenlos - mark_paid`, `Notion: Kontakt taggen`,
`Alarm: Positionen nachtragen fehlgeschlagen`), und die Data-Table-Nodes
(`Bestellung in Data Table speichern`, `Reservierung: Zeilen einfuegen`) laufen bei
`test_workflow` grundsätzlich **echt** — ein Testlauf hätte reale Sitze in der
Belegte-Sitze-Tabelle als besetzt eingetragen (s. Vorfall 13.08.). Stattdessen wurden die
beiden geänderten Code-Bodies isoliert in Node gegen einen nachgebauten Warenkorb
gefahren (alle Tarife inkl. `kind`, `begleitung`, `_member` und Downgrade-Pfad) und
Zeile für Zeile gegen `_dkTarifPrice()` aus der echten `js/seat-picker.js` verglichen:
keine Abweichung.

Absicherung obendrauf: Im alten Code war `pct = (member ? 30 : 0) + (earlyBirdActive ? 20
: 0)`. Ab dem 01.09.2026 wäre `earlyBirdActive` ohnehin `false` gewesen — der neue Code
ist also rechnerisch identisch mit dem, was der Workflow einen Tag später von selbst
gerechnet hätte. Das Publishen hat das Verhalten nur um wenige Stunden vorgezogen.

**Wo der Rabatt auf der Website stand** (Stand nach dem Gameday-Hub-Umbau): Badge und
Warenkorb-Logik in `tickets/dauerkarte.html` + `js/seat-picker.js`, die Vorteilslisten in
`mitglied-werden.html` und `fans/fanclub.html`, das Suchwort in `data/search-index.json`
— und die Preis-Sidebar samt Rabatt-Modal auf `saison/profis/gameday/index.html`. Die
Hub-Seite ist **generiert**: geändert wurde `tools/build-gameday-hub.py`
(`TERMINE_VORLAGE` und der `wireBadgeModal`-Block), danach der Generator neu laufen
gelassen. Wer nur die HTML-Datei anfasst, bekommt den Rabatt beim nächsten Lauf zurück.

Zwei Fallstricke beim Entfernen eines solchen Badge-Modal-Paars: Der
`wireBadgeModal`-Aufruf muss mit weg (sonst `addEventListener` auf `null`), und der
Escape-Handler zählt die Modal-IDs einzeln auf — bleibt die ID des entfernten Modals dort
stehen, wirft **jeder** Escape-Tastendruck auf der Seite.

**Bewusst nicht angefasst:** Die archivierten Instagram-Posts unter `news/insta-archiv/`
und die Captions in `data/instagram-loewen.json` nennen weiterhin „-20% für Frühbucher" —
das sind wortgetreue Kopien echter Posts (Historie), und der automatische Instagram-Sync
würde eine Änderung ohnehin wieder überschreiben.

## Automatischer Bestellungs-Ablauf abgeschaltet (06.09.2026)

Marko meldete eine pretix-Mail „Ihre Bestellung läuft bald ab" zur Order `DXXAX` als
„falsch und unnötig". Die Mail war inhaltlich korrekt — falsch war die Einstellung
dahinter.

**Das Problem:** Dauerkarten werden per SEPA-Lastschrift bezahlt, die der Verein selbst
einzieht (Workflow „BH: SEPA-Lastschrift erzeugen"). pretix sieht davon nie einen
Zahlungseingang: Die Orders stehen dauerhaft auf `status: n` (pending) mit leerem
`payments`-Array. Das Event `saison2627` hatte aber `payment_term_expire_automatically:
true` bei `payment_term_days: 14` — pretix hätte die Bestellungen also der Reihe nach
automatisch storniert und **die Sitzplätze wieder freigegeben**. Die Warnmail
(`mail_days_order_expire_warning: 3`) war lediglich die Ankündigung davon.

Betroffen waren zum Zeitpunkt der Prüfung **sieben offene Bestellungen über zusammen
1.728 €**, die zwischen dem 08.09. und 15.09.2026 abgelaufen wären — die erste zwei Tage
nach der Meldung.

**Fix (Marko-Entscheidung, 06.09.2026):**

```
PATCH /api/v1/organizers/xxl/events/saison2627/settings/
{"payment_term_expire_automatically": false, "mail_days_order_expire_warning": 0}
```

`expire_automatically: false` ist der eigentliche Fix — Bestellungen laufen gar nicht
mehr ab, die Plätze bleiben belegt, und damit entfällt auch der Anlass für die Mail.
`mail_days_order_expire_warning: 0` steht zusätzlich drin, damit garantiert nichts mehr
rausgeht, unabhängig davon wie pretix die Warnung intern auslöst.

**Preis dieser Einstellung:** Eine wirklich abgebrochene, nie bezahlte Bestellung gibt
ihren Sitzplatz jetzt nicht mehr von selbst frei. Solche Fälle müssen von Hand storniert
werden. Das ist der bewusst akzeptierte Nachteil gegenüber dem Risiko, bezahlte
Dauerkarten stillschweigend zu verlieren.

**Der strukturell saubere Fix wäre ein anderer:** Der Dauerkarten-Bestellworkflow
müsste die Order bei erteiltem SEPA-Mandat in pretix als bezahlt markieren (`mark_paid`),
so wie es der Einzelticket-Workflow nach der PayPal-Zahlung tut. Dann stimmte der
pretix-Status mit der Realität überein und die Ablauf-Logik könnte anbleiben. Bewusst
nicht in einem Zug miterledigt: Das greift in die Order-Anlage und damit in
Rechnungsstellung und Buchhaltung ein und gehört separat geplant.

**Wie geändert:** Die pretix-API ist aus der Claude-Session nicht direkt erreichbar
(Egress-Policy). Der Aufruf lief über einen temporär angelegten n8n-Workflow („Claude:
pretix Diagnose (temporaer)", `4b5L1MxytRjBtzTZ`) mit der bestehenden Credential
„Pretix XXL - Ticketing", zuerst rein lesend zur Diagnose, dann mit dem PATCH und einem
separaten Kontroll-GET. Der Workflow wurde danach archiviert.

## Ticketing-Dashboard: Gesamtzahl-Kachel und Saisonziel (24.09.2026)

Das Ticketing-Dashboard ist **kein Teil dieses Repos** — es entsteht vollständig als
Template-String im Code-Node „Board-HTML bauen" des n8n-Workflows „Ticketing:
Gutschein-Board (Formulardaten + Erstellen)" (`AA0f7oo7dH7TDkFu`), ausgeliefert über
`https://ticketing.basketball-loewen.com/webhook/ticketing/board`. Änderungen an der
Seite laufen ausschließlich über n8n (`updateNodeParameters` mit vollständigem
jsCode, danach `publish_workflow`), s. Notion-Referenz „Ticketing-Board" in der
IT-Landschaft.

Auf Marko-Wunsch zeigt der erste Tab („Tickets") jetzt ganz oben eine **Gesamtzahl**-
Kachel: verkaufte Plätze gegen die tatsächliche Saison-Gesamtkapazität (aus den
pretix-Kontingenten, summiert über alle Heimspiele — eine Dauerkarte zählt bewusst in
jedem Spiel einzeln mit), sowie der Gesamterlös gegen ein Saisonziel.

**Saisonziel Ticketing-Einnahmen: 50.000 €.** Liegt als Konstante `zielUmsatz` direkt
im Alpine-State des Boards (im Code-Node, keine Data Table) — zum Ändern also den
Wert im Code-Node anpassen und den Workflow neu veröffentlichen.

### Nachtrag (24.09.2026): Plätze-vs-Tickets-Bug und Vergleich zur Saison 2025/26

Eine Dauerkarte hat pro Heimspiel eine eigene pretix-Position, aber wegen des
Flat-Preismodells (s. „Build pretix Order Payload") trägt nur die erste dieser
Positionen den echten Saisonpreis — die übrigen 12–13 stehen auf `price: "0.00"`.
Ein naives `price > 0`-Filtern pro Einzelposition zählt eine Dauerkarte deshalb in
13 von 14 Spielen fälschlich als „unverkauft". Der Node „DK-Statistik aufbereiten"
gruppiert Dauerkarten-Positionen deshalb über `(order code, seat_guid)` und wertet
die ganze Gruppe als bezahlt, wenn irgendeine Position darin einen Preis > 0 hat.

Daraus liefert der Endpunkt `/webhook/ticketing/dauerkarten-uebersicht` vier Zahlen
für die Gesamtzahl-Kachel:
- `gesamtKapazitaet` — Saison-Gesamtkapazität (ein Sitz × 14 Heimspiele)
- `gesamtVerkauft` — belegte Plätze inkl. Freikarten (100 % Rabatt)
- `gesamtWirklichVerkauft` — belegte Plätze, nur bezahlt (Haupt-Kennzahl der Kachel)
- `gesamtWirklichVerkauftTickets` — Anzahl distinkter bezahlter Tickets/Käufe dahinter
  (eine Dauerkarte über 14 Spiele zählt hier als 1 Ticket, nicht als 14 Plätze)

Die Kachel vergleicht bewusst „verkauft vs. verkauft" mit der Saison 2025/26 (altes
System, keine pretix-Daten): `gesamtWirklichVerkauft`/`gesamtWirklichVerkauftTickets`
gegen die hartkodierten Werte 2.483 bezahlte Einzeltickets + 70 Dauerkarten. Die
2025/26-Zuschauerzahl (11.149, 12 Heimspiele) enthält laut PPTX/Notion auch
Freikarten und wird deshalb nur als separate Einordnungszeile gezeigt, nie als
„verkauft" bezeichnet.

## Gutschein bei Bestellung mit mehreren Plätzen (29.09.2026)

**Vorfall:** Sponsorin Salus BKK bestellte zwei VIP-Dauerkarten (Bestellung `7PAEE`,
Mandatsreferenz `DK-4VJWVB`). Es waren zwei Einzelgutscheine (je 100 %, 1× einlösbar)
angelegt worden. Die Bestätigungsmail zeigte zwei Gutschein-Zeilen, der Gesamtbetrag
stand aber bei 1.290 €.

**Ursache:** Pro Bestellung wird serverseitig nur **ein** Code verrechnet
(`cart.voucher` / `voucherCode` sind einfach, nicht Listen). Ist dieser Code nur
1× einlösbar, wird nur ein Platz rabattiert. Auf der Website blieb das Gutscheinfeld
nach dem Einlösen auf der Sitzplatzwahl aber sichtbar, weil `findVoucherLineIndex()`
in `tickets/checkout.html` auf `'Gutschein '` (mit Leerzeichen) prüfte, die Zeilen aber
`'Gutschein: …'` heißen. So konnte der Code im Checkout ein zweites Mal abgezogen
werden: Anzeige 0 €, serverseitig aber 1.290 €. Dazu kam ein doppeltes „€" in der
Rabattzeile (`formatMoney()` hängt das € schon an).

**Fix im Repo:** Prüfung auf `'Gutschein'` in `checkout.html`, `confirmation.html`,
`payment.html`; doppeltes „€" entfernt (Commit `58194d4e`).

**Regel für Sponsoren/Ehrenamt mit mehreren Plätzen:** Einen einzigen Gutschein
anlegen und bei „Anzahl Nutzungen" die Zahl der Plätze eintragen („Anzahl Gutscheine"
bleibt 1), nicht mehrere Einzelgutscheine.

**Manuelle Korrektur der Bestellung (über temporäre n8n-Workflows, danach archiviert):**
- pretix: `POST …/orders/7PAEE/change/` mit `patch_positions` (Preis der Ankerposition
  von Platz 14 auf `0.00`), `notify: false`, `reissue_invoice: false`; danach ist die
  Bestellung von pretix selbst auf `p` gesetzt worden. Interne Notiz am Order-Kommentar.
- Data Table „Lastschriften-Tickets" (`2vyxXBxm5m4IGGuq`), Zeile `DK-4VJWVB`:
  `total` 0, `status` `bezahlt`, `voucherLineDiscounts` `[1290,1290]`,
  `voucherDiscount` 2580, wie bei den anderen Nullbetrag-Bestellungen. Die
  SEPA-Sammellastschrift holt nur Zeilen mit Status `angelegt` und überspringt
  Nullbeträge, es kann also keine Abbuchung entstehen.
- Zweiter Gutschein `SALUS-BKK-T2SYNQ` gesperrt: `valid_until` auf 29.09.2026 gesetzt
  statt gelöscht, Grund im Kommentar.
- Ticketmail: Die automatische Mail (Workflow `zNGWzRFz3ebzsDkD`) war beim
  `order.paid`-Webhook an einem 409 „not ready" des PDF-Abrufs gescheitert. Nachgeholt
  per POST an `…/webhook/pretix-order-event` mit `{organizer, event, code, action:
  "pretix.event.order.paid"}`.

## Einzelticket-Bestellung und Ticket-Mail repariert (29.–30.09.2026)

**Auslöser:** Fehlgeschlagene VIP-Sponsorenbestellung `ET-6TARLH` (André Grenzdörffer für
Arthur Grund, Gutschein `GRUND-B6YLH5`, 4 Plätze) und danach Fehler-Mails im
Ticket-Mail-Workflow. Beide Workflows laufen nur in n8n, hier steht der Stand.

**1. Workflow „Einzelticketbestellung verarbeiten" (`BmpBkKdzzSZaBnZE`), Node „Sitze zuordnen"**
(Version `3bbbeec4`, 29.09. 20:27):
- `resolveBlockKey` entscheidet jetzt bei VIP, Fanblock, „C unten", Rollstuhlplatz und
  Stehplatz zuerst nach `category`, erst danach nach `zoneId`. Der Warenkorb liefert in
  `zoneId` die physische Zone („B"), in `category` das Produkt („VIP"). Vorher wurde eine
  VIP-Zeile zu „Block B" (Item 35, Reihe 6–12) statt zu VIP-Einzel (Item 40, Reihe 1–5),
  und pretix lehnte den Item-40-Gutschein mit HTTP 400 ab.
- Im Kostenlos-Zweig wird der Gutschein an jede gedeckte Position gehängt, bis zu den
  Restnutzungen (Preis nach Rabatt, bei 100 % also 0,00), nicht nur an die erste. Wirft
  einen Fehler, wenn das Item nicht zum Gutschein passt oder der Gesamtbetrag 0 ist, die
  Positionspreise aber nicht 0 ergeben.
- Offen: Im PayPal-Capture-Zweig bleibt das alte Verhalten (nur erste Position, keine
  Item-Prüfung), dort fehlt der Gutschein-Kontext. Rollstuhlplatz-Bestellungen scheitern
  weiter mit „Kein freier Sitzplatz", weil pretix nur die Zonen Block A–F kennt.
- Alarmmail „Zahlung ohne Ticket": bei Gesamtbetrag 0 steht kein PayPal/Erstattungs-Text mehr.
- Dauerkarten-Workflow (`HyUXW4kbhaQVbG0A`, „Build pretix Order Payload") hat dasselbe
  `voucherAttached`-Muster (Gutschein nur an der ersten Position, bei Mehrfach-Gutschein
  und mehreren Plätzen bleibt er wiederverwendbar). Noch nicht geändert.

**2. Workflow „Reservierungen synchronisieren" (`zNGWzRFz3ebzsDkD`), sendet die Ticket-Mail**
(Version `d7934b08`, 27 → 37 Nodes; Einzelticket-Workflow `59c34d4c`):
- **Doppelversand:** pretix und der Einzelticket-Workflow (Node „Ticket-Mail ausloesen
  (sofort bezahlt)") melden `order.paid` im Abstand von 0,06–0,15 s. Der zweite Aufruf
  trägt jetzt `source: "direct"` und wartet im Ticket-Mail-Workflow 25 s
  („Direkt-Trigger?" → „Vorrang fuer pretix-Event (25 s)"). Vor dem Senden wird die
  Bestellung im Order-Kommentar per `[ticket-mail-laeuft:<Zeitstempel>]` reserviert
  („Mail-Marker beanspruchen"), danach durch `[ticket-mail-versendet]` ersetzt. Eine
  Reservierung älter als 20 Minuten gilt als verwaist. Bei Sendefehler wird sie
  freigegeben. Der manuelle Retrigger (POST ohne `source`) wartet nicht.
- **Fehlende Dateien:** pretix erzeugt Ticket-Dateien beim ersten Abruf und antwortet mit
  HTTP 409 „not ready" (auch 500 und Abbrüche kamen vor). Die alten Wiederholungs-
  Einstellungen griffen nicht, weil der Fehler als Ausgangs-Item ankam. Jetzt gibt es
  echte Schleifen: PDF bis zu 12 Versuche, Passbook bis zu 6 (optional), je 5 s Pause,
  409/429/5xx/Timeouts zählen als Wiederholung.
- **Keine Teil-Mails mehr:** „Anhänge zusammenführen" vergleicht die PDFs mit den
  Positionen. Fehlt eines, geht keine Kundenmail raus, sondern „Ticket-Mail
  unvollstaendig: <Code>" an marko.fliege@ und die Reservierung wird entfernt. Fehlen nur
  Passbooks, geht die Mail mit den PDFs raus.
- **Getestet** an einer Kopie, die nur an Marko mailte (Race, 409-Wiederholung, dauerhafter
  Ausfall, fehlende Passbooks, Dauerkarte), danach in Produktion bei Bestellung MC377
  (Ausführung 79456, 3 von 3 PDFs). Zwei pretix-Ereignisse derselben Quelle innerhalb von
  ca. 100 ms wären weiterhin theoretisch racy.

**3. Betroffene Kunden (Stand 30.09.):** Doppelt, aber identisch: DSFZB, DQZLF, ZKYEU.
Unvollständig: UHJPU (8 Plätze, Platz 2292 fehlte) und MC377 (Platz 2300 fehlte), für beide
wurde die Mail nachgesendet (MC377 erledigt). `KMTVH` (Tickets für Arthur Grund, 4 VIP) erhielt
vier Tickets in einer nachträglich gesendeten Mail.

**4. Gutscheine der Einladung:** Die vier unbenutzten Einzelgutscheine `GRUND-V5RTKT`,
`-3UEPBR`, `-UG9VW7`, `-VQBY7L` wurden gesperrt (`valid_until` 29.09.2026). Die
Eintragszeile `ET-6TARLH` in „PayPal-Zahlungen" (`pABu2vTPT1WY4uNh`, Zeile 33) steht auf dem
neuen Status `manuell_erledigt`; kein Workflow reagiert auf diesen Wert.

## Ticket-PDFs von 2,4 MB auf 0,3 MB verkleinert (30.09./01.10.2026)

**Ursache:** Der Hintergrund der pretix-Ticketlayouts war ein PDF (ReportLab) mit 50 Bildern,
97 % der Ticketgröße: Sponsorenlogos mit bis zu 4.568 dpi, ASCII85-kodiert, und 16 von 29
Bildern lagen komplett unter weißen Flächen (alter Ballast). pretix bettet den Hintergrund
in jedes Ticket neu ein, daher 2,42 MB je Ticket. Eine Mail mit 8 Tickets war damit über
Gmails 25-MB-Grenze (7 Tickets passten gerade noch).

**Fix:** Hintergrund neu geschrieben (Bilder auf 250 dpi, verdeckte Bilder durch 1×1-Platzhalter
ersetzt, Flate statt ASCII85, Seiteninhalt byte-gleich): 263.101 statt 2.364.945 Byte,
Ticket jetzt ca. 320 KB (je Passbook ca. 23 KB). Layout 5 „Ticket_Dauerkarte_Gebrandet" und
Layout 8 „Ticket_Einzelticket_Freiwahl" nutzen dieselbe Datei. Layout 4 „Ticket_Basis" blieb
unberührt. Der QR-Bereich ist pixelgleich. Das Original liegt lokal unter
`Projects/ticket-hintergrund-backup/` (nicht im Repo), Rückweg = dieselben Schritte mit dem Original.

**pretix-API für den Hintergrund:** Es gibt keinen Endpunkt `…/ticketlayouts/<id>/background/`
(404). Der Upload läuft zweistufig: `POST /api/v1/upload` (Body = PDF, Header
`Content-Disposition: attachment; filename="background.pdf"` und `Content-Type:
application/pdf`) liefert `{"id":"file:<uuid>"}`, danach `PATCH
/api/v1/organizers/xxl/events/saison2627/ticketlayouts/<id>/` mit `{"background":"file:<uuid>"}`.

**Zwischenspeicher:** pretix liefert bereits erzeugte Tickets weiter aus dem Cache (auch nach
dem Layout-Wechsel). Neu erzeugt werden sie nach einer Bestellungsänderung, z. B. ein
Preis-neutraler `POST …/orders/<code>/change/` mit `patch_positions` (Preis unverändert),
`notify: false`, `reissue_invoice: false`. Der erste Abruf danach liefert HTTP 409, die
Datei ist erst beim zweiten Abruf da. Bereits versendete Tickets bleiben unverändert groß.

## Dauerkarten-Workflow: Gutschein an jeden rabattierten Sitz (01.10.2026)

Workflow `HyUXW4kbhaQVbG0A`, Node „Build pretix Order Payload" (Version `e4936d67`):
Der Gutschein hängt jetzt an der Ankerposition (erstes Spiel, einzige Position mit Saisonpreis)
**jedes** rabattierten Sitzes, bis zu den Restnutzungen (`remainingUses` aus der
Shared-Rabattberechnung, sonst `max_usages − redeemed` aus „Gutschein in pretix suchen"),
statt nur an der des ersten Sitzes. Vorher zählte pretix bei einem Mehrfach-Gutschein nur
eine Einlösung, der Gutschein blieb wiederverwendbar (Fälle QGA9P und 7PAEE). Neu:
Abbruch vor dem Anlegen der Order, wenn mehr Sitze rabattiert wurden, als Einlösungen übrig
sind, oder wenn Artikel, Variation, Sitz oder Spiel nicht zum Gutschein passen. Folgepositionen
der anderen Spiele bekommen nie einen Gutschein. Getestet nur offline gegen echte Altbestellungen
(Einzelsitz, ohne Gutschein, 2 Sitze, 24 Sitze), identische Ausgabe außer bei Mehrfach-Gutscheinen.
Noch nicht live beobachtet: ob pretix den Gutschein an den später per `/orderpositions/`
angelegten Positionen annimmt. Die erste echte Bestellung mit Mehrfach-Gutschein beobachten.

**Regel für Mehrfach-Gutscheine:** Pro Bestellung wird im Shop nur ein Code verrechnet. Für mehrere
Plätze deshalb einen Gutschein mit „Anzahl Nutzungen" = Zahl der Plätze anlegen, nicht mehrere
Einzelgutscheine.

## Ticket-Mail erneut senden (Ablauf)

1. Bestellung muss `p` sein, alle Positions-PDFs müssen abrufbar sein (409 = noch in Arbeit, nach 30 s wieder).
2. Marker im Order-Kommentar entfernen: `PATCH …/orders/<code>/` mit `{"comment": ""}`. In einem
   n8n-HTTP-Node muss `sendBody` ein echter Boolean sein, sonst wird der Body nicht gesendet und
   die Änderung passiert still nicht.
3. Genau einmal `POST /webhook/pretix-order-event` mit `{"organizer":"xxl","event":"saison2627","code":"<Code>","action":"pretix.event.order.paid"}` (ohne `source`).
4. Die Ausführung von `zNGWzRFz3ebzsDkD` prüfen: `pdfCount` gleich `expectedCount`, Marker wieder `[ticket-mail-versendet]`.
Nachgesendet am 30.09./01.10.: KMTVH, MC377 (3 Tickets), UHJPU (8 Tickets, zusammen 2,5 MB).

## PayPal-Pfad: Teilrabatt-Gutscheine und Toleranz (01.10.2026)

Workflow `BmpBkKdzzSZaBnZE`, Node „Sitze zuordnen" (Version `f4c86d84`). Bezahlte Bestellungen laufen
über den Capture-Webhook in einer eigenen Ausführung, dort fehlte bisher der Gutschein-Kontext.
Neu im Capture-Zweig:
- IF „Gutschein im Capture nachladen?" und HTTP „Gutschein in pretix suchen (Capture)" nach „Freie Sitze
  pruefen". Der Lookup läuft nur bei gespeichertem Gutscheincode, ist read-only und kann den Capture
  nicht stören (neverError, 2 Versuche, 15 s). Kategorien und Tarif-Einschränkung werden wie in
  „Gutschein-Rabatt berechnen" aus Item/Quota abgeleitet (`ITEM_TO_CATEGORY` und `QUOTA_TARIF` stehen jetzt in
  beiden Nodes und müssen synchron bleiben).
- Der Gutschein hängt an jeder gedeckten Position bis zu den Restnutzungen, die Positionspreise folgen dem
  Rabatt. Vorher legte der Capture-Zweig pretix-Orders zu Listenpreisen an (Altfall 75393: 12,50 € in pretix bei
  6,25 € bezahlt).
- **Toleranz statt Alarm:** Weicht die Summe der Positionspreise (inkl. Nachwuchs) vom bezahlten Betrag
  ab, wird die Bestellung trotzdem angelegt. Die Differenz geht auf die letzte Ticketposition mit Preis > 0
  (reicht das nicht, auf die vorherige, Preise nie unter 0,00; Nachwuchs zuletzt). Bei Abweichung über 1 Cent
  steht im Order-Kommentar `Preis-Anpassung Capture: Differenz … EUR auf Position … verteilt (bezahlt …,
  berechnet …), Gutschein …`. Nur im kostenlosen Zweig (Betrag 0, aber ungedeckte Position) bleibt
  der Alarm, weil dort kein Geld geflossen ist. Gift-Card-, Festbetrags- und Ohne-Gutschein-Pfad
  unverändert. Offline getestet (50 Fälle), der Capture-Pfad selbst ist ohne echte PayPal-Zahlung nicht live testbar.

## pretix auf Railway: Auslastung (01.10.2026)

Web-Dienst: 24 vCPU, Limit 8 GB, Verbrauch die Woche über ca. 1,1 GB, CPU ≈ 0; Worker ohne praktische Grenze
(ca. 0,4–1,0 GB), Postgres ca. 100 MB, Redis ca. 10 MB. Keine SIGKILL-/OOM-Meldungen in 7 Tagen, 10 Gunicorn-Neustarts.
**Mehr RAM wird nicht gebraucht.** Die gelegentlichen HTTP-500 beim Abruf frischer Ticket-/Passbook-Dateien
sind `botocore NoSuchKey` im Medien-Bucket (S3): pretix hält die Datei für fertig, sie liegt aber noch nicht im
Bucket. Der Ticket-Mail-Workflow wiederholt deshalb auch bei 5xx. Offen: SMTP-Verbindungsabbrüche
(`SMTPServerDisconnected`) im Worker beim pretix-eigenen Mailversand und die Frage, ob das Erzeugen der
Ticketdateien im Worker oder im Web-Dienst läuft.

## Gutschein-Hinweis „Rest verfällt" im Checkout (01.10.2026)

Der Workflow `5Bi15oYpyehxjhXK` („Subprozess Gutschein/Wertgutschein einlösen", bedient
`/webhook/gutschein-einloesen`, Version `db595b8e`) liefert zusätzlich zu den bisherigen Feldern (nur additiv):
`voucherMode` (pretix `price_mode`), `voucherValue` (Wert je Einlösung), `coveredUses` (gedeckte Einheiten, gleiche
Zuordnung wie im geteilten Rabatt-Workflow `QxPE1ikMJWL0fyB7`, den die Dauerkarten-Bestellung ebenfalls nutzt),
`usedAmount` (= `discountAmount`), `unusedAmount` (nur bei `subtract`: Wert × coveredUses − genutzt) und
`remainingUsesAfter`. Für Wertgutscheine bleibt alles unverändert (Restguthaben steht in der Meldung).
`tickets/checkout.html` zeigt unter der Meldung `#voucher-hint`: bei Festbetrags-Gutscheinen „Von 20,00 € werden
12,00 € genutzt, 8,00 € verfallen.", bei Mehrfach-Gutscheinen „Dein Gutschein ist danach noch 2× einlösbar."; keinen
Hinweis bei Prozent-, ausgeschöpften und Wertgutscheinen. Der ältere Pfad auf der Sitzplatzwahl (`js/seat-picker.js`,
`_voucherHint()`) rechnet die Texte clientseitig; ohne Produktbindung des Gutscheins gibt es dort keinen Hinweis.
`coveredUses` ist eine Nachbildung der Shared-Logik und muss bei deren Änderung im Node
„Einloesen: Hinweisfelder ergaenzen" nachgezogen werden. Der echte Round-Trip mit einem Live-Gutschein ist nicht getestet.

Nebenwirkung der Erkennungs-Korrektur vom 29.09. (Gutschein-Zeilen heißen „Gutschein: …"): Die Gutschein-Box wird nach
dem Einlösen ausgeblendet, damit ging die Meldung („Restguthaben …", Fehlertexte) mit unter. Die Meldung steht jetzt
außerhalb der Box (Commit `7b378b0c`).

## pretix-Mailversand: Worker auf Relay umgestellt (01.10.2026)

Den Mailversand von pretix übernimmt der **Worker** (Celery-Queue `mail`). Er hatte seit August noch die alte
SendGrid-Konfiguration (`PRETIX_MAIL_HOST=smtp.sendgrid.net`, Benutzer `apikey`, SendGrid-Passwort, Absender
`tickets@example.com`), nur der Web-Dienst nutzte das Google-Relay. Folge: pretix-eigene Mails (Benachrichtigungen an
Teammitglieder, Storno-Mails) scheiterten mit `SMTPServerDisconnected` beim Anmelden (Beispiel: Ausgehende Mail #49,
„Bestellung storniert: HHTWS", 23.09.); die Ticket-Mails über n8n/Gmail waren nie betroffen. Behoben am 01.10.2026:
Worker-Variablen `PRETIX_MAIL_HOST=smtp-relay.gmail.com`, `PRETIX_MAIL_USER` und `PRETIX_MAIL_PASSWORD` leer,
`PRETIX_MAIL_FROM=tickets@basketball-loewen.com`. Das Relay prüft per IP; Railway-Ausgangsadressen sind je Dienst
vergeben (Worker 208.77.244.241 / 152.55.184.241 / 152.55.185.190, Web 208.77.244.240 / 152.55.184.241 /
152.55.185.189), alle sechs sind im Google-Admin (Gmail → Routing → SMTP-Relay-Dienst „Railway") freigegeben.
Bei Änderungen an der Mail-Konfiguration immer Web und Worker prüfen. Verifiziert am 01.10.2026: Die
Bestätigungsmail (Code) für das pretix-Konto `rechnung@` kam über den neuen Worker an und der Code wurde eingegeben.
Der alte SendGrid-Schlüssel steht noch in SendGrid, ist aber nirgends mehr konfiguriert.

## Rollstuhlplätze im Einzelticket (01.10.2026)

**Plätze:** 21 Rollstuhlplätze laut Sitzplan (`assets/seating/riethsporthalle-seatingplan.json`, Feld `wheelchair`): Block A Reihe 1
Platz 20 (1), Block D Reihe 6 Plätze 11/13/15/17/19 (5), Block E Reihe 6 Plätze 1–10 (10), Block F Reihe 6 Plätze 11–15 (5).
Block B und C haben keine (bestätigt 01.10.2026). Das Rollstuhl-Produkt je Spiel hat ein Kontingent „HSxx: Rollstuhlplatz" mit
Größe 21 (Produkte 34 Einzel, 39 Dauer, 57 Abend). Die Block-Kontingente sind netto ohne diese Plätze gerechnet.

**pretix-Verhalten (per `simulate=true` geprüft):** Produkt 34 verlangt einen Sitz („requires to choose a seat"), nimmt aber
jeden freien Sitz an. pretix vergleicht weder Sitz-Kategorie noch das Rollstuhl-Kennzeichen mit dem Produkt, `seat.product`
ist überall leer. Ein normales Ticket kann deshalb einen Rollstuhlplatz bekommen, wenn der Ablauf es nicht verhindert.

**Fehler vor dem Fix:** Die automatische Platzvergabe nahm Plätze nach Reihe und Nummer, Reihe 6 ist in D/E/F die vorderste
(UHJPU bekam E6/1–8 als normale Plätze). Eine Rollstuhl-Zeile suchte eine pretix-Zone „Rollstuhlplatz", die es nicht gibt, und
brach mit „Kein freier Sitzplatz mehr in Rollstuhlplatz" ab. Die Begleitperson (Tarif `begleitung`) hatte keine Variante.

**Fix (Weg A, Workflow `BmpBkKdzzSZaBnZE`, Node „Sitze zuordnen", Version `b3777b01`):**
- `WHEELCHAIR_SEATS` (21 `seat_guid`, fest im Code) wird aus dem normalen Pool aller anderen Zeilen herausgenommen.
- Eine Rollstuhl-Zeile bekommt Produkt 34 (ohne Variante, Preis laut Warenkorb 8,00 €) und einen freien Rollstuhlplatz in der
  Reihenfolge Block D, F, E, zuletzt A, aufsteigend je Block. Ist keiner frei: Fehler „Kein freier Rollstuhlplatz mehr fuer
  dieses Spiel." (Alarmpfad), nie ein Ersatz mit einem normalen Platz.
- Begleitperson: `normal`-Variante des Block-Produkts, Preis 0,00, normaler Sitz im Block der Zeile (wie bei der Dauerkarte).
- Offline mit 102 Prüfungen getestet. **Offene Risiken:** „Gutschein-Rabatt berechnen" setzt eine Begleitperson mit vollem
  Blockpreis an (Rollstuhl + Begleitung + eingeschränkter Gutschein ergibt Alarmmail), der Nachwuchs-Zusatzbeitrag kann an ein
  Rollstuhl-Ticket gehängt werden (pretix-Verhalten ungeprüft), `Preis serverseitig berechnen` zählt jede Zeile der Kategorie
  Rollstuhlplatz als Rollstuhl, und die Platzliste muss bei Sitzplan-Änderungen von Hand nachgezogen werden.
- Offen und beschlossen: Block, Reihe und Platz des zugeteilten Rollstuhlplatzes sollen in der Ticket-Mail und im Ticket-PDF
  stehen (eigene Vorlage für Produkt 34); noch nicht umgesetzt. UHJPU (E6/1–8) soll auf normale Plätze in Block E verschoben werden.

## pretix-Worker: Versions-Drift stoppt die Ticket-Erzeugung (01.10.2026, behoben 11:40)

**Befund:** Das Speichern der Mail-Variablen im Railway-Dienst Pretix-Worker (10:33) löste einen Neubau „via GitHub" aus. Das
Dockerfile (`FROM pretix/standalone:stable`, Repo `pretix-docker`) zog dabei die aktuelle Version 2026.8.x. Der Web-Dienst lief
seit 24 Tagen auf 2026.7.0, die Datenbank hatte die Migration der neuen Version nie erhalten. Folge: Jede Ticket-Erzeugung im
Worker brach ab (`ProgrammingError: column pretixbase_question.container_type does not exist`, Task
`pretix.base.services.tickets.generate`), neue Bestellungen blieben bei HTTP 409 „not ready" hängen (Fall XZTKG, ab ca. 10:55).
Die Alarmmail „Ticket-Mail unvollstaendig" meldete das korrekt und verschickte keine Teil-Mail. Die Ticket-Vorlage (Layouts 5/8)
war intakt.

**Behebung:** Dockerfile festgeschrieben (Commit `ead4655` im Repo `pretix-docker`): `FROM pretix/standalone:2026.7.0`,
`pretix-sepadebit==2.7.0`, `pretix-passbook==1.14.1` (Stand des laufenden Web-Dienstes, gelesen aus `/api/v1/version` und
`/control/global/update/`). Railway baute Web (11:36) und Worker (11:35) neu, beide auf demselben Stand, keine Migration nötig.
Danach wurde XZTKG fertig (Dateien 22 Sekunden nach der ersten Anfrage) und die Ticket-Mail ging einmal raus. Die Mail-Variablen
(Relay) blieben beim Neubau erhalten.

**Lehren:**
- Jede Variablenänderung an Web oder Worker baut neu und nimmt sich bei einem unfesten Tag die neueste Version.
- Railway-„Rollback" stellt Build UND Variablen des alten Deployments wieder her (Dialogtext), er ist hier also kein
  Weg, nur den Build zurückzudrehen.
- Das lokale Klon-Verzeichnis `Projects/pretix-docker` war hinter GitHub (S3-Medien, Saison-Pass-Plugin, `production_settings.py`).
  Vor Änderungen immer `git fetch` und prüfen.
- Upgrade nur bewusst: erst Web (führt die Migrationen aus), dann Worker, danach die Pins im Dockerfile anheben. Aktuell
  ist 2026.8.0 verfügbar.

## Bestätigungsmail Einzelticket: Absender des Tickets (01.10.2026)

Anlass: Eine Kundin (SWE, Order ET-RG9W5M) fragte nach, weil die Bestätigungsmail "Dein Ticket … separat per E-Mail von pretix" ankündigte, das Ticket aber von rechnung@basketball-loewen.com (n8n) kommt. Entscheidung (Marko): Der Absender wird in den Mails nicht genannt. Die Bestätigung sagt nur "in einer separaten E-Mail. Das dauert in der Regel nur wenige Minuten." Alle Kundenmails (Ticket-Mail `zNGWzRFz3ebzsDkD`, Einzelticket-Bestätigung `BmpBkKdzzSZaBnZE`, Dauerkarten-Bestätigung `HyUXW4kbhaQVbG0A`) haben `replyTo` = tickets@basketball-loewen.com (Absender bleibt technisch rechnung@). Ticket-Mail und Einzelticket-Bestätigung enden mit "Falls du Fragen hast, wende dich bitte an tickets@basketball-loewen.com." Format der Ticket-Mail (Version 4f8942a3): nach "…am Einlass bereithalten." folgt eine Leerzeile, die Block-Liste steht nach "Freie Platzwahl in deinem gewählten Block:" in einer neuen Zeile (z. B. "1× VIP."); bei Dauerkarten steht "Dein Platz: …" ebenfalls nach einer Leerzeile. Weitere kundensichtbare Texte mit "pretix" gibt es nicht (Ticket-Mail, Dauerkarten-Mail, Website geprüft); die übrigen Treffer sind interne Alarm-Mails an Marko.

Entscheidung (Marko, 01.10.2026): Für Rollstuhl-Tickets (Produkt 34) wird keine eigene Ticketvorlage gebaut, und der Block wird in Ticket und Ticket-Mail nicht genannt.

## UHJPU von Rollstuhlplätzen verschoben (01.10.2026)

Order UHJPU (8 Einzeltickets Kat. I, Spiel 26, Gutschein 198, 0 €) war bei der Sitzvergabe auf den Rollstuhlplätzen Block E, Reihe 6, Platz 1–8 gelandet. Verschoben auf Block E, Reihe 7, Platz 1–8 (vorher per Sitzstatus des Subevents als frei geprüft). Status `p`, Summe 0,00 €, Preise und Gutschein unverändert, keine Mail an den Kunden (`notify:false`, `reissue_invoice:false`).

Vorgehen per API über einen kurzen Hilfs-Workflow mit dem pretix-Credential (danach archiviert): `POST …/orders/UHJPU/change/` mit `{"patch_positions":[{"position":<id>,"body":{"seat":"<seat_guid>"}}, …], "notify":false, "reissue_invoice":false}`. Das Feld heißt `body`, nicht `seat` direkt (sonst HTTP 400 "This field is required", nichts geändert).

Sitz-Tabelle "Belegte-Sitze": Eine Änderung per API löst keinen Webhook aus, die Tabelle zeigte danach weiter die alten Sitze. Nachziehen ohne Ticket-Mail: `POST /webhook/pretix-order-event` mit `{"organizer":"xxl","event":"saison2627","code":"<CODE>","action":"pretix.event.order.changed.seat"}` (alles außer `pretix.event.order.paid` löst nur den Sitz-Abgleich aus, die Mail nicht). Danach die Zeilen der Order in der Data Table prüfen.

## Abendkasse-Backend gebaut (01.10.2026)

Neuer, additiver Webhook-Zweig im Workflow `BmpBkKdzzSZaBnZE` (22 neue Nodes, Präfix
"Abendkasse: ", nichts am bestehenden PayPal/Einzelticket-Flow verändert):
`POST /webhook/abendkasse-bestellung` ← `saison/profis/gameday/abendkasse.html` (Tablet/Laptop-Seite
für den Verkauf an der Abendkasse, kein Teil des öffentlichen Shops). Ablauf: Normalize
Input → Spam-Check → Rate-Limit (eigener `endpoint: 'abendkasse'` in derselben Data
Table `Webhook-RateLimit`, 60/h statt der 8/h des öffentlichen Einzelticket-Checkouts)
→ Sitze zuordnen → Create pretix Order → sofort mark_paid → parallel (a) Ticket-Mail-
Pipeline der öffentlichen Seite auslösen (`source:"direct"`, für Archivierung/Platzhalter-
Postfach `tickets@basketball-loewen.com` — ursprünglich `abendkasse@`, das aber keine
echte Mailbox ist und Mail-Delivery-Bounces an Marko auslöste, 01.10.2026 geändert)
und (b) Ticket-PDF per Retry-Schleife
(identisches Muster wie im Ticket-Mail-Workflow, bis zu 12 Versuche à 5 s) abrufen und
**direkt als PDF-Binary** an die Kasse zurückgeben (keine Mail, kein Umweg über eine URL).

**Wichtiger Unterschied zum Einzelticket-Backend:** Die "- Abend"-Items erlauben gar
keine Sitzwahl — ein mitgeschickter `seat` wird von pretix mit HTTP 400 "This product
does not allow to choose a seat" abgelehnt (per echter Testbestellung entdeckt). Der
Node "Abendkasse: Sitze zuordnen" bucht deshalb ohne jeden Sitzplan-Abgleich, rein über
pretix-Kontingent — der Node "Freie Sitze pruefen" wurde dafür komplett entfernt
(Kontingent-Prüfung übernimmt pretix selbst beim Anlegen der Order). Das betrifft auch
Rollstuhlplatz-Abend (Produkt 57): keine `WHEELCHAIR_SEATS`-Liste nötig, einfach Produkt
57 ohne Sitz bestellen.

**Kontingent-Sorge geprüft und verworfen:** Es bestand der Verdacht, die "- Abend"-Items
könnten ein eigenes, von Dauerkarte/Einzelticket unabhängiges Kontingent haben (echtes
Überbuchungsrisiko). Per `GET .../quotas/` verifiziert: Jedes Block-Kontingent listet alle
drei Produkt-Varianten gemeinsam in `items` (z. B. "Block D" eines Spiels: `[Dauer-Item,
Einzel-Item, Abend-Item]`, Rollstuhlplatz-Kontingent `[39,34,57]` mit Größe 21) — die
Abendkasse zieht aus demselben Topf wie die Online-Verkäufe, kein separates Kontingent.

**Preise serverseitig autoritativ:** `PRICES`-Konstante im Node (Einzelpreis + 2,00 €
Zuschlag, identisch zur Preisliste des öffentlichen Shops) ist die alleinige Preisquelle
— `l.unitPrice` aus dem Warenkorb wird nie übernommen, anders als beim öffentlichen
Einzelticket-Checkout (dort serverseitig nur bei Gutschein/Begleitperson überschrieben).
Grund: An der Abendkasse wird sofort bar kassiert, es gibt keine zweite Prüfinstanz wie
bei PayPal.

**Rollstuhlplatz + Begleitperson:** Rollstuhlplatz ist ein eigenes Produkt (Item 57,
kein Block), Begleitperson (Tarif `begleitung`, 0 €) hängt — wie beim Einzelticket-
Workflow — an einer normalen Ticketzeile eines echten Blocks, nie an der
Rollstuhlplatz-Zeile selbst (harter `throw`, falls doch). UI (`abendkasse.html`): Nach
Wahl eines beliebigen Blocks erscheint auf dem Tarif-Bildschirm ein
"+ weitere Kategorie"-Dropdown (Eintrag "Rollstuhlplatz"); ist mindestens ein
Rollstuhlplatz-Ticket im Warenkorb, erscheint auf dem Block-Panel zusätzlich eine
Begleitperson-Kachel (Obergrenze über `_companionSlotsRemaining` aus `js/seat-picker.js`,
ungeändert). Erste UI-Version hatte die Begleitperson fälschlich direkt im
Rollstuhlplatz-Panel, das hätte die Order-Anlage zum Scheitern gebracht — vor dem Live-
Gang korrigiert.

**Bug beim ersten Testlauf gefunden:** "Rate-Limit lesen" (Data-Table-`get`) lieferte bei
der ersten Anfrage einer IP 0 Zeilen zurück — ohne `alwaysOutputData:true` lief der
gesamte restliche Zweig dadurch gar nicht erst an (0 Items = kein Folge-Node-Aufruf),
die Kasse wäre beim ersten Verkauf jedes Tages stillschweigend hängen geblieben. Fix:
`alwaysOutputData:true` gesetzt (identischer Fix-Typ wie beim `deleteRows`-Bug vom
11.08., s. oben).

**Getestet (sechs echte Testbestellungen, damals noch über `abendkasse@basketball-loewen.com`
identifizierbar, danach alle per `mark_canceled` storniert):** Block-Kategorien, Block
mit zwei Tarifen in einer Order, sowie Rollstuhlplatz + Begleitperson (Order ZCECS:
Item 57 10,00 €, Item 48/Variation "normal" 0,00 €) — komplette Kette inkl. PDF-Abruf
und Ticket-Mail-Auslösung lief bei allen sechs fehlerfrei durch.

**Frontend-Zusatz:** Der Erfolgsfall öffnet das PDF in einem neuen Tab und ruft dort
automatisch `window.print()` auf (Timeout-Fallback falls `load` nicht zuverlässig
feuert) — auf dem iPad bestätigt (Safari und Chrome identisch, da beide auf iOS
WebKit nutzen, kein eigenes Chrome-Engine erlaubt). Ein komplett dialogloser Druck
ist aus einer normalen Webseite heraus nicht möglich; auf einem Desktop/Laptop ginge das
nur über Chrome mit `--kiosk-printing`-Flag beim Start, nicht über die Seite selbst.

**pretix-API-Stolperfalle:** Der Endpunkt zum Stornieren heißt `mark_canceled`, nicht
`cancel` (alle sechs Testbestellungen scheiterten beim ersten Versuch mit HTTP 404, bis
die korrekte pretix-API-Doku geprüft wurde). Komplette Liste der Order-Aktions-Endpunkte:
`mark_paid`, `mark_canceled`, `mark_pending`, `mark_expired`, `reactivate`, `extend`,
`approve`, `deny` — eine echte "Löschen"-Funktion für Orders gibt es über die API nicht,
Stornieren ist der einzige Weg, Kontingent/Sitzplatz freizugeben.

**Offen:** Das Ausschank-Kassensystem (zweiter Teil der ursprünglichen Anfrage, 10
Produkte ohne Lagerbestand, eigenes Terminal) ist noch nicht begonnen.

## Beobachtungspunkte (Stand 01.10.2026)

Keine Aufgaben, sondern Dinge, die bei der nächsten passenden echten Bestellung geprüft werden:

- **Rollstuhl-Bestellung mit Begleitperson:** "Gutschein-Rabatt berechnen" setzt die Begleitperson zum vollen Preis an. Beim ersten echten Fall Preis der Begleitung prüfen. Außerdem: Nachwuchs-Zusatzprodukt an Produkt 34 und die fest hinterlegte Rollstuhlplatz-Liste im Knoten "Sitze zuordnen" (Einzelticket-Workflow) bei Änderungen am Sitzplan mitpflegen.
- **Dauerkarte mit Mehrfach-Gutschein:** Bei der nächsten solchen Bestellung prüfen, ob der Gutschein an jedem rabattierten Sitz hängt und pretix die richtige Zahl Einlösungen zählt (Reparatur vom 01.10.2026, Knoten "Build pretix Order Payload").
- **pretix-Upgrade auf 2026.8.0:** Erst Web-Dienst, dann Worker, dann die Pins im Dockerfile anheben (s. Abschnitt Versions-Drift).

## Löwen-Dashboard Tickets-Tab: Orders/Tickets, stornierte Bestellungen (01.10.2026)

Workflow `AA0f7oo7dH7TDkFu` (Version 1a010dc3), Nodes "DK-Statistik aufbereiten" (Tickets-Tab, Webhook `dauerkarten-uebersicht`) und "Statistik aufbereiten" (Auslastung/Gutschein-Statistik, Webhook `gutschein-statistik`).

- **Ursache der Abendkasse-Testbestellungen im Board:** pretix setzt beim Stornieren einer Bestellung (Status `c`) `canceled` an den Positionen NICHT. Die Knoten prüften nur `p.canceled`. Beide Knoten zählen jetzt nur Positionen aus Bestellungen mit Status `n` oder `p` (Bestellstatus aus der Order-Liste; unbekannte Bestellung wird behalten). Für "Statistik aufbereiten" kam dafür der Knoten "Pretix: Orders holen (Statistik)" hinzu (Merge auf 5 Eingänge). Nebenwirkung: Die Auslastung war um die Sitze der stornierten Bestellung HHTWS (185 Positionen) zu hoch, je Spiel 14–15 Plätze; jetzt 92 pro Spiel.
- **Spalten:** Dauerkarten-Tabelle "Nach Kategorie" und "Einzeltickets pro Spiel" haben jetzt `Orders` (Anzahl Bestellungen) und `Tickets` (Anzahl Tickets). Summenzeile = Zahl verschiedener Bestellungen im Spiel (nicht die Summe der Zeilen, eine Bestellung kann mehrere Kategorien haben). Neue Felder in der API: `byCategory[].orders/tickets`, `totalOrders`, `ticketSales[].rows[].orders/tickets`, `ticketSales[].ordersTotal/ticketsTotal`; `count` bleibt gleich `tickets`.
- **Wirkung:** Gesamt verkauft 1.541 → 1.348 Plätze, Erlös 7.280,50 € → 7.186,00 €.
- **Abendkasse-Tests:** Alle Abendkasse-Bestellungen bis 01.10.2026 waren Testbestellungen und sind storniert (zuletzt JZZ9A, 18,00 € Block E + 10,00 € Rollstuhl, am Abend per `mark_canceled` ohne Mail). Danach: Gesamt verkauft 1.346 Plätze, Erlös 7.158,00 €, keine Abendkasse-Zeile mehr im Board. Echte Abendkasse-Verkäufe zählen normal mit.
- Quelle der Seite: `Projects/loewen-os/dashboard/src/dashboard.html` (Repo bbloewen/loewen-os, Commit 8f0572f); der Stand der Seite im Workflow war vorher nicht eingecheckt.

## Ticket-Hintergrund verschwunden: Ticket-Erzeugung stand still (01.10.2026, behoben 23:40)

**Vorfall:** Bestellung DUTTK (Einzelticket, 4 Tickets) bekam keine Ticket-Mail ("Ticket-Mail unvollstaendig", HTTP 409 nach 12 Versuchen). Worker-Log: `FileNotFoundError: cachedfiles/…pdf` beim Rendern des Hintergrunds. Alle neuen Einzelticket-Bestellungen ab ca. 22:45 Uhr waren betroffen.

**Ursache:** Der verkleinerte Ticket-Hintergrund wurde am 30.09. per API hochgeladen (`POST /upload` + `PATCH background=file:<id>`). Dabei verweist das Layout auf die temporäre Datei unter `cachedfiles/`, die pretix nach ca. 24 h löscht. Die Vorlagen 5 (Dauerkarte) und 8 (Einzelticket) zeigten beide darauf.

**Behebung:**
- Verkleinerte Datei (263 KB) gesichert: `Projects/ticket-hintergrund-backup/ticket_background_slim_263KB.pdf`, dazu `layouts_snapshot_2026-10-01.json` (Layout-JSON aller Vorlagen).
- Die API hat keinen Endpunkt, der den Hintergrund dauerhaft ablegt (`…/ticketlayouts/<id>/background` liefert 404), und der Layout-Editor in der Control-Oberfläche kann den Hintergrund wegen des S3-Speichers nicht laden ("Failed to fetch"). Deshalb wurden die Vorlagen in der Control-Oberfläche **kopiert** ("Kopieren" in der Layout-Liste): die Kopie legt die Datei dauerhaft unter `pub/…/ticketoutputpdf/` ab. Das Layout-JSON der Kopien ist identisch zum Original.
- Neu: Layout 9 `Ticket_Einzelticket_Freiwahl_v2` (jetzt Standard) und Layout 10 `Ticket_Dauerkarte_Gebrandet_v2`. Die 10 Dauerkarten-Produkte (37, 44, 42, 46, 43, 41, 45, 38, 39, 47) sind in der Produktseite (Tab "Tickets & Badges", PDF-Ticketlayout) auf Layout 10 umgestellt.
- Test: Je ein Ticket neu erzeugt (Dauerkarte JBCKH Position 1156, Einzelticket UHJPU Position 2286): HTTP 200, 319 bzw. 320 KB. Ticket-Mail für DUTTK einmal nachgesendet.
- Die alten Layouts 5 und 8 (zeigten auf `cachedfiles/`) waren nicht mehr zugeordnet und sind am 01.10.2026 per API gelöscht (`DELETE …/ticketlayouts/<id>/`, HTTP 204). Es bleiben Layout 4 `Ticket_Basis` (ungenutzt), 9 (Standard) und 10. Layout-JSON der gelöschten Vorlagen: `Projects/ticket-hintergrund-backup/layouts_snapshot_2026-10-01.json`.

**Regeln:**
- Layout-Hintergründe nie per API-Upload setzen (hält nur 24 h). Hintergrund ändern = Layout in der Control-Oberfläche kopieren/neu anlegen; der Editor-Upload funktioniert nicht, solange der S3-Bucket keine CORS-Freigabe für den Editor hat.
- Die API kann Layout-Zuordnungen (`ticketlayoutitems`) nicht ändern (nur lesen), und `default` lässt sich per API nicht umsetzen. Beides in der Control-Oberfläche.
- Diagnose: `GET …/ticketlayouts/` — enthält die `background`-URL `cachedfiles`, ist die Vorlage in 24 h kaputt.

## Löwen-Dashboard: Platzkarten für Dauerkarten drucken (02.10.2026)

Im Tab Ticketing → Tickets hat die Tabelle "Nach Kategorie" oben rechts den Button **Platzliste**. Er öffnet eine Vollbild-Ansicht in derselben Seite (kein Popup, siehe unten) mit allen Dauerkarten-Plätzen (aktuell 82). Oben in der Leiste: Umschalter **Liste** (Standard) und **Druckansicht**, Filter nach Block, **Drucken** (druckt die gerade gezeigte Ansicht) und **Schließen**. Beim Drucken wird der Rest des Dashboards ausgeblendet.
- **Liste:** Tabelle Block, Reihe, Platz, Kategorie, sortiert nach Block, Reihe, Platz; druckbar als normale A4-Liste.
- **Druckansicht:** Platzkarten, eine Karte je Platz (Kopfzeile "Basketball Löwen Erfurt / Dauerkarte 2026/2027", groß der Block, Reihe und Platz, Fußzeile Kategorie und Riethsporthalle), A4, 8 Karten je Seite (2 × 4, gestrichelte Schnittkante), je Block eine neue Seite. Keine Namen.

Daten: Der Webhook `dauerkarten-uebersicht` liefert jetzt zusätzlich `seats` (je Dauerkarten-Platz `block`, `row`, `seat`, `category`), nur aus offenen oder bezahlten Bestellungen (Node "DK-Statistik aufbereiten", Workflow `AA0f7oo7dH7TDkFu`, Version ac081d91). Quelle der Seite: `Projects/loewen-os/dashboard/src/dashboard.html`, Funktion `platzkartenDrucken()`. Der Fanblock liegt in Block A und erscheint dort als Block A mit der Kategorie Fanblock.

**Fehler der ersten Fassung (02.10., behoben):** Die erste Fassung öffnete ein Popup-Fenster und schrieb die Karten hinein. Das Fenster blieb leer, weil n8n die Dashboard-Seite mit `Content-Security-Policy: sandbox …` (ohne `allow-same-origin`) ausliefert: die Seite hat den Ursprung `null`, ein Popup lässt sich von ihr nicht beschreiben. Ebenso gelten in dieser Seite keine `localStorage`/Cookie-Zugriffe. Regel für alle Dashboard-Funktionen: kein `window.open` mit `document.write`, stattdessen Ansicht in der Seite; `window.print()` funktioniert (`allow-modals`). Commit `loewen-os` siehe Verlauf (Platzkarten: Vollbild-Ansicht).

## Kassen-Apps (Abendkasse/Ausschank) — Stand 02.10.2026

Die Seiten `saison/profis/gameday/abendkasse.html` und `ausschank.html` laufen in zwei nativen iPad-Apps (Repo-Ordner `Projects/kassen-terminal-bridge`, README dort), die das Sparkassen-Terminal per OPI ansteuern. Ausführlich in Notion: „Kassen-Apps: Abendkasse und Ausschank mit Sparkassen-Terminal (OPI)".

- **Zugriffsschutz:** `abendkasse-bestellung` (Workflow `BmpBkKdzzSZaBnZE`, IF „Abendkasse: Token ok?") und `ausschank-verkauf` (`GbkUoR5DI4n5QYo6`, IF „Token ok?") verlangen den Header `X-Kassen-Token` und antworten sonst 401. Der Token steht nur in diesen Knoten und in der App (`Shared/KassenSecret.swift`, nicht im Git); die App setzt `window.__kassenToken`, die Seiten lesen `OpiBridge.token()`. Die Kassen-Seiten funktionieren deshalb nur in den Apps.
- **Abendkasse:** Zahlung (OpiBridge.charge) und Bestellung/Druck laufen parallel. Schlägt die Zahlung fehl, bleibt die Bestellung bestehen und wird später über die Bestellnummer storniert (Nummer steht als `{order}` klein unter dem Barmer-Logo im pretix-Ticketlayout 9). Barzahlung (langer Druck auf die Gesamtsumme) sendet `cart.zahlart = "bar"`; „Abendkasse: Normalize Input" übernimmt es, „Abendkasse: Sitze zuordnen" schreibt den pretix-Bestellkommentar „Abendkasse - BARZAHLUNG" bzw. „Abendkasse - Kartenzahlung (Terminal)" (der Ticket-Mail-Workflow erhält diesen Kommentar als `baseComment`).
- **Ausschank-Log:** Data Table „Ausschank-Verkaeufe" (`qeFKgWBRf8PgvsZW`) hat zusätzlich `zahlart` (`bar`/`karte`/`karte-gutschrift`/`ohne-terminal`) und `beleg` (Terminal-Belegnummer).
- **Abend-Preise** = Einzelticket + 2,00 € (Kat. 1 18/16, Kat. 2 14/10,50, Kat. 3 12,50/10/7, Fanblock 12,50/10, Rollstuhl 10); maßgeblich im Knoten „Abendkasse: Sitze zuordnen" (`PRICES`), Anzeige in `abendkasse.html`.
- **Test-Bestellungen** der Abendkasse erkennt man an den „- Abend"-Items (48–58); Storno über `POST …/orders/<code>/mark_canceled/` mit `{"send_email": false}`.

## Trainer-/Übungsleiter-Dauerkarten für Partnervereine (05.10.2026)

Kostenlose Dauerkarte (Stehplatz, ohne Sitzplatz) für Trainer und Übungsleiter der Partnervereine. Erster Fall: Michael Gleichmann (BC Erfurt), Bestellung CXS3V.

**pretix:** Neues Produkt **Item 91 "Stehplatz - Dauer"** (kein Sitzplatz, Preis 0,00 €, `require_voucher` und `hide_without_voucher`, damit es im pretix-Shop nicht kaufbar ist). 14 Kontingente "HSnn: Trainer-Dauerkarte" (IDs 334–347, je 50 Plätze, getrennt vom Stehplatz-Verkauf an der Kasse; die Namen passen nicht auf das Dashboard-Muster der Kategorie-Kontingente, die Dashboard-Kapazität bleibt also unverändert). Ticket-Layout 10 ist dem Produkt zugeordnet (nur in der Oberfläche möglich). Der Name endet auf "- Dauer", deshalb zählt das Dashboard es automatisch bei den Dauerkarten (Zeile "Stehplatz - Dauer"). Die Check-in-Liste "Einlass - alle Heimspiele" gilt für alle Produkte.

**Ausstellen:** n8n-Workflow `x5VZtGVpSGlbHL4M` "Ticketing: Trainer-Dauerkarte ausstellen". Webhook `POST https://ticketing.basketball-loewen.com/webhook/trainer-dauerkarte-<Geheimteil>` mit `{"name","email","verein"}` und optional `"funktion"` (z. B. "Trainer Landesliga Herren III"). Der Geheimteil steht nur im Webhook-Pfad des Workflows (im n8n-Knoten "Trainer-Dauerkarte ausstellen" nachsehen) und wird nicht weitergegeben. Ablauf: Eingabe prüfen, Doppelprüfung (gibt es für die E-Mail schon eine Trainer-Dauerkarte, Abbruch), Gutschein anlegen (Code `UL-DK-XXXXXX` analog zu `EA-DK-` bei Ehrenamt, `max_usages` 14, 100 %, an Item 91 gebunden, Tag `uebungsleiter_dauerkarte` analog zu `ehrenamts_dauerkarte`, Kommentar im EA-Muster "Fuer: Name <E-Mail> -- Produkt(e): … -- Spiel(e): … -- Verein: … (Funktion)"), Bestellung mit 14 Positionen (je Heimspiel, 0,00 €, Gutschein an jeder Position) als bezahlt anlegen, Ticket-Mail anstoßen. Antwort: Bestellnummer und Gutschein-Code. Fehler gehen in den Fehler-Alarm.

**Ticket-Mail** (`zNGWzRFz3ebzsDkD`): Eine Dauerkarte ohne Sitz erzeugt ein Ticket je Bestellung (vorher hätte jede der 14 Positionen ein eigenes PDF bekommen). Für Item 91 gibt es einen eigenen Text im Du ("Wir laden dich als Trainer/Übungsleiter eines unserer Partnervereine ein.", Platzhinweis seit 05.10.2026 abends: "Freie Platzwahl in der Kategorie in den Blöcken A, C, D und F."), Marko in BCC, Antworten an tickets@. Wallet-Pass wie bei den anderen Dauerkarten (das Passbook-Plugin `pretix_loewen_passbook_season` kennt Item 91 seit 05.10.2026, Commit `89fc9ea` in `pretix-docker`; der Pass zeigt "Dauerkarte Saison 2026/2027" und die ganze Saison). Anrede mit Vorname ("Hallo Michael,"), erster Satz "Wir laden dich als Trainer/Übungsleiter eines unserer Partnervereine ein."

**Test:** Testlauf mit Marko als Empfänger (Bestellung MBJB3, danach storniert, Gutschein AFB5DBWSU2, ID 254, abgelaufen gesetzt): Bestellung bezahlt, 14 Positionen, Gutschein 14 von 14 eingelöst, nach Storno 0, genau ein PDF in der Mail.

**Hinweise:** Kontingent 50 je Spiel. Die erste Mail an Michael Gleichmann ging noch ohne Wallet-Pass raus (Pass anfangs bewusst weggelassen, was nicht abgesprochen war); ab Daniel Ganzmann (Bestellung QTBGD, `UL-DK-77JGSB`) ist der Pass dabei.

**Benennung (05.10.2026, Marko):** Übungsleiter-Gutscheine heißen `UL-DK-…` mit Tag `uebungsleiter_dauerkarte`, wie bei Ehrenamt `EA-DK-…` und `ehrenamts_dauerkarte`. Der Gutschein von Michael Gleichmann (ID 255) wurde nachträglich auf `UL-DK-3YKSQ7` und diesen Tag umgestellt (für den Empfänger nicht sichtbar). Der Test-Gutschein AFB5DBWSU2 (ID 254) ist abgelaufen gesetzt und behält den alten Tag "Trainer Partnervereine".

**Bestellcode auf dem Ticket (05.10.2026):** Die Einzelticket-Vorlage (Layout 9) trägt unten rechts den Bestellcode in Grau (Textfeld `{order}`, Open Sans 8 pt, x 155,4, y 185,0, rechtsbündig, Farbe 80/80/80). In der Dauerkarten-Vorlage (Layout 10) fehlte er, weil die Änderung nur an Layout 9 gemacht wurde. Am 05.10. dasselbe Element per API (`PATCH …/ticketlayouts/10/` mit dem um das Element ergänzten `layout`) in Layout 10 übernommen. Hinweis: Bereits erzeugte (gecachte) Dauerkarten-PDFs zeigen den Code erst nach erneuter Erzeugung (Bestellungsänderung ohne Mail), z. B. das Ticket von Michael Gleichmann (CXS3V). Layout-Änderungen immer in beiden Vorlagen (9 Einzelticket, 10 Dauerkarte) prüfen.

## Ticket-Mail "Item 46" bei freien Dauerkarten (05.10.2026)

**Fehler:** Bei freien (0 €) Dauerkarten-Bestellungen kam die Ticket-Mail mit "Freie Platzwahl in deinem gewählten Block: 1× Item 46", ohne Namen in der Anrede und mit nur EINEM Ticket-PDF, auch wenn die Bestellung zwei Plätze hatte. Betroffen am 05.10.: DCMYE, R3DVV, ELYWV (Kim), 3JYEV (Aaron, 2 Plätze), WPFXB (Samuel Nellessen, 2 Plätze), 7ELWT (Luca Förster, 2 Plätze).

**Ursache:** Eine freie Bestellung ist in pretix schon bei der Anlage "bezahlt". pretix' eigenes `order.paid`-Event kam deshalb, als erst die erste Position existierte (die übrigen Spiele werden vom Dauerkarten-Workflow nachgetragen). Der Ticket-Mail-Workflow las eine Bestellung mit einer Position, erkannte sie nicht als Dauerkarte (`isSeasonTicket` braucht mehrere Spiele) und sendete sofort; der spätere Auslöser des Dauerkarten-Workflows wurde durch den Marker "bereits versendet" abgewiesen. Item 46 ist "Block CS (K2) - Dauer", für das es in der Einzelticket-Label-Tabelle keinen Eintrag gibt.

**Behebung:**
- `zNGWzRFz3ebzsDkD`, Knoten "Marker pruefen": Bei einer Bestellung mit Dauerkarten-Produkt (Items 37–39, 41–47, 91), jünger als 2 Minuten, wird ein Ereignis ohne `source: "direct"` übersprungen (Grund `dauerkarte-wartet-auf-direktaufruf`). Die Mail löst der Direktaufruf des Dauerkarten-Workflows aus, wenn alle Positionen da sind. Ältere Bestellungen (z. B. später bezahlte Lastschrift-Dauerkarten) laufen unverändert.
- `HyUXW4kbhaQVbG0A`, Knoten "DK: Ticket-Mail ausloesen (sofort bezahlt)": sendet jetzt `source: "direct"`.
- "Anhänge zusammenführen": Die Alarm-Mail "Ticket-Mail unvollstaendig" nennt für die erneute Auslösung jetzt `"source":"direct"` dazu. **Manuelles Neu-Senden für Dauerkarten-Bestellungen immer mit `source: "direct"`**, sonst wird es bei frischen Bestellungen übersprungen.
- Abend-Produkte (Items 48–58) haben jetzt Einträge in der Label-Tabelle, damit in den Archiv-Mails nicht "Item NN" steht.

## PayPal-Abgleich 05.10.2026

Marko vermutete fehlende PayPal-Zahlungen. Ergebnis: Kein Fehler im Ticketing. Der PayPal-Export reicht nur bis 30.09. 14:35 Uhr. Alle 11 Zahlungen darin passen zu einer Referenz (ET-…) und zum Betrag der Tabelle "PayPal-Zahlungen" (zwei davon am 27.08. erstattete Tests). Danach gab es nur zwei bezahlte Webshop-Bestellungen: DUTTK (62,00 €, ET-0CID60, PayPal-Capture 3A199315UR0498217, 01.10.) und CPMCL (32,00 €, ET-X3W8LX, Capture 6XY985688U3740713, 03.10.); beide "COMPLETED" laut PayPal-API. Alle anderen Bestellungen vom 05.10. sind Freikarten (0 €) oder Abendkasse-Tests. Die Ticket-Mail für freie Bestellungen sagte trotzdem "vielen Dank für deine Zahlung" (Beispiel: ESZSK, Gina Sieber, 2 × Block A, 0 € per Gutschein); seit 05.10.2026 abends sagt sie bei Bestellungen mit 0 € "vielen Dank für deine Bestellung." (Feld `isFree` aus `order.total`). Fünf pretix-Bestellungen mit Betrag, aber ohne PayPal-Zahlung (3DRQM, SRJLX, HYN7P, PJ3ZW, RACLS, zusammen 304,50 €): Klärung siehe Abschnitt "Fünf Bestellungen ohne PayPal-Zahlung" unten (Freikarten mit falschem pretix-Preis, nichts offen).

**Gotcha n8n-MCP:** `versionName` bei `update_workflow` maximal 80 Zeichen, längere Namen lassen die Änderung still scheitern (keine Fehlermeldung, Version bleibt gleich). Immer zurücklesen.

## Bestätigungsmails: Gutschein und Freikarten Dauerkarte und Einzelticket angeglichen (05.10.2026)

Vergleich: Die Dauerkarten-Bestätigung ("Deine Dauerkarten-Bestellung ist eingegangen", `HyUXW4kbhaQVbG0A`) listet "Deine Auswahl" mit allen Positionen inklusive der Gutscheinzeile (z. B. "Gutschein: 100 % (Kat. 2): -156,00 €") und den Gesamtbetrag, bei 0 € mit eigenem Hinweistext. Die Einzelticket-Bestätigung ("Deine Ticket-Bestellung ist bestätigt", `BmpBkKdzzSZaBnZE`, Knoten "E-Mail: Ticket bestaetigt") nannte nur Spiel und Bestellnummer und sagte immer "vielen Dank für deine Zahlung", auch bei Freikarten. Die Gutscheinzeilen standen aber schon in den gespeicherten Warenkorb-Zeilen (Tabelle "PayPal-Zahlungen", Feld `cartJson`, Zeilen "Gutschein: …").

Jetzt hat die Einzelticket-Bestätigung dasselbe Muster wie die Dauerkarte: "Deine Auswahl:" mit allen Zeilen einschließlich Gutscheinabzug, "Gesamtbetrag". Der erste Satz hängt vom Betrag ab: bei Betrag über 0 "vielen Dank für deine Zahlung! … ist jetzt bestätigt.", bei 0 € "vielen Dank für deine Ticket-Bestellung … Sie ist jetzt bestätigt, es ist keine Zahlung nötig." Die Ticket-Mail (Workflow `zNGWzRFz3ebzsDkD`) sagt bei 0 € "vielen Dank für deine Bestellung." Die Website-Bestellbestätigung (`tickets/confirmation.html`) zeigte Gutscheinzeilen schon für beide Wege.

## Fünf Bestellungen ohne PayPal-Zahlung: Freikarten mit falschem pretix-Preis (05.10.2026)

Alle fünf sind **kostenlose Bestellungen mit dem Gutschein `CATL-BBQ-BGTJDE` (100 %)**, im Webshop über den Gratis-Zweig ("Ist kostenlos (Gutschein)?") angelegt, Warenkorb-Betrag 0 € (Tabelle "PayPal-Zahlungen": Status bezahlt, kein PayPal-Eintrag). Niemand schuldet etwas. In pretix standen sie mit vollem Preis und Zahlung "manual" über den vollen Betrag, weil der Preis damals nicht um den Gutschein gekürzt wurde (Fehler in "Sitze zuordnen", seit Ende September behoben; neue Gratis-Bestellungen haben 0,00 € in pretix).

| Bestellung | Datum (CEST) | Name | Position | pretix-Betrag |
|---|---|---|---|---|
| 3DRQM (ET-GCSLZD) | 28.09. 12:50 | Nick Kirschnitzki | 1 × Block A | 10,50 € |
| SRJLX (ET-6NTBJM) | 28.09. 13:25 | Yumin Teng | 2 × Block D | 24,00 € |
| HYN7P (ET-NYLOUH) | 29.09. 15:50 | Oussama Chaibi | 1 × Block B VIP | 119,00 € |
| PJ3ZW (ET-4JOAJO) | 29.09. 15:54 | Maissa Bahri (gleiche E-Mail wie Chaibi) | 1 × Block B VIP | 119,00 € |
| RACLS (ET-0S4LO4) | 29.09. 16:06 | Haifei Zhang | 2 × Block B | 32,00 € |

Folge: Der Erlös im Dashboard (und in pretix) war um 304,50 € zu hoch. **Gutschein-Fund:** `CATL-BBQ-BGTJDE` (ID 198, 100 Nutzungen, 34 eingelöst, gültig bis 13.10.2026, Tag `catl-BBQ-freikarten-HS1`) ist laut Kommentar nur für Block A, C, D, F (Ludwigsburg) gedacht, technisch aber nicht an Produkte gebunden (`item` leer) und wurde auch für Block B, Block E und VIP eingelöst (u. a. die beiden VIP-Bestellungen über je 119 €).

**Sicherheitsnetz (neu):** Im Einzelticket-Workflow `BmpBkKdzzSZaBnZE` prüfen die Knoten "Betrag pruefen (pretix = Warenkorb)" → "Betrag passt?" → "Alarm: Betrag weicht ab" nach dem Anlegen der pretix-Bestellung, ob der pretix-Betrag dem serverseitig berechneten Warenkorb entspricht (Toleranz 0,01 €); sonst Alarm-Mail an Marko, der Ablauf läuft weiter. Grundsätzlich entsteht im Bezahlweg die pretix-Bestellung und damit Ticket und Mail erst nach erfolgreicher PayPal-Erfassung ("Zahlung bestaetigt?"), im Gratisweg nur bei Warenkorb-Betrag 0 €.
