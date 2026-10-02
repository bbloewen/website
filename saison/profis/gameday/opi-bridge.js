/* Bruecke zur nativen Kassen-Bridge-App (OPI-Terminal-Anbindung). Ohne die native
   Wrapper-App (z. B. im normalen Safari/Chrome) ist OpiBridge.isAvailable() false und
   jeder Aufruf schlaegt sofort fehl - die Seiten muessen dann auf den bisherigen,
   unveraenderten Ablauf zurueckfallen. */
(function (global) {
  'use strict';

  var pending = {};
  var available = !!(global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.opiBridge);

  // Wird von der nativen App aufgerufen, sobald eine Zahlung abgeschlossen ist
  // (erfolgreich oder nicht) - resultJson ist ein JSON-String.
  global.opiBridgeCallback = function (requestId, resultJson) {
    var entry = pending[requestId];
    if (!entry) return;
    delete pending[requestId];
    var result;
    try {
      result = JSON.parse(resultJson);
    } catch (e) {
      entry.reject(new Error('Ungültige Antwort von der Kassen-Bridge'));
      return;
    }
    if (result.approved) {
      entry.resolve(result);
    } else {
      var message = result.errorText || result.returnCode || 'Zahlung abgelehnt';
      var err = new Error(message);
      err.terminal = result;
      entry.reject(err);
    }
  };

  function send(action, amount) {
    if (!available) {
      return Promise.reject(new Error('Keine Terminal-Anbindung in dieser Ansicht.'));
    }
    var requestId = 'c' + Date.now() + Math.floor(Math.random() * 1000);
    return new Promise(function (resolve, reject) {
      pending[requestId] = { resolve: resolve, reject: reject };
      global.webkit.messageHandlers.opiBridge.postMessage({
        action: action,
        requestId: requestId,
        amount: amount
      });
    });
  }

  global.OpiBridge = {
    isAvailable: function () {
      return available;
    },
    // Kennwort fuer die n8n-Webhooks (abendkasse-bestellung, ausschank-verkauf). Die native App
    // setzt es beim Laden der Seite; im normalen Browser ist es leer, die Server lehnen dann ab.
    token: function () {
      return global.__kassenToken || '';
    },
    // Oeffnet in der nativen App die Diagnose-/Einstellungsansicht (Terminal-IP, Drucker).
    openDiagnose: function () {
      if (available) global.webkit.messageHandlers.opiBridge.postMessage({ action: 'diagnose' });
    },
    // Ticket-PDF an die native App zum Drucken geben (AirPrint, vorher einmal ein Drucker
    // gewaehlt). In einer WKWebView funktioniert window.open + print() nicht, deshalb der Umweg.
    printPdf: function (blob) {
      if (!available) {
        return Promise.reject(new Error('Kein nativer Druck in dieser Ansicht.'));
      }
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var base64 = String(reader.result).split(',')[1] || '';
          global.webkit.messageHandlers.opiBridge.postMessage({ action: 'printPdf', data: base64 });
          resolve(true);
        };
        reader.onerror = function () { reject(new Error('PDF konnte nicht gelesen werden.')); };
        reader.readAsDataURL(blob);
      });
    },
    // amount als Zahl (Euro, z. B. 12.5). Liefert ein Promise, das mit den
    // Terminal-Feldern (approvalCode, cardCircuit, receiptNumber, ...) aufgeloest
    // wird, oder mit einem Error (err.terminal enthaelt Details) verworfen wird.
    charge: function (amount) {
      return send('charge', amount);
    },
    // Gutschrift auf die Karte (z. B. Pfand-Rueckgabe): amount als positive Zahl, die Karte
    // wird am Terminal vorgehalten. Gleiches Promise-Verhalten wie charge().
    refund: function (amount) {
      return send('refund', amount);
    }
  };
})(window);
