// PK.Game — engine: game states, input, Mode-7 renderer, billboards, HUD, audio, DOM menus.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const C = PK.C, U = PK.U;
  const W = C.W, H = C.H, CX = C.CX, HOR = C.HORIZON, FOCAL = C.FOCAL, CAM_H = C.CAM_H, TEX = C.TEX;
  const FOG_NEAR = C.FOG_NEAR, FOG_FAR = C.FOG_FAR;
  const DT = 1 / 60;
  const KART_W = 6.5;              // kart world width
  const LS_BEST = 'pk_best_v1', LS_KART = 'pk_kart_v1';
  const ATTRACT_RESET = 75;        // seconds before the attract race is re-seeded
  // the 8 foods bought at the checkout (food.png cells) — scattered on the way home in Stage 3
  const STORY_FOODS = [5, 0, 1, 2, 7, 14, 11, 15];

  const G = PK.Game = {
    state: 'title', karts: [], player: null, time: 0, raceTime: 0,
    attract: true,       // true while title/select (no laps counted, sfx muted)
    standings: [], muted: false,
    init, onLap, sfx, toast,
  };

  // ---------------------------------------------------------------------------
  // module state
  // ---------------------------------------------------------------------------
  let canvas, ctx, img, buf;
  const rowZ = new Float32Array(H), rowFog = new Float32Array(H);
  let camX = 0, camY = 0, camA = 0;
  const keys = Object.create(null);
  const touch = { left: false, right: false, gas: false, brake: false, drift: false, boost: false, skill: false };
  let cdT = 0, lastCd = 4, goT = 0, finT = 0, attractT = 0;
  let toastText = '', toastT = 0, bannerText = '', bannerT = 0, bannerCol = '#ffcc00';
  let shakeT = 0, shakeMag = 0;
  let selIdx = 0, playerDef = 0;
  let best = { total: 0, lap: 0 }, newRecord = false, newLapRecord = false;
  let coarse = false;
  let storyPlace = 6;              // race result, carried through the checkout/road cutscenes
  let el = {}, cardEls = [];

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  const lsGet = (k) => { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (window.localStorage) localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function fmt(t) {
    if (!(t > 0)) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + pad2(Math.floor(s)) + '.' + pad2(Math.floor((s % 1) * 100));
  }
  const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------
  function init() {
    canvas = document.getElementById('game');
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    img = ctx.createImageData(W, H);
    buf = new Uint32Array(img.data.buffer);
    for (let y = HOR; y < H; y++) {
      const z = CAM_H * FOCAL / (y - HOR + 0.5);
      rowZ[y] = z;
      rowFog[y] = U.clamp((z - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
    }

    PK.Track.init();
    PK.Karts.init();
    PK.Skills.init();

    try { const b = JSON.parse(lsGet(LS_BEST) || 'null'); if (b) best = { total: +b.total || 0, lap: +b.lap || 0 }; } catch (e) { /* ignore */ }
    const sk = parseInt(lsGet(LS_KART), 10);
    selIdx = sk >= 0 && sk < PK.Karts.DEFS.length ? sk : 0;
    playerDef = selIdx;

    el = {
      wrap: document.getElementById('wrap'), title: document.getElementById('title'), select: document.getElementById('select'),
      cards: document.getElementById('cards'), touch: document.getElementById('touch'), best: document.getElementById('best'),
      btnStart: document.getElementById('btnStart'), btnGo: document.getElementById('btnGo'), btnBack: document.getElementById('btnBack'),
      btnIntro: document.getElementById('btnIntro'), stages: document.getElementById('stages'),
      btnStages: document.getElementById('btnStages'), btnStagesBack: document.getElementById('btnStagesBack'),
    };
    coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    buildSelect();
    bindInput();
    resize();
    window.addEventListener('resize', resize);
    goTitle();
    if (PK.Intro && !PK.Intro.seen()) playIntro();
    requestAnimationFrame(loop);
  }

  function resize() {
    const vw = window.innerWidth || W, vh = window.innerHeight || H;
    const s = Math.min(vw / W, vh / H);
    const w = Math.floor(W * s), h = Math.floor(H * s);
    if (el.wrap) {
      el.wrap.style.width = w + 'px'; el.wrap.style.height = h + 'px';
      el.wrap.style.fontSize = U.clamp(w / 58, 9, 20).toFixed(1) + 'px';
    }
  }

  // ---------------------------------------------------------------------------
  // states
  // ---------------------------------------------------------------------------
  function show(e, on) { if (e && e.classList) e.classList.toggle('on', !!on); }

  function updateBestText() {
    if (!el.best) return;
    el.best.textContent = best.total > 0
      ? '최고 기록: ' + fmt(best.total) + '   ·   베스트 랩: ' + fmt(best.lap)
      : '최고 기록: 없음';
  }

  function goTitle() {
    stopStages();
    G.state = 'title'; G.attract = true;
    show(el.title, true); show(el.select, false); show(el.touch, false); show(el.stages, false);
    updateBestText();
    setupRace((Math.random() * PK.Karts.DEFS.length) | 0, true);
  }

  // story cutscenes; the attract race keeps running behind them
  function playScript(name, ctx, done) {
    if (!PK.Intro) { setTimeout(done, 0); return; }   // no cutscene module: just move on
    G.state = 'intro'; G.attract = true;
    show(el.title, false); show(el.select, false); show(el.touch, false); show(el.stages, false);
    PK.Intro.play(name, ctx, uiBeep, done);
  }
  function playIntro() { playScript('intro', {}, goTitle); }   // auto-plays on first launch

  // story chain after the race:
  //   race → 'checkout' cutscene → Stage 2 (warehouse escape) → 'road' cutscene → Stage 3 (pick up the food)
  //   → 'home' cutscene → title
  function playEnding() {
    storyPlace = computeStandings().indexOf(G.player) + 1 || 6;
    playScript('checkout', { place: storyPlace }, () => playStage2(false));
  }
  function playRoad() { playScript('road', { place: storyPlace }, () => playStage3(false)); }
  function playHome() { playScript('home', {}, goTitle); }

  // Stage 2 / Stage 3 modules (js/stage2.js, js/stage3.js) run in their own overlays and handle their own keys.
  // test = launched from the stage test menu → back to the menu when it ends or is quit.
  function enterStage(name) {
    G.state = name; G.attract = true;
    show(el.title, false); show(el.select, false); show(el.touch, false); show(el.stages, false);
  }
  function playStage2(test) {
    const next = test ? goStages : playRoad;
    if (!PK.Stage2 || !PK.Stage2.start) { setTimeout(next, 0); return; }   // module missing: skip ahead
    const def = test ? selIdx : playerDef;
    enterStage('stage2');
    try {
      PK.Stage2.start({ def, beep: uiBeep, onClear: () => next(), onQuit: () => (test ? goStages() : goTitle()) });
    } catch (e) { setTimeout(next, 0); throw e; }
  }
  function playStage3(test) {
    const next = test ? goStages : playHome;
    if (!PK.Stage3 || !PK.Stage3.start) { setTimeout(next, 0); return; }
    const def = test ? selIdx : playerDef;
    enterStage('stage3');
    try {
      PK.Stage3.start({ def, items: STORY_FOODS.slice(), beep: uiBeep, onClear: () => next(), onQuit: () => (test ? goStages() : goTitle()) });
    } catch (e) { setTimeout(next, 0); throw e; }
  }
  function stopStages() {
    try { if (PK.Stage2 && PK.Stage2.active && PK.Stage2.stop) PK.Stage2.stop(); } catch (e) { /* ignore */ }
    try { if (PK.Stage3 && PK.Stage3.active && PK.Stage3.stop) PK.Stage3.stop(); } catch (e) { /* ignore */ }
  }

  // stage test menu: jump straight to any cutscene scene, the race or a stage
  function goStages() {
    stopStages();
    G.state = 'stages'; G.attract = true;
    show(el.title, false); show(el.select, false); show(el.touch, false); show(el.stages, true);
  }
  function testStage(b) {
    if (G.state !== 'stages') return;
    ensureAudio(); uiBeep(1);
    if (b.getAttribute('data-race')) { startRace(selIdx); return; }
    const stg = b.getAttribute('data-stage');
    if (stg === '2') { playStage2(true); return; }
    if (stg === '3') { playStage3(true); return; }
    const ctx = { scene: +b.getAttribute('data-scene') || 0 };
    if (b.getAttribute('data-place')) ctx.place = +b.getAttribute('data-place');
    playScript(b.getAttribute('data-play'), ctx, goStages);
  }

  function goSelect() {
    G.state = 'select'; G.attract = true;
    show(el.title, false); show(el.select, true); show(el.touch, false);
    refreshCards();
    if (!G.karts.length) setupRace(selIdx, true);
  }

  function startRace(defIdx) {
    playerDef = defIdx; selIdx = defIdx;
    lsSet(LS_KART, String(defIdx));
    show(el.title, false); show(el.select, false); show(el.touch, coarse); show(el.stages, false);
    setupRace(defIdx, false);
    G.state = 'countdown'; cdT = 3; lastCd = 4; goT = 0;
  }

  // Build the 6-kart grid. Player starts in the back row.
  function setupRace(defIdx, attract) {
    G.attract = attract;
    PK.Skills.reset();
    const T = PK.Track, N = T.N, n = PK.Karts.DEFS.length;
    const order = [];
    for (let i = 0; i < n; i++) if (i !== defIdx) order.push(i);
    shuffle(order);
    // back row = slots n-2, n-1 (n even). Random side.
    order.splice(n - 1 - (Math.random() < 0.5 ? 1 : 0), 0, defIdx);
    const karts = [];
    let ai = 0;
    for (let s = 0; s < n; s++) {
      const r = s >> 1, lat = (s & 1) ? 10 : -10;
      const gi = (((N - 4 - r * 3) % N) + N) % N;
      const di = order[s], isP = di === defIdx;
      const k = PK.Karts.create(di, gi, lat, isP);
      if (!isP && k.ai) { k.ai.skill = 0.86 + 0.10 * (n > 2 ? ai / (n - 2) : 0); ai++; }
      if (!k.lapTimes) k.lapTimes = [];
      if (k.maxLap == null) k.maxLap = 0;
      k._mLap = 0;  // main's own lap counter for onLap (robust to karts.js updating maxLap)
      k.lapStart = 0; k.finished = false; k.finishTime = 0;
      karts.push(k);
      if (isP) G.player = k;
    }
    G.karts = karts;
    G.standings = karts.slice();
    G.raceTime = 0;
    attractT = 0; finT = 0; newRecord = false; newLapRecord = false;
    toastT = 0; bannerT = 0; shakeT = 0;
    const p = G.player;
    camA = p.a;
    camX = p.x - Math.cos(camA) * C.CAM_DIST; camY = p.y - Math.sin(camA) * C.CAM_DIST;
  }

  // ---------------------------------------------------------------------------
  // contract callbacks
  // ---------------------------------------------------------------------------
  function onLap(k) {
    if (G.attract || (G.state !== 'race' && G.state !== 'finished')) return;
    if (k.lap <= (k._mLap || 0)) return;
    k._mLap = k.lap;
    if (k.lap > (k.maxLap || 0)) k.maxLap = k.lap;
    if (k.finished) return;
    if (!k.lapTimes) k.lapTimes = [];
    if (k.lap >= 2) k.lapTimes.push(G.raceTime - (k.lapStart || 0));
    k.lapStart = G.raceTime;
    if (k.lap > C.LAPS) {
      k.finished = true; k.finishTime = G.raceTime;
      if (k.isPlayer) playerFinish(k);
    } else if (k.isPlayer && k.lap >= 2) {
      banner(k.lap === C.LAPS ? 'FINAL LAP!' : 'LAP ' + k.lap, k.lap === C.LAPS ? '#ff8800' : '#ffcc00');
      sfx('lap');
    }
  }

  function playerFinish(k) {
    G.state = 'finished'; finT = 0;
    sfx('finish');
    banner('FINISH!', '#ffffff');
    const bl = k.lapTimes.length ? Math.min.apply(null, k.lapTimes) : 0;
    if (!(best.total > 0) || k.finishTime < best.total) { best.total = k.finishTime; newRecord = true; }
    if (bl > 0 && (!(best.lap > 0) || bl < best.lap)) { best.lap = bl; newLapRecord = true; }
    if (newRecord || newLapRecord) lsSet(LS_BEST, JSON.stringify(best));
  }

  // debug: finish the race on the spot, keeping the current place (no best-time save)
  function debugFinish() {
    const p = G.player, stand = computeStandings(), pos = stand.indexOf(p);
    for (let i = 0; i < pos; i++) { const k = stand[i]; if (!k.finished) { k.finished = true; k.finishTime = G.raceTime - (pos - i) * 0.5; } }
    p.finished = true; p.finishTime = G.raceTime;
    G.state = 'finished'; finT = 0; newRecord = false; newLapRecord = false;
    sfx('finish');
    banner('FINISH!', '#ffffff');
  }

  function toast(text) { toastText = String(text).toUpperCase(); toastT = 1.5; }
  function banner(text, col) { bannerText = text; bannerT = 1.6; bannerCol = col || '#ffcc00'; }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------
  const PIN = { steer: 0, left: false, right: false, gas: false, brake: false, drift: false, boost: false, skill: false };
  function playerInput() {
    const L = !!(keys.ArrowLeft || keys.KeyA || touch.left), R = !!(keys.ArrowRight || keys.KeyD || touch.right);
    PIN.left = L; PIN.right = R; PIN.steer = (R ? 1 : 0) - (L ? 1 : 0);
    PIN.gas = !!(keys.ArrowUp || keys.KeyW || touch.gas);
    PIN.brake = !!(keys.ArrowDown || keys.KeyS || touch.brake);
    PIN.drift = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.drift);
    PIN.boost = !!(keys.KeyZ || touch.boost);
    PIN.skill = !!(keys.KeyX || touch.skill);
    return PIN;
  }

  const PREVENT = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1 };
  function onKeyDown(e) {
    ensureAudio();
    const c = e.code || e.key;
    if (PREVENT[c]) e.preventDefault();
    const rep = e.repeat;
    keys[c] = true;
    if (rep) return;
    if (c === 'KeyM') { toggleMute(); return; }
    const st = G.state;
    if (st === 'intro' || st === 'stage2' || st === 'stage3') return;   // PK.Intro / PK.Stage2 / PK.Stage3 handle their own keys
    if (st === 'title') {
      if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') { uiBeep(1); goSelect(); }
      else if (c === 'KeyT') { uiBeep(0); goStages(); }
    } else if (st === 'stages') {
      if (c === 'Escape') { uiBeep(0); goTitle(); }
    } else if (st === 'select') {
      const n = PK.Karts.DEFS.length;
      let d = 0;
      if (c === 'ArrowLeft' || c === 'KeyA') d = -1;
      else if (c === 'ArrowRight' || c === 'KeyD') d = 1;
      else if (c === 'ArrowUp' || c === 'KeyW') d = -3;
      else if (c === 'ArrowDown' || c === 'KeyS') d = 3;
      if (d) { selIdx = ((selIdx + d) % n + n) % n; refreshCards(); uiBeep(0); }
      else if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') { uiBeep(1); startRace(selIdx); }
      else if (c === 'Escape') goTitle();
    } else if (st === 'countdown' || st === 'race') {
      if (c === 'KeyR') startRace(playerDef);
      else if (c === 'KeyF' && st === 'race') debugFinish();
      else if (c === 'Escape') goTitle();
    } else if (st === 'finished') {
      if ((c === 'Enter' || c === 'Space' || c === 'NumpadEnter') && finT > 1.2) { uiBeep(1); playEnding(); }
      else if (c === 'KeyR') startRace(playerDef);
      else if (c === 'Escape') goTitle();
    }
  }
  function onKeyUp(e) { keys[e.code || e.key] = false; }

  function bindInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; });
    window.addEventListener('pointerdown', ensureAudio);
    window.addEventListener('touchstart', ensureAudio, { passive: true });
    if (el.btnStart) el.btnStart.addEventListener('click', () => { ensureAudio(); uiBeep(1); goSelect(); });
    if (el.btnGo) el.btnGo.addEventListener('click', () => { ensureAudio(); uiBeep(1); startRace(selIdx); });
    if (el.btnBack) el.btnBack.addEventListener('click', () => { uiBeep(0); goTitle(); });
    if (el.btnIntro && PK.Intro) el.btnIntro.addEventListener('click', () => { ensureAudio(); uiBeep(1); playIntro(); });
    if (el.btnStages) el.btnStages.addEventListener('click', () => { ensureAudio(); uiBeep(1); goStages(); });
    if (el.btnStagesBack) el.btnStagesBack.addEventListener('click', () => { uiBeep(0); goTitle(); });
    const sb = el.stages && el.stages.querySelectorAll ? el.stages.querySelectorAll('[data-play],[data-race],[data-stage]') : [];
    for (let i = 0; i < sb.length; i++) sb[i].addEventListener('click', () => testStage(sb[i]));
    canvas.addEventListener('pointerdown', () => {
      if (G.state === 'finished' && finT > 1.2) { uiBeep(1); playEnding(); }
    });
    // touch buttons (hold-to-press)
    const btns = el.touch && el.touch.querySelectorAll ? el.touch.querySelectorAll('.tb') : [];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i], key = b.getAttribute('data-k'), act = b.getAttribute('data-act');
      const down = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        ensureAudio();
        if (key) { touch[key] = true; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } }
        else if (act === 'menu') goTitle();
        else if (act === 'retry' && (G.state === 'countdown' || G.state === 'race' || G.state === 'finished')) startRace(playerDef);
      };
      const up = (e) => { if (key) { touch[key] = false; b.classList.remove('down'); } };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ---------------------------------------------------------------------------
  // kart select DOM
  // ---------------------------------------------------------------------------
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function copyCanvas(src, fallbackColor, w, h) {
    const c = document.createElement('canvas');
    c.width = (src && src.width) || w; c.height = (src && src.height) || h;
    const g = c.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      if (src) g.drawImage(src, 0, 0);
      else { g.fillStyle = fallbackColor || '#888'; g.fillRect(1, 1, c.width - 2, c.height - 2); }
    }
    return c;
  }
  function buildSelect() {
    const defs = PK.Karts.DEFS, SD = PK.Skills.DEFS || {};
    const rng = (f) => { let lo = Infinity, hi = -Infinity; defs.forEach((d) => { lo = Math.min(lo, d[f]); hi = Math.max(hi, d[f]); }); return [lo, hi]; };
    const R = { maxV: rng('maxV'), acc: rng('acc'), turn: rng('turn') };
    const pct = (f, v) => { const r = R[f]; return Math.round(100 * (r[1] > r[0] ? 0.25 + 0.75 * (v - r[0]) / (r[1] - r[0]) : 0.7)); };
    if (!el.cards) return;
    el.cards.innerHTML = '';
    cardEls = [];
    defs.forEach((d, i) => {
      const card = mk('div', 'card');
      const head = mk('div', 'khead');
      let spr = null;
      try { spr = PK.Karts.sprite(i, true); } catch (e) { spr = null; }
      const cv = copyCanvas(spr, d.color, 16, 12); cv.className = 'kspr';
      head.appendChild(cv);
      const nm = mk('div', 'kname', d.nameKo);
      nm.style.color = d.color;
      nm.appendChild(mk('small', null, d.name));
      const hb = mk('div');
      hb.appendChild(nm);
      const wt = mk('div', 'wt', '무게 ' + '■'.repeat(d.weight) + '□'.repeat(Math.max(0, 5 - d.weight)) + ' ');
      wt.appendChild(mk('span', null, d.mass + 'kg'));
      hb.appendChild(wt);
      head.appendChild(hb);
      card.appendChild(head);
      [['최고속도', 'maxV'], ['가속', 'acc'], ['핸들링', 'turn']].forEach(([lab, f]) => {
        const st = mk('div', 'stat');
        st.appendChild(mk('b', null, lab));
        const bar = mk('div', 'bar'), fill = mk('i');
        fill.style.width = pct(f, d[f]) + '%';
        bar.appendChild(fill); st.appendChild(bar);
        card.appendChild(st);
      });
      const sd = SD[d.skill] || {};
      const sk = mk('div', 'skill');
      sk.appendChild(copyCanvas(sd.icon, '#ffcc00', 12, 12));
      const sb = mk('div');
      sb.appendChild(mk('div', 'sname', '스킬: ' + (sd.nameKo || d.skill)));
      sb.appendChild(mk('div', 'sdesc', sd.desc || d.desc || ''));
      sk.appendChild(sb);
      card.appendChild(sk);
      card.addEventListener('click', () => { ensureAudio(); if (selIdx !== i) uiBeep(0); selIdx = i; refreshCards(); });
      card.addEventListener('dblclick', () => { uiBeep(1); startRace(i); });
      el.cards.appendChild(card);
      cardEls.push(card);
    });
    refreshCards();
  }
  function refreshCards() {
    for (let i = 0; i < cardEls.length; i++) {
      cardEls[i].classList.toggle('sel', i === selIdx);
      if (i === selIdx && cardEls[i].scrollIntoView && G.state === 'select') { try { cardEls[i].scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
    }
  }

  // ---------------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------------
  let last = -1, acc = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const now = (ts || 0) / 1000;
    let d = last < 0 ? DT : now - last;
    last = now;
    if (!(d > 0)) d = 0;
    if (d > 0.25) d = 0.25;           // clamp big gaps (tab switch etc.)
    acc += d;
    let n = 0;
    while (acc >= DT && n < 8) { step(DT); acc -= DT; n++; }
    if (n >= 8) acc = 0;
    render();
    updateEngine();
  }

  function simulate(dt) {
    const ks = G.karts, K = PK.Karts;
    const race = G.state === 'race';
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      const inp = (k.isPlayer && race) ? playerInput() : K.aiInput(k, G);
      // skill rising edge must be checked BEFORE update (update overwrites k.prev)
      if (inp && inp.skill && !(k.prev && k.prev.skill)) PK.Skills.tryUse(k, G);
      K.update(k, inp, dt, G);
    }
    K.collide(ks);
    PK.Skills.update(dt, G);
  }

  function step(dt) {
    G.time += dt;
    if (toastT > 0) toastT -= dt;
    if (bannerT > 0) bannerT -= dt;
    if (shakeT > 0) shakeT -= dt;
    if (goT > 0) goT -= dt;
    const st = G.state;
    if (st === 'title' || st === 'select' || st === 'intro' || st === 'stages' || st === 'stage2' || st === 'stage3') {
      simulate(dt);
      attractT += dt;
      if (attractT > ATTRACT_RESET) setupRace((Math.random() * PK.Karts.DEFS.length) | 0, true);
    } else if (st === 'countdown') {
      cdT -= dt;
      const n = Math.ceil(cdT);
      if (n < lastCd && n >= 1) { lastCd = n; sfx('beep'); }
      if (cdT <= 0) { G.state = 'race'; goT = 0.9; sfx('go'); }
    } else if (st === 'race' || st === 'finished') {
      G.raceTime += dt;
      if (st === 'finished') finT += dt;
      simulate(dt);
    }
    // camera follow
    const p = G.player;
    if (p) {
      camA += U.angDiff(camA, p.a) * Math.min(1, 5 * dt);
      if (camA > Math.PI) camA -= C.TAU; else if (camA < -Math.PI) camA += C.TAU;
      camX = p.x - Math.cos(camA) * C.CAM_DIST;
      camY = p.y - Math.sin(camA) * C.CAM_DIST;
    }
  }

  // ---------------------------------------------------------------------------
  // standings
  // ---------------------------------------------------------------------------
  function cmpStand(a, b) {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.prog - a.prog;
  }
  function computeStandings() {
    const s = G.standings, ks = G.karts;
    s.length = ks.length;
    for (let i = 0; i < ks.length; i++) s[i] = ks[i];
    s.sort(cmpStand);
    return s;
  }

  // ---------------------------------------------------------------------------
  // renderer
  // ---------------------------------------------------------------------------
  const BAY = U.BAYER;
  function drawGround() {
    const T = PK.Track, tex = T.texData, FOG = T.FOG;
    const fx = Math.cos(camA), fy = Math.sin(camA), rx = -fy, ry = fx;
    for (let y = HOR; y < H; y++) {
      const fogT = rowFog[y];
      let o = y * W;
      if (fogT >= 1) { buf.fill(FOG, o, o + W); continue; }
      const z = rowZ[y], k = z / FOCAL;
      let wx = camX + fx * z - rx * CX * k, wy = camY + fy * z - ry * CX * k;
      const sx = rx * k, sy = ry * k;
      const by = (y & 3) << 2;
      for (let x = 0; x < W; x++, o++, wx += sx, wy += sy) {
        if (fogT > 0 && fogT > BAY[by | (x & 3)]) { buf[o] = FOG; continue; }
        const ix = Math.floor(wx), iy = Math.floor(wy);
        buf[o] = (ix >= 0 && iy >= 0 && ix < TEX && iy < TEX) ? tex[iy * TEX + ix] : T.sampleOutside(ix, iy);
      }
    }
  }

  // pooled billboard records
  const pool = [], vis = [];
  function getRec(i) { let r = pool[i]; if (!r) { r = pool[i] = { z: 0, sx: 0, gy: 0, s: 0, spr: null, w: 0, h: 0, kart: null }; } return r; }
  const byDepth = (a, b) => b.z - a.z;
  let pfx = 1, pfy = 0, prx = 0, pry = 1;

  // project one world object; returns true if added
  function addBill(n, x, y, h, spr, w, kart) {
    const dx = x - camX, dy = y - camY;
    const z = dx * pfx + dy * pfy;
    if (z < 3 || z > FOG_FAR) return n;
    const s = FOCAL / z;
    const sx = CX + (dx * prx + dy * pry) * s;
    const sw = w * s;
    if (sx + sw < 0 || sx - sw > W) return n;
    const r = getRec(n);
    r.z = z; r.sx = sx; r.gy = HOR + CAM_H * s; r.s = s; r.spr = spr; r.w = w; r.h = h || 0; r.kart = kart;
    vis[n] = r;
    return n + 1;
  }

  function drawBillboards() {
    const T = PK.Track;
    pfx = Math.cos(camA); pfy = Math.sin(camA); prx = -pfy; pry = pfx;
    let n = 0;
    const props = T.props || [];
    for (let i = 0; i < props.length; i++) { const p = props[i]; if (p.spr) n = addBill(n, p.x, p.y, 0, p.spr, p.w, null); }
    const ks = G.karts;
    for (let i = 0; i < ks.length; i++) { const k = ks[i]; n = addBill(n, k.x, k.y, 0, null, KART_W, k); }
    const ss = PK.Skills.sprites() || [];
    for (let i = 0; i < ss.length; i++) { const o = ss[i]; if (o && o.spr) n = addBill(n, o.x, o.y, o.h, o.spr, o.w, null); }
    vis.length = n;
    vis.sort(byDepth);
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const r = vis[i];
      const fade = r.z > FOG_NEAR ? 1 - (r.z - FOG_NEAR) / (FOG_FAR - FOG_NEAR) : 1;
      if (fade <= 0.02) continue;
      ctx.globalAlpha = fade;
      if (r.kart) drawKart(r);
      else {
        const spr = r.spr, sw = r.w * r.s, sh = sw * spr.height / spr.width;
        const bottom = r.gy - r.h * r.s;
        const x0 = Math.round(r.sx - sw / 2), y0 = Math.round(bottom - sh);
        if (y0 > H) continue;
        ctx.drawImage(spr, x0, y0, Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawKart(r) {
    const k = r.kart, s = r.s, sw = KART_W * s;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const shH = Math.max(1, Math.round(sw * 0.16));
    ctx.fillRect(Math.round(r.sx - sw * 0.45), Math.round(r.gy - shH * 0.6), Math.max(1, Math.round(sw * 0.9)), shH);
    const spr = PK.Karts.frame(k, camA);
    if (spr) {
      const sh = sw * spr.height / spr.width;
      const bottom = r.gy - (k.hop || 0) * s;
      ctx.drawImage(spr, Math.round(r.sx - sw / 2), Math.round(bottom - sh), Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
    }
    PK.Karts.drawFx(ctx, k, r.sx, r.gy, sw);
  }

  function drawSpeedLines() {
    const p = G.player;
    if (!p || !(p.boostT > 0) || G.state === 'countdown') return;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 7; i++) {
      const left = i & 1;
      const y = HOR + 8 + ((Math.random() * (H - HOR - 16)) | 0);
      const len = 10 + ((Math.random() * 26) | 0);
      const x = left ? ((Math.random() * 30) | 0) : W - len - ((Math.random() * 30) | 0);
      ctx.fillRect(x, y, len, 1);
    }
  }

  function render() {
    if (!ctx || !G.player) return;
    PK.Track.drawBackground(buf, camA);
    drawGround();
    let ox = 0, oy = 0;
    if (shakeT > 0) {
      ox = Math.round((Math.random() * 2 - 1) * shakeMag);
      oy = Math.round((Math.random() * 2 - 1) * shakeMag);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    }
    ctx.putImageData(img, ox, oy);
    ctx.save();
    if (ox || oy) ctx.translate(ox, oy);
    drawBillboards();
    ctx.restore();
    drawSpeedLines();
    const st = G.state;
    if (st === 'countdown' || st === 'race' || st === 'finished') drawHUD();
  }

  // ---------------------------------------------------------------------------
  // 3x5 bitmap font
  // ---------------------------------------------------------------------------
  // 3 columns x 5 rows per glyph
  const FONT_ROWS = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'],
    ':': ['...', '.#.', '...', '.#.', '...'], '/': ['..#', '..#', '.#.', '#..', '#..'], '.': ['...', '...', '...', '...', '.#.'],
    '!': ['.#.', '.#.', '.#.', '...', '.#.'], '-': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
    "'": ['.#.', '.#.', '...', '...', '...'], ' ': ['...', '...', '...', '...', '...'],
  };
  // glyph -> flat list of horizontal runs [x, y, len, ...]
  const GLYPH = Object.create(null);
  for (const ch in FONT_ROWS) {
    const rows = FONT_ROWS[ch], runs = [];
    for (let y = 0; y < 5; y++) {
      let x = 0;
      while (x < 3) {
        if (rows[y][x] === '#') { let l = 0; while (x + l < 3 && rows[y][x + l] === '#') l++; runs.push(x, y, l); x += l; } else x++;
      }
    }
    GLYPH[ch] = runs;
  }
  const textW = (s, sc) => (s.length ? s.length * 4 * sc - sc : 0);
  function textRaw(s, x, y, sc) {
    for (let i = 0; i < s.length; i++) {
      const g = GLYPH[s[i]] || GLYPH[' '];
      const gx = x + i * 4 * sc;
      for (let j = 0; j < g.length; j += 3) ctx.fillRect(gx + g[j] * sc, y + g[j + 1] * sc, g[j + 2] * sc, sc);
    }
  }
  function text(s, x, y, sc, col, shadow) {
    s = String(s).toUpperCase();
    x = Math.round(x); y = Math.round(y);
    if (shadow !== false) { const o = sc >= 4 ? 2 : 1; ctx.fillStyle = '#000'; textRaw(s, x + o, y + o, sc); }
    ctx.fillStyle = col || '#fff';
    textRaw(s, x, y, sc);
  }
  function textC(s, cx, y, sc, col, shadow) { s = String(s).toUpperCase(); text(s, cx - textW(s, sc) / 2, y, sc, col, shadow); }
  function textR(s, rx, y, sc, col, shadow) { s = String(s).toUpperCase(); text(s, rx - textW(s, sc), y, sc, col, shadow); }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const POSCOL = ['#ffd800', '#dfe3f0', '#e8964a', '#ffffff', '#ffffff', '#ffffff'];
  function box(x, y, w, h, fill) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  }

  function drawHUD() {
    const p = G.player, st = G.state, t = G.time;
    const stand = computeStandings();
    const pos = stand.indexOf(p);
    const blink = ((t * 4) | 0) & 1;

    // lap (top-left)
    const lap = U.clamp(p.lap || 1, 1, C.LAPS);
    text('LAP', 4, 4, 1, '#ffcc00');
    text(lap + '/' + C.LAPS, 4, 11, 2, '#fff');
    // race time (center top)
    textC(fmt(G.raceTime || 0.0001).replace('--:--.--', '0:00.00'), CX, 4, 2, '#fff');
    // position (top-right)
    if (pos >= 0) {
      const ps = ORD[pos] || (pos + 1) + 'TH';
      textR(ps.slice(0, 1), W - 4 - textW(ps.slice(1), 2) - 2, 4, 4, POSCOL[pos] || '#fff');
      textR(ps.slice(1), W - 4, 4, 2, POSCOL[pos] || '#fff');
    }

    // speed + booster gauge (bottom-left)
    const kmh = Math.round(Math.abs(p.v || 0) * 0.8);
    text(kmh + ' KM/H', 4, H - 12, 2, p.boostT > 0 ? '#ffcc00' : '#fff');
    const gx = 4, gy = H - 24, gw = 56, gh = 6;
    box(gx, gy, gw, gh, '#1a1028');
    const gv = U.clamp(p.gauge || 0, 0, 100) / 100;
    ctx.fillStyle = gv >= 0.999 ? '#fff' : '#ff9a00';
    ctx.fillRect(gx, gy, Math.round(gw * gv), gh);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(gx, gy, Math.round(gw * gv), 2);
    for (let i = 0; i < 2; i++) {
      const sx = gx + gw + 4 + i * 9, lit = (p.stock || 0) > i;
      box(sx, gy - 1, 7, 8, lit ? (blink ? '#ffe14d' : '#ff8800') : '#2a2038');
    }
    if ((p.stock || 0) > 0) text('Z', gx + gw + 23, gy - 1, 1, blink ? '#fff' : '#ffcc00');
    text('BOOST', gx, gy - 7, 1, '#ffb347');

    // skill icon (bottom-center-left)
    const SD = PK.Skills.DEFS && PK.Skills.DEFS[p.def.skill];
    if (SD) {
      const ix = 104, iy = H - 30, is = 24;
      const ready = !((p.skillCd || 0) > 0);
      box(ix - 1, iy - 1, is + 2, is + 2, ready && blink ? '#ffcc00' : '#1a1028');
      if (SD.icon) ctx.drawImage(SD.icon, ix, iy, is, is);
      if (!ready) {
        const f = U.clamp(p.skillCd / (SD.cooldown || 1), 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        const hh = Math.round(is * f);
        ctx.fillRect(ix, iy, is, hh);
        textC(String(Math.ceil(p.skillCd)), ix + is / 2, iy + is / 2 - 2, 1, '#fff');
      }
      text('X', ix + is + 4, iy + is - 5, 1, ready ? (blink ? '#fff' : '#ffcc00') : '#776a8a');
    }

    // minimap (bottom-right)
    const T = PK.Track;
    if (T.mini) {
      const mw = T.mini.width || 60, mh = T.mini.height || 60;
      const mx = W - mw - 3, my = H - mh - 3;
      ctx.fillStyle = 'rgba(10,6,20,0.6)'; ctx.fillRect(mx - 1, my - 1, mw + 2, mh + 2);
      ctx.drawImage(T.mini, mx, my);
      for (let i = G.karts.length - 1; i >= 0; i--) {
        const k = G.karts[i];
        if (k === p) continue;
        const m = T.toMini(k.x, k.y);
        ctx.fillStyle = '#000'; ctx.fillRect(Math.round(mx + m[0]) - 2, Math.round(my + m[1]) - 2, 4, 4);
        ctx.fillStyle = k.color || k.def.color; ctx.fillRect(Math.round(mx + m[0]) - 1, Math.round(my + m[1]) - 1, 2, 2);
      }
      const m = T.toMini(p.x, p.y);
      ctx.fillStyle = '#000'; ctx.fillRect(Math.round(mx + m[0]) - 2, Math.round(my + m[1]) - 2, 5, 5);
      ctx.fillStyle = blink ? '#fff' : (p.color || p.def.color); ctx.fillRect(Math.round(mx + m[0]) - 1, Math.round(my + m[1]) - 1, 3, 3);
    }

    // countdown
    if (st === 'countdown') {
      const n = Math.max(1, Math.ceil(cdT));
      const col = n === 3 ? '#ff4040' : n === 2 ? '#ff9a00' : '#ffe14d';
      const frac = cdT - Math.floor(cdT);
      const sc = frac > 0.8 ? 12 : 10;
      textC(String(n), CX, 70 - sc * 2.5, sc, col);
    } else if (goT > 0) {
      textC('GO!', CX, 48, 8, blink ? '#40ff60' : '#c8ffd0');
    }

    // wrong way
    if (st === 'race' && p.wrongT > 1 && blink) textC('WRONG WAY', CX, 64, 3, '#ff4040');

    // banner + toast
    if (bannerT > 0 && st !== 'countdown') textC(bannerText, CX, 34, 3, bannerCol);
    if (toastT > 0) textC(toastText, CX, bannerT > 0 ? 50 : 36, 2, '#9fe8ff');

    // results
    if (st === 'finished' && finT > 1.2) drawResults(stand, blink);
  }

  function drawResults(stand, blink) {
    const px = 46, py = 22, pw = 228, ph = 136;
    ctx.fillStyle = '#000'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    ctx.fillStyle = 'rgba(30,20,48,0.94)'; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#ff8800'; ctx.fillRect(px, py, pw, 2); ctx.fillRect(px, py + ph - 2, pw, 2);
    textC('RESULTS', CX, py + 6, 2, '#ffcc00');
    const c0 = px + 8, cChip = px + 20, cName = px + 32, cTime = px + 64, cLap = px + 120, cTag = px + 176;
    const hy = py + 22;
    text('TIME', cTime, hy, 1, '#a898c8', false);
    text('BEST LAP', cLap, hy, 1, '#a898c8', false);
    for (let i = 0; i < stand.length; i++) {
      const k = stand[i], y = hy + 9 + i * 12;
      if (k.isPlayer) { ctx.fillStyle = 'rgba(255,200,0,0.22)'; ctx.fillRect(px + 3, y - 3, pw - 6, 11); }
      text(String(i + 1), c0, y, 1, POSCOL[i] || '#fff');
      ctx.fillStyle = '#000'; ctx.fillRect(cChip - 1, y - 1, 9, 7);
      ctx.fillStyle = k.color || k.def.color; ctx.fillRect(cChip, y, 7, 5);
      text(k.name || k.def.name, cName, y, 1, k.isPlayer ? '#ffcc00' : '#fff');
      text(k.finished ? fmt(k.finishTime) : '--:--.--', cTime, y, 1, '#fff');
      const bl = k.lapTimes && k.lapTimes.length ? Math.min.apply(null, k.lapTimes) : 0;
      text(fmt(bl), cLap, y, 1, '#e8e0f8');
      if (k.isPlayer) text('YOU', cTag, y, 1, '#ffcc00');
    }
    const y = hy + 9 + stand.length * 12 + 2;
    if (newRecord || newLapRecord) {
      textC(newRecord ? 'NEW RECORD!' : 'NEW LAP RECORD!', CX, y, 2, blink ? '#ff8800' : '#ffe14d');
    }
    if (((G.time * 2) | 0) & 1) textC('ENTER: NEXT  R: RETRY', CX, py + ph - 10, 1, '#fff');
  }

  // ---------------------------------------------------------------------------
  // audio
  // ---------------------------------------------------------------------------
  let ac = null, master = null, sfxBus = null, engO = null, engO2 = null, engF = null, engG = null, noiseBuf = null;
  const lastSfx = Object.create(null);
  function ensureAudio() {
    if (ac) { if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = G.muted ? 0 : 0.55; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
      // engine: sawtooth + sub square -> lowpass -> gain
      engO = ac.createOscillator(); engO.type = 'sawtooth'; engO.frequency.value = 50;
      engO2 = ac.createOscillator(); engO2.type = 'square'; engO2.frequency.value = 25;
      engF = ac.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 400; engF.Q.value = 4;
      engG = ac.createGain(); engG.gain.value = 0;
      const sub = ac.createGain(); sub.gain.value = 0.4;
      engO.connect(engF); engO2.connect(sub); sub.connect(engF); engF.connect(engG); engG.connect(master);
      engO.start(); engO2.start();
      const len = (ac.sampleRate * 0.5) | 0;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  function toggleMute() {
    G.muted = !G.muted;
    if (ac && master) master.gain.setTargetAtTime(G.muted ? 0 : 0.55, ac.currentTime, 0.02);
    toast(G.muted ? 'SOUND OFF' : 'SOUND ON');
  }
  function tone(type, f0, f1, dur, vol, delay) {
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, fc, delay) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 2000;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + dur + 0.03);
  }
  function uiBeep(kind) { if (!ac) return; try { if (kind) { tone('square', 660, 660, 0.06, 0.12); tone('square', 990, 990, 0.08, 0.12, 0.06); } else tone('square', 520, 520, 0.05, 0.1); } catch (e) { /* ignore */ } }

  function sfx(name) {
    // screen shake is visual, so trigger it even without audio
    if (!G.attract && (name === 'hit' || name === 'bump')) {
      shakeT = name === 'hit' ? 0.3 : 0.15; shakeMag = name === 'hit' ? 2 : 1;
    }
    if (!ac || G.attract || G.muted) return;
    const now = ac.currentTime;
    if (lastSfx[name] !== undefined && now - lastSfx[name] < 0.06) return;
    lastSfx[name] = now;
    try {
      switch (name) {
        case 'beep': tone('square', 440, 440, 0.18, 0.2); break;
        case 'go': tone('square', 880, 880, 0.45, 0.22); tone('square', 1320, 1320, 0.45, 0.08); break;
        case 'boost': tone('sawtooth', 180, 720, 0.45, 0.16); noise(0.4, 0.18, 1800); break;
        case 'pad': tone('triangle', 500, 1300, 0.22, 0.2); tone('square', 1000, 1600, 0.12, 0.05, 0.05); break;
        case 'skill': tone('square', 520, 520, 0.06, 0.12); tone('square', 780, 780, 0.06, 0.12, 0.06); tone('square', 1040, 1040, 0.1, 0.12, 0.12); break;
        case 'hit': noise(0.35, 0.35, 1200); tone('sawtooth', 320, 50, 0.4, 0.18); break;
        case 'bump': tone('triangle', 140, 50, 0.12, 0.3); noise(0.08, 0.15, 600); break;
        case 'lap': [660, 880, 1100].forEach((f, i) => tone('square', f, f, 0.1, 0.14, i * 0.09)); break;
        case 'finish': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, i === 5 ? 0.5 : 0.12, 0.15, i * 0.12)); break;
        case 'gauge': tone('square', 1200, 1200, 0.05, 0.1); tone('square', 1600, 1600, 0.08, 0.1, 0.06); break;
        default: tone('square', 700, 700, 0.05, 0.08);
      }
    } catch (e) { /* ignore */ }
  }

  function updateEngine() {
    if (!ac || !engG) return;
    const p = G.player, st = G.state, t = ac.currentTime;
    let vol = 0, f = 45;
    if (p && !G.attract && (st === 'countdown' || st === 'race' || st === 'finished')) {
      const r = Math.min(1.5, Math.abs(p.v || 0) / ((p.def && p.def.maxV) || 140));
      const b = p.boostT > 0;
      f = 42 + r * 95 + (b ? 30 : 0) + (st === 'countdown' && (keys.ArrowUp || keys.KeyW || touch.gas) ? 25 : 0);
      vol = 0.05 + r * 0.04 + (b ? 0.05 : 0);
    }
    try {
      engO.frequency.setTargetAtTime(f, t, 0.06);
      engO2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      engF.frequency.setTargetAtTime(250 + f * 7, t, 0.06);
      engG.gain.setTargetAtTime(vol, t, 0.1);
    } catch (e) { /* ignore */ }
  }
})(window.PK);
