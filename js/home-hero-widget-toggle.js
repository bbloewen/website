/* Testhilfe: Umschalter unten rechts im Hero-Widget, um zwischen "Nächstes
   Heimspiel" und "Top-News" hin- und herzuschalten — nur zum Vergleichen,
   bis entschieden ist, welches Widget final bleibt. */
(function () {
  var wrap = document.querySelector('[data-hero-widget-wrap]');
  if (!wrap) return;
  var widgets = Array.prototype.slice.call(wrap.querySelectorAll('[data-hero-widget]'));
  var toggle = wrap.querySelector('[data-hero-widget-toggle]');
  if (!toggle || widgets.length < 2) return;

  var current = 0;
  toggle.addEventListener('click', function () {
    widgets[current].classList.add('hidden');
    current = (current + 1) % widgets.length;
    widgets[current].classList.remove('hidden');
  });
})();
