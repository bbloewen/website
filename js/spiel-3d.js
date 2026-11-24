// Basketball Löwen Erfurt: Best-of in 3D, nachgestellt aus den Liveticker-Daten der Liga (Prototyp 24.11.2026).
// Daten: /data/spiel-3d/<spiel>.json aus tools/build-spiel-3d.py. Wurfposition, Wurfart, Werfer, Vorlage,
// Ergebnis und Spielstand stammen aus dem Ticker; Laufwege und Bewegungen sind animiert.
// Einheiten: Meter. Ursprung = Boden unter der Korbmitte, x quer, z ins Feld, y nach oben.

const BOX = document.querySelector('[data-spiel-3d]');
if (BOX) {
  const start = () => import('/js/vendor/three.module.min.js?v=0160').then((T) => los(T, BOX)).catch(fehler);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
    io.observe(BOX);
  } else start();
}

function fehler(e) {
  console.warn('spiel-3d:', e);
  BOX.classList.add('spiel-3d-ohne');
}

const FARBE = { orange: 0xe5710b, navy: 0x00122d, blau: 0x0028aa, holz: '#d8a465', gegner: 0x7b8496, puppe: 0xd9d4cc };
const RING_H = 3.05;
const RING_R = 0.225;
const KORB = { x: 0, z: 0 };
const ART_TEXT = { dreier: 'Dreier', sprungwurf: 'Sprungwurf', korbleger: 'Korbleger', dunk: 'Dunk', alleyoop: 'Alley-Oop', tipin: 'Tip-In' };
const reduziert = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function los(T, box) {
  // data-spiel-3d: Bindestrich vor Ziffer wird in dataset nicht umgewandelt, daher getAttribute
  const daten = await (await fetch(box.getAttribute('data-spiel-3d'), { cache: 'no-cache' })).json();
  if (!daten.highlights || !daten.highlights.length) throw new Error('keine Highlights');

  // ---------- DOM ----------
  const buehne = box.querySelector('.spiel-3d-buehne');
  buehne.innerHTML = `
    <canvas class="spiel-3d-canvas" aria-hidden="true"></canvas>
    <div class="spiel-3d-tafel" aria-live="off">
      <span class="t-team">Löwen</span><b class="t-l">0</b><span class="t-dp">:</span><b class="t-g">0</b><span class="t-team">${esc(kurz(daten.gegner))}</span>
      <span class="t-zeit"></span>
    </div>
    <div class="spiel-3d-titel"></div>
    <div class="spiel-3d-plus" aria-hidden="true"></div>
    <div class="spiel-3d-steuerung">
      <button type="button" class="s3-btn" data-a="zurueck" aria-label="Vorherige Szene">‹</button>
      <button type="button" class="s3-btn s3-play" data-a="play" aria-label="Abspielen">▶ Abspielen</button>
      <button type="button" class="s3-btn" data-a="weiter" aria-label="Nächste Szene">›</button>
      <button type="button" class="s3-btn s3-karte" data-a="karte" aria-pressed="false">Wurfkarte</button>
    </div>
    <p class="spiel-3d-hinweis">Nachgestellt aus den Liveticker-Daten: Werfer, Wurfposition, Wurfart und Spielstand stimmen, die Bewegungen sind animiert.</p>`;
  const canvas = buehne.querySelector('canvas');
  const elL = buehne.querySelector('.t-l'), elG = buehne.querySelector('.t-g'), elZeit = buehne.querySelector('.t-zeit');
  const elTitel = buehne.querySelector('.spiel-3d-titel'), elPlus = buehne.querySelector('.spiel-3d-plus');
  const knopfPlay = buehne.querySelector('[data-a="play"]'), knopfKarte = buehne.querySelector('[data-a="karte"]');
  const liste = box.querySelector('.spiel-3d-liste');
  const listeKnoepfe = [];
  if (liste) {
    [...liste.querySelectorAll('li')].forEach((li, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'spiel-3d-szene';
      b.innerHTML = li.innerHTML;
      b.addEventListener('click', () => { zeigeSzene(i, true); });
      li.innerHTML = '';
      li.appendChild(b);
      listeKnoepfe.push(b);
    });
  }

  // ---------- Szene ----------
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const szene = new T.Scene();
  szene.background = new T.Color(0x07102a);
  szene.fog = new T.Fog(0x07102a, 22, 48);
  const kamera = new T.PerspectiveCamera(42, 16 / 9, 0.1, 120);

  szene.add(new T.HemisphereLight(0xdfe8ff, 0x3a2a18, 0.9));
  const sonne = new T.DirectionalLight(0xffffff, 1.6);
  sonne.position.set(4, 14, 8);
  sonne.castShadow = true;
  sonne.shadow.mapSize.set(1024, 1024);
  Object.assign(sonne.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  szene.add(sonne);
  const spot = new T.SpotLight(0xffe2c0, 30, 30, 0.6, 0.6);
  spot.position.set(0, 12, 2);
  spot.target.position.set(0, 0, 1);
  szene.add(spot, spot.target);

  szene.add(baueFeld(T));
  szene.add(baueKorb(T));
  szene.add(baueHalle(T));

  const ball = new T.Mesh(new T.SphereGeometry(0.12, 24, 16), new T.MeshStandardMaterial({ map: ballTextur(T), roughness: 0.7 }));
  ball.castShadow = true;
  szene.add(ball);

  const figuren = {
    werfer: baueFigur(T), vorlage: baueFigur(T), verteidiger: baueFigur(T),
  };
  Object.values(figuren).forEach((f) => szene.add(f.wurzel));

  // Wurfkarte: alle Würfe der Löwen als Punkte auf dem Boden
  const karte = new T.Group();
  const trefferMat = new T.MeshBasicMaterial({ color: FARBE.orange });
  const danebenMat = new T.MeshBasicMaterial({ color: FARBE.navy });
  const randMat = new T.MeshBasicMaterial({ color: 0xffffff });
  let tr = 0, alle = 0;
  daten.wuerfe.filter((w) => w.team === 'loewen').forEach((w) => {
    alle++;
    const treffer = w.ergebnis === 'treffer';
    if (treffer) tr++;
    const m = new T.Mesh(treffer ? new T.CircleGeometry(0.2, 24) : new T.RingGeometry(0.13, 0.2, 24), treffer ? trefferMat : danebenMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(w.x, 0.015, w.z);
    karte.add(m);
    if (treffer) { // weißer Rand, damit Treffer auch in der orangefarbenen Zone sichtbar sind
      const r = new T.Mesh(new T.RingGeometry(0.2, 0.25, 24), randMat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(w.x, 0.016, w.z);
      karte.add(r);
    }
  });
  karte.visible = false;
  szene.add(karte);

  // ---------- Ablauf ----------
  let szenen = daten.highlights.map(planeSzene);
  let aktuell = -1, t0 = 0, laeuft = false, kartenModus = false, sichtbar = true, letzteZeit = 0;

  function zeigeSzene(i, sofortStarten) {
    kartenModus = false;
    karte.visible = false;
    knopfKarte.setAttribute('aria-pressed', 'false');
    aktuell = (i + szenen.length) % szenen.length;
    t0 = performance.now();
    listeKnoepfe.forEach((b, j) => b.classList.toggle('ist-aktiv', j === aktuell));
    const s = szenen[aktuell];
    elTitel.innerHTML = `<span class="s3-art">${esc(ART_TEXT[s.w.art] || 'Wurf')}${s.w.grund && s.w.grund.length ? ' · ' + esc(s.w.grund.join(', ')) : ''}</span>
      <span class="s3-name">${esc(s.hauptName)}</span>${s.nebenText ? `<span class="s3-neben">${esc(s.nebenText)}</span>` : ''}`;
    elZeit.textContent = `${viertel(s.w.viertel)} · ${uhr(s.w.rest)}`;
    if (sofortStarten) spielen(true);
  }

  function spielen(an) {
    laeuft = an;
    knopfPlay.textContent = an ? '❚❚ Pause' : '▶ Abspielen';
    knopfPlay.setAttribute('aria-label', an ? 'Pause' : 'Abspielen');
    if (an && aktuell < 0) zeigeSzene(0, false);
    if (an) t0 = performance.now() - letzteZeit * 1000;
  }

  buehne.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'play') spielen(!laeuft);
    if (a.dataset.a === 'weiter') zeigeSzene(aktuell + 1, true);
    if (a.dataset.a === 'zurueck') zeigeSzene(aktuell - 1, true);
    if (a.dataset.a === 'karte') {
      kartenModus = !kartenModus;
      karte.visible = kartenModus;
      a.setAttribute('aria-pressed', String(kartenModus));
      if (kartenModus) {
        spielen(false);
        elTitel.innerHTML = `<span class="s3-art">Wurfkarte</span><span class="s3-name">Alle Würfe der Löwen</span>
          <span class="s3-neben">${tr} von ${alle} getroffen (ohne Freiwürfe) · orange = Treffer, dunkler Ring = daneben</span>`;
        elZeit.textContent = 'Endstand';
        setzeStand(daten.endstand[0], daten.endstand[1]);
      }
    }
  });

  function setzeStand(l, g) { elL.textContent = l; elG.textContent = g; }

  // ---------- Größe ----------
  function groesse() {
    const b = buehne.clientWidth;
    // Handy: fast quadratisch, sonst bleibt neben Spielstand, Titel und Knöpfen kaum Bild übrig
    const h = Math.round(b < 640 ? Math.min(b * 1.05, window.innerHeight * 0.66) : Math.min(b * 9 / 16, window.innerHeight * 0.72));
    renderer.setSize(b, h, false);
    canvas.style.height = h + 'px';
    kamera.aspect = b / h;
    kamera.updateProjectionMatrix();
  }
  groesse();
  window.addEventListener('resize', groesse);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((e) => { sichtbar = e.some((x) => x.isIntersecting); }).observe(buehne);
  }

  // Startbild: Halle von oben-schräg, erste Szene vorbereitet
  zeigeSzene(0, false);
  setzeStand(...szenen[0].vorher);
  if (!reduziert) spielen(true);

  const ziel = new T.Vector3();
  function schleife(jetzt) {
    requestAnimationFrame(schleife);
    if (!sichtbar) return;
    if (kartenModus) {
      Object.values(figuren).forEach((f) => { f.wurzel.visible = false; });
      ball.visible = false;
      const w = jetzt / 9000;
      kamera.position.set(Math.sin(w) * (reduziert ? 0 : 2.5), 15, 10.5);
      kamera.lookAt(0, 0, 4.2);
      renderer.render(szene, kamera);
      return;
    }
    ball.visible = true;
    const s = szenen[aktuell];
    let t = laeuft ? (jetzt - t0) / 1000 : letzteZeit;
    if (laeuft && t > s.dauer) {
      zeigeSzene(aktuell + 1, false);
      t = 0;
    }
    letzteZeit = t;
    s.anwenden(t, ziel);
    renderer.render(szene, kamera);
  }
  requestAnimationFrame(schleife);

  // ---------- Szenenplanung ----------
  function planeSzene(w) {
    const loewenWirft = w.team === 'loewen';
    const blockSzene = w.ergebnis === 'geblockt';
    const werferFarbe = loewenWirft ? FARBE.orange : FARBE.gegner;
    const vertFarbe = loewenWirft ? FARBE.gegner : FARBE.orange;
    const fW = figuren.werfer, fV = figuren.vorlage, fD = figuren.verteidiger;

    const P = new T.Vector3(clamp(w.x, -7.2, 7.2), 0, clamp(w.z, -1.2, 11.5));
    const zumKorb = new T.Vector3(KORB.x - P.x, 0, KORB.z - P.z);
    let dist = zumKorb.length();
    if (dist < 0.35) { zumKorb.set(0, 0, -1); dist = 0.35; }
    const dir = zumKorb.clone().normalize();
    const quer = new T.Vector3(dir.z, 0, -dir.x);
    if (quer.z < 0) quer.multiplyScalar(-1);
    const fliegt = ['korbleger', 'dunk', 'alleyoop'].includes(w.art);

    // Absprungpunkt und Anlauf
    const absprung = w.art === 'dunk' || w.art === 'alleyoop'
      ? new T.Vector3(-dir.x * 1.25, 0, -dir.z * 1.25).add(new T.Vector3(KORB.x, 0, KORB.z))
      : P.clone();
    if (w.art === 'dunk' || w.art === 'alleyoop') {
      // Anflugrichtung aus der Wurfposition; liegt die direkt unterm Korb, von vorn
      const a = new T.Vector3(P.x, 0, Math.max(P.z, 0.6)).normalize();
      absprung.set(a.x * 1.25, 0, a.z * 1.25);
      dir.set(-a.x, 0, -a.z);
      quer.set(dir.z, 0, -dir.x);
      if (quer.z < 0) quer.multiplyScalar(-1);
    }
    const anlaufStart = fliegt ? absprung.clone().addScaledVector(dir, -4.2) : P.clone();
    begrenze(anlaufStart);

    // Vorlage: Mitspieler am Perimeter auf der anderen Seite
    const hatVorlage = !!w.vorlage;
    const vorlagePos = new T.Vector3();
    if (hatVorlage) {
      const winkel = Math.atan2(anlaufStart.x, Math.max(anlaufStart.z, 0.5)) + (anlaufStart.x > 0 ? -1.3 : 1.3);
      vorlagePos.set(Math.sin(winkel) * 6.2, 0, Math.cos(winkel) * 6.2);
      begrenze(vorlagePos);
    }

    // Verteidiger: zwischen Werfer und Korb, bei Dunks seitlich überlaufen
    const vertPos = (fliegt ? absprung.clone().addScaledVector(quer, 1.2) : P.clone().addScaledVector(dir, 1.0));

    // Zeitplan
    const tFang = hatVorlage ? 1.5 : 0.6;     // Ball beim Werfer
    const tAnlaufEnde = fliegt ? tFang + 1.1 : tFang;
    const tAbsprung = tAnlaufEnde + (fliegt ? 0 : 0.45);
    const sprung = w.art === 'dunk' || w.art === 'alleyoop' ? 0.95 : w.art === 'korbleger' ? 0.65 : w.art === 'tipin' ? 0.7 : 0.48;
    const tScheitel = tAbsprung + 0.42;
    const tAbwurf = w.art === 'dunk' || w.art === 'alleyoop' ? tScheitel : tAbsprung + 0.34;
    const wurfWeite = Math.max(dist, 1);
    const flugDauer = (w.art === 'dunk' || w.art === 'alleyoop') ? 0.25 : 0.75 + wurfWeite * 0.055;
    const tKorb = tAbwurf + flugDauer;
    const tLandung = tAbsprung + 0.84;
    const dauer = tKorb + 2.6;

    const nachher = w.stand.slice();
    const vorher = w.ergebnis === 'treffer' && loewenWirft ? [nachher[0] - w.punkte, nachher[1]] : nachher.slice();

    const hauptName = blockSzene ? `Block von ${w.blocker ? w.blocker.name : 'Löwen'}` : w.werfer.name;
    const nebenText = blockSzene ? `gegen ${w.werfer.name} (${kurz(daten.gegner)})` : (hatVorlage ? `Vorlage ${w.vorlage.name}` : '');

    const ringZiel = new T.Vector3(KORB.x, RING_H + 0.05, KORB.z);
    const fehlZiel = new T.Vector3(KORB.x + quer.x * 0.2, RING_H + 0.08, KORB.z + quer.z * 0.2 + 0.18);
    const hand = new T.Vector3(), hand2 = new T.Vector3(), tmp = new T.Vector3();
    let abwurfPunkt = null, blockPunkt = null;

    function anwenden(t, blick) {
      setzeStand(...(t >= tKorb && w.ergebnis === 'treffer' ? nachher : vorher));
      elPlus.textContent = (w.ergebnis === 'treffer' && t >= tKorb && t < tKorb + 1.4) ? `+${w.punkte}` : (blockSzene && t >= tAbwurf + 0.2 && t < tAbwurf + 1.4 ? 'Block!' : '');
      elPlus.classList.toggle('ist-sichtbar', !!elPlus.textContent);

      // Werfer
      fW.farbe(werferFarbe, w.werfer.nr);
      fW.groesse(w.werfer.groesse || 1.95);
      let pos = P.clone(), hoch = 0, pose;
      if (fliegt) {
        if (t < tFang) { pos.copy(anlaufStart); pose = POSEN.halten; }
        else if (t < tAnlaufEnde) {
          const k = (t - tFang) / (tAnlaufEnde - tFang);
          pos.lerpVectors(anlaufStart, absprung, glatt(k));
          pose = lauf((t - tFang) * 7);
        } else {
          const k = clamp((t - tAbsprung) / (tLandung - tAbsprung), 0, 1);
          pos.lerpVectors(absprung, absprung.clone().addScaledVector(dir, 0.9), k);
          hoch = sprung * Math.sin(Math.PI * k);
          pose = t < tAbwurf ? mische(POSEN.dunkHoch, POSEN.ansatz, 1 - clamp((t - tAbsprung) / 0.25, 0, 1)) : (t < tLandung ? POSEN.dunkHoch : mische(POSEN.landen, POSEN.stehen, clamp((t - tLandung) / 0.4, 0, 1)));
          if (w.art === 'korbleger' && t >= tAbsprung) pose = t < tLandung ? POSEN.korbleger : mische(POSEN.landen, POSEN.stehen, clamp((t - tLandung) / 0.4, 0, 1));
        }
      } else {
        if (t < tFang) pose = hatVorlage ? POSEN.fangbereit : POSEN.halten;
        else if (t < tAbsprung) pose = mische(POSEN.halten, POSEN.hocke, clamp((t - tFang) / 0.35, 0, 1));
        else if (t < tLandung) {
          const k = (t - tAbsprung) / (tLandung - tAbsprung);
          hoch = sprung * Math.sin(Math.PI * k);
          pose = t < tAbwurf ? mische(POSEN.hocke, POSEN.ansatz, clamp((t - tAbsprung) / 0.25, 0, 1)) : mische(POSEN.ansatz, POSEN.abwurf, clamp((t - tAbwurf) / 0.12, 0, 1));
        } else pose = t < tLandung + 0.5 ? mische(POSEN.abwurf, POSEN.stehen, clamp((t - tLandung) / 0.5, 0, 1)) : POSEN.stehen;
      }
      fW.setze(pos, hoch, blickWinkel(pos, KORB), pose);

      // Vorlagengeber
      fV.wurzel.visible = hatVorlage;
      if (hatVorlage) {
        fV.farbe(werferFarbe, w.vorlage.nr);
        fV.groesse(w.vorlage.groesse || 1.95);
        const passPose = t < tFang - 0.7 ? POSEN.halten : (t < tFang - 0.45 ? POSEN.pass : POSEN.stehen);
        fV.setze(vorlagePos, 0, blickWinkel(vorlagePos, anlaufStart), passPose);
      }

      // Verteidiger / Blocker
      fD.farbe(vertFarbe, blockSzene && w.blocker ? w.blocker.nr : '');
      fD.groesse(blockSzene && w.blocker ? (w.blocker.groesse || 1.95) : 1.95);
      let vPos = vertPos.clone(), vHoch = 0, vPose = POSEN.verteidigen;
      if (!fliegt) vPos.lerpVectors(vertPos.clone().addScaledVector(dir, 0.8), vertPos, clamp((t - tFang + 0.6) / 0.8, 0, 1));
      if (t > tAbsprung - 0.05 && t < tLandung + 0.1) {
        const k = clamp((t - tAbsprung + 0.05) / (tLandung - tAbsprung + 0.15), 0, 1);
        vHoch = (blockSzene ? 0.75 : 0.35) * Math.sin(Math.PI * k);
        vPose = POSEN.armeHoch;
      }
      fD.setze(vPos, vHoch, blickWinkel(vPos, P), vPose);

      // Ball
      if (hatVorlage && t < tFang) {
        fV.hand(hand);
        fW.hand(hand2);
        const k = clamp((t - (tFang - 0.45)) / 0.45, 0, 1);
        if (k <= 0) ball.position.copy(hand);
        else bogen(hand, hand2, 0.6, k, ball.position);
      } else if (t < tAbwurf) {
        fW.hand(hand);
        ball.position.copy(hand);
        if (fliegt && t > tFang && t < tAnlaufEnde) ball.position.y = 0.15 + Math.abs(Math.sin((t - tFang) * 7)) * 0.85;
        abwurfPunkt = null;
      } else {
        if (!abwurfPunkt) { fW.hand(hand); abwurfPunkt = hand.clone(); }
        if (blockSzene) {
          if (!blockPunkt) blockPunkt = abwurfPunkt.clone().addScaledVector(dir, 0.6).setY(abwurfPunkt.y + 0.35);
          const k = clamp((t - tAbwurf) / 0.18, 0, 1);
          if (k < 1) ball.position.lerpVectors(abwurfPunkt, blockPunkt, k);
          else {
            const k2 = clamp((t - tAbwurf - 0.18) / 0.9, 0, 1);
            tmp.copy(blockPunkt).addScaledVector(quer, 3.5).addScaledVector(dir, -2.5).setY(0.12);
            bogen(blockPunkt, tmp, 0.5, k2, ball.position);
            if (k2 >= 1) huepfen(tmp, t - tAbwurf - 1.08, quer, ball.position);
          }
        } else if (t < tKorb) {
          const k = (t - tAbwurf) / flugDauer;
          const ziel2 = w.ergebnis === 'treffer' ? ringZiel : fehlZiel;
          if (w.art === 'dunk' || w.art === 'alleyoop') ball.position.lerpVectors(abwurfPunkt, tmp.copy(ringZiel).setY(RING_H + 0.15), glatt(k));
          else bogen(abwurfPunkt, ziel2, 1.0 + wurfWeite * 0.09, k, ball.position);
        } else if (w.ergebnis === 'treffer') {
          const k = t - tKorb;
          const fall = Math.min(k, 0.75);
          ball.position.set(KORB.x, Math.max(RING_H + 0.05 - 4.9 * fall * fall * 1.2, 0.12), KORB.z);
          if (k > 0.75) huepfen(tmp.set(KORB.x, 0.12, KORB.z), k - 0.75, dir.clone().multiplyScalar(-0.5), ball.position);
        } else {
          const k = clamp((t - tKorb) / 1.0, 0, 1);
          tmp.copy(fehlZiel).addScaledVector(dir, -3).addScaledVector(quer, 1.5).setY(0.12);
          bogen(fehlZiel, tmp, 0.9, k, ball.position);
          if (k >= 1) huepfen(tmp, t - tKorb - 1, quer, ball.position);
        }
      }
      ball.rotation.x = t * 6;

      // Kamera: hinter dem Werfer -> seitlich zum Abwurf -> am Korb
      const mitte = new T.Vector3().lerpVectors(fliegt ? absprung : P, new T.Vector3(KORB.x, 0, KORB.z), 0.5);
      const k0 = imFeld(new T.Vector3().copy(fliegt ? anlaufStart : P).addScaledVector(dir, -4.5).addScaledVector(quer, 2.4).setY(2.4));
      const k1 = imFeld(new T.Vector3().copy(mitte).addScaledVector(quer, 6.2).setY(2.6));
      const k2 = imFeld(new T.Vector3(KORB.x, 3.3, KORB.z).addScaledVector(quer, 3.4).addScaledVector(dir, -3.8));
      const b0 = new T.Vector3().copy(fliegt ? anlaufStart : P).setY(1.4);
      const b1 = new T.Vector3().copy(mitte).setY(2.0);
      const b2 = new T.Vector3(KORB.x, 2.7, KORB.z);
      if (t < tAbwurf) {
        const k = glatt(clamp(t / tAbwurf, 0, 1));
        kamera.position.lerpVectors(k0, k1, k);
        blick.lerpVectors(b0, b1, k);
      } else {
        const k = glatt(clamp((t - tAbwurf) / (flugDauer + 0.6), 0, 1));
        kamera.position.lerpVectors(k1, k2, k);
        blick.lerpVectors(b1, b2, k);
      }
      kamera.lookAt(blick);
    }

    return { w, dauer, vorher, hauptName, nebenText, anwenden };
  }
}

// ---------- Posen ----------
// Gelenke: hL/kL Hüfte/Knie links, hR/kR rechts, sL/eL Schulter/Ellbogen links, sR/eR rechts, r Rumpf, y Absenkung
const POSEN = {
  stehen: { hL: 0, kL: 0.1, hR: 0, kR: 0.1, sL: -0.15, eL: -0.25, sR: -0.15, eR: -0.25, r: 0.02, y: -0.01 },
  halten: { hL: -0.15, kL: 0.3, hR: -0.15, kR: 0.3, sL: -0.85, eL: -1.25, sR: -0.85, eR: -1.25, r: 0.12, y: -0.05 },
  fangbereit: { hL: -0.2, kL: 0.35, hR: -0.2, kR: 0.35, sL: -1.2, eL: -0.6, sR: -1.2, eR: -0.6, r: 0.1, y: -0.06 },
  hocke: { hL: -0.75, kL: 1.25, hR: -0.75, kR: 1.25, sL: -1.0, eL: -1.4, sR: -1.1, eR: -1.5, r: 0.3, y: -0.24 },
  ansatz: { hL: -0.1, kL: 0.2, hR: -0.1, kR: 0.2, sL: -2.45, eL: -1.2, sR: -2.65, eR: -1.55, r: 0, y: 0 },
  abwurf: { hL: 0.05, kL: 0.15, hR: 0.05, kR: 0.15, sL: -2.3, eL: -0.6, sR: -2.95, eR: -0.12, r: -0.05, y: 0 },
  landen: { hL: -0.5, kL: 0.9, hR: -0.5, kR: 0.9, sL: -0.6, eL: -0.6, sR: -0.6, eR: -0.6, r: 0.2, y: -0.15 },
  dunkHoch: { hL: -1.0, kL: 1.4, hR: 0.25, kR: 0.35, sL: -0.7, eL: -0.5, sR: -3.05, eR: -0.08, r: -0.05, y: 0 },
  korbleger: { hL: -1.1, kL: 1.3, hR: 0.2, kR: 0.4, sL: -0.9, eL: -0.6, sR: -2.9, eR: -0.25, r: 0, y: 0 },
  verteidigen: { hL: -0.45, kL: 0.8, hR: -0.45, kR: 0.8, sL: -0.9, eL: -0.3, sR: -0.9, eR: -0.3, r: 0.3, y: -0.13 },
  armeHoch: { hL: -0.1, kL: 0.3, hR: -0.1, kR: 0.3, sL: -2.85, eL: -0.15, sR: -2.85, eR: -0.15, r: -0.05, y: 0 },
  pass: { hL: -0.2, kL: 0.3, hR: -0.2, kR: 0.3, sL: -1.5, eL: -0.15, sR: -1.5, eR: -0.15, r: 0.15, y: -0.04 },
};

function lauf(phase) {
  const s = Math.sin(phase), c = Math.cos(phase);
  return { hL: -0.7 * s, kL: 0.6 + 0.5 * Math.max(0, c), hR: 0.7 * s, kR: 0.6 + 0.5 * Math.max(0, -c),
    sL: 0.5 * s - 0.3, eL: -1.0, sR: -0.5 * s - 0.6, eR: -1.1, r: 0.25, y: -0.06 - 0.04 * Math.abs(c) };
}

function mische(a, b, k) {
  const o = {};
  for (const n in a) o[n] = a[n] + (b[n] - a[n]) * k;
  return o;
}

// ---------- Figur ----------
function baueFigur(T) {
  const wurzel = new T.Group();
  const koerper = new T.Group();
  wurzel.add(koerper);
  const trikotMat = new T.MeshStandardMaterial({ color: FARBE.orange, roughness: 0.65 });
  const hoseMat = new T.MeshStandardMaterial({ color: FARBE.orange, roughness: 0.7 });
  const puppeMat = new T.MeshStandardMaterial({ color: FARBE.puppe, roughness: 0.55 });
  const schuhMat = new T.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  const nrCanvas = document.createElement('canvas');
  nrCanvas.width = 128; nrCanvas.height = 128;
  const nrTex = new T.CanvasTexture(nrCanvas);
  nrTex.colorSpace = T.SRGBColorSpace;
  const nrMat = new T.MeshBasicMaterial({ map: nrTex, transparent: true });

  const teil = (geo, mat, eltern, x, y, z) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    eltern.add(m);
    return m;
  };
  const gelenk = (eltern, x, y, z) => { const o = new T.Object3D(); o.position.set(x, y, z); eltern.add(o); return o; };

  const becken = gelenk(koerper, 0, 1.0, 0);
  const rumpf = gelenk(becken, 0, 0, 0);
  teil(new T.CapsuleGeometry(0.17, 0.36, 6, 14), trikotMat, rumpf, 0, 0.33, 0).scale.set(1.05, 1, 0.72);
  teil(new T.CylinderGeometry(0.2, 0.22, 0.26, 14), hoseMat, becken, 0, -0.03, 0).scale.set(1, 1, 0.75);
  teil(new T.SphereGeometry(0.115, 18, 14), puppeMat, rumpf, 0, 0.8, 0.01);
  teil(new T.CylinderGeometry(0.05, 0.055, 0.1, 10), puppeMat, rumpf, 0, 0.67, 0);
  const nrVorn = teil(new T.PlaneGeometry(0.22, 0.22), nrMat, rumpf, 0, 0.38, 0.13);
  const nrHinten = teil(new T.PlaneGeometry(0.24, 0.24), nrMat, rumpf, 0, 0.4, -0.13);
  nrHinten.rotation.y = Math.PI;
  nrVorn.castShadow = nrHinten.castShadow = false;

  const bein = (seite) => {
    const h = gelenk(becken, seite * 0.1, -0.05, 0);
    teil(new T.CapsuleGeometry(0.075, 0.32, 4, 10), seite ? puppeMat : puppeMat, h, 0, -0.22, 0);
    const k = gelenk(h, 0, -0.46, 0);
    teil(new T.CapsuleGeometry(0.06, 0.34, 4, 10), puppeMat, k, 0, -0.22, 0);
    teil(new T.BoxGeometry(0.11, 0.08, 0.26), schuhMat, k, 0, -0.46, 0.05);
    return [h, k];
  };
  const arm = (seite) => {
    const s = gelenk(rumpf, seite * 0.25, 0.58, 0);
    teil(new T.CapsuleGeometry(0.05, 0.22, 4, 10), puppeMat, s, 0, -0.15, 0);
    teil(new T.SphereGeometry(0.075, 10, 8), trikotMat, s, 0, -0.02, 0);
    const e = gelenk(s, 0, -0.31, 0);
    teil(new T.CapsuleGeometry(0.043, 0.22, 4, 10), puppeMat, e, 0, -0.14, 0);
    const hand = gelenk(e, 0, -0.32, 0.02);
    teil(new T.SphereGeometry(0.05, 10, 8), puppeMat, hand, 0, 0, 0);
    return [s, e, hand];
  };
  const [hL, kL] = bein(-1), [hR, kR] = bein(1);
  const [sL, eL] = arm(-1), [sR, eR, handR] = arm(1);

  let letzteFarbe = null, letzteNr = null, skala = 1;
  return {
    wurzel,
    farbe(farbe, nr) {
      if (farbe !== letzteFarbe) { trikotMat.color.setHex(farbe); hoseMat.color.setHex(farbe === FARBE.orange ? FARBE.navy : 0x4a5263); letzteFarbe = farbe; }
      if (nr !== letzteNr) {
        const c = nrCanvas.getContext('2d');
        c.clearRect(0, 0, 128, 128);
        c.fillStyle = '#ffffff';
        c.font = '900 84px Lexend, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        if (nr) c.fillText(String(nr), 64, 70);
        nrTex.needsUpdate = true;
        letzteNr = nr;
      }
    },
    groesse(m) { skala = clamp(m, 1.75, 2.2) / 1.95; },
    setze(pos, hoch, winkel, p) {
      wurzel.visible = true;
      wurzel.position.set(pos.x, hoch, pos.z);
      wurzel.rotation.y = winkel;
      wurzel.scale.setScalar(skala);
      becken.position.y = 1.0 + p.y;
      rumpf.rotation.x = p.r;
      hL.rotation.x = p.hL; kL.rotation.x = p.kL; hR.rotation.x = p.hR; kR.rotation.x = p.kR;
      sL.rotation.x = p.sL; eL.rotation.x = p.eL; sR.rotation.x = p.sR; eR.rotation.x = p.eR;
      sL.rotation.z = -0.12; sR.rotation.z = 0.12;
    },
    hand(ziel) {
      wurzel.updateMatrixWorld(true);
      handR.getWorldPosition(ziel);
      ziel.y += 0.06;
      return ziel;
    },
  };
}

// ---------- Feld, Korb, Halle ----------
function baueFeld(T) {
  const PXM = 128, B = 17, L = 16, X0 = -8.5, Z0 = -2.5;
  const c = document.createElement('canvas');
  c.width = B * PXM; c.height = L * PXM;
  const g = c.getContext('2d');
  const px = (x) => (x - X0) * PXM, pz = (z) => (z - Z0) * PXM;
  g.fillStyle = '#0b1a3d';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = FARBE.holz;
  g.fillRect(px(-7.5), pz(-1.575), 15 * PXM, 14 * PXM);
  g.globalAlpha = 0.08;
  for (let x = -7.5; x < 7.5; x += 0.12) { g.fillStyle = Math.random() > 0.5 ? '#000' : '#fff'; g.fillRect(px(x), pz(-1.575), 2, 14 * PXM); }
  g.globalAlpha = 0.9;
  g.fillStyle = '#e5710b';
  g.fillRect(px(-2.45), pz(-1.575), 4.9 * PXM, 5.8 * PXM);
  g.globalAlpha = 1;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 0.05 * PXM;
  g.strokeRect(px(-7.5), pz(-1.575), 15 * PXM, 14 * PXM);
  g.strokeRect(px(-2.45), pz(-1.575), 4.9 * PXM, 5.8 * PXM);
  g.beginPath(); g.arc(px(0), pz(4.225), 1.8 * PXM, 0, Math.PI * 2); g.stroke();
  const eck = Math.sqrt(6.75 * 6.75 - 6.6 * 6.6);
  g.beginPath();
  g.moveTo(px(-6.6), pz(-1.575)); g.lineTo(px(-6.6), pz(eck));
  g.arc(px(0), pz(0), 6.75 * PXM, Math.PI - Math.atan2(eck, 6.6), Math.atan2(eck, 6.6), true);
  g.lineTo(px(6.6), pz(-1.575));
  g.stroke();
  g.beginPath(); g.arc(px(0), pz(0), 1.25 * PXM, Math.PI, 0, true); g.stroke();
  g.beginPath(); g.arc(px(0), pz(12.425), 1.8 * PXM, Math.PI, 0); g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `900 ${0.62 * PXM}px Lexend, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BASKETBALL LÖWEN ERFURT', px(0), pz(-2.05));
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 8;
  const boden = new T.Mesh(new T.PlaneGeometry(B, L), new T.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 }));
  boden.rotation.x = -Math.PI / 2;
  boden.position.set(X0 + B / 2, 0, Z0 + L / 2);
  boden.receiveShadow = true;
  const logo = new Image();
  logo.onload = () => { const s = 2.6 * PXM; g.drawImage(logo, px(0) - s / 2, pz(12.425) - s * 0.6, s, s * 0.94); tex.needsUpdate = true; };
  logo.src = '/assets/logo/loewen-logo-4c.svg';
  const gruppe = new T.Group();
  gruppe.add(boden);
  const aussen = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: 0x0a1530, roughness: 0.9 }));
  aussen.rotation.x = -Math.PI / 2;
  aussen.position.set(0, -0.01, 5);
  aussen.receiveShadow = true;
  gruppe.add(aussen);
  return gruppe;
}

function baueKorb(T) {
  const g = new T.Group();
  const weiss = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.55 });
  const rahmen = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const ringMat = new T.MeshStandardMaterial({ color: FARBE.orange, roughness: 0.4, metalness: 0.3 });
  const brett = new T.Mesh(new T.BoxGeometry(1.8, 1.05, 0.04), weiss);
  brett.position.set(0, 2.9 + 0.525, -0.375 - 0.02);
  g.add(brett);
  const kasten = new T.Mesh(new T.BoxGeometry(0.59, 0.45, 0.045), new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
  kasten.position.set(0, 3.05 + 0.2, -0.37);
  g.add(kasten);
  const ring = new T.Mesh(new T.TorusGeometry(RING_R, 0.012, 8, 32), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RING_H, 0);
  g.add(ring);
  const steg = new T.Mesh(new T.BoxGeometry(0.06, 0.03, 0.16), ringMat);
  steg.position.set(0, RING_H, -0.3);
  g.add(steg);
  const netz = new T.Mesh(new T.CylinderGeometry(RING_R, 0.14, 0.42, 16, 4, true), new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }));
  netz.position.set(0, RING_H - 0.21, 0);
  g.add(netz);
  const mast = new T.Mesh(new T.BoxGeometry(0.35, 3.4, 0.35), new T.MeshStandardMaterial({ color: FARBE.navy, roughness: 0.6 }));
  mast.position.set(0, 1.7, -3.0);
  mast.castShadow = true;
  g.add(mast);
  const arm = new T.Mesh(new T.BoxGeometry(0.15, 0.15, 2.6), rahmen);
  arm.position.set(0, 3.35, -1.7);
  g.add(arm);
  const fuss = new T.Mesh(new T.BoxGeometry(1.2, 0.5, 1.6), new T.MeshStandardMaterial({ color: FARBE.navy, roughness: 0.6 }));
  fuss.position.set(0, 0.25, -3.3);
  g.add(fuss);
  return g;
}

function baueHalle(T) {
  const g = new T.Group();
  const sitz = new T.MeshStandardMaterial({ color: 0x14245a, roughness: 0.8 });
  const sitzOrange = new T.MeshStandardMaterial({ color: 0x8a4510, roughness: 0.8 });
  const reihe = (x, z, breite, tiefe, dreh, stufen) => {
    for (let i = 0; i < stufen; i++) {
      const m = new T.Mesh(new T.BoxGeometry(breite, 0.45, tiefe), i % 4 === 3 ? sitzOrange : sitz);
      const r = new T.Vector3(0, 0, -i * tiefe).applyAxisAngle(new T.Vector3(0, 1, 0), dreh);
      m.position.set(x + r.x, 0.22 + i * 0.45, z + r.z);
      m.rotation.y = dreh;
      m.receiveShadow = true;
      g.add(m);
    }
  };
  reihe(0, -5.2, 22, 0.9, 0, 9);
  reihe(-10.5, 5, 18, 0.9, Math.PI / 2, 9);
  reihe(10.5, 5, 18, 0.9, -Math.PI / 2, 9);
  const bande = new T.Mesh(new T.BoxGeometry(16, 0.9, 0.1), new T.MeshStandardMaterial({ color: FARBE.orange, emissive: 0x4a2000, roughness: 0.5 }));
  bande.position.set(0, 0.45, -4.3);
  g.add(bande);
  return g;
}

function ballTextur(T) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d4671a';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#2a1408';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
  [64, 192].forEach((x) => { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); });
  g.beginPath(); g.ellipse(128, 64, 40, 64, 0, 0, Math.PI * 2); g.stroke();
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

// ---------- Hilfen ----------
function bogen(a, b, ueberhoehung, k, ziel) {
  ziel.lerpVectors(a, b, k);
  ziel.y += Math.sin(Math.PI * k) * ueberhoehung;
  return ziel;
}
function huepfen(basis, t, richtung, ziel) {
  const d = Math.min(t, 2.5);
  ziel.copy(basis).addScaledVector(richtung, d * 0.4);
  ziel.y = 0.12 + Math.abs(Math.sin(d * 5)) * 0.6 * Math.exp(-d * 1.6);
  return ziel;
}
function blickWinkel(von, nach) { return Math.atan2(nach.x - von.x, nach.z - von.z); }
// Kamera bleibt vor der Grundlinie und innerhalb der Halle (sonst filmt sie durch Ständer oder Tribüne)
function imFeld(v) { v.x = clamp(v.x, -8.8, 8.8); v.z = clamp(v.z, 1.2, 14); return v; }
function begrenze(v) { v.x = clamp(v.x, -7.2, 7.2); v.z = clamp(v.z, -1.2, 11.5); return v; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function glatt(k) { return k * k * (3 - 2 * k); }
function viertel(q) { return q <= 4 ? `${q}. Viertel` : `Verlängerung ${q - 4}`; }
function uhr(sek) { const m = Math.floor(sek / 60), s = sek % 60; return `noch ${m}:${String(s).padStart(2, '0')}`; }
function kurz(name) { return String(name || '').replace(/^FC Bayern Basketball II$/, 'Bayern II').replace(/\s+(e\.V\.|GmbH)$/, ''); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
