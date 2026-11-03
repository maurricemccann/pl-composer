/* psyglass helper (S334·c5e2). Keeps each slider's fill in step with its value, and tags the window that lost focus (psydim). Load after glass.css. */
(function () {
  function sync(el) { var min = +el.min || 0, max = el.max === '' ? 100 : +el.max, v = max > min ? ((+el.value) - min) / (max - min) * 100 : 0; el.style.setProperty('--psy-v', v); }
  function all(root) { (root || document).querySelectorAll('input[type=range]').forEach(sync); }
  document.addEventListener('input', function (e) { if (e.target && e.target.matches && e.target.matches('input[type=range]')) sync(e.target); }, true);
  // shortcut: a value set by code fires no event, so ranges are re-read twice a second while the page is visible; upgrade when a setter hook exists
  all(); setInterval(function () { if (!document.hidden) all(); }, 500);
  window.addEventListener('blur', function () { document.querySelectorAll('.psydim').forEach(function (n) { n.classList.add('inactive'); }); });
  window.addEventListener('focus', function () { document.querySelectorAll('.psydim').forEach(function (n) { n.classList.remove('inactive'); }); });
  window.psyglass = { sync: sync, all: all };

  // psyglass.auto({ 'css selector': 'psyclass another' }): gives an app's existing elements the kit classes (and keeps doing so for elements added later), so no markup is rewritten
  function auto(map) {
    function run(root) { Object.keys(map).forEach(function (sel) { var cl = map[sel].split(' '); (root || document).querySelectorAll(sel).forEach(function (el) { cl.forEach(function (c) { el.classList.add(c); }); }); }); }
    run(); var t; new MutationObserver(function () { clearTimeout(t); t = setTimeout(run, 60); }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.psyglass.auto = auto;
})();
