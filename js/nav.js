/* Nav interactions: desktop dropdowns, tablet "Mehr" panel, mobile drawer. */
window.initNav = function initNav() {
  var navItems = document.querySelectorAll('[data-nav-item]');
  var moreBtn = document.getElementById('more-btn');
  var hamburgerBtn = document.getElementById('hamburger-btn');
  var drawer = document.getElementById('nav-drawer');
  var drawerBackdrop = document.getElementById('nav-drawer-backdrop');
  var drawerClose = document.getElementById('drawer-close');

  function closeAllDropdowns() {
    navItems.forEach(function (item) { item.classList.remove('open'); });
  }

  navItems.forEach(function (item) {
    item.addEventListener('click', function (e) {
      if (e.target.closest('.dropdown-panel')) return; /* let sub-links navigate */
      e.stopPropagation();
      var isOpen = item.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) item.classList.add('open');
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-nav-item]')) closeAllDropdowns();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeAllDropdowns(); closeDrawer(); }
  });

  var lastFocusedBeforeDrawer = null;

  function getFocusable(container) {
    return Array.prototype.slice.call(container.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }

  function trapDrawerFocus(e) {
    if (e.key !== 'Tab' || !drawer) return;
    var focusable = getFocusable(drawer);
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function openDrawer(trigger) {
    lastFocusedBeforeDrawer = trigger || document.activeElement;
    drawer.classList.add('open');
    drawer.removeAttribute('inert');
    drawer.setAttribute('aria-hidden', 'false');
    drawerBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', trapDrawerFocus);
    if (drawerClose) drawerClose.focus();
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    drawerBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', trapDrawerFocus);
    if (lastFocusedBeforeDrawer) lastFocusedBeforeDrawer.focus();
  }

  /* Seitensuche: Panel unter dem Header, durchsucht data/search-index.json
     client-seitig (kein Backend auf einer statischen GitHub-Pages-Seite).
     Zwei Auslöser teilen sich [data-search-toggle]: das Icon in der
     Utility-Leiste (Desktop/Tablet) und der Eintrag im Mobile-Drawer
     (Utility-Leiste ist dort per CSS ausgeblendet). */
  var searchToggleBtns = document.querySelectorAll('[data-search-toggle]');
  var searchPanel = document.getElementById('site-search-panel');
  var searchInput = document.getElementById('site-search-input');
  var searchResults = document.getElementById('site-search-results');
  var searchClose = document.getElementById('site-search-close');
  if (searchToggleBtns.length && searchPanel && searchInput && searchResults) {
    var searchIndex = null;
    var searchActiveIndex = -1;

    function loadSearchIndex() {
      if (searchIndex) return Promise.resolve(searchIndex);
      return fetch('/data/search-index.json').then(function (res) { return res.json(); })
        .then(function (data) { searchIndex = data; return data; })
        .catch(function () { searchIndex = []; return []; });
    }

    function renderResults(query) {
      var q = query.trim().toLowerCase();
      if (!q) {
        searchResults.innerHTML = '';
        searchActiveIndex = -1;
        return;
      }
      var matches = (searchIndex || []).filter(function (entry) {
        return entry.title.toLowerCase().indexOf(q) !== -1 ||
          (entry.keywords && entry.keywords.toLowerCase().indexOf(q) !== -1) ||
          (entry.description && entry.description.toLowerCase().indexOf(q) !== -1);
      }).slice(0, 8);
      if (!matches.length) {
        searchResults.innerHTML = '<div class="site-search-empty">Keine Treffer für „' + query + '".</div>';
        searchActiveIndex = -1;
        return;
      }
      searchResults.innerHTML = matches.map(function (entry, i) {
        return '<a class="site-search-result" href="' + entry.url + '" data-index="' + i + '">' +
          '<span class="cat">' + entry.category + '</span><span>' + entry.title + '</span></a>';
      }).join('');
      searchActiveIndex = -1;
    }

    function openSearch() {
      closeDrawer();
      searchPanel.hidden = false;
      searchToggleBtns.forEach(function (btn) { btn.setAttribute('aria-expanded', 'true'); });
      loadSearchIndex().then(function () { renderResults(searchInput.value); });
      searchInput.focus();
    }
    function closeSearch() {
      searchPanel.hidden = true;
      searchToggleBtns.forEach(function (btn) { btn.setAttribute('aria-expanded', 'false'); });
    }

    searchToggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (searchPanel.hidden) openSearch(); else closeSearch();
      });
    });
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    searchInput.addEventListener('input', function () { renderResults(searchInput.value); });
    document.addEventListener('click', function (e) {
      if (!searchPanel.hidden && !e.target.closest('.site-search-panel') && !e.target.closest('[data-search-toggle]')) closeSearch();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !searchPanel.hidden) closeSearch();
    });
    searchInput.addEventListener('keydown', function (e) {
      var items = searchResults.querySelectorAll('.site-search-result');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        items[searchActiveIndex] && items[searchActiveIndex].classList.remove('active');
        searchActiveIndex = e.key === 'ArrowDown'
          ? Math.min(searchActiveIndex + 1, items.length - 1)
          : Math.max(searchActiveIndex - 1, 0);
        items[searchActiveIndex].classList.add('active');
        items[searchActiveIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && searchActiveIndex >= 0 && items.length) {
        /* Pfeiltasten-Auswahl: direkt zu dieser Seite springen. */
        e.preventDefault();
        window.location.href = items[searchActiveIndex].getAttribute('href');
      } else if (e.key === 'Enter' && searchInput.value.trim()) {
        /* Enter ohne Pfeiltasten-Auswahl: vollständige Ergebnisseite statt
           nur der auf 8 Treffer gedeckelten Dropdown-Vorschau. */
        e.preventDefault();
        window.location.href = '/suche.html?q=' + encodeURIComponent(searchInput.value.trim());
      }
    });
  }

  if (moreBtn) moreBtn.addEventListener('click', function (e) { e.stopPropagation(); openDrawer(moreBtn); });
  if (hamburgerBtn) hamburgerBtn.addEventListener('click', function (e) { e.stopPropagation(); openDrawer(hamburgerBtn); });
  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

  document.querySelectorAll('[data-drawer-toggle]').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var li = toggle.closest('.drawer-nav-item');
      var wasOpen = li.classList.contains('open');
      document.querySelectorAll('.drawer-nav-item.open').forEach(function (el) { el.classList.remove('open'); });
      if (!wasOpen) li.classList.add('open');
    });
  });

  /* Großes Logo über Utility- + Hauptnav-Leiste im Ruhezustand; beim Scrollen
     verschwindet die Utility-Leiste und das Logo schrumpft in die Nav-Zeile.
     Ein einzelner Schwellenwert (vorher: scrollY > 16) kippt bei langsamem
     Scrollen (Trackpad, Rückfeder-Effekt am oberen Rand) ständig hin und her,
     sobald die Position genau um die 16px pendelt — das Logo "zittert" dann
     sichtbar zwischen groß und klein. Hysterese (an erst ab 40px, aus erst
     unter 12px) schafft eine Pufferzone, in der die Klasse stabil bleibt. */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      if (window.scrollY > 40) header.classList.add('scrolled');
      else if (window.scrollY < 12) header.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* Hero-Inhalt gleitet beim Runterscrollen nach oben aus und blendet aus,
     das Hero-Bild dahinter bleibt stehen. Übersprungen bei reduced-motion,
     da scroll-gekoppelte Bewegung für vestibulär empfindliche Nutzer:innen
     problematisch sein kann. */
  var hero = document.querySelector('.hero-photo');
  var heroInner = hero ? hero.querySelector('.container') : null;
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* .hero-photo ist sticky, aber ohne eigenen Wrapper wäre <main> (nahezu
     seitenlang) der Containing Block — der Hero bliebe dann für den Rest der
     ganzen Seite angeheftet und nur die z-index-Deckung der Sections darunter
     würde ihn verdecken. Bei Sections, die kürzer als der Viewport sind,
     reißt diese Deckung kurzzeitig ab und das Bild scheint über dem Text zu
     liegen. Der hier eingefügte Wrapper begrenzt den Containing Block auf
     2×Hero-Höhe, sodass der Hero exakt dann natürlich losgelöst wird
     (kein Sticky mehr), wenn der Ausblend-Effekt unten fertig ist. Das ist ein
     Layout-Fix, kein Animationseffekt — gilt daher auch bei reduced-motion. */
  if (hero && hero.parentElement) {
    var heroWrap = document.createElement('div');
    heroWrap.className = 'hero-sticky-wrap';
    hero.parentElement.insertBefore(heroWrap, hero);
    heroWrap.appendChild(hero);
    /* Der Wrapper reserviert 2x Hero-Höhe (siehe oben), das sichtbare Hero-Bild
       füllt aber nur die erste Hälfte davon — die zweite Hälfte ist reiner
       Scroll-Puffer für den Sticky-Effekt und bliebe sonst als sichtbare leere
       Lücke stehen, bevor die nächste Section beginnt (Feedback: "riesiger
       Platz" zwischen Hero und erstem Text). Ein negativer margin-bottom in
       Höhe dieses Puffers zieht die nächste Section direkt an das sichtbare
       Hero-Bild heran; die Section deckt den weiterhin sticky-gepinnten Hero
       dahinter ab (siehe .section/.section-sm-Kommentar in site.css). */
    var setHeroWrapHeight = function () {
      heroWrap.style.height = (hero.offsetHeight * 2) + 'px';
      heroWrap.style.marginBottom = '-' + hero.offsetHeight + 'px';
    };
    setHeroWrapHeight();
    window.addEventListener('resize', setHeroWrapHeight);
  }

  if (hero && heroInner && !prefersReducedMotion) {
    var onHeroScroll = function () {
      var progress = Math.min(window.scrollY / hero.offsetHeight, 1);
      heroInner.style.transform = 'translateY(' + (progress * -50) + 'px)';
      heroInner.style.opacity = String(1 - progress);
    };
    window.addEventListener('scroll', onHeroScroll, { passive: true });
    onHeroScroll();
  }

  /* Nachwuchsstandort-Badge (Footer + ggf. weitere Seiten wie U19-Hero): Klick
     vergrößert das Logo im selben Popup, analog zum Teamfoto-Popup auf den
     Team-Seiten. Jedes Element mit [data-footer-badge-open] öffnet es. */
  var footerBadgeOpeners = document.querySelectorAll('[data-footer-badge-open]');
  var footerBadgeModal = document.getElementById('footer-badge-modal');
  if (footerBadgeOpeners.length && footerBadgeModal) {
    footerBadgeOpeners.forEach(function (opener) {
      opener.addEventListener('click', function () {
        footerBadgeModal.classList.add('open');
      });
    });
    footerBadgeModal.addEventListener('click', function (e) {
      if (e.target === footerBadgeModal || e.target.closest('[data-footer-badge-close]')) {
        footerBadgeModal.classList.remove('open');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') footerBadgeModal.classList.remove('open');
    });
  }

  /* Feedback-Widget (nur Launch-Phase — siehe Kommentar in footer.html):
     Klick öffnet das Panel, Absenden schickt an den n8n-Webhook, der das
     Feedback als Seite in der Notion-Datenbank "Website-Feedback" anlegt. */
  var feedbackWidget = document.getElementById('feedback-widget');
  var feedbackToggle = document.getElementById('feedback-widget-toggle');
  var feedbackClose = document.getElementById('feedback-widget-close');
  var feedbackForm = document.getElementById('feedback-widget-form');
  var feedbackContext = document.getElementById('feedback-widget-context');
  if (feedbackWidget && feedbackToggle && feedbackForm) {
    if (feedbackContext) {
      /* Seitenname aus dem Tab-Titel ableiten (Muster site-weit: "<Seite> — Basketball Löwen Erfurt"),
         vorausgewählt, mit "Allgemeines Feedback" als Alternative für seitenübergreifende Anmerkungen. */
      var isHome = window.location.pathname === '/' || window.location.pathname === '/index.html';
      var pageLabel = isHome ? 'Startseite' : (document.title.split(' — ')[0].trim() || 'Diese Seite');
      feedbackContext.innerHTML =
        '<option value="' + pageLabel + '">' + pageLabel + '</option>' +
        '<option value="Allgemeines Feedback">Allgemeines Feedback</option>';
    }
    feedbackToggle.addEventListener('click', function () {
      feedbackWidget.classList.add('open');
    });
    if (feedbackClose) {
      feedbackClose.addEventListener('click', function () {
        feedbackWidget.classList.remove('open');
      });
    }
    feedbackForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var message = feedbackForm.querySelector('[name="message"]').value.trim();
      if (!message) return;
      var contact = feedbackForm.querySelector('[name="contact"]').value.trim();
      var context = feedbackContext ? feedbackContext.value : '';
      var submitBtn = feedbackForm.querySelector('.feedback-widget-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Wird gesendet …';
      fetch('https://blev.app.n8n.cloud/webhook/website-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, contact: contact, context: context, page: window.location.href })
      }).then(function (res) {
        if (!res.ok) throw new Error('Feedback-Webhook antwortete mit Fehler');
        feedbackForm.hidden = true;
        feedbackWidget.querySelector('.feedback-widget-success').hidden = false;
        setTimeout(function () { feedbackWidget.classList.remove('open'); }, 2500);
      }).catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Absenden';
        alert('Senden hat leider nicht geklappt — bitte später noch einmal versuchen.');
      });
    });
  }
};
