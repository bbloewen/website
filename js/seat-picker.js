/* Wiederverwendbare Sitzplatzwahl für Einzelticket- und Dauerkarten-Detailseite.
   Lädt den echten, pretix-schema-konformen Saalplan aus assets/seating/ und rendert
   ihn als Block-Grid. Belegung wird live per n8n-Proxy gegen die echte pretix-API
   geprüft (s. seatStatusUrl). Kein Limit an wählbaren Plätzen pro Bestellung.

   Zwei Modi:
   - "seats" (Dauerkarte): einzelne Sitze sind klickbar, fester Platz für die Saison.
   - "blocks" (Einzelticket): nur der Block ist wählbar (Anzahl je Tarif), die Sitze
     im Block sind rein dekorativ (First-Come-First-Serve-Platzwahl vor Ort). */
(function () {
  'use strict';

  /* Der Belegungsstatus wird nur einmal beim Laden der Seite geholt (s. _load) und nie
     erneut nachgefragt. Kommt ein Nutzer nach abgeschlossenem Checkout per Zurück-Button
     auf diese Seite zurück, liefert der Browser sie oft aus dem bfcache aus — mit exakt
     dem eingefrorenen (jetzt veralteten) Belegungsstand von vor der Bestellung. Sichtbar
     wurde das, als zwei Käuferinnen ihre gerade gekauften Plätze weiterhin als frei sahen.
     event.persisted erkennt genau diesen bfcache-Fall; ein Reload holt den echten Stand. */
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) window.location.reload();
  });

  function fmtEUR(n) { return n.toFixed(2).replace('.', ','); }

  /* Geldbeträge auf Cent runden. Fließkomma-Addition liefert sonst Werte wie
     853.4999999999999, die als solche weitergereicht und gespeichert werden. */
  function roundCents(n) { return Math.round(n * 100) / 100; }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Liest eine CSS-Variable aus :root (s. seat-picker.css) statt Farbwerte hier ein
     zweites Mal fest zu codieren — fallback nur als Sicherheitsnetz, falls die
     Variable einmal fehlt (z.B. CSS-Datei noch nicht geladen). */
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : fallback;
  }

  /* Kategorie-Metadaten an einer Stelle statt vier separaten if/else-Ketten für
     dieselben drei Kategorien. Farb-/Randwerte kommen per CSS-Variable aus
     seat-picker.css (s. dort :root) — JS färbt damit zusätzlich die Block-Mini-
     Kacheln der mobilen Übersicht per Gradient ein (mehrere Kategorien in einer
     einzigen Kachel, keine CSS-Klasse möglich). Fehlt ein Eintrag (z.B. eine
     unbekannte Kategorie), liefern die Wrapper unten dieselben Fallbacks wie zuvor
     die eigenständigen Funktionen. */
  var CATEGORY_META = {
    'Kategorie I': { cls: 'cat-kat1', color: cssVar('--seatplan-cat-kat1', 'rgba(232,119,34,.55)'), borderColor: cssVar('--seatplan-cat-kat1-border', 'rgba(232,119,34,.9)'), shortLabel: 'Kat. I' },
    'Kategorie II': { cls: 'cat-kat2', color: cssVar('--seatplan-cat-kat2', '#D9DEE3'), borderColor: cssVar('--seatplan-cat-kat2-border', '#B9C1C8'), shortLabel: 'Kat. II' },
    'Kategorie III': { cls: 'cat-kat3', color: cssVar('--seatplan-cat-kat3', 'rgba(42,157,143,.55)'), borderColor: cssVar('--seatplan-cat-kat3-border', 'rgba(42,157,143,.9)'), shortLabel: 'Kat. III' },
    'Fanblock': { cls: 'cat-fanblock', color: cssVar('--seatplan-cat-fanblock', 'rgba(244,163,0,.55)'), borderColor: cssVar('--seatplan-cat-fanblock-border', 'rgba(244,163,0,.9)') },
    // C unten: eigenes Produkt/Kontingent seit 09.08.2026, aber Preis bleibt Kategorie II
    // (12,00 €/8,50 €) — Marko hat den anfangs erwogenen VIP-Preis wieder verworfen
    // ("Block C unten ist kein VIP-Bereich, sondern Kategorie 2"). Nur Block B unten ist
    // VIP. Optik bleibt daher wie Kategorie II. shortLabel = Anzeigename auf der Website
    // (Marko, 09.08.2026: nicht mehr "C unten" zeigen) — der interne Schlüssel "C unten"
    // bleibt unverändert (Preise/pretixItemCategoryMap referenzieren ihn weiter so).
    'C unten': { cls: 'cat-kat2', color: cssVar('--seatplan-cat-kat2', '#D9DEE3'), borderColor: cssVar('--seatplan-cat-kat2-border', '#B9C1C8'), shortLabel: 'C (courtside) Kat. II' },
    'VIP': { cls: 'cat-vip', color: cssVar('--seatplan-cat-vip', 'rgba(179,57,44,.55)'), borderColor: cssVar('--seatplan-cat-vip-border', 'rgba(179,57,44,.9)') }
  };
  function catMeta(category) { return CATEGORY_META[category] || {}; }
  function catClass(category) { return catMeta(category).cls || ''; }
  function catColor(category) { return catMeta(category).color || '#D9DEE3'; }
  function catBorderColor(category) { return catMeta(category).borderColor || '#B9C1C8'; }
  function catShortLabel(category) { return catMeta(category).shortLabel || category; }

  /* Zerlegt einen Kachel-/Vormerk-Schlüssel ("A::Fanblock" oder schlicht "A") in Zone
     und Kategorie — Blöcke mit nur einem kaufbaren Bereich (D/E/F) haben keinen "::"
     Teil, category ist dann null. Gemeinsame Stelle für alle Schlüssel-Parser (vorher
     mehrfach dieselbe indexOf('::')-Logik an verschiedenen Stellen, s. History). */
  function splitZoneKey(key) {
    if (!key) return { zoneId: null, category: null };
    var sep = key.indexOf('::');
    return sep === -1 ? { zoneId: key, category: null } : { zoneId: key.slice(0, sep), category: key.slice(sep + 2) };
  }

  /* An welcher Kante die Reihen eines Blocks ausgerichtet sind. Steht als align_edge
     in den Zonendaten, weil es pro Blockseite unterschiedlich ist: A/B/F richten sich
     an der rechten Kante aus ("trailing"), C/D/E an der linken ("leading"). Fällt die
     Angabe weg, gilt die alte Regel (nur die gespiegelten Blöcke C/F linksbündig). */
  function isLeadingEdge(zone) {
    if (zone && zone.align_edge) return zone.align_edge === 'leading';
    return !!(zone && (zone.zone_id === 'C' || zone.zone_id === 'F'));
  }

  /* Gutschein-/Wertgutschein-Codes werden serverseitig geprüft (n8n-Proxy vor
     der echten pretix-API — Voucher- und Gift-Card-Endpunkte sind nicht ohne
     API-Token erreichbar). Webhook-URL ohne Workflow-ID im Pfad, s. Hinweis in
     tickets/dauerkarte.html. */
  var VOUCHER_CHECK_URL = 'https://poetic-patience-production-9290.up.railway.app/webhook/gutschein-pruefen';

  /* Mitgliedsrabatt (30 % Löwen e.V.) braucht pro Sitzplatz eine Namensprüfung gegen
     die aktiven Mitglieder — sonst könnte ein Käufer den Rabatt für beliebig viele
     fremde Plätze mitnehmen (nur weil er selbst Mitglied ist). Die Prüfung ist final:
     bei Treffer wird der Rabatt für diesen Namen+diese Saison serverseitig gesperrt,
     ein zweiter Versuch mit demselben Namen schlägt danach bewusst fehl. */
  var MITGLIEDSRABATT_PRUEFEN_URL = 'https://poetic-patience-production-9290.up.railway.app/webhook/mitgliedsrabatt-pruefen';
  var MITGLIEDSRABATT_SAISON = '2026/2027';

  /* Dauerkarte-Tarife inkl. Mitgliedsrabatt — nur relevant, wenn opts.dauerkarteDiscount
     gesetzt ist (Einzelticket bleibt unberührt, dort bleibt es bei normal/ermaessigt). */
  var DK_TARIF_LABELS = {
    normal: 'Normalpreis',
    ermaessigt: 'Ermäßigt',
    kind: 'Kinder 7–14',
    normal_member: 'Normalpreis mit Mitgliedsrabatt (Löwen e.V.)',
    ermaessigt_member: 'Ermäßigt mit Mitgliedsrabatt (Löwen e.V.)',
    kind_member: 'Kinder 7–14 mit Mitgliedsrabatt (Löwen e.V.)',
    // Begleitperson eines Rollstuhlplatzes (Marko, 13.08.2026: Buchung freiwillig, aber
    // kostenlos) — pro gebuchtem Rollstuhlplatz genau ein Sitz im selben Block wählbar,
    // s. _companionSlotAvailable. Serverseitig ebenfalls auf 0 € gesetzt (n8n-Workflow
    // "Ticketing: Bestellprozess - Dauerkartenbestellung verarbeiten", Node "Preis
    // serverseitig berechnen") — dort zusätzlich auf max. 1 pro Rollstuhlplatz begrenzt,
    // sonst könnte ein manipulierter Request beliebig viele Gratis-Sitze erzeugen.
    begleitung: 'Begleitperson (kostenlos)'
  };

  /* Tarife im Modus "blocks" (Einzelticket) — "kind" bisher nur für Kategorie III
     (Preis kommt aus priceInfo.kind, s. opts.prices), aber generisch benannt: jede
     Kategorie mit einem "kind"-Preis bekommt automatisch diese dritte Tarifzeile,
     ohne dass der Code nach Kategorie-Namen unterscheiden müsste. */
  var BLOCK_TARIF_LABELS = {
    normal: 'Normalpreis', ermaessigt: 'Ermäßigt', kind: 'Kinder 7–14',
    // Begleitperson eines Rollstuhlplatzes (Marko, 13.08.2026: "auch bei
    // Einzelticketbuchungen so umsetzen") — s. DK_TARIF_LABELS.begleitung fuer die
    // Begruendung. Rollstuhlplatz ist in diesem Modus block-unabhaengig (pseudo-Zone
    // 'ROLLSTUHL'), deshalb ist die Begleitperson hier NICHT an denselben physischen
    // Block gebunden wie in "seats"-Modus, sondern an die Gesamtzahl gebuchter
    // Rollstuhlplaetze im ganzen Warenkorb, s. _companionSlotsRemaining.
    begleitung: 'Begleitperson (kostenlos)'
  };

  /* "Begleitperson" hat pauschal 0 EUR, unabhaengig davon, was priceInfo fuer die
     jeweilige Kategorie sonst hergibt (priceInfo kennt diesen Tarif gar nicht) —
     zentrale Stelle statt an jeder priceInfo[tarif]-Lesestelle einzeln abzufangen. */
  function blockTarifPrice(priceInfo, tarif) {
    return tarif === 'begleitung' ? 0 : priceInfo[tarif];
  }

  function SeatPicker(root, opts) {
    this.root = root;
    this.mode = opts.mode || 'seats';
    this.planUrl = opts.planUrl;
    this.seatStatusUrl = opts.seatStatusUrl || null; // n8n-Proxy: liefert {takenSeatGuids:[...]}, nur Modus "seats" relevant
    this.prices = opts.prices; // { "Kategorie I": {normal: 19, ermaessigt: 12}, "Kategorie II": {...} }
    this.northZones = opts.northZones; // z.B. ["D", "E", "F"]
    this.southZones = opts.southZones; // z.B. ["A", "B", "C"]
    this.excludeCategories = opts.excludeCategories || []; // z.B. ["VIP"] — Reihen dieser Kategorie werden gar nicht angezeigt (kein Produkt dafür)
    // Fuer die Insgesamt-Auslastungszahl zaehlt die tatsaechliche Hallenkapazitaet,
    // auch wenn eine Kategorie hier nicht einzeln kaufbar ist (excludeCategories) —
    // daher ein eigener, standardmaessig leerer Ausschluss statt excludeCategories.
    this.occupancyExcludeCategories = opts.occupancyExcludeCategories || [];
    this.cartEl = opts.cartEl;
    this.totalEl = opts.totalEl;
    this.ctaEl = opts.ctaEl;
    // Modus "seats": Block-Detailansicht (alle Sitze eines Blocks) öffnet groß in einem
    // separaten Overlay statt im kompakten Inline-Bereich, damit auch breite Blöcke
    // (bis zu 28 Sitze/Reihe) ohne Scrollen komplett sichtbar sind. Optional — ohne
    // diese Optionen rendert die Detailansicht wie zuvor inline in `root`.
    this.detailBackdropEl = opts.detailBackdropEl || null;
    this.detailRootEl = opts.detailRootEl || null;
    // Optional: Auslastungs-Kachel („noch X von Y frei" je Block) und eine Hinweiszeile
    // für den Fall, dass ein gewählter Platz durch die nachgeladene Belegung wegfällt.
    this.occupancyEl = opts.occupancyEl || null;
    this.statusNoteEl = opts.statusNoteEl || null;
    this.onContinue = opts.onContinue || function () {};
    this.mobileZoneId = null; // Modus "seats": null = Block-Übersicht, sonst gewählter Block (Sitzdetail offen)
    this.mobileCategory = null; // bei Blöcken mit mehreren kaufbaren Kategorien (z.B. Block A: Fanblock/Kategorie III): welche davon gerade offen ist — null bei Blöcken mit genau einer Kategorie
    this.pendingBlockId = null; // Modus "blocks": per Tippen in der Übersicht markierter, noch nicht übernommener Block
    this.nachwuchsBeitrag = !!opts.nachwuchsBeitrag; // Pauschale pro Bestellung, standardmäßig an, unabhängig von Anzahl Plätze/Tickets
    this.nachwuchsAmount = opts.nachwuchsAmount || 2;
    this.nachwuchsChecked = true;
    this.selected = {}; // seat_guid -> {...} (Modus "seats")
    /* Vorgemerkte Plätze, solange die Sitzdetailansicht offen ist: beim Öffnen eine
       Kopie von `selected`, beim Antippen wird nur hier getoggelt. Erst „Übernehmen"
       schreibt sie in `selected` (und damit in den Warenkorb), „Abbrechen" verwirft
       sie. null = Detailansicht zu, dann ist `selected` die aktive Auswahl. */
    this.pendingSeats = null;
    this.blockCounts = {}; // zone_id -> { normal: n, ermaessigt: n } (Modus "blocks")
    // Stehplatz (s. #222): laeuft ueber genau dieselbe blockCounts/_quickAddBlock/
    // _blockFreeCount-Maschinerie wie ein echter Block — Pseudo-Zone-ID "STEHPLATZ",
    // Kategorie "Stehplatz", kein Ermaessigt-Tarif. Kein eigener Warenkorb-Mechanismus,
    // "es integriert sich hundertprozentig in den Bestellworkflow" (Marko). Menge liegt
    // in blockCounts.STEHPLATZ.normal, nicht in einem separaten Feld.
    this.standingPrice = opts.standingPrice || 0;
    this.standingAvailable = null;
    // Nicht buchbar kann pro Spiel gesetzt werden (Website-seitig, pretix bleibt aktiv) —
    // dann: Preisliste durchgestrichen, Grafik nicht anklickbar, Dropdown ohne Option.
    this.standingBookable = opts.standingBookable !== false;
    this.pretixEvent = opts.pretixEvent || null; // Event-Slug fuer die Gutschein-Pruefung (z.B. "saison2627")
    // pretix-Item-ID -> unsere Kategorie-Bezeichnung, z.B. {9:"VIP",7:"Kategorie I",8:"Kategorie II"} —
    // nur so kann ein an ein bestimmtes Produkt gebundener Gutschein (require item) der richtigen
    // Warenkorb-Kategorie zugeordnet werden. Ohne Eintrag/Treffer gilt der Gutschein als Pauschalrabatt
    // auf den gesamten Warenkorb (Verhalten wie zuvor, entspricht pretix "Beliebiges Produkt").
    this.pretixItemCategoryMap = opts.pretixItemCategoryMap || {};
    this.voucherCode = null;
    this.voucherInfo = null; // { source:'voucher'|'giftcard', code, label, priceMode, value, category, remainingUses, balance }
    this.voucherError = null;
    this.voucherChecking = false;
    this.notiz = '';
    /* Dauerkarte: Frühbucher (automatisch, für alle) + Mitglieder des Basketball
       Löwen e.V. (30 %, Nachweis nötig, als eigene Tarif-Option wählbar).
       Kombinierbar bis zum Frühbucher-Stichtag ("zusammen 50 %"), danach nur noch
       der Mitgliedsrabatt. Nicht zu verwechseln mit dem ermäßigten Satz, den u. a.
       Mitglieder der Kooperationsvereine bekommen — das ist eine Preisstufe, kein
       Rabatt, und gilt nur bei der Dauerkarte, nicht beim Einzelticket. */
    this.dkDiscount = opts.dauerkarteDiscount || null;
    // Für Ehrenamtliche reservierte Plätze (z.B. Block A, Reihe 1-3) — physisch belegt
    // unabhängig vom Ticket-Typ (Dauerkarte + Einzelticket), daher über Zone+Reihe
    // statt einzelner Sitz-GUIDs angegeben; s. _computeReservedSeatGuids.
    this.reservedSeats = opts.reservedSeats || [];
    // "Nicht verfügbar" (NV) — z.B. Block A Reihe 1-3 Sitz 1-7: Plätze, die der Verein
    // später separat vergeben will, anders als .reservedSeats (für Ehrenamtliche). Gleiche
    // Zone+Reihen-Angaben-Syntax, s. _computeSeatGuidsForRanges.
    this.nvSeats = opts.nvSeats || [];
    this._load();
  }

  /* Löst eine Liste von Zone+Reihen-Angaben (this.reservedSeats ODER this.nvSeats)
     gegen den geladenen Saalplan auf. Über Zone/Reihe statt fester Sitz-GUIDs, damit die
     Regel eine geänderte Sitzplan-Datei übersteht und an einer Stelle lesbar bleibt. */
  SeatPicker.prototype._computeSeatGuidsForRanges = function (ranges, plan) {
    var guids = new Set();
    if (!ranges.length || !plan) return guids;
    plan.zones.forEach(function (zone) {
      ranges.forEach(function (range) {
        if (range.zone !== zone.zone_id) return;
        zone.rows.forEach(function (row) {
          if (range.rows.indexOf(row.row_number) === -1) return;
          row.seats.forEach(function (seat) {
            // maxSeatNumber: nur ein Teil der Reihe erfassen (z.B. Reihe 3, Platz 1-7).
            if (range.maxSeatNumber && parseInt(seat.seat_number, 10) > range.maxSeatNumber) return;
            // excludeSeatNumbers: einzelne Plätze innerhalb der Reihe ausnehmen
            // (z.B. Reihe 2, Platz 15-17 wieder freigeben).
            if (range.excludeSeatNumbers && range.excludeSeatNumbers.indexOf(seat.seat_number) !== -1) return;
            guids.add(seat.seat_guid);
          });
        });
      });
    });
    return guids;
  };

  /* Für Zählung/Sperrung zählen ein für Ehrenamtliche reservierter, ein "nicht
     verfügbarer" und ein verkaufter Platz alle gleich — alles ist "nicht verfügbar".
     Nur bei der Beschriftung (s. _renderZone) wird unterschieden: ein BEREITS
     verkaufter Platz zeigt weiterhin "vergeben", nicht "EA"/"NV" — die Reservierung
     gilt nur für noch freie Plätze. */
  SeatPicker.prototype._isBlocked = function (seatGuid) {
    return !!((this.takenSeatGuids && this.takenSeatGuids.has(seatGuid)) ||
      (this.reservedSeatGuids && this.reservedSeatGuids.has(seatGuid)) ||
      (this.nvSeatGuids && this.nvSeatGuids.has(seatGuid)));
  };

  /* Einheiten (Sitze bzw. Block-Tarifzeilen) der Kategorie(n)/des Tarifs, an die ein
     Gutschein gebunden ist (this.voucherInfo.categories/.tarifRestriction) — Grundlage,
     um einen produkt-/kategoriegebundenen Gutschein (z.B. "nur Kategorie 2+3,
     Ermäßigt") NICHT auf den ganzen Warenkorb, sondern nur auf passende Zeilen
     anzuwenden. Frisch aus this.selected/this.blockCounts gebaut, damit sie immer den
     aktuellen Warenkorb-Stand widerspiegeln. */
  SeatPicker.prototype._voucherMatchingUnits = function () {
    var self = this;
    var info = this.voucherInfo;
    var categories = info && info.categories;
    var tarifRestriction = info && info.tarifRestriction;
    var units = []; // { qty, unitPrice }
    if (!categories || !categories.length) return units;
    function tarifOk(t) { return !tarifRestriction || baseTarif(t) === tarifRestriction; }
    if (this.mode === 'blocks') {
      Object.keys(this.blockCounts).forEach(function (key) {
        var c = self.blockCounts[key];
        if (categories.indexOf(c.category) === -1) return;
        if (c.normal && tarifOk('normal')) units.push({ qty: c.normal, unitPrice: c.priceInfo.normal });
        if (c.ermaessigt && tarifOk('ermaessigt')) units.push({ qty: c.ermaessigt, unitPrice: c.priceInfo.ermaessigt });
      });
    } else {
      Object.keys(this.selected).forEach(function (guid) {
        var s = self.selected[guid];
        if (categories.indexOf(s.category) === -1) return;
        if (!tarifOk(s.tarif)) return;
        units.push({ qty: 1, unitPrice: s.price });
      });
    }
    return units;
  };

  /* Rabatt für einen gegebenen Zwischensumme-Betrag (Tickets + Nachwuchsbeitrag),
     gemeinsam für "seats"- und "blocks"-Modus sowie für getSummary(). Ein
     Wertgutschein zieht sein Guthaben pauschal vom Gesamtbetrag ab; ein Gutschein
     ohne Produktbindung wirkt ebenfalls pauschal (wie zuvor); ein produktgebundener
     Gutschein (voucherInfo.categories) wirkt nur auf die dazu passenden Zeilen, je
     Einheit einmal, begrenzt auf die verbleibenden Einlösungen (remainingUses). */
  SeatPicker.prototype._voucherDiscount = function (base) {
    var info = this.voucherInfo;
    if (!info || base <= 0) return 0;
    if (info.source === 'giftcard') return Math.min(info.balance, base);
    if (info.categories && info.categories.length) {
      var remaining = (info.remainingUses == null) ? Infinity : info.remainingUses;
      var discount = 0;
      this._voucherMatchingUnits().forEach(function (u) {
        if (remaining <= 0) return;
        var applyQty = Math.min(u.qty, remaining);
        if (applyQty <= 0) return;
        var perUnit = info.priceMode === 'percent' ? (u.unitPrice * info.value / 100)
          : info.priceMode === 'subtract' ? Math.min(info.value, u.unitPrice)
          : info.priceMode === 'set' ? Math.max(0, u.unitPrice - info.value)
          : 0;
        discount += perUnit * applyQty;
        remaining -= applyQty;
      });
      return Math.min(Math.round(discount * 100) / 100, base);
    }
    var d = info.priceMode === 'percent' ? (base * info.value / 100) : info.value;
    return Math.min(Math.round(d * 100) / 100, base);
  };

  /* Ein 100%-Gutschein (z.B. Sponsoren-Freikarte) übernimmt auch den sonst separat
     berechneten Nachwuchsbeitrag — bei einer vollständig kostenlosen Eintrittskarte
     soll kein Rest-Betrag stehen bleiben. Andere Gutscheine/Wertgutscheine lassen
     den Nachwuchsbeitrag unberührt (der bleibt ein freiwilliger Zusatzbetrag). */
  SeatPicker.prototype._voucherIsFullComp = function () {
    var info = this.voucherInfo;
    return !!(info && info.priceMode === 'percent' && info.value === 100);
  };

  /* Nachwuchsbeitrag-Betrag für den aktuellen Warenkorb: 0, wenn die Pauschale nicht
     greift (nicht aktiviert, abgewählt, Warenkorb leer, oder ein 100%-Gutschein
     übernimmt auch den Nachwuchsbeitrag, s. _voucherIsFullComp), sonst nachwuchsAmount.
     Eine Stelle statt derselben Bedingung an vier Stellen (_renderCart,
     _renderCartBlocks, getSummary zweimal) — sonst müsste eine künftige Änderung der
     Regel an jeder Stelle einzeln nachgezogen werden. */
  SeatPicker.prototype._nachwuchsAmountFor = function (hasItems) {
    if (!this.nachwuchsBeitrag || !this.nachwuchsChecked || !hasItems || this._voucherIsFullComp()) return 0;
    return this.nachwuchsAmount;
  };

  SeatPicker.prototype._earlyBirdActive = function () {
    if (!this.dkDiscount) return false;
    return new Date() <= new Date(this.dkDiscount.earlyBirdUntil + 'T23:59:59');
  };

  SeatPicker.prototype._dkPrice = function (basePrice, member) {
    if (!this.dkDiscount || basePrice === undefined) return basePrice;
    var pct = (member ? this.dkDiscount.memberPercent : 0) + (this._earlyBirdActive() ? this.dkDiscount.earlyBirdPercent : 0);
    return Math.round(basePrice * (1 - pct / 100) * 100) / 100;
  };

  SeatPicker.prototype._dkTarifPrice = function (priceInfo, tarif) {
    if (tarif === 'begleitung') return 0;
    var base = tarif.indexOf('kind') === 0 ? priceInfo.kind
      : tarif.indexOf('ermaessigt') === 0 ? priceInfo.ermaessigt
      : priceInfo.normal;
    return this._dkPrice(base, tarif.indexOf('_member') !== -1);
  };

  /* Wie viele Begleitperson-Plätze in diesem Block noch frei sind — genau einer pro
     dort gebuchtem Rollstuhlplatz (Marko, 13.08.2026). guid wird von der Zählung
     ausgenommen, damit ein Sitz, der selbst schon "begleitung" trägt, seine eigene
     Auswahl im tarifOptions-Dropdown nicht durch sich selbst blockiert. */
  SeatPicker.prototype._companionSlotAvailable = function (guid, zoneLabel) {
    var self = this;
    var wheelchairCount = 0, usedCount = 0;
    Object.keys(this.selected).forEach(function (g) {
      var s = self.selected[g];
      if (s.zoneLabel !== zoneLabel) return;
      if (s.category === 'Rollstuhlplatz') wheelchairCount++;
      else if (s.tarif === 'begleitung' && g !== guid) usedCount++;
    });
    return wheelchairCount > usedCount;
  };

  /* Rechnet die Rabattkette transparent vor, statt nur den fertigen Endpreis zu
     zeigen — jede Rabattzeile ("abzüglich 20 % Frühbucherrabatt", "abzüglich
     30 % Mitgliedsrabatt (Löwen e.V.)") bekommt eine eigene, fett gedruckte
     Zeile statt kommagetrennt in einem Satz zu verschwinden. Der Endpreis
     selbst steht separat rechts in der Zeile (s. _renderCart), nicht hier. */
  SeatPicker.prototype._dkBreakdownText = function (priceInfo, tarif) {
    if (tarif === 'begleitung') return DK_TARIF_LABELS.begleitung;
    var isKind = tarif.indexOf('kind') === 0;
    var isErmaessigt = !isKind && tarif.indexOf('ermaessigt') === 0;
    var base = isKind ? priceInfo.kind : isErmaessigt ? priceInfo.ermaessigt : priceInfo.normal;
    var label = isKind ? DK_TARIF_LABELS.kind : isErmaessigt ? 'Ermäßigt' : 'Normalpreis';
    var lines = [label + ' ' + fmtEUR(base) + ' € je Ticket'];
    if (this.dkDiscount) {
      if (this._earlyBirdActive()) lines.push('<strong>abzüglich ' + this.dkDiscount.earlyBirdPercent + ' % Frühbucherrabatt</strong>');
      if (tarif.indexOf('_member') !== -1) lines.push('<strong>abzüglich ' + this.dkDiscount.memberPercent + ' % Mitgliedsrabatt (Löwen e.V.)</strong>');
    }
    return lines.join('<br>');
  };

  /* Zwei unabhängige Quellen, bewusst NICHT mehr per Promise.all gekoppelt: der
     Saalplan liegt als statische JSON neben der Seite (~70 kB gzip, ~0,4 s), der
     Sitzstatus kommt über den n8n-Proxy und braucht gemessen 3–6 s (n8n-Cold-Start +
     pretix-API). Gemeinsam abgewartet blieb der Blockplan die ganze Zeit leer und die
     Seite wirkte kaputt. Jetzt wird der Plan sofort gezeichnet und die Belegung
     nachträglich eingespielt.

     Schlägt der Status-Abruf fehl (Netzwerk, n8n down o.ä.), degradiert das bewusst auf
     "keine Sitze als belegt bekannt" statt die ganze Sitzplatzwahl zu blockieren —
     besser ein optimistischer Anzeigefehler als ein kompletter Ausfall der Seite. */
  SeatPicker.prototype._load = function () {
    var self = this;
    this.takenSeatGuids = new Set();
    this.seatStatusLoaded = !this.seatStatusUrl;
    this._renderSkeleton();

    fetch(this.planUrl).then(function (r) { return r.json(); }).then(function (plan) {
      self.plan = plan;
      // Stehplatz (s. gen_seatplan.py): reiner Mengen-Bereich ohne Einzelplatz-Wahl,
      // zählt zur Gesamtkapazität; laeuft als Pseudo-Block "STEHPLATZ" in blockCounts
      // (s. _quickAddBlock), freie Menge kommt live vom Status-Endpunkt.
      self.standing = plan.standing || null;
      self.reservedSeatGuids = self._computeSeatGuidsForRanges(self.reservedSeats, plan);
      self.nvSeatGuids = self._computeSeatGuidsForRanges(self.nvSeats, plan);
      self.blocks = self._deriveBlocks(plan);
      self._render();
      self._renderOccupancy();
    }).catch(function (err) {
      self.root.innerHTML = '<p class="t-body-sm" style="color:#b3392c">Sitzplan konnte nicht geladen werden.</p>';
      console.error('Sitzplan-Fehler', err);
    });

    if (!this.seatStatusUrl) return;
    fetch(this.seatStatusUrl)
      .then(function (r) { return r.ok ? r.json() : { takenSeatGuids: [] }; })
      .catch(function () { return { takenSeatGuids: [] }; })
      .then(function (status) {
        self.takenSeatGuids = new Set(Array.isArray(status.takenSeatGuids) ? status.takenSeatGuids : []);
        if (typeof status.standingAvailable === 'number') {
          self.standingAvailable = status.standingAvailable;
          var stehplatzCounts = self.blockCounts.STEHPLATZ;
          if (stehplatzCounts && stehplatzCounts.normal > self.standingAvailable) {
            stehplatzCounts.normal = self.standingAvailable;
          }
        }
        self.seatStatusLoaded = true;
        if (!self.plan) return; // Plan rendert gleich selbst und liest den Status dann mit
        self._dropTakenSelections();
        self._render();
        self._renderOccupancy();
      });
  };

  /* Ein Platz kann in dem Fenster gewählt worden sein, in dem die Belegung noch nicht
     bekannt war. Kommt sie an und ist der Platz schon weg, fliegt er aus der Auswahl —
     lieber ein sichtbarer Hinweis als eine Bestellung, die im Checkout scheitert. */
  SeatPicker.prototype._dropTakenSelections = function () {
    if (this.mode !== 'seats') return;
    var self = this;
    var entfernt = [];
    Object.keys(this.selected).forEach(function (guid) {
      if (self.takenSeatGuids.has(guid)) {
        var s = self.selected[guid];
        entfernt.push(s.zoneLabel + ', Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber);
        delete self.selected[guid];
      }
    });
    if (!entfernt.length) return;
    this._renderCart();
    if (this.statusNoteEl) {
      this.statusNoteEl.textContent = entfernt.length === 1
        ? 'Der Platz ' + entfernt[0] + ' ist inzwischen belegt und wurde aus deiner Auswahl entfernt.'
        : entfernt.length + ' deiner Plätze sind inzwischen belegt und wurden aus deiner Auswahl entfernt.';
      this.statusNoteEl.hidden = false;
    }
  };

  /* Platzhalter in Blockplan-Größe, damit die Stelle nicht erst leer ist und dann
     springt, wenn der Plan da ist. */
  SeatPicker.prototype._renderSkeleton = function () {
    this.root.innerHTML =
      '<div class="seatplan-skeleton" role="status" aria-live="polite">' +
        '<span class="t-caption">Sitzplan wird geladen …</span>' +
      '</div>';
  };

  /* Der Saalplan wird von uns selbst mit explizitem zone_id je Block erzeugt
     (assets/seating/riethsporthalle-seatingplan.json, siehe gen_seatplan.py) —
     jede Zone entspricht direkt einem Block (D/E/F Nordtribüne, A/B/C Südtribüne).
     Innerhalb eines Blocks können Reihen unterschiedliche Kategorien tragen (z. B.
     Block A: Reihe 1 VIP, Reihen 2+ Kategorie II) — das wird beim Rendern in
     _renderZone anhand der Kategorie je Reihe in Gruppen aufgeteilt. */
  SeatPicker.prototype._deriveBlocks = function (plan) {
    var blocks = {};
    plan.zones.forEach(function (zone) {
      blocks[zone.zone_id] = zone;
    });
    return blocks;
  };

  /* Reihen eines Blocks in zusammenhängende Gruppen teilen — sowohl bei Kategoriewechsel
     (z. B. [VIP: Reihe 1-5], [Kategorie I: Reihen 6-12]) als auch bei einem rein optischen
     section_break OHNE Kategoriewechsel (z. B. Block A/C: [Kategorie II: Reihen 1-5],
     [Kategorie II: Reihen 6-12]) — damit A/C denselben Lücken-Abstand UND dieselbe
     wiederholte Kategorie-Beschriftung wie Block B bekommen, statt nur einer stummen
     CSS-Lücke ohne Label. */
  SeatPicker.prototype._categoryGroups = function (zone) {
    var groups = [];
    zone.rows.forEach(function (row) {
      var category = row.seats[0].category;
      var last = groups[groups.length - 1];
      if (last && last.category === category && !row.section_break) {
        last.rows.push(row);
      } else {
        // label: optionale Anzeige-Beschriftung (row.category_label, s. gen_seatplan.py)
        // für Gruppen, die zwar dieselbe Kategorie/denselben Preis wie eine andere Gruppe
        // im selben Block haben, aber eigenständig benannt werden sollen (z.B. Block C
        // unten: bleibt "Kategorie II", heißt auf der Website aber "C unten"). null, wenn
        // keine Überschreibung nötig ist — dann greift überall catShortLabel(category).
        groups.push({ category: category, label: row.category_label || null, rows: [row] });
      }
    });
    return groups;
  };

  /* Kaufbare Kategorien eines Blocks, in physischer Reihenfolge (oben→unten) und ohne
     Duplikate — Grundlage für die Direktwahl-Dropdown UND für die separaten Kacheln in
     der Übersicht (s. blockTile in _renderMobileOverview). Ein Block kann mehrere ECHTE
     Produkte enthalten (z.B. Block A: Kategorie III oben, Fanblock unten; Block C:
     Kategorie II oben, C unten — seit 09.08.2026 eigenes Kontingent/eigene Kachel, auch
     wenn der Preis identisch zu Kategorie II bleibt). Dedupe nach category greift nur
     noch, falls dieselbe Kategorie tatsächlich mehrfach im selben Block vorkommt (z.B.
     zwei getrennte Gruppen). VIP-Anteile ohne Preis (excludeCategories, z.B. Block B beim
     Einzelticket) fallen ganz raus, wie bisher bei _quickAddBlock. */
  SeatPicker.prototype._purchasableCategories = function (zoneId) {
    var self = this;
    var zone = this._zoneById(zoneId);
    if (!zone) return [];
    var seen = {};
    var result = [];
    this._categoryGroups(zone).forEach(function (g) {
      if (self.excludeCategories.indexOf(g.category) !== -1) return;
      if (!self.prices[g.category]) return;
      if (seen[g.category]) return;
      seen[g.category] = true;
      // rows: Reihenzahl der Gruppe — Grundlage für den Höhenanteil der Kachel in
      // blockTile() (z.B. Fanblock 5 Reihen vs. Kategorie III 7 Reihen im selben Block:
      // die Kachel-Höhe soll das widerspiegeln statt beide gleich hoch zu zeigen).
      result.push({ category: g.category, label: g.label || catShortLabel(g.category), rows: g.rows.length });
    });
    return result;
  };

  SeatPicker.prototype._zoneById = function (id) {
    return this.blocks[id];
  };

  SeatPicker.prototype._renderMobileOverview = function () {
    var self = this;

    function blockTile(id, isNorth) {
      var zone = self._zoneById(id);
      if (!zone) return '';
      // Seit 09.08.2026 (Marko: "Die Bereiche sollen getrennt werden ... Bilder sollen
      // nicht mehr zusammen angezeigt werden") zeigt ein Block mit mehreren kaufbaren
      // Bereichen (z.B. Block A: Fanblock + Kategorie III) NICHT mehr eine einzelne
      // Kachel mit Farbverlauf, sondern einen Stapel aus genau so vielen eigenständigen,
      // einfarbigen Kacheln wie er Bereiche hat — physische Reihenfolge (oben→unten)
      // entspricht der Reihenfolge in _purchasableCategories (erste Gruppe = Reihen
      // nächst dem Spielfeld). Blöcke mit nur einem Bereich (D/E/F) bleiben eine Kachel.
      var purchasable = self._purchasableCategories(id);
      if (!purchasable.length) {
        return '<div class="seatplan-mobile-tile-group' + (isNorth ? '' : ' seatplan-mobile-tile-group-south') + '" style="visibility:hidden"></div>';
      }
      var multi = purchasable.length > 1;
      // Fanblock/VIP/C unten (Marko, 09.08.2026): keine eigene Block-Buchstaben-Zeile
      // mehr, nur noch der Kategorie-Name — gleiche Schriftgröße/-grad wie die übrige
      // Kat.-Beschriftung (Marko: "wie bei Kategorie 2"). "C unten" heißt hier
      // "Courtside", mit fett gesetztem C statt eines eigenen Buchstabens.
      var tiles = purchasable.map(function (p) {
        var key = multi ? id + '::' + p.category : id;
        var isPending = self.mode === 'blocks' && self.pendingBlockId === key;
        var tileClass = 'seatplan-mobile-tile' + (isNorth ? '' : ' seatplan-mobile-tile-south') + (isPending ? ' selected' : '');
        // flex-grow proportional zur Reihenzahl: Fanblock/VIP/Courtside haben immer nur
        // 5 Reihen, ihr Gegenstück (Kat. I/II/III) mehr — die Kachel-Höhe soll das
        // abbilden statt beide Hälften eines Blocks gleich hoch zu zeigen.
        var tileStyle = 'background:' + catColor(p.category) + ';border-color:' + catBorderColor(p.category) + ';flex:' + p.rows + ' 1 0';
        var inner;
        if (p.category === 'Fanblock' || p.category === 'VIP') {
          inner = '<span class="seatplan-mobile-tile-cat">' + escapeHtml(p.category) + '</span>';
        } else if (p.category === 'C unten') {
          inner = '<span class="seatplan-mobile-tile-cat"><strong>C</strong>ourtside</span>';
        } else {
          inner = '<span class="seatplan-mobile-tile-letter">' + id + '</span>' +
            '<span class="seatplan-mobile-tile-cat">' + escapeHtml(p.label) + '</span>';
        }
        return '<button type="button" class="' + tileClass + '" style="' + tileStyle + '" data-zone="' + key + '">' + inner + '</button>';
      }).join('');
      return '<div class="seatplan-mobile-tile-group' + (isNorth ? '' : ' seatplan-mobile-tile-group-south') + '">' + tiles + '</div>';
    }

    var northTiles = this.northZones.map(function (id) { return blockTile(id, true); }).join('');
    var southTiles = this.southZones.map(function (id) { return blockTile(id, false); }).join('');

    // Modus "blocks" (Einzelticket): kein Sitzdetail nötig (freie Platzwahl im Block) —
    // stattdessen direkt in der Übersicht einen Block antippen (Markierung) und mit
    // "Übernehmen" 1 Ticket in den Warenkorb legen. Der Button erscheint nur dann,
    // mittig über dem Spielfeld, nicht standardmäßig sichtbar. Enthält bei Blöcken mit
    // mehr als einer kaufbaren Kategorie (z.B. Block A: Kategorie III/Fanblock) die
    // konkrete Kategorie im Button-Text — sonst wäre nach dem Antippen einer Kachel-
    // Hälfte nicht erkennbar, welches der beiden Produkte gerade vorgemerkt ist.
    var courtConfirm = '';
    if (this.mode === 'blocks' && this.pendingBlockId) {
      var pendingKey = splitZoneKey(this.pendingBlockId);
      var pendingZoneId = pendingKey.zoneId;
      var pendingCategory = pendingKey.category;
      // Zusatz IMMER anzeigen, nicht nur bei Blöcken mit mehreren kaufbaren Kategorien
      // (Marko, 10.08.2026: "mal mit, mal ohne Zusatz" war uneinheitlich) — bei genau
      // einer kaufbaren Kategorie im Block (z.B. Block D) gibt es zwar kein "::category"
      // im Key, aber pendingPurchasable hat dann trotzdem genau einen Eintrag.
      var pendingPurchasable = pendingZoneId === 'STEHPLATZ' ? [] : this._purchasableCategories(pendingZoneId);
      var pendingMatch = pendingCategory
        ? pendingPurchasable.filter(function (p) { return p.category === pendingCategory; })[0]
        : (pendingPurchasable.length === 1 ? pendingPurchasable[0] : null);
      var confirmSuffix = '';
      if (pendingZoneId === 'STEHPLATZ') {
        confirmSuffix = 'Stehplatz';
      } else if (pendingMatch) {
        // Fanblock/VIP/Courtside: eigenständige Produktnamen ohne Block-Buchstabe/
        // Klammer-Kategorie (deckungsgleich mit der Auslastungskachel, s.
        // _renderOccupancy) — sonst "Block A (Fanblock)" statt einfach "Fanblock".
        if (pendingMatch.category === 'Fanblock' || pendingMatch.category === 'VIP') {
          confirmSuffix = pendingMatch.category;
        } else if (pendingMatch.category === 'C unten') {
          confirmSuffix = 'Block CS';
        } else {
          var pendingZone = this._zoneById(pendingZoneId);
          confirmSuffix = (pendingZone ? pendingZone.name : pendingZoneId) + ' (' + catShortLabel(pendingMatch.category) + ')';
        }
      }
      courtConfirm = '<button type="button" class="btn btn-primary btn-sm seatplan-mobile-court-confirm" id="seatplan-mobile-add-btn">Übernehmen' +
        (confirmSuffix ? ': ' + escapeHtml(confirmSuffix) : '') + '</button>';
    }

    this.root.innerHTML =
      '<h3 class="t-h4" style="text-align:center;margin:0 0 12px">Wähle deinen Block</h3>' +
      '<div class="seatplan-mobile-overview">' +
        '<div class="seatplan-mobile-entrance main" style="grid-column:1;grid-row:1 / 5"><span></span><i>Haupteingang</i><span></span></div>' +
        '<div class="seatplan-mobile-tiles" style="grid-column:2;grid-row:1">' + northTiles + '</div>' +
        '<div class="seatplan-mobile-bench-align" style="grid-column:2;grid-row:2">' +
          '<div class="seatplan-mobile-bench-spacer" aria-hidden="true"></div>' +
          '<div class="seatplan-mobile-bench-row">' +
            '<div class="seatplan-mobile-bench seatplan-mobile-bench-gaeste"><span></span><i>Gäste</i><span></span></div>' +
            '<div class="seatplan-mobile-bench seatplan-mobile-bench-kg"><span></span><i>Kampfgericht</i><span></span></div>' +
            '<div class="seatplan-mobile-bench seatplan-mobile-bench-heim"><span></span><i>Heim</i><span></span></div>' +
          '</div>' +
          '<div class="seatplan-mobile-bench-spacer" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="seatplan-mobile-court-row" style="grid-column:2;grid-row:3">' +
          '<div class="seatplan-mobile-court-aside">' +
            '<div class="seatplan-mobile-scoreboard"><span></span><i>Anzeigetafel</i><span></span></div>' +
            (function () {
              // Stehplatz ist im Modus "blocks" antippbar wie eine Zonen-Kachel (tippen =
              // vormerken, "Übernehmen" bestätigt) — nur wenn für dieses Spiel buchbar.
              var clickable = self.mode === 'blocks' && self.standing && self.standingPrice && self.standingBookable;
              var standingPending = clickable && self.pendingBlockId === 'STEHPLATZ';
              var standingClass = 'seatplan-mobile-standing' + (standingPending ? ' selected' : '') + (clickable ? '' : ' seatplan-mobile-standing--unavailable');
              return '<button type="button" class="' + standingClass + '"' +
                (clickable ? ' data-zone="STEHPLATZ"' : '') +
                ' aria-label="Stehplatz' + (self.standing ? ' (' + self.standing.capacity + ' Plätze)' : '') + (clickable ? '' : ', aktuell nicht buchbar') + '">' +
                '<span>Steh-</span><span>platz</span>' +
              '</button>';
            })() +
          '</div>' +
          '<div class="seatplan-mobile-court">' + courtConfirm + '<p class="t-caption" style="margin:0;color:var(--text-muted)">Spielfeld</p></div>' +
          '<div class="seatplan-mobile-court-aside-mirror" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="seatplan-mobile-tiles" style="grid-column:2;grid-row:4">' + southTiles + '</div>' +
        '<div class="seatplan-mobile-entrance vip" style="grid-column:3;grid-row:4"><i>VIP-Eingang</i></div>' +
      '</div>';

    // Stehplatz-Box teilt sich die Selektion mit den Zonen-Kacheln (data-zone="STEHPLATZ",
    // nur vorhanden wenn buchbar) — tippen/bestätigen läuft dadurch exakt wie bei einem
    // echten Block, kein eigener Mechanismus (s. #222).
    this.root.querySelectorAll('.seatplan-mobile-tile[data-zone], .seatplan-mobile-standing[data-zone]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var key = btn.dataset.zone;
        if (self.mode === 'blocks') {
          // Jede kaufbare Kategorie hat jetzt ihre eigene Kachel (data-zone bereits
          // der zusammengesetzte Schlüssel "zoneId::category", bzw. nur "zoneId" bei
          // genau einer Kategorie oder Stehplatz) — kein Tipp-Positions-Mechanismus
          // mehr nötig.
          self.pendingBlockId = self.pendingBlockId === key ? null : key;
          self._render();
        } else {
          var parts = splitZoneKey(key);
          self._openZoneDetail(parts.zoneId, parts.category);
        }
      });
    });
    if (this.mode === 'blocks') {
      var addBtn = this.root.querySelector('#seatplan-mobile-add-btn');
      if (addBtn) addBtn.addEventListener('click', function () { self._addPendingBlock(); });
    }
    this._fixupStandingBox();
    this._renderCart();
  };

  /* .seatplan-mobile-standing hat einen festen 25px-Versatz nach unten (s. CSS) —
     bei ausreichender Spielfeldhöhe eine bewusste optische Feinjustierung, bei sehr
     schmaler Spielfeldbreite (z. B. iPad-Breite: die Aside-Gruppe stretcht auf die
     Spielfeldhöhe, die per aspect-ratio mitschrumpft) reicht der feste Versatz aber
     über die Unterkante des Spielfelds hinaus. Fixer Pixel-Wert lässt sich in CSS
     nicht an die schrumpfende Höhe koppeln — deshalb hier nach dem Rendern messen
     und den Versatz nur so weit reduzieren, wie zum Vermeiden des Überstands nötig
     ist (bei ausreichend Platz bleibt der ursprüngliche Versatz unverändert). */
  SeatPicker.prototype._fixupStandingBox = function () {
    var standing = this.root.querySelector('.seatplan-mobile-standing');
    var aside = this.root.querySelector('.seatplan-mobile-court-aside');
    if (!standing || !aside) return;
    standing.style.transform = '';
    var overflow = standing.getBoundingClientRect().bottom - aside.getBoundingClientRect().bottom;
    if (overflow > 0) {
      var baseY = 25;
      var newY = Math.max(0, baseY - overflow);
      standing.style.transform = 'translate(-15px, ' + newY + 'px)';
    }
  };

  /* Modus "blocks" (Einzelticket): Gesamtkapazität einer Kategorie in einem Block —
     Grundlage für den Stepper-Grenzwert, sowohl beim Schnell-Hinzufügen aus der
     Übersicht/Direktwahl als auch beim +/- im Warenkorb selbst. Keine Live-Belegungs-
     prüfung (Einzelticket ist ohnehin First-Come-First-Serve vor Ort). */
  /* Belegung EINER Kategorie-Gruppe (nicht mehr des ganzen Blocks, seit 10.08.2026):
     Fanblock/VIP/Courtside sind seit dem Produktkatalog-Umbau (09.08.2026) eigene
     Produkte mit eigenem Kontingent, keine Untermenge "ihres" Blocks mehr — die
     Auslastungskachel muss sie deshalb als eigene Zeile zeigen statt sie unsichtbar
     in der Zahl von Block A/B/C mitzuzählen. _blockFreeCount liefert dasselbe "frei"
     pro Kategorie für die Mengen-Stepper, hier interessiert nur gesamt/belegt/frei. */
  SeatPicker.prototype._categoryOccupancy = function (group) {
    var self = this;
    var gesamt = 0, belegt = 0;
    group.rows.forEach(function (r) {
      r.seats.forEach(function (seat) {
        gesamt++;
        if (self._isBlocked(seat.seat_guid)) belegt++;
      });
    });
    return { gesamt: gesamt, belegt: belegt, frei: gesamt - belegt };
  };

  /* Auslastung aller Blöcke als Kachelinhalt — nur wenn die Seite ein occupancyEl
     mitgegeben hat. Solange der Sitzstatus noch nicht da ist, stünde hier "alles frei",
     was falscher wäre als keine Zahl — deshalb erst der Ladehinweis.
     Seit 10.08.2026: eine Zeile pro kaufbarer Kategorie, nicht mehr pro physischem
     Block — Fanblock/VIP/Courtside (C unten) sind seit dem Produktkatalog-Umbau
     eigene Produkte mit eigenem Kontingent, keine Untermenge "ihres" Blocks mehr.
     Vorher verschwanden sie unsichtbar in der Zahl von Block A/B/C, obwohl sie
     unabhängig ausverkauft sein können (Marko: "die neuen Blöcke ... sichtbar
     machen"). Die reale Verfügbarkeit selbst kam schon vorher korrekt aus den
     Sitz-GUIDs (_isBlocked zieht taken/reserved(EA)/nv bereits pro Sitz ab, unabhängig
     vom pretix-Kontingent) — nur die Aufschlüsselung nach Produkt fehlte. */
  SeatPicker.prototype._renderOccupancy = function () {
    if (!this.occupancyEl) return;
    var self = this;
    if (!this.plan) return;
    if (!this.seatStatusLoaded) {
      this.occupancyEl.innerHTML = '<p class="t-body-sm" style="color:var(--text-muted)">Wird geladen …</p>';
      return;
    }
    // Feste Reihenfolge (Marko, 10.08.2026): A, B, C, CS, D, E, F, Fanblock, VIP,
    // Stehplatz — NICHT die physische Zeilen-Reihenfolge der Sitzplan-Daten (dort
    // stehen Fanblock/VIP vor "ihrem" Hauptblock, weil sie näher am Spielfeld liegen).
    var ORDER = ['A', 'B', 'C', 'CS', 'D', 'E', 'F', 'Fanblock', 'VIP', 'STEHPLATZ'];
    var rows = {}; // key aus ORDER -> {label, gesamt, frei}
    function addRow(key, label, gesamt, frei, force) {
      if (!gesamt && !force) return;
      rows[key] = { label: label, gesamt: gesamt, frei: frei };
    }
    this.northZones.concat(this.southZones).forEach(function (id) {
      var zone = self._zoneById(id);
      if (!zone) return;
      var groups = self._categoryGroups(zone).filter(function (g) {
        return self.occupancyExcludeCategories.indexOf(g.category) === -1;
      });
      groups.forEach(function (g) {
        var o = self._categoryOccupancy(g);
        // Nur der Blockname/Produktname, keine Kategorie-Klammer (Marko, 10.08.2026:
        // "sowas wie (Kat. II) soll da raus" — Fanblock/VIP/Courtside sind als eigene
        // Zeile schon eindeutig von "Block A/B/C" unterscheidbar, die Kategorie in
        // Klammern war redundant und sprengte die einzeilige Lesbarkeit).
        var key, label;
        if (g.category === 'Fanblock' || g.category === 'VIP') {
          key = g.category; label = g.category;
        } else if (g.category === 'C unten') {
          key = 'CS'; label = 'Block CS';
        } else {
          key = id; label = zone.name;
        }
        addRow(key, label, o.gesamt, o.frei);
      });
    });
    // Stehplatz zählt zur Gesamtkapazität mit — eigene Zeile statt in die Block-Liste
    // gemischt, weil es kein Block mit Reihen/Sitzen ist, sondern ein reiner Mengen-Posten.
    // Zeile immer anzeigen (Marko, 10.08.2026), auch wenn Stehplatz für dieses Spiel nicht
    // buchbar ist (s. #222) — dann aber als "0 von 0 frei" statt mit der eigentlichen
    // Kapazität, weil für dieses Spiel schlicht kein Stehplatz angeboten wird.
    if (this.standing && this.standing.capacity) {
      if (this.standingBookable) {
        var stehplatzFrei = typeof this.standingAvailable === 'number' ? this.standingAvailable : this.standing.capacity;
        addRow('STEHPLATZ', this.standing.name, this.standing.capacity, stehplatzFrei);
      } else {
        addRow('STEHPLATZ', this.standing.name, 0, 0, true);
      }
    }
    var zeilen = [], gesamtAlle = 0, freiAlle = 0;
    ORDER.forEach(function (key) {
      var r = rows[key];
      if (!r) return;
      gesamtAlle += r.gesamt; freiAlle += r.frei;
      var quote = r.gesamt > 0 ? Math.round((r.frei / r.gesamt) * 100) : 100;
      zeilen.push(
        '<li class="seatplan-occupancy-row">' +
          '<span class="seatplan-occupancy-block">' + r.label + '</span>' +
          '<span class="seatplan-occupancy-bar" aria-hidden="true">' +
            '<span style="width:' + (100 - quote) + '%"></span>' +
          '</span>' +
          '<span class="seatplan-occupancy-num">' + r.frei + ' von ' + r.gesamt + ' frei</span>' +
        '</li>'
      );
    });
    if (!zeilen.length) { this.occupancyEl.innerHTML = ''; return; }
    function n(v) { return v.toLocaleString('de-DE'); }
    var gesamtQuote = gesamtAlle > 0 ? Math.round((freiAlle / gesamtAlle) * 100) : 0;
    this.occupancyEl.innerHTML =
      '<ul class="seatplan-occupancy">' + zeilen.join('') + '</ul>' +
      '<p class="t-caption" style="margin:10px 0 0;color:var(--text-muted)">' +
        'Insgesamt noch ' + n(freiAlle) + ' von ' + n(gesamtAlle) + ' Plätzen frei (' + gesamtQuote + ' %).' +
      '</p>';
  };

  /* Anzahl Rollstuhlplätze eines Blocks — sitzplanweit dasselbe Sonderprodukt
     "Rollstuhlplatz" (8,00 €, s. Preisliste), unabhängig von der sonstigen Block-
     kategorie (aktuell physisch nur in A/D/E/F vorhanden). onlyFree=true zählt nur
     noch nicht belegte Plätze (Obergrenze für den Kauf), sonst alle. */
  SeatPicker.prototype._wheelchairSeatCount = function (zoneId, onlyFree) {
    var self = this;
    var zone = this._zoneById(zoneId);
    if (!zone) return 0;
    var count = 0;
    zone.rows.forEach(function (row) {
      row.seats.forEach(function (seat) {
        if (!seat.wheelchair) return;
        if (onlyFree && self._isBlocked(seat.seat_guid)) return;
        count++;
      });
    });
    return count;
  };

  /* Frei verfügbare Plätze einer Kategorie in einem Block — Obergrenze für die
     Mengen-Stepper im Modus "blocks". Belegte Sitze werden abgezogen: vorher zählte
     die Funktion trotz ihres Namens alle Sitze und man hätte theoretisch mehr Tickets
     bestellen können, als der Block noch frei hat. */
  SeatPicker.prototype._blockFreeCount = function (zoneId, category) {
    var self = this;
    // Stehplatz ist keine echte Zone (keine Reihen/Sitze) — Obergrenze kommt aus dem
    // live abgefragten pretix-Kontingent statt aus Sitzdaten (s. #222).
    if (zoneId === 'STEHPLATZ') {
      return typeof this.standingAvailable === 'number' ? this.standingAvailable : (this.standing ? this.standing.capacity : 0);
    }
    // Rollstuhlplatz ist im Modus "blocks" (Einzelticket) EIN gemeinsames Kontingent
    // über alle Blöcke mit Rollstuhlplätzen hinweg (Marko, 11.08.2026: "ist eigentlich
    // egal, wo die Personen sitzen") — Pseudo-Zone "ROLLSTUHL" statt eines echten
    // Blocks, s. _quickAddBlock/_renderDirectAddRow. Sitzplan-Modus (Dauerkarte) bleibt
    // unberührt: dort ist der Rollstuhlplatz ein echter, konkret gewählter Sitz.
    if (category === 'Rollstuhlplatz' && zoneId === 'ROLLSTUHL') {
      return this.northZones.concat(this.southZones).reduce(function (sum, id) {
        return sum + self._wheelchairSeatCount(id, true);
      }, 0);
    }
    // Rollstuhlplatz ist keine eigene Reihen-Kategorie, sondern einzelne, über den
    // Block verteilte Sitze (seat.wheelchair) — eigene Zählung statt _categoryGroups.
    if (category === 'Rollstuhlplatz') return this._wheelchairSeatCount(zoneId, true);
    var zone = this._zoneById(zoneId);
    if (!zone) return 0;
    return this._categoryGroups(zone).filter(function (g) { return g.category === category; })
      .reduce(function (sum, g) {
        return sum + g.rows.reduce(function (s, r) {
          return s + r.seats.filter(function (seat) {
            return !self._isBlocked(seat.seat_guid);
          }).length;
        }, 0);
      }, 0);
  };

  /* Fügt `qty` Tickets einer Kategorie eines Blocks zum Warenkorb hinzu (Tarif
     "normal" als Default, im Warenkorb danach umstellbar) — gemeinsame Grundlage für
     "Übernehmen" in der Übersicht UND die Direktwahl (Block+Anzahl) im Warenkorb.
     Stehplatz (zoneId "STEHPLATZ") laeuft ueber denselben Pfad wie ein echter Block —
     eigene Kategorie "Stehplatz", kein Ermaessigt-Tarif, Preis aus standingPrice.
     `category` ist optional: ohne Angabe (Rückwärtskompatibilität) greift die letzte
     kaufbare Kategorie des Blocks — bei Blöcken mit mehreren echten Produkten (z.B.
     Block A: Kategorie III/Fanblock) haben Klick-Handler und Direktwahl-Dropdown die
     Kategorie aber immer schon explizit im data-zone-Schlüssel (s. _renderDirectAddRow). */
  SeatPicker.prototype._quickAddBlock = function (zoneId, qty, category) {
    var self = this;
    if (zoneId === 'STEHPLATZ') {
      if (!this.standing || !this.standingPrice || !this.standingBookable) return;
      var stehplatzFree = this._blockFreeCount('STEHPLATZ', 'Stehplatz');
      var stehplatzCounts = this.blockCounts.STEHPLATZ || {};
      this._setBlockCount('STEHPLATZ', this.standing.name, 'Stehplatz', { normal: this.standingPrice }, 'normal', (stehplatzCounts.normal || 0) + qty, stehplatzFree);
      return;
    }
    // Rollstuhlplatz (Modus "blocks"/Einzelticket): EIN gemeinsames Kontingent über alle
    // Blöcke hinweg statt eines pro Block (Marko, 11.08.2026) — Pseudo-Zone "ROLLSTUHL"
    // statt eines echten Blocks, deshalb VOR dem _zoneById-Check (der für "ROLLSTUHL"
    // ins Leere liefe). Kein eigenes Tipp-Ziel auf der Grafik-Kachel, nur über die
    // Direktwahl-Dropdown erreichbar (zu wenige/verstreute Plätze für eine dritte
    // antippbare Kachel-Zone), quotiert über die tatsächlichen Rollstuhlplätze aller
    // Blöcke statt über _categoryGroups.
    if (category === 'Rollstuhlplatz') {
      if (!this.prices['Rollstuhlplatz']) return;
      var wcFree = this._blockFreeCount('ROLLSTUHL', 'Rollstuhlplatz');
      var wcBlockKey = 'ROLLSTUHL::Rollstuhlplatz';
      var wcCounts = this.blockCounts[wcBlockKey] || {};
      this._setBlockCount(wcBlockKey, 'Rollstuhlplatz', 'Rollstuhlplatz', this.prices['Rollstuhlplatz'], 'normal', (wcCounts.normal || 0) + qty, wcFree);
      return;
    }
    var zone = this._zoneById(zoneId);
    if (!zone) return;
    var purchasable = this._purchasableCategories(zoneId);
    if (!purchasable.length) return;
    var chosen = category
      ? purchasable.filter(function (p) { return p.category === category; })[0]
      : purchasable[purchasable.length - 1]; // Fallback: letzte kaufbare Kategorie (bisheriges Verhalten)
    if (!chosen) return;
    category = chosen.category;
    var total = this._blockFreeCount(zoneId, category);
    var priceInfo = this.prices[category] || { normal: 0 };
    var blockKey = zoneId + '::' + category;
    var counts = this.blockCounts[blockKey] || {};
    var zoneLabel = zone.name + ' - ' + chosen.label;
    this._setBlockCount(blockKey, zoneLabel, category, priceInfo, 'normal', (counts.normal || 0) + qty, total);
  };

  SeatPicker.prototype._addPendingBlock = function () {
    if (!this.pendingBlockId) return;
    var pendingKey = splitZoneKey(this.pendingBlockId);
    this._quickAddBlock(pendingKey.zoneId, 1, pendingKey.category);
    this.pendingBlockId = null;
    this._render();
    if (this.cartEl) this.cartEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* Die aktive Auswahl: in der Detailansicht die Vormerkung, sonst der Warenkorb-Stand.
     Alles, was Sitze markiert oder auflistet, fragt hier — nie direkt `selected` ab. */
  SeatPicker.prototype._activeSeats = function () {
    return this.pendingSeats || this.selected;
  };

  /* Sitzdetailansicht eines Blocks öffnen. Die Vormerkung startet als Kopie des
     Warenkorb-Stands, damit bereits übernommene Plätze markiert bleiben und im Overlay
     auch wieder abgewählt werden können — „Abbrechen" stellt dann den Stand von vorher
     wieder her. */
  SeatPicker.prototype._openZoneDetail = function (zoneId, category) {
    if (!this.pendingSeats) {
      var copy = {};
      var src = this.selected;
      Object.keys(src).forEach(function (guid) { copy[guid] = src[guid]; });
      this.pendingSeats = copy;
    }
    this.mobileZoneId = zoneId;
    this.mobileCategory = category || null;
    this._render();
  };

  /* Kaufbare Bereiche als Ring in der Reihenfolge der Übersicht (Nord D-E-F, dann Süd
     A-B-C): beide Pfeile sind dadurch immer aktiv, es gibt keine Sackgasse. Blöcke mit
     mehreren kaufbaren Kategorien (z.B. Block A: Fanblock/Kategorie III) tragen dabei
     mit einem eigenen Ring-Eintrag pro Kategorie bei — seit der Trennung der Kacheln
     (09.08.2026) sind das eigenständige, separat anzeigbare Bereiche, keine gemeinsame
     Block-Detailansicht mehr. Schlüssel-Format wie überall: "zoneId" bei genau einer
     kaufbaren Kategorie, sonst "zoneId::category" (s. splitZoneKey). */
  SeatPicker.prototype._zoneRing = function () {
    var self = this;
    var ring = [];
    this.northZones.concat(this.southZones).forEach(function (id) {
      var purchasable = self._purchasableCategories(id);
      if (!purchasable.length) return;
      if (purchasable.length === 1) {
        ring.push(id);
      } else {
        purchasable.forEach(function (p) { ring.push(id + '::' + p.category); });
      }
    });
    return ring;
  };

  SeatPicker.prototype._neighbourZone = function (step) {
    var ring = this._zoneRing();
    var currentKey = this.mobileCategory ? this.mobileZoneId + '::' + this.mobileCategory : this.mobileZoneId;
    var i = ring.indexOf(currentKey);
    if (i === -1 || ring.length < 2) return null;
    return ring[(i + step + ring.length) % ring.length];
  };

  /* Vorgemerkte Plätze als Text unter dem Sitzplan — „Reihe 14, Platz 1". Optisch ist
     ein markierter Sitz im Raster schnell übersehen, gerade heruntergezoomt; hier steht
     schwarz auf weiß, was „Übernehmen" in den Warenkorb legt. Plätze aus anderen Blöcken
     (per Pfeil-Navigation dazugekommen) bekommen den Blocknamen davor, Plätze des gerade
     gezeigten Blocks nicht — dessen Name steht schon im Header. */
  SeatPicker.prototype._pendingListHTML = function (currentZoneName) {
    var seats = this._activeSeats();
    var guids = Object.keys(seats);
    if (!guids.length) {
      return '<span class="seatplan-pending-empty">Noch kein Platz gewählt — tippe auf einen freien Platz.</span>';
    }
    var labels = guids.map(function (guid) {
      var s = seats[guid];
      var reihe = 'Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber;
      return s.zoneLabel === currentZoneName ? reihe : s.zoneLabel + ' · ' + reihe;
    });
    // Rollstuhlplatz ist "inkl. Begleitkarte" (s. Preisliste) — die Begleitperson braucht
    // trotzdem einen echten Sitzplatz im selben Block, den es hier (anders als beim
    // Einzelticket ohne feste Platzwahl) tatsächlich auszuwählen gibt. Buchung freiwillig
    // (Marko, 13.08.2026), deshalb "kannst" statt "bitte" — der Tarif "Begleitperson
    // (kostenlos)" steht danach im Warenkorb je Sitz zur Auswahl, s. _companionSlotAvailable.
    var hasWheelchair = guids.some(function (guid) { return seats[guid].category === 'Rollstuhlplatz'; });
    var hint = hasWheelchair
      ? '<span class="seatplan-pending-hint">Für deine Begleitperson kannst du zusätzlich einen kostenlosen Sitzplatz im selben Block wählen (im Warenkorb als „Begleitperson" auswählbar).</span>'
      : '';
    return '<span class="seatplan-pending-label">Deine Auswahl</span>' +
      '<span class="seatplan-pending-seats">' + labels.join(' · ') + '</span>' + hint;
  };

  SeatPicker.prototype._renderPendingList = function (zone) {
    var box = document.createElement('div');
    box.className = 'seatplan-pending';
    box.innerHTML = this._pendingListHTML(zone.name);
    return box;
  };

  /* Nach jedem Sitz-Toggle nur die Textliste aktualisieren, statt die ganze
     Detailansicht neu zu bauen — ein voller Re-Render würde Zoom/Scroll-Zustand des
     Sitzplans zurücksetzen (dieselbe Sprung-Falle wie beim alten Warenkorb-Rebuild,
     s. _toggleSeat). */
  SeatPicker.prototype._updatePendingList = function (currentZoneName) {
    var target = this.detailRootEl || this.root;
    var box = target.querySelector('.seatplan-pending');
    if (box) box.innerHTML = this._pendingListHTML(currentZoneName);
  };

  SeatPicker.prototype._renderMobileZoneDetail = function () {
    var self = this;
    var zone = this._zoneById(this.mobileZoneId);
    var wrap = document.createElement('div');
    wrap.className = 'seatplan-mobile-detail';
    var header = document.createElement('div');
    header.className = 'seatplan-mobile-detail-header';
    // Block-Name + Kategorien stehen hier im Header, NICHT mehr als Labels in der
    // grauen Sitzbox selbst — die Box zeigt nur noch Sitze + Reihennummern. Jede
    // Gruppe des Blocks bekommt ihren eigenen Eintrag mit Preis (statt früher nur die
    // Hauptkategorie + "(und VIP)" ohne Preis) — z.B. Block A: "Kategorie III – 10,00 €
    // (8,00 € ermäßigt) · Fanblock – 10,50 € (8,00 € ermäßigt)".
    // Nur noch die Gruppe(n) der gerade offenen Kategorie — bei Blöcken mit mehreren
    // kaufbaren Kategorien (z.B. Block A: Fanblock/Kategorie III) zeigt die Detailansicht
    // seit der Trennung der Kacheln (09.08.2026) ausschließlich den angetippten Bereich,
    // nicht mehr den ganzen physischen Block gemischt.
    var groups = this._categoryGroups(zone).filter(function (g) {
      return self.excludeCategories.indexOf(g.category) === -1 && (!self.mobileCategory || g.category === self.mobileCategory);
    });
    function categoryHeaderText(g) {
      var label = g.label || catShortLabel(g.category);
      var priceInfo = self.prices && self.prices[g.category];
      if (!priceInfo) return escapeHtml(label);
      var text = escapeHtml(label) + ' – ' + fmtEUR(priceInfo.normal) + ' €';
      if (priceInfo.ermaessigt !== undefined) text += ' (' + fmtEUR(priceInfo.ermaessigt) + ' € ermäßigt)';
      return text;
    }
    var headerText = groups.map(categoryHeaderText).join(' · ');
    var titleText = this.mobileCategory ? zone.name + ' · ' + catShortLabel(this.mobileCategory) : zone.name;
    /* Anzeigename eines Ring-Nachbarn (kann ein anderer Block ODER eine andere Kategorie
       desselben Blocks sein, s. _zoneRing) fürs aria-label der Pfeile. */
    function neighbourName(key) {
      var parts = splitZoneKey(key);
      var z = self._zoneById(parts.zoneId);
      if (!z) return '';
      return parts.category ? z.name + ' · ' + catShortLabel(parts.category) : z.name;
    }
    /* Pfeile links/rechts vom Blocknamen statt eines Zurück-Pfeils: von hier aus lässt
       sich durch alle Bereiche blättern, ohne jedes Mal in die Übersicht und zurück. Der
       Weg zurück zur Übersicht ist der „Abbrechen"-Button unten links (plus Klick neben
       das Overlay und ESC). */
    var prevZone = this._neighbourZone(-1);
    var nextZone = this._neighbourZone(1);
    header.innerHTML =
      (prevZone
        ? '<button type="button" class="seatplan-mobile-back" data-zone-step="-1" aria-label="Vorheriger Bereich: ' + neighbourName(prevZone) + '"><i data-lucide="chevron-left" class="icon-16"></i></button>'
        : '<span style="width:32px"></span>') +
      '<span class="seatplan-mobile-detail-title">' +
        '<strong class="t-body-sm">' + titleText + '</strong>' +
        '<span class="t-caption" style="color:var(--text-muted)">' + headerText + '</span>' +
      '</span>' +
      (nextZone
        ? '<button type="button" class="seatplan-mobile-back" data-zone-step="1" aria-label="Nächster Bereich: ' + neighbourName(nextZone) + '"><i data-lucide="chevron-right" class="icon-16"></i></button>'
        : '<span style="width:32px"></span>');
    wrap.appendChild(header);
    var zoneEl = this._renderZone(zone);
    if (zoneEl) wrap.appendChild(zoneEl);
    wrap.appendChild(this._renderPendingList(zone));
    /* Abbrechen links, Übernehmen rechts: unten, weil das am Handy die Daumenzone ist.
       Die beiden tun bewusst Verschiedenes — „Übernehmen" schreibt die Vormerkung in den
       Warenkorb, „Abbrechen" verwirft sie. Der Kunde ist danach noch nicht fertig, er
       landet wieder in der Blockübersicht und kann weiter wählen. */
    var actions = document.createElement('div');
    actions.className = 'seatplan-mobile-detail-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Abbrechen';
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-sm';
    confirmBtn.textContent = 'Übernehmen';
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    wrap.appendChild(actions);
    // Öffnet groß in einem separaten Overlay statt im kompakten Inline-Bereich, sofern
    // die Seite eines mitgegeben hat (Dauerkarte) — sonst Fallback: inline wie zuvor.
    var target = this.detailRootEl || this.root;
    target.innerHTML = '';
    target.appendChild(wrap);
    if (this.detailBackdropEl) {
      this.detailBackdropEl.classList.add('open');
      // Solange das Overlay offen ist, darf die Seite DAHINTER nicht mitscrollen:
      // passt der Sitzplan komplett in die Box, gibt es darin nichts zu scrollen und
      // das Rad-Delta landete bisher am Body — es sah aus, als würde sich "das Bild
      // dahinter" verschieben statt der Sitzplan.
      document.documentElement.classList.add('seatplan-detail-open');
    }
    if (zoneEl) {
      this._fixupRowWidths(zoneEl, zone);
      this._fitZoneScale(zoneEl);
    }
    if (window.lucide) window.lucide.createIcons();
    header.querySelectorAll('.seatplan-mobile-back').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = self._neighbourZone(parseInt(btn.dataset.zoneStep, 10));
        var parts = splitZoneKey(key);
        self.mobileZoneId = parts.zoneId;
        self.mobileCategory = parts.category;
        self._render();
      });
    });
    cancelBtn.addEventListener('click', function () {
      self.pendingSeats = null;
      self.mobileZoneId = null;
      self.mobileCategory = null;
      self._render();
    });
    confirmBtn.addEventListener('click', function () {
      self.selected = self.pendingSeats;
      self.pendingSeats = null;
      self.mobileZoneId = null;
      self.mobileCategory = null;
      self._render(); // _renderMobileOverview() ruft _renderCart() bereits selbst auf
    });
    this._renderCart();
  };

  /* Reihen mit data-match-first (s. _renderZone) werden auf die tatsächliche,
     gerenderte Breite von Reihe 1 gestreckt/gestaucht (justify-content:space-between
     verteilt die Sitze dafür neu) — Messung erst möglich, wenn die Zone im echten DOM
     hängt, deshalb ein separater Schritt statt Teil von _renderZone selbst. */
  /* segment_gap_seats (s. gen_seatplan.py mkrow()): fügt an einer Segmentgrenze eine
     echte, in Sitzbreiten-Einheiten skalierende Lücke von N Sitzen ein — unabhängig
     vom Zonen-Layout (alt align_edge/segment_align ODER neu "anchored"). Ersetzt die
     sonst an jeder Segmentgrenze greifende kleine, NICHT skalierende 10px-Dekorlücke
     (s. _renderZone, inline `btn.style.marginLeft='10px'`), die ohne dieses Feld die
     einzige Lücke wäre. Muss VOR jeder anderen Positionierung laufen (ganz am Anfang
     von _fixupRowWidths), damit nachfolgende Live-Messungen (z.B. segment_align,
     _applyAnchoredLayout) die bereits korrekte, breitere Lücke sehen. */
  SeatPicker.prototype._applySegmentGapSeats = function (zoneEl, zone) {
    var rowsByNumber = {};
    zone.rows.forEach(function (row) { rowsByNumber[String(row.row_number)] = row; });
    var rowEls = zoneEl.querySelectorAll('.seatplan-row-line');
    var sampleSeat = zoneEl.querySelector('.seatplan-seat');
    if (!rowEls.length || !sampleSeat) return;
    var flexGapPx = parseFloat(getComputedStyle(rowEls[0]).gap) || 0;
    var unitPx = sampleSeat.getBoundingClientRect().width + flexGapPx;
    rowEls.forEach(function (rowEl) {
      var row = rowsByNumber[rowEl.dataset.rowNumber];
      if (!row) return;
      if (row.segment_gap_seats) {
        var breaks = row.segment_breaks || [];
        var seatEls = Array.from(rowEl.querySelectorAll('.seatplan-seat'));
        // segIdxStr aufsteigend abarbeiten und dabei einen Suchcursor (searchFrom)
        // NUR vorwärts bewegen: renumber_seats kann dazu führen, dass eine finale
        // Sitznummer INNERHALB derselben Reihe mehrfach vorkommt (z.B. Block F Reihe 6 —
        // die 5 unveränderten Rollstuhlplätze 1-5 UND die umbenannten Normalsitze 1-10
        // teilen sich die Nummern 1-5). Segmentgrenzen liegen aber immer streng in
        // DOM-Reihenfolge hintereinander, deshalb liefert "ab der zuletzt gefundenen
        // Position weitersuchen" garantiert den richtigen (nächsten) Treffer statt
        // immer auf den ERSTEN Sitz mit passender Nummer zurückzuspringen.
        var searchFrom = 0;
        Object.keys(row.segment_gap_seats).map(Number).sort(function (a, b) { return a - b; }).forEach(function (idx) {
          var breakSeatNum = breaks[idx - 1];
          if (breakSeatNum === undefined) return;
          var foundAt = -1;
          for (var i = searchFrom; i < seatEls.length; i++) {
            if (seatEls[i].dataset.seatNumber === String(breakSeatNum)) { foundAt = i; break; }
          }
          if (foundAt === -1) return;
          var seatEl = seatEls[foundAt];
          searchFrom = foundAt + 1;
          var gapPx = row.segment_gap_seats[idx] * unitPx;
          seatEl.style.marginLeft = gapPx + 'px';
          // Stabile Basis für segmentPass (s. dort): falls ein Segment VOR dem Anker
          // einer anderen Reihe zusätzlich genau auf DIESEM Sitz landet (gapSeatFor),
          // muss dessen Verschiebung additiv auf diese ECHTE Lücke draufkommen, nicht
          // auf den aktuellen (ggf. schon einmal addierten) Style-Wert — sonst zählt ein
          // zweiter segmentPass()-Durchlauf denselben Betrag doppelt.
          seatEl.dataset.gapBasePx = gapPx;
        });
      }
      // trailing_gap_units (s. gen_seatplan.py mkrow()): Reihen, die durch
      // segment_gap_seats insgesamt weniger Einheiten breit sind als andere Reihen der
      // Zone (z.B. Rollstuhlplätze mit echten Zwischenräumen statt durchgehender
      // Sitze), bekommen hier zusätzlichen Abstand VOR der rechten Reihennummer, damit
      // diese trotzdem auf einer Linie mit den anderen Reihennummern bleibt.
      if (row.trailing_gap_units) {
        var labels = rowEl.querySelectorAll('.seatplan-row-num');
        var trailingLabel = labels[labels.length - 1];
        if (trailingLabel) trailingLabel.style.marginLeft = (row.trailing_gap_units * unitPx) + 'px';
      }
    });
  };

  SeatPicker.prototype._fixupRowWidths = function (zoneEl, zone) {
    // segment_gap_seats gilt GENERISCH für jedes Zonen-Layout (auch das alte
    // align_edge/segment_align-System, z.B. Block C) — deshalb ganz vorn, vor der
    // Weiche unten, ausgeführt.
    this._applySegmentGapSeats(zoneEl, zone);
    // Zonen mit "layout":"anchored" (bisher nur Block A) brauchen keine Laufzeit-Messung
    // à la align_target_seat/segment_align: jeder Sitz trägt seine absolute Position
    // (x_units, s. gen_seatplan.py) schon in den Daten, relativ zu EINEM festen Anker
    // der ganzen Zone. S. _applyAnchoredLayout für die Umsetzung.
    if (zone && zone.layout === 'anchored') {
      this._applyAnchoredLayout(zoneEl, zone);
      return;
    }
    var rows = zoneEl.querySelectorAll('.seatplan-row-line');
    if (!rows.length) return;
    var targetWidth = rows[0].getBoundingClientRect().width;
    zoneEl.querySelectorAll('.seatplan-row-line--match-first').forEach(function (row) {
      row.style.width = targetWidth + 'px';
      row.style.justifyContent = 'space-between';
    });

    // Hintere Reihen mit data-align-target-seat (s. _renderZone) so verschieben, dass
    // GENAU dieser eine Sitz auf derselben Höhe landet wie der Bezugssitz der mit
    // seatplan-row-line--align-reference markierten Reihe — statt Sitzanzahl ×
    // Rasterbreite anzunehmen, was Segment-Lücken innerhalb der Reihe
    // (segment_breaks) verfälschen würden.
    // Welche Kante die Blockseite ausrichtet, steht als align_edge in den Zonendaten:
    // "trailing" (A/B/F) = rechte Kante, Bezug ist der LETZTE Sitz der Bezugsreihe;
    // "leading" (C/D/E) = linke Kante, Bezug ist der ERSTE Sitz. Beispiel Block D:
    // Reihen 6-10 linksbündig, Sitz 3 der Reihen 11-13 und Sitz 6 der Reihe 14 liegen
    // dann genau über Sitz 1 der Reihe 6.
    var leading = isLeadingEdge(zone);
    var referenceRow = zoneEl.querySelector('.seatplan-row-line--align-reference');
    var referenceSeats = referenceRow ? referenceRow.querySelectorAll('.seatplan-seat') : null;
    var referenceSeat = referenceSeats && referenceSeats.length
      ? referenceSeats[leading ? 0 : referenceSeats.length - 1]
      : null;
    if (referenceSeat) {
      // Gemessen wird der Abstand des Sitzes zur EIGENEN Reihenkante, nicht seine
      // absolute Position: die negativen Margins unten vergrößern die fit-content-
      // Breite des Rasters, wodurch sich der (zentrierte) Block als Ganzes verschiebt
      // — absolute Koordinaten würden dadurch schon während der Schleife veralten.
      // Reihenintern gemessene Abstände sind davon unabhängig, und da alle Reihen an
      // derselben Kante hängen, deckt gleicher Abstand auch gleiche Position.
      var refRowRect = referenceRow.getBoundingClientRect();
      var refSeatRect = referenceSeat.getBoundingClientRect();
      var refOffset = leading ? (refSeatRect.left - refRowRect.left) : (refRowRect.right - refSeatRect.right);

      function seatIn(row, num) {
        return Array.from(row.querySelectorAll('.seatplan-seat')).find(function (s) {
          return s.dataset.seatNumber === String(num);
        });
      }
      // Die Verschiebungen werden erst gesammelt und dann gemeinsam so normalisiert,
      // dass die kleinste 0 ist (ALLE Reihen um denselben Betrag mitverschoben — die
      // Ausrichtung untereinander bleibt dadurch erhalten, s.u. warum das für JEDE
      // Reihe gelten muss, nicht nur die Fluchtpunkt-Reihen). Grund: eine NEGATIVE
      // Margin lässt die Reihe über die Containerkante hinausragen, und Überlauf nach
      // links zählt nicht in scrollWidth — die automatische Einpassung
      // (_fitZoneScale) würde ihn übersehen und Sitz 1 abschneiden.
      //
      // WICHTIG (live kaputt gefunden und zurückgerollt): ein früherer Versuch gab
      // Reihen OHNE eigenes align_target_seat pauschal v=0 statt des gemeinsamen
      // Shifts, um ihre Reihennummern optisch anzugleichen — das verschob dabei aber
      // auch ihre SITZE und riss echte Fluchtpunkte auseinander (Block C Reihe 1-9
      // saß danach nicht mehr auf einer Linie mit Reihe 10-12; Block D Reihe 7-10
      // nicht mehr mit Reihe 6). row-level marginLeft/marginRight bewegt IMMER Label
      // UND Sitze gemeinsam (beide sind Flex-Geschwister derselben Reihe) — ALLE
      // Reihen bekommen deshalb hier denselben gemeinsamen Shift, nicht nur die mit
      // eigenem align_target_seat.
      function anchorAll() {
        var margins = [];
        zoneEl.querySelectorAll('[data-align-target-seat]').forEach(function (row) {
          var targetSeat = seatIn(row, row.dataset.alignTargetSeat);
          if (!targetSeat) return;
          var rowRect = row.getBoundingClientRect();
          var seatRect = targetSeat.getBoundingClientRect();
          var targetOffset = leading ? (seatRect.left - rowRect.left) : (rowRect.right - seatRect.right);
          margins.push({ row: row, value: -(targetOffset - refOffset) });
        });
        var min = 0;
        margins.forEach(function (m) { if (m.value < min) min = m.value; });
        var byRow = new Map();
        margins.forEach(function (m) { byRow.set(m.row, m.value); });
        zoneEl.querySelectorAll('.seatplan-row-line').forEach(function (row) {
          var v = (byRow.get(row) || 0) - min;
          if (leading) row.style.marginLeft = v + 'px';
          else row.style.marginRight = v + 'px';
        });
      }
      anchorAll();

      // Segmente innerhalb einer Reihe einzeln ausrichten (segment_align in den
      // Zonendaten). Bei Block D sollen die Randsegmente der Reihen 11-13 nicht nur
      // "irgendwie" neben dem Mittelsegment liegen, sondern mit bestimmten Sitzen der
      // Reihe 14 fluchten (Sitz 1 über Sitz 1, Sitz 23 über Sitz 26). Der feste
      // 10px-Abstand aus segment_breaks kann das nicht leisten — die Lücken werden
      // hier aus den Zielabständen berechnet.
      // Ablauf je Reihe: Lücken auf 0, natürliche Segmentbreiten messen, Lücken aus
      // (Zielabstand − natürliche Breite) setzen, danach die Reihe neu ankern (die
      // geänderten Lücken haben den Ankersitz mitverschoben).
      //
      // Gilt für linksbündige UND rechtsbündige Blöcke: gemessen werden ausschließlich
      // Abstände innerhalb einer Reihe, relativ zu deren eigenem Ankersitz. Diese
      // Differenzen sind vorzeichenbehaftet und damit richtungsneutral — an welcher
      // Kante die Reihe hängt, entscheidet erst das abschließende anchorAll(). Der
      // Abgleich war ursprünglich auf leading beschränkt, weil nur Block D und E ihn
      // brauchten; Block F ist trailing und wurde dadurch stillschweigend übersprungen.
      {
        // Alle Abstände werden als Differenz ZWEIER SITZE DERSELBEN REIHE gemessen.
        // Da jede Reihe über ihren Ankersitz auf derselben Bezugslinie hängt, sind
        // solche reiheninternen Differenzen direkt vergleichbar — und anders als
        // absolute Koordinaten immun dagegen, dass sich der (zentrierte) Block durch
        // die geänderten Lücken als Ganzes verschiebt.
        function deltaToAnchor(rowEl, seatNum) {
          var anchor = seatIn(rowEl, rowEl.dataset.alignTargetSeat);
          var s = seatIn(rowEl, seatNum);
          if (!anchor || !s) return null;
          return s.getBoundingClientRect().left - anchor.getBoundingClientRect().left;
        }
        // Von innen nach außen (Reihen nahe dem Spielfeld zuerst), weil sich die
        // Bezüge dorthin richten: in Block E hängt Reihe 13 an Reihe 12, Reihe 12 an
        // Reihe 11. Zusätzlich läuft der Durchgang zweimal, damit auch Bezüge über
        // mehrere Stufen sicher auf den Endstand treffen.
        var segRows = Array.from(zoneEl.querySelectorAll('[data-segment-align]')).reverse();
        function segmentPass() {
        segRows.forEach(function (row) {
          var spec;
          try { spec = JSON.parse(row.dataset.segmentAlign); } catch (e) { return; }
          var anchorNum = row.dataset.alignTargetSeat;
          var anchorSeat = seatIn(row, anchorNum);
          if (!anchorSeat) return;

          // Segmentanfänge der Reihe: Sitz 1 plus jede Segmentgrenze. Eine Lücke, die
          // ein Segment VOR dem Anker vom Rest abrücken soll, muss am Anfang des
          // FOLGENDEN Segments sitzen — nicht am Ankersitz. In Block D fällt beides
          // zusammen (Anker = Sitz 3 = Anfang des Mittelsegments), in Block F nicht:
          // dort ist der Anker Sitz 22, also das ENDE des Mittelsegments. Eine Lücke
          // dort schiebt nur 22-24 nach rechts und zieht beim Ankern die Sitze 3-21
          // nach links.
          var breaks = [];
          try { breaks = JSON.parse(row.dataset.segmentBreaks || '[]'); } catch (e) { breaks = []; }
          var segStarts = [1].concat(breaks).sort(function (a, b) { return a - b; });
          function gapSeatFor(segNumInt) {
            var next = segStarts.filter(function (s) { return s > segNumInt; })[0];
            return next === undefined ? anchorNum : String(next);
          }

          // Soll-Abstand jedes Segmentanfangs zur Bezugslinie, aus der Bezugsreihe
          var want = {};
          Object.keys(spec).forEach(function (segNum) {
            var cfg = spec[segNum];
            var refRowEl = zoneEl.querySelector('.seatplan-row-line[data-row-number="' + cfg.row + '"]');
            if (!refRowEl) return;
            var d = deltaToAnchor(refRowEl, cfg.seat);
            if (d !== null) want[segNum] = d;
          });

          // Segmentanfänge, die von segment_gap_seats verwaltet werden (s. gen_seatplan.py
          // mkrow(), _applySegmentGapSeats), dürfen HIER weder genullt noch neu berechnet
          // werden — sonst überschreibt dieser Pass ihre bereits korrekt gesetzte, echte
          // Lücke wieder mit 0 (segStarts enthält sie trotzdem, weil sie strukturell
          // Segmentanfänge sind). Live gefunden bei Block F Reihe 14: Lücken bei Sitz 8/22
          // verschwanden wieder, sobald die Reihe zusätzlich einen segment_align-Eintrag
          // bekam.
          var rowData = zone.rows.find(function (r) { return String(r.row_number) === row.dataset.rowNumber; });
          var gapProtected = {};
          if (rowData && rowData.segment_gap_seats) {
            Object.keys(rowData.segment_gap_seats).forEach(function (segIdxStr) {
              var idx = parseInt(segIdxStr, 10);
              if (segStarts[idx] !== undefined) gapProtected[String(segStarts[idx])] = true;
            });
          }
          // Lücken auf 0 und natürliche Abstände zum Ankersitz messen. Genullt werden
          // muss jeder Sitz, der später eine Lücke tragen kann — also auch die
          // Segmentanfänge, die aus segment_breaks kommen (die tragen aus dem Rendern
          // noch die feste 10px-Lücke) — AUSSER den oben geschützten.
          var starts = Object.keys(spec).concat([anchorNum]).concat(segStarts.map(String));
          starts.forEach(function (n) { if (gapProtected[n]) return; var s = seatIn(row, n); if (s) s.style.marginLeft = '0px'; });
          var nat = {};
          starts.forEach(function (n) { nat[n] = deltaToAnchor(row, n); });

          // Aufsteigend abarbeiten und die schon gesetzten Lücken mitzählen: eine Lücke
          // verschiebt ALLE folgenden Sitze der Reihe mit. Ohne diesen Abzug landete in
          // Block E Sitz 11 der Reihe 14 um genau die Lücke bei Sitz 8 zu weit rechts.
          var applied = 0;
          Object.keys(spec).map(Number).sort(function (a, b) { return a - b; }).forEach(function (segNumInt) {
            var segNum = String(segNumInt);
            if (want[segNum] === undefined || nat[segNum] === null) return;
            var seatEl = seatIn(row, segNum);
            if (!seatEl) return;
            // Lücke = fehlender Abstand. Vor dem Anker sitzt die Lücke am Ankersitz
            // (dort beginnt das Mittelsegment), nach dem Anker am Segmentanfang selbst.
            var afterAnchor = segNumInt > parseInt(anchorNum, 10);
            var missing = want[segNum] - nat[segNum];
            if (afterAnchor) {
              var gap = Math.max(0, missing - applied);
              seatEl.style.marginLeft = gap + 'px';
              applied += gap;
            } else {
              var gapSeatNum = gapSeatFor(segNumInt);
              var gapSeat = seatIn(row, gapSeatNum);
              if (gapSeat) {
                // Ein von segment_gap_seats verwalteter Sitz (s.o.) trägt hier schon
                // seine echte, feste Lücke (z.B. Block F Reihe 14 Sitz 8) — die
                // zusätzlich hier berechnete Verschiebung (für ein Segment VOR dem
                // Anker, z.B. Sitz 5) kommt ADDITIV oben drauf, statt sie zu
                // überschreiben, sonst verschwindet entweder die feste Lücke (bei
                // Overwrite) oder die Fluchtpunkt-Verschiebung (beim einfachen
                // Überspringen) — live an genau diesem Fall gefunden.
                var extra = Math.max(0, -missing);
                if (gapProtected[gapSeatNum]) {
                  var base = parseFloat(gapSeat.dataset.gapBasePx) || 0;
                  gapSeat.style.marginLeft = (base + extra) + 'px';
                } else {
                  gapSeat.style.marginLeft = extra + 'px';
                }
              }
            }
          });
        });
        }
        segmentPass();
        segmentPass();
        // Die geänderten Lücken haben die Ankersitze mitverschoben — neu ankern.
        anchorAll();
      }
    }
  };

  /* Positioniert alle Sitze einer Zone mit "layout":"anchored" (bisher nur Block A)
     direkt aus den Daten, statt Reihen zur Laufzeit gegeneinander zu vermessen wie
     _fixupRowWidths es oben für die übrigen Blöcke tut. Jeder Sitz trägt bereits eine
     absolute Position in Sitzbreiten-Einheiten (seat.x_units, s. gen_seatplan.py),
     relativ zu EINEM festen Anker der ganzen Zone (Block A: Grenze Sitz 10/11 der Reihe
     6 = Einheit 0) — nicht mehr relativ zu einer anderen Reihe. Das schließt beide
     bisherigen Bugklassen strukturell aus: es gibt keine Kette von Reihen-Verweisen
     mehr, die ins Leere laufen kann (s. Block-B-Bug), und keine Laufzeitmessung, die
     von CSS-Eigenheiten wie negativen Margins ausgetrickst werden kann (s.
     _fitZoneScale-Bug) — die einzige Messung hier ist die Breite EINES Sitzes plus
     Reihenabstand, um Einheiten in Pixel umzurechnen. */
  SeatPicker.prototype._applyAnchoredLayout = function (zoneEl, zone) {
    var rowEls = zoneEl.querySelectorAll('.seatplan-row-line');
    if (!rowEls.length) return;

    var rowsByNumber = {};
    zone.rows.forEach(function (row) { rowsByNumber[String(row.row_number)] = row; });

    var flexGapPx = parseFloat(getComputedStyle(rowEls[0]).gap) || 0;
    var sampleSeat = zoneEl.querySelector('.seatplan-seat');
    if (!sampleSeat) return;
    // Sitzbreite + Reihenabstand ergeben zusammen EINE Einheit — je nach Ansicht
    // (winzige Übersichtskachel vs. große Detailansicht) unterschiedlich groß, deshalb
    // live gemessen statt hart codiert (s. CSS .seatplan-seat/.seatplan-row-line).
    var unitPx = sampleSeat.getBoundingClientRect().width + flexGapPx;
    if (!unitPx) return;

    var allUnits = [];
    zone.rows.forEach(function (row) {
      (row.seats || []).forEach(function (s) {
        if (typeof s.x_units === 'number') allUnits.push(s.x_units);
      });
      if (typeof row.x_offset === 'number') allUnits.push(row.x_offset);
    });
    if (!allUnits.length) return;
    var zoneMinUnits = Math.min.apply(null, allUnits);

    // ERST alle Reihen mit festem Sitzraster (Pro-Sitz-x_units) fertig positionieren —
    // darunter auch die Referenzreihe (Reihe 1) für die match_first_row_width-Reihen
    // weiter unten. Reihenfolge ist hier wichtig: würde man Reihe 1s gerenderte Breite
    // VOR dieser Schleife messen, wäre ein eigener Fluchtpunkt-Gang der Referenzreihe
    // (z.B. Block B Reihe 1, Segment-Shift am Gang zwischen Platz 7/8) noch nicht
    // gesetzt — die Messung bekäme dann fälschlich nur die anfängliche kleine
    // Render-Lücke (10px) statt der finalen, in Einheiten skalierten Lücke zu sehen,
    // und alle daran gestreckten Reihen (6-10) blieben zu schmal.
    rowEls.forEach(function (rowEl) {
      var row = rowsByNumber[rowEl.dataset.rowNumber];
      if (!row || row.match_first_row_width) return;
      var seatEls = rowEl.querySelectorAll('.seatplan-seat');
      var prevUnits = null;
      seatEls.forEach(function (seatEl, i) {
        var seatData = row.seats[i];
        if (!seatData || typeof seatData.x_units !== 'number') return;
        var units = seatData.x_units;
        var margin;
        if (prevUnits === null) {
          // Erster Sitz der Reihe: Abstand zur linken Zonen-Kante (zoneMinUnits).
          margin = (units - zoneMinUnits) * unitPx;
        } else {
          // Jeder weitere Sitz: normaler Sitzabstand (1 Einheit) ist schon Teil des
          // Flex-Flusses — nur wenn zwischen zwei Sitzen MEHR als 1 Einheit liegt (Gang,
          // oder ein per segment_shifts verschobenes Segment), kommt die Differenz als
          // Zusatz-Margin oben drauf.
          var gapUnits = Math.max(0, units - prevUnits - 1);
          margin = gapUnits * unitPx;
          // Ein Gang OHNE eigenen segment_shift (gapUnits genau 0) bekommt trotzdem die
          // klassische kleine, NICHT mitskalierende Gang-Lücke — sonst verschwindet der
          // sichtbare Gang komplett, sobald keine Fluchtpunkt-Verschiebung nötig ist (z.B.
          // Block B Reihe 1-3, deren Segmente einheitenmäßig lückenlos aneinanderstoßen).
          // Bei einem echten Fluchtpunkt-Shift (gapUnits > 0) ist die Lücke bereits exakt
          // berechnet — hier NICHT nochmal 10px addieren, sonst stimmt die Flucht nicht mehr.
          // Sonderfall: gapUnits kann auch bei einem EXPLIZITEN Shift zufällig genau 0
          // ergeben (z.B. Block B Reihe 11, Segment 0+1 beide um denselben Betrag
          // verschoben, damit sie als ein Block zusammenbleiben) — row.explicit_shift_
          // segments (s. gen_seatplan.py) verrät, ob für DIESES Segment bewusst ein Shift
          // angegeben wurde; nur wenn nicht, greift die Dekor-Lücke.
          var breakIdx = row.segment_breaks ? row.segment_breaks.indexOf(parseInt(seatData.seat_number, 10)) : -1;
          var isSegStart = breakIdx !== -1;
          var segIndex = breakIdx + 1; // Segment 0 beginnt vor jedem Break, s. Python seg_of
          var hasExplicitShift = row.explicit_shift_segments && row.explicit_shift_segments.indexOf(segIndex) !== -1;
          if (isSegStart && gapUnits === 0 && !hasExplicitShift) margin += 10;
        }
        seatEl.style.marginLeft = margin + 'px';
        prevUnits = units;
      });
    });

    // JETZT erst match_first_row_width-Reihen (z.B. Block B Reihe 6-10) — kein festes
    // Sitzraster, sie werden auf die tatsächliche gerenderte SITZ-Breite von Reihe 1
    // gestreckt (s. gen_seatplan.py mkrow()). WICHTIG: NICHT rowEl.getBoundingClientRect()
    // der ganzen Zeile nehmen — die enthält auch das führende Positionierungs-Margin von
    // Sitz 1 (verschiebt die Reihe relativ zur Zonen-Kante, s. oben), das keine echte
    // Sitzbreite ist und je nach Zonen-Layout unterschiedlich groß sein kann. Gemessen
    // wird stattdessen NUR die Spanne vom ersten bis zum letzten Sitz (Label-Overhead
    // fällt damit komplett weg, keine gesonderte Abzugsrechnung mehr nötig).
    var row0Seats = rowEls[0].querySelectorAll('.seatplan-seat');
    if (!row0Seats.length) return;
    var targetWidth = row0Seats[row0Seats.length - 1].getBoundingClientRect().right - row0Seats[0].getBoundingClientRect().left;
    zoneEl.querySelectorAll('.seatplan-row-line--match-first').forEach(function (rowEl) {
      var row = rowsByNumber[rowEl.dataset.rowNumber];
      // Reihen mit live_fit/live_fit_gap (z.B. Block B Reihe 10) bekommen ihre
      // Sitzpositionen NICHT über den Wrapper-Streck-Mechanismus, sondern direkt per
      // Live-Messung (s.u., runLiveFit/runLiveFitGap) — kein Wrapper-Div, keine
      // space-between-Streckung, sonst würde die Live-Messung gegen die falschen
      // (Wrapper-relativen statt Flex-Geschwister-) Margins arbeiten.
      if (row && (row.live_fit || row.live_fit_gap)) return;
      var breaks = (row && row.segment_breaks) || [];
      // Jede match_first_row_width-Reihe bekommt ihre Sitze in einem inneren Wrapper-Div
      // statt direkt als Flex-Kind von rowEl — nur so lässt sich die Sitz-Breite EXAKT
      // auf Reihe 1 abstimmen, ohne die Reihennummern-Labels (auch Flex-Kinder von rowEl,
      // s. _renderZone) versehentlich mitzustrecken. Ohne Segmentgrenzen (segment_breaks
      // leer) ist das genau EIN Wrapper über die volle Breite — deckt damit auch die
      // einfachen Fälle (z.B. Block B Reihe 6-9) mit demselben Code ab. Mehrere Segmente
      // (z.B. Reihe 10, [8,8]) bekommen zwischen sich die normale kleine, dekorative
      // Gang-Lücke (flexGapPx), keine eigene skalierende Lücke.
      var seatEls = Array.from(rowEl.querySelectorAll('.seatplan-seat'));
      var segStarts = [1].concat(breaks);
      var segEnds = breaks.concat([seatEls.length + 1]);
      var segCounts = segStarts.map(function (s, i) { return segEnds[i] - s; });
      var totalCount = segCounts.reduce(function (a, b) { return a + b; }, 0);
      // targetWidth ist bereits die reine Sitz-Spanne von Reihe 1 (s.o.) — kein
      // Label-Overhead abzuziehen.
      var seatIdx = 0;
      var firstWrapper = null;
      segCounts.forEach(function (count, i) {
        var wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.width = (targetWidth * count / totalCount) + 'px';
        if (i === 0) firstWrapper = wrapper;
        var firstSeat = seatEls[seatIdx];
        firstSeat.parentNode.insertBefore(wrapper, firstSeat);
        for (var k = 0; k < count; k++) { wrapper.appendChild(seatEls[seatIdx]); seatIdx++; }
      });
      // Positionierung aus x_offset kommt auf den ERSTEN Sitz-Wrapper, NICHT auf rowEl
      // selbst — sonst würde sich die Reihennummer (ebenfalls Flex-Kind von rowEl, s.
      // _renderZone) mitverschieben. Marko: die Reihennummern von 6-10 sollen auf einer
      // Linie mit denen der anderen Reihen bleiben, nur die Sitze selbst wandern.
      if (row && typeof row.x_offset === 'number' && firstWrapper) {
        firstWrapper.style.marginLeft = (row.x_offset - zoneMinUnits) * unitPx + 'px';
      }
    });

    // ZULETZT: live_stretch/live_shift — Segmente, die an Sitzen einer match_first_
    // row_width-Reihe ausgerichtet werden (s. gen_seatplan.py). Solche Zielsitze haben
    // KEINE x_units (kein festes Sitzraster), ihre Position ist erst jetzt, nach dem
    // Rendern, per DOM-Messung bekannt — deshalb ein eigener, expliziter Pass statt
    // reiner Einheiten-Rechnung. live_stretch läuft VOR live_shift: Block B Reihe 12
    // richtet sich an Reihe 11 Sitz 14 aus, der seinerseits erst durch Reihe 11s
    // live_stretch seine finale Position bekommt.
    function findSeatEl(rowNum, seatNum) {
      var rEl = Array.from(rowEls).find(function (r) { return r.dataset.rowNumber === String(rowNum); });
      if (!rEl) return null;
      return Array.from(rEl.querySelectorAll('.seatplan-seat')).find(function (s) {
        return s.dataset.seatNumber === String(seatNum);
      });
    }
    function segSeatNumbers(row, segIdx) {
      var breaks = row.segment_breaks || [];
      var segStarts = [1].concat(breaks);
      var segEnds = breaks.concat([row.seats.length + 1]);
      var nums = [];
      for (var n = segStarts[segIdx]; n < segEnds[segIdx]; n++) nums.push(n);
      return nums;
    }
    function runLiveStretch(fieldName) {
      zone.rows.forEach(function (row) {
        if (!row[fieldName]) return;
        Object.keys(row[fieldName]).forEach(function (segIdxStr) {
          var spec = row[fieldName][segIdxStr];
          var firstTarget = findSeatEl(spec.first.row, spec.first.seat);
          var lastTarget = findSeatEl(spec.last.row, spec.last.seat);
          if (!firstTarget || !lastTarget) return;
          var firstLeft = firstTarget.getBoundingClientRect().left;
          var lastLeft = lastTarget.getBoundingClientRect().left;
          var nums = segSeatNumbers(row, parseInt(segIdxStr, 10));
          var seatEls = nums.map(function (n) { return findSeatEl(row.row_number, n); });
          if (!seatEls.length || seatEls.some(function (e) { return !e; })) return;
          var count = seatEls.length;
          seatEls.forEach(function (seatEl, i) {
            var desiredLeft = count > 1 ? firstLeft + (lastLeft - firstLeft) * (i / (count - 1)) : firstLeft;
            var prevEl = i === 0 ? seatEl.previousElementSibling : seatEls[i - 1];
            var refRight = prevEl ? prevEl.getBoundingClientRect().right : desiredLeft - flexGapPx;
            // KEIN Math.max(0, …) hier: das Ziel-Intervall kann ENGER sein als der normale
            // Sitzabstand (die Zielreihe ist ggf. selbst gestaucht/gestreckt) — die Sitze
            // müssen dann NÄHER zusammenrücken als der normale Flex-Fluss vorsieht, brauchen
            // also ein negatives Margin. Ein Klammern auf 0 hätte genau das verhindert und
            // die Sitze immer weiter nach rechts driften lassen (live gefunden: ein Sitz
            // landete 7px zu weit rechts, weil die nötige Stauchung auf 0 gerundet wurde).
            seatEl.style.marginLeft = (desiredLeft - refRight - flexGapPx) + 'px';
          });
        });
      });
    }
    // live_fit: allgemeinerer Mechanismus als live_stretch — mehrere "Pins" (Sitz N
    // dieser Reihe = live gemessene Position von Sitz M einer anderen Reihe) werden
    // stückweise linear verbunden (Marko, achte Runde für Reihe 10: Sitz 1/6 auf Sitz
    // 3/8 der Reihe 11 gepinnt, Reihe 12 analog mit 3 Pins). extend_forward/
    // reverse_extend setzen die Steigung des jeweils äußersten Pin-Intervalls über
    // dessen Rand hinaus fort (Reihe 10: Sitz 7-8 vorwärts, Sitz 9-15 rückwärts von
    // einem unabhängigen zweiten Anker — reverse_anchor — aus, da Reihe 10 nur EINE
    // durchgehende Sitzteilung hat, aber ZWEI unabhängige, live gemessene Fixpunkte:
    // Sitz 1/6 aus Reihe 11 UND Sitz 16 aus Reihe 9).
    function runLiveFit(fieldName) {
      zone.rows.forEach(function (row) {
        if (!row[fieldName]) return;
        var spec = row[fieldName];
        var desired = {}; // seatNum -> gewünschte absolute left-Position (px)
        var pins = (spec.pins || []).map(function (p) {
          var targetEl = findSeatEl(p.target.row, p.target.seat);
          return targetEl ? { seat: p.seat, left: targetEl.getBoundingClientRect().left } : null;
        });
        if (pins.some(function (p) { return !p; })) return;
        for (var i = 0; i < pins.length - 1; i++) {
          var a = pins[i], b = pins[i + 1];
          var pitch = (b.left - a.left) / (b.seat - a.seat);
          for (var n = a.seat; n <= b.seat; n++) desired[n] = a.left + (n - a.seat) * pitch;
        }
        if (spec.extend_forward && pins.length >= 2) {
          var last = pins[pins.length - 1], prev = pins[pins.length - 2];
          var fPitch = (last.left - prev.left) / (last.seat - prev.seat);
          spec.extend_forward.forEach(function (n) { desired[n] = last.left + (n - last.seat) * fPitch; });
        }
        if (spec.reverse_anchor) {
          var ra = spec.reverse_anchor;
          var raTargetEl = findSeatEl(ra.target.row, ra.target.seat);
          if (raTargetEl && pins.length >= 2) {
            var raLeft = raTargetEl.getBoundingClientRect().left;
            var rPitch = (pins[1].left - pins[0].left) / (pins[1].seat - pins[0].seat);
            desired[ra.seat] = raLeft;
            (spec.reverse_extend || []).forEach(function (n) { desired[n] = raLeft + (n - ra.seat) * rPitch; });
          }
        }
        var nums = Object.keys(desired).map(function (n) { return parseInt(n, 10); }).sort(function (x, y) { return x - y; });
        nums.forEach(function (n) {
          var seatEl = findSeatEl(row.row_number, n);
          if (!seatEl) return;
          // KEIN Filter auf .seatplan-seat: ist Sitz N das erste Kind der Reihe (z.B.
          // Sitz 1 in Reihe 10), ist der direkte Flex-Vorgänger die Reihennummer-Beschriftung
          // (span.seatplan-row-num, s. _renderZone) — genau die zählt für den Flex-Fluss,
          // NICHT übersprungen werden darf sie (Bug gefunden: Sitz 1 landete sonst bei
          // Margin 0 statt an seiner Zielposition, s. Marko — "Platz 1 in Reihe 10 ist
          // nicht mehr an seinem Platz").
          var prevEl = seatEl.previousElementSibling;
          var refRight = prevEl ? prevEl.getBoundingClientRect().right : desired[n] - flexGapPx;
          seatEl.style.marginLeft = (desired[n] - refRight - flexGapPx) + 'px';
        });
      });
    }
    // live_fit_gap: Spezialfall von live_fit für genau ZWEI live gemessene Endpunkte
    // (first/last) MIT einer einzelnen echten Lücke irgendwo dazwischen (gap_before_seat/
    // gap_units) — z.B. Block B Reihe 10: Sitz 1 = Reihe 9 Sitz 1, Sitz 16 = Reihe 9 Sitz
    // 16, 4er-Lücke vor Sitz 9. Gesamtspannweite wird auf (Sitzanzahl-2+gap_units) gleiche
    // Einheiten verteilt (die normale 1-Einheit-Lücke an der Bruchstelle wird durch
    // gap_units ERSETZT, nicht addiert) — seat-picker.js kennt aus gen_seatplan.py nur die
    // Ziel-Sitze, nicht Reihe 9s tatsächliche Breite; die kommt erst hier per Live-Messung.
    function runLiveFitGap(fieldName) {
      zone.rows.forEach(function (row) {
        var spec = row[fieldName];
        if (!spec) return;
        var firstTarget = findSeatEl(spec.first.row, spec.first.seat);
        var lastTarget = findSeatEl(spec.last.row, spec.last.seat);
        if (!firstTarget || !lastTarget) return;
        var firstLeft = firstTarget.getBoundingClientRect().left;
        var lastLeft = lastTarget.getBoundingClientRect().left;
        var count = row.seats.length;
        var gapBefore = spec.gap_before_seat;
        var gapUnits = spec.gap_units;
        var totalUnits = (count - 2) + gapUnits;
        var pitch = (lastLeft - firstLeft) / totalUnits;
        function unitsFromFirst(seatNum) {
          if (seatNum <= gapBefore - 1) return seatNum - 1;
          return (gapBefore - 2 + gapUnits) + (seatNum - gapBefore);
        }
        for (var seatNum = 1; seatNum <= count; seatNum++) {
          var seatEl = findSeatEl(row.row_number, seatNum);
          if (!seatEl) continue;
          var desiredLeft = firstLeft + unitsFromFirst(seatNum) * pitch;
          var prevEl = seatEl.previousElementSibling;
          var refRight = prevEl ? prevEl.getBoundingClientRect().right : desiredLeft - flexGapPx;
          seatEl.style.marginLeft = (desiredLeft - refRight - flexGapPx) + 'px';
        }
      });
    }
    // live_fit_scaled: rescaled Variante von live_fit_gap für MEHRERE, unterschiedlich
    // große Lücken innerhalb einer Spanne (z.B. Block B Reihe 11 Sitz 3-17: die aus
    // früheren Diktat-Runden stammenden relativen Sitzabstände — inkl. der "8 Plätze"-
    // und "treppensepariert"-Lücke — werden PROPORTIONAL auf die neue, live gemessene
    // Gesamtspannweite gestreckt/gestaucht). relative_units ist eine feste, in
    // gen_seatplan.py aus der vorherigen segment_shifts-Struktur errechnete Referenz
    // (keine neue Zahl, nur umgerechnet) — die neuen Anker ändern die GRÖSSE der alten
    // Lücken proportional mit, nicht deren Verhältnis zueinander.
    function runLiveFitScaled(fieldName) {
      // Sitzbreite EINMAL gemessen — für Sitz 2..N wird NICHT mehr per erneutem
      // getBoundingClientRect() am gerade erst modifizierten Vorgänger-Sitz gemessen
      // (das lieferte live nachweislich noch die Position VOR dessen eigenem Margin-
      // Update zurück — Sitz 4 landete dadurch auf Basis von Sitz 3s ALTER statt neuer
      // Position, mit aufschaukelndem Fehler über die ganze Kette). Stattdessen läuft
      // die Kette rein rechnerisch (deriveLeft(n) - deriveLeft(n-1) - Sitzbreite), nur
      // der ALLERERSTE Sitz der Spanne liest noch einmal live seinen (unberührten)
      // Vorgänger, um an die bereits fertig positionierten Sitze davor anzuschließen.
      var seatWidth = zoneEl.querySelector('.seatplan-seat').getBoundingClientRect().width;
      zone.rows.forEach(function (row) {
        var spec = row[fieldName];
        if (!spec) return;
        var firstTarget = findSeatEl(spec.first.row, spec.first.seat);
        var lastTarget = findSeatEl(spec.last.row, spec.last.seat);
        if (!firstTarget || !lastTarget) return;
        var firstLeft = firstTarget.getBoundingClientRect().left;
        var lastLeft = lastTarget.getBoundingClientRect().left;
        var rel = spec.relative_units;
        var firstUnits = rel[spec.anchor_first_seat];
        var lastUnits = rel[spec.anchor_last_seat];
        var pitch = (lastLeft - firstLeft) / (lastUnits - firstUnits);
        var nums = Object.keys(rel).map(function (s) { return parseInt(s, 10); }).sort(function (a, b) { return a - b; });
        var prevDesired = null;
        nums.forEach(function (n, i) {
          var seatEl = findSeatEl(row.row_number, n);
          if (!seatEl) return;
          var desiredLeft = firstLeft + (rel[String(n)] - firstUnits) * pitch;
          var refRight;
          if (i === 0) {
            var prevEl = seatEl.previousElementSibling;
            refRight = prevEl ? prevEl.getBoundingClientRect().right : desiredLeft - flexGapPx;
          } else {
            refRight = prevDesired + seatWidth;
          }
          seatEl.style.marginLeft = (desiredLeft - refRight - flexGapPx) + 'px';
          prevDesired = desiredLeft;
        });
      });
    }
    runLiveFit('live_fit');
    runLiveFitGap('live_fit_gap');
    runLiveStretch('live_stretch');
    runLiveFitScaled('live_fit_scaled');
    zone.rows.forEach(function (row) {
      if (!row.live_shift) return;
      Object.keys(row.live_shift).forEach(function (segIdxStr) {
        var spec = row.live_shift[segIdxStr];
        // via_seat: optionaler zweiter Sitz, dessen AKTUELLE Position (statt der des
        // Ankers selbst) über den Zielabstand entscheidet — z.B. Block B Reihe 12:
        // Sitz 11 (Anker, dessen Margin gesetzt wird, verschiebt per Flex-Fluss ALLES
        // danach mit) soll so verschoben werden, dass Sitz 20 (via_seat) exakt auf sein
        // Ziel trifft — nicht Sitz 11 selbst. Ohne via_seat identisch zum bisherigen
        // Verhalten (Anker IST der Referenzsitz).
        var anchorEl = findSeatEl(row.row_number, spec.anchor_seat);
        var viaEl = findSeatEl(row.row_number, spec.via_seat || spec.anchor_seat);
        var targetEl = findSeatEl(spec.target_row, spec.target_seat);
        if (!anchorEl || !viaEl || !targetEl) return;
        var delta = targetEl.getBoundingClientRect().left - viaEl.getBoundingClientRect().left;
        var currentMargin = parseFloat(anchorEl.style.marginLeft) || 0;
        // Kein Math.max(0, …): ein negativer Gesamtversatz ist ebenso legitim wie bei
        // live_stretch (s.o.) — der Zielsitz kann links vom Anker liegen.
        anchorEl.style.marginLeft = (currentMargin + delta) + 'px';
      });
    });
    // live_stretch2: identischer Mechanismus wie live_stretch, aber erst NACH live_shift
    // ausgeführt — für Ziele, die selbst erst durch live_shift ihre finale Position
    // bekommen (s. gen_seatplan.py, Block B Reihe 11 Segment 3).
    runLiveStretch('live_stretch2');
  };

  /* Passt den kompletten Blockplan per Skalierung so ein, dass er komplett ohne
     Scrollen in die graue Box passt — Format egal (Hochkant/Querformat), da Breite
     UND Höhe der Box gemessen werden statt eine feste Sitzgröße anzunehmen. Ein
     scaleWrap um den gridWrap bekommt die schon herunterskalierte Zielgröße als
     width/height, damit die Box exakt so viel Platz reserviert wie nach dem Zoom
     tatsächlich gebraucht wird (reines CSS-transform würde stattdessen den alten,
     unskalierten Platzbedarf behalten und unnötigen Scroll-Leerraum erzeugen).
     Die +/- Buttons erlauben zusätzlichen manuellen Zoom oben auf die Einpassung,
     falls die automatische Berechnung auf einem Gerät nicht exakt passt. */
  SeatPicker.prototype._fitZoneScale = function (zoneEl) {
    var box = zoneEl; // zoneEl ist bereits .seatplan-block (Rückgabewert von _renderZone)
    var scaleWrap = box.querySelector('.seatplan-scale-wrap');
    var gridWrap = box.querySelector('.seatplan-grid-wrap');
    if (!scaleWrap || !gridWrap) return;

    scaleWrap.style.width = '';
    scaleWrap.style.height = '';
    gridWrap.style.transform = 'none';
    // scrollWidth/-Height zaehlen Ueberlauf durch NEGATIVE Margins strukturell nicht mit
    // (bekannter CSS-Fallstrick, s. reference_sitzplan_riethsporthalle-Memory) — die
    // segment_align-Fluchtpunkte (s. _fixupRowWidths) koennen genau das erzeugen, wenn
    // ein vorderes Segment weiter nach aussen geschoben wird als die Reihe von sich aus
    // breit ist. Deshalb zusaetzlich die tatsaechlichen Kindposition-Extremwerte messen
    // und den groesseren Wert nehmen, statt scrollWidth blind zu vertrauen.
    var gwRect = gridWrap.getBoundingClientRect();
    var minLeft = gwRect.left, maxRight = gwRect.right, minTop = gwRect.top, maxBottom = gwRect.bottom;
    gridWrap.querySelectorAll('.seatplan-row-line').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      if (r.left < minLeft) minLeft = r.left;
      if (r.right > maxRight) maxRight = r.right;
      if (r.top < minTop) minTop = r.top;
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    });
    var naturalWidth = Math.max(gridWrap.scrollWidth, maxRight - minLeft);
    var naturalHeight = Math.max(gridWrap.scrollHeight, maxBottom - minTop);
    var availWidth = box.clientWidth;
    var availHeight = box.clientHeight;
    if (!naturalWidth || !naturalHeight || !availWidth || !availHeight) return;

    // Untere Grenze, damit Sitze auch bei sehr breiten Reihen (z. B. Block B, Reihe 12
    // mit 28 Sitzen) auf einem schmalen Handy-Format noch lesbar und die "ausgewählt"-
    // Färbung erkennbar bleibt — geht das nicht ohne Rest, überläuft die Box seitlich
    // und ist per overflow:auto (s. seat-picker.css) horizontal scrollbar statt
    // unbrauchbar winzig zu werden.
    var MIN_READABLE_SCALE = 0.5;
    var autoFit = Math.max(MIN_READABLE_SCALE, Math.min(1, availWidth / naturalWidth, availHeight / naturalHeight));
    var zoom = 1;
    var minZoom = 0.5, maxZoom = 2.5;

    function apply() {
      var scale = Math.max(0.15, autoFit * zoom);
      gridWrap.style.transformOrigin = 'top left';
      gridWrap.style.transform = 'scale(' + scale + ')';
      scaleWrap.style.width = Math.ceil(naturalWidth * scale) + 'px';
      scaleWrap.style.height = Math.ceil(naturalHeight * scale) + 'px';
      // Bleibt der Inhalt trotz Mindest-Skalierung (oder nach manuellem Reinzoomen)
      // breiter als die Box, macht center ihn per Scroll teilweise unerreichbar
      // (scrollLeft kann nicht negativ werden) — dann auf flex-start umschalten,
      // damit wirklich der ganze Inhalt erreichbar bleibt. Passt der Inhalt,
      // bleibt center (aus der CSS-Regel) für die übliche, saubere Optik erhalten.
      box.style.justifyContent = (scaleWrap.getBoundingClientRect().width > box.clientWidth) ? 'flex-start' : '';
      positionZoomControls();
    }
    // Zoom-Buttons sitzen auf Höhe der Gang-Trennlinie (statt starr vertikal
    // mittig in der ganzen Box) — dort ist ohnehin schon eine optische Zäsur,
    // Buttons docken sich also an ein bestehendes Element an statt eine eigene
    // beliebige Höhe zu behaupten. Ohne Trennlinie (Zone ohne section_break)
    // bleibt die CSS-Vorgabe (vertikal mittig) als Fallback bestehen.
    function positionZoomControls() {
      var controls = box.querySelector('.seatplan-zoom-controls');
      var aisleLine = box.querySelector('.seatplan-aisle-line');
      if (!controls || !aisleLine) return;
      var boxRect = box.getBoundingClientRect();
      var lineRect = aisleLine.getBoundingClientRect();
      var centerY = lineRect.top + lineRect.height / 2 - boxRect.top;
      controls.style.top = centerY + 'px';
    }
    apply();

    var zoomIn = box.querySelector('.seatplan-zoom-in');
    var zoomOut = box.querySelector('.seatplan-zoom-out');
    if (zoomIn) zoomIn.addEventListener('click', function () {
      zoom = Math.min(maxZoom, zoom + 0.2);
      apply();
    });
    if (zoomOut) zoomOut.addEventListener('click', function () {
      zoom = Math.max(minZoom, zoom - 0.2);
      apply();
    });

    // Normales Mausrad liefert nur ein vertikales Delta. Passt der Sitzplan (nach
    // Mindest-Skalierung) zwar in der Höhe, aber nicht in der Breite in die Box
    // (z. B. Block C/F), läuft dieses Delta sonst ungenutzt an der Box vorbei und
    // scrollt stattdessen die äußere Modal-Box (die ebenfalls overflow-y:auto hat)
    // — der Sitzplan selbst bewegt sich dann gar nicht, nur der Rahmen darum.
    // Deshalb: ohne eigenes vertikales Overflow das Rad-Delta in horizontales
    // Scrollen der Box umlenken, statt es weiterzureichen.
    box.addEventListener('wheel', function (e) {
      var hOverflow = box.scrollWidth > box.clientWidth + 1;
      var vOverflow = box.scrollHeight > box.clientHeight + 1;
      if (hOverflow && !vOverflow) {
        e.preventDefault();
        box.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  };

  /* Öffentliche Methode, damit die Seite (Backdrop-Klick, ESC-Taste) die
     Detailansicht schließen kann, ohne interne Felder direkt anzufassen. Verhält sich
     wie „Abbrechen": die Vormerkung wird verworfen, nicht stillschweigend übernommen —
     ein Klick daneben oder ESC ist kein bewusstes Bestätigen. */
  SeatPicker.prototype.closeDetail = function () {
    if (this.mode === 'seats' && this.mobileZoneId) {
      this.pendingSeats = null;
      this.mobileZoneId = null;
      this.mobileCategory = null;
      this._render();
    }
  };

  /* Blockübersicht ist die durchgehende Ansicht an jeder Breite (kein Desktop/Mobile-
     Umschalten mehr) — Modus "seats" kann in die Sitzdetailansicht eines Blocks
     wechseln, Modus "blocks" bleibt immer in der Übersicht (freie Platzwahl, kein
     Sitzdetail nötig). */
  SeatPicker.prototype._render = function () {
    if (this.mode === 'seats' && this.mobileZoneId) {
      this._renderMobileZoneDetail();
    } else {
      if (this.detailBackdropEl) this.detailBackdropEl.classList.remove('open');
      document.documentElement.classList.remove('seatplan-detail-open');
      this._renderMobileOverview();
    }
  };

  /* Reine Sitzbox: keine Block-/Kategorie-Labels mehr darin (die stehen jetzt im Header
     über der Box, s. _renderMobileZoneDetail) — nur Sitze + Reihennummern. Ausrichtung
     ist jetzt allgemeingültig statt mit Block-B-Spezialfällen: A/B/D/E sind rechtsbündig,
     C/F (die jeweils gespiegelte Blockseite) linksbündig — alle Reihen einer Zone teilen
     sich EINEN gemeinsamen seatplan-grid-wrap (fit-content-breit = breiteste Reihe der
     ganzen Zone), wodurch align-items automatisch alle Reihen an derselben Kante
     ausrichtet, ohne dass jede Reihenbreite einzeln nachgerechnet werden muss. */
  SeatPicker.prototype._renderZone = function (zone) {
    var self = this;
    // mobileCategory eingeschränkt auf die gerade offene Kategorie (s. _openZoneDetail)
    // — bei Blöcken mit mehreren kaufbaren Kategorien (z.B. Block A: Fanblock/Kategorie
    // III) werden dadurch nur noch deren eigene Reihen gezeichnet, nicht mehr der ganze
    // physische Block gemischt.
    var groups = this._categoryGroups(zone).filter(function (g) {
      return self.excludeCategories.indexOf(g.category) === -1 && (!self.mobileCategory || g.category === self.mobileCategory);
    });
    if (groups.length === 0) return null;

    var wrap = document.createElement('div');
    wrap.className = 'seatplan-block';
    var blockMode = this.mode === 'blocks';
    var leading = isLeadingEdge(zone);

    var gridWrap = document.createElement('div');
    gridWrap.className = 'seatplan-grid-wrap';
    gridWrap.style.width = 'fit-content';
    // Zonen mit "layout":"anchored" (bisher nur Block A) bekommen ihre Reihenposition
    // direkt aus den Daten (x_units, s. _applyAnchoredLayout) statt aus align-items —
    // jede Reihe trägt ihre absolute Position schon als eigenes marginLeft, ein
    // zusätzliches flex-end würde das wieder verschieben.
    gridWrap.style.alignItems = zone.layout === 'anchored' ? 'flex-start' : (leading ? 'flex-start' : 'flex-end');
    // scaleWrap bekommt nach dem Einfügen ins DOM (s. _fitZoneScale) eine feste,
    // bereits herunterskalierte Größe — reserviert dadurch exakt so viel Platz im
    // Layout, wie der Sitzplan nach dem automatischen Zoom tatsächlich braucht,
    // statt wie bei einem reinen CSS-transform ungenutzten Scroll-Leerraum zu lassen.
    var scaleWrap = document.createElement('div');
    scaleWrap.className = 'seatplan-scale-wrap';
    scaleWrap.appendChild(gridWrap);
    wrap.appendChild(scaleWrap);

    // Manueller Zoom als Rückfalloption, falls die automatische Einpassung (s.
    // _fitZoneScale) auf einem Gerät nicht exakt passt.
    var zoomControls = document.createElement('div');
    zoomControls.className = 'seatplan-zoom-controls';
    zoomControls.innerHTML =
      '<button type="button" class="seatplan-zoom-in" aria-label="Vergrößern">+</button>' +
      '<button type="button" class="seatplan-zoom-out" aria-label="Verkleinern">−</button>';
    wrap.appendChild(zoomControls);

    groups.forEach(function (group, gIdx) {
      var category = group.category;
      var priceInfo = self.prices[category] || { normal: 0 };
      var freeCount = 0;

      group.rows.forEach(function (row, rIdx) {
        var rowLabel = row.row_label || row.row_number;
        var rowEl = document.createElement('div');
        rowEl.className = 'seatplan-row-line';
        // Reihennummer als Attribut, damit segment_align (s. _fixupRowWidths) eine
        // andere Reihe als Bezug ansprechen kann (z. B. Block D: Randsegmente der
        // Reihen 11-13 fluchten mit bestimmten Sitzen der Reihe 14).
        if (row.row_number) rowEl.dataset.rowNumber = row.row_number;
        if (row.segment_align) rowEl.dataset.segmentAlign = JSON.stringify(row.segment_align);
        // Die Segmentgrenzen müssen auch nach dem Rendern bekannt sein: der
        // Segment-Abgleich in _fixupRowWidths muss wissen, wo das nächste Segment
        // beginnt, um eine Lücke an der richtigen Stelle zu setzen.
        if (row.segment_breaks) rowEl.dataset.segmentBreaks = JSON.stringify(row.segment_breaks);
        // Reihen mit weniger/mehr Sitzen als Reihe 1 (z. B. Block B, Reihe 6-10) sollen
        // trotzdem optisch gleich breit wirken — Breite wird nach dem Einfügen ins DOM
        // gemessen (s. _fixupRowWidths), nicht aus einer festen Pixelzahl berechnet.
        if (row.match_first_row_width) rowEl.classList.add('seatplan-row-line--match-first');
        // Hintere Reihen (z. B. Block B, Reihe 11/12) wachsen nicht symmetrisch nach
        // außen, sondern verschieben sich ganz gegenüber den vorderen Reihen — ein
        // bestimmter Sitz (align_target_seat) dort liegt exakt auf Höhe des letzten
        // Sitzes einer vorderen Reihe. Verschiebung wird nach dem Einfügen ins DOM aus
        // der tatsächlichen Position des Zielsitzes berechnet (s. _fixupRowWidths),
        // nicht aus Sitzanzahl × Rasterbreite — Segment-Lücken innerhalb der Reihe
        // (segment_breaks) machen den Abstand zwischen Sitzen sonst uneinheitlich.
        if (row.align_target_seat) rowEl.dataset.alignTargetSeat = row.align_target_seat;
        if (row.align_reference_seat) rowEl.classList.add('seatplan-row-line--align-reference');
        // Sichtbarer Gang zwischen zwei Struktur-/Kategorie-Gruppen (z. B. Reihe 5/6).
        // Bei B markiert schon der Farbwechsel (VIP/Kat. I) diese Grenze; bei den
        // einfarbigen Blöcken A/C braucht es dafür eine eigene Trennlinie, sonst wirkt
        // die Lücke wie ein Layout-Fehler statt wie der echte Gang.
        if (gIdx > 0 && rIdx === 0) {
          var aisleLine = document.createElement('div');
          aisleLine.className = 'seatplan-aisle-line';
          gridWrap.appendChild(aisleLine);
        }

        var rowNumLeft = document.createElement('span');
        rowNumLeft.className = 'seatplan-row-num';
        rowNumLeft.textContent = rowLabel;
        rowEl.appendChild(rowNumLeft);
        var labelInsertBeforeEl = null;
        // Welche PHYSISCHEN Sitze echte Segmentgrenzen sind, per seat_guid statt per
        // Nummer festhalten: renumber_seats kann eine finale Sitznummer mehrfach in
        // derselben Reihe vergeben (z. B. Block F Reihe 6 — Rollstuhlplätze 1-5 UND die
        // umbenannten Normalsitze 1-10 teilen sich 1-5), ein reiner Nummernvergleich
        // (indexOf) träfe dann fälschlich JEDEN Sitz mit passender Nummer statt nur den
        // tatsächlichen Segmentanfang. Der Cursor läuft nur vorwärts durch die physische
        // (Array-)Reihenfolge, die von renumber_seats nie verändert wird, und liefert so
        // pro Grenzwert garantiert den richtigen (nächsten) Sitz.
        var breakGuids = {};
        if (row.segment_breaks && row.segment_breaks.length) {
          var breakCursor = 0;
          row.segment_breaks.forEach(function (breakNum) {
            for (; breakCursor < row.seats.length; breakCursor++) {
              if (String(row.seats[breakCursor].seat_number) === String(breakNum)) {
                breakGuids[row.seats[breakCursor].seat_guid] = true;
                breakCursor++;
                break;
              }
            }
          });
        }
        row.seats.forEach(function (seat) {
          var taken = !!(self.takenSeatGuids && self.takenSeatGuids.has(seat.seat_guid));
          // Reserviert/NV gelten nur für noch nicht verkaufte Plätze — ein bereits
          // verkaufter Platz bleibt "vergeben", nicht "EA"/"NV" (s. _isBlocked).
          var reserved = !taken && !!(self.reservedSeatGuids && self.reservedSeatGuids.has(seat.seat_guid));
          // "Nicht verfügbar" (NV) — vom Verein zurückgehalten, um später separat vergeben
          // zu werden (z.B. Block A Reihe 1-3 Sitz 1-7). Anders als EA (Ehrenamtliche) ein
          // eigener Grund, deshalb eigenes Label/eigene Optik statt Wiederverwendung von
          // .reserved. Zählt genau wie EA in die Gesamtzahl, aber nicht als frei/buchbar.
          var nv = !taken && !reserved && !!(self.nvSeatGuids && self.nvSeatGuids.has(seat.seat_guid));
          if (!taken && !reserved && !nv) freeCount++;
          var btn = document.createElement('button');
          btn.type = 'button';
          var isSelected = !taken && !reserved && !nv && !!self._activeSeats()[seat.seat_guid];
          var isWheelchair = !!seat.wheelchair;
          btn.className = 'seatplan-seat ' + catClass(category) + (reserved ? ' reserved' : (nv ? ' nv' : (taken ? ' taken' : ''))) + (isSelected ? ' selected' : '') + (isWheelchair ? ' wheelchair' : '');
          // Für Ehrenamtliche reservierte Plätze zeigen "EA", NV-Plätze "NV" statt der
          // Sitznummer und bekommen keine Verkauft-Schraffur wie .taken (s.
          // .seatplan-seat.reserved/.nv) — sie sind nie verkauft gewesen, sondern von
          // vornherein nicht zum freien Verkauf freigegeben. Rollstuhlplätze zeigen GAR
          // keine Nummer (Marko, site-weit) — das ♿-Symbol kommt stattdessen zentriert
          // per CSS (s. .seatplan-seat.wheelchair::after); der Sitz bleibt intern ganz
          // normal nummeriert (seat_number) und zählt normal in die Gesamtzahl mit, nur
          // die sichtbare Beschriftung entfällt.
          btn.textContent = reserved ? 'EA' : (nv ? 'NV' : (isWheelchair ? '' : seat.seat_number));
          // Echte Gang-Lücke innerhalb der Reihe (z. B. "1,2 | 3-22 | 23,24,25") —
          // die Sitznummerierung bleibt über den Gang hinweg durchgehend, nur die
          // Darstellung bekommt hier eine kleine zusätzliche Lücke.
          if (breakGuids[seat.seat_guid]) {
            btn.style.marginLeft = '10px';
          }
          if (blockMode) btn.tabIndex = -1;
          btn.dataset.seatGuid = seat.seat_guid;
          // Stabiler Anker für DOM-Sitzsuchen (_applySegmentGapSeats, seatIn, findSeatEl):
          // textContent ist für Rollstuhlplätze absichtlich leer (s.o.), darf also NICHT
          // als Suchschlüssel dienen — sonst greift eine Suche nach der Rollstuhlplatz-
          // Nummer irrtümlich einen anderen Sitz mit zufällig gleicher Anzeige-Nummer.
          btn.dataset.seatNumber = seat.seat_number;
          var seatLabel = zone.name + ', Reihe ' + rowLabel + ', Platz ' + seat.seat_number + (isWheelchair ? ' (Rollstuhlplatz)' : '');
          btn.setAttribute('aria-label', seatLabel + (reserved ? ' (reserviert für Ehrenamtliche)' : nv ? ' (nicht verfügbar)' : taken ? ' (vergeben)' : ' (frei)'));
          // Rollstuhlplätze haben sitzplanweit einen eigenen, festen Preis (8,00 € inkl.
          // Begleitkarte, s. Preisliste) statt des Preises ihres Blocks — greift nur,
          // wenn die Seite überhaupt einen Rollstuhlplatz-Preis mitgibt (opts.prices),
          // sonst bleibt der Sitz beim normalen Block-Preis (Rückwärtskompatibilität).
          var seatCategory = (isWheelchair && self.prices['Rollstuhlplatz']) ? 'Rollstuhlplatz' : category;
          var seatPriceInfo = seatCategory === 'Rollstuhlplatz' ? self.prices['Rollstuhlplatz'] : priceInfo;
          // Kategorien ohne Preis auf dieser Seite (z.B. Kategorie III/Fanblock, solange
          // die Dauerkarte noch keine Saisonpreise dafür hat) waren vorher sichtbar
          // "aktiv" (kein disabled), bekamen aber mangels self.prices[category] gar
          // keinen Klick-Handler — ein Sitz, der anklickbar AUSSAH, aber stumm nichts
          // tat. Jetzt explizit deaktiviert, bis ein Preis für die Kategorie da ist.
          if (taken || reserved || nv || blockMode || !self.prices[seatCategory]) {
            btn.disabled = true;
          } else {
            btn.addEventListener('click', function () {
              self._toggleSeat(btn, seat.seat_guid, zone.name, rowLabel, seat.seat_number, seatCategory, seatPriceInfo);
            });
          }
          // label_before_seat (z.B. Block A Reihe 1, wegen des neuen Rollstuhlplatzes am
          // Ende): merkt sich den Button des angegebenen Sitzes, damit die rechte
          // Reihennummer GLEICH danach (s.u.) davor statt ganz am Ende eingefügt wird —
          // sie soll mit den Reihennummern der anderen Reihen fluchten, nicht mit dem
          // "freien"/nachgestellten Zusatzsitz mitwandern.
          if (row.label_before_seat && String(row.label_before_seat) === seat.seat_number) {
            labelInsertBeforeEl = btn;
          }
          rowEl.appendChild(btn);
        });
        var rowNumRight = document.createElement('span');
        rowNumRight.className = 'seatplan-row-num';
        rowNumRight.textContent = rowLabel;
        if (labelInsertBeforeEl) rowEl.insertBefore(rowNumRight, labelInsertBeforeEl);
        else rowEl.appendChild(rowNumRight);
        gridWrap.appendChild(rowEl);
      });

      if (blockMode && self.prices[category]) {
        var blockKey = zone.zone_id + '::' + category;
        var zoneLabel = groups.length > 1 ? zone.name + ' · ' + category : zone.name;
        wrap.appendChild(self._renderBlockControls(blockKey, zoneLabel, category, priceInfo, freeCount));
      }
    });

    return wrap;
  };

  SeatPicker.prototype._renderBlockControls = function (blockKey, zoneLabel, category, priceInfo, freeCount) {
    var self = this;
    var box = document.createElement('div');
    box.className = 'seatplan-block-controls';

    function stepperRow(tarif, tarifLabel, price, maxOverride) {
      var row = document.createElement('div');
      row.className = 'seatplan-stepper-row';
      var max = maxOverride !== undefined ? maxOverride : freeCount;
      row.innerHTML =
        '<span>' + tarifLabel + ' <strong>' + fmtEUR(price) + ' €</strong></span>' +
        '<span class="seatplan-stepper">' +
          '<button type="button" data-step="-1" data-zone="' + blockKey + '" data-tarif="' + tarif + '" aria-label="weniger ' + tarifLabel + '">−</button>' +
          '<input type="number" inputmode="numeric" min="0" max="' + max + '" value="0" ' +
            'data-count="' + blockKey + '-' + tarif + '" data-zone="' + blockKey + '" data-tarif="' + tarif + '" ' +
            'aria-label="Anzahl ' + tarifLabel + '">' +
          '<button type="button" data-step="1" data-zone="' + blockKey + '" data-tarif="' + tarif + '" aria-label="mehr ' + tarifLabel + '">+</button>' +
        '</span>';
      return row;
    }

    box.appendChild(stepperRow('normal', 'Normalpreis', priceInfo.normal));
    if (priceInfo.ermaessigt !== undefined) {
      box.appendChild(stepperRow('ermaessigt', 'Ermäßigt', priceInfo.ermaessigt));
    }

    box.querySelectorAll('[data-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var delta = parseInt(this.dataset.step, 10);
        self._stepBlock(blockKey, zoneLabel, category, priceInfo, this.dataset.tarif, delta, freeCount);
      });
    });
    box.querySelectorAll('input[data-count]').forEach(function (input) {
      input.addEventListener('change', function () {
        var value = parseInt(this.value, 10);
        if (isNaN(value)) value = 0;
        self._setBlockCount(blockKey, zoneLabel, category, priceInfo, this.dataset.tarif, value, freeCount);
      });
    });

    return box;
  };

  SeatPicker.prototype._stepBlock = function (blockKey, zoneLabel, category, priceInfo, tarif, delta, freeCount) {
    var counts = this.blockCounts[blockKey] || {};
    this._setBlockCount(blockKey, zoneLabel, category, priceInfo, tarif, (counts[tarif] || 0) + delta, freeCount);
  };

  /* Alle Tarife, die im Modus "blocks" pro Block/Kategorie parallel gezählt werden —
     normal/ermaessigt immer, "kind" nur wo eine Kategorie einen Kinder-Preis hat (s.
     BLOCK_TARIF_LABELS). Bewusst als Liste statt hart auf zwei Tarife ("normal"/
     "ermaessigt") ausgelegt: sonst würde die Obergrenze unten (maxForTarif) bei einem
     dritten Tarif nur EINEN der beiden anderen Tarife abziehen statt beide. */
  var BLOCK_TARIFS = Object.keys(BLOCK_TARIF_LABELS);

  /* Direkte Zahleneingabe im Stepper — ermöglicht Bulk-Buchungen (z. B. 50
     Tickets auf einmal), ohne 50× auf "+" klicken zu müssen. Wert wird auf
     [0, verbleibende freie Plätze im Block minus ALLER anderen Tarife] begrenzt.
     blockKey ist zoneId + "::" + category, damit ein Block mit mehreren
     Kategorien (z. B. Block B: VIP-Reihe + Kategorie-II-Reihen) getrennt zählt. */
  SeatPicker.prototype._setBlockCount = function (blockKey, zoneLabel, category, priceInfo, tarif, value, freeCount) {
    var counts = this.blockCounts[blockKey] || {};
    var otherTotal = BLOCK_TARIFS.filter(function (t) { return t !== tarif; })
      .reduce(function (sum, t) { return sum + (counts[t] || 0); }, 0);
    var maxForTarif = Math.max(0, freeCount - otherTotal);
    if (tarif === 'begleitung') {
      // Zusaetzliche, blockuebergreifende Grenze: nie mehr Begleitpersonen im ganzen
      // Warenkorb als gebuchte Rollstuhlplaetze (Marko, 13.08.2026) — die Pruefung oben
      // kennt nur die physische Kapazitaet DIESES Blocks, nicht diese Regel. Der eigene
      // bisherige Wert wird zurueckaddiert, sonst wuerde er sich selbst blockieren.
      maxForTarif = Math.min(maxForTarif, this._companionSlotsRemaining(blockKey) + (counts.begleitung || 0));
    }
    var next = Math.max(0, Math.min(value, maxForTarif));
    counts[tarif] = next;
    counts.zoneLabel = zoneLabel;
    counts.category = category;
    counts.priceInfo = priceInfo;
    this.blockCounts[blockKey] = counts;

    var input = this.root.querySelector('[data-count="' + blockKey + '-' + tarif + '"]');
    if (input) input.value = String(next);
    this._renderCart();
  };

  /* Wie viele Begleitperson-Plaetze insgesamt (ueber alle Bloecke hinweg) noch frei
     sind — genau einer pro im ganzen Warenkorb gebuchtem Rollstuhlplatz (Marko,
     13.08.2026, "auch bei Einzelticketbuchungen so umsetzen"), analog zu
     _companionSlotAvailable im "seats"-Modus. excludeBlockKey nimmt den gerade
     bearbeiteten Block von der "bereits verbraucht"-Zaehlung aus. */
  SeatPicker.prototype._companionSlotsRemaining = function (excludeBlockKey) {
    var self = this;
    var wheelchairQty = 0, begleitungElsewhere = 0;
    Object.keys(this.blockCounts).forEach(function (bk) {
      var c = self.blockCounts[bk];
      if (c.category === 'Rollstuhlplatz') {
        BLOCK_TARIFS.forEach(function (t) { if (t !== 'begleitung') wheelchairQty += (c[t] || 0); });
      }
      if (bk !== excludeBlockKey) begleitungElsewhere += (c.begleitung || 0);
    });
    return Math.max(0, wheelchairQty - begleitungElsewhere);
  };

  /* _toggleSeat läuft ausschließlich innerhalb der offenen Detailansicht (der Klick-
     Handler wird nur dort registriert, s. _renderZone) — _activeSeats() liefert hier
     also immer die Vormerkung, nie direkt den Warenkorb. Der Warenkorb selbst (this.
     selected) wird erst bei „Übernehmen" geschrieben; dadurch verändert Antippen die
     Seite hinter dem Overlay nicht mehr (das war das „Bild springt im Hintergrund",
     Feedback 30.07.2026) — es gibt schlicht nichts mehr, das dort mitwachsen könnte. */
  SeatPicker.prototype._toggleSeat = function (btn, guid, zoneLabel, rowLabel, seatNumber, category, priceInfo) {
    var seats = this._activeSeats();
    if (seats[guid]) {
      delete seats[guid];
      btn.classList.remove('selected');
    } else {
      seats[guid] = {
        zoneLabel: zoneLabel, rowLabel: rowLabel, seatNumber: seatNumber,
        category: category, tarif: 'normal', price: this._dkPrice(priceInfo.normal, false), priceInfo: priceInfo
      };
      btn.classList.add('selected');
    }
    this._updatePendingList(zoneLabel);
  };

  /* Nachwuchsbeitrag ist eine Pauschale pro Bestellung (nicht pro Platz/Ticket),
     standardmäßig aktiviert, mit Opt-out-Checkbox. Wird nur angezeigt, wenn der
     Warenkorb nicht leer ist. Gemeinsam für "seats"- und "blocks"-Modus. */
  SeatPicker.prototype._appendNachwuchsRow = function () {
    var self = this;
    if (!this.nachwuchsBeitrag || this._voucherIsFullComp()) return;
    var nwRow = document.createElement('label');
    nwRow.className = 'seatplan-nachwuchs-row';
    nwRow.innerHTML =
      '<input type="checkbox" id="seatplan-nachwuchs-checkbox"' + (this.nachwuchsChecked ? ' checked' : '') + '>' +
      '<span>Unterstützung für den Nachwuchs</span>' +
      '<strong>' + fmtEUR(this.nachwuchsChecked ? this.nachwuchsAmount : 0) + ' €</strong>';
    this.cartEl.appendChild(nwRow);
    nwRow.querySelector('input').addEventListener('change', function () {
      self.nachwuchsChecked = this.checked;
      self._renderCart();
    });
  };

  /* Kurzbezeichnungen für die Gutschein-Zeile im Warenkorb — "C unten" zählt fürs
     Anzeigen als Kat. 2 (Preis ist ohnehin identisch, s. prices-Objekt weiter oben),
     damit dort nicht faelschlich eine dritte, eigene "Kategorie" auftaucht. */
  var VOUCHER_CATEGORY_SHORT = {
    'Kategorie I': 'Kat. 1', 'Kategorie II': 'Kat. 2', 'C unten': 'Kat. 2', 'Kategorie III': 'Kat. 3',
    'Fanblock': 'Fanblock', 'VIP': 'VIP', 'Rollstuhlplatz': 'Rollstuhlplatz'
  };
  var VOUCHER_CATEGORY_ORDER = ['Kat. 1', 'Kat. 2', 'Kat. 3', 'Fanblock', 'Rollstuhlplatz', 'VIP'];
  var VOUCHER_TARIF_SHORT = { normal: 'normal', ermaessigt: 'ermäßigt', kind: 'Kinder' };

  /* Baut einen sprechenden Label-Text aus der normalisierten Antwort des
     Gutschein-Webhooks (s. VOUCHER_CHECK_URL) — für die Warenkorb-Anzeige. Zeigt
     bewusst nicht mehr den eingegebenen Code selbst (steht schon im Eingabefeld),
     nur noch Betrag + kurze Kategorie-/Tarif-Angabe. */
  function labelForVoucherInfo(info) {
    if (info.source === 'giftcard') return 'Guthaben ' + fmtEUR(info.balance) + ' €';
    var amount = info.priceMode === 'percent' ? (info.value + ' %') : (fmtEUR(info.value) + ' €');
    var scope = null;
    if (info.categories && info.categories.length) {
      var shortCats = info.categories.map(function (c) { return VOUCHER_CATEGORY_SHORT[c] || c; });
      shortCats = shortCats.filter(function (c, i) { return shortCats.indexOf(c) === i; });
      shortCats.sort(function (a, b) { return VOUCHER_CATEGORY_ORDER.indexOf(a) - VOUCHER_CATEGORY_ORDER.indexOf(b); });
      scope = shortCats.join(' / ');
      if (info.tarifRestriction) scope += ' ' + (VOUCHER_TARIF_SHORT[info.tarifRestriction] || info.tarifRestriction);
    }
    return amount + (scope ? ' (' + scope + ')' : '');
  }

  /* Normalisiert einen Tarif-Wert auf seine Basisform (z.B. "ermaessigt_member" ->
     "ermaessigt") — Mitgliedsrabatt-Varianten zaehlen fuer die Gutschein-Tarifpruefung
     als derselbe Tarif. */
  function baseTarif(t) { return (t || '').replace('_member', ''); }

  /* Gutschein-/Wertgutschein-Code — gemeinsam für "seats"- und "blocks"-Modus,
     wird wie der Nachwuchsbeitrag nur angezeigt, wenn der Warenkorb nicht leer
     ist. Die Prüfung läuft serverseitig (VOUCHER_CHECK_URL, echte pretix-Daten),
     deshalb async mit kurzem Lade-Zustand statt eines sofortigen Ergebnisses. */
  SeatPicker.prototype._appendVoucherRow = function () {
    var self = this;
    var wrap = document.createElement('div');
    wrap.className = 'seatplan-voucher-row';

    if (this.voucherInfo) {
      /* Ein kategorie-/tarifgebundener Gutschein gilt nicht automatisch fuer alles
         im Warenkorb — bei der aktuellen Auswahl (z.B. Normalpreis statt Ermaessigt,
         oder ein anderer Block) kann der Rabatt 0 sein, obwohl der Code selbst gueltig
         ist. Das muss sichtbar sein, statt stillschweigend "angewendet" zu zeigen. */
      var categoryBound = this.voucherInfo.categories && this.voucherInfo.categories.length;
      var hasMatch = !categoryBound || this._voucherMatchingUnits().length > 0;
      wrap.innerHTML =
        '<div class="seatplan-voucher-applied">' +
          '<span><i data-lucide="tag" style="width:14px;height:14px"></i> Gutschein: ' + this.voucherInfo.label + '</span>' +
          '<button type="button" data-voucher-remove>entfernen</button>' +
        '</div>' +
        (hasMatch ? '' : '<p class="seatplan-voucher-error">Dieser Gutschein gilt nicht für deine aktuelle Auswahl.</p>');
      this.cartEl.appendChild(wrap);
      if (window.lucide) window.lucide.createIcons();
      wrap.querySelector('[data-voucher-remove]').addEventListener('click', function () {
        self.voucherCode = null;
        self.voucherInfo = null;
        self.voucherError = null;
        self._renderCart();
      });
    } else {
      wrap.innerHTML =
        '<div class="seatplan-voucher-input-wrap">' +
          '<input type="text" placeholder="Gutscheincode" id="seatplan-voucher-input"' + (this.voucherChecking ? ' disabled' : '') + '>' +
          '<button type="button" data-voucher-apply' + (this.voucherChecking ? ' disabled' : '') + '>' + (this.voucherChecking ? 'Wird geprüft …' : 'Einlösen') + '</button>' +
        '</div>' +
        (this.voucherError ? '<p class="seatplan-voucher-error">' + this.voucherError + '</p>' : '');
      this.cartEl.appendChild(wrap);
      var input = wrap.querySelector('#seatplan-voucher-input');
      var apply = function () {
        var code = input.value.trim().toUpperCase();
        if (!code || self.voucherChecking) return;
        self.voucherChecking = true;
        self.voucherError = null;
        self._renderCart();
        var url = VOUCHER_CHECK_URL + '?code=' + encodeURIComponent(code) + '&event=' + encodeURIComponent(self.pretixEvent || '');
        fetch(url)
          .then(function (r) { return r.json(); })
          .then(function (result) {
            self.voucherChecking = false;
            /* Wertgutscheine werden hier nur geprüft, nie eingelöst (kein Abbuchen) —
               das reale Einlösen (inkl. Guthaben-Abbuchung) passiert ausschließlich im
               Checkout, s. tickets/checkout.html VOUCHER_EINLOESEN_URL. Ein hier
               eingegebener Wertgutschein-Code würde sonst nur eine Schein-Zeile im
               Warenkorb erzeugen, ohne dass das Guthaben je wirklich verrechnet wird. */
            if (result && result.valid && result.source === 'giftcard') {
              self.voucherError = 'Wertgutscheine bitte an der Kasse einlösen (nächster Schritt).';
            } else if (result && result.valid) {
              /* result.itemIds sind echte pretix-Item-IDs (item- oder quota-gebunden).
                 self.pretixItemCategoryMap enthält nur die auf DIESER Seite (Einzelticket
                 bzw. Dauerkarte) existierenden IDs — Items des jeweils anderen Produkttyps
                 lösen hier absichtlich zu keiner Kategorie auf, s. Kommentar an der
                 Kartendefinition. Ein item-/quota-gebundener Gutschein ohne passende
                 Kategorie auf dieser Seite ist ein echter Fehlschlag, kein "gilt überall". */
              var categories = (result.itemIds || []).map(function (id) { return self.pretixItemCategoryMap[id]; }).filter(Boolean);
              categories = categories.filter(function (c, i) { return categories.indexOf(c) === i; });
              if (result.itemIds && result.itemIds.length && !categories.length) {
                self.voucherError = 'Dieser Gutschein gilt nicht für die Artikel in deinem Warenkorb.';
              } else {
                var info = {
                  source: result.source, code: result.code, priceMode: result.priceMode, value: result.value,
                  categories: categories, tarifRestriction: result.tarifRestriction || null,
                  remainingUses: result.remainingUses != null ? result.remainingUses : null,
                  balance: result.balance != null ? result.balance : null
                };
                info.label = labelForVoucherInfo(info);
                self.voucherCode = result.code;
                self.voucherInfo = info;
                self.voucherError = null;
              }
            } else {
              self.voucherError = 'Dieser Gutscheincode ist ungültig oder abgelaufen.';
            }
            self._renderCart();
          })
          .catch(function () {
            self.voucherChecking = false;
            self.voucherError = 'Gutschein konnte gerade nicht geprüft werden. Bitte gleich nochmal versuchen.';
            self._renderCart();
          });
      };
      wrap.querySelector('[data-voucher-apply]').addEventListener('click', apply);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    }
  };

  /* Notiz zur Bestellung — direkt im Warenkorb auf der Detailseite eingebbar
     (nicht erst auf der Käuferdaten-Seite), wird beim Übergang zum Warenkorb
     mitgegeben und dort im Notiz-Feld vorausgefüllt. Gemeinsam für "seats"-
     und "blocks"-Modus, wie Nachwuchsbeitrag und Gutschein. */
  SeatPicker.prototype._appendNotizRow = function () {
    var self = this;
    var wrap = document.createElement('div');
    wrap.className = 'seatplan-notiz-row';
    wrap.innerHTML =
      '<label for="seatplan-notiz-input">Notiz zur Bestellung (optional)</label>' +
      '<textarea id="seatplan-notiz-input" rows="2" placeholder="z. B. Schulklasse 3c, Grundschule Gispersleben"></textarea>';
    this.cartEl.appendChild(wrap);
    var textarea = wrap.querySelector('textarea');
    textarea.value = this.notiz;
    textarea.addEventListener('input', function () { self.notiz = this.value; });
  };

  SeatPicker.prototype._renderCart = function () {
    if (this.mode === 'blocks') { this._renderCartBlocks(); return; }

    var self = this;
    var guids = Object.keys(this.selected);
    if (guids.length === 0) {
      this.cartEl.innerHTML = '<div class="seatplan-cart-empty">Noch keine Plätze ausgewählt.</div>';
      this.ctaEl.disabled = true;
    } else {
      this.cartEl.innerHTML = '';
      guids.forEach(function (guid) {
        var s = self.selected[guid];
        var row = document.createElement('div');
        row.className = 'seatplan-cart-item';
        var hasErmaessigt = s.priceInfo.ermaessigt !== undefined;
        var hasKind = s.priceInfo.kind !== undefined;
        var tarifOptions = ['normal'].concat(hasErmaessigt ? ['ermaessigt'] : []).concat(hasKind ? ['kind'] : []);
        if (self.dkDiscount) {
          tarifOptions = tarifOptions.concat(['normal_member'], hasErmaessigt ? ['ermaessigt_member'] : [], hasKind ? ['kind_member'] : []);
        }
        // "Begleitperson (kostenlos)" nur fuer normale Sitze, nicht fuer den
        // Rollstuhlplatz-Sitz selbst, und nur solange noch ein freier Begleit-Slot
        // dieses Blocks uebrig ist (s. _companionSlotAvailable) — sonst wuerde der
        // Tarif auch nach Verbrauch des einzigen Slots weiter angeboten.
        if (s.category !== 'Rollstuhlplatz' && self._companionSlotAvailable(guid, s.zoneLabel)) {
          tarifOptions = tarifOptions.concat(['begleitung']);
        }
        /* Mitgliedsrabatt gilt pro Person, nicht pro Bestellung — ein Käufer könnte
           sonst seinen eigenen Mitgliedsstatus für beliebig viele fremde Plätze
           mitnehmen. Deshalb pro _member-Tarif-Platz Name abfragen + serverseitig
           prüfen (final, s. MITGLIEDSRABATT_PRUEFEN_URL), bevor der Rabatt gilt. */
        var isMemberTarif = s.tarif.indexOf('_member') !== -1;
        var memberBlock = '';
        if (isMemberTarif && s.memberChecked) {
          memberBlock = '<div class="seatplan-member-check seatplan-member-check-ok">' +
            '<i data-lucide="check" style="width:14px;height:14px"></i> Mitgliedschaft von ' + escapeHtml(s.memberName) + ' bestätigt</div>';
        } else if (isMemberTarif) {
          memberBlock = '<div class="seatplan-member-check">' +
            '<input type="text" placeholder="Vor- und Nachname" data-member-name="' + guid + '" value="' + escapeHtml(s.memberName || '') + '"' + (s.memberChecking ? ' disabled' : '') + '>' +
            '<button type="button" data-member-check="' + guid + '"' + (s.memberChecking ? ' disabled' : '') + '>' + (s.memberChecking ? 'Wird geprüft …' : 'Jetzt prüfen') + '</button>' +
            (s.memberCheckError ? '<p class="seatplan-member-check-error">' + s.memberCheckError + '</p>' : '') +
            '</div>';
        }
        row.innerHTML =
          '<div>' + s.zoneLabel + ' · Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber +
          // Kategorie sichtbar machen, wenn sie vom Preis her sonst nicht erkennbar
          // waere — der Rollstuhlplatz-Preis (104,00 €) ist z.B. identisch mit dem
          // ermaessigten Fanblock-Preis, ohne diesen Zusatz waere nicht ersichtlich,
          // dass es sich um den Rollstuhlplatz-Tarif handelt (Marko, 13.08.2026).
          (s.category === 'Rollstuhlplatz' ? ' (Rollstuhlplatz)' : '') +
          '<br><span class="t-caption">' + self._dkBreakdownText(s.priceInfo, s.tarif) + '</span>' +
          (tarifOptions.length > 1 ? '<br><select data-tarif="' + guid + '" class="seatplan-tarif-select">' +
            tarifOptions.map(function (t) {
              return '<option value="' + t + '"' + (s.tarif === t ? ' selected' : '') + '>' + DK_TARIF_LABELS[t] + '</option>';
            }).join('') +
            '</select>' : '') +
          memberBlock +
          '</div>' +
          '<div class="seatplan-cart-item-right seatplan-cart-item-right-removable"><span>' + fmtEUR(s.price) + ' €</span>' +
          '<button type="button" data-remove="' + guid + '">entfernen</button></div>';
        self.cartEl.appendChild(row);
      });

      this._appendNachwuchsRow();
      this._appendVoucherRow();
      this._appendNotizRow();
      var hasUncheckedMemberTarif = guids.some(function (guid) {
        var s = self.selected[guid];
        return s.tarif.indexOf('_member') !== -1 && !s.memberChecked;
      });
      this.ctaEl.disabled = hasUncheckedMemberTarif;

      this.cartEl.querySelectorAll('[data-tarif]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var guid = this.dataset.tarif;
          var s = self.selected[guid];
          s.tarif = this.value;
          s.price = self._dkTarifPrice(s.priceInfo, s.tarif);
          /* Tarifwechsel entwertet eine vorherige Mitgliedsprüfung — bei erneuter
             Wahl von "..._member" muss der Name erneut geprüft werden. */
          s.memberChecked = false;
          s.memberCheckError = null;
          self._renderCart();
        });
      });
      this.cartEl.querySelectorAll('[data-member-check]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var guid = this.dataset.memberCheck;
          var s = self.selected[guid];
          var input = self.cartEl.querySelector('[data-member-name="' + guid + '"]');
          var name = input ? input.value.trim() : '';
          if (!name || s.memberChecking) return;
          s.memberName = name;
          s.memberChecking = true;
          s.memberCheckError = null;
          self._renderCart();
          fetch(MITGLIEDSRABATT_PRUEFEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, saison: MITGLIEDSRABATT_SAISON })
          })
            .then(function (r) { return r.json(); })
            .then(function (result) {
              s.memberChecking = false;
              if (result && result.valid) {
                s.memberChecked = true;
                s.memberCheckError = null;
              } else {
                /* Tarif bewusst NICHT automatisch zurückstufen: das würde den
                   ganzen memberBlock (inkl. dieser Fehlermeldung) beim nächsten
                   Render verschwinden lassen, da isMemberTarif dann false wäre —
                   der Nutzer sähe nur einen stillen Rückfall auf den Normalpreis
                   ohne jede Erklärung. Stattdessen bleibt der Mitgliedstarif samt
                   Eingabefeld sichtbar; wer kein Mitglied ist, wechselt oben
                   bewusst selbst auf einen Tarif ohne Rabatt. */
                var reasonMessages = {
                  not_found: 'Keine aktive Mitgliedschaft mit diesem Namen gefunden. Bitte Schreibweise prüfen — oder oben einen Tarif ohne Mitgliedsrabatt wählen.',
                  ambiguous: 'Zu diesem Namen gibt es mehrere Mitgliedschaften. Bitte melde dich bei uns, damit wir das zuordnen können.',
                  already_used: 'Der Mitgliedsrabatt für diesen Namen wurde für die Saison ' + MITGLIEDSRABATT_SAISON + ' bereits genutzt.',
                  rate_limited: 'Gerade zu viele Prüfungen. Bitte in ein paar Minuten nochmal versuchen.'
                };
                s.memberCheckError = (result && reasonMessages[result.reason]) ||
                  'Mitgliedschaft konnte nicht bestätigt werden. Bitte Schreibweise prüfen — oder oben einen Tarif ohne Mitgliedsrabatt wählen.';
              }
              self._renderCart();
            })
            .catch(function () {
              s.memberChecking = false;
              s.memberCheckError = 'Prüfung gerade nicht möglich. Bitte gleich nochmal versuchen.';
              self._renderCart();
            });
        });
      });
      this.cartEl.querySelectorAll('[data-member-name]').forEach(function (inp) {
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            var guid = this.dataset.memberName;
            var btn = self.cartEl.querySelector('[data-member-check="' + guid + '"]');
            if (btn) btn.click();
          }
        });
      });
      this.cartEl.querySelectorAll('[data-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var guid = this.dataset.remove;
          var seatBtn = self.root.querySelector('.seatplan-seat[data-seat-guid="' + guid + '"]');
          if (seatBtn) seatBtn.classList.remove('selected');
          delete self.selected[guid];
          self._renderCart();
        });
      });
    }

    var total = guids.reduce(function (sum, guid) { return sum + self.selected[guid].price; }, 0);
    total += this._nachwuchsAmountFor(guids.length > 0);
    total -= this._voucherDiscount(total);
    this.totalEl.textContent = fmtEUR(total) + ' €';
  };

  /* Direkte Block+Anzahl-Wahl im Warenkorb selbst — Alternative zum Antippen im Bild
     oben, für Nutzer, die schon wissen, welchen Block sie wollen. Nur sichtbar, solange
     der Warenkorb noch leer ist (reine Einstiegshilfe, kein Dauer-UI-Element). */
  SeatPicker.prototype._renderDirectAddRow = function () {
    var self = this;
    var entries = [];
    // Bezeichnung deckungsgleich mit der Sitzplan-Übersicht (s. blockTile weiter oben,
    // Marko 11.08.2026: "sollten den Blockbez. in der Sitzplan-Übersicht entsprechen") —
    // Fanblock/VIP ohne Block-Buchstabe, "C unten" heißt hier wie dort "Courtside".
    // Die Kategorie steht IMMER dabei (auch bei Blöcken mit nur einer kaufbaren
    // Kategorie wie D/E/F, s. blockTile: die Übersicht zeigt dort ebenfalls Buchstabe
    // UND Kat.-Kürzel nebeneinander, nicht nur bei mehreren Kategorien).
    function optionLabel(id, p) {
      if (p.category === 'Fanblock' || p.category === 'VIP') return p.category;
      if (p.category === 'C unten') return 'Courtside';
      return 'Block ' + id + ' – ' + p.label;
    }
    this.northZones.concat(this.southZones).forEach(function (id) {
      var purchasable = self._purchasableCategories(id);
      // Ein Eintrag pro kaufbarer Kategorie (z.B. Block A: Kategorie III/Fanblock,
      // Block C: Kategorie II/C unten je einer; Block D/E/F genau einer).
      var multi = purchasable.length > 1;
      purchasable.forEach(function (p) {
        var key = multi ? id + '::' + p.category : id;
        entries.push({ value: key, label: optionLabel(id, p, multi) });
      });
    });
    // Rollstuhlplatz (Modus "blocks"/Einzelticket): EIN gemeinsamer Eintrag über alle
    // Blöcke hinweg statt einem pro Block — es ist ein einziges Kontingent, die Wahl
    // des Blocks ist beim Einzelticket ohnehin nur eine Kategorie- keine feste
    // Sitzwahl (Marko, 11.08.2026: "ist eigentlich egal, wo die Personen sitzen").
    if (this.prices['Rollstuhlplatz']) {
      var wcAny = this.northZones.concat(this.southZones).some(function (id) { return self._wheelchairSeatCount(id) > 0; });
      if (wcAny) entries.push({ value: 'ROLLSTUHL::Rollstuhlplatz', label: 'Rollstuhlplatz' });
    }
    // Stehplatz reiht sich als weitere Option ein — nur wenn für dieses Spiel buchbar
    // (s. #222), sonst taucht sie hier gar nicht auf ("in der Dropdown-Box nicht
    // selektierbar", Marko).
    if (this.standing && this.standingPrice && this.standingBookable) {
      entries.push({ value: 'STEHPLATZ', label: 'Stehplatz' });
    }
    if (!entries.length) return;
    // Alphabetisch nach Anzeigetext, nicht nach Block-Buchstabe (Marko, 11.08.2026).
    entries.sort(function (a, b) { return a.label.localeCompare(b.label, 'de'); });
    var options = entries.map(function (e) {
      return '<option value="' + e.value + '">' + escapeHtml(e.label) + '</option>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.className = 'seatplan-direct-add-row';
    wrap.innerHTML =
      '<label class="t-caption" for="seatplan-direct-block" style="display:block;margin-bottom:6px;color:var(--text-muted)">Block direkt wählen, ohne den Sitzplan zu öffnen</label>' +
      '<div style="display:flex;gap:8px">' +
        '<select id="seatplan-direct-block">' + options + '</select>' +
        '<input type="number" id="seatplan-direct-qty" min="1" value="1" aria-label="Anzahl">' +
        '<button type="button" class="btn btn-primary btn-sm" id="seatplan-direct-add">Auswahl übernehmen</button>' +
      '</div>';
    this.cartEl.appendChild(wrap);
    wrap.querySelector('#seatplan-direct-add').addEventListener('click', function () {
      var raw = wrap.querySelector('#seatplan-direct-block').value;
      var qty = parseInt(wrap.querySelector('#seatplan-direct-qty').value, 10);
      if (!raw || !qty || qty < 1) return;
      var key = splitZoneKey(raw);
      self._quickAddBlock(key.zoneId, qty, key.category);
    });
  };

  SeatPicker.prototype._renderCartBlocks = function () {
    var self = this;
    var lines = [];
    Object.keys(this.blockCounts).forEach(function (blockKey) {
      var c = self.blockCounts[blockKey];
      BLOCK_TARIFS.forEach(function (tarif) {
        if (c[tarif] > 0) {
          lines.push({ blockKey: blockKey, tarif: tarif, label: BLOCK_TARIF_LABELS[tarif], count: c[tarif], price: blockTarifPrice(c.priceInfo, tarif), zoneLabel: c.zoneLabel });
        }
      });
    });
    var ticketCount = lines.reduce(function (sum, l) { return sum + l.count; }, 0);

    this.cartEl.innerHTML = '';
    if (lines.length === 0) this._renderDirectAddRow();

    if (lines.length === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.className = 'seatplan-cart-empty';
      emptyEl.textContent = 'Noch keine Tickets ausgewählt.';
      this.cartEl.appendChild(emptyEl);
      this.ctaEl.disabled = true;
    } else {
      lines.forEach(function (l) {
        var row = document.createElement('div');
        row.className = 'seatplan-cart-item';
        var lineCategory = self.blockCounts[l.blockKey].category;
        var linePriceInfo = self.blockCounts[l.blockKey].priceInfo;
        var hasErmaessigt = linePriceInfo.ermaessigt !== undefined;
        var hasKind = linePriceInfo.kind !== undefined;
        var freeCount = self._blockFreeCount(l.blockKey.split('::')[0], lineCategory);
        // Begleitperson (kostenlos): als Tarif-Umwandlung fuer eine bereits im Warenkorb
        // liegende Zeile anbieten, nicht als eigener Direktwahl-Eintrag — Rollstuhlplatz
        // selbst ist block-unabhaengig (pseudo-Zone 'ROLLSTUHL', s. _renderDirectAddRow),
        // hat also gar keinen eigenen Block, an den man "eine Begleitperson dazu waehlen"
        // koennte; stattdessen wandelt der Kaeufer eine seiner NORMALEN Ticket-Zeilen um
        // (Marko, 13.08.2026: "auch bei Einzelticketbuchungen so umsetzen").
        var hasBegleitung = lineCategory !== 'Rollstuhlplatz' && self.prices['Rollstuhlplatz'] &&
          self._companionSlotsRemaining(l.blockKey) > 0;
        row.innerHTML =
          '<div>' + l.zoneLabel +
          '<br><span class="t-caption">' + fmtEUR(l.price) + ' € je Ticket</span>' +
          ((hasErmaessigt || hasKind || hasBegleitung) ? '<br><select class="seatplan-tarif-select" data-block-tarif-select data-zone="' + l.blockKey + '" data-tarif="' + l.tarif + '">' +
            '<option value="normal"' + (l.tarif === 'normal' ? ' selected' : '') + '>' + BLOCK_TARIF_LABELS.normal + '</option>' +
            (hasErmaessigt ? '<option value="ermaessigt"' + (l.tarif === 'ermaessigt' ? ' selected' : '') + '>' + BLOCK_TARIF_LABELS.ermaessigt + '</option>' : '') +
            (hasKind ? '<option value="kind"' + (l.tarif === 'kind' ? ' selected' : '') + '>' + BLOCK_TARIF_LABELS.kind + '</option>' : '') +
            (hasBegleitung ? '<option value="begleitung"' + (l.tarif === 'begleitung' ? ' selected' : '') + '>' + BLOCK_TARIF_LABELS.begleitung + '</option>' : '') +
            '</select>' : '<br><span class="t-caption">' + l.label + '</span>') +
          // Hinweis direkt bei der Rollstuhlplatz-Zeile, da es hier (anders als im
          // "seats"-Modus mit seinem Hinweis im Sitzplan-Popup) keine vergleichbare
          // Stelle gibt, an der die Begleitperson-Option sonst auffallen wuerde.
          (lineCategory === 'Rollstuhlplatz' ? '<br><span class="seatplan-pending-hint">Für deine Begleitperson kannst du bei einem anderen Ticket unten den Tarif auf „Begleitperson (kostenlos)“ umstellen.</span>' : '') +
          '</div>' +
          '<div class="seatplan-cart-item-right">' +
            '<span class="seatplan-stepper">' +
              '<button type="button" data-cart-step="-1" data-zone="' + l.blockKey + '" data-tarif="' + l.tarif + '" aria-label="weniger">−</button>' +
              '<span style="min-width:16px;text-align:center;font-weight:700">' + l.count + '</span>' +
              '<button type="button" data-cart-step="1" data-zone="' + l.blockKey + '" data-tarif="' + l.tarif + '" aria-label="mehr" ' + (l.count >= freeCount ? 'disabled' : '') + '>+</button>' +
            '</span>' +
            '<span>' + fmtEUR(l.count * l.price) + ' €</span></div>';
        self.cartEl.appendChild(row);
      });

      this._appendNachwuchsRow();
      this._appendVoucherRow();
      this._appendNotizRow();
      this.ctaEl.disabled = false;
    }

    this.cartEl.querySelectorAll('[data-cart-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var blockKey = this.dataset.zone;
        var tarif = this.dataset.tarif;
        var delta = parseInt(this.dataset.cartStep, 10);
        var c = self.blockCounts[blockKey];
        var freeCount = self._blockFreeCount(blockKey.split('::')[0], c.category);
        self._stepBlock(blockKey, c.zoneLabel, c.category, c.priceInfo, tarif, delta, freeCount);
      });
    });
    this.cartEl.querySelectorAll('[data-block-tarif-select]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var blockKey = this.dataset.zone;
        var oldTarif = this.dataset.tarif;
        var newTarif = this.value;
        if (newTarif === oldTarif) return;
        var counts = self.blockCounts[blockKey];
        // Bei Begleitperson nur so viele Tickets umwandeln, wie noch freie Slots da
        // sind (max. 1 pro Rollstuhlplatz im Warenkorb, s. _companionSlotsRemaining) —
        // der Rest bleibt im alten Tarif, statt die ganze Zeile pauschal umzubuchen.
        var moveQty = newTarif === 'begleitung'
          ? Math.min(counts[oldTarif], self._companionSlotsRemaining(blockKey))
          : counts[oldTarif];
        counts[newTarif] = (counts[newTarif] || 0) + moveQty;
        counts[oldTarif] -= moveQty;
        self._renderCart();
      });
    });

    var total = lines.reduce(function (sum, l) { return sum + l.count * l.price; }, 0);
    total += this._nachwuchsAmountFor(ticketCount > 0);
    total -= this._voucherDiscount(total);
    this.totalEl.textContent = fmtEUR(total) + ' €';
  };

  SeatPicker.prototype.getSelection = function () {
    var self = this;
    if (this.mode === 'blocks') {
      return Object.keys(this.blockCounts).map(function (zoneId) {
        var c = self.blockCounts[zoneId];
        return { zone_id: zoneId, zoneLabel: c.zoneLabel, normal: c.normal, ermaessigt: c.ermaessigt, priceInfo: c.priceInfo };
      }).filter(function (l) { return l.normal > 0 || l.ermaessigt > 0; });
    }
    return Object.keys(this.selected).map(function (guid) {
      var s = self.selected[guid];
      return { seat_guid: guid, zoneLabel: s.zoneLabel, rowLabel: s.rowLabel, seatNumber: s.seatNumber, tarif: s.tarif, price: s.price };
    });
  };

  /* Einheitliche Zusammenfassung für die Übergabe an die gemeinsame Checkout-Seite
     (Käuferdaten). Gleiche Form für "seats"- und "blocks"-Modus. */
  SeatPicker.prototype.getSummary = function () {
    var self = this;
    var lines = [];
    var total = 0;

    if (this.mode === 'blocks') {
      Object.keys(this.blockCounts).forEach(function (blockKey) {
        var c = self.blockCounts[blockKey];
        BLOCK_TARIFS.forEach(function (tarif) {
          var count = c[tarif];
          if (count > 0) {
            var price = blockTarifPrice(c.priceInfo, tarif);
            lines.push({
              label: c.zoneLabel + ' · ' + BLOCK_TARIF_LABELS[tarif],
              qty: count, unitPrice: price, lineTotal: count * price,
              // Maschinenlesbar für die pretix-Order (n8n): im Blockmodus wählt der
              // Käufer keinen konkreten Sitz, sondern Block + Kategorie + Anzahl.
              // Welche Sitze das konkret werden, entscheidet der Bestell-Workflow —
              // pretix verlangt bei bestuhlten Events pro Ticket einen echten Sitz.
              // zoneId zusätzlich zur category: manche Kategorien (Kategorie I/II) werden
              // seit der Block-Aufteilung (09.08.2026) von mehreren, pretix-seitig
              // UNABHÄNGIGEN Blöcken geteilt (z.B. Block D UND Block F sind beide
              // "Kategorie II", aber je ein eigenes pretix-Produkt/-Kontingent) — der
              // Bestell-Workflow braucht zoneId, um category+zoneId auf das richtige
              // Item aufzulösen (s. ITEM_MAP in der Einzelticketbestellung-verarbeiten-
              // Workflow).
              type: 'block', zoneLabel: c.zoneLabel, category: c.category,
              zoneId: blockKey.split('::')[0], tarif: tarif
            });
            total += count * price;
          }
        });
      });
      // Stehplatz (Kategorie "Stehplatz", pseudo-Zone "STEHPLATZ" in blockCounts) läuft
      // durch denselben Loop oben mit — kein eigener Line-Typ, der Bestell-Workflow
      // behandelt sie als ganz normale Kategorie (s. #222, Marko: "nichts Eigenes
      // erfinden ... integriert sich hundertprozentig in den Bestellworkflow").
      var ticketCount = lines.reduce(function (sum, l) { return sum + l.qty; }, 0);
      var nachwuchsAmount = this._nachwuchsAmountFor(ticketCount > 0);
      if (nachwuchsAmount > 0) {
        lines.push({ label: 'Unterstützung für den Nachwuchs', qty: 1, unitPrice: nachwuchsAmount, lineTotal: nachwuchsAmount, type: 'nachwuchs' });
        total += nachwuchsAmount;
      }
      return this._applyVoucherToSummary(lines, total, nachwuchsAmount);
    }

    Object.keys(this.selected).forEach(function (guid) {
      var s = self.selected[guid];
      lines.push({
        label: s.zoneLabel + ' · Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber + ' · ' + (DK_TARIF_LABELS[s.tarif] || 'Normalpreis'),
        qty: 1, unitPrice: s.price, lineTotal: s.price,
        // Maschinenlesbare Felder für die echte Pretix-Order-Erstellung (n8n) —
        // category/tarif bestimmen dort Item+Variation, seatGuid den Sitz. zoneLabel
        // (Bugfix 10.08.2026, s. #245) zusätzlich nötig, weil mehrere physische Blöcke
        // dieselbe Kategorie teilen können (z.B. Block B UND Block E sind beide
        // "Kategorie I", aber pretix-seitig zwei eigene Items/Kontingente) — ohne
        // zoneLabel kann der Bestell-Workflow nicht wissen, welches Item gemeint ist
        // (fehlte hier bisher, obwohl der "blocks"-Modus/Einzelticket dasselbe Feld
        // schon lange mitgibt, s. getSummary() oben). memberName geht in die
        // serverseitige Mitgliedsrabatt-Nachprüfung ein (n8n verifiziert unabhängig,
        // ob dieser Name wirklich freigeschaltet ist).
        type: 'seat', seatGuid: guid, zoneLabel: s.zoneLabel, category: s.category, tarif: s.tarif,
        memberName: s.tarif.indexOf('_member') !== -1 ? (s.memberName || '') : undefined
      });
      total += s.price;
    });
    var nwAmount = this._nachwuchsAmountFor(lines.length > 0);
    if (nwAmount > 0) {
      lines.push({ label: 'Unterstützung für den Nachwuchs', qty: 1, unitPrice: nwAmount, lineTotal: nwAmount, type: 'nachwuchs' });
      total += nwAmount;
    }
    return this._applyVoucherToSummary(lines, total, nwAmount);
  };

  /* Hängt einen Gutschein-Rabatt als eigene Zeile an (falls ein gültiger Code
     aktiv ist) und liefert die Gutschein-Metadaten mit, damit die Checkout-Seite
     weiß, dass hier schon ein Code eingelöst wurde (kein doppelter Rabatt). */
  SeatPicker.prototype._applyVoucherToSummary = function (lines, total, nachwuchsAmount) {
    var discount = this._voucherDiscount(total);
    if (discount > 0) {
      lines.push({ label: 'Gutschein: ' + this.voucherInfo.label, qty: 1, unitPrice: -discount, lineTotal: -discount });
      total -= discount;
    }
    /* Auf Cent runden, bevor der Betrag den Warenkorb verlässt. Das Aufsummieren
       vieler Einzelpreise mit Fließkomma-Arithmetik erzeugt sonst Werte wie
       853.4999999999999 — die landen unverändert in der Data Table und später in
       der Lastschriftdatei. Bei Geld darf kein Rest aus der Binärdarstellung
       übrig bleiben, deshalb hier UND je Zeile gerundet (s. roundCents). */
    total = roundCents(total);
    lines.forEach(function (l) {
      if (typeof l.unitPrice === 'number') l.unitPrice = roundCents(l.unitPrice);
      if (typeof l.lineTotal === 'number') l.lineTotal = roundCents(l.lineTotal);
    });
    return {
      lines: lines,
      total: total,
      nachwuchsBeitrag: { checked: this.nachwuchsChecked, amount: nachwuchsAmount },
      // Gleiche Form wie das Gutschein-Objekt aus tickets/checkout.html (dort per
      // /webhook/gutschein-einloesen befuellt): {code, discountAmount, category, label}.
      // Der Bestell-Workflow liest ohnehin nur .code und rechnet den Rabatt serverseitig
      // neu — die einheitliche Form ist reine Hygiene, kein Funktions-Unterschied.
      voucher: discount > 0 ? { code: this.voucherCode, discountAmount: discount, category: this.voucherInfo.category || null, label: this.voucherInfo.label } : null,
      notiz: this.notiz || ''
    };
  };

  window.SeatPicker = SeatPicker;
})();
