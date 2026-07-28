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

  /* Gutschein-Codes sind noch nicht an pretix angebunden — feste Testcodes,
     damit sich der Ablauf schon jetzt echt durchklicken lässt. Dieselben Codes
     wie auf der Checkout-Seite (tickets/checkout.html). */
  var MOCK_VOUCHERS = {
    'LOEWEN10': { type: 'percent', value: 10, label: 'LOEWEN10 (10 %)' },
    'WILLKOMMEN5': { type: 'fixed', value: 5, label: 'WILLKOMMEN5 (5 €)' }
  };

  /* Dauerkarte-Tarife inkl. Vereinsrabatt — nur relevant, wenn opts.dauerkarteDiscount
     gesetzt ist (Einzelticket bleibt unberührt, dort bleibt es bei normal/ermaessigt). */
  var DK_TARIF_LABELS = {
    normal: 'Normalpreis',
    ermaessigt: 'Ermäßigt',
    normal_member: 'Normalpreis mit Vereinsrabatt',
    ermaessigt_member: 'Ermäßigt mit Vereinsrabatt'
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
    this.cartEl = opts.cartEl;
    this.totalEl = opts.totalEl;
    this.ctaEl = opts.ctaEl;
    // Modus "seats": Block-Detailansicht (alle Sitze eines Blocks) öffnet groß in einem
    // separaten Overlay statt im kompakten Inline-Bereich, damit auch breite Blöcke
    // (bis zu 28 Sitze/Reihe) ohne Scrollen komplett sichtbar sind. Optional — ohne
    // diese Optionen rendert die Detailansicht wie zuvor inline in `root`.
    this.detailBackdropEl = opts.detailBackdropEl || null;
    this.detailRootEl = opts.detailRootEl || null;
    this.onContinue = opts.onContinue || function () {};
    this.mobileZoneId = null; // Modus "seats": null = Block-Übersicht, sonst gewählter Block (Sitzdetail offen)
    this.pendingBlockId = null; // Modus "blocks": per Tippen in der Übersicht markierter, noch nicht übernommener Block
    this.nachwuchsBeitrag = !!opts.nachwuchsBeitrag; // Pauschale pro Bestellung, standardmäßig an, unabhängig von Anzahl Plätze/Tickets
    this.nachwuchsAmount = opts.nachwuchsAmount || 2;
    this.nachwuchsChecked = true;
    this.selected = {}; // seat_guid -> {...} (Modus "seats")
    this.blockCounts = {}; // zone_id -> { normal: n, ermaessigt: n } (Modus "blocks")
    this.voucherCode = null;
    this.voucherInfo = null;
    this.voucherError = null;
    this.notiz = '';
    /* Dauerkarte: Frühbucher (automatisch, für alle) + Vereinsmitglieder (30 %,
       Nachweis nötig, als eigene Tarif-Option wählbar). Kombinierbar bis zum
       Frühbucher-Stichtag ("zusammen 50 %"), danach nur noch der Mitgliedsrabatt. */
    this.dkDiscount = opts.dauerkarteDiscount || null;
    this._load();
  }

  /* Rabatt für einen gegebenen Zwischensumme-Betrag (Tickets + Nachwuchsbeitrag),
     gemeinsam für "seats"- und "blocks"-Modus sowie für getSummary(). */
  SeatPicker.prototype._voucherDiscount = function (base) {
    if (!this.voucherInfo || base <= 0) return 0;
    var d = this.voucherInfo.type === 'percent' ? (base * this.voucherInfo.value / 100) : this.voucherInfo.value;
    return Math.min(Math.round(d * 100) / 100, base);
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
     zeigen ("Normalpreis 1.000 € je Ticket, abzüglich 20 % Frühbucherrabatt,
     abzüglich 30 % Vereinsmitgliederrabatt") — der Endpreis selbst steht separat
     rechts in der Zeile (s. _renderCart), nicht mehr hier verdoppelt. */
  SeatPicker.prototype._dkBreakdownText = function (priceInfo, tarif) {
    var isErmaessigt = tarif.indexOf('ermaessigt') === 0;
    var base = isErmaessigt ? priceInfo.ermaessigt : priceInfo.normal;
    var parts = [(isErmaessigt ? 'Ermäßigt' : 'Normalpreis') + ' ' + fmtEUR(base) + ' € je Ticket'];
    if (this.dkDiscount) {
      if (this._earlyBirdActive()) parts.push('abzüglich ' + this.dkDiscount.earlyBirdPercent + ' % Frühbucherrabatt');
      if (tarif.indexOf('_member') !== -1) parts.push('abzüglich ' + this.dkDiscount.memberPercent + ' % Vereinsmitgliederrabatt');
    }
    return parts.join(', ');
  };

  SeatPicker.prototype._load = function () {
    var self = this;
    var planFetch = fetch(this.planUrl).then(function (r) { return r.json(); });
    /* Belegte Sitze kommen aus einem eigenen n8n-Proxy-Endpunkt (fragt pretix'
       Seats-API ab, Token bleibt serverseitig). Schlägt der Abruf fehl (Netzwerk,
       n8n down o.ä.), degradiert das bewusst auf "keine Sitze als belegt bekannt"
       statt die ganze Sitzplatzwahl zu blockieren — besser ein optimistischer
       Anzeigefehler als ein kompletter Ausfall der Seite. */
    var statusFetch = this.seatStatusUrl
      ? fetch(this.seatStatusUrl).then(function (r) { return r.ok ? r.json() : { takenSeatGuids: [] }; }).catch(function () { return { takenSeatGuids: [] }; })
      : Promise.resolve({ takenSeatGuids: [] });
    Promise.all([planFetch, statusFetch]).then(function (results) {
      var plan = results[0];
      var status = results[1] || {};
      self.plan = plan;
      self.takenSeatGuids = new Set(Array.isArray(status.takenSeatGuids) ? status.takenSeatGuids : []);
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
      var total = allGroups.reduce(function (sum, g) { return sum + g.rows.reduce(function (s, r) { return s + r.seats.length; }, 0); }, 0);
      // Reihenfolge in den Rohdaten: erste Gruppe = Reihen nächst dem Spielfeld. Bei
      // Nordblöcken (D/E/F) ist "nächst Spielfeld" die UNTERE Kante der Kachel (Spielfeld
      // liegt darunter), bei Südblöcken (A/B/C) die OBERE Kante (Spielfeld liegt darüber).
      var ordered = isNorth ? allGroups.slice().reverse() : allGroups;
      var stops = [];
      var acc = 0;
      ordered.forEach(function (g) {
        var count = g.rows.reduce(function (s, r) { return s + r.seats.length; }, 0);
        var pct = Math.round((count / total) * 1000) / 10;
        stops.push(catColor(g.category) + ' ' + acc + '%');
        acc += pct;
        stops.push(catColor(g.category) + ' ' + acc + '%');
      });
      var background = allGroups.length > 1 ? 'linear-gradient(to bottom, ' + stops.join(', ') + ')' : catColor(allGroups[0].category);
      // Bei gemischten Blöcken (z. B. B: VIP vorn + Kategorie I hinten) beschriftet die
      // Kachel bewusst nur die kaufbare Hauptkategorie (letzte/größte gefilterte Gruppe)
      // unten am Buchstaben — ein zusätzliches "VIP"-Label oben markiert den roten
      // Farbverlauf-Anteil separat, auch wenn VIP hier nicht kaufbar ist.
      var mainCategory = groups[groups.length - 1].category;
      var borderColor = catBorderColor(mainCategory);
      var hasVip = allGroups.some(function (g) { return g.category === 'VIP'; });
      var vipLabel = hasVip ? '<span class="seatplan-mobile-tile-vip">VIP</span>' : '';
      var isPending = self.mode === 'blocks' && self.pendingBlockId === id;
      var tileClass = 'seatplan-mobile-tile' + (isNorth ? '' : ' seatplan-mobile-tile-south') + (isPending ? ' selected' : '');
      return '<button type="button" class="' + tileClass + '" style="background:' + background + ';border-color:' + borderColor + '" data-zone="' + id + '">' +
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
        '<div class="seatplan-mobile-entrance main" style="grid-column:1;grid-row:1 / 4"><span></span><i>Haupteingang</i><span></span></div>' +
        '<div class="seatplan-mobile-tiles" style="grid-column:2;grid-row:1">' + northTiles + '</div>' +
        '<div class="seatplan-mobile-court-row" style="grid-column:2;grid-row:2">' +
          '<div class="seatplan-mobile-court-aside">' +
            '<div class="seatplan-mobile-scoreboard"><span></span><i>Anzeigetafel</i><span></span></div>' +
            '<div class="seatplan-mobile-standing"><span>Steh-</span><span>platz</span></div>' +
          '</div>' +
          '<div class="seatplan-mobile-court">' + courtConfirm + '<p class="t-caption" style="margin:0;color:var(--text-muted)">Spielfeld</p></div>' +
          '<div class="seatplan-mobile-court-aside-mirror" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="seatplan-mobile-tiles" style="grid-column:2;grid-row:3">' + southTiles + '</div>' +
        '<div class="seatplan-mobile-entrance vip" style="grid-column:3;grid-row:3"><i>VIP-Eingang</i></div>' +
      '</div>';

    this.root.querySelectorAll('.seatplan-mobile-tile[data-zone]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (self.mode === 'blocks') {
          self.pendingBlockId = self.pendingBlockId === btn.dataset.zone ? null : btn.dataset.zone;
          self._render();
        } else {
          self.mobileZoneId = btn.dataset.zone;
          self._render();
        }
      });
    });
    if (this.mode === 'blocks') {
      var addBtn = this.root.querySelector('#seatplan-mobile-add-btn');
      if (addBtn) addBtn.addEventListener('click', function () { self._addPendingBlock(); });
    }
    this._renderCart();
  };

  /* Modus "blocks" (Einzelticket): Gesamtkapazität einer Kategorie in einem Block —
     Grundlage für den Stepper-Grenzwert, sowohl beim Schnell-Hinzufügen aus der
     Übersicht/Direktwahl als auch beim +/- im Warenkorb selbst. Keine Live-Belegungs-
     prüfung (Einzelticket ist ohnehin First-Come-First-Serve vor Ort). */
  SeatPicker.prototype._blockFreeCount = function (zoneId, category) {
    var zone = this._zoneById(zoneId);
    if (!zone) return 0;
    return this._categoryGroups(zone).filter(function (g) { return g.category === category; })
      .reduce(function (sum, g) { return sum + g.rows.reduce(function (s, r) { return s + r.seats.length; }, 0); }, 0);
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
    header.innerHTML = '<button type="button" class="seatplan-mobile-back" aria-label="Zurück zur Blockübersicht"><i data-lucide="arrow-left" class="icon-16"></i></button>' +
      '<span class="seatplan-mobile-detail-title">' +
        '<strong class="t-body-sm">' + zone.name + '</strong>' +
        '<span class="t-caption" style="color:var(--text-muted)">' + mainCategory +
          (hasVip ? ' (und <span style="color:rgba(179,57,44,.9)">VIP</span>)' : '') +
        '</span>' +
      '</span><span style="width:32px"></span>';
    wrap.appendChild(header);
    var zoneEl = this._renderZone(zone);
    if (zoneEl) wrap.appendChild(zoneEl);
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-sm seatplan-mobile-detail-confirm';
    confirmBtn.textContent = 'Übernehmen';
    wrap.appendChild(confirmBtn);
    // Öffnet groß in einem separaten Overlay statt im kompakten Inline-Bereich, sofern
    // die Seite eines mitgegeben hat (Dauerkarte) — sonst Fallback: inline wie zuvor.
    var target = this.detailRootEl || this.root;
    target.innerHTML = '';
    target.appendChild(wrap);
    if (this.detailBackdropEl) this.detailBackdropEl.classList.add('open');
    if (zoneEl) {
      this._fixupRowWidths(zoneEl, zone);
      this._fitZoneScale(zoneEl);
    }
    if (window.lucide) window.lucide.createIcons();
    header.querySelector('.seatplan-mobile-back').addEventListener('click', function () {
      self.mobileZoneId = null;
      self._render();
    });
    confirmBtn.addEventListener('click', function () {
      self.mobileZoneId = null;
      self._render();
    });
    this._renderCart();
  };

  /* Reihen mit data-match-first (s. _renderZone) werden auf die tatsächliche,
     gerenderte Breite von Reihe 1 gestreckt/gestaucht (justify-content:space-between
     verteilt die Sitze dafür neu) — Messung erst möglich, wenn die Zone im echten DOM
     hängt, deshalb ein separater Schritt statt Teil von _renderZone selbst. */
  SeatPicker.prototype._fixupRowWidths = function (zoneEl, zone) {
    var rows = zoneEl.querySelectorAll('.seatplan-row-line');
    if (!rows.length) return;
    var targetWidth = rows[0].getBoundingClientRect().width;
    zoneEl.querySelectorAll('.seatplan-row-line--match-first').forEach(function (row) {
      row.style.width = targetWidth + 'px';
      row.style.justifyContent = 'space-between';
    });

    // Hintere Reihen mit data-align-target-seat (s. _renderZone) so verschieben, dass
    // GENAU dieser eine Sitz auf derselben Höhe landet wie der letzte Sitz der mit
    // seatplan-row-line--align-reference markierten Reihe (z. B. Reihe 10) — statt
    // Sitzanzahl × Rasterbreite anzunehmen, was Segment-Lücken innerhalb der Reihe
    // (segment_breaks) verfälschen würden. Rechts bei A/B/D/E (Standard-Kante), links
    // bei den gespiegelten Blöcken C/F.
    var mirrored = zone && (zone.zone_id === 'C' || zone.zone_id === 'F');
    var referenceRow = zoneEl.querySelector('.seatplan-row-line--align-reference');
    var referenceSeats = referenceRow ? referenceRow.querySelectorAll('.seatplan-seat') : null;
    var referenceSeat = referenceSeats && referenceSeats.length ? referenceSeats[referenceSeats.length - 1] : null;
    if (referenceSeat) {
      var refRect = referenceSeat.getBoundingClientRect();
      var refEdge = mirrored ? refRect.left : refRect.right;
      zoneEl.querySelectorAll('[data-align-target-seat]').forEach(function (row) {
        var targetNum = row.dataset.alignTargetSeat;
        var targetSeat = Array.from(row.querySelectorAll('.seatplan-seat')).find(function (s) {
          return s.textContent === targetNum;
        });
        if (!targetSeat) return;
        var seatRect = targetSeat.getBoundingClientRect();
        if (mirrored) row.style.marginLeft = '-' + (seatRect.left - refEdge) + 'px';
        else row.style.marginRight = '-' + (refEdge - seatRect.right) + 'px';
      });
    }
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
    var naturalWidth = gridWrap.scrollWidth;
    var naturalHeight = gridWrap.scrollHeight;
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
  };

  /* Öffentliche Methode, damit die Seite (Backdrop-Klick, ESC-Taste) die
     Detailansicht schließen kann, ohne interne Felder direkt anzufassen. */
  SeatPicker.prototype.closeDetail = function () {
    if (this.mode === 'seats' && this.mobileZoneId) {
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
    var mirrored = (zone.zone_id === 'C' || zone.zone_id === 'F');

    var gridWrap = document.createElement('div');
    gridWrap.className = 'seatplan-grid-wrap';
    gridWrap.style.width = 'fit-content';
    gridWrap.style.alignItems = mirrored ? 'flex-start' : 'flex-end';
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
        row.seats.forEach(function (seat) {
          var taken = !!(self.takenSeatGuids && self.takenSeatGuids.has(seat.seat_guid));
          if (!taken) freeCount++;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'seatplan-seat ' + catClass(category) + (taken ? ' taken' : '');
          btn.textContent = seat.seat_number;
          // Echte Gang-Lücke innerhalb der Reihe (z. B. "1,2 | 3-22 | 23,24,25") —
          // die Sitznummerierung bleibt über den Gang hinweg durchgehend, nur die
          // Darstellung bekommt hier eine kleine zusätzliche Lücke.
          if (row.segment_breaks && row.segment_breaks.indexOf(parseInt(seat.seat_number, 10)) !== -1) {
            btn.style.marginLeft = '10px';
          }
          if (blockMode) btn.tabIndex = -1;
          btn.dataset.seatGuid = seat.seat_guid;
          var seatLabel = zone.name + ', Reihe ' + rowLabel + ', Platz ' + seat.seat_number;
          btn.setAttribute('aria-label', seatLabel + (taken ? ' (vergeben)' : ' (frei)'));
          if (taken || blockMode) {
            btn.disabled = true;
          } else if (self.prices[category]) {
            btn.addEventListener('click', function () {
              self._toggleSeat(btn, seat.seat_guid, zone.name, rowLabel, seat.seat_number, category, priceInfo);
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

  SeatPicker.prototype._toggleSeat = function (btn, guid, zoneLabel, rowLabel, seatNumber, category, priceInfo) {
    if (this.selected[guid]) {
      delete this.selected[guid];
      btn.classList.remove('selected');
    } else {
      this.selected[guid] = {
        zoneLabel: zoneLabel, rowLabel: rowLabel, seatNumber: seatNumber,
        category: category, tarif: 'normal', price: this._dkPrice(priceInfo.normal, false), priceInfo: priceInfo
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
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && guids.length > 0) total += this.nachwuchsAmount;
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
        label: s.zoneLabel + ' · Reihe ' + s.rowLabel + ', Platz ' + s.seatNumber + ' · ' + (DK_TARIF_LABELS[s.tarif] || 'Normalpreis'),
        qty: 1, unitPrice: s.price, lineTotal: s.price,
        // Maschinenlesbare Felder für die echte Pretix-Order-Erstellung (n8n) —
        // category/tarif bestimmen dort Item+Variation, seatGuid den Sitz.
        type: 'seat', seatGuid: guid, category: s.category, tarif: s.tarif
      });
      total += s.price;
    });
    var nwAmount = 0;
    if (this.nachwuchsBeitrag && this.nachwuchsChecked && lines.length > 0) {
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
