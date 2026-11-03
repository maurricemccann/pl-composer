// node tools/handbook/build.mjs -> src/handbook/index.html (one self-contained page: text, the shots, search, the index of every feature)
import fs from 'node:fs';
import { describe } from './callouts.mjs';
import path from 'node:path';
import { CHAPTERS } from './content.mjs';
import { FEATURES } from './features.mjs';
const OUT = path.resolve('public/handbook');
const shots = JSON.parse(fs.readFileSync(path.join(OUT, 'shots.json'), 'utf8'));
const esc = s => String(s).replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;').replace(/</g, m => m);   // content carries its own light markup (b, p)
const plain = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sectionIds = new Set(CHAPTERS.flatMap(c => c.sections.map(s => s.id)));
const missing = FEATURES.flatMap(([, rows]) => rows.filter(r => !sectionIds.has(r[2])).map(r => r[0] + ' -> ' + r[2]));
if (missing.length) { console.error('features pointing at no section:\n' + missing.join('\n')); process.exit(1); }
const noShot = CHAPTERS.flatMap(c => c.sections.filter(s => s.shot && !shots[s.shot]).map(s => s.id + ' -> ' + s.shot));
if (noShot.length) { console.error('sections pointing at no shot:\n' + noShot.join('\n')); process.exit(1); }

const noDesc = [];
const fig = id => {
  const s = shots[id]; const lg = s.callouts.map(c => { const d = describe(id, c.label); if (!d) noDesc.push(id + ' | ' + c.label); return `<li value="${c.n}"><b>${plain(c.label)}</b><span class="cd">${d || ''}</span></li>`; }).join('');
  return `<figure><img class="zoomable" src="img/${id}.jpg" alt="${plain(s.title)}" loading="lazy"><button class="enl" type="button">Enlarge this picture</button>${lg ? `<ol class="legend">${lg}</ol>` : ''}</figure>`;
};
const section = (c, s) => {
  let h = `<section class="sec" id="${s.id}" data-t="${plain(s.title)}"><h3>${plain(s.title)}</h3>`;
  if (s.lead) h += `<p class="lead">${s.lead}</p>`;
  if (s.shot) h += fig(s.shot);
  if (s.body) h += s.body;
  if (s.steps) h += '<h4>How to</h4><ol class="steps">' + s.steps.map(x => `<li>${x}</li>`).join('') + '</ol>';
  if (s.table) h += '<table>' + s.table.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('') + '</table>';
  if (s.tips) h += s.tips.map(t => `<aside class="tip"><b>Good to know</b> ${t}</aside>`).join('');
  return h + '</section>';
};
const toc = CHAPTERS.map((c, i) => `<div class="tc"><a href="#ch-${c.id}" class="tch">${i + 1}. ${plain(c.title)}</a>${c.sections.map(s => `<a href="#${s.id}" class="tcs">${plain(s.title)}</a>`).join('')}</div>`).join('')
  + `<div class="tc"><a href="#ch-index" class="tch">${CHAPTERS.length + 1}. Every feature</a></div>`;
const body = CHAPTERS.map((c, i) => `<h2 id="ch-${c.id}"><span>${i + 1}</span>${plain(c.title)}</h2>` + c.sections.map(s => section(c, s)).join('')).join('');
const count = FEATURES.reduce((n, [, r]) => n + r.length, 0);
const index = `<h2 id="ch-index"><span>${CHAPTERS.length + 1}</span>Every feature</h2><p class="lead">${count} features, in the order of the app. Tap one to go to where it is explained.</p>` + FEATURES.map(([g, rows]) => `<section class="sec" data-t="${plain(g)}"><h3>${plain(g)}</h3><ul class="idx">${rows.map(([n, d, id]) => `<li><a href="#${id}">${plain(n)}</a>${d ? ` <span>${plain(d)}</span>` : ''}</li>`).join('')}</ul></section>`).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PL Composer handbook</title>
<style>
@font-face { font-family: 'PL Hand'; src: url('../fonts/PL-Hand-V1.ttf'); }
:root { --accent: #c9a84c; --accent2: #e7cf86; --ground: #0e0c08; --card: #1a1710; --line: #2c2718; --text: #efe9dc; --dim: #a39a82; }
* { box-sizing: border-box; } html { scroll-behavior: smooth; scroll-padding-top: 16px; }
body { margin: 0; background: var(--ground); color: var(--text); font: 16px/1.6 system-ui, Segoe UI, sans-serif; display: flex; min-height: 100vh; }
nav { position: sticky; top: 0; height: 100vh; width: 290px; flex: none; overflow-y: auto; padding: 18px 14px 40px; border-right: 1px solid var(--line); background: #0b0a06; }
nav h1 { font: 26px/1.1 'PL Hand'; color: var(--accent); margin: 0 0 4px; } nav .sub { color: var(--dim); font-size: 13px; margin-bottom: 12px; }
#q { width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; margin-bottom: 8px; }
#n { color: var(--dim); font-size: 12px; margin-bottom: 8px; min-height: 16px; }
.tc { margin: 10px 0; } .tch { display: block; font: 17px 'PL Hand'; color: var(--accent2); text-decoration: none; padding: 3px 0; } .tcs { display: block; color: var(--dim); text-decoration: none; padding: 1px 0 1px 12px; font-size: 14px; } .tcs:hover, .tch:hover { color: var(--text); }
main { flex: 1; max-width: 960px; padding: 30px 38px 120px; margin: 0 auto; }
.cover { text-align: center; padding: 40px 0 30px; border-bottom: 1px solid var(--line); margin-bottom: 20px; } .cover h1 { font: 64px/1 'PL Hand'; color: var(--accent); margin: 0; } .cover p { color: var(--dim); margin: 10px 0 0; font-size: 17px; }
h2 { font: 38px/1.1 'PL Hand'; color: var(--accent); margin: 64px 0 8px; display: flex; align-items: center; gap: 14px; border-top: 1px solid var(--line); padding-top: 26px; } h2 span { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: var(--ground); display: grid; place-items: center; font: 24px 'PL Hand'; flex: none; }
h3 { font: 26px/1.2 'PL Hand'; color: var(--text); margin: 34px 0 6px; } h4 { font: 18px 'PL Hand'; color: var(--accent2); margin: 18px 0 4px; }
.lead { font-size: 17px; color: var(--text); }
figure { margin: 14px 0; } figure img { width: 100%; border-radius: 12px; border: 1px solid var(--line); display: block; } figure img.zoomable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.enl { margin: 8px 0 2px; background: transparent; color: var(--accent); border: 1px solid var(--line); border-radius: 999px; padding: 7px 16px; font: 600 13px system-ui; cursor: pointer; } .enl:hover { border-color: var(--accent); }
.legend li b { display: block; color: var(--text); } .legend li .cd { display: block; opacity: .82; line-height: 1.4; margin-top: 1px; }
#zv { position: fixed; inset: 0; z-index: 200; background: rgba(6, 5, 4, .97); } #zv[hidden] { display: none; } #zs { position: absolute; inset: 0; overflow: hidden; touch-action: none; cursor: grab; } #zs.drag { cursor: grabbing; } #zi { position: absolute; left: 0; top: 0; transform-origin: 0 0; user-select: none; -webkit-user-drag: none; max-width: none; border: 0; border-radius: 0; will-change: transform; }
#zbar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 8px; justify-content: center; padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(transparent, rgba(0, 0, 0, .85)); } #zbar button { background: #17130d; color: var(--accent); border: 1px solid var(--line); border-radius: 999px; padding: 10px 16px; font: 600 15px system-ui; min-width: 44px; } #zbar button:active { border-color: var(--accent); }
#zl { position: absolute; left: 0; right: 0; bottom: 0; max-height: 52vh; overflow: auto; background: #120f0a; border-top: 1px solid var(--line); padding: 14px 16px calc(78px + env(safe-area-inset-bottom, 0px)); } #zl[hidden] { display: none; } #zl .legend { columns: 1; margin: 0; }
.legend { columns: 1; column-gap: 28px; padding-left: 0; list-style: none; margin: 10px 0 0; counter-reset: x; font-size: 14px; } .legend li { break-inside: avoid; padding: 2px 0 2px 32px; position: relative; } .legend li::before { content: attr(value); position: absolute; left: 0; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--ground); font: 700 12px/22px system-ui; text-align: center; }
.steps { padding-left: 24px; } .steps li { margin: 6px 0; } .steps li::marker { color: var(--accent); font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 15px; } th { text-align: left; vertical-align: top; width: 34%; color: var(--accent2); font-weight: 600; padding: 7px 14px 7px 0; border-top: 1px solid var(--line); } td { padding: 7px 0; border-top: 1px solid var(--line); }
.tip { background: var(--card); border-left: 3px solid var(--accent); padding: 10px 14px; border-radius: 0 10px 10px 0; margin: 12px 0; font-size: 15px; } .tip b { color: var(--accent2); font-family: 'PL Hand'; font-size: 17px; font-weight: 400; margin-right: 6px; }
.idx { list-style: none; padding: 0; columns: 2; column-gap: 28px; } .idx li { break-inside: avoid; padding: 4px 0; border-bottom: 1px solid var(--line); } .idx a { color: var(--accent2); text-decoration: none; font-weight: 600; } .idx span { display: block; color: var(--dim); font-size: 13px; }
.hide { display: none !important; } mark { background: var(--accent); color: var(--ground); border-radius: 3px; }
@media (max-width: 860px) { body { display: block; } nav { position: static; height: auto; width: auto; border: 0; } main { padding: 20px 16px 80px; } .legend, .idx { columns: 1; } .cover h1 { font-size: 46px; } }
</style></head><body>
<nav><h1>PL Composer</h1><div class="sub">The handbook</div><input id="q" type="search" placeholder="Search the handbook" autocomplete="off"><div id="n"></div>${toc}</nav>
<main><div class="cover"><h1>PL Composer</h1><p>A painting app for your hand. Everything it does, in the order you will use it.</p><p class="sub">Tap any picture to enlarge it. Pinch or scroll to zoom, drag to move.</p></div>${body}${index}</main>
<div id="zv" hidden><div id="zs"><img id="zi" alt=""></div><div id="zl" hidden></div><div id="zbar"><button id="zout" type="button" aria-label="Zoom out">&minus;</button><button id="zin" type="button" aria-label="Zoom in">+</button><button id="zfit" type="button">Fit</button><button id="zlist" type="button">The list</button><button id="zx" type="button">Close</button></div></div>
<script>

(function () {
  var zv = document.getElementById('zv'), zs = document.getElementById('zs'), zi = document.getElementById('zi'), zl = document.getElementById('zl'), tap = null, pts = new Map(), st = { s: 1, x: 0, y: 0, fit: 1, w: 1, h: 1 }, pin = null, lastTap = 0;
  function vw() { return zs.clientWidth; } function vh() { return zs.clientHeight - 64; }
  function clamp() { var iw = st.w * st.s, ih = st.h * st.s, W = vw(), H = zs.clientHeight; st.x = iw <= W ? (W - iw) / 2 : Math.min(0, Math.max(W - iw, st.x)); st.y = ih <= H ? (H - ih - 54) / 2 : Math.min(0, Math.max(H - ih - 54, st.y)); }
  function paint() { clamp(); zi.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')'; }
  function zoomAt(f, cx, cy) { var ns = Math.max(st.fit * 0.8, Math.min(st.fit * 8, st.s * f)); f = ns / st.s; st.x = cx - (cx - st.x) * f; st.y = cy - (cy - st.y) * f; st.s = ns; paint(); }
  function fitIt() { st.fit = Math.min(vw() / st.w, vh() / st.h); st.s = st.fit; st.x = 0; st.y = 0; paint(); }
  function open(img) {
    zl.hidden = true; zl.innerHTML = ''; var fig = img.closest('figure'), lg = fig && fig.querySelector('.legend'); if (lg) zl.appendChild(lg.cloneNode(true)); document.getElementById('zlist').style.display = lg ? '' : 'none';
    zi.onload = function () { st.w = zi.naturalWidth; st.h = zi.naturalHeight; zi.style.width = st.w + 'px'; zi.style.height = st.h + 'px'; zv.hidden = false; fitIt(); }; zi.alt = img.alt; zi.src = img.currentSrc || img.src; if (zi.complete && zi.naturalWidth) zi.onload(); zv.hidden = false;
  }
  function close() { zv.hidden = true; pts.clear(); pin = null; }
  Array.prototype.forEach.call(document.querySelectorAll('img.zoomable'), function (im) { im.addEventListener('click', function () { open(im); }); });   // bound directly: iOS Safari does not send a click to a plain image through a document-level listener
  Array.prototype.forEach.call(document.querySelectorAll('.enl'), function (bt) { bt.addEventListener('click', function () { var im = bt.closest('figure').querySelector('img'); if (im) open(im); }); });
  document.getElementById('zx').onclick = close; document.getElementById('zin').onclick = function () { zoomAt(1.5, vw() / 2, vh() / 2); }; document.getElementById('zout').onclick = function () { zoomAt(1 / 1.5, vw() / 2, vh() / 2); }; document.getElementById('zfit').onclick = fitIt;
  document.getElementById('zlist').onclick = function () { zl.hidden = !zl.hidden; };
  zs.addEventListener('pointerdown', function (e) { if (!pts.size) tap = { x: e.clientX, y: e.clientY, moved: false, multi: false }; else if (tap) tap.multi = true; try { zs.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer has nothing to capture */ } pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); zs.classList.add('drag'); if (pts.size === 2) { var a = Array.from(pts.values()); pin = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: st.s, cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2, x: st.x, y: st.y }; } });
  zs.addEventListener('pointermove', function (e) {
    var p = pts.get(e.pointerId); if (!p) return;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
    if (pts.size === 1) { st.x += e.clientX - p.x; st.y += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; paint(); }
    else if (pts.size === 2 && pin) { p.x = e.clientX; p.y = e.clientY; var a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2, ns = Math.max(st.fit * 0.8, Math.min(st.fit * 8, pin.s * d / pin.d)), f = ns / pin.s; st.s = ns; st.x = cx - (pin.cx - pin.x) * f; st.y = cy - (pin.cy - pin.y) * f; paint(); }
  });
  function up(e) { pts.delete(e.pointerId); if (pts.size < 2) pin = null; if (!pts.size) zs.classList.remove('drag'); }
  zs.addEventListener('pointerup', function (e) { var was = tap; up(e); if (pts.size || !was || was.moved || was.multi) { lastTap = 0; return; } var now = Date.now(); if (now - lastTap < 320) { var r = zs.getBoundingClientRect(); if (st.s > st.fit * 1.2) fitIt(); else zoomAt(2.6, e.clientX - r.left, e.clientY - r.top); lastTap = 0; } else lastTap = now; }); zs.addEventListener('pointercancel', up);
  zs.addEventListener('wheel', function (e) { e.preventDefault(); var r = zs.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  addEventListener('resize', function () { if (!zv.hidden) fitIt(); });
  addEventListener('keydown', function (e) { if (zv.hidden) return; if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } else if (e.key === '+' || e.key === '=') zoomAt(1.4, vw() / 2, vh() / 2); else if (e.key === '-') zoomAt(1 / 1.4, vw() / 2, vh() / 2); else if (e.key === '0') fitIt(); }, true);
})();

const q = document.getElementById('q'), n = document.getElementById('n'), secs = [...document.querySelectorAll('.sec')];
q.oninput = () => { const t = q.value.trim().toLowerCase(); let hit = 0; for (const s of secs) { const ok = !t || s.textContent.toLowerCase().includes(t); s.classList.toggle('hide', !ok); if (ok) hit++; } for (const h of document.querySelectorAll('main h2')) h.classList.toggle('hide', !!t); n.textContent = t ? hit + ' of ' + secs.length + ' sections' : ''; };
addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } if (e.key === 'F1') { e.preventDefault(); parent.postMessage('handbook-close', '*'); } if (e.key === 'Escape') { if (q.value) { q.value = ''; q.oninput(); } else parent.postMessage('handbook-close', '*'); } });
</script></body></html>`;
if (noDesc.length) { console.error('callouts with no description (add them to tools/handbook/callouts.mjs):\n' + noDesc.join('\n')); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('handbook written:', CHAPTERS.length, 'chapters,', secs(), 'sections,', count, 'features,', (html.length / 1024).toFixed(0) + ' KB');
function secs() { return CHAPTERS.reduce((n, c) => n + c.sections.length, 0); }
