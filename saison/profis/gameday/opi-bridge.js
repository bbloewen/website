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

  global.OpiBridge = {
    isAvailable: function () {
      return available;
    },
    // amount als Zahl (Euro, z. B. 12.5). Liefert ein Promise, das mit den
    // Terminal-Feldern (approvalCode, cardCircuit, receiptNumber, ...) aufgeloest
    // wird, oder mit einem Error (err.terminal enthaelt Details) verworfen wird.
    charge: function (amount) {
      if (!available) {
        return Promise.reject(new Error('Keine Terminal-Anbindung in dieser Ansicht.'));
      }
      var requestId = 'c' + Date.now() + Math.floor(Math.random() * 1000);
      return new Promise(function (resolve, reject) {
        pending[requestId] = { resolve: resolve, reject: reject };
        global.webkit.messageHandlers.opiBridge.postMessage({
          action: 'charge',
          requestId: requestId,
          amount: amount
        });
      });
    }
  };
})(window);
