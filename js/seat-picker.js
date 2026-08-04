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

  function catClass(category) {
    if (category === 'Kategorie I') return 'cat-kat1';
    if (category === 'Kategorie II') return 'cat-kat2';
    if (category === 'VIP') return 'cat-vip';
    return '';
  }

  /* Dieselben Farbwerte wie die .seatplan-seat.cat-* Regeln in seat-picker.css —
     für die Block-Mini-Kacheln der mobilen Übersicht, die per JS-Gradient statt
     CSS-Klasse eingefärbt werden (mehrere Kategorien in einer einzigen Kachel). */
  function catColor(category) {
    if (category === 'Kategorie I') return 'rgba(232,119,34,.55)';
    if (category === 'VIP') return 'rgba(179,57,44,.55)';
    return '#D9DEE3'; // Kategorie II
  }
  function catBorderColor(category) {
    if (category === 'Kategorie I') return 'rgba(232,119,34,.9)';
    if (category === 'VIP') return 'rgba(179,57,44,.9)';
    return '#B9C1C8';
  }
  function catShortLabel(category) {
    if (category === 'Kategorie I') return 'Kat. I';
    if (category === 'Kategorie II') return 'Kat. II';
    return category;
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
  var VOUCHER_CHECK_URL = 'https://blev.app.n8n.cloud/webhook/gutschein-pruefen';

  /* Dauerkarte-Tarife inkl. Mitgliedsrabatt — nur relevant, wenn opts.dauerkarteDiscount
     gesetzt ist (Einzelticket bleibt unberührt, dort bleibt es bei normal/ermaessigt). */
  var DK_TARIF_LABELS = {
    normal: 'Normalpreis',
    ermaessigt: 'Ermäßigt',
    normal_member: 'Normalpreis mit Mitgliedsrabatt (Löwen e.V.)',
    ermaessigt_member: 'Ermäßigt mit Mitgliedsrabatt (Löwen e.V.)'
  };

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
    this.pretixEvent = opts.pretixEvent || null; // Event-Slug fuer die Gutschein-Pruefung (z.B. "dauerkarte2627")
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

  /* Einheiten (Sitze bzw. Block-Tarifzeilen) der Kategorie, an die ein Gutschein
     gebunden ist (this.voucherInfo.category) — Grundlage, um einen produktgebundenen
     Gutschein (z.B. "nur VIP") NICHT auf den ganzen Warenkorb, sondern nur auf
     passende Zeilen anzuwenden. Frisch aus this.selected/this.blockCounts gebaut,
     damit sie immer den aktuellen Warenkorb-Stand widerspiegeln. */
  SeatPicker.prototype._voucherMatchingUnits = function () {
    var self = this;
    var category = this.voucherInfo && this.voucherInfo.category;
    var units = []; // { qty, unitPrice }
    if (!category) return units;
    if (this.mode === 'blocks') {
      Object.keys(this.blockCounts).forEach(function (key) {
        var c = self.blockCounts[key];
        if (c.category !== category) return;
        if (c.normal) units.push({ qty: c.normal, unitPrice: c.priceInfo.normal });
        if (c.ermaessigt) units.push({ qty: c.ermaessigt, unitPrice: c.priceInfo.ermaessigt });
      });
    } else {
      Object.keys(this.selected).forEach(function (guid) {
        var s = self.selected[guid];
        if (s.category !== category) return;
        units.push({ qty: 1, unitPrice: s.price });
      });
    }
    return units;
  };

  /* Rabatt für einen gegebenen Zwischensumme-Betrag (Tickets + Nachwuchsbeitrag),
     gemeinsam für "seats"- und "blocks"-Modus sowie für getSummary(). Ein
     Wertgutschein zieht sein Guthaben pauschal vom Gesamtbetrag ab; ein Gutschein
     ohne Produktbindung wirkt ebenfalls pauschal (wie zuvor); ein produktgebundener
     Gutschein (voucherInfo.category) wirkt nur auf die dazu passenden Zeilen, je
     Einheit einmal, begrenzt auf die verbleibenden Einlösungen (remainingUses). */
  SeatPicker.prototype._voucherDiscount = function (base) {
    var info = this.voucherInfo;
    if (!info || base <= 0) return 0;
    if (info.source === 'giftcard') return Math.min(info.balance, base);
    if (info.category) {
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
    var base = tarif.indexOf('ermaessigt') === 0 ? priceInfo.ermaessigt : priceInfo.normal;
    return this._dkPrice(base, tarif.indexOf('_member') !== -1);
  };

  /* Rechnet die Rabattkette transparent vor, statt nur den fertigen Endpreis zu
     zeigen — jede Rabattzeile ("abzüglich 20 % Frühbucherrabatt", "abzüglich
     30 % Mitgliedsrabatt (Löwen e.V.)") bekommt eine eigene, fett gedruckte
     Zeile statt kommagetrennt in einem Satz zu verschwinden. Der Endpreis
     selbst steht separat rechts in der Zeile (s. _renderCart), nicht hier. */
  SeatPicker.prototype._dkBreakdownText = function (priceInfo, tarif) {
    var isErmaessigt = tarif.indexOf('ermaessigt') === 0;
    var base = isErmaessigt ? priceInfo.ermaessigt : priceInfo.normal;
    var lines = [(isErmaessigt ? 'Ermäßigt' : 'Normalpreis') + ' ' + fmtEUR(base) + ' € je Ticket'];
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
        groups.push({ category: category, rows: [row] });
      }
    });
    return groups;
  };

  SeatPicker.prototype._zoneById = function (id) {
    return this.blocks[id];
  };

  SeatPicker.prototype._renderMobileOverview = function () {
    var self = this;

    function blockTile(id, isNorth) {
      var zone = self._zoneById(id);
      if (!zone) return '';
      // allGroups (ungefiltert) ist nur für die Optik da: der VIP-Anteil eines Blocks
      // (z. B. B) soll im Floorplan sichtbar bleiben, auch wenn er hier gar nicht kaufbar
      // ist (excludeCategories) — sonst wirkt der Block als wäre er komplett Kategorie I.
      // groups (gefiltert) bleibt die Grundlage für Hauptkategorie/Kaufbarkeit der Kachel.
      var allGroups = self._categoryGroups(zone);
      var groups = allGroups.filter(function (g) {
        return self.excludeCategories.indexOf(g.category) === -1;
      });
      if (!groups.length) return '<div class="seatplan-mobile-tile" style="visibility:hidden"></div>';
      // Gewichtung nach REIHENANZAHL, nicht nach Sitzanzahl: der Gang liegt bei A/B/C
      // physisch auf derselben Tiefe (nach Reihe 5 von 12) — mit sitzanzahl-basierter
      // Gewichtung würde die Trennlinie je Block leicht unterschiedlich hoch landen,
      // weil einzelne Reihen unterschiedlich viele Sitze haben.
      var total = allGroups.reduce(function (sum, g) { return sum + g.rows.length; }, 0);
      // Reihenfolge in den Rohdaten: erste Gruppe = Reihen nächst dem Spielfeld. Bei
      // Nordblöcken (D/E/F) ist "nächst Spielfeld" die UNTERE Kante der Kachel (Spielfeld
      // liegt darunter), bei Südblöcken (A/B/C) die OBERE Kante (Spielfeld liegt darüber).
      var ordered = isNorth ? allGroups.slice().reverse() : allGroups;
      var stops = [];
      var boundaries = [];
      var acc = 0;
      ordered.forEach(function (g, idx) {
        var count = g.rows.length;
        var pct = Math.round((count / total) * 1000) / 10;
        stops.push(catColor(g.category) + ' ' + acc + '%');
        acc += pct;
        stops.push(catColor(g.category) + ' ' + acc + '%');
        if (idx < ordered.length - 1) boundaries.push(acc);
      });
      var colorBackground = allGroups.length > 1 ? 'linear-gradient(to bottom, ' + stops.join(', ') + ')' : catColor(allGroups[0].category);
      // Gang-Trennlinie (wie in der Detailansicht, s. .seatplan-aisle-line) auch schon
      // in der kleinen Übersichtskachel andeuten — bei A/C sonst unsichtbar, weil dort
      // beide Gruppen dieselbe Kategoriefarbe haben und nur der Farbverlauf allein
      // (s.o.) keine Grenze zeigt.
      var lineBackground = '';
      if (boundaries.length) {
        // Block B liegt auf orangem/rotem Farbverlauf — dort darf die Trennlinie
        // in derselben Orange-Akzentfarbe stehen statt im neutralen Grau von A/C.
        var lineColor = id === 'B' ? 'rgba(232,119,34,.9)' : 'var(--color-neutral-400)';
        var half = 0.9;
        var lineStops = [];
        boundaries.forEach(function (pos) {
          var from = Math.max(0, pos - half);
          var to = Math.min(100, pos + half);
          lineStops.push('transparent ' + from + '%', lineColor + ' ' + from + '%', lineColor + ' ' + to + '%', 'transparent ' + to + '%');
        });
        lineBackground = 'linear-gradient(to bottom, ' + lineStops.join(', ') + ')';
      }
      var background = lineBackground ? (lineBackground + ', ' + colorBackground) : colorBackground;
      // Bei gemischten Blöcken (z. B. B: VIP vorn + Kategorie I hinten) beschriftet die
      // Kachel bewusst nur die kaufbare Hauptkategorie (letzte/größte gefilterte Gruppe)
      // unten am Buchstaben — ein zusätzliches "VIP"-Label oben markiert den roten
      // Farbverlauf-Anteil separat, auch wenn VIP hier nicht kaufbar ist.
      var mainCategory = groups[groups.length - 1].category;
      var borderColor = catBorderColor(mainCategory);
      var hasVip = allGroups.some(function (g) { return g.category === 'VIP'; });
      // Ohne die Gang-Trennlinie stand Buchstabe+Kategorie mittig in der ganzen
      // Kachel — jetzt, wo die Linie eine sichtbare Grenze zieht, gehört das Label
      // mittig in den UNTEREN Abschnitt. padding-top schiebt den Inhaltsbereich genau
      // auf die Linie, die (per CSS) mittige Ausrichtung zentriert das Label dann im
      // Rest darunter. Bei den quadratischen Süd-Kacheln (aspect-ratio:1) ist ein
      // %-Wert dafür korrekt, weil Breite und Höhe dort gleich sind.
      var lineBoundary = boundaries.length ? boundaries[0] : null;
      var vipTop = lineBoundary !== null ? (lineBoundary / 2) : 9;
      var vipStyle = lineBoundary !== null
        ? 'top:' + vipTop + '%;transform:translateY(-50%)'
        : 'top:' + vipTop + 'px';
      var vipLabel = hasVip ? '<span class="seatplan-mobile-tile-vip" style="' + vipStyle + '">VIP</span>' : '';
      var isPending = self.mode === 'blocks' && self.pendingBlockId === id;
      var tileClass = 'seatplan-mobile-tile' + (isNorth ? '' : ' seatplan-mobile-tile-south') + (isPending ? ' selected' : '');
      var tileStyle = 'background:' + background + ';border-color:' + borderColor +
        (lineBoundary !== null ? ';padding-top:' + lineBoundary + '%' : '');
      return '<button type="button" class="' + tileClass + '" style="' + tileStyle + '" data-zone="' + id + '">' +
        vipLabel +
        '<span class="seatplan-mobile-tile-letter">' + id + '</span>' +
        '<span class="seatplan-mobile-tile-cat">' + catShortLabel(mainCategory) + '</span>' +
        '</button>';
    }

    var northTiles = this.northZones.map(function (id) { return blockTile(id, true); }).join('');
    var southTiles = this.southZones.map(function (id) { return blockTile(id, false); }).join('');

    // Modus "blocks" (Einzelticket): kein Sitzdetail nötig (freie Platzwahl im Block) —
    // stattdessen direkt in der Übersicht einen Block antippen (Markierung) und mit
    // "Übernehmen" 1 Ticket in den Warenkorb legen. Der Button erscheint nur dann,
    // mittig über dem Spielfeld, nicht standardmäßig sichtbar.
    var courtConfirm = (this.mode === 'blocks' && this.pendingBlockId)
      ? '<button type="button" class="btn btn-primary btn-sm seatplan-mobile-court-confirm" id="seatplan-mobile-add-btn">Übernehmen</button>'
      : '';

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
            '<div class="seatplan-mobile-standing"><span>Steh-</span><span>platz</span></div>' +
          '</div>' +
          '<div class="seatplan-mobile-court">' + courtConfirm + '<p class="t-caption" style="margin:0;color:var(--text-muted)">Spielfeld</p></div>' +
          '<div class="seatplan-mobile-court-aside-mirror" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="seatplan-mobile-tiles" style="grid-column:2;grid-row:4">' + southTiles + '</div>' +
        '<div class="seatplan-mobile-entrance vip" style="grid-column:3;grid-row:4"><i>VIP-Eingang</i></div>' +
      '</div>';

    this.root.querySelectorAll('.seatplan-mobile-tile[data-zone]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (self.mode === 'blocks') {
          self.pendingBlockId = self.pendingBlockId === btn.dataset.zone ? null : btn.dataset.zone;
          self._render();
        } else {
          self._openZoneDetail(btn.dataset.zone);
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
  /* Belegung eines Blocks über alle kaufbaren Kategorien zusammen: Gesamtzahl, freie
     und belegte Plätze. _blockFreeCount liefert dasselbe "frei" pro einzelner
     Kategorie (für die Mengen-Stepper), hier interessiert der ganze Block. */
  SeatPicker.prototype._zoneOccupancy = function (zoneId) {
    var self = this;
    var zone = this._zoneById(zoneId);
    if (!zone) return null;
    var gesamt = 0, belegt = 0;
    this._categoryGroups(zone)
      .filter(function (g) { return self.occupancyExcludeCategories.indexOf(g.category) === -1; })
      .forEach(function (g) {
        g.rows.forEach(function (r) {
          r.seats.forEach(function (seat) {
            gesamt++;
            if (self._isBlocked(seat.seat_guid)) belegt++;
          });
        });
      });
    return { gesamt: gesamt, belegt: belegt, frei: gesamt - belegt };
  };

  /* Auslastung aller Blöcke als Kachelinhalt — nur wenn die Seite ein occupancyEl
     mitgegeben hat. Solange der Sitzstatus noch nicht da ist, stünde hier "alles frei",
     was falscher wäre als keine Zahl — deshalb erst der Ladehinweis. */
  SeatPicker.prototype._renderOccupancy = function () {
    if (!this.occupancyEl) return;
    var self = this;
    if (!this.plan) return;
    if (!this.seatStatusLoaded) {
      this.occupancyEl.innerHTML = '<p class="t-body-sm" style="color:var(--text-muted)">Wird geladen …</p>';
      return;
    }
    // Alphabetisch statt Nord-vor-Süd (D,E,F,A,B,C) — in der Kachel zählt die
    // Lesbarkeit als Liste, nicht die räumliche Anordnung wie in der Blockübersicht.
    var zonen = this.northZones.concat(this.southZones).slice().sort();
    var zeilen = [], gesamtAlle = 0, freiAlle = 0;
    zonen.forEach(function (id) {
      var o = self._zoneOccupancy(id);
      if (!o || !o.gesamt) return;
      var zone = self._zoneById(id);
      gesamtAlle += o.gesamt; freiAlle += o.frei;
      var quote = Math.round((o.frei / o.gesamt) * 100);
      zeilen.push(
        '<li class="seatplan-occupancy-row">' +
          '<span class="seatplan-occupancy-block">' + (zone ? zone.name : id) + '</span>' +
          '<span class="seatplan-occupancy-bar" aria-hidden="true">' +
            '<span style="width:' + (100 - quote) + '%"></span>' +
          '</span>' +
          '<span class="seatplan-occupancy-num">' + o.frei + ' von ' + o.gesamt + ' frei</span>' +
        '</li>'
      );
    });
    if (!zeilen.length) { this.occupancyEl.innerHTML = ''; return; }
    function n(v) { return v.toLocaleString('de-DE'); }
    this.occupancyEl.innerHTML =
      '<ul class="seatplan-occupancy">' + zeilen.join('') + '</ul>' +
      '<p class="t-caption" style="margin:10px 0 0;color:var(--text-muted)">' +
        'Insgesamt noch ' + n(freiAlle) + ' von ' + n(gesamtAlle) + ' Plätzen frei.' +
      '</p>';
  };

  /* Frei verfügbare Plätze einer Kategorie in einem Block — Obergrenze für die
     Mengen-Stepper im Modus "blocks". Belegte Sitze werden abgezogen: vorher zählte
     die Funktion trotz ihres Namens alle Sitze und man hätte theoretisch mehr Tickets
     bestellen können, als der Block noch frei hat. */
  SeatPicker.prototype._blockFreeCount = function (zoneId, category) {
    var self = this;
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

  /* Fügt `qty` Tickets der Hauptkategorie eines Blocks zum Warenkorb hinzu (Tarif
     "normal" als Default, im Warenkorb danach umstellbar) — gemeinsame Grundlage für
     "Übernehmen" in der Übersicht UND die Direktwahl (Block+Anzahl) im Warenkorb. */
  SeatPicker.prototype._quickAddBlock = function (zoneId, qty) {
    var self = this;
    var zone = this._zoneById(zoneId);
    if (!zone) return;
    var groups = this._categoryGroups(zone).filter(function (g) { return self.excludeCategories.indexOf(g.category) === -1; });
    if (!groups.length) return;
    var category = groups[groups.length - 1].category;
    var total = this._blockFreeCount(zoneId, category);
    var priceInfo = this.prices[category] || { normal: 0 };
    var blockKey = zoneId + '::' + category;
    var counts = this.blockCounts[blockKey] || { normal: 0, ermaessigt: 0 };
    var zoneLabel = zone.name + ' - ' + catShortLabel(category);
    this._setBlockCount(blockKey, zoneLabel, category, priceInfo, 'normal', (counts.normal || 0) + qty, total);
  };

  SeatPicker.prototype._addPendingBlock = function () {
    if (!this.pendingBlockId) return;
    this._quickAddBlock(this.pendingBlockId, 1);
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
  SeatPicker.prototype._openZoneDetail = function (zoneId) {
    if (!this.pendingSeats) {
      var copy = {};
      var src = this.selected;
      Object.keys(src).forEach(function (guid) { copy[guid] = src[guid]; });
      this.pendingSeats = copy;
    }
    this.mobileZoneId = zoneId;
    this._render();
  };

  /* Blöcke als Ring in der Reihenfolge der Übersicht (Nord D-E-F, dann Süd A-B-C):
     beide Pfeile sind dadurch immer aktiv, es gibt keine Sackgasse. Blöcke ohne
     kaufbare Kategorie (excludeCategories) werden übersprungen — sie lassen sich in
     der Übersicht auch nicht antippen. */
  SeatPicker.prototype._zoneRing = function () {
    var self = this;
    return this.northZones.concat(this.southZones).filter(function (id) {
      var zone = self._zoneById(id);
      if (!zone) return false;
      return self._categoryGroups(zone).some(function (g) {
        return self.excludeCategories.indexOf(g.category) === -1 && self.prices[g.category];
      });
    });
  };

  SeatPicker.prototype._neighbourZone = function (step) {
    var ring = this._zoneRing();
    var i = ring.indexOf(this.mobileZoneId);
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
    return '<span class="seatplan-pending-label">Deine Auswahl</span>' +
      '<span class="seatplan-pending-seats">' + labels.join(' · ') + '</span>';
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
    // Block-Name + Hauptkategorie stehen hier im Header, NICHT mehr als Labels in der
    // grauen Sitzbox selbst — die Box zeigt nur noch Sitze + Reihennummern. VIP-Anteile
    // (falls vorhanden) werden zusätzlich farblich markiert statt als eigene Legende.
    var groups = this._categoryGroups(zone).filter(function (g) { return self.excludeCategories.indexOf(g.category) === -1; });
    var mainCategory = groups.length ? groups[groups.length - 1].category : '';
    var hasVip = groups.some(function (g) { return g.category === 'VIP'; });
    var priceInfo = self.prices && self.prices[mainCategory];
    var priceText = priceInfo ? (' – ' + fmtEUR(priceInfo.normal) + ' € (' + fmtEUR(priceInfo.ermaessigt) + ' € ermäßigt)') : '';
    /* Pfeile links/rechts vom Blocknamen statt eines Zurück-Pfeils: von hier aus lässt
       sich durch alle Blöcke blättern, ohne jedes Mal in die Übersicht und zurück. Der
       Weg zurück zur Übersicht ist der „Abbrechen"-Button unten links (plus Klick neben
       das Overlay und ESC). */
    var prevZone = this._neighbourZone(-1);
    var nextZone = this._neighbourZone(1);
    header.innerHTML =
      (prevZone
        ? '<button type="button" class="seatplan-mobile-back" data-zone-step="-1" aria-label="Vorheriger Block: ' + this._zoneById(prevZone).name + '"><i data-lucide="chevron-left" class="icon-16"></i></button>'
        : '<span style="width:32px"></span>') +
      '<span class="seatplan-mobile-detail-title">' +
        '<strong class="t-body-sm">' + zone.name + '</strong>' +
        '<span class="t-caption" style="color:var(--text-muted)">' + mainCategory +
          (hasVip ? ' (und <span style="color:rgba(179,57,44,.9)">VIP</span>)' : '') +
          priceText +
        '</span>' +
      '</span>' +
      (nextZone
        ? '<button type="button" class="seatplan-mobile-back" data-zone-step="1" aria-label="Nächster Block: ' + this._zoneById(nextZone).name + '"><i data-lucide="chevron-right" class="icon-16"></i></button>'
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
        self.mobileZoneId = self._neighbourZone(parseInt(btn.dataset.zoneStep, 10));
        self._render();
      });
    });
    cancelBtn.addEventListener('click', function () {
      self.pendingSeats = null;
      self.mobileZoneId = null;
      self._render();
    });
    confirmBtn.addEventListener('click', function () {
      self.selected = self.pendingSeats;
      self.pendingSeats = null;
      self.mobileZoneId = null;
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
      if (!row || !row.segment_gap_seats) return;
      var breaks = row.segment_breaks || [];
      var seatEls = rowEl.querySelectorAll('.seatplan-seat');
      Object.keys(row.segment_gap_seats).forEach(function (segIdxStr) {
        var breakSeatNum = breaks[parseInt(segIdxStr, 10) - 1];
        if (breakSeatNum === undefined) return;
        var seatEl = Array.from(seatEls).find(function (s) { return s.textContent.trim() === String(breakSeatNum); });
        if (!seatEl) return;
        seatEl.style.marginLeft = (row.segment_gap_seats[segIdxStr] * unitPx) + 'px';
      });
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
          return s.textContent === String(num);
        });
      }
      // Die Verschiebungen werden erst gesammelt und dann gemeinsam so normalisiert,
      // dass die kleinste 0 ist (alle Reihen MIT eigenem Fluchtpunkt-Ziel um denselben
      // Betrag mitverschoben — die Ausrichtung untereinander bleibt dadurch erhalten).
      // Grund: eine NEGATIVE Margin lässt die Reihe über die Containerkante
      // hinausragen, und Überlauf nach links zählt nicht in scrollWidth — die
      // automatische Einpassung (_fitZoneScale) würde ihn übersehen und Sitz 1
      // abschneiden.
      // Reihen OHNE eigenes align_target_seat UND ohne Bezugsreihen-Rolle (z.B. Block C
      // Reihe 1-9) bekommen NICHT diesen gemeinsamen Normalisierungs-Shift, sondern
      // bleiben bei 0 — sie haben keinen Fluchtpunkt-Bezug, der sie verschieben müsste,
      // und sollen mit den Reihennummern der Fluchtpunkt-Reihen auf einer Linie liegen
      // (Marko: "Reihe 1 bis 10 noch nach links"). Die Bezugsreihe (align-reference,
      // hier Reihe 10) MUSS dagegen weiter den gemeinsamen Shift bekommen: refOffset
      // (s.o.) wurde aus ihrer ungeshifteten Rohposition berechnet, und die Differenz
      // v_Ziel - v_Referenz muss GENAU dem Rohwert entsprechen, damit die Fluchtpunkte
      // stimmen — das gilt nur, wenn beide Seiten denselben "-min"-Anteil tragen (der
      // sich in der Differenz aufhebt). Nimmt man ihn nur der Referenzreihe weg, bricht
      // die Flucht um exakt "-min" (live gefunden: Reihe 10 Sitz 1 wich 105px von
      // Reihe 11 Sitz 3 ab, bis dieser Fall separat behandelt wurde).
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
          var isReference = row.classList.contains('seatplan-row-line--align-reference');
          var v = byRow.has(row) ? (byRow.get(row) - min) : (isReference ? -min : 0);
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

          // Lücken auf 0 und natürliche Abstände zum Ankersitz messen. Genullt werden
          // muss jeder Sitz, der später eine Lücke tragen kann — also auch die
          // Segmentanfänge, die aus segment_breaks kommen (die tragen aus dem Rendern
          // noch die feste 10px-Lücke).
          var starts = Object.keys(spec).concat([anchorNum]).concat(segStarts.map(String));
          starts.forEach(function (n) { var s = seatIn(row, n); if (s) s.style.marginLeft = '0px'; });
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
              var gapSeat = seatIn(row, gapSeatFor(segNumInt));
              if (gapSeat) gapSeat.style.marginLeft = Math.max(0, -missing) + 'px';
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
      // Reihen mit live_fit (z.B. Block B Reihe 10) bekommen ihre Sitzpositionen NICHT
      // über den Wrapper-Streck-Mechanismus, sondern direkt per Live-Messung (s.u.,
      // runLiveFit) — kein Wrapper-Div, keine space-between-Streckung, sonst würde
      // runLiveFit gegen die falschen (Wrapper-relativen statt Flex-Geschwister-)
      // Margins arbeiten.
      if (row && row.live_fit) return;
      var breaks = (row && row.segment_breaks) || [];
      // Jede match_first_row_width-Reihe bekommt ihre Sitze in einem inneren Wrapper-Div
      // statt direkt als Flex-Kind von rowEl — nur so lässt sich die Sitz-Breite EXAKT
      // auf Reihe 1 abstimmen, ohne die Reihennummern-Labels (auch Flex-Kinder von rowEl,
      // s. _renderZone) versehentlich mitzustrecken. Ohne Segmentgrenzen (segment_breaks
      // leer) ist das genau EIN Wrapper über die volle Breite — deckt damit auch die
      // einfachen Fälle (z.B. Block B Reihe 6-9) mit demselben Code ab. segment_gap_units
      // (nur bei mehreren Segmenten relevant, z.B. Reihe 10, [8,8]) gibt statt der
      // pauschalen kleinen Gang-Lücke einen expliziten, in Einheiten skalierten
      // Zwischenraum zwischen den Segmenten vor.
      var seatEls = Array.from(rowEl.querySelectorAll('.seatplan-seat'));
      var segStarts = [1].concat(breaks);
      var segEnds = breaks.concat([seatEls.length + 1]);
      var segCounts = segStarts.map(function (s, i) { return segEnds[i] - s; });
      var totalCount = segCounts.reduce(function (a, b) { return a + b; }, 0);
      var gapUnitsPx = (row && typeof row.segment_gap_units === 'number' ? row.segment_gap_units : 0) * unitPx;
      // Der ROW-eigene Flex-gap (s. CSS .seatplan-row-line) liegt schon automatisch
      // zwischen je zwei Flex-Kindern (Label/Wrapper) — vom expliziten Zwischenraum
      // abziehen, sonst wäre die Lücke insgesamt zu groß.
      var gapPx = Math.max(0, gapUnitsPx - flexGapPx);
      // targetWidth ist bereits die reine Sitz-Spanne von Reihe 1 (s.o.) — kein
      // Label-Overhead mehr abzuziehen, nur der eigene Segment-Zwischenraum.
      var availableForSeats = targetWidth - gapUnitsPx * (segCounts.length - 1);
      var seatIdx = 0;
      var firstWrapper = null;
      segCounts.forEach(function (count, i) {
        var wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.width = (availableForSeats * count / totalCount) + 'px';
        if (i > 0) wrapper.style.marginLeft = gapPx + 'px';
        else firstWrapper = wrapper;
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
        return s.textContent.trim() === String(seatNum);
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
    runLiveFit('live_fit');
    runLiveStretch('live_stretch');
    zone.rows.forEach(function (row) {
      if (!row.live_shift) return;
      Object.keys(row.live_shift).forEach(function (segIdxStr) {
        var spec = row.live_shift[segIdxStr];
        var anchorEl = findSeatEl(row.row_number, spec.anchor_seat);
        var targetEl = findSeatEl(spec.target_row, spec.target_seat);
        if (!anchorEl || !targetEl) return;
        var delta = targetEl.getBoundingClientRect().left - anchorEl.getBoundingClientRect().left;
        var currentMargin = parseFloat(anchorEl.style.marginLeft) || 0;
        // Kein Math.max(0, …): ein negativer Gesamtversatz ist ebenso legitim wie bei
        // live_stretch (s.o.) — der Zielsitz kann links vom Anker liegen.
        anchorEl.style.marginLeft = (currentMargin + delta) + 'px';
      });
    });
    // live_fit2: wie live_fit, aber erst NACH live_shift/live_stretch — für Reihen, deren
    // Pin-Ziele selbst erst durch Reihe 11s live_stretch ihre finale Position bekommen
    // (Block B Reihe 12, neunte Runde).
    runLiveFit('live_fit2');
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
    var groups = this._categoryGroups(zone).filter(function (g) {
      return self.excludeCategories.indexOf(g.category) === -1;
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
          // vornherein nicht zum freien Verkauf freigegeben.
          btn.textContent = reserved ? 'EA' : (nv ? 'NV' : seat.seat_number);
          // Echte Gang-Lücke innerhalb der Reihe (z. B. "1,2 | 3-22 | 23,24,25") —
          // die Sitznummerierung bleibt über den Gang hinweg durchgehend, nur die
          // Darstellung bekommt hier eine kleine zusätzliche Lücke.
          if (row.segment_breaks && row.segment_breaks.indexOf(parseInt(seat.seat_number, 10)) !== -1) {
            btn.style.marginLeft = '10px';
          }
          if (blockMode) btn.tabIndex = -1;
          btn.dataset.seatGuid = seat.seat_guid;
          var seatLabel = zone.name + ', Reihe ' + rowLabel + ', Platz ' + seat.seat_number + (isWheelchair ? ' (Rollstuhlplatz)' : '');
          btn.setAttribute('aria-label', seatLabel + (reserved ? ' (reserviert für Ehrenamtliche)' : nv ? ' (nicht verfügbar)' : taken ? ' (vergeben)' : ' (frei)'));
          if (taken || reserved || nv || blockMode) {
            btn.disabled = true;
          } else if (self.prices[category]) {
            btn.addEventListener('click', function () {
              self._toggleSeat(btn, seat.seat_guid, zone.name, rowLabel, seat.seat_number, category, priceInfo);
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

    function stepperRow(tarif, tarifLabel, price) {
      var row = document.createElement('div');
      row.className = 'seatplan-stepper-row';
      row.innerHTML =
        '<span>' + tarifLabel + ' <strong>' + fmtEUR(price) + ' €</strong></span>' +
        '<span class="seatplan-stepper">' +
          '<button type="button" data-step="-1" data-zone="' + blockKey + '" data-tarif="' + tarif + '" aria-label="weniger ' + tarifLabel + '">−</button>' +
          '<input type="number" inputmode="numeric" min="0" max="' + freeCount + '" value="0" ' +
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
    var counts = this.blockCounts[blockKey] || { normal: 0, ermaessigt: 0 };
    this._setBlockCount(blockKey, zoneLabel, category, priceInfo, tarif, counts[tarif] + delta, freeCount);
  };

  /* Direkte Zahleneingabe im Stepper — ermöglicht Bulk-Buchungen (z. B. 50
     Tickets auf einmal), ohne 50× auf "+" klicken zu müssen. Wert wird auf
     [0, verbleibende freie Plätze im Block minus bereits anderer Tarif] begrenzt.
     blockKey ist zoneId + "::" + category, damit ein Block mit mehreren
     Kategorien (z. B. Block B: VIP-Reihe + Kategorie-II-Reihen) getrennt zählt. */
  SeatPicker.prototype._setBlockCount = function (blockKey, zoneLabel, category, priceInfo, tarif, value, freeCount) {
    var counts = this.blockCounts[blockKey] || { normal: 0, ermaessigt: 0 };
    var otherTarif = tarif === 'normal' ? 'ermaessigt' : 'normal';
    var maxForTarif = Math.max(0, freeCount - (counts[otherTarif] || 0));
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

  /* Baut einen sprechenden Label-Text aus der normalisierten Antwort des
     Gutschein-Webhooks (s. VOUCHER_CHECK_URL) — für die Warenkorb-Anzeige. */
  function labelForVoucherInfo(info) {
    if (info.source === 'giftcard') return info.code + ' (Guthaben ' + fmtEUR(info.balance) + ' €)';
    var amount = info.priceMode === 'percent' ? (info.value + ' %')
      : info.priceMode === 'set' ? ('Preis ' + fmtEUR(info.value) + ' €')
      : (fmtEUR(info.value) + ' €');
    return info.code + ' (' + amount + (info.category ? ', ' + info.category : '') + ')';
  }

  /* Gutschein-/Wertgutschein-Code — gemeinsam für "seats"- und "blocks"-Modus,
     wird wie der Nachwuchsbeitrag nur angezeigt, wenn der Warenkorb nicht leer
     ist. Die Prüfung läuft serverseitig (VOUCHER_CHECK_URL, echte pretix-Daten),
     deshalb async mit kurzem Lade-Zustand statt eines sofortigen Ergebnisses. */
  SeatPicker.prototype._appendVoucherRow = function () {
    var self = this;
    var wrap = document.createElement('div');
    wrap.className = 'seatplan-voucher-row';

    if (this.voucherInfo) {
      wrap.innerHTML =
        '<div class="seatplan-voucher-applied">' +
          '<span><i data-lucide="tag" style="width:14px;height:14px"></i> Gutschein ' + this.voucherInfo.label + '</span>' +
          '<button type="button" data-voucher-remove>entfernen</button>' +
        '</div>';
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
            if (result && result.valid) {
              var category = (result.itemId != null && self.pretixItemCategoryMap[result.itemId]) || null;
              var info = {
                source: result.source, code: result.code, priceMode: result.priceMode, value: result.value,
                category: category, remainingUses: result.remainingUses != null ? result.remainingUses : null,
                balance: result.balance != null ? result.balance : null
              };
              info.label = labelForVoucherInfo(info);
              self.voucherCode = result.code;
              self.voucherInfo = info;
              self.voucherError = null;
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

  /* Live-Vorschau der aktuellen Auswahl direkt im Spielfeld-Bereich (neben der
     Legende) — Reihe+Platz bei "seats", Anzahl je Block bei "blocks". */
  SeatPicker.prototype._updateCourtSelection = function () {
    var el = this.courtSelectionEl;
    if (!el) return;
    var self = this;
    var lines = [];
    if (this.mode === 'blocks') {
      Object.keys(this.blockCounts).forEach(function (key) {
        var c = self.blockCounts[key];
        var qty = (c.normal || 0) + (c.ermaessigt || 0);
        if (qty > 0) lines.push(qty + '× ' + c.zoneLabel);
      });
    } else {
      Object.keys(this.selected).forEach(function (guid) {
        var s = self.selected[guid];
        lines.push(s.zoneLabel + ', Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber);
      });
    }
    if (lines.length === 0) {
      el.textContent = '';
    } else if (lines.length <= 4) {
      el.textContent = 'Deine Auswahl: ' + lines.join(' · ');
    } else {
      el.textContent = 'Deine Auswahl: ' + lines.length + ' Plätze';
    }
  };

  SeatPicker.prototype._renderCart = function () {
    this._updateCourtSelection();
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
        var tarifOptions = ['normal'].concat(hasErmaessigt ? ['ermaessigt'] : []);
        if (self.dkDiscount) {
          tarifOptions = tarifOptions.concat(['normal_member'], hasErmaessigt ? ['ermaessigt_member'] : []);
        }
        row.innerHTML =
          '<div>' + s.zoneLabel + ' · Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber +
          '<br><span class="t-caption">' + self._dkBreakdownText(s.priceInfo, s.tarif) + '</span>' +
          (tarifOptions.length > 1 ? '<br><select data-tarif="' + guid + '" class="seatplan-tarif-select">' +
            tarifOptions.map(function (t) {
              return '<option value="' + t + '"' + (s.tarif === t ? ' selected' : '') + '>' + DK_TARIF_LABELS[t] + '</option>';
            }).join('') +
            '</select>' : '') +
          '</div>' +
          '<div class="seatplan-cart-item-right seatplan-cart-item-right-removable"><span>' + fmtEUR(s.price) + ' €</span>' +
          '<button type="button" data-remove="' + guid + '">entfernen</button></div>';
        self.cartEl.appendChild(row);
      });

      this._appendNachwuchsRow();
      this._appendVoucherRow();
      this._appendNotizRow();
      this.ctaEl.disabled = false;

      this.cartEl.querySelectorAll('[data-tarif]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var guid = this.dataset.tarif;
          var s = self.selected[guid];
          s.tarif = this.value;
          s.price = self._dkTarifPrice(s.priceInfo, s.tarif);
          self._renderCart();
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
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && guids.length > 0 && !this._voucherIsFullComp()) total += this.nachwuchsAmount;
    total -= this._voucherDiscount(total);
    this.totalEl.textContent = fmtEUR(total) + ' €';
  };

  /* Direkte Block+Anzahl-Wahl im Warenkorb selbst — Alternative zum Antippen im Bild
     oben, für Nutzer, die schon wissen, welchen Block sie wollen. Nur sichtbar, solange
     der Warenkorb noch leer ist (reine Einstiegshilfe, kein Dauer-UI-Element). */
  SeatPicker.prototype._renderDirectAddRow = function () {
    var self = this;
    var options = this.northZones.concat(this.southZones).map(function (id) {
      var zone = self._zoneById(id);
      if (!zone) return '';
      var groups = self._categoryGroups(zone).filter(function (g) { return self.excludeCategories.indexOf(g.category) === -1; });
      if (!groups.length) return '';
      return '<option value="' + id + '">Block ' + id + '</option>';
    }).join('');
    if (!options) return;
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
      var zoneId = wrap.querySelector('#seatplan-direct-block').value;
      var qty = parseInt(wrap.querySelector('#seatplan-direct-qty').value, 10);
      if (!zoneId || !qty || qty < 1) return;
      self._quickAddBlock(zoneId, qty);
    });
  };

  SeatPicker.prototype._renderCartBlocks = function () {
    var self = this;
    var lines = [];
    Object.keys(this.blockCounts).forEach(function (blockKey) {
      var c = self.blockCounts[blockKey];
      if (c.normal > 0) lines.push({ blockKey: blockKey, tarif: 'normal', label: 'Normalpreis', count: c.normal, price: c.priceInfo.normal, zoneLabel: c.zoneLabel });
      if (c.ermaessigt > 0) lines.push({ blockKey: blockKey, tarif: 'ermaessigt', label: 'Ermäßigt', count: c.ermaessigt, price: c.priceInfo.ermaessigt, zoneLabel: c.zoneLabel });
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
        var hasErmaessigt = self.blockCounts[l.blockKey].priceInfo.ermaessigt !== undefined;
        var freeCount = self._blockFreeCount(l.blockKey.split('::')[0], self.blockCounts[l.blockKey].category);
        row.innerHTML =
          '<div>' + l.zoneLabel +
          '<br><span class="t-caption">' + fmtEUR(l.price) + ' € je Ticket</span>' +
          (hasErmaessigt ? '<br><select class="seatplan-tarif-select" data-block-tarif-select data-zone="' + l.blockKey + '" data-tarif="' + l.tarif + '">' +
            '<option value="normal"' + (l.tarif === 'normal' ? ' selected' : '') + '>Normalpreis</option>' +
            '<option value="ermaessigt"' + (l.tarif === 'ermaessigt' ? ' selected' : '') + '>Ermäßigt</option>' +
            '</select>' : '<br><span class="t-caption">' + l.label + '</span>') +
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
          counts[newTarif] = (counts[newTarif] || 0) + counts[oldTarif];
          counts[oldTarif] = 0;
          self._renderCart();
        });
      });
    }

    var total = lines.reduce(function (sum, l) { return sum + l.count * l.price; }, 0);
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && ticketCount > 0 && !this._voucherIsFullComp()) total += this.nachwuchsAmount;
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
        ['normal', 'ermaessigt'].forEach(function (tarif) {
          var count = c[tarif];
          if (count > 0) {
            var price = tarif === 'ermaessigt' ? c.priceInfo.ermaessigt : c.priceInfo.normal;
            lines.push({
              label: c.zoneLabel + ' · ' + (tarif === 'ermaessigt' ? 'Ermäßigt' : 'Normalpreis'),
              qty: count, unitPrice: price, lineTotal: count * price,
              // Maschinenlesbar für die pretix-Order (n8n): im Blockmodus wählt der
              // Käufer keinen konkreten Sitz, sondern Block + Kategorie + Anzahl.
              // Welche Sitze das konkret werden, entscheidet der Bestell-Workflow —
              // pretix verlangt bei bestuhlten Events pro Ticket einen echten Sitz.
              type: 'block', zoneLabel: c.zoneLabel, category: c.category, tarif: tarif
            });
            total += count * price;
          }
        });
      });
      var ticketCount = lines.reduce(function (sum, l) { return sum + l.qty; }, 0);
      var nachwuchsAmount = 0;
      if (this.nachwuchsBeitrag && this.nachwuchsChecked && ticketCount > 0 && !this._voucherIsFullComp()) {
        nachwuchsAmount = this.nachwuchsAmount;
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
        // category/tarif bestimmen dort Item+Variation, seatGuid den Sitz.
        type: 'seat', seatGuid: guid, category: s.category, tarif: s.tarif
      });
      total += s.price;
    });
    var nwAmount = 0;
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && lines.length > 0 && !this._voucherIsFullComp()) {
      nwAmount = this.nachwuchsAmount;
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
      lines.push({ label: 'Gutschein ' + this.voucherInfo.label, qty: 1, unitPrice: -discount, lineTotal: -discount });
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
      voucher: discount > 0 ? { code: this.voucherCode, label: this.voucherInfo.label, amount: discount } : null,
      notiz: this.notiz || ''
    };
  };

  window.SeatPicker = SeatPicker;
})();
