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

## Merksatz für künftige pretix-Event-Migrationen

**Nach jedem Anlegen/Löschen/Umbenennen eines pretix-Events den Webhook-Scope prüfen:**

```
GET https://pretix-production-4263.up.railway.app/api/v1/organizers/xxl/webhooks/
```

`limit_events` muss den/die aktuell aktiven Event-Slug(s) enthalten (aktuell:
`saison2627`). Das gilt zusätzlich zu den bereits bekannten Stolperfallen bei
Event-Migrationen (hartcodierte Item-/Kontingent-/Quota-IDs in n8n-Workflows), die
jeweils separat geprüft werden müssen, wenn Kontingente/Sitzpläne neu aufgesetzt werden.
