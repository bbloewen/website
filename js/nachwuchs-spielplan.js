document.addEventListener('DOMContentLoaded', function () {
  var sliders = document.querySelectorAll('.game-slider[data-spielplan-team]');
  if (!sliders.length) return;

  var MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  function datumKurz(iso) {
    var teile = iso.split('-');
    var tag = teile[2];
    var monat = MONATE_KURZ[parseInt(teile[1], 10) - 1];
    return tag + '. ' + monat;
  }

  function chipHTML(spiel, istNaechstes) {
    var heimAuswaerts = spiel.heim ? 'Heim' : 'Auswärts';
    var unten;
    if (spiel.abgesagt) {
      unten = '<div class="game-chip-ergebnis" style="font-size:11px">abgesagt</div>';
    } else if (spiel.ergebnis) {
      unten = '<div class="game-chip-ergebnis">' + spiel.ergebnis + '</div>';
    } else {
      unten = '<div class="game-chip-datum">' + (spiel.zeit || '') + ' Uhr</div>';
    }
    return (
      '<div class="game-chip' + (istNaechstes ? ' is-next' : '') + '">' +
        '<div class="game-chip-heim">' + heimAuswaerts + '</div>' +
        '<div class="game-chip-gegner" title="' + spiel.gegner + '">' + spiel.gegner + '</div>' +
        '<div class="game-chip-datum">' + datumKurz(spiel.datum) + '</div>' +
        unten +
      '</div>'
    );
  }

  function naechsterIndex(spiele) {
    for (var i = 0; i < spiele.length; i++) {
      if (!spiele[i].abgesagt && !spiele[i].ergebnis) return i;
    }
    return spiele.length - 1;
  }

  fetch('/data/nachwuchs-spielplan.json')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      sliders.forEach(function (slider) {
        var teamKey = slider.getAttribute('data-spielplan-team');
        var team = data.teams && data.teams[teamKey];
        var spiele = team && team.spiele;
        if (!spiele || !spiele.length) return;

        var track = slider.querySelector('.game-slider-track');
        var naechste = naechsterIndex(spiele);
        track.innerHTML = spiele.map(function (s, i) { return chipHTML(s, i === naechste); }).join('');
        slider.hidden = false;

        var chips = track.children;
        if (chips[naechste]) track.scrollLeft = chips[naechste].offsetLeft;

        var chipSchritt = 90;
        slider.querySelectorAll('.game-slider-arrow').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var dir = parseInt(btn.getAttribute('data-dir'), 10);
            track.scrollBy({ left: dir * chipSchritt * 2, behavior: 'smooth' });
          });
        });
      });
    });
});
