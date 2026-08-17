/* Loads header/footer partials into placeholders, then wires up nav + icons.
   Root-relative partial paths assume the site is served from its domain root. */
(function () {
  function include(selector, url) {
    var el = document.querySelector(selector);
    if (!el) return Promise.resolve();
    // Seit 17.08.2026 baut tools/build-partials.py Header und Footer schon beim
    // Build ins HTML ein, damit Crawler ohne JavaScript die Navigation sehen.
    // Ist der Platzhalter also bereits gefüllt, hier nichts nachladen — sonst
    // stünde alles doppelt. Der Abruf bleibt als Rückfall für Seiten, die noch
    // nicht gebaut wurden.
    if (el.children.length > 0) return Promise.resolve();
    return fetch(url, { cache: 'no-cache' })
      .then(function (res) { return res.text(); })
      .then(function (html) { el.innerHTML = html; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
      include('#site-header-placeholder', '/partials/header.html'),
      include('#site-footer-placeholder', '/partials/footer.html')
    ]).then(function () {
      var activeGroup = document.body.getAttribute('data-nav-group');
      if (activeGroup) {
        var btn = document.querySelector('.nav-link[data-page-group="' + activeGroup + '"]');
        if (btn) btn.setAttribute('aria-current', 'page');
      }
      if (window.initNav) window.initNav();
      if (window.lucide) window.lucide.createIcons();
    });
  });
})();
