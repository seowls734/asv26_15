// PK.Mobile — phone/tablet support: rotate-to-landscape hint, fullscreen + landscape lock on first tap,
// no page zoom/scroll/pull-to-refresh, and keeps the screen awake during play. Loaded before main.js.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  // ?mobile=1 forces phone mode on a PC (used by phone.html): every '(pointer: coarse)' check then
  // reports a touch screen, so main.js and joystick.js show the touch controls; the mouse acts as a finger.
  const forced = /[?&]mobile=1\b/.test(location.search);
  if (forced && window.matchMedia) {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q));
  }
  const touchy = forced || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  let rot = null, wake = null, tried = false;

  function css() {
    const s = document.createElement('style');
    s.textContent =
      'html,body{overscroll-behavior:none;touch-action:none;-webkit-touch-callout:none}' +
      '#rotate{position:fixed;inset:0;z-index:50;display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'background:#0d0a14;color:#ffcc00;text-align:center;font-size:20px;line-height:1.5;padding:24px}' +
      '#rotate.on{display:flex}#rotate b{font-size:56px;display:block;animation:pkrot 1.6s ease-in-out infinite}' +
      '#rotate small{color:#c8bce0;font-size:14px}' +
      '@keyframes pkrot{0%,20%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}';
    document.head.appendChild(s);
  }

  function checkOrientation() {
    if (!rot) return;
    rot.classList.toggle('on', touchy && window.innerHeight > window.innerWidth);
  }

  // fullscreen + landscape lock need a user gesture; try once on the first touch
  function goFull() {
    if (tried || standalone) { keepAwake(); return; }
    tried = true;
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      const p = req && req.call(el, { navigationUI: 'hide' });
      const lock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ } };
      if (p && p.then) p.then(lock).catch(() => {}); else lock();
    } catch (e) { /* ignore */ }
    keepAwake();
  }

  function keepAwake() {
    if (wake || !navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then((w) => { wake = w; w.addEventListener('release', () => { wake = null; }); }).catch(() => {});
  }

  function init() {
    css();
    rot = document.createElement('div');
    rot.id = 'rotate';
    rot.innerHTML = '<b>📱</b>휴대폰을 가로로 돌려 주세요<small>가로 화면에서 플레이할 수 있어요</small>';
    document.body.appendChild(rot);
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));
    if (!touchy || forced) return;   // the simulator page has no real fullscreen / zoom to manage
    window.addEventListener('touchend', goFull, { passive: true });
    // block pinch zoom and double-tap zoom (iOS ignores user-scalable=no)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    let lastTap = 0;
    document.addEventListener('touchend', (e) => { const t = Date.now(); if (t - lastTap < 300) e.preventDefault(); lastTap = t; }, { passive: false });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  }

  PK.Mobile = { touchy, forced, init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.PK);
