// Termine der Feriencamps (trainieren/feriencamps.html): schaltet bei jedem Camp mit data-camp den Knopf „Anmeldung“ frei,
// sobald das Camp im Dashboard der Basketball Löwen auf „Anmeldung offen“ steht. Ohne Antwort bleibt die Seite wie sie ist.
(function () {
  'use strict';
  var karten = document.querySelectorAll('[data-camp]');
  if (!karten.length) return;
  fetch('https://ticketing.basketball-loewen.com/webhook/camps-offen').then(function (r) { return r.json(); }).then(function (d) {
    (d.camps || []).forEach(function (c) {
      if (!c.anmeldung_offen) return;
      var karte = document.querySelector('[data-camp="' + c.id + '"]'); if (!karte) return;
      var slot = karte.querySelector('[data-camp-anmeldung]'); if (!slot) return;
      var a = document.createElement('a');
      a.className = 'btn btn-primary btn-sm';
      a.href = '/trainieren/camp-anmeldung.html?camp=' + encodeURIComponent(c.id);
      a.textContent = c.plaetze_frei === 0 ? 'Auf die Warteliste' : 'Jetzt anmelden';
      slot.replaceWith(a);
    });
  }).catch(function () { /* Seite bleibt unverändert */ });
})();
