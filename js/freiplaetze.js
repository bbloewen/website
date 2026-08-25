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

  var DATA_URL = '/data/freiplaetze.json?v=1787609465';

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
  var PUNKTE = { checkin: 10, erstbesuch: 20, serie: 30 };
  var SERIE_INTERVALL = 3;

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
  function bucheCheckin(stand, platz, jetzt, coords) {
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

    Promise.all([standort(), ladeDaten()]).then(function (ergebnisse) {
      var coords = ergebnisse[0];
      var liste = naechstePlaetze(coords, ergebnisse[1].freiplaetze);
      var naechster = liste[0];

      if (!naechster || !inReichweite(naechster.abstand, coords.accuracy)) {
        knopf.disabled = false;
        meldung.className = 'court-hunt-meldung ist-hinweis';
        meldung.innerHTML = naechster
          ? 'Kein Freiplatz in Reichweite. Am nächsten liegt <a href="' + platzUrl(naechster.platz.slug) + '">' +
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

      zeichneKarte('freiplaetze-map', plaetze);

      var panel = document.getElementById('court-hunt-panel');
      if (panel) standPanel(panel);

      initMeldeformular();
      icons();
    });
  }

  function initPlatzseite() {
    nachtragen();
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
        zugangDetail(platz) +
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
    var gesperrt = stand && (Date.now() - letzterCheckin(stand, platz.slug) < COOLDOWN_MS);

    el.innerHTML =
      '<h2 class="t-h3">Court-Hunt</h2>' +
      '<p class="t-body mt-2 mb-4">' +
        (stand
          ? 'Dein Stand: <strong>' + stand.punkte + ' Punkte</strong>.' +
            (besucht(stand, platz.slug) ? ' Diesen Platz hast du schon besucht.' : ' Erstbesuch bringt 20 Punkte extra.')
          : 'Checke hier ein und sammle Punkte. Dein Gerät legt dafür eine zufällige Spiel-ID an — ' +
            'kein Konto, kein Name, keine E-Mail.') +
      '</p>' +
      '<button type="button" class="btn btn-primary btn-lg" data-checkin' + (gesperrt ? ' disabled' : '') + '>' +
        '<i data-lucide="map-pin-check" class="icon-18"></i> ' + (stand ? 'Ich bin hier' : 'Mitspielen und einchecken') + '</button>' +
      '<p class="court-hunt-meldung" role="status" aria-live="polite">' +
        (gesperrt ? 'Gerade erst eingecheckt — dieser Platz zählt wieder in ' +
          stunden(COOLDOWN_MS - (Date.now() - letzterCheckin(stand, platz.slug))) + '.' : '') +
      '</p>';

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
          return '<tr' + (z.ich ? ' class="ist-ich"' : '') + '><td>' + z.rang + '</td><td>' +
            esc(z.name) + (z.ich ? ' <span class="rangliste-ich">du</span>' : '') +
            '</td><td>' + z.punkte + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function () {
      el.innerHTML = '<p class="t-body">Die Rangliste ist gerade nicht erreichbar. Deine Punkte auf dem Gerät sind davon nicht betroffen.</p>';
    });
  }

  function initStandsseite() {
    nachtragen();
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
