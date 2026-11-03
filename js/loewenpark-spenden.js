/* Spendenaktion CATL Löwenpark (Briefing Valentin Kern, November 2026).
   Liest data/loewenpark-wunschliste.json (Wünsche in fester Reihenfolge, von Hand bzw. aus 305 gepflegt)
   und data/loewenpark-spendenstand.json (Summe, Anzahl, Spender mit Zustimmung zur Nennung; schreibt n8n).
   Eine Spende ist nie an einen Wunsch gebunden: der Stand füllt die Wunschliste der Reihe nach.
   Seite:   #ls-stand, #ls-liste, #ls-spender, #ls-zweck, Knöpfe [data-ls-kopieren], [data-ls-paypal]
   Teaser:  #ls-teaser (Löwenpark-Seite) zeigt Balken und die nächsten offenen Wünsche. */
(function () {
  var PAYPAL_BUSINESS_ID = '2NYCEWVGCGCF2';
  var BEREICH_ICON = { halle: 'volleyball', kueche: 'cooking-pot', fitness: 'dumbbell', lernraum: 'book-open', kabinen: 'shirt' };
  // Platzhalter für das Icon-Bündel (tools/build-lucide-icons.py sucht data-lucide="…" in allen Dateien):
  // <i data-lucide="volleyball"></i> <i data-lucide="cooking-pot"></i> <i data-lucide="dumbbell"></i> <i data-lucide="book-open"></i> <i data-lucide="shirt"></i> <i data-lucide="circle-check"></i>

  function euro(n) { return Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function datum(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }
  // Zahl der Spenderinnen und Spender (n8n zählt jede Person einmal); anzahlSpenden aus dem Briefing gilt als Rückfall
  function anzahl(stand) { return Number(stand.anzahlSpender != null ? stand.anzahlSpender : stand.anzahlSpenden || 0); }
  function laden(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function icons() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }

  // Statuslogik aus dem Briefing: gedeckte Wünsche sind finanziert, der erste nicht gedeckte ist in Arbeit
  function verteilen(wuensche, gesamt) {
    var rest = gesamt;
    return wuensche.map(function (w) {
      var x = Object.assign({}, w);
      if (rest >= w.betrag) { x.status = 'finanziert'; x.anteil = 1; rest -= w.betrag; }
      else if (rest > 0) { x.status = 'arbeit'; x.anteil = rest / w.betrag; rest = 0; }
      else { x.status = 'offen'; x.anteil = 0; }
      return x;
    });
  }

  function balken(gesamt, ziel, label) {
    var p = ziel > 0 ? Math.min(100, gesamt / ziel * 100) : 0;
    return '<div class="ls-balken" role="progressbar" aria-valuemin="0" aria-valuemax="' + ziel + '" aria-valuenow="' + gesamt + '" aria-label="' + esc(label) + '">' +
      '<span style="width:' + p.toFixed(1) + '%"></span></div>';
  }

  function standHtml(daten, liste) {
    var ziel = daten.liste.ziel, gesamt = daten.gesamt, erfuellt = liste.filter(function (w) { return w.status === 'finanziert'; }).length;
    var akt = datum(daten.stand.aktualisiert);
    return '<p class="ls-summe"><strong>' + euro(gesamt) + '</strong> <span>von ' + euro(ziel) + ' gesammelt</span></p>' +
      balken(gesamt, ziel, 'Spendenstand: ' + euro(gesamt) + ' von ' + euro(ziel)) +
      '<div class="ls-kennzahlen">' +
        '<div><strong>' + erfuellt + ' von ' + liste.length + '</strong><span>Wünschen erfüllt</span></div>' +
        '<div><strong>' + anzahl(daten.stand).toLocaleString('de-DE') + '</strong><span>Spenderinnen und Spender</span></div>' +
        '<div><strong>' + (ziel > 0 ? Math.floor(gesamt / ziel * 100) : 0) + ' %</strong><span>des Ziels</span></div>' +
      '</div>' +
      '<p class="ls-klein">' + (akt ? 'Stand: ' + akt + '. ' : '') + 'Überweisungen erscheinen nach Eingang auf unserem Konto, in der Regel nach ein bis drei Werktagen.</p>';
  }

  function karteHtml(w) {
    var status = w.status === 'finanziert' ? '<span class="ls-status ls-status-ok"><i data-lucide="circle-check" class="icon-16"></i>Finanziert</span>'
      : w.status === 'arbeit' ? '<span class="ls-status ls-status-arbeit">Zu ' + Math.floor(w.anteil * 100) + ' % finanziert</span>'
      : '<span class="ls-status">Offen</span>';
    return '<li class="ls-wunsch ls-' + w.status + '">' +
      '<span class="ls-wunsch-icon" aria-hidden="true"><i data-lucide="' + (BEREICH_ICON[w.bereich] || 'heart') + '" class="icon-20"></i></span>' +
      '<span class="ls-wunsch-text"><span class="ls-wunsch-name">' + esc(w.bezeichnung) + '</span>' +
      '<span class="ls-wunsch-betrag">' + euro(w.betrag) + '</span>' + status +
      (w.status === 'arbeit' ? balken(w.anteil * w.betrag, w.betrag, w.bezeichnung + ': ' + Math.floor(w.anteil * 100) + ' % finanziert') : '') + '</span></li>';
  }

  function listeHtml(daten, liste) {
    return daten.liste.bereiche.map(function (b) {
      var eigene = liste.filter(function (w) { return w.bereich === b.id; });
      var summe = eigene.reduce(function (s, w) { return s + w.betrag; }, 0);
      var fertig = eigene.filter(function (w) { return w.status === 'finanziert'; }).length;
      return '<section class="ls-bereich" aria-labelledby="ls-b-' + b.id + '"><div class="ls-bereich-kopf">' +
        '<h3 class="t-h4" id="ls-b-' + b.id + '">' + esc(b.name) + '</h3><span class="ls-bereich-summe">' + fertig + ' von ' + eigene.length + ' · ' + euro(summe) + '</span></div>' +
        (b.text ? '<p class="t-body-sm ls-bereich-text">' + esc(b.text) + '</p>' : '') +
        '<ul class="ls-wuensche">' + eigene.map(karteHtml).join('') + '</ul></section>';
    }).join('');
  }

  function spenderHtml(stand) {
    var namen = (stand.spender || []).filter(function (s) { return s && s.name; });
    var anonym = Math.max(0, anzahl(stand) - namen.length);
    if (!namen.length && !anonym) return '<p class="t-body-sm ls-leer">Hier stehen bald die Namen aller, die mitmachen und genannt werden möchten.</p>';
    return (namen.length ? '<ul class="ls-namen">' + namen.map(function (s) { return '<li>' + esc(s.name) + '</li>'; }).join('') + '</ul>' : '') +
      (anonym ? '<p class="t-body-sm ls-anonym">' + (namen.length ? 'und ' : '') + anonym.toLocaleString('de-DE') + ' ' + (anonym === 1 ? 'Spenderin oder Spender' : 'Spenderinnen und Spender') + ', die nicht genannt werden möchten.</p>' : '');
  }

  function teaserHtml(daten, liste) {
    var naechste = liste.filter(function (w) { return w.status !== 'finanziert'; }).slice(0, 3);
    return '<p class="ls-summe"><strong>' + euro(daten.gesamt) + '</strong> <span>von ' + euro(daten.liste.ziel) + ' für die Einrichtung</span></p>' +
      balken(daten.gesamt, daten.liste.ziel, 'Spendenstand Einrichtung CATL Löwenpark') +
      (naechste.length ? '<p class="t-body-sm ls-teaser-naechste">Als Nächstes: ' + naechste.map(function (w) { return esc(w.bezeichnung) + ' (' + euro(w.betrag) + ')'; }).join(' · ') + '</p>' : '');
  }

  // Verwendungszweck und PayPal-Zusatz: Stichwort LÖWENPARK, mit Zustimmung zur Nennung der gewünschte Name
  function zweck() {
    var sichtbar = document.querySelector('input[name="ls-sichtbar"]:checked');
    var name = document.getElementById('ls-anzeigename');
    var n = sichtbar && sichtbar.value === 'ja' && name ? name.value.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return 'LÖWENPARK' + (n ? ' Name: ' + n : '');
  }
  function zweckZeigen() {
    var sichtbar = document.querySelector('input[name="ls-sichtbar"]:checked');
    var feld = document.getElementById('ls-name-feld');
    if (feld) feld.hidden = !(sichtbar && sichtbar.value === 'ja');
    var z = document.getElementById('ls-zweck');
    if (z) z.textContent = zweck();
  }
  function bedienung() {
    document.querySelectorAll('input[name="ls-sichtbar"]').forEach(function (r) { r.addEventListener('change', zweckZeigen); });
    var name = document.getElementById('ls-anzeigename');
    if (name) name.addEventListener('input', zweckZeigen);
    zweckZeigen();
    document.querySelectorAll('[data-ls-kopieren]').forEach(function (k) {
      k.addEventListener('click', function () {
        var quelle = document.getElementById(k.getAttribute('data-ls-kopieren'));
        var text = quelle ? quelle.textContent.replace(/\s+/g, k.getAttribute('data-ls-kopieren') === 'ls-iban' ? '' : ' ').trim() : '';
        var fertig = function () { var alt = k.getAttribute('data-label') || k.textContent; k.setAttribute('data-label', alt); k.textContent = 'Kopiert'; setTimeout(function () { k.textContent = alt; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(fertig, fertig); else fertig();
      });
    });
    var pp = document.querySelector('[data-ls-paypal]');
    if (pp) pp.addEventListener('click', function (e) {
      e.preventDefault();
      var url = 'https://www.paypal.com/donate?business=' + encodeURIComponent(PAYPAL_BUSINESS_ID) + '&currency_code=EUR' +
        '&item_name=' + encodeURIComponent('Spende Einrichtung CATL Löwenpark') + '&custom=' + encodeURIComponent(zweck());
      window.open(url, '_blank', 'noopener');
    });
  }

  function start() {
    bedienung();
    var ziele = { stand: document.getElementById('ls-stand'), liste: document.getElementById('ls-liste'), spender: document.getElementById('ls-spender'), teaser: document.getElementById('ls-teaser') };
    if (!ziele.stand && !ziele.liste && !ziele.teaser) return;
    Promise.all([laden('/data/loewenpark-wunschliste.json'), laden('/data/loewenpark-spendenstand.json').catch(function () { return null; })]).then(function (r) {
      var stand = r[1] || { summe: 0, anzahlSpender: 0, manuellerZuschlag: 0, spender: [] };
      var daten = { liste: r[0], stand: stand, gesamt: Number(stand.summe || 0) + Number(stand.manuellerZuschlag || 0) };
      var liste = verteilen(r[0].wuensche, daten.gesamt);
      if (ziele.stand) ziele.stand.innerHTML = standHtml(daten, liste);
      if (ziele.liste) ziele.liste.innerHTML = listeHtml(daten, liste);
      if (ziele.spender) ziele.spender.innerHTML = spenderHtml(stand);
      if (ziele.teaser) ziele.teaser.innerHTML = teaserHtml(daten, liste);
      icons();
    }).catch(function () { /* Wunschliste fehlt: die statischen Texte der Seite bleiben stehen */ });
  }
  window.loewenparkSpendenVerteilen = verteilen;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
