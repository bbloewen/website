// Homepage-Hero: rotiert die Slide-Layer in [data-hero-slider] alle 5s.
// Bilderliste kommt aus dem data-images-Attribut (JSON-Array von Pfaden).
(function () {
  var slider = document.querySelector('[data-hero-slider]');
  if (!slider) return;
  var slides = slider.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;

  var current = 0;
  setInterval(function () {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 5000);
})();
