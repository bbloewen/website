/* Kompakter "Aktuelles zu ..."-Feed auf Teamseiten (z.B. saison/profis.html).
   Zeigt die 3 neuesten News-Artikel mit passendem data-team-news="..."-Attribut
   (aus data/news.json, Feld "team"). Gibt es weniger als 3, werden mit den
   neuesten allgemeinen Artikeln (ohne "team") aufgefüllt, damit der Bereich
   nie halbleer wirkt. Insta-Feeds bleiben bewusst außen vor — die lassen sich
   keinem Team zuordnen. */
document.addEventListener('DOMContentLoaded', function () {
  var grid = document.querySelector('[data-team-news]');
  if (!grid) return;
  var team = grid.getAttribute('data-team-news');

  var parseDMY = SiteUtils.parseDMY;
  function byDateDesc(a, b) { return parseDMY(b.datum) - parseDMY(a.datum); }

  fetch('/data/news.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var artikel = (data && data.artikel || []);
      var teamArtikel = artikel.filter(function (a) { return a.team === team; }).sort(byDateDesc);
      var allgemein = artikel.filter(function (a) { return !a.team; }).sort(byDateDesc);
      var shown = teamArtikel.concat(allgemein).slice(0, 3);
      if (!shown.length) { grid.closest('section').style.display = 'none'; return; }

      grid.innerHTML = shown.map(function (a) {
        return '<div class="card hoverable">' +
          '<div class="card-body">' +
            '<span class="card-label">' + a.datum + '</span>' +
            '<h3 style="font-size:17px">' + a.titel + '</h3>' +
            '<p>' + a.kurztext + '</p>' +
            '<a class="card-link" href="' + a.url + '">weiterlesen <i data-lucide="arrow-right" style="width:14px;height:14px"></i></a>' +
          '</div>' +
        '</div>';
      }).join('');
      if (window.lucide) lucide.createIcons();
    });
});
