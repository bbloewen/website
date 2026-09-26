/* Spieltags-Widget im Homepage-Hero: zeigt das aktuelle Profis-Spiel (Heim
   oder Auswärts) sowie die naechsten zwei anstehenden Spiele. Das "aktuelle"
   Spiel bleibt bis einschliesslich Montag nach dem Spieltag sichtbar und
   verschwindet am darauffolgenden Dienstag automatisch (Marko, 26.09.2026).
   Eyebrow: Auswärtsspiele immer "Auswärts mit Gebrüll", Heimspiele
   durchnummeriert ("1. Heimspiel", "2. Heimspiel", ...) unter den gezeigten
   Slides (Marko, 26.09.2026). Beim aktuellen Spiel ersetzt die Ergebnis-Zeile
   (mit Tabelle- und Vor-/Nachbericht-Icon) die Ortszeile 1:1, damit alle
   Slides dieselbe Anzahl Zeilen haben und das Widget nicht in der Höhe
   springt. Quelle: /data/heimspiele.json (Heimspiele) + /data/spielplan-
   saison.json (profisAuswaerts), wie js/spielplan.js. */
(function () {
  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var RIETHSPORTHALLE_MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Essener+Stra%C3%9Fe+20%2C+99089+Erfurt';
  var TABELLE_URL = '/saison/tabelle.html#tabelle-profis';

  var parseDMY = SiteUtils.parseDMY;
  var gcalStamp = SiteUtils.gcalStamp;

  function cutoffDienstag(datum) {
    var d = new Date(datum);
    var tageBis = (2 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (tageBis === 0 ? 7 : tageBis));
    return d;
  }

  function calendarLink(g) {
    var teile = (g.zeit || '00:00').split(':').map(Number);
    var start = new Date(g.date.getFullYear(), g.date.getMonth(), g.date.getDate(), teile[0], teile[1]);
    var ende = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    var text = g.heim ? ('Basketball Löwen – ' + g.gegner) : (g.gegner + ' – Basketball Löwen');
    var params = {
      action: 'TEMPLATE', text: text,
      dates: gcalStamp(start) + '/' + gcalStamp(ende),
      details: g.heim ? 'Heimspiel der Basketball Löwen Erfurt in der Riethsporthalle.' : 'Auswärtsspiel der Basketball Löwen Erfurt.',
      ctz: 'Europe/Berlin'
    };
    if (g.heim) params.location = 'Essener Straße 20, 99089 Erfurt';
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams(params).toString();
  }

  function venueMapsLink(g) {
    if (g.heim) return RIETHSPORTHALLE_MAPS_URL;
    var q = g.adresse || g.ort;
    return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null;
  }

  function gameSlideHTML(g, i, label, istAktuell, heute) {
    var matchup = g.heim ? ('Basketball Löwen – ' + g.gegner) : (g.gegner + ' – Basketball Löwen');
    var venue = g.heim ? 'Riethsporthalle' : (g.halle || g.ort || '');
    var venueLink = venueMapsLink(g);
    var dateStr = g.date.getDate() + '. ' + MONATE[g.date.getMonth()] + ' ' + g.date.getFullYear();

    var zweiteZeile;
    if (istAktuell) {
      var tabelleIcon = '<a class="cal-link" href="' + TABELLE_URL + '" title="Zur Tabelle"><i data-lucide="list-ordered" style="width:14px;height:14px"></i></a>';
      var berichtIcon = '';
      if (g.spielberichtUrl) {
        var berichtLabel = g.date >= heute ? 'Vorbericht' : 'Nachbericht';
        berichtIcon = '<a class="cal-link" href="' + g.spielberichtUrl + '" title="Zum ' + berichtLabel + '"><i data-lucide="file-text" style="width:14px;height:14px"></i></a>';
      }
      zweiteZeile = '<div class="fixture-result-row" style="margin-bottom:12px">' +
        '<div class="fixture-result">' + (g.ergebnis || '– – : – –') + '</div>' + tabelleIcon + berichtIcon +
      '</div>';
    } else {
      zweiteZeile = '<p class="t-body-sm" style="margin-bottom:12px">' +
        (venue ? '<span style="display:inline-flex;align-items:center;gap:6px">' +
          (venueLink ? '<a href="' + venueLink + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">' : '') +
          '<i data-lucide="map-pin" style="width:14px;height:14px"></i>' + venue +
          (venueLink ? '</a>' : '') +
        '</span>' : '') +
      '</p>';
    }

    var ctaHTML;
    if (g.heim) {
      ctaHTML = '<a class="btn btn-primary btn-sm" style="color:#fff" href="/saison/profis/gameday/"><i data-lucide="ticket" style="width:14px;height:14px"></i> Tickets</a>' +
        '<a class="btn btn-ghost btn-sm" href="/tickets/dauerkarte.html">Dauerkarte</a>';
    } else {
      ctaHTML = (g.livestream ? '<a class="btn btn-primary btn-sm" style="color:#fff" href="' + g.livestream + '" target="_blank" rel="noopener"><i data-lucide="video" style="width:14px;height:14px"></i> Zum Livestream</a>' : '') +
        '<a class="btn ' + (g.livestream ? 'btn-ghost' : 'btn-primary') + ' btn-sm"' + (g.livestream ? '' : ' style="color:#fff"') + ' href="/tickets/dauerkarte.html">Dauerkarte kaufen</a>';
    }

    return '<div class="next-game-slide' + (i === 0 ? ' is-active' : '') + '">' +
      '<span class="eyebrow">' + label + '</span>' +
      '<h3 class="t-h4" style="margin:10px 0 6px">' + matchup + '</h3>' +
      '<p class="t-body-sm" style="margin-bottom:12px">' +
        '<span style="display:inline-flex;align-items:center;gap:6px">' +
          '<a href="' + calendarLink(g) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">' +
            '<i data-lucide="calendar" style="width:14px;height:14px"></i>' + dateStr + ', ' + g.zeit + ' Uhr' +
          '</a>' +
        '</span>' +
      '</p>' +
      zweiteZeile +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + ctaHTML + '</div>' +
    '</div>';
  }

  var card = document.getElementById('next-game-card');
  if (!card) return;

  Promise.all([
    fetch('/data/heimspiele.json?v=1786356737').then(function (r) { return r.json(); }),
    fetch('/data/spielplan-saison.json?v=1790372798').then(function (r) { return r.json(); })
  ]).then(function (results) {
    var heim = results[0], saison = results[1];

    var alle = heim.spiele.map(function (s) {
      var g = Object.assign({}, s); g.heim = true; g.date = parseDMY(s.datum); return g;
    }).concat(saison.profisAuswaerts.map(function (s) {
      var g = Object.assign({}, s); g.heim = false; g.date = parseDMY(s.datum); return g;
    })).sort(function (a, b) { return a.date - b.date; });

    var heute = new Date();
    heute.setHours(0, 0, 0, 0);

    var vergangeneOderHeute = alle.filter(function (g) { return g.date <= heute; });
    var aktuell = null;
    if (vergangeneOderHeute.length) {
      var letztes = vergangeneOderHeute[vergangeneOderHeute.length - 1];
      if (heute < cutoffDienstag(letztes.date)) aktuell = letztes;
    }

    var kommende = alle.filter(function (g) { return g.date > heute; }).slice(0, 2);
    var slides = (aktuell ? [aktuell] : []).concat(kommende);
    if (!slides.length) { card.style.display = 'none'; return; }

    var heimZaehler = 0;
    var slidesHTML = slides.map(function (g, i) {
      var label = g.heim ? (++heimZaehler + '. Heimspiel') : 'Auswärts mit Gebrüll';
      return gameSlideHTML(g, i, label, g === aktuell, heute);
    }).join('');

    var dotsHTML = slides.length > 1
      ? '<div class="news-dots">' + slides.map(function (g, i) {
          return '<button class="news-dot' + (i === 0 ? ' is-active' : '') + '" data-slide-to="' + i + '" aria-label="Spiel ' + (i + 1) + ' von ' + slides.length + ': gegen ' + g.gegner + '"></button>';
        }).join('') + '</div>'
      : '';

    card.innerHTML = '<div class="next-game-slides">' + slidesHTML + '</div>' + dotsHTML;

    if (window.lucide) lucide.createIcons();

    /* Widget-Höhe nach dem ersten Rendern fixieren, damit ein Wechsel zwischen
       den Slides (unterschiedlich lange Gegnernamen, Ergebnis-Zeile nur beim
       aktuellen Spiel) das Layout nicht springen lässt (Marko, 26.09.2026). */
    requestAnimationFrame(function () {
      card.style.minHeight = card.offsetHeight + 'px';
    });

    var slideEls = card.querySelectorAll('.next-game-slide');
    var dots = card.querySelectorAll('.news-dot');
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        slideEls.forEach(function (s, si) { s.classList.toggle('is-active', si === i); });
        dots.forEach(function (d, di) { d.classList.toggle('is-active', di === i); });
      });
    });
  });
})();
