/* Spielplan-Seite: fasst alle Spiele der Profis, Damen und NBBL in einer nach
   Kalendertag gruppierten Liste zusammen (mehrere Teams am selben Tag landen
   in einer gemeinsamen Box) und blendet die Liste per Filter-Chips ein/aus.
   Profis-Heimspiele kommen aus data/heimspiele.json (echte Termine),
   Profis-Auswärtstermine + Damen/NBBL aus data/spielplan-saison.json
   (NBBL-Gegner teils noch "Noch offen", s. Hinweis dort). */
(function () {
  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var TEAM_META = {
    profis: { label: 'Pro B', badgeClass: 'team-badge-profis', url: '/teams-saison/profis.html', tableUrl: '/teams-saison/tabelle.html#tabelle-profis' },
    damen: { label: 'RSLO', badgeClass: 'team-badge-damen', url: '/teams-saison/damen.html', tableUrl: '/teams-saison/tabelle.html#tabelle-damen' },
    nbbl: { label: 'NBBL', badgeClass: 'team-badge-nbbl', url: '/teams-saison/u19.html', tableUrl: '/teams-saison/tabelle.html#tabelle-nbbl' }
  };
  var RIETHSPORTHALLE_MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Essener+Stra%C3%9Fe+20%2C+99089+Erfurt';

  function parseDMY(str) {
    var parts = str.split('.').map(Number);
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatShort(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function gcalStamp(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + '00'; }

  function calendarLink(g) {
    var timeParts = (g.zeit || '00:00').split(':').map(Number);
    var start = new Date(g.date.getFullYear(), g.date.getMonth(), g.date.getDate(), timeParts[0], timeParts[1]);
    var end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    var text = g.heim ? (g.teamLabel + ' – ' + g.gegner) : (g.gegner + ' – ' + g.teamLabel);
    var params = {
      action: 'TEMPLATE',
      text: text,
      dates: gcalStamp(start) + '/' + gcalStamp(end),
      details: g.heim ? 'Heimspiel der Basketball Löwen Erfurt in der Riethsporthalle.' : 'Auswärtsspiel der Basketball Löwen Erfurt.',
      ctz: 'Europe/Berlin'
    };
    if (g.heim) params.location = 'Essener Straße 20, 99089 Erfurt';
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams(params).toString();
  }

  function gameRowHTML(g, divider) {
    var isPast = g.date < window.__spielplanToday;
    var meta = TEAM_META[g.team];
    var matchup = g.heim ? (g.teamLabel + ' – ' + g.gegner) : (g.gegner + ' – ' + g.teamLabel);
    var venueHTML = g.heim
      ? '<span class="venue-heim">Heimspiel</span> · <a href="' + RIETHSPORTHALLE_MAPS_URL + '" target="_blank" rel="noopener">Riethsporthalle</a>'
      : 'Auswärts';
    var actionsHTML = '<div class="fixture-day-actions">' +
      '<div class="fixture-result-row">' +
        '<div class="fixture-result">' + (g.ergebnis || '– – : – –') + '</div>' +
        (g.spielberichtUrl ? '<a class="cal-link" href="' + g.spielberichtUrl + '" title="Zum Spielbericht"><i data-lucide="file-text" style="width:16px;height:16px"></i></a>' : '') +
        '<a class="cal-link" href="' + meta.tableUrl + '" title="Zur Tabelle"><i data-lucide="list-ordered" style="width:16px;height:16px"></i></a>' +
      '</div>' +
      (g.ticketUrl && !isPast ? '<a class="btn btn-outline-orange btn-sm" href="' + g.ticketUrl + '">Tickets <i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>' : '') +
      '</div>';
    return '<div class="fixture-day-game' + (divider ? ' has-divider' : '') + '" data-team="' + g.team + '">' +
      '<div class="fixture-day-meta">' +
        '<div class="fixture-time"><a class="cal-link" href="' + calendarLink(g) + '" target="_blank" rel="noopener" title="Ins Kalender eintragen"><i data-lucide="calendar-plus" style="width:16px;height:16px"></i></a> ' + (g.zeit || '–') + ' Uhr</div>' +
        '<div class="fixture-venue-line"><i data-lucide="map-pin" style="width:14px;height:14px"></i> ' + venueHTML + '</div>' +
      '</div>' +
      '<div class="fixture-mid">' +
        '<a class="team-badge ' + meta.badgeClass + '" href="' + meta.url + '">' + meta.label + '</a>' +
        '<div class="matchup">' + matchup + '</div>' +
      '</div>' +
      actionsHTML +
      '</div>';
  }

  function dayBoxHTML(day) {
    var teams = day.games.map(function (g) { return g.team; });
    var byDate = {};
    var dateOrder = [];
    day.games.forEach(function (g) {
      var k = dateKey(g.date);
      if (!byDate[k]) { byDate[k] = { date: g.date, games: [] }; dateOrder.push(k); }
      byDate[k].games.push(g);
    });
    var groupsHTML = dateOrder.map(function (k, gi) {
      var grp = byDate[k];
      var dateStr = WOCHENTAGE[grp.date.getDay()] + ', ' + formatShort(grp.date);
      return '<div class="fixture-day-group' + (gi > 0 ? ' has-divider' : '') + '">' +
        '<div class="fixture-day-date">' + dateStr + '</div>' +
        grp.games.map(function (g, i) { return gameRowHTML(g, i > 0); }).join('') +
        '</div>';
    }).join('');
    return '<div class="card fixture-day" data-teams="' + teams.join(' ') + '">' + groupsHTML + '</div>';
  }

  function weekendKey(d) {
    var day = d.getDay();
    if (day !== 0 && day !== 5 && day !== 6) return 'day-' + dateKey(d);
    var anchor = new Date(d);
    if (day === 0) anchor.setDate(d.getDate() - 1);
    else if (day === 5) anchor.setDate(d.getDate() + 1);
    return 'wknd-' + dateKey(anchor);
  }

  function groupByDay(games) {
    var map = {};
    var order = [];
    games.forEach(function (g) {
      var key = weekendKey(g.date);
      if (!map[key]) { map[key] = { date: g.date, games: [] }; order.push(key); }
      map[key].games.push(g);
    });
    order.sort(function (a, b) { return map[a].games[0].date - map[b].games[0].date; });
    return order.map(function (key) {
      map[key].games.sort(function (a, b) { return a.date - b.date || (a.zeit || '').localeCompare(b.zeit || ''); });
      return map[key];
    });
  }

  function applyFilter(filter) {
    var boxes = document.querySelectorAll('#spielplan-tage .fixture-day');
    boxes.forEach(function (box) {
      var matches = filter === 'alle' || (box.getAttribute('data-teams') || '').indexOf(filter) !== -1;
      box.style.display = matches ? '' : 'none';
      if (matches) {
        var seenVisibleGroup = false;
        box.querySelectorAll('.fixture-day-group').forEach(function (group) {
          var seenVisible = false;
          group.querySelectorAll('.fixture-day-game').forEach(function (row) {
            var rowMatches = filter === 'alle' || row.getAttribute('data-team') === filter;
            row.style.display = rowMatches ? '' : 'none';
            if (rowMatches) {
              row.classList.toggle('has-divider', seenVisible);
              seenVisible = true;
            }
          });
          group.style.display = seenVisible ? '' : 'none';
          if (seenVisible) {
            group.classList.toggle('has-divider', seenVisibleGroup);
            seenVisibleGroup = true;
          }
        });
      }
    });
    document.querySelectorAll('#spielplan-cal-row [data-team]').forEach(function (btn) {
      btn.style.display = (filter === 'alle' || btn.getAttribute('data-team') === filter) ? '' : 'none';
    });
  }

  function renderDayList(days) {
    var container = document.getElementById('spielplan-tage');
    if (!container) return;
    container.innerHTML = days.map(dayBoxHTML).join('');
    if (window.lucide) lucide.createIcons();
  }

  function initFilterChips() {
    var row = document.getElementById('spielplan-filter');
    if (!row) return;
    row.addEventListener('click', function (e) {
      var chip = e.target.closest('.filter-chip');
      if (!chip) return;
      row.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      applyFilter(chip.getAttribute('data-filter'));
    });
  }

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  window.__spielplanToday = today;

  Promise.all([
    fetch('/data/heimspiele.json?v=1785200000').then(function (r) { return r.json(); }),
    fetch('/data/spielplan-saison.json?v=1785200000').then(function (r) { return r.json(); })
  ]).then(function (results) {
    var heim = results[0], saison = results[1];

    function toGame(s, heimBool, teamLabel, team) {
      var g = Object.assign({}, s);
      g.date = parseDMY(s.datum);
      g.heim = heimBool;
      g.teamLabel = teamLabel;
      g.team = team;
      return g;
    }

    var profisGames = heim.spiele.map(function (s) { return toGame(s, true, 'Löwen Erfurt', 'profis'); })
      .concat(saison.profisAuswaerts.map(function (s) { return toGame(s, false, 'Löwen Erfurt', 'profis'); }))
      .sort(function (a, b) { return a.date - b.date; });

    var damenGames = (saison.damen.spiele || []).map(function (s) { return toGame(s, s.heim, 'Löwinnen Erfurt', 'damen'); });
    var nbblGames = (saison.nbbl.spiele || []).map(function (s) { return toGame(s, s.heim, 'U19', 'nbbl'); });

    var alleGames = profisGames.concat(damenGames, nbblGames).sort(function (a, b) {
      if (a.date - b.date !== 0) return a.date - b.date;
      return (a.zeit || '').localeCompare(b.zeit || '');
    });

    renderDayList(groupByDay(alleGames));
    initFilterChips();

    window.__spielplanProfisGames = profisGames;
    window.dispatchEvent(new Event('spielplan:ready'));
  });
})();
