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
    profis: { label: 'Pro B', badgeClass: 'team-badge-profis', url: '/saison/profis.html', tableUrl: '/saison/tabelle.html#tabelle-profis' },
    damen: { label: 'RLSO', badgeClass: 'team-badge-damen', url: '/saison/damen.html', tableUrl: '/saison/tabelle.html#tabelle-damen' },
    nbbl: { label: 'NBBL', badgeClass: 'team-badge-nbbl', url: '/saison/nbbl.html', tableUrl: '/saison/tabelle.html#tabelle-nbbl' }
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
      // Default-Heimspielstätte für alle Teams (Profis, Damen, NBBL) ist die
      // Riethsporthalle, solange für ein konkretes Spiel nichts anderes bekannt ist
      // (Marko, 10.08.2026 — Damen spielen ebenfalls dort).
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
    var dateTimeStr = WOCHENTAGE[g.date.getDay()] + ', ' + formatShort(g.date) + (g.zeit ? ', ' + g.zeit + ' Uhr' : '');
    var venueHTML, statusHTML;
    if (g.heim) {
      // Default-Heimspielstätte für alle Teams ist die Riethsporthalle, solange für
      // ein konkretes Spiel nichts anderes bekannt ist (Marko, 10.08.2026 — Damen
      // spielen ebenfalls dort).
      venueHTML = '<div class="fixture-venue-line"><a href="' + RIETHSPORTHALLE_MAPS_URL + '" target="_blank" rel="noopener"><i data-lucide="map-pin" style="width:14px;height:14px"></i> Riethsporthalle</a></div>';
      statusHTML = '<span class="venue-heim">Heimspiel</span>';
    } else if (g.ort) {
      /* g.ort ist ein best-effort abgeleiteter Ort fürs Auswärtsspiel (kein
         exakter Hallenname), s. Hinweis in data/spielplan-saison.json — dient
         nur als grober Orientierungslink, wie weit das Spiel von Erfurt entfernt ist. */
      venueHTML = '<div class="fixture-venue-line"><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(g.ort) + '" target="_blank" rel="noopener"><i data-lucide="map-pin" style="width:14px;height:14px"></i> ' + g.ort + '</a></div>';
      statusHTML = '<span class="venue-auswaerts">Auswärts</span>';
    } else {
      venueHTML = '';
      statusHTML = '<span class="venue-auswaerts">Auswärts</span>';
    }
    var actionsHTML = '<div class="fixture-day-actions">' +
      '<div class="fixture-result-row">' +
        '<div class="fixture-result">' + (g.ergebnis || '– – : – –') + '</div>' +
        (g.spielberichtUrl ? '<a class="cal-link" href="' + g.spielberichtUrl + '" title="Zum Spielbericht"><i data-lucide="file-text" style="width:16px;height:16px"></i></a>' : '') +
        '<a class="cal-link" href="' + meta.tableUrl + '" title="Zur Tabelle"><i data-lucide="list-ordered" style="width:16px;height:16px"></i></a>' +
        '<a class="cal-link" href="' + calendarLink(g) + '" target="_blank" rel="noopener" title="Ins Kalender eintragen"><i data-lucide="calendar-plus" style="width:16px;height:16px"></i></a>' +
      '</div>' +
      (g.ticketUrl && !isPast ? '<a class="btn btn-outline-orange btn-sm" href="' + g.ticketUrl + '">Tickets <i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>' : '') +
      '</div>';
    return '<div class="fixture-day-game' + (divider ? ' has-divider' : '') + '" data-team="' + g.team + '" data-heim="' + (g.heim ? '1' : '0') + '">' +
      '<div class="fixture-day-meta">' +
        '<div class="fixture-time">' + dateTimeStr + '</div>' +
        venueHTML +
        statusHTML +
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
    var rowsHTML = day.games.map(function (g, i) { return gameRowHTML(g, i > 0); }).join('');
    return '<div class="card fixture-day" data-teams="' + teams.join(' ') + '">' + rowsHTML + '</div>';
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

  var currentTeamFilter = 'alle';
  var onlyHeim = false;

  function applyFilter(filter) {
    if (typeof filter === 'string') currentTeamFilter = filter;
    var boxes = document.querySelectorAll('#spielplan-tage .fixture-day');
    boxes.forEach(function (box) {
      var teamOk = currentTeamFilter === 'alle' || (box.getAttribute('data-teams') || '').indexOf(currentTeamFilter) !== -1;
      var seenVisible = false;
      if (teamOk) {
        box.querySelectorAll('.fixture-day-game').forEach(function (row) {
          var rowTeamOk = currentTeamFilter === 'alle' || row.getAttribute('data-team') === currentTeamFilter;
          var rowHeimOk = !onlyHeim || row.getAttribute('data-heim') === '1';
          var rowMatches = rowTeamOk && rowHeimOk;
          row.style.display = rowMatches ? '' : 'none';
          if (rowMatches) {
            row.classList.toggle('has-divider', seenVisible);
            seenVisible = true;
          }
        });
      }
      box.style.display = (teamOk && seenVisible) ? '' : 'none';
    });
    document.querySelectorAll('#spielplan-cal-row [data-team]').forEach(function (btn) {
      btn.style.display = (currentTeamFilter === 'alle' || btn.getAttribute('data-team') === currentTeamFilter) ? '' : 'none';
    });
  }

  function initHeimToggle() {
    var checkbox = document.getElementById('spielplan-heim-only');
    if (!checkbox) return;
    checkbox.addEventListener('change', function () {
      onlyHeim = checkbox.checked;
      applyFilter();
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
    fetch('/data/heimspiele.json?v=1786356737').then(function (r) { return r.json(); }),
    fetch('/data/spielplan-saison.json?v=1786381322').then(function (r) { return r.json(); })
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

    var profisGames = heim.spiele.map(function (s) { return toGame(s, true, 'Basketball Löwen', 'profis'); })
      .concat(saison.profisAuswaerts.map(function (s) { return toGame(s, false, 'Basketball Löwen', 'profis'); }))
      .sort(function (a, b) { return a.date - b.date; });

    var damenGames = (saison.damen.spiele || []).map(function (s) { return toGame(s, s.heim, 'Löwinnen Erfurt', 'damen'); });
    var nbblGames = (saison.nbbl.spiele || []).map(function (s) { return toGame(s, s.heim, 'U19', 'nbbl'); });

    var alleGames = profisGames.concat(damenGames, nbblGames).sort(function (a, b) {
      if (a.date - b.date !== 0) return a.date - b.date;
      return (a.zeit || '').localeCompare(b.zeit || '');
    });

    renderDayList(groupByDay(alleGames));
    initFilterChips();
    initHeimToggle();

    /* Team-Seiten (Profis/Damen/U19) verlinken mit ?team=... hierher — Filter
       direkt entsprechend vorauswählen statt "Alle" zu zeigen. */
    var urlParams = new URLSearchParams(location.search);
    var urlTeam = urlParams.get('team');
    if (urlTeam && TEAM_META[urlTeam]) {
      var filterRow = document.getElementById('spielplan-filter');
      var chip = filterRow && filterRow.querySelector('.filter-chip[data-filter="' + urlTeam + '"]');
      if (chip) {
        filterRow.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        applyFilter(urlTeam);
      }
    }

    /* Sponsoring-Seite verlinkt mit ?heim=1 hierher (Sichtbarkeit-Kachel) —
       "Nur Heimspiele" direkt vorauswählen. */
    if (urlParams.get('heim') === '1') {
      var heimCheckbox = document.getElementById('spielplan-heim-only');
      if (heimCheckbox) {
        heimCheckbox.checked = true;
        heimCheckbox.dispatchEvent(new Event('change'));
      }
    }

    window.__spielplanProfisGames = profisGames;
    window.dispatchEvent(new Event('spielplan:ready'));
  });
})();
