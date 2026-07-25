/* Eigene Suchergebnisseite (/suche.html?q=...) — ergänzt das Dropdown im
   Header (js/nav.js) um eine klassische Ergebnisliste ohne 8er-Deckel.
   Die Filterlogik ist bewusst dieselbe wie in nav.js; bei Änderungen an
   einer Stelle bitte auch die andere anpassen. */
(function () {
  var input = document.getElementById('search-page-input');
  var results = document.getElementById('search-page-results');
  if (!input || !results) return;

  var searchIndex = null;

  function loadSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    return fetch('/data/search-index.json').then(function (res) { return res.json(); })
      .then(function (data) { searchIndex = data; return data; })
      .catch(function () { searchIndex = []; return []; });
  }

  function render(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '';
      return;
    }
    var matches = (searchIndex || []).filter(function (entry) {
      return entry.title.toLowerCase().indexOf(q) !== -1 ||
        (entry.keywords && entry.keywords.toLowerCase().indexOf(q) !== -1) ||
        (entry.description && entry.description.toLowerCase().indexOf(q) !== -1);
    });
    if (!matches.length) {
      results.innerHTML = '<p class="t-body">Keine Treffer für „' + query + '".</p>';
      return;
    }
    results.innerHTML = '<p class="t-body-sm mb-4">' + matches.length + ' Treffer</p>' +
      matches.map(function (entry) {
        return '<a class="search-result-row" href="' + entry.url + '">' +
          '<span class="card-label">' + entry.category + '</span>' +
          '<h3>' + entry.title + '</h3>' +
          (entry.description ? '<p>' + entry.description + '</p>' : '') +
          '</a>';
      }).join('');
  }

  function syncUrl(query) {
    var url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
  }

  var initialQuery = new URLSearchParams(window.location.search).get('q') || '';
  input.value = initialQuery;
  loadSearchIndex().then(function () { render(initialQuery); });
  if (initialQuery) input.focus();

  input.addEventListener('input', function () {
    render(input.value);
    syncUrl(input.value.trim());
  });
})();
