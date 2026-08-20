document.addEventListener('DOMContentLoaded', function () {
  var grid = document.getElementById('trainingszeiten-grid');
  if (!grid) return;

  var vereinLabel = {
    'bc-erfurt': 'BC Erfurt',
    'usv-erfurt': 'USV Erfurt',
    'loewinnen': 'Löwinnen (SG)'
  };

  function cardHTML(g) {
    var termine;
    if (g.termine && g.termine.length) {
      termine = g.termine.map(function (t) {
        var line = t.tag + ' ' + t.zeit + ' · ' + t.ort;
        if (t.vorbehaltlich) line += ' (' + t.vorbehaltlich + ')';
        return line;
      }).join('<br>');
    } else {
      termine = '<em>' + (g.hinweis || 'Zeiten folgen in Kürze') + '</em>';
    }
    var trainerLine = g.trainer ? '<p class="t-body-sm" style="margin-top:8px;color:var(--text-secondary)">Trainer/-in: ' + g.trainer + '</p>' : '';
    return (
      '<div class="card" data-verein="' + g.verein + '">' +
        '<div class="card-body">' +
          '<span class="card-label">' + g.team + ' · ' + g.jahrgang + '</span>' +
          '<h3 style="font-size:17px">' + vereinLabel[g.verein] + '</h3>' +
          '<p>' + termine + '</p>' +
          trainerLine +
        '</div>' +
      '</div>'
    );
  }

  fetch('/data/trainingszeiten.json?v=1787240672')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      grid.innerHTML = data.gruppen.map(cardHTML).join('');

      var chips = document.querySelectorAll('.filter-chip');
      var cards = grid.querySelectorAll('.card');
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          chips.forEach(function (c) { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
          chip.classList.add('is-active');
          chip.setAttribute('aria-pressed', 'true');
          var filter = chip.getAttribute('data-filter');
          cards.forEach(function (card) {
            card.hidden = filter !== 'alle' && card.getAttribute('data-verein') !== filter;
          });
        });
      });
    });
});
