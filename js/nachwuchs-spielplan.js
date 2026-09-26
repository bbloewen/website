/* Spielplan-Slider auf saison/nachwuchs.html: buendelt die Spiele aller
   eigenen MDL-Nachwuchsteams (U12-U17) aus /data/nachwuchs-spielplan.json zu
   einem einzigen, chronologisch sortierten Kachel-Slider unter dem Team-Grid
   (Marko, 27.09.2026: "eigenen Slider-Bereich ... eine Kachel ein Spieltag
   pro Team"). Gleiches Scroll-Verhalten wie bei den Community-Events
   (js/community-events.js): direkt nach dem Rendern wird auf das naechste
   anstehende Spiel gescrollt, vergangene Spiele mit Ergebnis bleiben erhalten
   und sind nur noch ueber den Pfeil nach links erreichbar. Ort ist bewusst
   nicht Teil der Kachel -- basketball-bund.net liefert dafuer keine Adresse,
   und Marko wollte das Feld deshalb erstmal weglassen (27.09.2026). */
(function () {
  var container = document.getElementById('nachwuchs-spielplan');
  if (!container) return;
  var track = container.querySelector('.news-slider-track');
  var prevBtn = container.querySelector('[data-gallery-prev]');
  var nextBtn = container.querySelector('[data-gallery-next]');

  var TEAM_LABEL = {
    'U12m/1': 'MDL U12', 'U13m': 'MDL U13', 'U14m': 'MDL U14', 'U15m': 'MDL U15', 'U17m': 'MDL U17'
  };
  /* Wie in unserName in tools/fetch-nachwuchs-spielplan.py: U17m tritt offiziell
     unter BIG Gotha an (Kooperation Rockets & Löwen), alle anderen unter
     Basketball Löwen Erfurt. */
  var UNSER_NAME = {
    'U12m/1': 'Basketball Löwen', 'U13m': 'Basketball Löwen', 'U14m': 'Basketball Löwen',
    'U15m': 'Basketball Löwen', 'U17m': 'BIG Gotha'
  };
  var WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function gcalStamp(zeitISO, uhrzeit) {
    var teile = (uhrzeit || '00:00').split(':').map(Number);
    var d = new Date(zeitISO + 'T00:00:00');
    d.setHours(teile[0], teile[1], 0, 0);
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + '00';
  }

  function calendarLink(spiel, teamLabel, unserName) {
    var start = new Date(spiel.datum + 'T00:00:00');
    var teile = (spiel.zeit || '00:00').split(':').map(Number);
    start.setHours(teile[0], teile[1], 0, 0);
    var ende = new Date(start.getTime() + 90 * 60 * 1000);
    var text = spiel.heim ? (unserName + ' – ' + spiel.gegner) : (spiel.gegner + ' – ' + unserName);
    var params = {
      action: 'TEMPLATE',
      text: teamLabel + ': ' + text,
      dates: gcalStamp(spiel.datum, spiel.zeit) + '/' + gcalStamp(spiel.datum, ende.getHours() + ':' + pad2(ende.getMinutes())),
      details: 'Nachwuchs-Ligaspiel der Basketball Löwen Erfurt (' + teamLabel + ').',
      ctz: 'Europe/Berlin'
    };
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams(params).toString();
  }

  function datumLabel(iso) {
    var d = new Date(iso + 'T00:00:00');
    return WOCHENTAGE[d.getDay()] + ', ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.';
  }

  function cardHTML(spiel) {
    var teamLabel = TEAM_LABEL[spiel._team] || spiel._team;
    var unserName = spiel._unserName;
    var matchup = spiel.heim ? (unserName + ' – ' + spiel.gegner) : (spiel.gegner + ' – ' + unserName);
    var zeitText = spiel.abgesagt ? 'Abgesagt' : (datumLabel(spiel.datum) + ', ' + (spiel.zeit || '') + ' Uhr');
    var zeitHTML = spiel.abgesagt
      ? '<span>' + zeitText + '</span>'
      : '<a href="' + calendarLink(spiel, teamLabel, unserName) + '" target="_blank" rel="noopener" title="In Kalender eintragen" style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">' +
          '<i data-lucide="calendar-plus" class="icon-14"></i>' + zeitText + '</a>';
    var ergebnisHTML = spiel.ergebnis
      ? '<div class="fixture-result-row" style="margin-top:8px"><div class="fixture-result">' + spiel.ergebnis + '</div></div>'
      : '';
    return (
      '<div class="card hoverable camp-slider-card" data-datum="' + spiel.datum + '" data-hat-ergebnis="' + (spiel.ergebnis ? '1' : '0') + '">' +
        '<div class="card-body">' +
          '<span class="card-label" style="display:flex;align-items:center;gap:8px">' + teamLabel + ' · ' + (spiel.heim ? 'Heim' : 'Auswärts') + '</span>' +
          '<h3 style="font-size:17px">' + matchup + '</h3>' +
          '<p class="t-body-sm" style="color:var(--text-muted);display:flex;align-items:center;gap:6px">' + zeitHTML + '</p>' +
          ergebnisHTML +
        '</div>' +
      '</div>'
    );
  }

  fetch('/data/nachwuchs-spielplan.json')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var alle = [];
      Object.keys(data.teams || {}).forEach(function (teamKey) {
        var team = data.teams[teamKey];
        (team.spiele || []).forEach(function (spiel) {
          alle.push(Object.assign({}, spiel, { _team: teamKey, _unserName: UNSER_NAME[teamKey] || 'Basketball Löwen' }));
        });
      });
      if (!alle.length) return;

      alle.sort(function (a, b) {
        return (a.datum + (a.zeit || '')).localeCompare(b.datum + (b.zeit || ''));
      });
      track.innerHTML = alle.map(cardHTML).join('');
      if (window.lucide) lucide.createIcons();

      var heute = new Date().toISOString().slice(0, 10);
      var cards = Array.prototype.slice.call(track.querySelectorAll('.camp-slider-card'));
      var naechste = cards.find(function (c) { return c.getAttribute('data-datum') >= heute; }) || cards[cards.length - 1];
      if (naechste) track.scrollTo({ left: naechste.offsetLeft, behavior: 'instant' });

      if (prevBtn) prevBtn.addEventListener('click', function () { track.scrollBy({ left: -400, behavior: 'smooth' }); });
      if (nextBtn) nextBtn.addEventListener('click', function () { track.scrollBy({ left: 400, behavior: 'smooth' }); });
    });
})();
