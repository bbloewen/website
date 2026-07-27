/* Blendet den unteren Fade-Hinweis (".history-timeline-scroll-fade") und den
   Scroll-Pfeil (".history-timeline-scroll-arrow") aus, sobald bis zum Ende
   gescrollt wurde — sonst verdeckt der Fade dauerhaft den letzten (ältesten)
   Eintrag der Vereinsgeschichte. Der Pfeil existiert vor allem für iPad/Touch,
   wo der Scrollbalken im verschachtelten .history-timeline-scroll kaum
   sichtbar/greifbar ist; ein Klick scrollt ein Stück runter, danach übernimmt
   normales Wischen. */
(function () {
  document.querySelectorAll('.history-timeline-outer').forEach(function (outer) {
    var scroll = outer.querySelector('.history-timeline-scroll');
    var fade = outer.querySelector('.history-timeline-scroll-fade');
    var arrow = outer.querySelector('.history-timeline-scroll-arrow');
    if (!scroll || !fade) return;
    function update() {
      var atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
      fade.style.opacity = atBottom ? '0' : '1';
      if (arrow) {
        arrow.style.opacity = atBottom ? '0' : '1';
        arrow.style.pointerEvents = atBottom ? 'none' : 'auto';
      }
    }
    scroll.addEventListener('scroll', update);
    if (arrow) {
      arrow.addEventListener('click', function () {
        scroll.scrollBy({ top: scroll.clientHeight * 0.6, behavior: 'smooth' });
      });
    }
    update();
  });
})();
