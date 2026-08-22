document.addEventListener('DOMContentLoaded', function () {
  var grid = document.getElementById('trainingszeiten-grid');
  if (!grid) return;

  var TEAM_LABELS = {
    'U8mix': 'U8 Mix',
    'U9mix': 'U9 Mix',
    'U10mix': 'U10 Mix',
    'U10w und jünger': 'U10 weiblich',
    'U11mix': 'U11 Mix',
    'U12mix': 'U12 Mix',
    'U12m/1': 'U12 männlich',
    'U12w': 'U12 weiblich',
    'U13mix': 'U13 Mix',
    'U13m': 'U13 männlich',
    'U14mix': 'U14 Mix',
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

  function jahrgangLabel(jahre) {
    if (jahre.length === 1) return String(jahre[0]);
    return Math.max.apply(null, jahre) + ' und jünger';
  }

  function mapsLink(ort) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ort);
  }

  function cardHTML(g) {
    var zeitenHTML;
    if (g.termine && g.termine.length) {
      zeitenHTML = g.termine.map(function (t) {
        var line = t.tag + ' ' + t.zeit + ' · <a href="' + mapsLink(t.ort) + '" target="_blank" rel="noopener">' + t.ort + '</a>';
        if (t.vorbehaltlich) line += ' (' + t.vorbehaltlich + ')';
        return line;
      }).join('<br>');
    } else {
      zeitenHTML = '<em>' + (g.hinweis || 'Zeiten folgen in Kürze') + '</em>';
    }
    return (
      '<div class="card training-row" data-verein="' + g.verein + '" data-jahre="' + g.jahre.join(',') + '">' +
        '<div>' +
          '<div class="training-row-jahrgang">' + jahrgangLabel(g.jahre) + '</div>' +
          '<div class="training-row-team">' + vereinLabel[g.verein] + ' · ' + (TEAM_LABELS[g.team] || g.team) + '</div>' +
        '</div>' +
        '<div class="training-row-zeiten">' + zeitenHTML + '</div>' +
        '<div class="training-row-trainer">Trainer/-in: ' + (g.trainer || '') + '</div>' +
      '</div>'
    );
  }

  fetch('/data/trainingszeiten.json?v=1787250578')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      grid.innerHTML = data.gruppen.map(cardHTML).join('');

      var alleJahre = Array.from(new Set(data.gruppen.reduce(function (acc, g) { return acc.concat(g.jahre); }, [])));
      alleJahre.sort(function (a, b) { return b - a; });
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
