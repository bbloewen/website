/* Freiplätze-Karte, Platz-Kacheln und der Court-Hunt-Spielstand.

   Das Rendering lag bis 24.08.2026 inline am Ende von trainieren/freiplaetze.html.
   Seit es die Platzseite (trainieren/freiplatz.html) und die Standsseite
   (trainieren/court-hunt.html) gibt, brauchen drei Seiten dieselben Bausteine —
   deshalb liegt alles hier.

   Court-Hunt in einem Satz: Wer an einem Freiplatz steht, checkt per Standort ein
   und sammelt Punkte; wer im Monat am meisten sammelt, gewinnt einen
   Ticket-Gutschein. Der Spielstand liegt pseudonym auf dem Gerät (zufällige ID,
   selbst gewählter Spielername) — personenbezogene Daten fragt der Verein erst
   beim Einlösen des Gewinns ab.

   Punkte werden am Ende server-seitig vergeben (bbloewen/court-hunt-api), sonst
   könnte sich jeder per DevTools den Sieg schreiben. Solange API_BASE leer ist,
   läuft das Spiel rein lokal weiter und sammelt die Check-ins in stand.offen —
   die gehen raus, sobald die API eingetragen ist. */
(function () {
  'use strict';

  var DATA_URL = '/data/freiplaetze.json?v=1787654030';

  /* Der Court-Hunt-Dienst zaehlt die Punkte verbindlich (bbloewen/court-hunt-api,
     Railway). Der Browser rechnet trotzdem sofort mit, damit man am Platz nicht
     auf das Netz wartet — bei Abweichung gilt der Serverstand. */
  var API_BASE = 'https://court-hunt-api-production.up.railway.app';

  var STORAGE_KEY = 'loewen-court-hunt';
  /* 100 m: Ein Freiplatz ist rund 30 m lang, 100 m heisst also "auf dem Platz
     oder direkt daneben" — und nicht "vom Balkon gegenueber". Dazu ein
     Zugestaendnis an die GPS-Genauigkeit, die das Handy selbst mitliefert:
     unter Baeumen oder zwischen Haeusern meldet es schnell 40–60 m Unschaerfe,
     und daran soll der Check-in nicht scheitern. Mehr als 75 m Nachlass gibt es
     aber nicht, sonst wird aus der Toleranz ein Scheunentor. */
  var RADIUS_M = 100;
  var GENAUIGKEIT_MAX_M = 75;
  /* 12 Stunden statt 24: Wer Dienstag abends am Platz war, soll Mittwoch
     nachmittags wieder zählen — sonst bestraft die Sperre den, der einfach mal
     früher spielt. */
  var COOLDOWN_MS = 12 * 60 * 60 * 1000;
  /* Serien-Bonus alle drei Tage (Tag 3, 6, 9 …) statt einmaliger Stufen bei 3
     und 7 — sonst wäre Dranbleiben ab Tag vier wirkungslos. */
  /* spot: 50 — derselbe Wert, den der n8n-Sync der API meldet. Steht hier nur
     fuer die Sofort-Rueckmeldung im Browser; gezaehlt wird server-seitig. */
  var PUNKTE = { checkin: 10, erstbesuch: 20, serie: 30, spot: 50 };
  var SERIE_INTERVALL = 3;

  /* ---------------------------------------------------------------- Daten */

  var datenPromise = null;

  function ladeDaten() {
    if (!datenPromise) {
      datenPromise = fetch(DATA_URL).then(function (r) { return r.json(); });
    }
    return datenPromise;
  }

  /* Event-Spots kommen aus den Community-Events, nicht aus der Platzliste: Sie
     gelten nur an einem Tag und haben in der dauerhaften Übersicht nichts
     verloren. Für die Seite verhalten sie sich danach wie ein Platz. */
  var EVENT_URL = '/data/community-events.json';
  var eventPromise = null;

  function ladeSpots() {
    if (!eventPromise) {
      eventPromise = fetch(EVENT_URL).then(function (r) { return r.json(); }).then(function (daten) {
        return (daten.events || []).filter(function (e) {
          return e.courtHunt && e.spotSlug && typeof e.lat === 'number' && typeof e.lng === 'number';
        }).map(function (e) {
          return {
            slug: e.spotSlug,
            name: e.name,
            /* Das Land steht in jeder Notion-Adresse und traegt nichts bei. */
            adresse: (e.location || '').replace(/,\s*(Deutschland|Germany)$/, ''),
            lat: e.lat,
            lng: e.lng,
            beschreibung: e.description || 'Mobiler Korb der Löwen — nur an diesem Tag, dafür 50 Punkte.',
            typ: 'event',
            punkte: PUNKTE.spot,
            von: e.spotVon,
            bis: e.spotBis,
            zugang: 'oeffentlich'
          };
        });
      }).catch(function () { return []; });
    }
    return eventPromise;
  }

  function spotOffen(spot, jetzt) {
    var zeit = (jetzt || new Date()).getTime();
    return zeit >= new Date(spot.von).getTime() && zeit <= new Date(spot.bis).getTime();
  }

  function spotVorbei(spot) {
    return new Date(spot.bis).getTime() < Date.now();
  }

  /* Immer in Berliner Zeit, nicht in der Zeitzone des Geraets: Das Fest findet
     in Erfurt statt, auch wenn jemand aus dem Urlaub auf die Seite schaut. Die
     Zeitstempel kommen seit 25.08.2026 als UTC mit Z aus dem Notion-Sync;
     aeltere Eintraege ohne Zeitzonen-Angabe liest der Browser als Ortszeit. */
  function spotZeitText(spot) {
    var von = new Date(spot.von);
    var tag = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit' }).format(von);
    var uhr = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(von);
    var bis = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(spot.bis));
    return tag + ', ' + uhr + ' bis ' + bis + ' Uhr';
  }

  function platzUrl(f) {
    /* Dauerhafte Plaetze leben seit dem 25.08.2026 auf ihrer eigenen Adresse
       (tools/build-freiplatz-seiten.py); nur Event-Spots (Slug-Praefix
       "event-", kommen aus den Community-Events statt aus der Platzliste)
       nutzen weiterhin die Huelle freiplatz.html mit ?platz=, die es fuer
       feste Plaetze gar nicht mehr gibt. Unterscheidung bewusst am
       Slug-Praefix, nicht an f.typ, damit sie mit platz_url() in
       build-freiplaetze.py und qr_saetze() in build-freiplatz-qr.py
       uebereinstimmt (s. tools/README.md) -- alle drei muessen bei einer
       Aenderung zusammen angepasst werden.
       Vorher zeigte diese Funktion fuer alle Plaetze auf die Huelle -- der
       Redirect darin (initPlatzseite) leitete dann auf genau dieselbe URL
       um, window.location.replace() aendert nichts und die Seite blieb fuer
       immer bei "Platz wird geladen ..." haengen (Feedback AG, 25.08.2026). */
    return f.slug.indexOf('event-') === 0
      ? '/trainieren/freiplatz.html?platz=' + encodeURIComponent(f.slug)
      : '/trainieren/freiplatz/' + encodeURIComponent(f.slug) + '.html';
  }

  function mapsUrl(f) {
    return 'https://www.google.com/maps/search/?api=1&query=' + f.lat + ',' + f.lng;
  }

  function spielbar(f) {
    return f.zugang !== 'eingeschraenkt';
  }

  /* --------------------------------------------------------- Spielstand */

  function geraeteId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    /* Fallback für ältere Browser — muss nicht kryptografisch stark sein, nur
       kollisionsarm genug, um zwei Geräte auseinanderzuhalten. */
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function ladeStand() {
    try {
      var roh = window.localStorage.getItem(STORAGE_KEY);
      return roh ? JSON.parse(roh) : null;
    } catch (e) {
      /* Privater Modus oder gesperrter Speicher: Spiel bleibt dann eben aus. */
      return null;
    }
  }

  function speichereStand(stand) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stand));
      return true;
    } catch (e) {
      return false;
    }
  }

  function starteSpiel() {
    var stand = { geraeteId: geraeteId(), name: '', checkins: [], boni: [], punkte: 0, offen: [] };
    speichereStand(stand);
    return stand;
  }

  function loescheStand() {
    var stand = ladeStand();
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    /* Server-Seite gleich mit: sonst bliebe der Eintrag in der Rangliste stehen,
       obwohl das Gerät ihn nicht mehr sehen kann. */
    if (stand && API_BASE) {
      fetch(API_BASE + '/forget/' + encodeURIComponent(stand.geraeteId), { method: 'POST' })
        .catch(function () {});
    }
  }

  function speicherVerfuegbar() {
    try {
      window.localStorage.setItem(STORAGE_KEY + '-test', '1');
      window.localStorage.removeItem(STORAGE_KEY + '-test');
      return true;
    } catch (e) {
      return false;
    }
  }

  /* --------------------------------------------------------- Punktelogik */

  /* Tagesschlüssel in Berliner Zeit — gleiche Zeitzonen-Konvention wie bei den
     Community-Events, damit ein Check-in um 23:30 Uhr nicht als Folgetag zählt. */
  function tagKey(datum) {
    var teile = {};
    new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(datum).forEach(function (p) { teile[p.type] = p.value; });
    return teile.year + '-' + teile.month + '-' + teile.day;
  }

  function vortag(schluessel) {
    var d = new Date(schluessel + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /* Länge der aktuellen Serie: wie viele Tage in Folge (bis einschließlich
     heute) gab es mindestens einen Check-in? */
  function serienLaenge(stand, heute) {
    var tage = {};
    stand.checkins.forEach(function (c) { tage[tagKey(new Date(c.ts))] = true; });
    var laenge = 0;
    var tag = heute;
    while (tage[tag]) {
      laenge++;
      tag = vortag(tag);
    }
    return laenge;
  }

  function besucht(stand, slug) {
    return stand.checkins.some(function (c) { return c.slug === slug; });
  }

  function letzterCheckin(stand, slug) {
    var letzter = 0;
    stand.checkins.forEach(function (c) {
      if (c.slug === slug && c.ts > letzter) letzter = c.ts;
    });
    return letzter;
  }

  /* Bucht den Check-in lokal und liefert die Gutschrift zurück. Der Server ist
     die Instanz, die am Monatsende zählt; diese Rechnung hier ist nur die
     sofortige Rückmeldung, damit man am Platz nicht auf das Netz wartet. */
  function bucheCheckin(stand, platz, jetzt, coords) {
    var gutschrift = [];
    /* Ein Event-Spot bringt 50 statt 10 Punkte und keinen Erstbesuch-Bonus —
       genauso rechnet der Server (spiel.py). Weicht der Browser hier ab, springt
       die Anzeige, sobald die Server-Antwort da ist. */
    var punkte = platz.punkte || PUNKTE.checkin;
    gutschrift.push({ text: 'Check-in ' + platz.name, punkte: punkte });

    if (platz.typ !== 'event' && !besucht(stand, platz.slug)) {
      punkte += PUNKTE.erstbesuch;
      gutschrift.push({ text: 'Erstbesuch', punkte: PUNKTE.erstbesuch });
    }

    stand.checkins.push({ slug: platz.slug, ts: jetzt });

    var heute = tagKey(new Date(jetzt));
    var serie = serienLaenge(stand, heute);
    var schluessel = 'serie3:' + heute;
    if (serie && serie % SERIE_INTERVALL === 0 && stand.boni.indexOf(schluessel) < 0) {
      stand.boni.push(schluessel);
      punkte += PUNKTE.serie;
      gutschrift.push({ text: serie + ' Tage in Folge', punkte: PUNKTE.serie });
    }

    stand.punkte += punkte;
    stand.offen.push({
      slug: platz.slug,
      /* Vier Nachkommastellen, rund 11 m: genau genug fuer die Pruefung auf dem
         Server (100-m-Radius), aber keine metergenaue Ortsangabe in der
         Warteschlange auf dem Geraet. */
      lat: coords ? Math.round(coords.latitude * 10000) / 10000 : null,
      lng: coords ? Math.round(coords.longitude * 10000) / 10000 : null,
      genauigkeit: coords && coords.accuracy ? Math.round(coords.accuracy) : null
    });
    speichereStand(stand);
    return { punkte: punkte, gutschrift: gutschrift, serie: serie };
  }

  /* Schickt die Warteschlange einzeln und der Reihe nach zum Server: Der prueft
     unter anderem, ob der Ortswechsel zwischen zwei Check-ins plausibel ist —
     das setzt die richtige Reihenfolge voraus.

     Antwortet der Server fachlich ablehnend (409, etwa Sperre oder zu weit weg),
     fliegt der Eintrag aus der Warteschlange: Ein zweiter Versuch aendert daran
     nichts. Nur bei Netzfehlern bleibt er liegen und geht beim naechsten
     Seitenaufruf erneut raus. */
  function sendeOffene(stand, fertig) {
    if (!API_BASE || !stand.offen.length) return;
    var naechster = stand.offen[0];

    fetch(API_BASE + '/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geraeteId: stand.geraeteId,
        slug: naechster.slug,
        lat: naechster.lat,
        lng: naechster.lng,
        genauigkeit: naechster.genauigkeit
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (daten) {
        return { ok: res.ok, status: res.status, daten: daten };
      });
    }).then(function (antwort) {
      if (!antwort.ok && antwort.status !== 409 && antwort.status !== 404) return;
      stand.offen.shift();
      if (antwort.ok && antwort.daten.stand) {
        /* Serverstand ist massgeblich — er kennt auch Check-ins von frueher. */
        stand.punkte = antwort.daten.stand.gesamt;
      }
      speichereStand(stand);
      if (fertig) fertig(stand);
      sendeOffene(stand, fertig);
    }).catch(function () { /* bleibt in der Warteschlange */ });
  }

  /* ----------------------------------------------------------- Standort */

  function entfernungM(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /* Ist der Platz nah genug? Beruecksichtigt die vom Geraet gemeldete
     Ungenauigkeit, damit ein schlechtes GPS-Signal keinen ehrlichen Check-in
     verhindert. */
  function inReichweite(abstand, genauigkeit) {
    var nachlass = Math.min(genauigkeit || 0, GENAUIGKEIT_MAX_M);
    return abstand - nachlass <= RADIUS_M;
  }

  function standort() {
    return new Promise(function (erfuellen, ablehnen) {
      if (!navigator.geolocation) {
        ablehnen(new Error('Dein Browser kann deinen Standort nicht bestimmen.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { erfuellen(pos.coords); },
        function (err) {
          ablehnen(new Error(err.code === err.PERMISSION_DENIED
            ? 'Ohne Standortfreigabe können wir nicht prüfen, ob du wirklich am Platz stehst.'
            : 'Dein Standort ließ sich gerade nicht bestimmen — probier es noch einmal.'));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  }

  function abstandText(meter) {
    return meter < 1000 ? meter + ' m' : String(Math.round(meter / 100) / 10).replace('.', ',') + ' km';
  }

  /* Alle bespielbaren Plaetze nach Entfernung sortiert. Grundlage des
     Sofort-Check-ins: Die Seite kennt die Plaetze, das Handy kennt die Position
     — den passenden Platz kann sie daraus selbst bestimmen, dafuer braucht es
     keinen QR-Code am Korb. */
  function naechstePlaetze(coords, plaetze) {
    return plaetze.filter(spielbar).map(function (f) {
      return { platz: f, abstand: entfernungM(coords.latitude, coords.longitude, f.lat, f.lng) };
    }).sort(function (a, b) { return a.abstand - b.abstand; });
  }

  function erfolgsText(ergebnis, stand) {
    return '+' + ergebnis.punkte + ' Punkte: ' +
      ergebnis.gutschrift.map(function (g) { return g.text; }).join(', ') +
      '. Neuer Stand: ' + stand.punkte + ' Punkte.';
  }

  /* ----------------------------------------------------------- Rendering */

  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (z) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z];
    });
  }

  function medienBlock(f) {
    var qr = f.qr
      ? '<img class="freiplatz-qr" src="' + f.qr + '" alt="QR-Code mit der Wegbeschreibung zum ' + esc(f.name) + '" loading="lazy" />'
      : '';
    if (f.fotoEmbed) {
      return '<div class="card-media card-media-photo freiplatz-media">' +
        '<iframe src="' + f.fotoEmbed + '" title="Kartenansicht ' + esc(f.name) + '" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>' + qr + '</div>';
    }
    if (f.foto) {
      return '<div class="card-media card-media-photo freiplatz-media">' +
        '<img src="' + f.foto + '" alt="' + esc(f.name) + '" loading="lazy" />' + qr + '</div>';
    }
    return '<div class="card-media freiplatz-photo-placeholder freiplatz-media">' +
      '<i data-lucide="image" class="icon-22"></i><span>Foto folgt</span>' + qr + '</div>';
  }

  function zugangBanner(f) {
    if (spielbar(f)) return '';
    return '<div class="freiplatz-zugang-banner"><i data-lucide="lock" class="icon-16"></i> ' +
      esc(f.zugangHinweis || 'Zugang eingeschränkt') + '</div>';
  }

  /* Erklärt, wer den Platz verwaltet und wer ihn nutzen darf. Ohne diesen Satz
     liest sich ein eingeschränkter Platz so, als hätte der Verein ihn
     dichtgemacht. Links stehen als [Beschriftung] mitten im Text und werden aus
     f.zugangLinks aufgelöst — mitten im Satz gelesen, nicht als Extra-Zeile
     darunter. Nur https-Ziele, alles andere bleibt schlichter Text. */
  function mitLinks(text, links) {
    return esc(text).replace(/\[([^\]]+)\]/g, function (ganzes, beschriftung) {
      var ziel = links && links[beschriftung];
      return ziel && ziel.indexOf('https://') === 0
        ? '<a href="' + ziel + '" target="_blank" rel="noopener">' + beschriftung + '</a>'
        : beschriftung;
    });
  }

  function zugangDetail(f) {
    if (spielbar(f) || !f.zugangDetail) return '';
    return '<p class="freiplatz-zugang-detail">' + mitLinks(f.zugangDetail, f.zugangLinks) + '</p>';
  }

  function kachel(f) {
    return '<div class="card freiplatz-card">' + medienBlock(f) + zugangBanner(f) +
      '<div class="card-body">' +
        '<h3>' + esc(f.name) + '</h3>' +
        '<p>' + esc(f.beschreibung) + '</p>' +
        zugangDetail(f) +
        '<a class="freiplatz-adresse-link" href="' + mapsUrl(f) + '" target="_blank" rel="noopener">' +
          '<i data-lucide="map-pin" class="icon-16"></i> ' + esc(f.adresse) + '</a>' +
        '<a class="card-link" href="' + platzUrl(f) + '">' +
          (spielbar(f) ? 'Platz öffnen und einchecken' : 'Platz ansehen') +
          ' <i data-lucide="arrow-right" class="icon-14"></i></a>' +
      '</div>' +
    '</div>';
  }

  /* Kachel eines Event-Spots. Bewusst nicht kachel(): Ein Spot hat kein Foto und
     keinen Zugangshinweis, dafuer ein Zeitfenster — und genau das ist die
     Information, wegen der jemand die Kachel ueberhaupt liest. */
  /* Drei Zustaende, drei Texte — dieselbe Unterscheidung wie im spotZeile-Block
     der Platzseite (initPlatzseite): vorbei, jetzt aktiv, oder noch bevorstehend. */
  function spotKachel(sp) {
    var vorbei = spotVorbei(sp);
    var laeuft = spotOffen(sp);
    var zeile = vorbei
      ? 'War aktiv am ' + esc(spotZeitText(sp)) + '.'
      : (laeuft ? 'Jetzt aktiv: ' + esc(spotZeitText(sp)) + ' — 50 Punkte am mobilen Korb.'
        : 'Aktiv am ' + esc(spotZeitText(sp)) + ' — dann gibt es hier 50 Punkte.');
    return '<div class="card hoverable camp-slider-card' + (vorbei ? ' ist-vorbei' : '') +
        '" data-start="' + esc(sp.von) + '" data-ende="' + esc(sp.bis) + '">' +
      '<div class="card-media tint-violet" style="height:140px"><i data-lucide="calendar-clock" class="icon-32"></i></div>' +
      '<div class="card-body">' +
        '<span class="card-label">' + (vorbei ? 'Vorbei' : (laeuft ? 'Heute aktiv' : 'Court-Hunt-Spot')) + '</span>' +
        '<h3>' + esc(sp.name) + '</h3>' +
        '<p class="freiplatz-spot-zeit"><i data-lucide="calendar-clock" class="icon-16"></i> ' + zeile + '</p>' +
        (sp.adresse
          ? '<a class="freiplatz-adresse-link" href="' + mapsUrl(sp) + '" target="_blank" rel="noopener">' +
            '<i data-lucide="map-pin" class="icon-16"></i> ' + esc(sp.adresse) + '</a>'
          : '') +
        '<a class="card-link" href="' + platzUrl(sp) + '">' +
          (laeuft ? 'Spot öffnen und einchecken' : 'Spot ansehen') +
          ' <i data-lucide="arrow-right" class="icon-14"></i></a>' +
      '</div>' +
    '</div>';
  }

  /* Alle Court-Hunt-Spots aus den Community-Events, chronologisch — genau wie
     initCommunityEvents() auf der Community-Events-Seite. Vergangene bleiben
     stehen (ausgegraut, per data-start/data-ende), der Streifen scrollt beim
     Laden aber gleich zum naechsten noch laufenden oder kommenden Spot, sodass
     Vergangenes nur per Wischen/Pfeil nach links zu sehen ist. */
  function spotListe(sektion, spots) {
    if (!sektion) return;
    if (!spots.length) {
      sektion.hidden = true;
      return;
    }
    var sortiert = spots.slice().sort(function (a, b) { return new Date(a.von) - new Date(b.von); });

    var wrap = sektion.querySelector('.camp-gallery-wrap');
    var track = wrap && wrap.querySelector('.news-slider-track');
    if (!track) return;
    track.innerHTML = sortiert.map(spotKachel).join('');
    sektion.hidden = false;

    var jetzt = new Date();
    var karten = Array.prototype.slice.call(track.querySelectorAll('.camp-slider-card'));
    var naechste = karten.find(function (k) { return new Date(k.getAttribute('data-ende')) >= jetzt; }) || karten[karten.length - 1];
    if (naechste) track.scrollTo({ left: naechste.offsetLeft, behavior: 'instant' });

    var vor = wrap.querySelector('[data-gallery-prev]');
    var zurueck = wrap.querySelector('[data-gallery-next]');
    if (vor) vor.addEventListener('click', function () { track.scrollBy({ left: -400, behavior: 'smooth' }); });
    if (zurueck) zurueck.addEventListener('click', function () { track.scrollBy({ left: 400, behavior: 'smooth' }); });
  }

  function zeichneKarte(elementId, plaetze) {
    var el = document.getElementById(elementId);
    if (!el || !window.L) return;

    var map = window.L.map(elementId, { scrollWheelZoom: false });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);

    var marker = plaetze.map(function (f) {
      var eingeschraenkt = !spielbar(f);
      /* Eigener divIcon statt Standard-Pin: nur so lassen sich die beiden
         Zustände farblich trennen. Die Form unterscheidet sich zusätzlich
         (Ring statt Punkt), damit die Karte nicht allein über Farbe spricht. */
      var icon = window.L.divIcon({
        className: 'freiplatz-pin' + (eingeschraenkt ? ' freiplatz-pin-eingeschraenkt' : '') +
          (f.typ === 'event' ? ' freiplatz-pin-event' : ''),
        html: '<span></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
      });
      var popup = '<strong>' + esc(f.name) + '</strong><br>' + esc(f.adresse);
      if (f.typ === 'event') {
        popup += '<br><span class="freiplatz-popup-event">Court-Hunt-Spot: ' + esc(spotZeitText(f)) + '</span>';
      }
      if (eingeschraenkt) {
        popup += '<br><span class="freiplatz-popup-hinweis">' + esc(f.zugangHinweis || 'Zugang eingeschränkt') + '</span>';
      }
      popup += '<br><a href="' + platzUrl(f) + '">Zum Platz</a>';
      return window.L.marker([f.lat, f.lng], { icon: icon, alt: f.name, keyboard: true }).bindPopup(popup);
    });

    if (marker.length === 1) {
      marker[0].addTo(map);
      map.setView([plaetze[0].lat, plaetze[0].lng], 15);
    } else if (marker.length) {
      map.fitBounds(window.L.featureGroup(marker).addTo(map).getBounds().pad(0.2));
    }
    return map;
  }

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  /* ------------------------------------------------ Spielstand-Anzeige */

  /* Spielername: Pflicht fuer die Rangliste, aber ausdruecklich ein Fantasiename.
     Ohne ihn steht dort nur "ohne Namen" — das ist kein Fehler, sondern die
     Voreinstellung, damit niemand aus Versehen seinen echten Namen hinterlaesst. */
  function namensBereich(stand) {
    if (!API_BASE) return '';
    if (stand.name) {
      return '<p class="court-hunt-name">Du spielst als <strong>' + esc(stand.name) + '</strong> ' +
        '<button type="button" class="btn-link" data-name-aendern>ändern</button></p>';
    }
    return '<form class="court-hunt-name-form" data-name-form>' +
      '<label for="court-hunt-name">Spielername für die Rangliste — such dir einen aus, nicht deinen echten Namen</label>' +
      '<p class="court-hunt-name-regel">Was die Grenzen des guten Geschmacks überschreitet, wird gesperrt — und ' +
      'wer es darauf anlegt, fliegt aus dem Spiel.</p>' +
      '<div class="court-hunt-name-zeile">' +
        '<input type="text" id="court-hunt-name" name="name" maxlength="24" minlength="2" placeholder="z. B. Korbjäger" required />' +
        '<button type="submit" class="btn btn-ghost">Speichern</button>' +
      '</div>' +
      '<p class="court-hunt-name-meldung" role="status" aria-live="polite"></p>' +
    '</form>';
  }

  function namenVerdrahten(el, stand) {
    var aendern = el.querySelector('[data-name-aendern]');
    if (aendern) {
      aendern.addEventListener('click', function () {
        stand.name = '';
        speichereStand(stand);
        standPanel(el);
        icons();
      });
      return;
    }

    var form = el.querySelector('[data-name-form]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var feld = form.querySelector('input[name="name"]');
      var meldung = form.querySelector('.court-hunt-name-meldung');
      var name = feld.value.trim();
      if (name.length < 2) return;

      meldung.textContent = 'Wird gespeichert …';
      fetch(API_BASE + '/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geraeteId: stand.geraeteId, name: name })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (daten) {
          if (!res.ok) throw new Error(typeof daten.detail === 'string' ? daten.detail : 'Das hat nicht geklappt.');
          return daten;
        });
      }).then(function (daten) {
        stand.name = daten.name;
        speichereStand(stand);
        standPanel(el);
        icons();
      }).catch(function (fehler) {
        meldung.textContent = fehler.message;
      });
    });
  }

  /* Einwilligung gehört an den Knopf, nicht zwei Seiten weiter: Wer hier klickt,
     erlaubt zweierlei — den Zugriff auf den Endgerätespeicher (§ 25 TDDDG) und
     die Verarbeitung der Spieldaten (DSGVO). Ohne diesen Satz am Knopf ist die
     Einwilligung nicht informiert. */
  function einwilligungsHinweis() {
    return '<p class="court-hunt-einwilligung">Mit „Mitspielen" erlaubst du, dass dein Spielstand auf deinem ' +
      'Gerät gespeichert (§ 25 TDDDG) und für die Wertung verarbeitet wird (Art. 6 Abs. 1 lit. a DSGVO). ' +
      'Beides gilt nur, bis du deinen Spielstand löschst. Einzelheiten in der ' +
      '<a href="/datenschutz.html#court-hunt">Datenschutzerklärung</a>.</p>';
  }

  /* Der Gewinn haengt an der Geraete-ID: Wer gewonnen hat, erfaehrt es beim
     naechsten Besuch — wir haben ja keine Adresse, an die wir schreiben
     koennten. Genau hier entstehen dann die einzigen personenbezogenen Daten
     des Spiels, und nur weil jemand sie freiwillig einträgt. */
  function gewinnKasten(el, stand) {
    if (!API_BASE || !stand) return;
    fetch(API_BASE + '/me/' + encodeURIComponent(stand.geraeteId))
      .then(function (r) { return r.json(); })
      .then(function (daten) {
        if (!daten.gewinn) return;
        var kasten = document.createElement('div');
        kasten.className = 'court-hunt-gewinn';
        kasten.innerHTML =
          '<h3 class="t-h3">Du hast gewonnen!</h3>' +
          '<p class="t-body mt-2 mb-4">Platz ' + daten.gewinn.rang + ' in der Wertung ' + esc(daten.gewinn.monat) +
          ' mit ' + daten.gewinn.punkte + ' Punkten. Dafür gibt es einen Gutschein für ein Einzelticket ' +
          'bei einem Heimspiel. Sag uns, wohin wir ihn schicken sollen.</p>' +
          '<form data-gewinn-form>' +
            '<div class="melde-feld">' +
              '<label for="gewinn-vorname">Wie sollen wir dich ansprechen?</label>' +
              '<input type="text" id="gewinn-vorname" name="vorname" maxlength="80" required placeholder="Vorname" />' +
            '</div>' +
            '<div class="melde-feld">' +
              '<label for="gewinn-email">An welche Adresse dürfen wir den Gutschein schicken?</label>' +
              '<input type="email" id="gewinn-email" name="email" maxlength="160" required placeholder="name@beispiel.de" />' +
              '<p class="court-hunt-name-regel">Unter 16? Dann trag bitte die Adresse eines Elternteils ein.</p>' +
            '</div>' +
            '<label class="court-hunt-haken"><input type="checkbox" name="newsletter" /> ' +
              'Schickt mir ab und zu Neuigkeiten der Löwen. (freiwillig)</label>' +
            '<p class="court-hunt-name-regel">Vorname und Adresse speichern wir getrennt vom Spielstand, um den ' +
              'Gutschein zuzustellen und die Regel „höchstens zwei Gutscheine je Person und Jahr" einzuhalten. ' +
              'Einzelheiten in der <a href="/datenschutz.html#court-hunt">Datenschutzerklärung</a>.</p>' +
            '<button type="submit" class="btn btn-primary">Gutschein anfordern</button>' +
            '<p class="court-hunt-meldung" role="status" aria-live="polite"></p>' +
          '</form>';
        el.insertBefore(kasten, el.firstChild);
        icons();

        var form = kasten.querySelector('[data-gewinn-form]');
        var meldung = kasten.querySelector('.court-hunt-meldung');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var knopf = form.querySelector('button[type="submit"]');
          knopf.disabled = true;
          meldung.className = 'court-hunt-meldung';
          meldung.textContent = 'Wird gesendet …';

          fetch(API_BASE + '/gewinn/einloesen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              geraeteId: stand.geraeteId,
              vorname: form.vorname.value.trim(),
              email: form.email.value.trim(),
              newsletter: form.newsletter.checked
            })
          }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (d) {
              if (!res.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Das hat nicht geklappt.');
              return d;
            });
          }).then(function () {
            kasten.innerHTML = '<h3 class="t-h3">Ist notiert</h3>' +
              '<p class="t-body mt-2">Dein Gutschein kommt in den nächsten Minuten per E-Mail. ' +
              'Falls nichts ankommt, schau auch im Spam-Ordner nach.</p>';
          }).catch(function (fehler) {
            knopf.disabled = false;
            meldung.className = 'court-hunt-meldung ist-hinweis';
            meldung.textContent = fehler.message;
          });
        });
      }).catch(function () { /* Kein Netz: Der Gewinn wartet beim nächsten Mal. */ });
  }

  function standPanel(el, meldungText, meldungKlasse) {
    var stand = ladeStand();

    if (!speicherVerfuegbar()) {
      el.innerHTML = '<p class="t-body">Dein Browser speichert gerade nichts (privater Modus?) — ' +
        'deshalb können wir deinen Court-Hunt-Stand hier nicht anzeigen.</p>';
      return;
    }

    var meldungHtml = '<p class="court-hunt-meldung' + (meldungKlasse ? ' ' + meldungKlasse : '') +
      '" role="status" aria-live="polite">' + (meldungText || '') + '</p>';

    if (!stand) {
      el.innerHTML =
        '<p class="t-body mb-4">Beim Mitspielen legt dein Gerät eine zufällige Spiel-ID an und merkt sich deinen ' +
        'Punktestand — ohne Konto, ohne Name, ohne E-Mail. Erst wenn du gewinnst, fragen wir nach einer Adresse, ' +
        'um dir den Ticket-Gutschein zu schicken.</p>' +
        '<button type="button" class="btn btn-primary btn-lg" data-court-hunt-checkin>' +
          '<i data-lucide="map-pin-check" class="icon-18"></i> Mitspielen und einchecken</button>' +
        einwilligungsHinweis() +
        meldungHtml;
    } else {
      var heute = tagKey(new Date());
      var serie = serienLaenge(stand, heute);
      var plaetzeBesucht = {};
      stand.checkins.forEach(function (c) { plaetzeBesucht[c.slug] = true; });
      var anzahlPlaetze = Object.keys(plaetzeBesucht).length;

      el.innerHTML =
        '<div class="court-hunt-stand">' +
          '<div class="court-hunt-zahl"><strong>' + stand.punkte + '</strong><span>' + (stand.punkte === 1 ? 'Punkt' : 'Punkte') + '</span></div>' +
          '<div class="court-hunt-zahl"><strong>' + anzahlPlaetze + '</strong><span>' + (anzahlPlaetze === 1 ? 'Platz besucht' : 'Plätze besucht') + '</span></div>' +
          '<div class="court-hunt-zahl"><strong>' + serie + '</strong><span>' + (serie === 1 ? 'Tag in Folge' : 'Tage in Folge') + '</span></div>' +
        '</div>' +
        '<div class="court-hunt-aktionen">' +
          '<button type="button" class="btn btn-primary btn-lg" data-court-hunt-checkin>' +
            '<i data-lucide="map-pin-check" class="icon-18"></i> Hier einchecken</button>' +
        '</div>' +
        meldungHtml +
        namensBereich(stand) +
        '<div class="court-hunt-aktionen">' +
          '<a class="btn btn-ghost" href="/trainieren/court-hunt.html">Rangliste ansehen</a>' +
          '<button type="button" class="btn btn-ghost" data-court-hunt-reset>Meinen Spielstand löschen</button>' +
        '</div>';

      namenVerdrahten(el, stand);

      gewinnKasten(el, stand);

      el.querySelector('[data-court-hunt-reset]').addEventListener('click', function () {
        if (!window.confirm('Punkte, besuchte Plätze und deine Spiel-ID werden gelöscht. Wirklich?')) return;
        loescheStand();
        standPanel(el);
        icons();
      });
    }

    var knopf = el.querySelector('[data-court-hunt-checkin]');
    knopf.addEventListener('click', function () {
      checkeNaechstenEin(knopf, el.querySelector('.court-hunt-meldung'), function (text, klasse) {
        standPanel(el, text, klasse);
        icons();
      });
    });
    icons();
  }

  /* Der Sofort-Check-in: Die Seite kennt alle Plätze, das Handy die Position —
     welcher Platz gemeint ist, ergibt sich daraus von selbst. Deshalb braucht
     es keinen QR-Code am Korb, um mitzuspielen; der Aufkleber ist später nur
     eine zweite Tür ins selbe Spiel. */
  function checkeNaechstenEin(knopf, meldung, fertig) {
    knopf.disabled = true;
    meldung.className = 'court-hunt-meldung';
    meldung.textContent = 'Standort wird geprüft …';

    /* Die laufenden Event-Spots gehoeren mit in die Suche: Wer am Strassenfest
       neben dem mobilen Korb steht, drueckt denselben Knopf wie sonst — er soll
       nicht erst das Schild scannen muessen, um seine 50 Punkte zu bekommen.
       Spots ausserhalb ihres Zeitfensters bleiben draussen, sonst schlaegt die
       Suche einen Platz vor, an dem es heute nichts zu holen gibt. */
    Promise.all([standort(), ladeDaten(), ladeSpots()]).then(function (ergebnisse) {
      var coords = ergebnisse[0];
      var kandidaten = ergebnisse[1].freiplaetze.concat(
        ergebnisse[2].filter(function (sp) { return spotOffen(sp); })
      );
      var liste = naechstePlaetze(coords, kandidaten);
      var naechster = liste[0];

      if (!naechster || !inReichweite(naechster.abstand, coords.accuracy)) {
        knopf.disabled = false;
        meldung.className = 'court-hunt-meldung ist-hinweis';
        meldung.innerHTML = naechster
          ? 'Kein Freiplatz in Reichweite. Am nächsten liegt <a href="' + platzUrl(naechster.platz) + '">' +
            esc(naechster.platz.name) + '</a>, ' + abstandText(naechster.abstand) + ' entfernt.'
          : 'Wir konnten keinen Freiplatz in deiner Nähe finden.';
        return;
      }

      var stand = ladeStand() || starteSpiel();
      if (Date.now() - letzterCheckin(stand, naechster.platz.slug) < COOLDOWN_MS) {
        knopf.disabled = false;
        meldung.className = 'court-hunt-meldung ist-hinweis';
        meldung.textContent = naechster.platz.name + ' hast du gerade erst gezählt — in ein paar Stunden wieder.';
        return;
      }

      var gebucht = bucheCheckin(stand, naechster.platz, Date.now(), coords);
      fertig(erfolgsText(gebucht, stand), 'ist-erfolg');
      /* Der Server ist die zaehlende Instanz — sobald er geantwortet hat, steht
         hier sein Stand statt der eigenen Rechnung. */
      sendeOffene(stand, function (aktualisiert) {
        fertig(erfolgsText(gebucht, aktualisiert), 'ist-erfolg');
      });
    }).catch(function (fehler) {
      knopf.disabled = false;
      meldung.className = 'court-hunt-meldung ist-hinweis';
      meldung.textContent = fehler.message;
    });
  }

  /* ----------------------------------------------------- Seiteneinstiege */

  function nachtragen() {
    var stand = ladeStand();
    if (stand && stand.offen && stand.offen.length) sendeOffene(stand);
  }

  function initUebersicht() {
    nachtragen();
    ladeDaten().then(function (data) {
      var plaetze = data.freiplaetze;
      var offen = plaetze.filter(spielbar);
      var weitere = plaetze.filter(function (f) { return !spielbar(f); });

      var gridOffen = document.getElementById('freiplaetze-grid');
      if (gridOffen) gridOffen.innerHTML = offen.map(kachel).join('');

      var gridWeitere = document.getElementById('freiplaetze-grid-weitere');
      var sektionWeitere = document.getElementById('freiplaetze-weitere');
      if (gridWeitere && sektionWeitere) {
        if (weitere.length) {
          gridWeitere.innerHTML = weitere.map(kachel).join('');
        } else {
          sektionWeitere.hidden = true;
        }
      }

      /* Kommende Spots gehören auf die Karte, vergangene nicht — die Karte soll
         zeigen, wo man hin kann, nicht wo man hätte hingehen können. */
      ladeSpots().then(function (spots) {
        var kommend = spots.filter(function (sp) { return !spotVorbei(sp); });
        zeichneKarte('freiplaetze-map', plaetze.concat(kommend));
        var legende = document.getElementById('freiplaetze-legende-event');
        if (legende) legende.hidden = kommend.length === 0;
        spotListe(document.getElementById('court-hunt-spots'), spots);
        icons();
      });

      var panel = document.getElementById('court-hunt-panel');
      if (panel) standPanel(panel);

      initMeldeformular();
      icons();
    });
  }

  function initPlatzseite() {
    nachtragen();
    /* Zwei Betriebsarten. Auf einer statisch gebauten Platzseite steht der
       Inhalt schon im HTML (tools/build-freiplatz-seiten.py) und der Slug im
       data-Attribut; dort werden nur Karte und Check-in nachgerüstet, denn beide
       brauchen ohnehin JavaScript. Die Hülle freiplatz.html liest weiter
       ?platz= und schreibt alles selbst — sie bedient die Event-Spots. */
    var statisch = document.querySelector('[data-platz-slug]');
    var wurzel = document.getElementById('freiplatz-detail');
    if (!statisch && !wurzel) return;
    var slug = statisch
      ? statisch.getAttribute('data-platz-slug')
      : new URLSearchParams(window.location.search).get('platz');

    Promise.all([ladeDaten(), ladeSpots()]).then(function (beides) {
      var data = beides[0];
      var platz = data.freiplaetze.filter(function (f) { return f.slug === slug; })[0]
        || beides[1].filter(function (sp) { return sp.slug === slug; })[0];
      /* Kein oder unbekannter Parameter: die Detailseite hat ohne Platz keinen
         Inhalt — zurück zur Übersicht statt einer leeren Seite. */
      if (!platz) {
        window.location.replace('/trainieren/freiplaetze.html');
        return;
      }

      if (statisch) {
        zeichneKarte('freiplatz-karte', [platz]);
        checkinBereich(document.getElementById('freiplatz-checkin'), platz);
        icons();
        return;
      }

      /* Hülle mit ?platz= auf einen festen Platz: Der gehört seit dem 25.08.2026
         auf seine eigene Adresse. Weiterleiten statt denselben Inhalt an zwei
         Stellen zu zeigen — und damit bleiben schon gedruckte QR-Codes mit dem
         alten Ziel gültig. */
      if (platz.typ !== 'event') {
        window.location.replace(platzUrl(platz));
        return;
      }

      document.title = platz.name + ' — Basketball Löwen Erfurt';
      var spotZeile = platz.typ === 'event'
        ? '<p class="freiplatz-spot-zeit"><i data-lucide="calendar-clock" class="icon-16"></i> ' +
          (spotVorbei(platz) ? 'Dieser Spot ist vorbei — er galt am ' + esc(spotZeitText(platz)) + '.'
            : (spotOffen(platz) ? 'Jetzt aktiv: ' + esc(spotZeitText(platz)) + ' — 50 Punkte am mobilen Korb.'
              : 'Aktiv am ' + esc(spotZeitText(platz)) + ' — dann gibt es hier 50 Punkte.')) + '</p>'
        : '';
      wurzel.innerHTML =
        '<h1 class="t-h2">' + esc(platz.name) + '</h1>' +
        '<p class="t-body mt-3">' + esc(platz.beschreibung) + '</p>' +
        spotZeile +
        /* Adresse direkt unter die Überschrift: Wer die Seite am Handy öffnet,
           will als Erstes wissen, wo das ist — nicht erst nach dem Foto. */
        '<a class="freiplatz-adresse-link mt-4" href="' + mapsUrl(platz) + '" target="_blank" rel="noopener">' +
          '<i data-lucide="map-pin" class="icon-16"></i> ' + esc(platz.adresse) + '</a>' +
        medienBlock(platz) +
        zugangBanner(platz) +
        zugangDetail(platz) +
        '<div id="freiplatz-karte" class="freiplaetze-map freiplaetze-map-klein"></div>' +
        '<div class="freiplatz-checkin" id="freiplatz-checkin"></div>';
        /* Kein Mängelmelder-Hinweis hier: Der mobile Korb an Event-Spots
           gehoert dem Verein, nicht der Stadt -- anders als bei den festen,
           staedtischen Freiplaetzen (dort weiterhin in build-freiplatz-seiten.py). */

      zeichneKarte('freiplatz-karte', [platz]);
      checkinBereich(document.getElementById('freiplatz-checkin'), platz);
      icons();
    });
  }

  /* Teilen ist hier keine Werbung für eine Website, sondern eine Einladung:
     "Ich bin jetzt hier und zocke, kommt vorbei." Deshalb steht der Button beim
     Check-in und nicht am Seitenende, und der Text ist in der ersten Person
     geschrieben. Geteilt wird nur der Link — keine Punkte, kein Standort. */
  function teilenBlock() {
    return '<div class="freiplatz-teilen">' +
      '<button type="button" class="btn btn-ghost" data-teilen>' +
        '<i data-lucide="share-2" class="icon-16"></i> Freunden Bescheid sagen</button>' +
      '<p class="freiplatz-teilen-status" role="status" aria-live="polite"></p>' +
    '</div>';
  }

  function teilenVerdrahten(el, platz) {
    var knopf = el.querySelector('[data-teilen]');
    if (!knopf) return;
    var rueckmeldung = el.querySelector('.freiplatz-teilen-status');
    var ziel = window.location.origin + platzUrl(platz);
    var text = 'Ich bin gerade am ' + platz.name + ' und spiele. Kommt vorbei!';

    knopf.addEventListener('click', function () {
      if (navigator.share) {
        /* Abbruch durch den Nutzer ist kein Fehler — dann passiert einfach nichts. */
        navigator.share({ title: platz.name, text: text, url: ziel }).catch(function () {});
        return;
      }
      /* Ohne Teilen-Dialog (meist Desktop): Einladung in die Zwischenablage. */
      var kopie = text + ' ' + ziel;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(kopie).then(function () {
          rueckmeldung.textContent = 'Einladung kopiert — jetzt einfügen und abschicken.';
        }).catch(function () {
          rueckmeldung.textContent = kopie;
        });
      } else {
        rueckmeldung.textContent = kopie;
      }
    });
  }

  function checkinBereich(el, platz) {
    if (!el) return;

    if (!spielbar(platz)) {
      // Gesperrte Plaetze nennen Court-Hunt bewusst NICHT (Marko, 26.08.2026).
      // Google hatte fuer "court hunt erfurt" genau diese Seite auf Platz 1
      // gesetzt -- den einzigen Platz, der nicht mitspielt -- und diesen Satz
      // als Snippet gezeigt. Der Begriff brachte hier nichts: An gesperrten
      // Plaetzen haengt kein Court-Hunt-Aufkleber (s. build-freiplatz-qr.py),
      // und dass man nicht hinein kann, sagt der Zugangs-Banner oben. Uebrig
      // blieb nur der Schaden. Der Satz zeigt jetzt weiter, ohne den Begriff.
      el.innerHTML = '<p class="t-body-sm">Hier kannst du keine Punkte sammeln. Alle Plätze, ' +
        'an denen es geht, stehen in der ' +
        '<a href="/trainieren/freiplaetze.html">Übersicht der Freiplätze</a>.</p>' + teilenBlock();
      teilenVerdrahten(el, platz);
      icons();
      return;
    }

    if (platz.typ === 'event' && !spotOffen(platz)) {
      el.innerHTML = '<h2 class="t-h3">Court-Hunt</h2>' +
        '<p class="t-body mt-2">' +
          (spotVorbei(platz)
            ? 'Dieser Spot ist vorbei. Auf den festen Freiplätzen geht es weiter.'
            : 'Der Spot zählt erst am Veranstaltungstag — komm dann mit dem Handy vorbei.') +
        '</p>' +
        '<p class="mt-4"><a class="card-link" href="/trainieren/freiplaetze.html">' +
          'Alle Freiplätze <i data-lucide="arrow-right" class="icon-14"></i></a></p>' + teilenBlock();
      teilenVerdrahten(el, platz);
      icons();
      return;
    }

    var stand = ladeStand();
    var gesperrt = stand && (Date.now() - letzterCheckin(stand, platz.slug) < COOLDOWN_MS);

    el.innerHTML =
      '<h2 class="t-h3">Court-Hunt</h2>' +
      '<p class="t-body mt-2 mb-4">' +
        (stand
          ? 'Dein Stand: <strong>' + stand.punkte + ' Punkte</strong>.' +
            (platz.typ === 'event'
              ? ' Der Check-in am mobilen Korb bringt heute ' + PUNKTE.spot + ' Punkte.'
              : (besucht(stand, platz.slug) ? ' Diesen Platz hast du schon besucht.' : ' Erstbesuch bringt 20 Punkte extra.'))
          : 'Checke hier ein und sammle Punkte. Dein Gerät legt dafür eine zufällige Spiel-ID an — ' +
            'kein Konto, kein Name, keine E-Mail.') +
      '</p>' +
      '<button type="button" class="btn btn-primary btn-lg" data-checkin' + (gesperrt ? ' disabled' : '') + '>' +
        '<i data-lucide="map-pin-check" class="icon-18"></i> ' + (stand ? 'Ich bin hier' : 'Mitspielen und einchecken') + '</button>' +
      (stand ? '' : einwilligungsHinweis()) +
      '<p class="court-hunt-meldung" role="status" aria-live="polite">' +
        (gesperrt ? 'Gerade erst eingecheckt — dieser Platz zählt wieder in ' +
          stunden(COOLDOWN_MS - (Date.now() - letzterCheckin(stand, platz.slug))) + '.' : '') +
      '</p>' +
      '<p class="mt-4"><a class="card-link" href="/trainieren/court-hunt.html">' +
        'Regeln, Punktestand und Rangliste <i data-lucide="arrow-right" class="icon-14"></i></a></p>' +
      teilenBlock();

    teilenVerdrahten(el, platz);
    var knopf = el.querySelector('[data-checkin]');
    var meldung = el.querySelector('.court-hunt-meldung');

    knopf.addEventListener('click', function () {
      knopf.disabled = true;
      meldung.className = 'court-hunt-meldung';
      meldung.textContent = 'Standort wird geprüft …';

      standort().then(function (coords) {
        var abstand = entfernungM(coords.latitude, coords.longitude, platz.lat, platz.lng);
        if (!inReichweite(abstand, coords.accuracy)) {
          knopf.disabled = false;
          meldung.className = 'court-hunt-meldung ist-hinweis';
          meldung.textContent = 'Du bist noch rund ' + abstandText(abstand) + ' entfernt. Der Check-in klappt direkt am Platz.';
          return;
        }
        var aktuell = ladeStand() || starteSpiel();
        if (Date.now() - letzterCheckin(aktuell, platz.slug) < COOLDOWN_MS) {
          meldung.className = 'court-hunt-meldung ist-hinweis';
          meldung.textContent = 'Diesen Platz hast du gerade erst gezählt — in ein paar Stunden wieder.';
          return;
        }
        var gebucht = bucheCheckin(aktuell, platz, Date.now(), coords);
        meldung.className = 'court-hunt-meldung ist-erfolg';
        meldung.textContent = erfolgsText(gebucht, aktuell);
        sendeOffene(aktuell, function (aktualisiert) {
          meldung.textContent = erfolgsText(gebucht, aktualisiert);
        });
      }).catch(function (fehler) {
        knopf.disabled = false;
        meldung.className = 'court-hunt-meldung ist-hinweis';
        meldung.textContent = fehler.message;
      });
    });
  }

  function stunden(ms) {
    var h = Math.ceil(ms / (60 * 60 * 1000));
    return h <= 1 ? 'einer Stunde' : h + ' Stunden';
  }

  /* ------------------------------------------------- Standsseite (Rangliste) */

  function monatsInfo(el) {
    if (!el) return;
    var jetzt = new Date();
    var monat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', month: 'long', year: 'numeric' }).format(jetzt);
    var letzterTag = new Date(jetzt.getFullYear(), jetzt.getMonth() + 1, 0).getDate();
    var rest = letzterTag - jetzt.getDate();
    el.textContent = 'Wertung ' + monat + ' — noch ' +
      (rest === 0 ? 'heute' : rest === 1 ? '1 Tag' : rest + ' Tage') + '.';
  }

  function rangliste(el) {
    if (!el) return;

    if (!API_BASE) {
      el.innerHTML = '<p class="t-body">Die Rangliste geht mit dem Spielstart live. Deine Punkte zählen ab dem ' +
        'ersten Check-in — sie liegen so lange auf deinem Gerät und wandern beim Start in die Wertung.</p>';
      return;
    }

    el.innerHTML = '<p class="t-body">Rangliste wird geladen …</p>';
    var stand = ladeStand();
    var abfrage = stand ? '?ich=' + encodeURIComponent(stand.geraeteId) : '';

    fetch(API_BASE + '/rangliste' + abfrage).then(function (r) { return r.json(); }).then(function (daten) {
      var zeilen = daten.eintraege || [];
      if (!zeilen.length) {
        el.innerHTML = '<p class="t-body">Diesen Monat hat noch niemand eingecheckt. Sei die Erste oder der Erste.</p>';
        return;
      }
      el.innerHTML = '<div class="rangliste-wrap"><table class="rangliste">' +
        '<thead><tr><th>Platz</th><th>Spielername</th><th>Punkte</th></tr></thead><tbody>' +
        zeilen.map(function (z) {
          /* Melden nur bei fremden Zeilen mit Namen — sich selbst zu melden
             ergibt keinen Sinn, und "ohne Namen" gibt es nichts zu melden. */
          var melden = (!z.ich && z.meldeId)
            ? ' <button type="button" class="rangliste-melden" data-melden="' + z.meldeId +
              '" title="Namen melden" aria-label="Spielername ' + esc(z.name) + ' melden">' +
              '<i data-lucide="flag" class="icon-14"></i></button>'
            : '';
          return '<tr' + (z.ich ? ' class="ist-ich"' : '') + '><td>' + z.rang + '</td><td>' +
            esc(z.name) + (z.ich ? ' <span class="rangliste-ich">du</span>' : '') + melden +
            '</td><td>' + z.punkte + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="rangliste-meldung" role="status" aria-live="polite"></p>';

      meldenVerdrahten(el);
    }).catch(function () {
      el.innerHTML = '<p class="t-body">Die Rangliste ist gerade nicht erreichbar. Deine Punkte auf dem Gerät sind davon nicht betroffen.</p>';
    });
  }

  function meldenVerdrahten(el) {
    var rueckmeldung = el.querySelector('.rangliste-meldung');
    [].forEach.call(el.querySelectorAll('[data-melden]'), function (knopf) {
      knopf.addEventListener('click', function () {
        knopf.disabled = true;
        fetch(API_BASE + '/melden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meldeId: knopf.getAttribute('data-melden') })
        }).then(function (res) {
          rueckmeldung.textContent = res.ok
            ? 'Danke — wir schauen uns den Namen an.'
            : 'Das hat gerade nicht geklappt.';
        }).catch(function () {
          rueckmeldung.textContent = 'Das hat gerade nicht geklappt.';
        });
      });
    });
  }

  /* Am Veranstaltungstag gehört der Spot ganz nach oben: Wer die Seite öffnet,
     soll sehen, dass es heute 50 Punkte gibt statt der üblichen 10. */
  function spotBanner(el) {
    if (!el) return;
    ladeSpots().then(function (spots) {
      var heute = spots.filter(function (sp) { return spotOffen(sp); });
      if (!heute.length) {
        var bald = spots.filter(function (sp) { return !spotVorbei(sp); })
          .sort(function (a, b) { return new Date(a.von) - new Date(b.von); })[0];
        if (!bald) return;
        el.innerHTML = '<p class="court-hunt-spot-banner ist-bald">Nächster Spot am mobilen Korb: ' +
          '<a href="' + platzUrl(bald) + '">' + esc(bald.name) + '</a>, ' + esc(spotZeitText(bald)) + '.</p>';
        return;
      }
      el.innerHTML = heute.map(function (sp) {
        return '<p class="court-hunt-spot-banner">Heute vor Ort: <a href="' + platzUrl(sp) + '">' +
          esc(sp.name) + '</a> — 50 Punkte am mobilen Korb, ' + esc(spotZeitText(sp)) + '.</p>';
      }).join('');
    });
  }

  function initStandsseite() {
    nachtragen();
    spotBanner(document.getElementById('court-hunt-spot'));
    monatsInfo(document.getElementById('court-hunt-monat'));
    var panel = document.getElementById('court-hunt-panel');
    if (panel) standPanel(panel);
    rangliste(document.getElementById('court-hunt-rangliste'));
    icons();
  }

  /* ------------------------------------------------- Freiplatz melden */

  var MELDE_WEBHOOK = 'https://poetic-patience-production-9290.up.railway.app/webhook/freiplatz-melden';

  /* Das Meldeformular lag bis 25.08.2026 auf dem allgemeinen Feedback-Widget.
     Fuer die Meldepraemie braucht es aber eigene Felder: Standort, Foto und die
     Spiel-ID des Melders — ohne die koennen wir die 100 Punkte niemandem
     gutschreiben. */
  function initMeldeformular() {
    var knopf = document.getElementById('freiplatz-melden-btn');
    var form = document.getElementById('freiplatz-melden-form');
    if (!knopf || !form) return;

    var standort_ = null;
    var foto = null;
    var status = form.querySelector('.melde-standort-status');
    var meldung = form.querySelector('.melde-meldung');
    var punkteHinweis = form.querySelector('[data-melde-punkte]');

    knopf.addEventListener('click', function () {
      form.hidden = false;
      knopf.hidden = true;
      var stand = ladeStand();
      punkteHinweis.hidden = false;
      punkteHinweis.textContent = stand
        ? 'Deine Spiel-ID hängt an der Meldung — schalten wir den Platz frei, landen die 100 Punkte auf deinem Stand.'
        : 'Du spielst noch nicht mit. Melden kannst du den Platz trotzdem; die 100 Punkte gibt es nur mit Spielstand.';
      form.querySelector('#melde-platz').focus();
      icons();
    });

    form.querySelector('[data-melde-standort]').addEventListener('click', function () {
      status.textContent = 'Standort wird geholt …';
      standort().then(function (coords) {
        standort_ = coords;
        status.textContent = 'Standort übernommen (auf etwa ' +
          Math.round(coords.accuracy || 0) + ' m genau).';
      }).catch(function (fehler) {
        status.textContent = fehler.message + ' Schreib die Lage einfach ins Adressfeld.';
      });
    });

    var fotoFeld = form.querySelector('#melde-foto');
    fotoFeld.addEventListener('change', function () {
      var datei = fotoFeld.files && fotoFeld.files[0];
      form.querySelector('[data-melde-fotoname]').textContent = datei ? datei.name : 'Foto anhängen (optional)';
      foto = datei || null;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var beschreibung = form.querySelector('#melde-beschreibung').value.trim();
      var adresse = form.querySelector('#melde-adresse').value.trim();
      if (!beschreibung && !adresse && !standort_) {
        meldung.className = 'melde-meldung ist-hinweis';
        meldung.textContent = 'Wir brauchen wenigstens die Lage: Adresse eintragen oder Standort übernehmen.';
        return;
      }

      var senden = form.querySelector('button[type="submit"]');
      senden.disabled = true;
      senden.textContent = 'Wird gesendet …';
      meldung.className = 'melde-meldung';
      meldung.textContent = '';

      var stand = ladeStand();
      var daten = {
        platz: form.querySelector('#melde-platz').value.trim(),
        adresse: adresse,
        beschreibung: beschreibung,
        lat: standort_ ? Math.round(standort_.latitude * 100000) / 100000 : '',
        lng: standort_ ? Math.round(standort_.longitude * 100000) / 100000 : '',
        geraeteId: stand ? stand.geraeteId : ''
      };

      function abschicken() {
        fetch(MELDE_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(daten)
        }).then(function (res) {
          /* Bewusst nicht nur auf den Statuscode schauen: Bricht der Workflow
             hinter dem Webhook ab, antwortet n8n trotzdem mit 200 und leerem
             Body. Nur die ausdrueckliche Bestaetigung zaehlt als Erfolg. */
          return res.json().catch(function () { return {}; });
        }).then(function (antwort) {
          if (!antwort.ok) throw new Error('Der Server hat die Meldung nicht bestätigt.');
          form.reset();
          form.hidden = true;
          knopf.hidden = false;
          knopf.textContent = 'Noch einen Freiplatz melden';
          meldung.className = 'melde-meldung ist-erfolg';
          meldung.textContent = 'Danke! Wir schauen uns den Platz an. Sobald er freigeschaltet ist, ' +
            (stand ? 'bekommst du 100 Punkte.' : 'steht er hier in der Übersicht.');
          form.parentNode.appendChild(meldung);
        }).catch(function () {
          senden.disabled = false;
          senden.textContent = 'Meldung abschicken';
          meldung.className = 'melde-meldung ist-hinweis';
          meldung.textContent = 'Senden hat nicht geklappt — bitte später noch einmal versuchen.';
        });
      }

      if (!foto) { abschicken(); return; }
      var leser = new FileReader();
      leser.onload = function () {
        daten.fotoBase64 = String(leser.result).split(',')[1];
        daten.fotoName = foto.name;
        daten.fotoType = foto.type || 'image/jpeg';
        abschicken();
      };
      leser.onerror = function () { abschicken(); };
      leser.readAsDataURL(foto);
    });
  }

  window.Freiplaetze = {
    initUebersicht: initUebersicht,
    initPlatzseite: initPlatzseite,
    initStandsseite: initStandsseite
  };

  window.CourtHunt = {
    ladeStand: ladeStand,
    loescheStand: loescheStand,
    starteSpiel: starteSpiel,
    serienLaenge: serienLaenge,
    tagKey: tagKey,
    punkte: PUNKTE,
    apiBase: function () { return API_BASE; }
  };
})();
