/* Spieltags-Widget im Homepage-Hero: zeigt das aktuelle Profis-Spiel (Heim
   oder Auswärts) sowie die naechsten zwei anstehenden Spiele. Das "aktuelle"
   Spiel bleibt bis einschliesslich Montag nach dem Spieltag sichtbar und
   verschwindet am darauffolgenden Dienstag automatisch (Marko, 26.09.2026).
   Eyebrow: Auswärtsspiele immer "Auswärts mit Gebrüll", Heimspiele
   durchnummeriert ("1. Heimspiel", ...). Jeder Slide zeigt dieselben Zeilen
   (Titel, Termin+Ort, Ergebnis, Livestream, Tabelle/Bericht) -- Ergebnis und
   Livestream stehen bewusst auch bei noch nicht gespielten Partien (leerer
   Platzhalter bzw. genereller Sender-Link), damit das Widget beim Wechseln
   zwischen den Slides nicht in der Höhe springt (Marko, 26.09.2026).
   Quelle: /data/heimspiele.json (Heimspiele) + /data/spielplan-saison.json
   (profisAuswaerts), wie js/spielplan.js. */
(function () {
  var WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var RIETHSPORTHALLE_MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Essener+Stra%C3%9Fe+20%2C+99089+Erfurt';
  var TABELLE_URL = '/saison/tabelle.html#tabelle-profis';
  /* Genereller Senderkanal, falls fuer ein Spiel kein eigener Livestream-Link
     hinterlegt ist (Marko, 26.09.2026). */
  var GENERISCHER_LIVESTREAM_URL = 'https://sporteurope.tv/catl-basketball-loewen';

  var parseDMY = SiteUtils.parseDMY;
  var pad2 = SiteUtils.pad2;
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

  function gameSlideHTML(g, i, label, heute) {
    var matchup = g.heim ? ('Basketball Löwen – ' + g.gegner) : (g.gegner + ' – Basketball Löwen');
    var venue = g.heim ? 'Riethsporthalle' : (g.halle || g.ort || '');
    var venueLink = venueMapsLink(g);
    var kurzDatum = WOCHENTAGE[g.date.getDay()] + ', ' + pad2(g.date.getDate()) + '.' + pad2(g.date.getMonth() + 1) + '.';

    var terminHTML = '<a href="' + calendarLink(g) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">' +
      '<i data-lucide="calendar" style="width:14px;height:14px;flex-shrink:0"></i>' +
      kurzDatum + ', <strong>' + g.zeit + ' Uhr</strong></a>' +
      (venue ? ', <a href="' + venueLink + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + venue + '</a>' : '');

    var berichtIcon;
    if (g.spielberichtUrl) {
      var berichtLabel = g.date >= heute ? 'Vorbericht' : 'Nachbericht';
      berichtIcon = '<a class="cal-link" href="' + g.spielberichtUrl + '" title="Zum ' + berichtLabel + '"><i data-lucide="file-text" style="width:14px;height:14px"></i></a>';
    } else {
      berichtIcon = '<span class="cal-link" style="opacity:.4;cursor:default" title="Spielbericht folgt"><i data-lucide="file-text" style="width:14px;height:14px"></i></span>';
    }

    var ctaHTML = g.heim
      ? '<a class="btn btn-primary btn-sm" style="color:#fff" href="/saison/profis/gameday/"><i data-lucide="ticket" style="width:14px;height:14px"></i> Tickets</a>' +
        '<a class="btn btn-ghost btn-sm" href="/tickets/dauerkarte.html">Dauerkarte</a>'
      : '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html"><i data-lucide="ticket" style="width:14px;height:14px"></i> Heimspiel-Dauerkarte</a>';

    return '<div class="next-game-slide' + (i === 0 ? ' is-active' : '') + '">' +
      '<span class="eyebrow">' + label + '</span>' +
      '<h3 class="t-h4" style="margin:10px 0 6px;white-space:nowrap;overflow:hidden">' + matchup + '</h3>' +
      '<p class="t-body-sm next-game-termin" style="margin-bottom:10px;white-space:nowrap;overflow:hidden">' + terminHTML + '</p>' +
      '<div class="fixture-result-row" style="margin-bottom:12px;flex-wrap:wrap">' +
        '<div class="fixture-result">' + (g.ergebnis || '– – : – –') + '</div>' +
        '<a class="cal-link" href="' + TABELLE_URL + '" title="Zur Tabelle" style="margin-left:8px"><i data-lucide="list-ordered" style="width:14px;height:14px"></i></a>' +
        berichtIcon +
        '<a class="card-link" href="' + (g.livestream || GENERISCHER_LIVESTREAM_URL) + '" target="_blank" rel="noopener" style="margin-left:4px"><i data-lucide="video" style="width:14px;height:14px"></i> Zum Livestream</a>' +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + ctaHTML + '</div>' +
    '</div>';
  }

  /* Verkleinert ein Element schrittweise, bis sein Text in eine Zeile passt
     (manche Gegnernamen/Ortsangaben sind sonst zu lang) -- muss auf dem
     jeweils sichtbaren Slide laufen, da ausgeblendete Slides (display:none)
     nicht messbar sind (Marko, 26.09.2026). */
  function fitOneLine(el, startGroesse, minGroesse) {
    var groesse = startGroesse;
    el.style.fontSize = groesse + 'px';
    while (el.scrollWidth > el.clientWidth && groesse > minGroesse) {
      groesse -= 1;
      el.style.fontSize = groesse + 'px';
    }
  }

  function fitSlide(slideEl) {
    fitOneLine(slideEl.querySelector('h3'), 20, 12);
    fitOneLine(slideEl.querySelector('.next-game-termin'), 14, 11);
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
      return gameSlideHTML(g, i, label, heute);
    }).join('');

    var dotsHTML = slides.length > 1
      ? '<div class="news-dots">' + slides.map(function (g, i) {
          return '<button class="news-dot' + (i === 0 ? ' is-active' : '') + '" data-slide-to="' + i + '" aria-label="Spiel ' + (i + 1) + ' von ' + slides.length + ': gegen ' + g.gegner + '"></button>';
        }).join('') + '</div>'
      : '';

    card.innerHTML = '<div class="next-game-slides">' + slidesHTML + '</div>' + dotsHTML;

    if (window.lucide) lucide.createIcons();

    var slideEls = card.querySelectorAll('.next-game-slide');
    var dots = card.querySelectorAll('.news-dot');

    /* Erst nach document.fonts.ready messen: Lexend ist beim ersten Aufruf oft
       noch nicht geladen, die Messung würde dann mit den (schmaleren)
       Fallback-Metriken rechnen und zu groß ausfallen (Marko, 26.09.2026). */
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
      fitSlide(slideEls[0]);
      /* Widget-Höhe danach fixieren, damit ein Wechsel zwischen den Slides
         (unterschiedlich lange Gegnernamen) das Layout nicht springen laesst. */
      requestAnimationFrame(function () {
        card.style.minHeight = card.offsetHeight + 'px';
      });
    });

    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        slideEls.forEach(function (s, si) { s.classList.toggle('is-active', si === i); });
        dots.forEach(function (d, di) { d.classList.toggle('is-active', di === i); });
        fitSlide(slideEls[i]);
      });
    });
  });
})();
