/* Gemeinsame Flip-Kachel für Partner-/Sponsoren-Logos — Inhalt und Verhalten
   sind auf allen Seiten identisch, nur die Größe variiert je Seite über CSS
   (siehe .partner-tile-* Größenklassen in site.css). Die Kachel selbst ist ein
   echter Link zur Partner-Website (neuer Tab) — der Flip mit Claim/Kurz-
   beschreibung läuft daher per Hover (Desktop), nicht per Klick, damit Klick
   immer zuverlässig zur Website führt. Ohne p.website bleibt es eine <div>
   ohne Verlinkung (z.B. falls eine Partner-URL mal fehlt). */
function partnerTileHTML(p) {
  var tier = p.tier || '';
  var front = p.logo ? '<img src="' + p.logo + '" alt="' + p.name + '" loading="lazy" />' : p.name;
  var back = '';
  if (tier === 'wirkungspartner') back += '<span class="partner-tag">Wirkungspartner</span>';
  if (p.claim) back += '<p>„' + p.claim + '“</p>';
  if (p.beschreibung) back += '<span class="partner-desc">' + p.beschreibung + '</span>';
  var inner = '<div class="partner-tile-inner">' +
    '<div class="partner-tile-front">' + front + '</div>' +
    '<div class="partner-tile-back">' + back + '</div>' +
  '</div>';
  var cls = 'partner-tile partner-tile-' + tier;
  var level = p.level ? ' data-level="' + p.level + '"' : '';
  if (p.website) {
    return '<a class="' + cls + '" data-tier="' + tier + '"' + level + ' href="' + p.website + '" target="_blank" rel="noopener">' + inner + '</a>';
  }
  return '<div class="' + cls + '" data-tier="' + tier + '"' + level + '>' + inner + '</div>';
}
