// Homepage-Hero: rotiert die Slide-Layer in [data-hero-slider] alle 7s.
//
// Die Bildpfade stehen in data-bg OHNE Endung. Geladen wird erst, wenn eine
// Folie gebraucht wird: die aktive sofort (sie kommt ohnehin aus dem CSS),
// die naechste jeweils sieben Sekunden im Voraus.
//
// Warum: vorher trug jede der elf Folien ihr Bild im style-Attribut. Der
// Browser laedt ein background-image, sobald das Element im Layout steht --
// also alle elf beim Seitenaufruf, zusammen 5,8 MB. Auf dem Telefon lief die
// Leitung damit minutenlang voll, und das Spieltags-Widget im selben Hero
// erschien entsprechend spaet. Jetzt beginnt die Seite mit einem Bild
// (Marko, 04.10.2026).
//
// Unter 900px Fensterbreite die 1280er Fassung: die grossen sind 2400px breit
// und damit auf einem Telefon sechsfach ueberdimensioniert.
(function () {
  var slider = document.querySelector('[data-hero-slider]');
  if (!slider) return;
  var slides = slider.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;

  var schmal = window.innerWidth < 900;

  function laden(slide) {
    if (!slide || slide.dataset.geladen) return;
    var basis = slide.getAttribute('data-bg');
    if (!basis) return;
    slide.style.backgroundImage = "url('" + basis + (schmal ? '-1280' : '') + ".webp')";
    slide.dataset.geladen = '1';
  }

  /* Die erste Folie traegt ihr Bild aus dem CSS; hier nur vormerken, damit sie
     beim Rundlauf nicht noch einmal gesetzt wird. */
  slides[0].dataset.geladen = '1';
  laden(slides[1]);

  var current = 0;
  setInterval(function () {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    laden(slides[current]);
    laden(slides[(current + 1) % slides.length]);
    slides[current].classList.add('active');
  }, 7000);

  /* Bewusst KEIN Vorabladen der uebrigen Folien im Leerlauf: die Rotation
     holt jede Folie sieben Sekunden bevor sie dran ist, das reicht. Wer die
     Startseite nach zwanzig Sekunden verlaesst, hat dann drei Bilder geladen
     und nicht elf -- auf dem Telefon ein Unterschied von rund 3 MB. */
})();
