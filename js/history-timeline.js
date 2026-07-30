/* Scrollt jede .history-h-scroll / .season-strip-scroll beim Laden ganz nach
   rechts (neuester Eintrag zuerst sichtbar). Bei .history-h-outer blendet
   sich zusätzlich ein Fade + Pfeil links ein, solange noch ältere Historie
   nach links folgt, und aus, sobald scrollLeft 0 erreicht ist. Der Pfeil
   existiert vor allem für iPad/Touch, wo der Scrollbalken kaum sichtbar/
   greifbar ist; ein Klick scrollt ein Stück nach links, danach übernimmt
   normales Wischen. */
(function () {
  function initEndScroll(scroll, fade, arrow) {
    if (!scroll) return;
    scroll.scrollLeft = scroll.scrollWidth;
    function update() {
      var atStart = scroll.scrollLeft <= 2;
      if (fade) fade.style.opacity = atStart ? '0' : '1';
      if (arrow) {
        arrow.style.opacity = atStart ? '0' : '1';
        arrow.style.pointerEvents = atStart ? 'none' : 'auto';
      }
    }
    scroll.addEventListener('scroll', update);
    if (arrow) {
      arrow.addEventListener('click', function () {
        scroll.scrollBy({ left: -scroll.clientWidth * 0.6, behavior: 'smooth' });
      });
    }
    update();
  }

  document.querySelectorAll('.history-h-outer').forEach(function (outer) {
    initEndScroll(
      outer.querySelector('.history-h-scroll'),
      outer.querySelector('.history-h-fade-left'),
      outer.querySelector('.history-h-arrow')
    );
  });
  document.querySelectorAll('.season-strip-outer').forEach(function (outer) {
    initEndScroll(outer.querySelector('.season-strip-scroll'), outer.querySelector('.season-strip-fade-left'), null);
  });
})();
