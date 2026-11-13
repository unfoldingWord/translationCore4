/* tC4 Help — right-hand "On this page" Contents rail.
 * Builds from h2 (and nested h3) in main.content; scroll-spy + collapse toggle. */
(function () {
  'use strict';
  var main = document.getElementById('main');
  if (!main || main.dataset.noToc === '1') return;

  var headings = Array.prototype.slice.call(main.querySelectorAll('h2[id], h3[id]'));
  // Skip very short pages / home-like pages with no section ids
  if (headings.length < 2) return;

  var shell = document.querySelector('.shell');
  if (!shell) return;

  var aside = document.createElement('aside');
  aside.className = 'page-toc';
  aside.id = 'page-toc';
  aside.setAttribute('aria-label', 'On this page');

  var head = document.createElement('div');
  head.className = 'page-toc-head';

  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'page-toc-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', 'page-toc-list');
  toggle.innerHTML = '<span class="page-toc-chevron" aria-hidden="true"></span><span class="page-toc-label">On this page</span>';

  head.appendChild(toggle);
  aside.appendChild(head);

  var nav = document.createElement('nav');
  nav.className = 'page-toc-body';
  nav.id = 'page-toc-list';

  var ul = document.createElement('ul');
  ul.className = 'page-toc-list';

  // Give any repeated heading id a unique suffix so each Contents link
  // jumps to its own heading and only one link is marked active.
  var seen = {};
  headings.forEach(function (h) {
    if (seen[h.id]) {
      var base = h.id, n = 2;
      while (document.getElementById(base + '-' + n)) n++;
      h.id = base + '-' + n;
    }
    seen[h.id] = true;
  });

  headings.forEach(function (h) {
    var li = document.createElement('li');
    li.className = h.tagName === 'H3' ? 'page-toc-h3' : 'page-toc-h2';
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent.replace(/\s+/g, ' ').trim();
    a.dataset.tocTarget = h.id;
    li.appendChild(a);
    ul.appendChild(li);
  });
  nav.appendChild(ul);
  aside.appendChild(nav);

  // Insert after main so layout is: sidebar | content | page-toc
  if (main.nextSibling) shell.insertBefore(aside, main.nextSibling);
  else shell.appendChild(aside);
  shell.classList.add('has-page-toc');

  toggle.addEventListener('click', function () {
    var open = toggle.getAttribute('aria-expanded') !== 'false';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    aside.classList.toggle('is-collapsed', open);
  });

  // Scroll-spy
  var links = ul.querySelectorAll('a');
  function setActive(id) {
    links.forEach(function (a) {
      var on = a.dataset.tocTarget === id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }
  if ('IntersectionObserver' in window) {
    var map = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) map[e.target.id] = e.intersectionRatio;
        else delete map[e.target.id];
      });
      var best = null, bestR = 0;
      Object.keys(map).forEach(function (id) {
        if (map[id] > bestR) { bestR = map[id]; best = id; }
      });
      if (best) setActive(best);
    }, { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] });
    headings.forEach(function (h) { io.observe(h); });
  }
  if (headings[0]) setActive(headings[0].id);
})();
