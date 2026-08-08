// Generische Detailseite für einen einzelnen Instagram-Post (news/insta-post.html?feed=...&id=...).
// Lädt den passenden Feed (data/instagram-<feed>.json), sucht den Post per id und zeigt
// Bild, Text und einen Link zum Original-Post. Läuft der Post aus dem Feed (Behold hält nur
// die letzten ~6 Beiträge vor), gibt es einen Hinweis samt Link zum Profil als Fallback.
document.addEventListener('DOMContentLoaded', function () {
  var FEEDS = {
    loewenpark: { url: '/data/instagram-loewenpark.json', badge: 'LÖWENPARK', profile: 'https://www.instagram.com/loewenpark.hallenmeister/' },
    loewen: { url: '/data/instagram-loewen.json', badge: 'Löwen', profile: 'https://www.instagram.com/basketball.loewen/' }
  };

  var params = new URLSearchParams(window.location.search);
  var feedKey = params.get('feed');
  var postId = params.get('id');
  var feedConfig = FEEDS[feedKey];

  var heroEl = document.getElementById('insta-hero');
  var eyebrowEl = document.getElementById('insta-eyebrow');
  var titleEl = document.getElementById('insta-title');
  var contentEl = document.getElementById('insta-content');

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function firstLine(text, maxLen) {
    var line = (text || '').split('\n')[0].trim();
    if (line.length > maxLen) line = line.slice(0, maxLen - 1).trim() + '…';
    return line || 'Instagram-Beitrag';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }

  var INSTAGRAM_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px"><path d="M12 2.16c3.2 0 3.58.02 4.85.07 1.17.06 1.8.25 2.23.42.56.21.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.06 1.17-.25 1.8-.42 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.06-1.8-.25-2.23-.42-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.06-1.17.25-1.8.42-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.13 1.38C1.35 2.68.94 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13.67.66 1.34 1.07 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.38.66-.67 1.07-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.89 5.89 0 0 0-1.38-2.13A5.87 5.87 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"/></svg>';

  var NEWSLETTER_BTN = '<a class="btn btn-outline-orange btn-sm" href="/news/newsletter/">Newsletter abonnieren</a>';

  /* Rücklink links, Newsletter-Link rechts. Bei einem geladenen Post sitzt der
     Newsletter-Link stattdessen oben neben "Original ansehen" (siehe topRowHtml
     unten) — der Footer zeigt dann nur noch den Rücklink. */
  function articleFooterHtml(includeNewsletter) {
    return '<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
      '<a class="article-back-link" href="/news/aktuelles.html">← Alle News</a>' +
      (includeNewsletter ? NEWSLETTER_BTN : '') +
      '</div>';
  }

  function showNotFound() {
    titleEl.textContent = 'Beitrag nicht mehr verfügbar';
    eyebrowEl.textContent = 'Aktuelles · ' + (feedConfig ? feedConfig.badge + ' · Instagram' : 'Instagram');
    var profileUrl = feedConfig ? feedConfig.profile : 'https://www.instagram.com/basketball.loewen/';
    contentEl.innerHTML =
      '<p class="t-body">Dieser Beitrag ist im aktuellen Instagram-Feed nicht mehr enthalten — Instagram zeigt uns hier immer nur die letzten Beiträge.</p>' +
      '<a class="btn btn-primary" style="margin-top:16px" href="' + profileUrl + '" target="_blank" rel="noopener">Zum Instagram-Profil <i data-lucide="arrow-up-right" style="width:16px;height:16px"></i></a>' +
      articleFooterHtml(true);
    if (window.lucide) { lucide.createIcons(); }
  }

  if (!feedConfig || !postId) {
    showNotFound();
    return;
  }

  fetch(feedConfig.url, { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var post = data && (data.posts || []).find(function (p) { return p.id === postId; });
      if (!post) { showNotFound(); return; }

      eyebrowEl.textContent = 'Aktuelles · ' + feedConfig.badge + ' · Instagram';
      titleEl.textContent = firstLine(post.caption, 90);

      var likesLine = (post.likeCount || post.commentsCount)
        ? '<p class="t-caption" style="color:var(--text-muted);margin-bottom:16px">' +
          formatDate(post.timestamp) +
          (post.likeCount ? ' · ' + post.likeCount + ' Likes' : '') +
          (post.commentsCount ? ' · ' + post.commentsCount + ' Kommentare' : '') +
          '</p>'
        : '<p class="t-caption" style="color:var(--text-muted);margin-bottom:16px">' + formatDate(post.timestamp) + '</p>';

      var instaLink = post.permalink
        ? '<a class="btn btn-outline-orange btn-sm" href="' + post.permalink + '" target="_blank" rel="noopener">' + INSTAGRAM_ICON + ' Original ansehen</a>'
        : '';
      var topRowHtml = '<div style="display:flex;align-items:center;justify-content:' + (instaLink ? 'space-between' : 'flex-end') + ';gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
        instaLink + NEWSLETTER_BTN +
        '</div>';

      contentEl.innerHTML =
        '<div class="insta-detail-grid">' +
          '<div class="insta-detail-media"><img src="' + post.image + '" alt="" /></div>' +
          '<div>' +
            topRowHtml +
            likesLine +
            '<p class="t-body" style="white-space:pre-line">' + escapeHtml(post.caption || '') + '</p>' +
          '</div>' +
        '</div>' +
        articleFooterHtml(false);

      if (window.lucide) { lucide.createIcons(); }
    })
    .catch(showNotFound);
});
