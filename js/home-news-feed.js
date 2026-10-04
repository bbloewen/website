// Baut das News-Bento auf der Startseite: im Kern die eigenen News-Artikel
// (data/news.json, die neuesten, nach Veroeffentlichungsdatum), dazu hoechstens
// zwei Instagram-Kacheln, die eine Regel erfuellen muessen:
//   - Hauptaccount (Loewen): nur ein Post vom heutigen Tag (Berliner Zeit),
//   - LOEWENPARK: nur ein Post, der hoechstens PARK_NEU_TAGE Tage alt ist.
// Sonst steht dort nichts von Instagram. Die komplette Uebersicht mit allen
// Instagram-Beitraegen und dem YouTube-Kanal bleibt news/aktuelles.html.
// Die Instagram-Kacheln stehen direkt hinter dem neuesten Artikel (der die
// grosse Kachel bekommt, weil sein Bild im Querformat angelegt ist); die
// uebrigen Plaetze fuellen die naechsten Artikel. Fehlt eine Feed-Datei (404),
// wird sie still uebersprungen.
// Marko, 04.10.2026: Instagram und eigene News haben sich auf der Startseite
// gedoppelt, seit es genug eigene News gibt.
document.addEventListener('DOMContentLoaded', function () {
  var desktopTrack = document.getElementById('news-slider-track-desktop');
  var mobileTrack = document.getElementById('news-slider-track-mobile');
  var dotsWrap = document.getElementById('news-slider-dots');
  if (!desktopTrack || !mobileTrack) return;

  // Kacheln insgesamt: Desktop als 2 Bento-Seiten a 5, Mobile als Wischleiste.
  // tools/build-home-news.py spiegelt diesen Wert (NEWS_MAX) fuer die statische Fassung.
  var NEWS_MAX = 10;
  var PARK_NEU_TAGE = 7;

  var INSTAGRAM_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px"><path d="M12 2.16c3.2 0 3.58.02 4.85.07 1.17.06 1.8.25 2.23.42.56.21.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.06 1.17-.25 1.8-.42 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.06-1.8-.25-2.23-.42-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.06-1.17.25-1.8.42-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.13 1.38C1.35 2.68.94 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13.67.66 1.34 1.07 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.38.66-.67 1.07-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.89 5.89 0 0 0-1.38-2.13A5.87 5.87 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"/></svg>';

  // Sortiert wird nach dem Veröffentlichungsdatum (Dateiname), angezeigt wird
  // das Feld "datum" — die beiden dürfen auseinanderlaufen.
  var publishDate = SiteUtils.publishDate;

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function firstLine(text, maxLen) {
    var line = (text || '').split('\n')[0].trim();
    if (line.length > maxLen) line = line.slice(0, maxLen - 1).trim() + '…';
    return line;
  }

  Promise.all([
    fetchJson('/data/news.json'),
    fetchJson('/data/instagram-loewenpark.json'),
    fetchJson('/data/instagram-loewen.json')
  ]).then(function (results) {
    var newsData = results[0], parkFeed = results[1], hauptFeed = results[2];

    var jetzt = new Date();
    var newsItems = (newsData && newsData.artikel || []).map(function (a) {
      return {
        date: publishDate(a),
        dateLabel: a.datum,
        image: a.bild,
        headline: a.titel,
        teaser: a.kurztext,
        url: a.url,
        external: false,
        badge: null
      };
    }).filter(function (n) { return n.date <= jetzt; });

    function instaItems(feed, badge) {
      return (feed && feed.posts || []).map(function (p) {
        return {
          date: new Date(p.timestamp),
          dateLabel: null,
          // Diese Posts stehen alle noch im laufenden Feed -- Beholds Live-URL
          // (p.image) ist also gueltig. Die gesicherte Kopie unter
          // assets/img/insta/ existiert erst nach dem Archivieren (sobald der
          // Post aus dem Feed faellt); vorher lief der Pfad hierher ins Leere
          // und zeigte fuer fast jeden Post denselben Platzhalter (Feedback
          // Marko 25.08.2026). Rueckfall auf die Kopie nur, falls p.image
          // ausnahmsweise fehlt.
          image: p.image
            || (p.persistedUrl ? p.persistedUrl.replace('/news/insta-archiv/', '/assets/img/insta/').replace('.html', '.jpg') : ''),
          // titel kommt fertig gekürzt aus dem Workflow (Vorspann abgeschnitten,
          // Unicode-Fettschrift aufgelöst, Handpflege berücksichtigt). Der
          // Rückfall auf die Caption greift nur, solange ein Feed noch ohne
          // titel-Feld ausgeliefert wird.
          headline: p.titel || firstLine(p.caption, 70),
          teaser: firstLine(p.beschreibung || p.caption.split('\n').slice(1).join(' ').trim(), 110) || 'Jetzt ansehen.',
          // Ohne Archivseite direkt zu Instagram, nicht auf die entfernte
          // dynamische Detailseite.
          url: p.persistedUrl || p.permalink,
          external: true,
          badge: badge
        };
      });
    }

    function byDateDesc(a, b) { return b.date - a.date; }
    function takeMax(list, max) { return list.slice().sort(byDateDesc).slice(0, max); }

    function berlinTag(d) { return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); }

    // Instagram nur, wenn die Regel greift (siehe Kopfkommentar).
    var extras = takeMax(instaItems(hauptFeed, 'Löwen'), 1)
      .filter(function (i) { return berlinTag(i.date) === berlinTag(jetzt); })
      .concat(takeMax(instaItems(parkFeed, 'LÖWENPARK'), 1)
        .filter(function (i) { return jetzt - i.date <= PARK_NEU_TAGE * 86400000; }));

    var news = takeMax(newsItems, NEWS_MAX - extras.length);
    var items = news.slice(0, 1).concat(extras, news.slice(1));
    if (!items.length) return;

    function tileHtml(item, roleClass) {
      var linkLabel = item.external
        ? INSTAGRAM_ICON + ' ' + item.badge + ' · Weiterlesen'
        : (item.dateLabel ? item.dateLabel + ' · ' : '') + 'Weiterlesen';
      var extraClass = (roleClass ? ' ' + roleClass : '') + (item.external ? ' news-tile-insta' : '');
      // onerror-Rückfall: fehlt die gesicherte Bildkopie (z. B. weil ein Post
      // gerade ausgeschlossen wurde und die Feed-Datei noch nicht neu
      // ausgeliefert ist), zeigt der Browser sonst ein kaputtes Bildsymbol.
      return '<a class="news-tile' + extraClass + '" href="' + item.url + '">' +
        /* loading/decoding wie in tools/build-home-news.py: die Kacheln stehen
           unterhalb des Sichtbereichs und sollen dem Hero nicht die Leitung
           wegnehmen (Marko, 04.10.2026). */
        '<img src="' + item.image + '" loading="lazy" decoding="async" alt="" onerror="this.onerror=null;this.src=\'/assets/img/share/og-default.jpg\'" />' +
        '<div class="news-tile-overlay">' +
          '<h3 class="news-tile-headline">' + item.headline + '</h3>' +
          '<p class="news-tile-teaser">' + item.teaser + '</p>' +
          '<span class="news-tile-link">' + linkLabel + ' <i data-lucide="arrow-right" style="width:14px;height:14px"></i></span>' +
        '</div>' +
      '</a>';
    }

    var desktopRoles = ['news-tile-featured', 'news-tile-side', 'news-tile-small', 'news-tile-small', 'news-tile-small'];
    var pages = [];
    for (var i = 0; i < items.length; i += 5) { pages.push(items.slice(i, i + 5)); }

    desktopTrack.innerHTML = pages.map(function (page) {
      return '<div class="news-bento">' + page.map(function (item, idx) { return tileHtml(item, desktopRoles[idx]); }).join('') + '</div>';
    }).join('');

    mobileTrack.innerHTML = items.map(function (item) { return tileHtml(item, null); }).join('');

    if (dotsWrap && pages.length > 1) {
      dotsWrap.innerHTML = pages.map(function (_, i) {
        return '<button type="button"' + (i === 0 ? ' class="active"' : '') + ' data-news-dot="' + i + '" aria-label="News Seite ' + (i + 1) + '"></button>';
      }).join('');
    }

    if (window.lucide) { lucide.createIcons(); }
    initSlider();
    initMobileProgress();
  });

  function initMobileProgress() {
    var thumb = document.getElementById('news-mobile-progress-thumb');
    if (!thumb) return;
    var track = mobileTrack;

    function update() {
      var scrollable = track.scrollWidth - track.clientWidth;
      var widthPct = Math.max(12, (track.clientWidth / track.scrollWidth) * 100);
      var progress = scrollable > 0 ? track.scrollLeft / scrollable : 0;
      var maxTranslatePct = 100 - widthPct;
      thumb.style.width = widthPct + '%';
      thumb.style.transform = 'translateX(' + (progress * maxTranslatePct / widthPct * 100) + '%)';
    }

    var resizeTimer;
    track.addEventListener('scroll', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(update, 30);
    });
    window.addEventListener('resize', update);
    update();
  }

  function initSlider() {
    var track = desktopTrack;
    var prevBtn = document.querySelector('[data-news-prev]');
    var nextBtn = document.querySelector('[data-news-next]');
    var dots = document.querySelectorAll('[data-news-dot]');
    var pageCount = track.children.length;
    if (!pageCount) return;

    function currentPage() {
      return Math.round(track.scrollLeft / track.clientWidth);
    }

    function update() {
      var page = currentPage();
      dots.forEach(function (d, i) { d.classList.toggle('active', i === page); });
      prevBtn.disabled = page <= 0;
      nextBtn.disabled = page >= pageCount - 1;
    }

    function goTo(page) {
      track.children[page].scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' });
    }

    prevBtn.addEventListener('click', function () { goTo(Math.max(0, currentPage() - 1)); });
    nextBtn.addEventListener('click', function () { goTo(Math.min(pageCount - 1, currentPage() + 1)); });
    dots.forEach(function (d, i) { d.addEventListener('click', function () { goTo(i); }); });

    var resizeTimer;
    track.addEventListener('scroll', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(update, 60);
    });
    window.addEventListener('resize', update);
    update();
  }
});
