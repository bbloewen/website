/* Bildergalerie für Basketballcamps und Events — horizontal scrollbarer Foto-Streifen.
   initCampGallery(containerId, campSlug, jsonPath, showComingSoon) rendert bis zu 50
   Fotos aus jsonPath (Default data/camp-galerie.json); mit campSlug werden nur Fotos
   mit passendem 'camp'-Feld gezeigt. showComingSoon hängt eine zusätzliche, immer
   sichtbare Platzhalter-Kachel ("Weitere Fotos folgen in Kürze") ans Ende des
   Streifens an — auch wenn noch gar keine echten Fotos vorliegen. Klick auf ein
   echtes Foto öffnet es groß in einem Lightbox-Overlay (gemeinsam für alle Galerien
   auf der Seite). */
function initCampGallery(containerId, campSlug, jsonPath, showComingSoon) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var track = container.querySelector('.news-slider-track');
  var empty = container.querySelector('.camp-gallery-empty');
  var prevBtn = container.querySelector('[data-gallery-prev]');
  var nextBtn = container.querySelector('[data-gallery-next]');

  fetch(jsonPath || '/data/camp-galerie.json').then(function (r) { return r.json(); }).then(function (data) {
    var bilder = (data && data.bilder) || [];
    if (campSlug) bilder = bilder.filter(function (b) { return b.camp === campSlug; });
    bilder = bilder.slice(0, 50);

    if (!bilder.length && !showComingSoon) {
      if (empty) empty.style.display = 'block';
      return;
    }

    var html = bilder.map(function (b) {
      var alt = (b.alt || '').replace(/"/g, '&quot;');
      /* Im Streifen das Vorschaubild (480px breit, s. tools/build-galerie-thumbs.py),
         in der Lightbox das Original. Die Kachel ist 240 mal 160 Pixel gross --
         vorher lagen dort die Originale, die LOEWENPARK-Galerie allein 8,2 MB.
         Rueckfall auf b.src, falls eine Galerie-Datei noch kein thumb hat. */
      var klein = b.thumb || b.src;
      return '<div class="camp-gallery-photo" data-lightbox-src="' + b.src + '" data-lightbox-alt="' + alt + '"><img src="' + klein + '" width="480" height="320" alt="' + alt + '" loading="lazy" /></div>';
    }).join('');
    if (showComingSoon) {
      html += '<div class="camp-gallery-photo camp-gallery-photo-soon"><span>Weitere Fotos<br>folgen in Kürze</span></div>';
    }
    track.innerHTML = html;

    if (prevBtn) prevBtn.addEventListener('click', function () {
      var atStart = track.scrollLeft <= 4;
      if (atStart) track.scrollTo({ left: track.scrollWidth - track.clientWidth, behavior: 'smooth' });
      else track.scrollBy({ left: -260, behavior: 'smooth' });
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (atEnd) track.scrollTo({ left: 0, behavior: 'smooth' });
      else track.scrollBy({ left: 260, behavior: 'smooth' });
    });

    track.addEventListener('click', function (e) {
      var tile = e.target.closest('.camp-gallery-photo[data-lightbox-src]');
      if (!tile) return;
      var tiles = Array.prototype.slice.call(track.querySelectorAll('.camp-gallery-photo[data-lightbox-src]'));
      var items = tiles.map(function (t) { return { src: t.getAttribute('data-lightbox-src'), alt: t.getAttribute('data-lightbox-alt') }; });
      openGalleryLightbox(items, tiles.indexOf(tile));
    });
  });
}

/* Gemeinsames Lightbox-Overlay für alle Bildergalerien — wird beim ersten Klick
   einmalig erzeugt und danach wiederverwendet. items = Fotoliste DERSELBEN
   Galerie (nicht nur das eine angeklickte Bild), damit man in der vergrößerten
   Ansicht selbst weiter-/zurückblättern kann, statt schließen und im Streifen
   erneut klicken zu müssen. */
var __galleryItems = [];
var __galleryIndex = 0;

function openGalleryLightbox(items, index) {
  __galleryItems = items;
  __galleryIndex = index;
  var overlay = document.getElementById('gallery-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'gallery-lightbox';
    overlay.className = 'gallery-lightbox';
    overlay.innerHTML =
      '<button type="button" class="gallery-lightbox-close" aria-label="Schließen">&times;</button>' +
      '<button type="button" class="gallery-lightbox-nav prev" aria-label="Vorheriges Foto">&lsaquo;</button>' +
      '<img alt="" />' +
      '<button type="button" class="gallery-lightbox-nav next" aria-label="Nächstes Foto">&rsaquo;</button>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.classList.contains('gallery-lightbox-close')) closeGalleryLightbox();
      else if (e.target.classList.contains('prev')) showGalleryOffset(-1);
      else if (e.target.classList.contains('next')) showGalleryOffset(1);
    });
    document.addEventListener('keydown', function (e) {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') closeGalleryLightbox();
      else if (e.key === 'ArrowLeft') showGalleryOffset(-1);
      else if (e.key === 'ArrowRight') showGalleryOffset(1);
    });
  }
  renderGalleryLightbox();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function showGalleryOffset(delta) {
  var count = __galleryItems.length;
  if (!count) return;
  __galleryIndex = (__galleryIndex + delta + count) % count;
  renderGalleryLightbox();
}

function renderGalleryLightbox() {
  var overlay = document.getElementById('gallery-lightbox');
  var item = __galleryItems[__galleryIndex];
  if (!overlay || !item) return;
  var img = overlay.querySelector('img');
  img.src = item.src;
  img.alt = item.alt || '';
  var multi = __galleryItems.length > 1;
  overlay.querySelectorAll('.gallery-lightbox-nav').forEach(function (btn) { btn.hidden = !multi; });
}

function closeGalleryLightbox() {
  var overlay = document.getElementById('gallery-lightbox');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}
