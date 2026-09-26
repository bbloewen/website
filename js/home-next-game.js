/* Spieltags-Widget im Homepage-Hero: zeigt das aktuelle Profis-Spiel (Heim
   oder Auswärts) sowie die naechsten zwei anstehenden Spiele. Das "aktuelle"
   Spiel bleibt bis einschliesslich Montag nach dem Spieltag sichtbar und
   verschwindet am darauffolgenden Dienstag automatisch (Marko, 26.09.2026).
   Eyebrow: Auswärtsspiele immer "Auswärts mit Gebrüll", Heimspiele
   durchnummeriert ("1. Heimspiel", ...). Die Zeile zwischen Termin und CTAs
   richtet sich nach spielStatus() (Anpfiff aus Datum+Uhrzeit, +2h Spieldauer):
   "bevorstehend" -> Tabelle, Vorbericht, Livestream; "live" -> Livestream,
   Livescore, Tabelle, Vorbericht, Bericht; "abgeschlossen" -> Ergebnis, Tabelle,
   Spielbericht, Livescore (kein Livestream mehr) (Marko, 26.09.2026).
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

  /* Spielstatus anhand von Datum+Uhrzeit (nicht anhand des cutoffDienstag-Fensters,
     das nur bestimmt, welcher Slide "aktuell" ist) -- ein Spiel gilt ab Anpfiff
     bis Anpfiff+2h als "live", danach als "abgeschlossen" (Marko, 26.09.2026). */
  function spielStatus(g) {
    var teile = (g.zeit || '00:00').split(':').map(Number);
    var anpfiff = new Date(g.date.getFullYear(), g.date.getMonth(), g.date.getDate(), teile[0], teile[1]);
    var ende = new Date(anpfiff.getTime() + 2 * 60 * 60 * 1000);
    var jetzt = new Date();
    if (jetzt < anpfiff) return 'bevorstehend';
    if (jetzt <= ende) return 'live';
    return 'abgeschlossen';
  }

  function gameSlideHTML(g, i, label) {
    var matchup = g.heim ? ('Basketball Löwen – ' + g.gegner) : (g.gegner + ' – Basketball Löwen');
    var venue = g.heim ? 'Riethsporthalle' : (g.halle || g.ort || '');
    var venueLink = venueMapsLink(g);
    var kurzDatum = WOCHENTAGE[g.date.getDay()] + ', ' + pad2(g.date.getDate()) + '.' + pad2(g.date.getMonth() + 1) + '.';

    var terminHTML = '<a href="' + calendarLink(g) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">' +
      '<i data-lucide="calendar" style="width:14px;height:14px;flex-shrink:0"></i>' +
      kurzDatum + ', <strong>' + g.zeit + ' Uhr</strong></a>' +
      (venue ? ', <a href="' + venueLink + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + venue + '</a>' : '');

    function tabelleIcon(extraMargin) {
      return '<a class="cal-link" href="' + TABELLE_URL + '" title="Zur Tabelle"' + (extraMargin ? ' style="margin-left:8px"' : '') + '><i data-lucide="list-ordered" style="width:14px;height:14px"></i></a>';
    }
    function berichtIconHTML(label2, extraMargin) {
      var stil = extraMargin ? ' style="margin-left:4px"' : '';
      if (g.spielberichtUrl) {
        return '<a class="cal-link" href="' + g.spielberichtUrl + '" title="' + label2 + '"' + stil + '><i data-lucide="file-text" style="width:14px;height:14px"></i></a>';
      }
      return '<span class="cal-link" style="opacity:.4;cursor:default' + (extraMargin ? ';margin-left:4px' : '') + '" title="' + label2 + '"><i data-lucide="file-text" style="width:14px;height:14px"></i></span>';
    }
    function livescoreIcon(extraMargin) {
      var stil = extraMargin ? ' style="margin-left:4px"' : '';
      return g.livescore
        ? '<a class="cal-link" href="' + g.livescore + '" target="_blank" rel="noopener" title="Livescore"' + stil + '><i data-lucide="activity" style="width:14px;height:14px"></i></a>'
        : '<span class="cal-link" style="opacity:.4;cursor:default' + (extraMargin ? ';margin-left:4px' : '') + '" title="Livescore"><i data-lucide="activity" style="width:14px;height:14px"></i></span>';
    }
    function livestreamLink(extraMargin) {
      var stil = extraMargin ? ' style="margin-left:4px"' : '';
      return '<a class="card-link" href="' + (g.livestream || GENERISCHER_LIVESTREAM_URL) + '" target="_blank" rel="noopener"' + stil + '><i data-lucide="video" style="width:14px;height:14px"></i> Zum Livestream</a>';
    }

    var status = spielStatus(g);
    var rowHTML;
    if (status === 'bevorstehend') {
      /* Vor Anpfiff: Tabelle, Vorbericht (ausgegraut ohne Link), Livestream --
         noch kein Ergebnis, noch kein Livescore. */
      rowHTML = tabelleIcon(false) + berichtIconHTML('Vorbericht', false) + livestreamLink(true);
    } else if (status === 'live') {
      /* Waehrend des Spiels: erst der Livestream, dann Livescore/Tabelle/
         Vorbericht/Bericht -- kein statischer (moeglicherweise veralteter)
         Ergebnis-Platzhalter. */
      rowHTML = livestreamLink(false) + livescoreIcon(true) + tabelleIcon(false) + berichtIconHTML('Vorbericht', false) + berichtIconHTML('Bericht', false);
    } else {
      /* Nach Spielende: Ergebnis gross, dann Tabelle, Spielbericht (nicht mehr
         Vorbericht) und Livescore -- kein Livestream mehr. */
      rowHTML = '<div class="fixture-result">' + (g.ergebnis || '– – : – –') + '</div>' +
        tabelleIcon(true) + berichtIconHTML('Spielbericht', false) + livescoreIcon(false);
    }

    var ctaHTML = g.heim
      ? '<a class="btn btn-primary btn-sm" style="color:#fff" href="/saison/profis/gameday/"><i data-lucide="ticket" style="width:14px;height:14px"></i> Tickets</a>' +
        '<a class="btn btn-ghost btn-sm" href="/tickets/dauerkarte.html">Dauerkarte</a>'
      : '<a class="btn btn-primary btn-sm" style="color:#fff" href="/tickets/dauerkarte.html"><i data-lucide="ticket" style="width:14px;height:14px"></i> Heimspiel-Dauerkarte</a>';

    return '<div class="next-game-slide' + (i === 0 ? ' is-active' : '') + '">' +
      '<span class="eyebrow">' + label + '</span>' +
      '<h3 class="t-h4" style="margin:10px 0 6px;white-space:nowrap;overflow:hidden">' + matchup + '</h3>' +
      '<p class="t-body-sm next-game-termin" style="margin-bottom:10px;white-space:nowrap;overflow:hidden">' + terminHTML + '</p>' +
      '<div class="fixture-result-row" style="margin-bottom:12px;flex-wrap:wrap">' + rowHTML + '</div>' +
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
    fetch('/data/spielplan-saison.json?v=1790418622').then(function (r) { return r.json(); })
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
      return gameSlideHTML(g, i, label);
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
