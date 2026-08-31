/* Vorheriger/Nächster-Artikel-Pfeile für News-Artikelseiten. Sortiert data/news.json
   nach Datum absteigend (gleiche Reihenfolge wie news/aktuelles.html), findet den
   aktuellen Artikel anhand der URL und rendert je einen Kreis-Pfeil in die Elemente
   mit id="article-nav-prev" und id="article-nav-next" (unten neben dem Newsletter-
   Button). Zirkulär (Modulo statt null) — am neuesten Artikel springt der rechte
   Pfeil zum ältesten und umgekehrt, damit man endlos durchklicken kann. */
(function () {
  var parseGermanDate = SiteUtils.parseGermanDate;

  document.addEventListener('DOMContentLoaded', function () {
    var prevEl = document.getElementById('article-nav-prev');
    var nextEl = document.getElementById('article-nav-next');
    if (!prevEl && !nextEl) return;

    fetch('/data/news.json').then(function (r) { return r.json(); }).then(function (data) {
      var items = (data.artikel || []).slice().sort(function (a, b) {
        return parseGermanDate(b.datum) - parseGermanDate(a.datum);
      });
      var path = window.location.pathname;
      var idx = items.findIndex(function (a) { return a.url === path; });
      if (idx === -1) return;

      var newer = items.length > 1 ? items[(idx - 1 + items.length) % items.length] : null;
      var older = items.length > 1 ? items[(idx + 1) % items.length] : null;

      if (prevEl && older) {
        prevEl.innerHTML = '<a class="article-nav-arrow" href="' + older.url + '" aria-label="Vorheriger Artikel: ' + older.titel + '"><i data-lucide="chevron-left" style="width:18px;height:18px"></i></a>';
      }
      if (nextEl && newer) {
        nextEl.innerHTML = '<a class="article-nav-arrow" href="' + newer.url + '" aria-label="Nächster Artikel: ' + newer.titel + '"><i data-lucide="chevron-right" style="width:18px;height:18px"></i></a>';
      }
      if (window.lucide) window.lucide.createIcons();
    });
  });
})();
