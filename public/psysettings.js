/* psysettings (S334·c5e2, his ruling: "Every PWA we have should have a Settings page ... sliders so we can adjust to liking
   and font options ... notification enablers and setters ... anything settings related and adjustable to ui ... dark mode").
   One shared Settings panel for every app. Saves each value on this device (localStorage, key psy:<name>) and writes it to a
   CSS variable or a data- attribute on <html>. Load it in <head> (plain <script>, not deferred) so saved values apply before
   the first paint, then call psysettings.mount(el, options) where the Settings page wants the panel.
   Spec: Plans/SPEC — SETTINGS IN EVERY APP (S334).md */
(function () {
  var root = document.documentElement;
  var FONTS = [
    { id: 'house', label: 'House default', family: '' },
    { id: 'hand', label: 'His hand', family: "'PL-Hand-V2', system-ui, sans-serif", face: 'PL-Hand-V2' },
    { id: 'jost', label: 'Jost', family: "'Jost', system-ui, sans-serif", gf: 'Jost:wght@300;400;500' },
    { id: 'cormorant', label: 'Cormorant', family: "'Cormorant Garamond', Georgia, serif", gf: 'Cormorant+Garamond:wght@400;500;600' },
    { id: 'courier', label: 'Courier Prime', family: "'Courier Prime', ui-monospace, monospace", gf: 'Courier+Prime:wght@400;700' }
  ];
  // name: [default, min, max, step, label, unit]
  var SLIDERS = {
    blur: [26, 4, 48, 1, 'Glass blur', 'px'],
    clear: [50, 0, 100, 1, 'Glass see-through', '%'],
    tile: [11, 0, 20, 1, 'Tile strength', '%'],
    text: [100, 90, 130, 5, 'Text size', '%']
  };
  var DEFAULTS = { theme: 'system', font: 'house', motion: 'full', notify: 'off', debug: 'off', inspect: 'off', quietFrom: '', quietTo: '' };
  Object.keys(SLIDERS).forEach(function (k) { DEFAULTS[k] = SLIDERS[k][0]; });

  function get(k) { try { var v = localStorage.getItem('psy:' + k); return v === null ? DEFAULTS[k] : (typeof DEFAULTS[k] === 'number' ? +v : v); } catch (e) { return DEFAULTS[k]; } }
  function set(k, v) { try { if (v === DEFAULTS[k]) localStorage.removeItem('psy:' + k); else localStorage.setItem('psy:' + k, String(v)); } catch (e) {} apply(); notify(k, v); }
  var listeners = [];
  function notify(k, v) { listeners.forEach(function (fn) { try { fn(k, v); } catch (e) {} }); }

  var hand = '/fonts/PL-Hand-V2.ttf';
  function loadFont(f) {
    if (!f || (!f.gf && !f.face) || document.getElementById('psyfont-' + f.id)) return;
    var el;
    if (f.gf) { el = document.createElement('link'); el.rel = 'stylesheet'; el.href = 'https://fonts.googleapis.com/css2?family=' + f.gf + '&display=swap'; }
    else { el = document.createElement('style'); el.textContent = "@font-face{font-family:'" + f.face + "';src:url('" + hand + "') format('truetype');font-display:swap}"; }
    el.id = 'psyfont-' + f.id; document.head.appendChild(el);
  }

  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    // an app whose theme is decided elsewhere puts data-psytheme-fixed="<attr>" on <html>: the panel shows no theme row and
    // the glass follows that attribute (the storefront: data-psytheme-fixed="theme" follows the Creator Signal's data-theme)
    var fixed = root.getAttribute('data-psytheme-fixed');
    if (fixed !== null) root.dataset.psytheme = fixed && root.getAttribute('data-' + fixed) === 'dark' ? 'dark' : 'light';
    else { var theme = get('theme'); root.dataset.psytheme = theme === 'system' ? (dark && dark.matches ? 'dark' : 'light') : theme; }
    var c = get('clear') / 100; // 0 = solid, 1 = most see-through
    root.style.setProperty('--psyglass-blur', get('blur') + 'px');
    root.style.setProperty('--psyclear', c);
    root.style.setProperty('--psyground-strength', get('tile') / 100);
    root.style.fontSize = get('text') === 100 ? '' : get('text') + '%';
    root.style.setProperty('--psytext', get('text') / 100); // for apps that size type in px
    var f = FONTS.filter(function (x) { return x.id === get('font'); })[0] || FONTS[0];
    if (f.family) { loadFont(f); root.style.setProperty('--psyfont-body', f.family); root.dataset.psyfont = f.id; }
    else { root.style.removeProperty('--psyfont-body'); delete root.dataset.psyfont; }
    if (get('motion') === 'reduce') root.dataset.psymotion = 'reduce'; else delete root.dataset.psymotion;
  }
  if (dark && dark.addEventListener) dark.addEventListener('change', function () { if (get('theme') === 'system') apply(); });
  var fx = root.getAttribute('data-psytheme-fixed');
  if (fx && window.MutationObserver) new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-' + fx] });

  // quiet hours: true when the given time (default now) falls inside the saved window; a window may cross midnight
  function quiet(at) {
    var a = get('quietFrom'), b = get('quietTo'); if (!a || !b) return false;
    var d = at || new Date(), m = d.getHours() * 60 + d.getMinutes();
    function mins(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
    var x = mins(a), y = mins(b); return x <= y ? (m >= x && m < y) : (m >= x || m < y);
  }
  // may this notification type show now? (the app asks before it shows one)
  function allowed(type, at) { return get('notify') === 'on' && get('notify:' + type) !== 'off' && !quiet(at); }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') el.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]); else el.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function row(label, control, note) { return h('div', { class: 'psyrow psysettings-row' }, [h('span', { class: 'psysettings-label', text: label }), control, note ? h('span', { class: 'psysettings-note', text: note }) : null]); }
  function segment(name, opts) {
    var wrap = h('div', { class: 'psysegment', role: 'radiogroup', 'aria-label': name });
    opts.forEach(function (o) {
      var b = h('button', { type: 'button', role: 'radio', text: o[1], onclick: function () { set(name, o[0]); paint(); } });
      wrap.appendChild(b);
    });
    function paint() { [].forEach.call(wrap.children, function (b, i) { var on = opts[i][0] === get(name); b.setAttribute('aria-checked', on); b.classList.toggle('active', on); }); }
    paint(); return wrap;
  }
  function slider(name) {
    var s = SLIDERS[name], out = h('span', { class: 'psysettings-value' });
    var r = h('input', { type: 'range', class: 'psyslide', min: s[1], max: s[2], step: s[3], 'aria-label': s[4] });
    r.value = get(name); out.textContent = r.value + s[5];
    r.addEventListener('input', function () { set(name, +r.value); out.textContent = r.value + s[5]; });
    if (window.psyglass) window.psyglass.sync(r);
    return h('div', { class: 'psysettings-slide' }, [r, out]);
  }
  function toggle(name, on, off, label) {
    var c = h('input', { type: 'checkbox', class: 'psyswitch', 'aria-label': label });
    c.checked = get(name) === on; c.addEventListener('change', function () { set(name, c.checked ? on : off); });
    return c;
  }

  // mount(el, { notifications: [{ type, label }], enableNotifications: async () => 'on'|'blocked'|'off', extra: (section) => void, handFont: url,
  //              theme: false (no theme row), themeNote: text, hide: ['tile', ...] })
  function mount(el, o) {
    o = o || {}; if (o.handFont) hand = o.handFont;
    el.classList.add('psysettings'); el.innerHTML = '';
    var look = h('section', { class: 'psyglass psyglass--card psysettings-card' }, [h('h2', { class: 'psyheading', text: 'Appearance' })]);
    if (o.theme !== false) look.appendChild(row('Theme', segment('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]), o.themeNote));
    Object.keys(SLIDERS).forEach(function (k) { if (!(o.hide || []).includes(k)) look.appendChild(row(SLIDERS[k][4], slider(k))); });  // o.hide: rows an app has no use for
    var fontSel = h('select', { class: 'psyfield', 'aria-label': 'Font' });
    FONTS.forEach(function (f) { var op = h('option', { value: f.id, text: f.label }); if (f.id === get('font')) op.selected = true; fontSel.appendChild(op); });
    fontSel.addEventListener('change', function () { set('font', fontSel.value); });
    look.appendChild(row('Font', fontSel, 'Reading text; headlines keep their faces'));
    look.appendChild(row('Reduce motion', toggle('motion', 'reduce', 'full', 'Reduce motion')));
    el.appendChild(look);

    var note = h('section', { class: 'psyglass psyglass--card psysettings-card' }, [h('h2', { class: 'psyheading', text: 'Notifications' })]);
    if (o.notifications === false) note = null;  // an app with its own notification section (or none to speak of)
    var types = o.notifications || [];
    if (!note) { /* skipped */ }
    else if (!types.length) note.appendChild(h('p', { class: 'psysettings-note', text: 'This app sends no notifications yet.' }));
    else {
      var state = h('span', { class: 'psysettings-note' });
      var en = h('input', { type: 'checkbox', class: 'psyswitch', 'aria-label': 'Enable notifications' });
      en.checked = get('notify') === 'on';
      function showState() { var p = window.Notification ? Notification.permission : 'unsupported'; state.textContent = p === 'denied' ? 'Blocked in the phone\'s settings' : p === 'unsupported' ? 'Not supported on this device' : (get('notify') === 'on' ? 'On' : 'Off'); }
      en.addEventListener('change', async function () {
        if (!en.checked) { set('notify', 'off'); showState(); return; }
        var r = o.enableNotifications ? await o.enableNotifications() : (window.Notification ? await Notification.requestPermission() : 'denied');
        var ok = r === 'on' || r === 'granted'; en.checked = ok; set('notify', ok ? 'on' : 'off'); showState();
      });
      showState(); note.appendChild(row('Enable', en)); note.appendChild(state);
      types.forEach(function (t) {
        var c = h('input', { type: 'checkbox', class: 'psyswitch', 'aria-label': t.label });
        c.checked = get('notify:' + t.type) !== 'off';
        c.addEventListener('change', function () { try { if (c.checked) localStorage.removeItem('psy:notify:' + t.type); else localStorage.setItem('psy:notify:' + t.type, 'off'); } catch (e) {} notify('notify:' + t.type, c.checked ? 'on' : 'off'); });
        note.appendChild(row(t.label, c));
      });
      function time(name) { var i = h('input', { type: 'time', class: 'psyfield', 'aria-label': name }); i.value = get(name); i.addEventListener('change', function () { set(name, i.value); }); return i; }
      note.appendChild(row('Quiet hours', h('div', { class: 'psysettings-slide' }, [time('quietFrom'), h('span', { text: 'to' }), time('quietTo')])));
    }
    if (note) el.appendChild(note);

    // S335 Debug mode: a switch, the key (pasted once, never shown) and the last send result
    if (o.debug !== false) {
      var dsec = h('section', { class: 'psyglass psyglass--card psysettings-card' }, [h('h2', { class: 'psyheading', text: 'Debug' })]);
      var dst = h('span', { class: 'psysettings-note' }), dinp = h('input', { type: 'password', class: 'psyfield', autocomplete: 'off', placeholder: 'Paste debug key', 'aria-label': 'Debug key' }), dbtn = h('button', { type: 'button', class: 'psybutton', text: 'Save' }), dmsg = h('span', { class: 'psysettings-note' });
      function dshow() { var hasKey = !!dbgKey(); dst.textContent = (get('debug') === 'on' ? 'On' : 'Off') + ' \u00b7 key ' + (hasKey ? 'Set' : 'Not set') + (DBG.last ? ' \u00b7 ' + DBG.last : '') + (DBG.sent ? ' \u00b7 ' + DBG.sent + ' events sent' : ''); dst.style.color = hasKey ? '' : '#b3321f'; }
      dsec.appendChild(row('Debug mode', toggle('debug', 'on', 'off', 'Debug mode'), 'Sends this app\u2019s errors and window numbers so a session can see what you see'));
      dsec.appendChild(row('Remote inspect', toggle('inspect', 'on', 'off', 'Remote inspect'), 'Lets a session ask this app read-only questions (element sizes, styles, state). Off by itself after 15 minutes; a banner shows while on'));
      dsec.appendChild(row('Status', dst));
      dsec.appendChild(row('', h('div', { class: 'psysettings-slide' }, [dinp, dbtn])));
      dsec.appendChild(dmsg);
      dbtn.addEventListener('click', function () { var v = dinp.value.trim(); if (!/^[0-9a-f]{48}$/.test(v)) { dmsg.textContent = 'That is not the debug key (48 characters)'; return; } try { localStorage.setItem('psy:debugkey', v); } catch (e) {} dinp.value = ''; dmsg.textContent = 'Saved'; if (get('debug') === 'on') dbgSnapshot('key saved'); dshow(); });
      listeners.push(function (k) { if (k === 'debug' || k === 'debug-status') dshow(); });
      dshow(); el.appendChild(dsec);
    }

    // S335 keys: o.keys = [{ label, hint, status: async () => bool, save: async (value) => bool }]; the value is never shown or kept here
    if (o.keys && o.keys.length) {
      var ks = h('section', { class: 'psyglass psyglass--card psysettings-card' }, [h('h2', { class: 'psyheading', text: 'Keys' })]);
      o.keys.forEach(function (k) {
        var chip = h('span', { class: 'psysettings-note', text: 'Checking...' }), msg = h('span', { class: 'psysettings-note' });
        var inp = h('input', { type: 'password', class: 'psyfield', autocomplete: 'off', placeholder: 'Paste key', 'aria-label': k.label + ' key' });
        var btn = h('button', { type: 'button', class: 'psybutton', text: 'Save' });
        function show(ok) { chip.textContent = ok === null ? 'Could not check' : ok ? 'Set' : 'Not set'; chip.style.fontWeight = '600'; chip.style.opacity = ok ? '1' : '.9'; chip.style.color = ok ? '#2f7d3a' : '#b3321f'; }
        Promise.resolve().then(function () { return k.status(); }).then(show, function () { show(null); });
        btn.addEventListener('click', async function () {
          var v = inp.value.trim(); if (!v) { msg.textContent = 'Paste the key first'; return; }
          btn.disabled = true; msg.textContent = 'Saving...';
          var ok = false; try { ok = await k.save(v); } catch (e) {}
          inp.value = ''; btn.disabled = false; msg.textContent = ok ? 'Saved' : 'Not accepted, check the key';
          try { show(await k.status()); } catch (e) { show(null); }
        });
        ks.appendChild(row(k.label, chip, k.hint));
        if (k.save) { ks.appendChild(row('', h('div', { class: 'psysettings-slide' }, [inp, btn]))); ks.appendChild(msg); }   // no save = a server key, status only
      });
      el.appendChild(ks);
    }

    if (o.extra) { var more = h('section', { class: 'psyglass psyglass--card psysettings-card' }); o.extra(more, { row: row, h: h }); if (more.childNodes.length) el.appendChild(more); }
    el.appendChild(h('button', { type: 'button', class: 'psybutton psysettings-reset', text: 'Reset to house defaults', onclick: function () {
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('psy:') === 0 && k.indexOf('psy:notify') !== 0 && k !== 'psy:debugkey' && k !== 'psy:device') localStorage.removeItem(k); }); } catch (e) {}
      apply(); notify('reset'); mount(el, o);
    } }));
  }

  // S335 keys alert: an app calls checkKeys(keys) at launch with the same rows it gives mount(); if one reads Not set and the Keys alert
  // switch is on (type 'keys'), one notification a day names what is missing and opens Settings. Never carries a value.
  async function checkKeys(keys, settingsUrl) {
    try {
      var miss = []; for (var i = 0; i < keys.length; i++) { var ok = null; try { ok = await keys[i].status(); } catch (e) {} if (ok === false) miss.push(keys[i].label); }
      notify('keys-missing', miss.join('|')); if (!miss.length || !allowed('keys', new Date())) return miss;
      var last = +localStorage.getItem('psy:keysAlertAt') || 0; if (Date.now() - last < 864e5) return miss;
      localStorage.setItem('psy:keysAlertAt', String(Date.now()));
      var title = miss.length === 1 ? 'A key is missing' : miss.length + ' keys are missing', opts = { body: miss.join(', ') + ' is not set on this device', tag: 'psy-keys', data: { url: settingsUrl || '/settings' } };
      var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) reg.showNotification(title, opts); else if (window.Notification && Notification.permission === 'granted') new Notification(title, opts);
      return miss;
    } catch (e) { return []; }
  }

  // S335 viewport: iOS 26+/27 standalone apps start with a short window then grow, so fixed bottom bars float. Keep --app-height on the
  // real window height for every app that loads this file (same fix as we-promise/sure#995); body never sits shorter than it.
  (function () { try {
    var r = document.documentElement, tries = 0, n = 0;
    // self-adjust: a home-screen app whose window is more than 20px shorter than the screen (iOS 27 beta) gets a nudge: the viewport tag is
    // rewritten for an instant, which makes iOS measure the window again. Up to 6 tries per launch, portrait only, never in a browser tab.
    function poke() { var m = document.querySelector('meta[name=viewport]'); if (!m) return; var c = m.getAttribute('content') || ''; m.setAttribute('content', /initial-scale=/.test(c) ? c.replace(/initial-scale=[^,]+/, 'initial-scale=1.0001') : c + ', initial-scale=1.0001'); setTimeout(function () { m.setAttribute('content', c); }, 80); }
    var set = function () { r.style.setProperty('--app-height', window.innerHeight + 'px'); if (navigator.standalone && screen.height > screen.width && screen.height - window.innerHeight > 20 && tries < 6) { tries++; poke(); } };
    set(); ['resize', 'orientationchange'].forEach(function (e) { window.addEventListener(e, set); });
    // S335 (his phone: /curate started with the gap, any other tab fixed it): a returning app gets its tries back, so the nudge runs again whenever the window comes back or the page is shown
    function again() { tries = 0; n = 0; set(); if (!iv) iv = setInterval(tick, 1000); } window.addEventListener('pageshow', again); document.addEventListener('visibilitychange', function () { if (!document.hidden) again(); });
    var iv = 0; function tick() { set(); if (++n > 15) { clearInterval(iv); iv = 0; } } iv = setInterval(tick, 1000);
    var st = document.createElement('style'); st.textContent = 'html,body{height:var(--app-height,100%)}';   /* the gallery's own CSS did this and was the app that settled; now every app does (we-promise/sure#995 method) */ (document.head || r).appendChild(st);
  } catch (e) {} })();

  // S335 Debug mode (his ask: "have my phone tell you in code everything you need to know"). Off by default. When Debug is on AND a key is pasted,
  // this app sends its errors, failed requests, console warnings and window numbers to pl-cron /api/debug; a session reads them with the house token.
  // Tokens and long hex strings are scrubbed before sending; setting values are sent, key values never are.
  var DBG_URL = 'https://pl-cron.psychedluxuries.com/api/debug';
  var DBG = { q: [], sent: 0, last: '', timer: 0, on: false, hooked: false };
  function dbgKey() { try { return localStorage.getItem('psy:debugkey') || ''; } catch (e) { return ''; } }
  // S338 the name rows are filed under: <html data-psyapp="pl-world"> names an app whose host would not (a workers.dev host, localhost); else the host
  function appName() { return root.getAttribute('data-psyapp') || (location.hostname + (location.pathname.indexOf('/paint') === 0 ? '/paint' : '')); }
  function dbgDevice() { try { var d = localStorage.getItem('psy:device'); if (!d) { d = Math.random().toString(36).slice(2, 8); localStorage.setItem('psy:device', d); } return d; } catch (e) { return 'x'; } }
  function scrub(t) { return String(t).replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [x]').replace(/[A-Fa-f0-9]{32,}/g, '[hex]').replace(/([?&](?:key|token|k|auth)=)[^&\s]+/gi, '$1[x]'); }
  function dbgPush(level, kind, msg, data) {
    if (!DBG.on) return;
    DBG.q.push({ t: Date.now(), level: level, kind: kind, msg: scrub(msg).slice(0, 600), data: data }); if (DBG.q.length > 200) DBG.q.shift();
    if (!DBG.timer) DBG.timer = setTimeout(dbgFlush, 4000);
  }
  function dbgFlush(keep) {
    DBG.timer = 0; var key = dbgKey(); if (!DBG.q.length || !key) return;
    var ev = DBG.q.splice(0, 100), app = appName();
    try {
      fetch(DBG_URL, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ app: app, device: dbgDevice(), events: ev }), keepalive: keep === true, cache: 'no-store' })
        .then(function (r) { DBG.last = r.ok ? 'sent ok' : 'refused (' + r.status + ')'; if (r.ok) DBG.sent += ev.length; notify('debug-status', DBG.last); })
        .catch(function () { DBG.last = 'offline, will retry'; DBG.q = ev.concat(DBG.q).slice(-200); });
    } catch (e) {}
    if (DBG.q.length) DBG.timer = setTimeout(dbgFlush, 4000);
  }
  function dbgSnapData() {
    try {
      var pr = document.createElement('div'); pr.style.cssText = 'position:fixed;left:0;top:0;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) 0;visibility:hidden'; document.body.appendChild(pr);
      var cs = getComputedStyle(pr), top = cs.paddingTop, bot = cs.paddingBottom; pr.remove();
      var vv = window.visualViewport, nav = document.querySelector('.pl-tab-bar, .o-tabbar'), nr = nav && nav.getBoundingClientRect();
      var st = {}; Object.keys(DEFAULTS).forEach(function (k) { st[k] = get(k); });
      return { ih: innerHeight, iw: innerWidth, sh: screen.height, sw: screen.width, vv: vv ? Math.round(vv.height) : null, ch: root.clientHeight, top: top, bot: bot, appHeight: root.style.getPropertyValue('--app-height'),
        standalone: !!navigator.standalone, dpr: devicePixelRatio, scrollY: Math.round(scrollY), navTop: nr ? Math.round(nr.top) : null, navBottom: nr ? Math.round(nr.bottom) : null, path: location.pathname,
        notif: window.Notification ? Notification.permission : 'none', sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), online: navigator.onLine, ua: navigator.userAgent.slice(0, 140), settings: st, app: appState() };
    } catch (e) { return { error: String(e) }; }
  }
  // S338 an app's own numbers (window.psyDebugState, the same hook Remote inspect's `state` reads) ride every snapshot
  function appState() { try { return typeof window.psyDebugState === 'function' ? window.psyDebugState() : undefined; } catch (e) { return 'psyDebugState failed: ' + e.message; }
  }
  function dbgSnapshot(why) { dbgPush('info', 'snapshot', why, dbgSnapData()); }
  function dbgEnable(on) {
    DBG.on = !!on; if (!on) { DBG.q = []; return; }
    if (!DBG.hooked) {
      DBG.hooked = true;
      window.addEventListener('error', function (e) { dbgPush('error', 'js', (e.message || 'error') + ' @' + (e.filename || '').split('/').slice(-2).join('/') + ':' + e.lineno + ':' + e.colno, { stack: String((e.error && e.error.stack) || '').slice(0, 800) }); });
      window.addEventListener('unhandledrejection', function (e) { var r = e.reason; dbgPush('error', 'promise', String((r && r.message) || r), { stack: String((r && r.stack) || '').slice(0, 800) }); });
      ['error', 'warn'].forEach(function (lv) { var o = console[lv]; console[lv] = function () { try { dbgPush(lv === 'error' ? 'error' : 'warn', 'console', [].map.call(arguments, function (a) { return a && a.stack ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a)); }).join(' ')); } catch (e) {} return o.apply(console, arguments); }; });
      var of = window.fetch; window.fetch = function (input, init) {
        var u = typeof input === 'string' ? input : (input && input.url) || '', t0 = Date.now(), m = (init && init.method) || (input && input.method) || 'GET';
        if (u.indexOf('/api/debug') >= 0) return of.apply(this, arguments);
        return of.apply(this, arguments).then(function (r) { if (r.status >= 400) dbgPush('error', 'fetch', m + ' ' + u.split('?')[0] + ' -> ' + r.status, { ms: Date.now() - t0 }); return r; },
          function (err) { dbgPush('error', 'fetch', m + ' ' + u.split('?')[0] + ' failed: ' + (err && err.message), { ms: Date.now() - t0 }); throw err; });
      };
      document.addEventListener('visibilitychange', function () { if (document.hidden) dbgFlush(true); else dbgSnapshot('visible'); });
      window.addEventListener('pagehide', function () { dbgFlush(true); });
      window.addEventListener('resize', function () { dbgSnapshot('resize'); });
      setInterval(function () { if (!document.hidden && DBG.on) dbgSnapshot('tick'); }, 30000);
    }
    var go = function () { dbgSnapshot('start'); }; if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }
  listeners.push(function (k, v) { if (k === 'debug') dbgEnable(v === 'on'); });
  if (get('debug') === 'on') dbgEnable(true);

  // S335 Remote inspect (his ask: see the app, not only the screen; his scope ruling: read-only questions). While the Remote inspect switch is on, this app polls
  // pl-cron for questions a session has asked and answers them from a FIXED list below. It never runs code that arrives from the server. Off by default, switches
  // itself off after 15 minutes, and shows a banner while it is on. Needs the debug key (the same one Debug mode uses).
  var INSPECT_MS = 15 * 60 * 1000, INS = { timer: 0, banner: null };
  function qs(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function outline(el, depth, out) {
    if (out.length >= 200) return;
    var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    var r = el.getBoundingClientRect(), txt = (el.children.length === 0 ? (el.textContent || '').trim().slice(0, 40) : '');
    out.push(new Array(depth + 1).join('  ') + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']' + (txt ? ' "' + txt + '"' : ''));
    if (depth < 4) for (var i = 0; i < el.children.length && out.length < 200; i++) outline(el.children[i], depth + 1, out);
  }
  var ASK = {
    snapshot: function () { return dbgSnapData(); },
    rect: function (a) { var el = qs(a); if (!el) return 'no match for ' + a; var r = el.getBoundingClientRect(), c = getComputedStyle(el); return { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, display: c.display, position: c.position, visibility: c.visibility, opacity: c.opacity, zIndex: c.zIndex, overflow: c.overflow, pointerEvents: c.pointerEvents }; },
    css: function (a) { var parts = String(a).split(' '), el = qs(parts[0]); if (!el) return 'no match for ' + parts[0]; var c = getComputedStyle(el), props = parts.slice(1).length ? parts.slice(1) : ['display', 'position', 'width', 'height', 'padding', 'margin', 'color', 'background-color', 'font-size', 'transform']; var o = {}; props.slice(0, 20).forEach(function (k) { o[k] = c.getPropertyValue(k); }); return o; },
    dom: function (a) { var el = qs(a || 'body'); if (!el) return 'no match for ' + a; var out = []; outline(el, 0, out); return out.join('\n'); },
    errors: function () { return DBG.q.filter(function (e) { return e.level !== 'info'; }).slice(-30).map(function (e) { return new Date(e.t).toISOString().slice(11, 19) + ' ' + e.kind + ' ' + e.msg; }); },
    state: function () { var o = { settings: {}, storageKeys: [], app: null }; Object.keys(DEFAULTS).forEach(function (k) { o.settings[k] = get(k); }); try { o.storageKeys = Object.keys(localStorage).map(function (k) { return k + ' (' + (localStorage.getItem(k) || '').length + ' chars)'; }); } catch (e) {} try { if (typeof window.psyDebugState === 'function') o.app = window.psyDebugState(); } catch (e) { o.app = 'psyDebugState failed: ' + e.message; } return o; }
  };
  function inspectOn() { var u = 0; try { u = +localStorage.getItem('psy:inspectUntil') || 0; } catch (e) {} return get('inspect') === 'on' && u > Date.now(); }
  function inspectBanner(on) {
    if (on && !INS.banner && document.body) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = 'A session can inspect this app. Tap to stop.'; INS.banner = b;
      b.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 4px);z-index:2147483000;padding:8px 12px;border-radius:14px;border:1px solid #b3321f;background:rgba(40,12,8,.92);color:#fff;font:12px/1.3 system-ui,sans-serif;letter-spacing:.04em';
      b.addEventListener('click', function () { set('inspect', 'off'); }); document.body.appendChild(b);
    } else if (!on && INS.banner) { INS.banner.remove(); INS.banner = null; }
  }
  function inspectPoll() {
    if (!inspectOn()) { set('inspect', 'off'); inspectBanner(false); clearInterval(INS.timer); INS.timer = 0; return; }
    inspectBanner(true); var key = dbgKey(); if (!key || document.hidden) return;
    var app = appName(), H = { Authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    fetch('https://pl-cron.psychedluxuries.com/api/debug/cmd?app=' + encodeURIComponent(app) + '&device=' + dbgDevice(), { headers: H, cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { cmds: [] }; }).then(function (j) {
      (j.cmds || []).forEach(function (c) {
        var res, ok = true; try { var f = ASK[c.cmd]; if (!f) { ok = false; res = 'unknown command ' + c.cmd + '; known: ' + Object.keys(ASK).join(', '); } else res = f(c.arg); } catch (e) { ok = false; res = 'failed: ' + e.message; }
        fetch('https://pl-cron.psychedluxuries.com/api/debug/result', { method: 'POST', headers: H, body: JSON.stringify({ id: c.id, ok: ok, result: scrub(typeof res === 'string' ? res : JSON.stringify(res)) }) }).catch(function () {});
      });
    }).catch(function () {});
  }
  function inspectEnable(on) {
    if (on) { try { localStorage.setItem('psy:inspectUntil', String(Date.now() + INSPECT_MS)); } catch (e) {} if (!INS.timer) INS.timer = setInterval(inspectPoll, 3000); inspectPoll(); }
    else { try { localStorage.removeItem('psy:inspectUntil'); } catch (e) {} inspectBanner(false); clearInterval(INS.timer); INS.timer = 0; }
  }
  listeners.push(function (k, v) { if (k === 'inspect') inspectEnable(v === 'on'); });
  if (inspectOn()) { INS.timer = setInterval(inspectPoll, 3000); document.addEventListener('DOMContentLoaded', inspectPoll); } else if (get('inspect') === 'on') set('inspect', 'off');

  apply();
  window.psysettings = { get: get, set: set, apply: apply, mount: mount, allowed: allowed, quiet: quiet, checkKeys: checkKeys, onChange: function (fn) { listeners.push(fn); }, fonts: FONTS, sliders: SLIDERS,
    // S338 an app's own events (PL World's clipping) and its own snapshot cadence; both are no-ops while Debug is off
    debug: { on: function () { return DBG.on; }, push: dbgPush, snapshot: dbgSnapshot } };
})();
