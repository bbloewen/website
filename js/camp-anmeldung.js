// Anmeldung zu den Feriencamps (trainieren/camp-anmeldung.html).
// Liest die Camps von n8n (camps-offen), baut das Formular und schickt die Anmeldung an camp-anmeldung.
// Die Preise hier sind nur zur Anzeige: gerechnet und geprüft wird auf dem Server (Datenbank), nie im Browser.
(function () {
  'use strict';
  var API = 'https://ticketing.basketball-loewen.com/webhook/';
  var MAX_KINDER = 6;
  var geladen = Date.now();
  var root = document.getElementById('ca-root');
  if (!root) return;
  var camps = [], camp = null, anzahl = 0, zaehler = 0;

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function euro(n) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function datum(iso) { var p = String(iso).slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function zeitraum(c) { var a = String(c.beginn).slice(0, 10).split('-'), b = String(c.ende).slice(0, 10).split('-'); return a[2] + '.' + a[1] + '.–' + b[2] + '.' + b[1] + '.' + b[0]; }
  function gewaehlt() { var m = /[?&]camp=([a-z0-9-]+)/.exec(location.search); return m ? m[1] : ''; }

  function zu(text) {
    root.innerHTML = '<div class="card" style="padding:24px"><h2 class="t-h4" style="margin:0 0 8px">' + esc(text) + '</h2>' +
      '<p class="t-body-sm" style="margin:0 0 16px">Sobald die Anmeldung für ein Camp startet, kündigen wir es auf der Seite der Feriencamps und im Newsletter an.</p>' +
      '<a class="btn btn-primary" href="/trainieren/feriencamps.html">Zu den Feriencamps</a></div>';
  }

  function tarifOptionen() {
    var p = camp.preise || {};
    return '<option value="">Tarif wählen *</option>' +
      '<option value="standard">Standardtarif (' + euro(p.standard) + ')</option>' +
      (p.mitglied !== null && p.mitglied !== undefined ? '<option value="mitglied">Mitgliedstarif (' + euro(p.mitglied) + '), Mitglied in einem Kooperationsverein</option>' : '') +
      (p.familienpass !== null && p.familienpass !== undefined ? '<option value="familienpass">Familienpass der Stadt Erfurt (' + euro(p.familienpass) + ')</option>' : '');
  }

  function kindKarte(i) {
    var n = i + 1, id = 'ca-k' + i + '-';
    return '<fieldset class="ca-kind" data-kind="' + i + '" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin:0 0 16px">' +
      '<legend class="t-h5" style="padding:0 8px">Kind ' + n + '</legend>' +
      '<div class="field"><label for="' + id + 'vorname">Vorname *</label><input type="text" id="' + id + 'vorname" data-f="vorname" required autocomplete="off" /></div>' +
      '<div class="field"><label for="' + id + 'nachname">Nachname *</label><input type="text" id="' + id + 'nachname" data-f="nachname" required autocomplete="off" /></div>' +
      '<div class="field"><label for="' + id + 'geburtsdatum">Geburtsdatum *</label><input type="date" id="' + id + 'geburtsdatum" data-f="geburtsdatum" required min="2000-01-01" max="' + new Date().toISOString().slice(0, 10) + '" /></div>' +
      '<div class="field"><label for="' + id + 'tarif">Tarif *</label><select id="' + id + 'tarif" data-f="tarif" required>' + tarifOptionen() + '</select>' +
      '<p class="hint">Den Familienpass bitte am ersten Camptag vorzeigen. Die Mitgliedschaft prüfen wir.</p></div>' +
      '<div class="field ca-verein" hidden><label for="' + id + 'verein">In welchem Verein ist das Kind Mitglied? *</label><input type="text" id="' + id + 'verein" data-f="verein" autocomplete="off" /></div>' +
      '<div class="field"><label for="' + id + 'hinweise">Hinweise (Allergien, Medikamente, Wichtiges)</label><textarea id="' + id + 'hinweise" data-f="hinweise" rows="2" maxlength="500"></textarea></div>' +
      '<div class="field-checkbox" style="align-items:flex-start"><input type="checkbox" id="' + id + 'foto" data-f="fotoOk" class="mt-1" /><label for="' + id + 'foto" class="t-body-sm">Fotos und Videos aus dem Camp, auf denen mein Kind zu sehen ist, dürfen auf der Website und in den sozialen Medien der Basketball Löwen Erfurt gezeigt werden. Das kann ich jederzeit widerrufen.</label></div>' +
      (i > 0 ? '<button type="button" class="btn btn-ghost" data-weg="' + i + '" style="margin-top:8px">Dieses Kind entfernen</button>' : '') +
      '</fieldset>';
  }

  function feld(id, label, attrs, hint) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" ' + attrs + ' />' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
  }

  function summe() {
    var p = camp.preise || {}, s = 0, n = 0;
    root.querySelectorAll('.ca-kind').forEach(function (k) {
      var t = k.querySelector('[data-f="tarif"]').value; if (!t) return;
      var preis = t === 'mitglied' ? (p.mitglied != null ? p.mitglied : p.standard) : t === 'familienpass' ? (p.familienpass != null ? p.familienpass : p.standard) : p.standard;
      s += Number(preis); n++;
    });
    var el = document.getElementById('ca-summe');
    if (el) el.textContent = n ? 'Gesamtbetrag: ' + euro(s) + ' für ' + n + (n === 1 ? ' Kind' : ' Kinder') + (camp.warteliste ? ' (bei vollem Camp kommen die Kinder auf die Warteliste, dann wird nichts eingezogen)' : '') : 'Bitte für jedes Kind einen Tarif wählen.';
  }

  function formular() {
    anzahl = 1; zaehler = 1;
    var hinweisAlter = (camp.alter_von || camp.alter_bis) ? ' Für Kinder von ' + (camp.alter_von || 0) + ' bis ' + (camp.alter_bis || 99) + ' Jahren (Alter bei Campbeginn).' : '';
    root.innerHTML = '<div class="card" style="padding:24px">' +
      '<span class="eyebrow" style="display:block;text-align:center">Anmeldung</span>' +
      '<h2 class="t-h4" style="margin:6px 0 4px;text-align:center">' + esc(camp.name) + '</h2>' +
      '<p class="t-caption" style="text-align:center;margin:0 0 4px">' + esc(zeitraum(camp)) + (camp.ort ? ' · ' + (camp.ort_link ? '<a href="' + esc(camp.ort_link) + '">' + esc(camp.ort) + '</a>' : esc(camp.ort)) : '') + '</p>' +
      '<p class="t-caption" style="text-align:center;margin:0 0 16px;color:var(--text-muted)">' + esc(camp.beschreibung || '') + hinweisAlter + (camp.plaetze_frei === 0 ? ' Zurzeit sind alle Plätze vergeben, Anmeldungen kommen auf die Warteliste.' : '') + '</p>' +
      (camps.length > 1 ? '<div class="field"><label for="ca-camp">Camp</label><select id="ca-camp">' + camps.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === camp.id ? ' selected' : '') + '>' + esc(c.name) + ' (' + esc(zeitraum(c)) + ')</option>'; }).join('') + '</select></div>' : '') +
      '<form class="form-panel" id="ca-form" novalidate>' +
      '<div id="ca-kinder">' + kindKarte(0) + '</div>' +
      '<button type="button" class="btn btn-ghost btn-block" id="ca-kind-add">+ Weiteres Kind anmelden</button>' +
      '<div class="field mt-2"><span style="display:block;font-weight:var(--weight-semibold);margin-bottom:8px">Anmeldende Person (Erziehungsberechtigte:r)</span></div>' +
      feld('ca-vorname', 'Vorname *', 'type="text" name="vorname" required autocomplete="given-name"') +
      feld('ca-nachname', 'Nachname *', 'type="text" name="nachname" required autocomplete="family-name"') +
      feld('ca-strasse', 'Straße und Hausnummer *', 'type="text" name="strasse" required autocomplete="street-address"') +
      feld('ca-plz', 'PLZ *', 'type="text" name="plz" required inputmode="numeric" maxlength="5" autocomplete="postal-code"') +
      feld('ca-ort', 'Ort *', 'type="text" name="ort" required value="Erfurt" autocomplete="address-level2"') +
      feld('ca-email', 'E-Mail *', 'type="email" name="email" required autocomplete="email"', 'Hierhin schicken wir die Bestätigung.') +
      feld('ca-telefon', 'Telefon für Rückfragen *', 'type="tel" name="telefon" required autocomplete="tel"') +
      '<div class="field mt-2"><span style="display:block;font-weight:var(--weight-semibold);margin-bottom:8px">Bezahlung per SEPA-Lastschrift</span></div>' +
      feld('ca-kontoinhaber', 'Name der Kontoinhaberin / des Kontoinhabers *', 'type="text" name="kontoinhaber" required autocomplete="off"') +
      feld('ca-iban', 'IBAN *', 'type="text" name="iban" required autocomplete="off"', 'Eingezogen wird erst nach einer Vorabankündigung per E-Mail.') +
      '<p class="t-body-sm" id="ca-summe" aria-live="polite" style="margin:8px 0 16px;font-weight:var(--weight-semibold)"></p>' +
      '<div style="position:absolute;left:-9999px" aria-hidden="true"><label for="ca-webseite">Webseite</label><input type="text" id="ca-webseite" tabindex="-1" autocomplete="off" /></div>' +
      '<div class="field-checkbox" style="align-items:flex-start;margin:0 0 8px"><input type="checkbox" id="ca-bedingungen" required class="mt-1" /><label for="ca-bedingungen" class="t-body-sm">Ich melde mein Kind beziehungsweise meine Kinder verbindlich zum Camp an und habe die <a href="/trainieren/feriencamps.html#teilnahmebedingungen" target="_blank" rel="noopener">Teilnahmebedingungen</a> und die <a href="/trainieren/feriencamps.html#stornobedingungen" target="_blank" rel="noopener">Stornobedingungen</a> gelesen und akzeptiere sie. *</label></div>' +
      '<div class="field-checkbox" style="align-items:flex-start;margin:0 0 8px"><input type="checkbox" id="ca-sepa" required class="mt-1" /><label for="ca-sepa" class="t-body-sm">Ich ermächtige die Basketball Löwen e.V. (Gläubiger-ID DE46ZZZ00002312785), Zahlungen von meinem Konto mittels SEPA-Lastschrift einzuziehen, und weise mein Kreditinstitut an, diese Lastschriften einzulösen. *</label></div>' +
      '<div class="field-checkbox" style="align-items:flex-start;margin:0 0 16px"><input type="checkbox" id="ca-daten" required class="mt-1" /><label for="ca-daten" class="t-body-sm">Ich willige in die Verarbeitung der Daten gemäß der <a href="/datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a> ein. *</label></div>' +
      '<button type="submit" class="btn btn-primary btn-block" id="ca-senden">Verbindlich anmelden</button>' +
      '<div class="form-status error" id="ca-fehler" role="alert" tabindex="-1"></div>' +
      '</form></div>';
    summe();
  }

  function nummerieren() { [].forEach.call(root.querySelectorAll('.ca-kind legend'), function (l, i) { l.textContent = 'Kind ' + (i + 1); }); }

  function sammeln() {
    var f = document.getElementById('ca-form');
    var kinder = [].map.call(f.querySelectorAll('.ca-kind'), function (k) {
      var g = function (n) { var e = k.querySelector('[data-f="' + n + '"]'); return e ? e.value : ''; };
      return { vorname: g('vorname'), nachname: g('nachname'), geburtsdatum: g('geburtsdatum'), tarif: g('tarif'), verein: g('tarif') === 'mitglied' ? g('verein') : '', hinweise: g('hinweise'), fotoOk: k.querySelector('[data-f="fotoOk"]').checked };
    });
    var v = function (id) { return document.getElementById(id).value; };
    return {
      camp: camp.id, zahler: { vorname: v('ca-vorname'), nachname: v('ca-nachname'), strasse: v('ca-strasse'), plz: v('ca-plz'), ort: v('ca-ort'), email: v('ca-email'), telefon: v('ca-telefon') },
      kontoinhaber: v('ca-kontoinhaber'), iban: v('ca-iban'), kinder: kinder,
      bedingungen: document.getElementById('ca-bedingungen').checked, sepa: document.getElementById('ca-sepa').checked,
      webseite: v('ca-webseite'), elapsedMs: Date.now() - geladen,
    };
  }

  function fehler(text) {
    var e = document.getElementById('ca-fehler'); e.textContent = text; e.classList.add('visible'); e.focus();
  }

  function erfolg(antwort, mail) {
    root.innerHTML = '<div class="card" style="padding:24px"><h2 class="t-h4" style="margin:0 0 8px">Vielen Dank für die Anmeldung!</h2>' +
      '<p class="t-body-sm">Ihre Anmeldenummer: <strong>' + esc(antwort.nummer) + '</strong></p>' +
      '<p class="t-body-sm">Wir haben eine Bestätigung an <strong>' + esc(mail) + '</strong> geschickt. Bitte schauen Sie auch im Spam-Ordner nach.</p>' +
      (antwort.warteliste ? '<p class="t-body-sm">Für ' + (antwort.warteliste === 1 ? 'ein Kind' : antwort.warteliste + ' Kinder') + ' sind alle Plätze vergeben. Die Anmeldung steht auf der Warteliste, wir melden uns, sobald ein Platz frei wird.</p>' : '') +
      '<a class="btn btn-primary" href="/trainieren/feriencamps.html">Zurück zu den Feriencamps</a></div>';
    window.scrollTo(0, 0);
  }

  root.addEventListener('change', function (e) {
    if (e.target.id === 'ca-camp') { camp = camps.filter(function (c) { return c.id === e.target.value; })[0] || camp; formular(); return; }
    if (e.target.matches && e.target.matches('[data-f="tarif"]')) {
      var k = e.target.closest('.ca-kind'), v = k.querySelector('.ca-verein'), mit = e.target.value === 'mitglied';
      v.hidden = !mit; k.querySelector('[data-f="verein"]').required = mit;
      summe();
    }
  });
  root.addEventListener('click', function (e) {
    if (e.target.id === 'ca-kind-add') {
      if (anzahl >= MAX_KINDER) return;
      var box = document.getElementById('ca-kinder'); box.insertAdjacentHTML('beforeend', kindKarte(zaehler)); zaehler++; anzahl++; nummerieren();
      if (anzahl >= MAX_KINDER) e.target.hidden = true;
      var neu = box.lastElementChild; neu.querySelector('input').focus(); summe(); return;
    }
    var weg = e.target.getAttribute && e.target.getAttribute('data-weg');
    if (weg) { var k = root.querySelector('.ca-kind[data-kind="' + weg + '"]'); if (k) { k.remove(); anzahl--; document.getElementById('ca-kind-add').hidden = false; nummerieren(); summe(); } }
  });
  root.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, knopf = document.getElementById('ca-senden'), fe = document.getElementById('ca-fehler');
    fe.classList.remove('visible');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    var daten = sammeln(), mail = daten.zahler.email;
    knopf.disabled = true; knopf.textContent = 'Wird gesendet …';
    fetch(API + 'camp-anmeldung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok && d.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) { erfolg(r.d, mail); return; }
        knopf.disabled = false; knopf.textContent = 'Verbindlich anmelden';
        fehler(r.d && r.d.fehler ? r.d.fehler : 'Das Senden hat leider nicht geklappt. Bitte versuchen Sie es später noch einmal oder schreiben Sie uns an camps@basketball-loewen.com.');
      })
      .catch(function () {
        knopf.disabled = false; knopf.textContent = 'Verbindlich anmelden';
        fehler('Das Senden hat leider nicht geklappt. Bitte versuchen Sie es später noch einmal oder schreiben Sie uns an camps@basketball-loewen.com.');
      });
  });

  fetch(API + 'camps-offen').then(function (r) { return r.json(); }).then(function (d) {
    camps = (d.camps || []).filter(function (c) { return c.anmeldung_offen; });
    if (!camps.length) { zu('Zurzeit ist keine Anmeldung geöffnet.'); return; }
    var wunsch = gewaehlt();
    camp = camps.filter(function (c) { return c.id === wunsch; })[0] || camps[0];
    formular();
  }).catch(function () { zu('Die Anmeldung ist gerade nicht erreichbar.'); });
})();
