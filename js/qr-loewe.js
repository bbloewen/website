/* QR-Code mit Löwe (Marko 27.11.2026, wie qr_loewe.py aus der Postkarten-Übergabe):
   Fehlerkorrektur H, Modulfarbe #00122D, Löwe in der Mitte (5,4 von 26 mm ≈ 21 % der Kantenlänge) mit hauchdünnem weißem Rand.
   Nur für Werbe- und Link-Codes (Postkarten, Schilder, Aushänge). Einlass-Codes (pretix, Wallet) und GiroCodes bleiben ohne Löwe.
   Braucht qrcode-generator (https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js).
   Aufruf: qrLoewe('https://basketball-loewen.com/g/K7P2X9', 1040).then(function (dataUrl) { img.src = dataUrl; }); */
(function () {
  var LOEWE = '/assets/postkarte/loewe.webp', bild = null;
  function loeweLaden() {
    if (bild) return bild;
    bild = new Promise(function (ok, fehler) { var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function () { ok(im); }; im.onerror = fehler; im.src = LOEWE; });
    return bild;
  }
  window.qrLoewe = function (text, groesse) {
    var q = qrcode(0, 'H'); q.addData(text); q.make();
    var n = q.getModuleCount(), px = Math.max(4, Math.floor((groesse || 1040) / n)), S = n * px;
    var c = document.createElement('canvas'); c.width = S; c.height = S; var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#00122D';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect(x * px, y * px, px, px);
    return loeweLaden().then(function (im) {
      var h = Math.round(S * 5.4 / 26), w = Math.round(h * im.width / im.height), ox = Math.round((S - w) / 2), oy = Math.round((S - h) / 2), r = Math.max(1, Math.round(S * 0.2 / 26));
      // weißer Rand: Silhouette des Löwen in Weiß, rundum versetzt
      var s = document.createElement('canvas'); s.width = w; s.height = h; var sg = s.getContext('2d');
      sg.drawImage(im, 0, 0, w, h); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#fff'; sg.fillRect(0, 0, w, h);
      for (var a = 0; a < 16; a++) { var t = a * Math.PI / 8; g.drawImage(s, ox + Math.round(Math.cos(t) * r), oy + Math.round(Math.sin(t) * r)); }
      g.drawImage(s, ox, oy); g.drawImage(im, ox, oy, w, h);
      return c.toDataURL('image/png');
    }, function () { return c.toDataURL('image/png'); });
  };
})();
