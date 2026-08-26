/* Nächstes-Heimspiel-Karte im Homepage-Hero: ersetzt den früheren Top-News-Slider.
   Liest /data/heimspiele.json und zeigt standardmäßig nur das nächste anstehende
   Heimspiel. Gibt es weitere, erscheinen Punkte zum manuellen Durchblättern der
   nächsten bis zu drei Heimspiele — es wird NICHT automatisch weitergeschaltet. */
(function () {
  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  function parseDMY(str) {
    var parts = str.split('.').map(Number);
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }

  function gameSlideHTML(g, i) {
    var dateStr = g.date.getDate() + '. ' + MONATE[g.date.getMonth()] + ' ' + g.date.getFullYear();
    return '<div class="next-game-slide' + (i === 0 ? ' is-active' : '') + '">' +
      '<span class="eyebrow">' + (i + 1) + '. Heimspiel</span>' +
      '<h3 class="t-h4" style="margin:10px 0 6px">Basketball Löwen – ' + g.s.gegner + '</h3>' +
      '<p class="t-body-sm" style="margin-bottom:16px;display:flex;flex-direction:column;gap:4px">' +
        '<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="calendar" style="width:14px;height:14px"></i>' + dateStr + ', ' + g.s.zeit + ' Uhr</span>' +
        '<span style="display:inline-flex;align-items:center;gap:6px"><i data-lucide="map-pin" style="width:14px;height:14px"></i>Riethsporthalle</span>' +
      '</p>' +
      /* Vorerst "Dauerkarte kaufen" statt "Tickets kaufen" (Saison noch nicht
         gestartet) — sobald der Spielbetrieb läuft, wieder auf Einzelticket-
         Verlinkung (g.s.ticketUrl || /tickets.html) umstellen. */
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html"><i data-lucide="ticket" style="width:14px;height:14px"></i> Dauerkarte kaufen</a>' +
        '<a class="btn btn-ghost btn-sm" href="/saison/spielplan.html">Zum Spielplan</a>' +
      '</div>' +
    '</div>';
  }

  var card = document.getElementById('next-game-card');
  if (!card) return;

  fetch('/data/heimspiele.json?v=1786356737').then(function (r) { return r.json(); }).then(function (d) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var upcoming = d.spiele
      .map(function (s) { return { s: s, date: parseDMY(s.datum) }; })
      .filter(function (g) { return g.date >= today; })
      .sort(function (a, b) { return a.date - b.date; })
      .slice(0, 3);

    if (!upcoming.length) { card.style.display = 'none'; return; }

    var dotsHTML = upcoming.length > 1
      ? '<div class="news-dots">' + upcoming.map(function (g, i) {
          return '<button class="news-dot' + (i === 0 ? ' is-active' : '') + '" data-slide-to="' + i + '" aria-label="Heimspiel ' + (i + 1) + ' von ' + upcoming.length + ': gegen ' + g.s.gegner + '"></button>';
        }).join('') + '</div>'
      : '';

    card.innerHTML =
      '<div class="next-game-slides">' + upcoming.map(gameSlideHTML).join('') + '</div>' +
      dotsHTML;

    if (window.lucide) lucide.createIcons();

    /* Beide Hero-Widgets sollen gleich hoch sein, damit die Box beim Umschalten
       nicht springt — Referenzhöhe ist die des Heimspiel-Widgets. */
    var wrap = card.closest('[data-hero-widget-wrap]');
    if (wrap) {
      var lockHeight = function () {
        wrap.style.height = 'auto';
        wrap.style.height = wrap.offsetHeight + 'px';
      };
      requestAnimationFrame(lockHeight);
      window.addEventListener('resize', lockHeight);
    }

    var slides = card.querySelectorAll('.next-game-slide');
    var dots = card.querySelectorAll('.news-dot');
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        slides.forEach(function (s, si) { s.classList.toggle('is-active', si === i); });
        dots.forEach(function (d, di) { d.classList.toggle('is-active', di === i); });
      });
    });
  });
})();
