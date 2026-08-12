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
