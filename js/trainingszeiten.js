document.addEventListener('DOMContentLoaded', function () {
  var grid = document.getElementById('trainingszeiten-grid');
  if (!grid) return;

  var TEAM_LABELS = {
    'U8mix und jünger': 'U8 mixed',
    'U9mix': 'U9 mixed',
    'U10mix': 'U10 mixed',
    'U10mix und jünger': 'U10 mixed',
    'U10w und jünger': 'U10 weiblich',
    'U11mix': 'U11 mixed',
    'U12mix': 'U12 mixed',
    'U12m/1': 'U12 männlich',
    'U12w': 'U12 weiblich',
    'U13mix': 'U13 mixed',
    'U13m': 'U13 männlich',
    'U14mix': 'U14 mixed',
    'U14m': 'U14 männlich',
    'U14w': 'U14 weiblich',
    'U15m': 'U15 männlich',
    'U16m': 'U16 männlich',
    'U16w': 'U16 weiblich',
    'U19m': 'U19 männlich',
    'U19w': 'U19 weiblich'
  };

  /* Team-Kategorie-Kürzel für den Team-Filter (dieselbe Kategorie über alle
     Vereine hinweg, z.B. "U19w" fasst BC-Erfurt- und Basketball-Löwen-Teams
     zusammen) — bewusst kompakt ("mix" statt "mixed", "w"/"m" klein), im
     Unterschied zur ausgeschriebenen Form in den Kacheln (TEAM_LABELS). */
  var TEAM_KEY = {
    'U8mix und jünger': 'U8mix',
    'U9mix': 'U9mix',
    'U10mix': 'U10mix',
    'U10mix und jünger': 'U10mix',
    'U10w und jünger': 'U10w',
    'U11mix': 'U11mix',
    'U12mix': 'U12mix',
    'U12m/1': 'U12m',
    'U12w': 'U12w',
    'U13mix': 'U13mix',
    'U13m': 'U13m',
    'U14mix': 'U14mix',
    'U14m': 'U14m',
    'U14w': 'U14w',
    'U15m': 'U15m',
    'U16m': 'U16m',
    'U16w': 'U16w',
    'U19m': 'U19m',
    'U19w': 'U19w'
  };

  var vereinLabel = {
    'bc-erfurt': 'BC Erfurt',
    'usv-erfurt': 'USV Erfurt',
    'loewinnen': 'Basketball Löwen'
  };
  var vereinBadgeClass = {
    'bc-erfurt': 'team-badge-bc-erfurt',
    'usv-erfurt': 'team-badge-usv-erfurt',
    'loewinnen': 'team-badge-loewinnen'
  };
  /* Verlinkung der Vereins-Badges auf die jeweilige Trainingszeiten-Seite des
     Vereins — Basketball Löwen bleibt unverlinkt, das ist bereits diese Seite. */
  var vereinLink = {
    'bc-erfurt': 'https://bcerfurt.de/training',
    'usv-erfurt': 'https://usv-erfurt-basketball.de/training'
  };

  // Feste Reihenfolge der Erwachsenenteams (aelter als U19) am Ende der Team-Filter-
  // Liste -- diese Teams haben keine U-Nummer, nach der sonst sortiert wird.
  var ERWACHSENEN_TEAM_REIHENFOLGE = ['Oberliga Herren 1', 'Landesliga Herren 2', 'Landesliga Herren 3', 'Damen', 'Freizeit Mixed'];

  // Adressen von der BC-Erfurt-Trainingsseite übernommen (bcerfurt.de/training),
  // damit unsere Angaben mit denen des Partnervereins übereinstimmen.
  var ORT_DISPLAY = {
    'Muldenweg (Feld 1)': 'Sporthalle Muldenweg, Kranichfelder Straße 56, 99097 Erfurt-Melchendorf',
    'Südparkhalle (Feld 1)': 'Südparkhalle, Johann-Sebastian-Bach-Straße 7, 99096 Erfurt',
    'Südparkhalle (Feld 2)': 'Südparkhalle, Johann-Sebastian-Bach-Straße 7, 99096 Erfurt',
    'Südparkhalle (Feld 3)': 'Südparkhalle, Johann-Sebastian-Bach-Straße 7, 99096 Erfurt',
    'Südparkhalle (Feld 2+3)': 'Südparkhalle, Johann-Sebastian-Bach-Straße 7, 99096 Erfurt',
    'Eugen-Richter-Halle (Feld 2)': 'Eugen-Richter-Halle, Eugen-Richter-Straße 22, 99085 Erfurt',
    'Christophorushalle': 'Christophorushalle, Spittelgartenstraße 1, 99089 Erfurt',
    'Bukarester Straße': 'Regelschule An der Geraue, Bukarester Straße 3, 99091 Erfurt',
    'Südparkhalle': 'Südparkhalle, Johann-Sebastian-Bach-Straße 7, 99096 Erfurt',
    'Riethsporthalle (Feld 1)': 'Riethsporthalle, Essener Straße 20, 99089 Erfurt',
    'Ullrich-von-Hutten-Schule': 'Turnhalle Ullrich-von-Hutten-Schule, Grünstraße 9, 99084 Erfurt',
    'Domsporthalle': 'Domsporthalle, Domstraße 1C, 99084 Erfurt'
  };

  var WOCHENTAG_INDEX = { 'So': 0, 'Mo': 1, 'Di': 2, 'Mi': 3, 'Do': 4, 'Fr': 5, 'Sa': 6 };
  var WOCHENTAG_LANG = { 'So': 'Sonntag', 'Mo': 'Montag', 'Di': 'Dienstag', 'Mi': 'Mittwoch', 'Do': 'Donnerstag', 'Fr': 'Freitag', 'Sa': 'Samstag' };
  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  /* Für die Wochentag-Sortierung zählt die Woche ab Montag (anders als
     WOCHENTAG_INDEX oben, das für die Kalenderlink-Berechnung bei So=0
     bleiben muss). */
  var WOCHENTAG_SORT_ORDER = { 'Mo': 1, 'Di': 2, 'Mi': 3, 'Do': 4, 'Fr': 5, 'Sa': 6, 'So': 7 };

  /* Sortierwert eines einzelnen Termins: Wochentag zuerst, dann Startzeit
     desselben Tages — für Teams mit mehreren Terminen zählt beim
     Wochentag-Sortieren der früheste. */
  function terminSortWert(t) {
    var tagWert = WOCHENTAG_SORT_ORDER[t.tag] || 8;
    var m = t.zeit.match(/(\d{1,2}):(\d{2})/);
    var minuten = m ? (+m[1] * 60 + +m[2]) : 0;
    return tagWert * 10000 + minuten;
  }

  /* "X und jünger" gilt nur für Teams, die selbst offen nach unten benannt sind
     (aktuell nur "U10w und jünger") — alle anderen Mehrjahrgangs-Teams zeigen
     die exakten Jahrgänge aus dem Sheet (z.B. "2008/2009/2010" bei U19), nicht
     zusammengefasst auf den jüngsten Jahrgang. */
  function jahrgangLabel(g) {
    if (g.team.indexOf('und jünger') !== -1) return Math.max.apply(null, g.jahre) + ' und jünger';
    return g.jahrgang;
  }

  function ortDisplay(ort) {
    return ORT_DISPLAY[ort] || ort;
  }

  function mapsLink(ort) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ortDisplay(ort));
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function gcalStamp(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + '00'; }

  function nextWeekday(tag) {
    var target = WOCHENTAG_INDEX[tag];
    var now = new Date();
    var diff = (target - now.getDay() + 7) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  }

  function calendarLink(tag, zeit, titel, ort) {
    var m = zeit.match(/(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var day = nextWeekday(tag);
    var start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +m[1], +m[2]);
    var end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +m[3], +m[4]);
    var params = {
      action: 'TEMPLATE',
      text: titel,
      dates: gcalStamp(start) + '/' + gcalStamp(end),
      details: 'Training der Basketball Löwen Erfurt.',
      location: ortDisplay(ort),
      recur: 'RRULE:FREQ=WEEKLY',
      ctz: 'Europe/Berlin'
    };
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams(params).toString();
  }

  /* Konkretes Datum des nächsten passenden Wochentags (z.B. "Dienstag, 25.
     August 2026"), damit die vorausgefüllte Nachricht nicht nur den
     Wochentag, sondern ein echtes Datum zum ausgewählten Probetraining-Termin
     enthält. */
  function naechstesDatumText(tag) {
    var d = nextWeekday(tag);
    return WOCHENTAG_LANG[tag] + ', ' + d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear();
  }

  function probetrainingLink(teamName, jahrgang, verein, termin) {
    var betreff = 'Probetraining-Anfrage: ' + teamName + ' (' + jahrgang + ')';
    var terminZeile = '';
    if (termin) {
      terminZeile = '\n\nWir möchten am ' + naechstesDatumText(termin.tag) + ' (' + termin.zeit + ') bei ' + ortDisplay(termin.ort) + ' zum Probetraining kommen.';
    }
    var nachricht = 'Hallo,\n\nwir interessieren uns für ein Probetraining bei ' + teamName +
      ' (' + jahrgang + ', ' + vereinLabel[verein] + ').' + terminZeile + '\n\nBitte meldet euch bei uns.\n\nViele Grüße';
    var params = new URLSearchParams({ betreff: betreff, nachricht: nachricht });
    return '/kontakt.html?' + params.toString();
  }

  /* Flache Liste aller einzelnen Trainingstermine (ein Eintrag pro Team+Tag),
     Grundlage für die Wochentag-/Halle-Gruppierung. Teams ohne Termine
     ("Zeiten folgen in Kürze") haben keinen Tag/keine Halle, zum Gruppieren
     zu gehören, und bleiben daher nur im Team-Modus sichtbar. */
  function buildSessions(gruppen) {
    var sessions = [];
    gruppen.forEach(function (g) {
      if (!g.termine || !g.termine.length) return;
      var teamName = TEAM_LABELS[g.team] || g.team;
      var jahrgang = jahrgangLabel(g);
      var teamKey = TEAM_KEY[g.team] || g.team;
      g.termine.forEach(function (t) {
        sessions.push({
          teamName: teamName, jahrgang: jahrgang, teamKey: teamKey,
          verein: g.verein, jahre: g.jahre, trainer: g.trainer,
          tag: t.tag, zeit: t.zeit, ort: t.ort,
          termin: t
        });
      });
    });
    return sessions;
  }

  function zeitLinkHTML(tag, zeit, vorbehaltlich, titel, ort, mitTag) {
    var cal = calendarLink(tag, zeit, titel, ort);
    var zeitText = (mitTag ? tag + ' ' : '') + zeit;
    if (vorbehaltlich) zeitText += ' (' + vorbehaltlich + ')';
    return cal
      ? '<a class="training-slot-zeit" href="' + cal + '" target="_blank" rel="noopener" title="Zum Kalender hinzufügen"><i data-lucide="calendar-plus" class="icon-14"></i><span>' + zeitText + '</span></a>'
      : '<div class="training-slot-zeit"><span>' + zeitText + '</span></div>';
  }

  function vereinBadgeHTML(verein) {
    return vereinLink[verein]
      ? '<a class="team-badge ' + vereinBadgeClass[verein] + '" href="' + vereinLink[verein] + '" target="_blank" rel="noopener">' + vereinLabel[verein] + '</a>'
      : '<span class="team-badge ' + vereinBadgeClass[verein] + '">' + vereinLabel[verein] + '</span>';
  }

  /* Eine Zeile je Trainingstermin für den Wochentag-/Halle-Modus — anders als
     cardHTML() (eine Box je Team) landen hier Zeit+Team in der Zeile selbst,
     weil die Box-Überschrift der Wochentag bzw. die Halle ist, nicht mehr das
     Team. Im Wochentag-Modus steht der Ort noch mit in der Zeile (eine
     Wochentag-Box mischt mehrere Hallen); im Halle-Modus nicht mehr (die
     Halle steht schon in der Box-Überschrift), dafür der Tag mit in der Zeit. */
  function sessionRowHTML(s, modus) {
    var titel = s.teamName + ' (' + s.jahrgang + ')';
    var mitTag = modus === 'halle';
    var zeitHTML = zeitLinkHTML(s.tag, s.zeit, s.vorbehaltlich, titel, s.ort, mitTag);
    var ortLine = modus === 'wochentag'
      ? '<div class="training-slot-ort"><i data-lucide="map-pin" class="icon-14"></i><a href="' + mapsLink(s.ort) + '" target="_blank" rel="noopener">' + ortDisplay(s.ort) + '</a></div>'
      : '';
    var probLink = '<a class="training-row-probetraining" href="' + probetrainingLink(s.teamName, s.jahrgang, s.verein, s.termin) + '">Probetraining vereinbaren</a>';
    return (
      '<div class="training-session-row" data-verein="' + s.verein + '" data-jahre="' + s.jahre.join(',') + '" data-team="' + s.teamKey + '">' +
        '<div>' +
          '<div class="training-session-team">' + zeitHTML + '<span>· ' + s.teamName + ' <span class="training-row-jahrgang">(' + s.jahrgang + ')</span></span></div>' +
          ortLine +
        '</div>' +
        '<div class="training-row-trainer">' +
          vereinBadgeHTML(s.verein) +
          '<div class="training-row-trainer-label">Trainer:innen:</div><div>' + (s.trainer || '') + '</div>' +
          probLink +
        '</div>' +
      '</div>'
    );
  }

  /* Gruppiert die Termine nach Wochentag oder Halle (statt nach Team) und
     baut je Gruppe eine eigene Box — auf Markos Wunsch für die Wochentag-/
     Halle-Sortierung: "eine Box pro Wochentag" bzw. "eine Box pro Halle". */
  function groupedHTML(sessions, modus) {
    var groups = {};
    var keys = [];
    sessions.forEach(function (s) {
      var key = modus === 'wochentag' ? s.tag : ortDisplay(s.ort);
      if (!groups[key]) {
        groups[key] = { label: modus === 'wochentag' ? WOCHENTAG_LANG[s.tag] : key, sessions: [] };
        keys.push(key);
      }
      groups[key].sessions.push(s);
    });
    keys.forEach(function (key) {
      groups[key].sessions.sort(function (a, b) { return terminSortWert(a.termin) - terminSortWert(b.termin); });
    });
    keys.sort(function (a, b) {
      if (modus === 'wochentag') return (WOCHENTAG_SORT_ORDER[a] || 8) - (WOCHENTAG_SORT_ORDER[b] || 8);
      return a.localeCompare(b, 'de');
    });
    return keys.map(function (key) {
      var group = groups[key];
      var rowsHTML = group.sessions.map(function (s) { return sessionRowHTML(s, modus); }).join('');
      // Im Halle-Modus ist die Box-Überschrift bereits die Adresse (key) —
      // direkt darüber auf Google Maps verlinken.
      var headerHTML = modus === 'halle'
        ? '<a class="training-group-header" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(key) + '" target="_blank" rel="noopener">' + group.label + '</a>'
        : '<div class="training-group-header">' + group.label + '</div>';
      return (
        '<div class="card training-group">' +
          headerHTML +
          '<div class="training-group-rows">' + rowsHTML + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function cardHTML(g) {
    var teamName = TEAM_LABELS[g.team] || g.team;
    var jahrgang = jahrgangLabel(g);
    var titel = teamName + ' (' + jahrgang + ')';
    var zeitenHTML;
    if (g.termine && g.termine.length) {
      zeitenHTML = g.termine.map(function (t) {
        var cal = calendarLink(t.tag, t.zeit, titel, t.ort);
        var zeitText = t.tag + ' ' + t.zeit;
        if (t.vorbehaltlich) zeitText += ' (' + t.vorbehaltlich + ')';
        var zeitHTML = cal
          ? '<a class="training-slot-zeit" href="' + cal + '" target="_blank" rel="noopener" title="Zum Kalender hinzufügen"><i data-lucide="calendar-plus" class="icon-14"></i><span>' + zeitText + '</span></a>'
          : '<div class="training-slot-zeit"><span>' + zeitText + '</span></div>';
        var ortHTML = '<div class="training-slot-ort"><i data-lucide="map-pin" class="icon-14"></i><a href="' + mapsLink(t.ort) + '" target="_blank" rel="noopener">' + ortDisplay(t.ort) + '</a></div>';
        var probLink = '<a class="training-row-probetraining" href="' + probetrainingLink(teamName, jahrgang, g.verein, t) + '">Probetraining vereinbaren</a>';
        return '<div class="training-slot">' + zeitHTML + ortHTML + probLink + '</div>';
      }).join('');
    } else {
      var probLinkOhneTermin = '<a class="training-row-probetraining" href="' + probetrainingLink(teamName, jahrgang, g.verein, null) + '">Probetraining vereinbaren</a>';
      zeitenHTML = '<div class="training-slot"><em>' + (g.hinweis || 'Zeiten folgen in Kürze') + '</em>' + probLinkOhneTermin + '</div>';
    }
    var badgeHTML = vereinLink[g.verein]
      ? '<a class="team-badge ' + vereinBadgeClass[g.verein] + '" href="' + vereinLink[g.verein] + '" target="_blank" rel="noopener">' + vereinLabel[g.verein] + '</a>'
      : '<span class="team-badge ' + vereinBadgeClass[g.verein] + '">' + vereinLabel[g.verein] + '</span>';
    var teamKey = TEAM_KEY[g.team] || g.team;
    return (
      '<div class="card training-row" data-verein="' + g.verein + '" data-jahre="' + g.jahre.join(',') + '" data-team="' + teamKey + '">' +
        '<div>' +
          '<div class="training-row-team">' + teamName + ' <span class="training-row-jahrgang">(' + jahrgang + ')</span></div>' +
          '<div class="training-row-zeiten">' + zeitenHTML + '</div>' +
        '</div>' +
        '<div class="training-row-trainer">' +
          badgeHTML +
          '<div class="training-row-trainer-label">Trainer:innen:</div><div>' + (g.trainer || '') + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  fetch('/data/trainingszeiten.json?v=1787394380')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      // Reihenfolge = Reihenfolge im JSON: juengster Jahrgang oben, Erwachsenenteams
      // (aelter als U19) stehen dort bewusst am Ende und rutschen damit ans Ende der Liste.
      var gruppenTeamReihenfolge = data.gruppen.slice();
      var sessions = buildSessions(gruppenTeamReihenfolge);

      var alleJahre = Array.from(new Set(data.gruppen.reduce(function (acc, g) { return acc.concat(g.jahre); }, [])));
      alleJahre.sort(function (a, b) { return a - b; });
      var jahrgangSelect = document.getElementById('jahrgang-filter');
      alleJahre.forEach(function (jahr) {
        var opt = document.createElement('option');
        opt.value = jahr;
        opt.textContent = jahr;
        jahrgangSelect.appendChild(opt);
      });

      var alleTeams = Array.from(new Set(data.gruppen.map(function (g) { return TEAM_KEY[g.team] || g.team; })));
      // Erwachsenenteams (aelter als U19) haben keine U-Nummer und stehen in einer
      // festen Reihenfolge ganz am Ende, statt ueber die U-Jahrgaenge sortiert zu werden.
      alleTeams.sort(function (a, b) {
        var ia = ERWACHSENEN_TEAM_REIHENFOLGE.indexOf(a);
        var ib = ERWACHSENEN_TEAM_REIHENFOLGE.indexOf(b);
        if (ia !== -1 || ib !== -1) {
          if (ia === -1) return -1;
          if (ib === -1) return 1;
          return ia - ib;
        }
        var na = parseInt(a.match(/\d+/)[0], 10);
        var nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb || a.localeCompare(b);
      });
      var teamSelect = document.getElementById('team-filter');
      alleTeams.forEach(function (team) {
        var opt = document.createElement('option');
        opt.value = team;
        opt.textContent = team;
        teamSelect.appendChild(opt);
      });

      var chips = document.querySelectorAll('.filter-chip');
      var currentVerein = 'alle';
      var currentJahr = 'alle';
      var currentTeam = 'alle';

      /* Team-Modus zeigt eine Box je Team (cardHTML), Wochentag/Halle
         gruppieren stattdessen die einzelnen Termine neu (groupedHTML) —
         ein Moduswechsel baut das Grid deshalb komplett neu, ein reines
         Verschieben bestehender Boxen reicht hier nicht mehr aus. */
      function render(modus) {
        grid.innerHTML = (modus === 'wochentag' || modus === 'halle')
          ? groupedHTML(sessions, modus)
          : gruppenTeamReihenfolge.map(cardHTML).join('');
        if (window.lucide) window.lucide.createIcons();
        applyFilters();
      }

      function applyFilters() {
        var rows = grid.querySelectorAll('[data-verein]');
        rows.forEach(function (row) {
          var vereinOk = currentVerein === 'alle' || row.getAttribute('data-verein') === currentVerein;
          var jahre = row.getAttribute('data-jahre').split(',');
          var jahrOk = currentJahr === 'alle' || jahre.indexOf(currentJahr) !== -1;
          var teamOk = currentTeam === 'alle' || row.getAttribute('data-team') === currentTeam;
          row.hidden = !(vereinOk && jahrOk && teamOk);
        });
        // Wochentag-/Halle-Box ausblenden, wenn alle ihre Zeilen weggefiltert sind.
        grid.querySelectorAll('.training-group').forEach(function (group) {
          var zeilen = group.querySelectorAll('.training-session-row');
          group.hidden = Array.prototype.every.call(zeilen, function (z) { return z.hidden; });
        });
      }

      var sortSelect = document.getElementById('sort-select');
      sortSelect.addEventListener('change', function () { render(sortSelect.value); });
      render(sortSelect.value);

      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          chips.forEach(function (c) { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
          chip.classList.add('is-active');
          chip.setAttribute('aria-pressed', 'true');
          currentVerein = chip.getAttribute('data-filter');
          // "Alle" setzt auch Jahrgang- und Team-Filter zurück, damit wirklich
          // alle Zeilen wieder sichtbar werden statt nur den Verein zu lösen.
          if (currentVerein === 'alle') {
            currentJahr = 'alle';
            currentTeam = 'alle';
            jahrgangSelect.value = 'alle';
            teamSelect.value = 'alle';
          }
          applyFilters();
        });
      });

      jahrgangSelect.addEventListener('change', function () {
        currentJahr = jahrgangSelect.value;
        applyFilters();
      });

      teamSelect.addEventListener('change', function () {
        currentTeam = teamSelect.value;
        applyFilters();
      });
    });
});
