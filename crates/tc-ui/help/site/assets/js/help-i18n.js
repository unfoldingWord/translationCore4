/* The Desktop help's language menu (a <details>): close it on Escape or a
 * click elsewhere. The pick itself is remembered by /assets/js/locale.js. */
(function () {
  var menu = document.querySelector('.help-lang');
  if (!menu) return;
  document.addEventListener('click', function (e) {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
})();
