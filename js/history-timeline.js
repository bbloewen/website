/* Blendet den unteren Fade-Hinweis (".history-timeline-scroll-fade") aus,
   sobald bis zum Ende gescrollt wurde — sonst verdeckt er dauerhaft den
   letzten (ältesten) Eintrag der Vereinsgeschichte. */
(function () {
  document.querySelectorAll('.history-timeline-outer').forEach(function (outer) {
    var scroll = outer.querySelector('.history-timeline-scroll');
    var fade = outer.querySelector('.history-timeline-scroll-fade');
    if (!scroll || !fade) return;
    function update() {
      var atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
      fade.style.opacity = atBottom ? '0' : '1';
    }
    scroll.addEventListener('scroll', update);
    update();
  });
})();
