/* Community-Events-Kacheln: rendert Events aus /data/community-events.json
   (per Notion-Sync gefüllt, s. n8n-Workflow "Website: Community-Events abrufen").
   Kacheln stehen chronologisch aufsteigend im DOM (älteste zuerst); direkt nach
   dem Rendern wird der Slider so weit nach rechts gescrollt, dass das nächste
   anstehende Event die erste sichtbare Kachel ist — vergangene Events bleiben
   drin, sind aber nur noch über den Pfeil nach links erreichbar. */
function initCommunityEvents(containerId, jsonPath) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var track = container.querySelector('.news-slider-track');
  var prevBtn = container.querySelector('[data-gallery-prev]');
  var nextBtn = container.querySelector('[data-gallery-next]');

  var CATEGORY_ICON = {
    'Straßenfest': { icon: 'flag', tint: 'tint-blue' },
    'Turnier': { icon: 'trophy', tint: 'tint-orange' },
    'Vereinsfest': { icon: 'party-popper', tint: 'tint-violet' }
  };
  var FALLBACK_DESCRIPTION = 'Die Basketball Löwen Erfurt sind mit dabei — Details folgen in Kürze.';

  function berlinParts(date) {
    var fmt = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    var parts = {};
    fmt.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    return parts;
  }

  function dateLabel(ev) {
    var start = new Date(ev.start);
    var weekday = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(start);
    var p = berlinParts(start);
    var dateText = weekday + ', ' + p.day + '.' + p.month + '.' + p.year.slice(2);
    if (!ev.isDatetime) return dateText;
    var startTime = p.hour + ':' + p.minute;
    var endTime = '';
    if (ev.end) {
      var pe = berlinParts(new Date(ev.end));
      endTime = '–' + pe.hour + ':' + pe.minute;
    }
    return dateText + ', ' + startTime + endTime + ' Uhr';
  }

  function calendarLink(ev) {
    var start = new Date(ev.start);
    var p = berlinParts(start);
    var startStr, endStr;
    if (ev.isDatetime) {
      startStr = p.year + p.month + p.day + 'T' + p.hour + p.minute + '00';
      var pe = ev.end ? berlinParts(new Date(ev.end)) : p;
      endStr = pe.year + pe.month + pe.day + 'T' + pe.hour + pe.minute + '00';
    } else {
      startStr = p.year + p.month + p.day;
      endStr = p.year + p.month + p.day;
    }
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: ev.name,
      dates: startStr + '/' + endStr,
      location: ev.location || '',
      ctz: 'Europe/Berlin'
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function cardHTML(ev) {
    var cat = CATEGORY_ICON[ev.category] || { icon: 'calendar', tint: 'tint-neutral' };
    var mediaHTML = ev.heroImage
      ? '<div class="card-media card-media-photo"><img src="' + ev.heroImage + '" alt="' + (ev.name || '').replace(/"/g, '&quot;') + '" loading="lazy" /></div>'
      : '<div class="card-media ' + cat.tint + '"><i data-lucide="' + cat.icon + '" class="icon-32"></i></div>';
    var locationHTML = ev.location
      ? '<a class="t-caption" style="display:flex;align-items:center;gap:4px;margin:0 0 10px;color:var(--text-muted)" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.location) + '" target="_blank" rel="noopener"><i data-lucide="map-pin" class="icon-12"></i> ' + ev.location + '</a>'
      : '';
    var description = ev.description || FALLBACK_DESCRIPTION;
    return (
      '<div class="card hoverable camp-slider-card" data-start="' + ev.start + '">' +
        mediaHTML +
        '<div class="card-body">' +
          '<span class="card-label">' + (ev.category || 'Community-Event') + '</span>' +
          '<h3 style="display:flex;align-items:center;gap:8px">' + dateLabel(ev) +
            ' <a href="' + calendarLink(ev) + '" target="_blank" rel="noopener" title="Ins Kalender eintragen" style="display:inline-flex;color:var(--color-brand-orange-text)"><i data-lucide="calendar-plus" class="icon-18"></i></a>' +
          '</h3>' +
          locationHTML +
          '<p>' + description + '</p>' +
        '</div>' +
      '</div>'
    );
  }

  fetch(jsonPath || '/data/community-events.json').then(function (r) { return r.json(); }).then(function (data) {
    var events = (data && data.events) || [];
    if (!events.length) return;

    events = events.slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    track.innerHTML = events.map(cardHTML).join('');
    if (window.lucide) lucide.createIcons();

    // Auf das naechste anstehende Event scrollen (erstes Event mit Start >= jetzt);
    // gibt es keins mehr (alle vergangen), bleibt die Ansicht ganz rechts (letztes Event).
    var now = new Date();
    var cards = Array.prototype.slice.call(track.querySelectorAll('.camp-slider-card'));
    var nextCard = cards.find(function (c) { return new Date(c.getAttribute('data-start')) >= now; }) || cards[cards.length - 1];
    // .news-slider-track hat scroll-behavior:smooth per CSS -- eine direkte
    // scrollLeft-Zuweisung wuerde dadurch animiert statt sofort springen.
    // behavior:'instant' erzwingt den sofortigen Sprung beim ersten Rendern.
    if (nextCard) track.scrollTo({ left: nextCard.offsetLeft, behavior: 'instant' });

    if (prevBtn) prevBtn.addEventListener('click', function () { track.scrollBy({ left: -400, behavior: 'smooth' }); });
    if (nextBtn) nextBtn.addEventListener('click', function () { track.scrollBy({ left: 400, behavior: 'smooth' }); });
  });
}
