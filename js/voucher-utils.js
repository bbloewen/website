(function (global) {
  /* Ein 100%-Gutschein (z.B. Sponsoren-Freikarte) übernimmt auch den sonst separat
     berechneten Nachwuchsbeitrag. Zwei Voucher-Formen gelten als "Voll-Gutschein":
     priceMode=percent mit value=100, oder priceMode=set mit value=0 (kostenlos).
     Gemeinsame Stelle für seat-picker.js und checkout.html, damit eine künftige
     Änderung der Regel nicht wieder an mehreren Stellen einzeln nachgezogen werden muss. */
  function voucherIsFullComp(info) {
    if (!info) return false;
    return (info.priceMode === 'percent' && info.value === 100) || (info.priceMode === 'set' && info.value === 0);
  }
  global.voucherIsFullComp = voucherIsFullComp;
})(window);
