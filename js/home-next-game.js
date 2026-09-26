/* Spieltags-Widget im Homepage-Hero: zeigt das aktuelle Profis-Spiel (Heim
   oder Auswärts) sowie die naechsten zwei anstehenden Spiele. Das "aktuelle"
   Spiel bleibt bis einschliesslich Montag nach dem Spieltag sichtbar und
   verschwindet am darauffolgenden Dienstag automatisch (Marko, 26.09.2026).
   Quelle: /data/heimspiele.json (Heimspiele) + /data/spielplan-saison.json
   (profisAuswaerts), wie js/spielplan.js. Ersetzt das fruehere Toggle
   zwischen "Naechstes Heimspiel"- und "Top-News"-Widget -- beide entfernt,
   nur noch dieses eine Widget. */
(function () {
  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  var parseDMY = SiteUtils.parseDMY;

  function cutoffDienstag(datum) {
    var d = new Date(datum);
    var tageBis = (2 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (tageBis === 0 ? 7 : tageBis));
    return d;
  }

  function gameSlideHTML(g, i, label, istAktuell, istNaechstesHeimspiel, heute) {
    var badgeHTML = g.heim ? '<span class="venue-heim">Heimspiel</span>' : '<span class="venue-auswaerts">Auswärts</span>';
    var matchup = g.heim ? ('Basketball Löwen – ' + g.gegner) : (g.gegner + ' – Basketball Löwen');
    var venue = g.heim ? 'Riethsporthalle' : (g.halle || g.ort || '');
    var dateStr = g.date.getDate() + '. ' + MONATE[g.date.getMonth()] + ' ' + g.date.getFullYear();

    var ctaPrimary;
    if (!g.heim && g.livestream) {
      ctaPrimary = '<a class="btn btn-primary btn-sm" style="color:#fff" href="' + g.livestream + '" target="_blank" rel="noopener"><i data-lucide="video" style="width:14px;height:14px"></i> Zum Livestream</a>';
    } else if (istNaechstesHeimspiel) {
      ctaPrimary = '<a class="btn btn-primary btn-sm" style="color:#fff" href="/saison/profis/gameday/"><i data-lucide="ticket" style="width:14px;height:14px"></i> Tickets &amp; Gameday</a>';
    } else {
      ctaPrimary = '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html"><i data-lucide="ticket" style="width:14px;height:14px"></i> Dauerkarte kaufen</a>';
    }

    var ergebnisHTML = '';
    if (istAktuell) {
      var berichtLink = '';
      if (g.spielberichtUrl) {
        var label2 = g.date >= heute ? 'Vorbericht' : 'Nachbericht';
        berichtLink = '<a class="card-link" href="' + g.spielberichtUrl + '">' + label2 + ' <i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>';
      }
      ergebnisHTML = '<div class="fixture-result-row" style="margin-bottom:12px">' +
        '<div class="fixture-result">' + (g.ergebnis || '– – : – –') + '</div>' +
        berichtLink +
      '</div>';
    }

    return '<div class="next-game-slide' + (i === 0 ? ' is-active' : '') + '">' +
      '<span class="eyebrow">' + label + '</span>' +
      '<h3 class="t-h4" style="margin:10px 0 6px">' + matchup + '</h3>' +
      '<p class="t-body-sm" style="margin-bottom:12px;display:flex;flex-direction:column;gap:4px">' +
        badgeHTML +
        '<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="calendar" style="width:14px;height:14px"></i>' + dateStr + ', ' + g.zeit + ' Uhr</span>' +
        (venue ? '<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="map-pin" style="width:14px;height:14px"></i>' + venue + '</span>' : '') +
      '</p>' +
      ergebnisHTML +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + ctaPrimary + '<a class="btn btn-ghost btn-sm" href="/saison/spielplan.html">Zum Spielplan</a></div>' +
    '</div>';
  }

  var card = document.getElementById('next-game-card');
  if (!card) return;

  Promise.all([
    fetch('/data/heimspiele.json?v=1786356737').then(function (r) { return r.json(); }),
    fetch('/data/spielplan-saison.json?v=1790372798').then(function (r) { return r.json(); })
  ]).then(function (results) {
    var heim = results[0], saison = results[1];

    var alle = heim.spiele.map(function (s) {
      var g = Object.assign({}, s); g.heim = true; g.date = parseDMY(s.datum); return g;
    }).concat(saison.profisAuswaerts.map(function (s) {
      var g = Object.assign({}, s); g.heim = false; g.date = parseDMY(s.datum); return g;
    })).sort(function (a, b) { return a.date - b.date; });

    var heute = new Date();
    heute.setHours(0, 0, 0, 0);

    var vergangeneOderHeute = alle.filter(function (g) { return g.date <= heute; });
    var aktuell = null;
    if (vergangeneOderHeute.length) {
      var letztes = vergangeneOderHeute[vergangeneOderHeute.length - 1];
      if (heute < cutoffDienstag(letztes.date)) aktuell = letztes;
    }

    var kommende = alle.filter(function (g) { return g.date > heute; }).slice(0, 2);
    var slides = (aktuell ? [aktuell] : []).concat(kommende);
    if (!slides.length) { card.style.display = 'none'; return; }

    var naechstesHeimspiel = null;
    for (var ni = 0; ni < alle.length; ni++) {
      if (alle[ni].heim && alle[ni].spielberichtUrl && alle[ni].date >= heute) { naechstesHeimspiel = alle[ni]; break; }
    }

    var labels = ['Nächstes Spiel', 'Übernächstes Spiel'];
    var slidesHTML = slides.map(function (g, i) {
      var istAktuell = g === aktuell;
      var label = istAktuell ? 'Aktuelles Spiel' : labels[kommende.indexOf(g)];
      return gameSlideHTML(g, i, label, istAktuell, g === naechstesHeimspiel, heute);
    }).join('');

    var dotsHTML = slides.length > 1
      ? '<div class="news-dots">' + slides.map(function (g, i) {
          return '<button class="news-dot' + (i === 0 ? ' is-active' : '') + '" data-slide-to="' + i + '" aria-label="Spiel ' + (i + 1) + ' von ' + slides.length + ': gegen ' + g.gegner + '"></button>';
        }).join('') + '</div>'
      : '';

    card.innerHTML = '<div class="next-game-slides">' + slidesHTML + '</div>' + dotsHTML;

    if (window.lucide) lucide.createIcons();

    var slideEls = card.querySelectorAll('.next-game-slide');
    var dots = card.querySelectorAll('.news-dot');
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        slideEls.forEach(function (s, si) { s.classList.toggle('is-active', si === i); });
        dots.forEach(function (d, di) { d.classList.toggle('is-active', di === i); });
      });
    });
  });
})();
