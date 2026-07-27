/* Wiederverwendbare Sitzplatzwahl für Einzelticket- und Dauerkarten-Detailseite.
   Lädt den echten, pretix-schema-konformen Saalplan aus assets/seating/ und rendert
   ihn als Block-Grid. Verfügbarkeit ist bis zur echten pretix-Anbindung noch nicht
   live geprüft — alle Plätze gelten vorerst als frei (keine echten Bestellungen
   vorhanden). Kein Limit an wählbaren Plätzen pro Bestellung.

   Zwei Modi:
   - "seats" (Dauerkarte): einzelne Sitze sind klickbar, fester Platz für die Saison.
   - "blocks" (Einzelticket): nur der Block ist wählbar (Anzahl je Tarif), die Sitze
     im Block sind rein dekorativ (First-Come-First-Serve-Platzwahl vor Ort). */
(function () {
  'use strict';

  function fmtEUR(n) { return n.toFixed(2).replace('.', ','); }

  function catClass(category) {
    if (category === 'Kategorie I') return 'cat-kat1';
    if (category === 'Kategorie II') return 'cat-kat2';
    if (category === 'VIP') return 'cat-vip';
    return '';
  }

  /* Gutschein-Codes sind noch nicht an pretix angebunden — feste Testcodes,
     damit sich der Ablauf schon jetzt echt durchklicken lässt. Dieselben Codes
     wie auf der Checkout-Seite (tickets/checkout.html). */
  var MOCK_VOUCHERS = {
    'LOEWEN10': { type: 'percent', value: 10, label: 'LOEWEN10 (10 %)' },
    'WILLKOMMEN5': { type: 'fixed', value: 5, label: 'WILLKOMMEN5 (5 €)' }
  };

  function SeatPicker(root, opts) {
    this.root = root;
    this.mode = opts.mode || 'seats';
    this.planUrl = opts.planUrl;
    this.prices = opts.prices; // { "Kategorie I": {normal: 19, ermaessigt: 12}, "Kategorie II": {...} }
    this.northZones = opts.northZones; // z.B. ["D", "E", "F"]
    this.southZones = opts.southZones; // z.B. ["A", "B", "C"]
    this.excludeCategories = opts.excludeCategories || []; // z.B. ["VIP"] — Reihen dieser Kategorie werden gar nicht angezeigt (kein Produkt dafür)
    this.cartEl = opts.cartEl;
    this.totalEl = opts.totalEl;
    this.ctaEl = opts.ctaEl;
    this.onContinue = opts.onContinue || function () {};
    this.nachwuchsBeitrag = !!opts.nachwuchsBeitrag; // Pauschale pro Bestellung, standardmäßig an, unabhängig von Anzahl Plätze/Tickets
    this.nachwuchsAmount = opts.nachwuchsAmount || 2;
    this.nachwuchsChecked = true;
    this.selected = {}; // seat_guid -> {...} (Modus "seats")
    this.blockCounts = {}; // zone_id -> { normal: n, ermaessigt: n } (Modus "blocks")
    this.voucherCode = null;
    this.voucherInfo = null;
    this.voucherError = null;
    this.notiz = '';
    this._load();
  }

  /* Rabatt für einen gegebenen Zwischensumme-Betrag (Tickets + Nachwuchsbeitrag),
     gemeinsam für "seats"- und "blocks"-Modus sowie für getSummary(). */
  SeatPicker.prototype._voucherDiscount = function (base) {
    if (!this.voucherInfo || base <= 0) return 0;
    var d = this.voucherInfo.type === 'percent' ? (base * this.voucherInfo.value / 100) : this.voucherInfo.value;
    return Math.min(Math.round(d * 100) / 100, base);
  };

  SeatPicker.prototype._load = function () {
    var self = this;
    fetch(this.planUrl).then(function (r) { return r.json(); }).then(function (plan) {
      self.plan = plan;
      self.blocks = self._deriveBlocks(plan);
      self._render();
    }).catch(function (err) {
      self.root.innerHTML = '<p class="t-body-sm" style="color:#b3392c">Sitzplan konnte nicht geladen werden.</p>';
      console.error('Sitzplan-Fehler', err);
    });
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

  SeatPicker.prototype._render = function () {
    var self = this;
    var northRow = document.createElement('div');
    northRow.className = 'seatplan-row';
    var southRow = document.createElement('div');
    southRow.className = 'seatplan-row';

    // _renderZone gibt null zurück, wenn ein Block nach excludeCategories keine
    // verkäuflichen Reihen mehr hat (z. B. Block B ist beim Einzelticket komplett VIP
    // und damit komplett ausgeschlossen) — dann wird die Karte gar nicht erst angezeigt,
    // statt als leere graue Box mit nur dem Block-Namen zu erscheinen.
    this.northZones.forEach(function (id) {
      var el = self._renderZone(self._zoneById(id));
      if (el) northRow.appendChild(el);
    });
    this.southZones.forEach(function (id) {
      var el = self._renderZone(self._zoneById(id));
      if (el) southRow.appendChild(el);
    });

    // Eine einzige, zeilenbündige Legende: erst die Kategorie-Farben (nur die auf dieser
    // Seite tatsächlich angebotenen — excludeCategories berücksichtigt, z. B. kein VIP
    // beim Einzelticket), dann Status. "Frei" braucht kein eigenes Symbol — alles, was
    // nicht blau markiert ist, ist frei.
    var catOrder = ['Kategorie I', 'Kategorie II', 'VIP'];
    var catItems = catOrder.filter(function (c) { return self.prices[c] && self.excludeCategories.indexOf(c) === -1; })
      .map(function (c) { return '<span class="' + catClass(c) + '"><i></i> ' + c + '</span>'; })
      .join('');

    var legendHtml = this.mode === 'blocks'
      ? '<div class="seatplan-legend">' + catItems +
          '<span class="fcfs">First come, first serve</span>' +
        '</div>'
      : '<div class="seatplan-legend">' + catItems +
          '<span class="taken"><i></i> vergeben</span>' +
          '<span class="sel"><i></i> deine Auswahl</span>' +
        '</div>';
    var caption = this.mode === 'blocks'
      ? '<p class="t-caption" style="margin-top:10px;color:var(--text-muted)">Nur mit der Dauerkarte sicherst du dir einen festen Sitzplatz.</p>'
      : '';

    this.root.innerHTML =
      '<div class="seatplan-strip">Nordtribüne</div>' +
      '<div id="seatplan-north"></div>' +
      '<div class="seatplan-court-area">' +
        '<div class="seatplan-side-strip stehblock">Stehblock</div>' +
        '<div class="seatplan-side-strip entrance"></div>' +
        '<div class="seatplan-court"><span>Spielfeld</span>' + legendHtml +
          '<p class="seatplan-court-selection" id="seatplan-court-selection"></p>' +
        '</div>' +
        '<div class="seatplan-side-strip entrance"></div>' +
      '</div>' +
      '<div id="seatplan-south" style="margin-top:14px"></div>' +
      '<div class="seatplan-strip seatplan-strip-south">Südtribüne</div>' +
      caption;

    document.getElementById('seatplan-north').appendChild(northRow);
    document.getElementById('seatplan-south').appendChild(southRow);
    this.courtSelectionEl = document.getElementById('seatplan-court-selection');
    this._renderCart();
  };

  SeatPicker.prototype._renderZone = function (zone) {
    var self = this;
    var groups = this._categoryGroups(zone).filter(function (g) {
      return self.excludeCategories.indexOf(g.category) === -1;
    });
    if (groups.length === 0) return null;
    var singleCategory = groups.length === 1 ? groups[0].category : null;
    var isCat1 = singleCategory === 'Kategorie I';

    var wrap = document.createElement('div');
    wrap.className = 'seatplan-block' + (isCat1 ? ' cat1' : '');

    var label = document.createElement('div');
    label.className = 'seatplan-block-label';
    label.textContent = zone.name;
    wrap.appendChild(label);

    var blockMode = this.mode === 'blocks';

    groups.forEach(function (group, gIdx) {
      var category = group.category;
      var priceInfo = self.prices[category] || { normal: 0 };

      // VIP-Label wird im Block selbst nicht wiederholt — die Farbe steht schon in der
      // Legende im Spielfeld-Bereich; Kategorie I/II bleibt beschriftet, u. a. damit
      // Blöcke wie A/C, wo sich die Kategorie gar nicht ändert, denselben Lücken-Abstand
      // UND dieselbe Beschriftung wie Block B bekommen (rein optischer section_break).
      if (category !== 'VIP') {
        var catEl = document.createElement('div');
        catEl.className = 'seatplan-block-cat';
        if (gIdx > 0) catEl.style.marginTop = '10px';
        catEl.textContent = category;
        wrap.appendChild(catEl);
      } else if (gIdx > 0) {
        var spacer = document.createElement('div');
        spacer.style.marginTop = '10px';
        wrap.appendChild(spacer);
      }

      // Jede Reihe ist eine eigene, zentrierte Flex-Zeile (nicht ein einziges CSS-Grid für
      // den ganzen Block) — reale Reihen sind unterschiedlich breit (siehe echter Saalplan),
      // ein gemeinsames Grid mit fester Spaltenzahl würde kürzere Reihen links abschneiden
      // bzw. mit der nächsten Reihe verschmelzen lassen statt sie sauber zu zentrieren.
      var cols = Math.max.apply(null, group.rows.map(function (r) { return r.seats.length; }));
      var gridWrap = document.createElement('div');
      gridWrap.className = 'seatplan-grid-wrap';
      // +2×(14px Reihennummer + 2px Abstand) für die Labels links/rechts jeder Reihe.
      gridWrap.style.width = (cols * 10 - 2 + 2 * 16) + 'px';

      // Reihe 3 (19 Plätze) ist im Original schmaler als Reihe 12/1 (Blockbreite = cols),
      // liegt aber selbst zentriert im Block — d. h. ihr Rand hat bereits einen eigenen
      // Abstand zur Blockkante. Reihen 4+5 (12 Plätze) müssen bündig an GENAU DIESEM Rand
      // von Reihe 3 abschließen, nicht an der äußersten Blockkante (das war der Fehler
      // zuvor: align-self:flex-end allein richtet an der Blockkante aus, nicht an Reihe 3).
      var row3 = group.rows.filter(function (r) { return r.row_number === '3'; })[0];
      var row3Gap = row3 ? (cols - row3.seats.length) / 2 * 10 : 0;

      var freeCount = 0;
      group.rows.forEach(function (row) {
        var rowLabel = row.row_label || row.row_number;
        var rowEl = document.createElement('div');
        rowEl.className = 'seatplan-row-line';
        // Reihen 4+5 in A/B/C sind schmaler als die Reihen darüber (1-3) und liegen im
        // Original nicht mittig, sondern bündig zu einer Seite von Reihe 3
        // (A/B: rechte Seite, C spiegelverkehrt: linke Seite) — statt sie wie alle
        // anderen Reihen zu zentrieren, exakt an Reihe 3s Rand ausrichten.
        if ((zone.zone_id === 'A' || zone.zone_id === 'B') && (row.row_number === '4' || row.row_number === '5')) {
          rowEl.style.alignSelf = 'flex-end';
          rowEl.style.marginRight = row3Gap + 'px';
        } else if (zone.zone_id === 'C' && (row.row_number === '4' || row.row_number === '5')) {
          rowEl.style.alignSelf = 'flex-start';
          rowEl.style.marginLeft = row3Gap + 'px';
        }
        // Reihennummer links UND rechts an der Reihe, wie im Original-Saalplan.
        var rowNumLeft = document.createElement('span');
        rowNumLeft.className = 'seatplan-row-num';
        rowNumLeft.textContent = rowLabel;
        rowEl.appendChild(rowNumLeft);
        row.seats.forEach(function (seat, cIdx) {
          var taken = false; // Noch keine echten Bestellungen — keine Plätze vorab als vergeben markieren.
          if (!taken) freeCount++;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'seatplan-seat ' + catClass(category) + (taken ? ' taken' : '');
          // Echte Gang-Lücke innerhalb der Reihe (z. B. "1,2 | 3-22 | 23,24,25") —
          // die Sitznummerierung bleibt über den Gang hinweg durchgehend, nur die
          // Darstellung bekommt hier eine kleine zusätzliche Lücke.
          if (row.segment_breaks && row.segment_breaks.indexOf(parseInt(seat.seat_number, 10)) !== -1) {
            btn.style.marginLeft = '6px';
          }
          if (blockMode) btn.tabIndex = -1;
          btn.dataset.seatGuid = seat.seat_guid;
          var seatLabel = zone.name + ', Reihe ' + rowLabel + ', Platz ' + seat.seat_number;
          btn.setAttribute('aria-label', seatLabel + (taken ? ' (vergeben)' : ' (frei)'));
          if (taken || blockMode) {
            btn.disabled = true;
          } else if (self.prices[category]) {
            btn.addEventListener('click', function () {
              self._toggleSeat(seat.seat_guid, zone.name, rowLabel, seat.seat_number, category, priceInfo);
            });
          }
          rowEl.appendChild(btn);
        });
        var rowNumRight = document.createElement('span');
        rowNumRight.className = 'seatplan-row-num';
        rowNumRight.textContent = rowLabel;
        rowEl.appendChild(rowNumRight);
        gridWrap.appendChild(rowEl);
      });
      wrap.appendChild(gridWrap);

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

  SeatPicker.prototype._toggleSeat = function (guid, zoneLabel, rowLabel, seatNumber, category, priceInfo) {
    var btn = this.root.querySelector('.seatplan-seat[data-seat-guid="' + guid + '"]');
    if (this.selected[guid]) {
      delete this.selected[guid];
      btn.classList.remove('selected');
    } else {
      this.selected[guid] = {
        zoneLabel: zoneLabel, rowLabel: rowLabel, seatNumber: seatNumber,
        category: category, tarif: 'normal', price: priceInfo.normal, priceInfo: priceInfo
      };
      btn.classList.add('selected');
    }
    this._renderCart();
  };

  /* Nachwuchsbeitrag ist eine Pauschale pro Bestellung (nicht pro Platz/Ticket),
     standardmäßig aktiviert, mit Opt-out-Checkbox. Wird nur angezeigt, wenn der
     Warenkorb nicht leer ist. Gemeinsam für "seats"- und "blocks"-Modus. */
  SeatPicker.prototype._appendNachwuchsRow = function () {
    var self = this;
    if (!this.nachwuchsBeitrag) return;
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

  /* Gutschein-Code — gemeinsam für "seats"- und "blocks"-Modus, wird wie der
     Nachwuchsbeitrag nur angezeigt, wenn der Warenkorb nicht leer ist. */
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
          '<input type="text" placeholder="Gutscheincode" id="seatplan-voucher-input">' +
          '<button type="button" data-voucher-apply>Einlösen</button>' +
        '</div>' +
        (this.voucherError ? '<p class="seatplan-voucher-error">' + this.voucherError + '</p>' : '');
      this.cartEl.appendChild(wrap);
      var input = wrap.querySelector('#seatplan-voucher-input');
      var apply = function () {
        var code = input.value.trim().toUpperCase();
        if (!code) return;
        var match = MOCK_VOUCHERS[code];
        if (match) {
          self.voucherCode = code;
          self.voucherInfo = match;
          self.voucherError = null;
        } else {
          self.voucherError = 'Dieser Gutscheincode ist ungültig.';
        }
        self._renderCart();
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
        row.innerHTML =
          '<div>' + s.zoneLabel + ' · Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber +
          '<br><span class="t-caption">' + fmtEUR(s.price) + ' € je Ticket</span>' +
          (hasErmaessigt ? '<br><select data-tarif="' + guid + '" class="seatplan-tarif-select">' +
            '<option value="normal"' + (s.tarif === 'normal' ? ' selected' : '') + '>Normalpreis</option>' +
            '<option value="ermaessigt"' + (s.tarif === 'ermaessigt' ? ' selected' : '') + '>Ermäßigt</option>' +
            '</select>' : '') +
          '</div>' +
          '<div class="seatplan-cart-item-right"><span>' + fmtEUR(s.price) + ' €</span>' +
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
          s.price = this.value === 'ermaessigt' ? s.priceInfo.ermaessigt : s.priceInfo.normal;
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
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && guids.length > 0) total += this.nachwuchsAmount;
    total -= this._voucherDiscount(total);
    this.totalEl.textContent = fmtEUR(total) + ' €';
  };

  SeatPicker.prototype._renderCartBlocks = function () {
    var self = this;
    var lines = [];
    Object.keys(this.blockCounts).forEach(function (zoneId) {
      var c = self.blockCounts[zoneId];
      if (c.normal > 0) lines.push({ zoneId: zoneId, tarif: 'normal', label: 'Normalpreis', count: c.normal, price: c.priceInfo.normal, zoneLabel: c.zoneLabel });
      if (c.ermaessigt > 0) lines.push({ zoneId: zoneId, tarif: 'ermaessigt', label: 'Ermäßigt', count: c.ermaessigt, price: c.priceInfo.ermaessigt, zoneLabel: c.zoneLabel });
    });
    var ticketCount = lines.reduce(function (sum, l) { return sum + l.count; }, 0);

    if (lines.length === 0) {
      this.cartEl.innerHTML = '<div class="seatplan-cart-empty">Noch keine Tickets ausgewählt.</div>';
      this.ctaEl.disabled = true;
    } else {
      this.cartEl.innerHTML = '';
      lines.forEach(function (l) {
        var row = document.createElement('div');
        row.className = 'seatplan-cart-item';
        var hasErmaessigt = l.zoneId && self.blockCounts[l.zoneId].priceInfo.ermaessigt !== undefined;
        row.innerHTML =
          '<div>' + l.count + '× ' + l.zoneLabel +
          '<br><span class="t-caption">' + fmtEUR(l.price) + ' € je Ticket</span>' +
          (hasErmaessigt ? '<br><select class="seatplan-tarif-select" data-block-tarif-select data-zone="' + l.zoneId + '" data-tarif="' + l.tarif + '">' +
            '<option value="normal"' + (l.tarif === 'normal' ? ' selected' : '') + '>Normalpreis</option>' +
            '<option value="ermaessigt"' + (l.tarif === 'ermaessigt' ? ' selected' : '') + '>Ermäßigt</option>' +
            '</select>' : '<br><span class="t-caption">' + l.label + '</span>') +
          '</div>' +
          '<div class="seatplan-cart-item-right"><span>' + fmtEUR(l.count * l.price) + ' €</span>' +
          '<button type="button" data-block-remove="' + l.zoneId + '" data-block-tarif="' + l.tarif + '">entfernen</button></div>';
        self.cartEl.appendChild(row);
      });

      this._appendNachwuchsRow();
      this._appendVoucherRow();
      this._appendNotizRow();
      this.ctaEl.disabled = false;

      this.cartEl.querySelectorAll('[data-block-tarif-select]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var zoneId = this.dataset.zone;
          var oldTarif = this.dataset.tarif;
          var newTarif = this.value;
          if (newTarif === oldTarif) return;
          var counts = self.blockCounts[zoneId];
          var moved = counts[oldTarif];
          counts[oldTarif] = 0;
          counts[newTarif] = (counts[newTarif] || 0) + moved;
          var oldInput = self.root.querySelector('[data-count="' + zoneId + '-' + oldTarif + '"]');
          if (oldInput) oldInput.value = '0';
          var newInput = self.root.querySelector('[data-count="' + zoneId + '-' + newTarif + '"]');
          if (newInput) newInput.value = String(counts[newTarif]);
          self._renderCart();
        });
      });
      this.cartEl.querySelectorAll('[data-block-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var zoneId = this.dataset.blockRemove;
          var tarif = this.dataset.blockTarif;
          self.blockCounts[zoneId][tarif] = 0;
          var input = self.root.querySelector('[data-count="' + zoneId + '-' + tarif + '"]');
          if (input) input.value = '0';
          self._renderCart();
        });
      });
    }

    var total = lines.reduce(function (sum, l) { return sum + l.count * l.price; }, 0);
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && ticketCount > 0) total += this.nachwuchsAmount;
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
      Object.keys(this.blockCounts).forEach(function (zoneId) {
        var c = self.blockCounts[zoneId];
        ['normal', 'ermaessigt'].forEach(function (tarif) {
          var count = c[tarif];
          if (count > 0) {
            var price = tarif === 'ermaessigt' ? c.priceInfo.ermaessigt : c.priceInfo.normal;
            lines.push({
              label: c.zoneLabel + ' · ' + (tarif === 'ermaessigt' ? 'Ermäßigt' : 'Normalpreis'),
              qty: count, unitPrice: price, lineTotal: count * price
            });
            total += count * price;
          }
        });
      });
      var ticketCount = lines.reduce(function (sum, l) { return sum + l.qty; }, 0);
      var nachwuchsAmount = 0;
      if (this.nachwuchsBeitrag && this.nachwuchsChecked && ticketCount > 0) {
        nachwuchsAmount = this.nachwuchsAmount;
        lines.push({ label: 'Unterstützung für den Nachwuchs', qty: 1, unitPrice: nachwuchsAmount, lineTotal: nachwuchsAmount });
        total += nachwuchsAmount;
      }
      return this._applyVoucherToSummary(lines, total, nachwuchsAmount);
    }

    Object.keys(this.selected).forEach(function (guid) {
      var s = self.selected[guid];
      lines.push({
        label: s.zoneLabel + ' · Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber + ' · ' + (s.tarif === 'ermaessigt' ? 'Ermäßigt' : 'Normalpreis'),
        qty: 1, unitPrice: s.price, lineTotal: s.price
      });
      total += s.price;
    });
    var nwAmount = 0;
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && lines.length > 0) {
      nwAmount = this.nachwuchsAmount;
      lines.push({ label: 'Unterstützung für den Nachwuchs', qty: 1, unitPrice: nwAmount, lineTotal: nwAmount });
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
