// PK.Joystick — touch controls: a virtual joystick on the left (steer, push up = accelerate, pull down = brake)
// and round SVG action buttons on the right (drift / skill / boost / item). Every control's size and the
// opacity are adjustable in a '⚙ 버튼 설정' panel (sliders, saved). The stick exposes analog values as
// PK.Joy { active, x, y } and also sends the arrow-key events the keyboard uses.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const touchy = (PK.Mobile && PK.Mobile.touchy) ||
    !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const DEAD = 0.12;                    // analog dead zone (fraction of the radius)
  const KEY_STEER = 0.3, KEY_BRAKE = 0.45;
  const ASPECT = 9 / 16;                // game is 16:9: h% of the height = h*9/16 % of the width
  const LS_CFG = 'pk_btn_cfg', LS_SIZE = 'pk_btn_size';
  // sizes in % of the game height; alpha = button opacity
  const DEFAULT = { joy: 56, drift: 28, boost: 21, skill: 21, item: 18, alpha: 0.85 };
  const PRESET = { s: 0.8, m: 1, l: 1.2 };
  const RANGE = { joy: [30, 80], drift: [14, 42], boost: [12, 36], skill: [12, 36], item: [10, 32], alpha: [0.3, 1] };
  const LABEL = { joy: '조이스틱', drift: '드리프트', boost: '부스터', skill: '스킬', item: '아이템', alpha: '불투명도' };

  // SVG icons (white on transparent), drawn behind each button's text label
  const svg = (body) => 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>') + '")';
  const ICON = {
    drift: svg('<path d="M10 30c4-14 20-18 30-8"/><path d="M40 13v9h-9"/><path d="M8 38h8M20 40h8M32 38h6" stroke-width="3"/>'),
    boost: svg('<path d="M24 5c3 8 11 12 11 22a11 11 0 0 1-22 0c0-6 4-9 5-14 2 4 4 5 6 5-1-5 0-9 0-13z" fill="#ff9a00" stroke="#fff"/><path d="M24 30c2 2 3 4 3 6a3 3 0 0 1-6 0c0-2 1-4 3-6z" fill="#ffe14d" stroke="none"/>'),
    skill: svg('<path d="M24 6l5 11 12 1.5-9 8 2.7 12L24 32.5 13.3 38.5 16 26.5l-9-8L19 17z" fill="#ffcc00" stroke="#fff"/>'),
    item: svg('<rect x="9" y="20" width="30" height="20" rx="2" fill="#e0405a"/><rect x="7" y="14" width="34" height="7" rx="2" fill="#ff6a80"/><path d="M24 14v26"/><path d="M24 14c-3-6-11-7-11-2s8 2 11 2c3 0 11 3 11-2s-8-4-11 2z"/>'),
  };

  const Joy = PK.Joy = { active: false, x: 0, y: 0 };
  let touchEl, base, knob, gear, panel, sizeCss, pid = null, cx = 0, cy = 0, R = 1, cfg = Object.assign({}, DEFAULT);
  const held = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const clampCfg = (c) => { for (const k in RANGE) c[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], +c[k] || DEFAULT[k])); return c; };

  function loadCfg() {
    let c = null;
    try { c = JSON.parse(lsGet(LS_CFG) || 'null'); } catch (e) { c = null; }
    if (!c) {   // older 작게/보통/크게 setting
      const f = PRESET[lsGet(LS_SIZE)] || 1;
      c = {};
      for (const k in DEFAULT) c[k] = k === 'alpha' ? DEFAULT.alpha : DEFAULT[k] * f;
    }
    return clampCfg(Object.assign({}, DEFAULT, c));
  }
  function saveCfg() { lsSet(LS_CFG, JSON.stringify(cfg)); }

  // ---------------------------------------------------------------- stick
  function send(code, down) {
    if (held[code] === down) return;
    held[code] = down;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  }
  function releaseAll() { Joy.active = false; Joy.x = 0; Joy.y = 0; for (const c in held) send(c, false); }

  function update(x, y) {
    let dx = (x - cx) / R, dy = (y - cy) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    knob.setAttribute('transform', 'translate(' + (dx * 26).toFixed(1) + ' ' + (dy * 26).toFixed(1) + ')');
    const ax = Math.abs(dx) < DEAD ? 0 : Math.sign(dx) * (Math.abs(dx) - DEAD) / (1 - DEAD);
    Joy.active = true; Joy.x = ax; Joy.y = dy;
    send('ArrowLeft', dx < -KEY_STEER);
    send('ArrowRight', dx > KEY_STEER);
    send('ArrowDown', dy > KEY_BRAKE);
    send('ArrowUp', dy <= KEY_BRAKE);   // holding the stick anywhere but down drives forward
  }
  function down(e) {
    if (pid !== null || panel.classList.contains('on')) return;
    e.preventDefault();
    pid = e.pointerId;
    try { base.setPointerCapture(pid); } catch (er) { /* ignore */ }
    const r = base.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2;
    base.classList.add('on');
    update(e.clientX, e.clientY);
  }
  function move(e) { if (e.pointerId === pid) { e.preventDefault(); update(e.clientX, e.clientY); } }
  function up(e) {
    if (e.pointerId !== pid) return;
    pid = null;
    base.classList.remove('on');
    knob.removeAttribute('transform');
    releaseAll();
  }

  // ---------------------------------------------------------------- layout
  function applyCfg() {
    const w = (h) => (h * ASPECT).toFixed(2) + '%', gap = 3, r0 = 3;
    const btn = (k, h, right, bottom) =>
      '#touch .tb[data-k="' + k + '"]{left:auto!important;top:auto!important;right:' + right.toFixed(2) + '%!important;bottom:' + bottom.toFixed(2) + '%!important;' +
      'width:' + w(h) + '!important;height:' + h.toFixed(2) + '%!important;font-size:' + (0.45 + h / 70).toFixed(2) + 'em!important}';
    const r1 = r0 + Math.max(cfg.drift, cfg.boost) * ASPECT + gap;   // second column
    sizeCss.textContent =
      '#joy{height:' + cfg.joy.toFixed(2) + '%}' +
      '#touch .tb,#joy{opacity:' + cfg.alpha + '}' +
      btn('drift', cfg.drift, r0, 6) +
      btn('boost', cfg.boost, r0, 6 + cfg.drift + gap) +
      btn('skill', cfg.skill, r1, 6) +
      btn('item', cfg.item, r1, 6 + cfg.skill + gap);
  }

  // ---------------------------------------------------------------- settings panel
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'btnCfg';
    const box = document.createElement('div');
    box.className = 'panel';
    box.innerHTML = '<div class="ct">⚙ 버튼 설정</div><div class="cs"></div>' +
      '<div class="cb"><button class="btn alt" data-a="s">작게</button><button class="btn alt" data-a="m">보통</button>' +
      '<button class="btn alt" data-a="l">크게</button><button class="btn alt" data-a="reset">초기화</button>' +
      '<button class="btn" data-a="done">완료</button></div>';
    const list = box.querySelector('.cs');
    Object.keys(RANGE).forEach((k) => {
      const row = document.createElement('label');
      const [lo, hi] = RANGE[k], step = k === 'alpha' ? 0.05 : 1;
      row.innerHTML = '<span>' + LABEL[k] + '</span><input type="range" min="' + lo + '" max="' + hi + '" step="' + step + '" data-k="' + k + '"><em></em>';
      list.appendChild(row);
    });
    box.addEventListener('input', (e) => {
      const k = e.target.getAttribute && e.target.getAttribute('data-k');
      if (!k) return;
      cfg[k] = +e.target.value; applyCfg(); syncPanel(); saveCfg();
    });
    box.addEventListener('click', (e) => {
      const a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (!a) return;
      if (a === 'done') { closeSettings(); return; }
      if (a === 'reset') cfg = Object.assign({}, DEFAULT);
      else { const f = PRESET[a]; for (const k in DEFAULT) cfg[k] = k === 'alpha' ? cfg.alpha : DEFAULT[k] * f; clampCfg(cfg); }
      applyCfg(); syncPanel(); saveCfg();
    });
    ['pointerdown', 'touchstart'].forEach((t) => panel.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
    panel.appendChild(box);
    (document.getElementById('wrap') || document.body).appendChild(panel);
  }
  function syncPanel() {
    panel.querySelectorAll('input[data-k]').forEach((inp) => {
      const k = inp.getAttribute('data-k');
      inp.value = cfg[k];
      inp.nextElementSibling.textContent = k === 'alpha' ? Math.round(cfg[k] * 100) + '%' : Math.round(cfg[k] / DEFAULT[k] * 100) + '%';
    });
  }
  let pausedBySettings = false;
  function openSettings() {
    if (!panel) return;
    const st = PK.Game && PK.Game.state;
    pausedBySettings = st === 'race' || st === 'countdown';
    if (pausedBySettings) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true }));
    syncPanel();
    touchEl.classList.add('cfg');      // keep the buttons visible behind the panel while adjusting
    panel.classList.add('on');
  }
  function closeSettings() {
    panel.classList.remove('on');
    touchEl.classList.remove('cfg');
    if (pausedBySettings && PK.Game && PK.Game.state === 'paused') window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true }));
    pausedBySettings = false;
  }

  // ---------------------------------------------------------------- init
  function init() {
    touchEl = document.getElementById('touch');
    if (!touchEl || !touchy) return;
    const s = document.createElement('style');
    s.textContent =
      '#touch .tb[data-k="left"],#touch .tb[data-k="right"],#touch .tb[data-k="gas"],#touch .tb[data-k="brake"]{display:none!important}' +
      '#touch .tb[data-k="drift"],#touch .tb[data-k="boost"],#touch .tb[data-k="skill"],#touch .tb[data-k="item"]{border-radius:50%!important;padding:0 0 .35em!important;' +
      'align-items:flex-end!important;justify-content:center!important;overflow:hidden;line-height:1;text-align:center;' +
      'background:radial-gradient(circle at 35% 30%,rgba(110,90,150,.75),rgba(30,20,48,.8))!important;border:.18em solid rgba(0,0,0,.85)!important}' +
      '#touch .tb.down{background:radial-gradient(circle at 35% 30%,rgba(255,220,90,.9),rgba(230,140,0,.85))!important}' +
      '#touch .tb[data-k="drift"]::before,#touch .tb[data-k="boost"]::before,#touch .tb[data-k="skill"]::before,#touch .tb[data-k="item"]::before{' +
      'content:"";position:absolute;left:22%;top:14%;width:56%;height:56%;background:center/contain no-repeat;pointer-events:none}' +
      '#touch .tb[data-k="drift"]::before{background-image:' + ICON.drift + '}' +
      '#touch .tb[data-k="boost"]::before{background-image:' + ICON.boost + '}' +
      '#touch .tb[data-k="skill"]::before{background-image:' + ICON.skill + '}' +
      '#touch .tb[data-k="item"]::before{background-image:' + ICON.item + '}' +
      '#touch.cfg{display:block!important}#touch.cfg .tb,#touch.cfg #joy{pointer-events:none}' +
      '#joy{position:absolute;left:3%;bottom:6%;aspect-ratio:1;pointer-events:auto;touch-action:none}' +
      '#joy svg{width:100%;height:100%;display:block;overflow:visible}' +
      '#joy.on .ring{stroke:#ffcc00}' +
      '#btnGear{position:absolute;left:3%;top:30%;pointer-events:auto;font:inherit;font-size:.6em;padding:.3em .6em;color:#fff;' +
      'background:rgba(40,28,60,.65);border:.15em solid rgba(0,0,0,.8);border-radius:.4em}' +
      '#btnCfg{position:absolute;inset:0;z-index:30;display:none;align-items:flex-start;justify-content:center;padding-top:3%;pointer-events:none}' +
      '#btnCfg.on{display:flex}#btnCfg .panel{pointer-events:auto;width:min(26em,70%);padding:.5em .8em;font-size:.8em;background:rgba(42,31,61,.95)}' +
      '#btnCfg .ct{color:#ffcc00;font-size:1.15em;margin-bottom:.3em;text-align:center}' +
      '#btnCfg label{display:grid;grid-template-columns:5em 1fr 3em;align-items:center;gap:.5em;margin:.15em 0;font-size:.9em}' +
      '#btnCfg input{width:100%;accent-color:#ffcc00}#btnCfg em{font-style:normal;color:#c8bce0;text-align:right}' +
      '#btnCfg .cb{display:flex;flex-wrap:wrap;gap:.3em;justify-content:center;margin-top:.4em}#btnCfg .cb .btn{font-size:.85em;margin:0;padding:.25em .7em}';
    document.head.appendChild(s);
    sizeCss = document.createElement('style');
    document.head.appendChild(sizeCss);

    // joystick drawn as SVG: outer ring, direction ticks, labels and a knob
    base = document.createElement('div');
    base.id = 'joy';
    base.innerHTML =
      '<svg viewBox="-60 -60 120 120">' +
      '<circle r="56" fill="rgba(255,255,255,.08)"/><circle class="ring" r="56" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="4"/>' +
      '<circle r="34" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="2"/>' +
      '<path d="M0-52l-6 9h12zM0 52l-6-9h12zM-52 0l9-6v12zM52 0l-9-6v12z" fill="rgba(255,255,255,.5)"/>' +
      '<text y="-38" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.75)" font-weight="700">가속</text>' +
      '<text y="45" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.75)" font-weight="700">브레이크</text>' +
      '<g class="knob"><circle r="22" fill="#ffcc00" stroke="#000" stroke-width="3"/><circle r="22" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="5" stroke-dasharray="40 200" transform="rotate(30)"/>' +
      '<circle cx="-7" cy="-7" r="6" fill="rgba(255,255,255,.55)"/></g></svg>';
    knob = base.querySelector('.knob');
    touchEl.appendChild(base);
    base.addEventListener('pointerdown', down);
    base.addEventListener('pointermove', move);
    base.addEventListener('pointerup', up);
    base.addEventListener('pointercancel', up);
    base.addEventListener('lostpointercapture', up);
    base.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { pid = null; releaseAll(); });

    gear = document.createElement('button');
    gear.id = 'btnGear';
    gear.textContent = '⚙ 버튼';
    gear.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); openSettings(); });
    touchEl.appendChild(gear);

    buildPanel();
    cfg = loadCfg();
    applyCfg();
  }

  PK.Joystick = {
    init, openSettings, closeSettings,
    get config() { return Object.assign({}, cfg); },
    setSize(p) { const f = PRESET[p] || 1; for (const k in DEFAULT) cfg[k] = k === 'alpha' ? cfg.alpha : DEFAULT[k] * f; clampCfg(cfg); saveCfg(); if (sizeCss) applyCfg(); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.PK);
