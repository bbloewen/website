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

  var DATA_URL = '/data/freiplaetze.json?v=1787261100';

  /* Railway-URL des Court-Hunt-Service, sobald er steht (Phase 3). */
  var API_BASE = '';

  var STORAGE_KEY = 'loewen-court-hunt';
  var RADIUS_M = 200;
  var COOLDOWN_MS = 24 * 60 * 60 * 1000;
  var PUNKTE = { checkin: 10, erstbesuch: 20, serie3: 30, serie7: 100 };

  /* ---------------------------------------------------------------- Daten */

  var datenPromise = null;

  function ladeDaten() {
    if (!datenPromise) {
      datenPromise = fetch(DATA_URL).then(function (r) { return r.json(); });
    }
    return datenPromise;
  }

  function platzUrl(slug) {
    return '/trainieren/freiplatz.html?platz=' + encodeURIComponent(slug);
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
  function bucheCheckin(stand, platz, jetzt) {
    var gutschrift = [];
    var punkte = PUNKTE.checkin;
    gutschrift.push({ text: 'Check-in ' + platz.name, punkte: PUNKTE.checkin });

    if (!besucht(stand, platz.slug)) {
      punkte += PUNKTE.erstbesuch;
      gutschrift.push({ text: 'Erstbesuch', punkte: PUNKTE.erstbesuch });
    }

    stand.checkins.push({ slug: platz.slug, ts: jetzt });

    var heute = tagKey(new Date(jetzt));
    var serie = serienLaenge(stand, heute);
    [[3, PUNKTE.serie3], [7, PUNKTE.serie7]].forEach(function (paar) {
      var schluessel = 'serie' + paar[0] + ':' + heute;
      if (serie === paar[0] && stand.boni.indexOf(schluessel) < 0) {
        stand.boni.push(schluessel);
        punkte += paar[1];
        gutschrift.push({ text: paar[0] + ' Tage in Folge', punkte: paar[1] });
      }
    });

    stand.punkte += punkte;
    stand.offen.push({ slug: platz.slug, ts: jetzt });
    speichereStand(stand);
    sendeOffene(stand);
    return { punkte: punkte, gutschrift: gutschrift, serie: serie };
  }

  function sendeOffene(stand) {
    if (!API_BASE || !stand.offen.length) return;
    var pakete = stand.offen.slice();
    Promise.all(pakete.map(function (c) {
      return fetch(API_BASE + '/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geraeteId: stand.geraeteId, slug: c.slug, ts: c.ts, lat: c.lat, lng: c.lng })
      }).then(function (res) { return res.ok ? c : null; });
    })).then(function (erledigt) {
      var weg = erledigt.filter(Boolean);
      stand.offen = stand.offen.filter(function (c) { return weg.indexOf(c) < 0; });
      speichereStand(stand);
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

  function kachel(f) {
    return '<div class="card freiplatz-card">' + medienBlock(f) + zugangBanner(f) +
      '<div class="card-body">' +
        '<h3>' + esc(f.name) + '</h3>' +
        '<p>' + esc(f.beschreibung) + '</p>' +
        '<a class="freiplatz-adresse-link" href="' + mapsUrl(f) + '" target="_blank" rel="noopener">' +
          '<i data-lucide="map-pin" class="icon-16"></i> ' + esc(f.adresse) + '</a>' +
        '<a class="card-link" href="' + platzUrl(f.slug) + '">' +
          (spielbar(f) ? 'Platz öffnen und einchecken' : 'Platz ansehen') +
          ' <i data-lucide="arrow-right" class="icon-14"></i></a>' +
      '</div>' +
    '</div>';
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
        className: 'freiplatz-pin' + (eingeschraenkt ? ' freiplatz-pin-eingeschraenkt' : ''),
        html: '<span></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
      });
      var popup = '<strong>' + esc(f.name) + '</strong><br>' + esc(f.adresse);
      if (eingeschraenkt) {
        popup += '<br><span class="freiplatz-popup-hinweis">' + esc(f.zugangHinweis || 'Zugang eingeschränkt') + '</span>';
      }
      popup += '<br><a href="' + platzUrl(f.slug) + '">Zum Platz</a>';
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

  function standPanel(el) {
    var stand = ladeStand();

    if (!speicherVerfuegbar()) {
      el.innerHTML = '<p class="t-body">Dein Browser speichert gerade nichts (privater Modus?) — ' +
        'deshalb können wir deinen Court-Hunt-Stand hier nicht anzeigen.</p>';
      return;
    }

    if (!stand) {
      el.innerHTML =
        '<p class="t-body mb-4">Beim Mitspielen legt dein Gerät eine zufällige Spiel-ID an und merkt sich deinen ' +
        'Punktestand — ohne Konto, ohne Name, ohne E-Mail. Erst wenn du gewinnst, fragen wir nach einer Adresse, ' +
        'um dir den Ticket-Gutschein zu schicken.</p>' +
        '<button type="button" class="btn btn-primary" data-court-hunt-start>Mitspielen</button>';
      el.querySelector('[data-court-hunt-start]').addEventListener('click', function () {
        starteSpiel();
        standPanel(el);
        icons();
      });
      return;
    }

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
        '<a class="btn btn-primary" href="/trainieren/court-hunt.html">Rangliste ansehen</a>' +
        '<button type="button" class="btn btn-ghost" data-court-hunt-reset>Meinen Spielstand löschen</button>' +
      '</div>';

    el.querySelector('[data-court-hunt-reset]').addEventListener('click', function () {
      if (!window.confirm('Punkte, besuchte Plätze und deine Spiel-ID werden gelöscht. Wirklich?')) return;
      loescheStand();
      standPanel(el);
      icons();
    });
  }

  /* ----------------------------------------------------- Seiteneinstiege */

  function initUebersicht() {
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

      zeichneKarte('freiplaetze-map', plaetze);

      var panel = document.getElementById('court-hunt-panel');
      if (panel) standPanel(panel);

      icons();
    });
  }

  function initPlatzseite() {
    var slug = new URLSearchParams(window.location.search).get('platz');
    var wurzel = document.getElementById('freiplatz-detail');
    if (!wurzel) return;

    ladeDaten().then(function (data) {
      var platz = data.freiplaetze.filter(function (f) { return f.slug === slug; })[0];
      /* Kein oder unbekannter Parameter: die Detailseite hat ohne Platz keinen
         Inhalt — zurück zur Übersicht statt einer leeren Seite. */
      if (!platz) {
        window.location.replace('/trainieren/freiplaetze.html');
        return;
      }

      document.title = platz.name + ' — Basketball Löwen Erfurt';
      wurzel.innerHTML =
        '<h1 class="t-h2">' + esc(platz.name) + '</h1>' +
        '<p class="t-body mt-3">' + esc(platz.beschreibung) + '</p>' +
        medienBlock(platz) +
        zugangBanner(platz) +
        '<a class="freiplatz-adresse-link mt-4" href="' + mapsUrl(platz) + '" target="_blank" rel="noopener">' +
          '<i data-lucide="map-pin" class="icon-16"></i> ' + esc(platz.adresse) + '</a>' +
        '<div id="freiplatz-karte" class="freiplaetze-map freiplaetze-map-klein"></div>' +
        '<div class="freiplatz-checkin" id="freiplatz-checkin"></div>' +
        '<p class="mt-5"><a class="card-link" href="/trainieren/freiplaetze.html">' +
          '<i data-lucide="arrow-left" class="icon-14"></i> Alle Freiplätze</a></p>';

      zeichneKarte('freiplatz-karte', [platz]);
      checkinBereich(document.getElementById('freiplatz-checkin'), platz);
      icons();
    });
  }

  function checkinBereich(el, platz) {
    if (!el) return;

    if (!spielbar(platz)) {
      el.innerHTML = '<p class="t-body-sm">Dieser Platz gehört nicht zum Court-Hunt — er ist nicht frei zugänglich, ' +
        'deshalb gibt es hier keine Punkte. Auf allen öffentlichen Plätzen kannst du mitspielen.</p>';
      return;
    }

    var stand = ladeStand();
    if (!stand) {
      el.innerHTML =
        '<h2 class="t-h3">Court-Hunt</h2>' +
        '<p class="t-body mt-2 mb-4">Checke an diesem Platz ein und sammle Punkte. Dein Gerät legt dafür eine ' +
        'zufällige Spiel-ID an — kein Konto, kein Name, keine E-Mail.</p>' +
        '<button type="button" class="btn btn-primary" data-start>Mitspielen und einchecken</button>' +
        '<p class="court-hunt-meldung" role="status" aria-live="polite"></p>';
      el.querySelector('[data-start]').addEventListener('click', function () {
        starteSpiel();
        checkinBereich(el, platz);
        icons();
        var knopf = el.querySelector('[data-checkin]');
        if (knopf) knopf.click();
      });
      return;
    }

    var offenSeit = Date.now() - letzterCheckin(stand, platz.slug);
    var gesperrt = offenSeit < COOLDOWN_MS;

    el.innerHTML =
      '<h2 class="t-h3">Court-Hunt</h2>' +
      '<p class="t-body mt-2 mb-4">Dein Stand: <strong>' + stand.punkte + ' Punkte</strong>.' +
        (besucht(stand, platz.slug) ? ' Diesen Platz hast du schon besucht.' : ' Erstbesuch bringt 20 Punkte extra.') +
      '</p>' +
      '<button type="button" class="btn btn-primary" data-checkin' + (gesperrt ? ' disabled' : '') + '>' +
        '<i data-lucide="map-pin-check" class="icon-16"></i> Ich bin hier</button>' +
      '<p class="court-hunt-meldung" role="status" aria-live="polite">' +
        (gesperrt ? 'Heute schon eingecheckt — dieser Platz zählt wieder in ' + stunden(COOLDOWN_MS - offenSeit) + '.' : '') +
      '</p>';

    var knopf = el.querySelector('[data-checkin]');
    var meldung = el.querySelector('.court-hunt-meldung');

    knopf.addEventListener('click', function () {
      knopf.disabled = true;
      meldung.className = 'court-hunt-meldung';
      meldung.textContent = 'Standort wird geprüft …';

      standort().then(function (coords) {
        var abstand = entfernungM(coords.latitude, coords.longitude, platz.lat, platz.lng);
        if (abstand > RADIUS_M) {
          knopf.disabled = false;
          meldung.className = 'court-hunt-meldung ist-hinweis';
          meldung.textContent = 'Du bist noch rund ' + abstand + ' m entfernt. Der Check-in klappt direkt am Platz.';
          return;
        }
        var aktuell = ladeStand();
        if (Date.now() - letzterCheckin(aktuell, platz.slug) < COOLDOWN_MS) {
          meldung.className = 'court-hunt-meldung ist-hinweis';
          meldung.textContent = 'Diesen Platz hast du heute schon gezählt — morgen wieder.';
          return;
        }
        var ergebnis = bucheCheckin(aktuell, platz, Date.now());
        meldung.className = 'court-hunt-meldung ist-erfolg';
        meldung.textContent = '+' + ergebnis.punkte + ' Punkte: ' +
          ergebnis.gutschrift.map(function (g) { return g.text; }).join(', ') +
          '. Neuer Stand: ' + aktuell.punkte + ' Punkte.';
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
    fetch(API_BASE + '/leaderboard').then(function (r) { return r.json(); }).then(function (daten) {
      var zeilen = (daten.eintraege || []);
      if (!zeilen.length) {
        el.innerHTML = '<p class="t-body">Diesen Monat hat noch niemand eingecheckt. Sei die Erste oder der Erste.</p>';
        return;
      }
      el.innerHTML = '<div class="rangliste-wrap"><table class="rangliste"><thead><tr><th>Platz</th><th>Spielername</th><th>Punkte</th></tr></thead><tbody>' +
        zeilen.map(function (z, i) {
          var ich = stand && z.geraeteId === stand.geraeteId;
          return '<tr' + (ich ? ' class="ist-ich"' : '') + '><td>' + (i + 1) + '</td><td>' +
            esc(z.name || 'ohne Namen') + (ich ? ' <span class="rangliste-ich">du</span>' : '') +
            '</td><td>' + z.punkte + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function () {
      el.innerHTML = '<p class="t-body">Die Rangliste ist gerade nicht erreichbar. Deine Punkte auf dem Gerät sind davon nicht betroffen.</p>';
    });
  }

  function initStandsseite() {
    monatsInfo(document.getElementById('court-hunt-monat'));
    var panel = document.getElementById('court-hunt-panel');
    if (panel) standPanel(panel);
    rangliste(document.getElementById('court-hunt-rangliste'));
    icons();
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
