document.addEventListener('DOMContentLoaded', function () {
  var grid = document.getElementById('trainingszeiten-grid');
  if (!grid) return;

  var TEAM_LABELS = {
    'U8mix': 'U8 mixed',
    'U9mix': 'U9 mixed',
    'U10mix': 'U10 mixed',
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

  var ORT_DISPLAY = {
    'Muldenweg (Feld 1)': 'Sporthalle am Muldenweg',
    'Südparkhalle (Feld 1)': 'Südparkhalle',
    'Südparkhalle (Feld 2)': 'Südparkhalle',
    'Südparkhalle (Feld 3)': 'Südparkhalle',
    'Südparkhalle (Feld 2+3)': 'Südparkhalle',
    'Eugen-Richter-Halle (Feld 2)': 'Eugen-Richter-Halle',
    'Christophorushalle': 'Christophorushalle',
    'Bukarester Straße': 'Bukarester Straße'
  };

  var WOCHENTAG_INDEX = { 'So': 0, 'Mo': 1, 'Di': 2, 'Mi': 3, 'Do': 4, 'Fr': 5, 'Sa': 6 };

  function jahrgangLabel(jahre) {
    if (jahre.length === 1) return String(jahre[0]);
    return Math.max.apply(null, jahre) + ' und jünger';
  }

  function ortDisplay(ort) {
    return ORT_DISPLAY[ort] || ort;
  }

  function mapsLink(ort) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ortDisplay(ort) + ' Erfurt');
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
      location: ortDisplay(ort) + ', Erfurt',
      recur: 'RRULE:FREQ=WEEKLY',
      ctz: 'Europe/Berlin'
    };
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams(params).toString();
  }

  function cardHTML(g) {
    var teamName = TEAM_LABELS[g.team] || g.team;
    var titel = teamName + ' (' + jahrgangLabel(g.jahre) + ')';
    var zeitenHTML;
    if (g.termine && g.termine.length) {
      zeitenHTML = g.termine.map(function (t) {
        var cal = calendarLink(t.tag, t.zeit, titel, t.ort);
        var zeitText = t.tag + ' ' + t.zeit;
        if (t.vorbehaltlich) zeitText += ' (' + t.vorbehaltlich + ')';
        var zeitHTML = '<div class="training-slot-zeit">' +
          '<i data-lucide="clock" class="icon-14"></i><span>' + zeitText + '</span>' +
          (cal ? ' <a href="' + cal + '" target="_blank" rel="noopener" title="Zum Kalender hinzufügen"><i data-lucide="calendar-plus" class="icon-14"></i></a>' : '') +
        '</div>';
        var ortHTML = '<div class="training-slot-ort"><i data-lucide="map-pin" class="icon-14"></i><a href="' + mapsLink(t.ort) + '" target="_blank" rel="noopener">' + ortDisplay(t.ort) + '</a></div>';
        return '<div class="training-slot">' + zeitHTML + ortHTML + '</div>';
      }).join('');
    } else {
      zeitenHTML = '<div class="training-slot"><em>' + (g.hinweis || 'Zeiten folgen in Kürze') + '</em></div>';
    }
    return (
      '<div class="card training-row" data-verein="' + g.verein + '" data-jahre="' + g.jahre.join(',') + '">' +
        '<div>' +
          '<div class="training-row-team">' + teamName + ' <span class="training-row-jahrgang">(' + jahrgangLabel(g.jahre) + ')</span></div>' +
          '<div class="training-row-verein"><span class="team-badge ' + vereinBadgeClass[g.verein] + '">' + vereinLabel[g.verein] + '</span></div>' +
        '</div>' +
        '<div class="training-row-zeiten">' + zeitenHTML + '</div>' +
        '<div class="training-row-trainer"><div class="training-row-trainer-label">Trainerinnen:</div><div>' + (g.trainer || '') + '</div></div>' +
      '</div>'
    );
  }

  fetch('/data/trainingszeiten.json?v=1787250578')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var gruppen = data.gruppen.slice().reverse();
      grid.innerHTML = gruppen.map(cardHTML).join('');
      if (window.lucide) window.lucide.createIcons();

      var alleJahre = Array.from(new Set(data.gruppen.reduce(function (acc, g) { return acc.concat(g.jahre); }, [])));
      alleJahre.sort(function (a, b) { return a - b; });
      var jahrgangSelect = document.getElementById('jahrgang-filter');
      alleJahre.forEach(function (jahr) {
        var opt = document.createElement('option');
        opt.value = jahr;
        opt.textContent = jahr;
        jahrgangSelect.appendChild(opt);
      });

      var chips = document.querySelectorAll('.filter-chip');
      var cards = grid.querySelectorAll('.training-row');
      var currentVerein = 'alle';
      var currentJahr = 'alle';

      function applyFilters() {
        cards.forEach(function (card) {
          var vereinOk = currentVerein === 'alle' || card.getAttribute('data-verein') === currentVerein;
          var jahre = card.getAttribute('data-jahre').split(',');
          var jahrOk = currentJahr === 'alle' || jahre.indexOf(currentJahr) !== -1;
          card.hidden = !(vereinOk && jahrOk);
        });
      }

      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          chips.forEach(function (c) { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
          chip.classList.add('is-active');
          chip.setAttribute('aria-pressed', 'true');
          currentVerein = chip.getAttribute('data-filter');
          applyFilters();
        });
      });

      jahrgangSelect.addEventListener('change', function () {
        currentJahr = jahrgangSelect.value;
        applyFilters();
      });
    });
});
