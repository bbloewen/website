/* Kompakter "Aktuelles zu ..."-Feed auf Teamseiten (z.B. saison/profis.html) und
   in der BasKIDball-Sidebar. Zeigt die neuesten News-Artikel mit passendem
   "team"-Feld (aus data/news.json). Gibt es weniger als angefragt, wird mit den
   neuesten allgemeinen Artikeln (ohne "team") aufgefüllt, damit der Bereich nie
   halbleer wirkt. Insta-Feeds bleiben bewusst außen vor — die lassen sich keinem
   Team/Programm zuordnen.

   Zwei Darstellungen, gleiche Datengrundlage:
   - [data-team-news="..."]: 3 große Karten nebeneinander (Teamseiten).
   - [data-team-news-compact="..."]: schmale, gestapelte Liste für Sidebars
     (z.B. BasKIDball) — bei leerem Ergebnis wird nur der Sidebar-Block selbst
     ausgeblendet, nicht die ganze Sektion, da daneben die Hauptspalte steht. */
document.addEventListener('DOMContentLoaded', function () {
  var parseDMY = SiteUtils.parseDMY;
  function byDateDesc(a, b) { return parseDMY(b.datum) - parseDMY(a.datum); }

  function loadNews(callback) {
    fetch('/data/news.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { callback(data && data.artikel || []); });
  }

  function pickForTeam(artikel, team, limit) {
    var teamArtikel = artikel.filter(function (a) { return a.team === team; }).sort(byDateDesc);
    var allgemein = artikel.filter(function (a) { return !a.team; }).sort(byDateDesc);
    return teamArtikel.concat(allgemein).slice(0, limit);
  }

  var grid = document.querySelector('[data-team-news]');
  if (grid) {
    var team = grid.getAttribute('data-team-news');
    loadNews(function (artikel) {
      var shown = pickForTeam(artikel, team, 3);
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
  }

  var compact = document.querySelector('[data-team-news-compact]');
  if (compact) {
    var compactTeam = compact.getAttribute('data-team-news-compact');
    loadNews(function (artikel) {
      var shown = pickForTeam(artikel, compactTeam, 3);
      if (!shown.length) { compact.closest('.info-tile').style.display = 'none'; return; }
      compact.innerHTML = shown.map(function (a) {
        return '<a class="insta-sidebar-item" href="' + a.url + '">' +
          (a.bild ? '<img src="' + a.bild + '" alt="" loading="lazy" />' : '') +
          '<span><strong style="display:block;font-weight:var(--weight-bold);color:var(--text-primary);margin-bottom:2px">' + a.titel + '</strong>' + a.datum + '</span>' +
        '</a>';
      }).join('');
    });
  }
});
