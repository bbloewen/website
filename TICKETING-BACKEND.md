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
