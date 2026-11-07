// PK.Karts — kart definitions, sprites, arcade physics, collisions, AI driving and kart particle FX.
// Owner: Kart agent. See CONTRACT.md for the shared API.
window.PK = window.PK || {};
(function (PK) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  const sfx = (G, k, name) => { if (k.isPlayer && G && G.sfx) G.sfx(name); };

  // ---------------------------------------------------------------------------
  // Tuning constants
  // ---------------------------------------------------------------------------
  const REV_MAX = -45;          // reverse speed cap
  const BRAKE = 230;            // braking deceleration
  const COAST = 28;             // rolling friction (plus small v-proportional drag)
  const DRIFT_MIN_V = 65;       // speed needed to start a drift
  const DRIFT_END_V = 40;       // drift is cancelled below this
  const MT_SMALL = 0.7, MT_BIG = 1.5;   // mini-turbo charge thresholds (s)
  const PAD_R = 9;              // boost pad detection radius
  const KART_R = 4;             // collision radius
  const RESTITUTION = 0.45;
  const GAUGE_MAX = 100, STOCK_MAX = 2;

  // ---------------------------------------------------------------------------
  // Kart definitions. Stats are derived from weight (1 light .. 5 heavy):
  //   maxV     = 138 + w*5          (143 .. 163 units/s)   heavy = higher top speed
  //   acc      = 150 - w*14         (136 .. 80 units/s^2)  light = quicker
  //   turn     = 2.75 - w*0.12      (2.63 .. 2.15 rad/s)   light = tighter
  //   grip     = 6.4 + w*0.4        (6.8 .. 8.4 /s)        heavy = more planted
  //   mass     = 50 + w*30          (80 .. 200 kg)
  //   boostPow = 1.48 - w*0.03      (1.45 .. 1.33)         light gets a stronger boost
  // ---------------------------------------------------------------------------
  const RAW = [
    { name: 'RED', nameKo: '레드', color: '#e03a3a', weight: 3, skill: 'cart_rush', desc: '속도와 핸들링이 균형 잡힌 올라운더 카트' },
    { name: 'BLU', nameKo: '블루', color: '#3a6ee8', weight: 2, skill: 'banana', desc: '가속이 좋고 다루기 쉬운 경쾌한 카트' },
    { name: 'GRN', nameKo: '그린', color: '#3cb84a', weight: 4, skill: 'watermelon', desc: '묵직하고 최고 속도가 높은 파워 카트' },
    { name: 'YEL', nameKo: '옐로', color: '#f2c82c', weight: 1, skill: 'soap', desc: '가볍고 코너링이 날카로운 초경량 카트' },
    { name: 'PNK', nameKo: '핑크', color: '#f06aa8', weight: 2, skill: 'bubble', desc: '민첩한 가속과 부드러운 드리프트의 카트' },
    { name: 'BLK', nameKo: '블랙', color: '#2a2a33', weight: 5, skill: 'magnet', desc: '최고 속도와 몸싸움 최강, 대신 굼뜬 중전차' }
  ];
  const DEFS = RAW.map((r, i) => {
    const w = r.weight;
    return {
      id: i, name: r.name, nameKo: r.nameKo, color: r.color, weight: w,
      mass: 50 + w * 30,
      maxV: 138 + w * 5,
      acc: 150 - w * 14,
      turn: +(2.75 - w * 0.12).toFixed(2),
      grip: +(6.4 + w * 0.4).toFixed(2),
      boostPow: +(1.48 - w * 0.03).toFixed(2),
      skill: r.skill, desc: r.desc
    };
  });

  // ---------------------------------------------------------------------------
  // Sprites: shopping cart (assets/cart.png, 48x49, seen from behind) with a driver
  // sitting in the basket. Canvas SW x SH: the cart sits at y=CART_Y, the driver's
  // head pokes up above the handle bar (bar crosses the neck), shoulders show
  // between bar and basket rim. Canvases are created at init at final size and
  // repainted in place once the image has loaded (no getImageData: file:// safe).
  // ---------------------------------------------------------------------------
  const SW = 48, SH = 58, CART_Y = 9, CART_H = 49;
  const rep = (c, n) => c.repeat(n);
  // handle bar recolour mask = cart rows 1..6. L light, M main, m mid, D dark, d darkest.
  const HANDLE = [
    '..LLL' + rep('.', 38) + 'LLL..',
    '.LLMML.' + rep('L', 34) + '.LMMLL.',
    '.LMMMM.D' + rep('M', 32) + 'm.MMMML.',
    '.LMMMM.D' + rep('m', 32) + 'D.MMMML.',
    '.MMMM.' + rep('d', 36) + '.MMMM.',
    '..mmD' + rep('.', 38) + 'DmM..'
  ];
  // driver from behind, 26 wide. R hair, r hair shade, k skin, K skin shade, S shirt, s collar, t shirt shade.
  const DRV_HEAD = [
    '.........rRRRRRRr.........',
    '.......rRRRRRRRRRRr.......',
    '......rRRRRRRRRRRRRr......',
    '......RRRRRRRRRRRRRR......',
    '.....rRRRRRRRRRRRRRRr.....',
    '.....RRRRRRRRRRRRRRRR.....',
    '.....RRRRRRRRRRRRRRRR.....',
    '....kRRRRRRRRRRRRRRRRk....',
    '....KRRRRRRRRRRRRRRRRK....',
    '.....rRRRRRRRRRRRRRRr.....',
    '.....rrRRRRRRRRRRRRrr.....',
    '......rrrRRRRRRRRrrr......',
    '.......kkkkkkkkkkkk.......',
    '........KKKKKKKKKK........'
  ];
  const DRV_BODY = [
    '....SSSSSSssssssSSSSSS....',
    '..SSSSSSSSSSSSSSSSSSSSSS..',
    '.tSSSSSSSSSSSSSSSSSSSSSSt.',
    'tSSSSSSSSSSSSSSSSSSSSSSSSt',
    'tSSSSSSSSSSSSSSSSSSSSSSSSt',
    'ttSSSSSSSSSSSSSSSSSSSSSStt',
    'ttSSSSSSSSSSSSSSSSSSSSSStt',
    'ttSSSSSSSSSSSSSSSSSSSSSStt'
  ];
  const DRV_X = (SW - 26) >> 1;

  const SPR = [];     // SPR[defIndex] = [left, center, right], driven by an everyday shopper
  const SPR_ME = [];  // same karts driven by the cutscene hero (the player)
  const SPR_EMPTY = []; // SPR_EMPTY[defIndex] = straight-on cart with nobody in it (parked carts in cutscenes)
  // drivers: [hair, shirt, skin]. ME matches PAL_ME in intro.js.
  const ME = ['#3b2a20', '#7d8592', '#f1c9a0'];
  const SHOPPERS = [['#1c1c22', '#c8504a'], ['#7a5232', '#3a8a5a'], ['#d8b860', '#4a6ab8'], ['#8a8a90', '#b85a9a'], ['#2a1a10', '#e0a030'], ['#5a3420', '#5a5a66']];
  const JOBS = [];    // {cv, d, drv, dx} — repainted when the cart image arrives (drv null = empty cart)
  let IMG = null, imgOk = false;

  const mixW = (h, t) => {   // blend toward white by t
    const n = parseInt(h.slice(1), 16);
    const c = (v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0');
    return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255);
  };
  function blit(g, rows, pal, x0, y0) {
    for (let y = 0; y < rows.length; y++) {
      const r = rows[y];
      for (let x = 0; x < r.length; x++) { const col = pal[r[x]]; if (col) { g.fillStyle = col; g.fillRect(x0 + x, y0 + y, 1, 1); } }
    }
  }
  // per-kart cart colours: bar, grips (BLK = gunmetal bar, gold grips)
  function cartPal(d) {
    const U = PK.U, blk = d.name === 'BLK';
    const bar = blk ? '#5a5a68' : d.color, grip = blk ? '#e8c040' : d.color;
    const p = (c) => ({ L: mixW(c, 0.35), M: c, m: U.darken(c, 0.86), D: U.darken(c, 0.68), d: U.darken(c, 0.52) });
    return { bar: p(bar), grip: p(grip), hub: mixW(grip, 0.45), hubD: U.darken(grip, 0.85) };
  }
  function drvPal(drv) {
    const U = PK.U, skin = drv[2] || '#e9bf95';
    return { R: drv[0], r: U.darken(drv[0], 0.7), k: skin, K: U.darken(skin, 0.86), S: drv[1], s: U.darken(drv[1], 0.8), t: U.darken(drv[1], 0.78) };
  }

  // stand-in cart (before the image loads / if it fails)
  function fallbackCart(g, cp, y) {
    g.fillStyle = '#0b0708'; g.fillRect(0, y + 1, 48, 6); g.fillRect(5, y + 7, 4, 4); g.fillRect(39, y + 7, 4, 4);
    g.fillStyle = cp.bar.M; g.fillRect(1, y + 2, 46, 3);
    g.fillStyle = cp.bar.d; g.fillRect(1, y + 5, 46, 1);
    g.fillStyle = '#0b0708'; g.fillRect(5, y + 10, 38, 26); g.fillRect(6, y + 39, 8, 10); g.fillRect(34, y + 39, 8, 10);
    g.fillStyle = '#b8b4c8'; g.fillRect(6, y + 11, 36, 24);
    g.fillStyle = '#7d7794';
    for (let i = 0; i < 6; i++) g.fillRect(9 + i * 6, y + 12, 1, 22);
    for (let i = 0; i < 4; i++) g.fillRect(7, y + 14 + i * 6, 34, 1);
    g.fillStyle = '#d8d6e0'; g.fillRect(6, y + 36, 36, 2);
    g.fillStyle = cp.hub; g.fillRect(7, y + 41, 6, 1); g.fillRect(35, y + 41, 6, 1);
  }

  function paint(j) {
    const g = j.cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, SW, SH);
    const cp = cartPal(j.d), dx = j.dx;
    const img = imgOk ? IMG : null;
    if (img) g.drawImage(img, 0, CART_Y); else fallbackCart(g, cp, CART_Y);
    // driver: body shifts 2px, head 4px into the lean (tilt)
    if (j.drv) {
      const dp = drvPal(j.drv);
      blit(g, DRV_BODY, dp, DRV_X + dx * 2, DRV_HEAD.length);
      blit(g, DRV_HEAD, dp, DRV_X + dx * 4, 0);
    }
    // handle bar back on top (crosses the driver's neck)
    if (img) g.drawImage(img, 0, 0, SW, 8, 0, CART_Y, SW, 8);
    else { g.fillStyle = '#0b0708'; g.fillRect(0, CART_Y + 1, 48, 6); }
    // recolour bar/grips + wheel hubs to the kart colour
    for (let y = 0; y < HANDLE.length; y++) {
      const r = HANDLE[y];
      for (let x = 0; x < SW; x++) {
        const c = r[x]; if (c === '.') continue;
        g.fillStyle = (x < 6 || x > 41 ? cp.grip : cp.bar)[c];
        g.fillRect(x, CART_Y + 1 + y, 1, 1);
      }
    }
    if (img) {
      g.fillStyle = cp.hub; g.fillRect(7, CART_Y + 41, 4, 1); g.fillRect(37, CART_Y + 41, 5, 1);
      g.fillStyle = cp.hubD; g.fillRect(6, CART_Y + 41, 1, 1);
    }
  }

  function loadImg() {
    if (IMG || typeof Image === 'undefined') return;
    IMG = new Image();
    IMG.onload = () => { imgOk = true; JOBS.forEach(paint); };
    IMG.onerror = () => { imgOk = false; };
    IMG.src = 'assets/cart.png';
  }

  function init() {
    if (!PK.U || typeof document === 'undefined') return;
    loadImg();
    if (IMG && IMG.complete && IMG.naturalWidth) imgOk = true;
    SPR.length = 0; SPR_ME.length = 0; SPR_EMPTY.length = 0; JOBS.length = 0;
    for (const d of DEFS) {
      const build = (drv) => [-1, 0, 1].map((dx) => {
        const cv = document.createElement('canvas');
        cv.width = SW; cv.height = SH;
        const j = { cv, d, drv, dx };
        JOBS.push(j); paint(j);
        return cv;
      });
      SPR.push(build(SHOPPERS[d.id % SHOPPERS.length]));
      SPR_ME.push(build(ME));
      // empty cart: one straight-on canvas, same size, painted/repainted like the others
      const ecv = document.createElement('canvas');
      ecv.width = SW; ecv.height = SH;
      const ej = { cv: ecv, d, drv: null, dx: 0 };
      JOBS.push(ej); paint(ej);
      SPR_EMPTY.push(ecv);
    }
  }
  // straight-on sprite for menus/cutscenes; empty = true -> the same cart with no driver
  function sprite(defIndex, isPlayer, empty) {
    if (empty) return SPR_EMPTY[defIndex] || null;
    const s = (isPlayer ? SPR_ME : SPR)[defIndex]; return s ? s[1] : null;
  }
  function emptySprite(defIndex) { return SPR_EMPTY[defIndex] || null; }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  function create(defIndex, gridIdx, lat, isPlayer) {
    const T = PK.Track, d = DEFS[defIndex];
    const N = T && T.N ? T.N : 1;
    const gi = ((gridIdx % N) + N) % N;
    const p = T && T.PTS ? T.PTS[gi] : [0, 0];
    const t = T && T.TAN ? T.TAN[gi] : 0;
    const x = p[0] - Math.sin(t) * lat, y = p[1] + Math.cos(t) * lat;
    const roadHalf = T && T.ROAD_W ? T.ROAD_W / 2 - 6 : 16;
    return {
      x, y, a: t, ma: t, v: 0,
      def: d, defIndex, name: d.name, color: d.color, isPlayer: !!isPlayer,
      idx: gi, lat, lap: 0, maxLap: 0, prog: gi, offroad: false,
      hop: 0, drift: false, driftDir: 0, charge: 0,
      boostT: 0, gauge: 0, stock: 0,
      steerIn: 0, finished: false, finishTime: 0, lapStart: 0, lapTimes: [], wrongT: 0,
      skillCd: 0,
      fx: { spin: 0, slow: 0, shield: 0, buff: 0, buffMul: 1, ghost: 0 },
      spinA: 0,
      ai: { lane: clamp(lat * 0.6, -roadHalf, roadHalf), phase: Math.random() * TAU, skill: 0.9, rubber: 1,
            stuckT: 0, revT: 0, driftCd: 0, wantDrift: false, t: 0 },
      prev: { drift: false, boost: false, skill: false },
      // internal (underscore = private to karts.js)
      _hopV: 0, _bumpT: 0, _onPad: false, _puddle: false, _topV: 0
    };
  }

  // ---------------------------------------------------------------------------
  // Track helpers
  // ---------------------------------------------------------------------------
  let _spN = -1, _sp = 6;
  function spacing(T) {
    if (_spN !== T.N) {
      let s = 0; const n = Math.min(T.N, 40);
      for (let i = 0; i < n; i++) { const a = T.PTS[i], b = T.PTS[(i + 1) % T.N]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      _sp = s / n || 6; _spN = T.N;
    }
    return _sp;
  }
  const wrapI = (i, N) => ((i % N) + N) % N;

  // ---------------------------------------------------------------------------
  // update: physics + track tracking
  // ---------------------------------------------------------------------------
  function update(k, inp, dt, G) {
    const d = k.def, fx = k.fx, T = PK.Track;
    inp = inp || {};
    const w = d.weight;

    // ---- read input (tolerant to a couple of shapes) ----
    let steerRaw = inp.steer !== undefined ? +inp.steer || 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let gas = !!(inp.gas || inp.up || inp.accel);
    let brake = !!(inp.brake || inp.down);
    let driftBtn = !!inp.drift;
    const boostBtn = !!inp.boost, skillBtn = !!inp.skill;
    const spinning = fx.spin > 0;
    if (spinning) { steerRaw = 0; gas = false; brake = false; driftBtn = false; }
    steerRaw = clamp(steerRaw, -1, 1);
    // smooth steering (digital keys -> analog feel)
    const sr = 9 * dt;
    k.steerIn += clamp(steerRaw - k.steerIn, -sr, sr);
    const steer = k.steerIn;

    // ---- status effect timers ----
    if (fx.spin > 0) { fx.spin -= dt; k.spinA += 16 * dt; if (fx.spin <= 0) { fx.spin = 0; k.spinA = 0; } }
    if (fx.slow > 0) fx.slow = Math.max(0, fx.slow - dt);
    if (fx.shield > 0) fx.shield = Math.max(0, fx.shield - dt);
    if (fx.ghost > 0) fx.ghost = Math.max(0, fx.ghost - dt);
    if (fx.buff > 0) { fx.buff = Math.max(0, fx.buff - dt); if (fx.buff === 0) fx.buffMul = 1; }
    if (k.boostT > 0) k.boostT = Math.max(0, k.boostT - dt);
    if (k._bumpT > 0) k._bumpT -= dt;

    // ---- surface checks ----
    let inPuddle = false;
    if (T && T.puddles) {
      for (let i = 0; i < T.puddles.length; i++) {
        const p = T.puddles[i], dx = k.x - p.x, dy = k.y - p.y;
        if (dx * dx + dy * dy < p.r * p.r) { inPuddle = true; break; }
      }
    }
    k._puddle = inPuddle;
    let onPad = false;
    if (T && T.pads && k.hop <= 0.5) {
      for (let i = 0; i < T.pads.length; i++) {
        const p = T.pads[i], dx = k.x - p.x, dy = k.y - p.y;
        if (dx * dx + dy * dy < PAD_R * PAD_R) { onPad = true; break; }
      }
    }
    if (onPad) {
      if (!k._onPad) sfx(G, k, 'pad');
      k.boostT = Math.max(k.boostT, 1.0);
    }
    k._onPad = onPad;

    // ---- manual booster (edge) ----
    if (boostBtn && !k.prev.boost && k.stock > 0 && !spinning) {
      k.stock--; k.boostT = Math.max(k.boostT, 1.6); sfx(G, k, 'boost');
    }
    // ---- skill (edge for player; AI re-fires while wanting, tryUse checks cooldown) ----
    if (skillBtn && (!k.prev.skill || !k.isPlayer) && !spinning && PK.Skills && PK.Skills.tryUse && k.skillCd <= 0) {
      PK.Skills.tryUse(k, G);
    }

    // ---- hop ----
    if (driftBtn && !k.prev.drift && k.hop <= 0 && k.v > 20) k._hopV = 42;
    if (k._hopV !== 0 || k.hop > 0) {
      k.hop += k._hopV * dt; k._hopV -= 420 * dt;
      if (k.hop <= 0) { k.hop = 0; k._hopV = 0; }
    }

    // ---- drift state ----
    if (!k.drift) {
      if (driftBtn && Math.abs(steer) > 0.3 && k.v > DRIFT_MIN_V && !inPuddle) {
        k.drift = true; k.driftDir = steer > 0 ? 1 : -1; k.charge = 0;
      }
    } else if (!driftBtn || k.v < DRIFT_END_V || spinning) {
      // release -> mini-turbo
      if (!spinning && k.v >= DRIFT_END_V) {
        if (k.charge >= MT_BIG) { k.boostT = Math.max(k.boostT, 1.0); addGauge(k, 12, G); sfx(G, k, 'boost'); }
        else if (k.charge >= MT_SMALL) { k.boostT = Math.max(k.boostT, 0.5); addGauge(k, 6, G); sfx(G, k, 'boost'); }
      }
      k.drift = false; k.driftDir = 0; k.charge = 0;
    }

    // ---- speed cap ----
    let cap = d.maxV;
    const offMul = 0.5 + w * 0.04;               // heavy karts are less slowed offroad (0.54 .. 0.70)
    if (k.offroad && k.boostT <= 0) cap *= offMul;
    if (k.boostT > 0) cap *= d.boostPow;
    if (fx.slow > 0) cap *= 0.55;
    if (fx.buff > 0) cap *= fx.buffMul || 1;
    if (inPuddle) cap *= 0.92;
    if (!k.isPlayer) cap *= (k.ai.skill || 0.9) * (k.ai.rubber || 1);

    // ---- longitudinal ----
    let acc = d.acc;
    if (k.boostT > 0) acc += 320;
    if (fx.buff > 0) acc += 200;
    if (spinning) {
      k.v *= Math.max(0, 1 - 2.6 * dt);
    } else if (gas || (k.boostT > 0 && !brake)) {
      if (k.v < 0) k.v = Math.min(0, k.v + BRAKE * dt);
      else if (k.v < cap) {
        const r = k.v / cap;
        k.v = Math.min(cap, k.v + acc * (1 - 0.55 * r * r) * dt);
      }
    } else if (brake) {
      if (k.v > 0) k.v = Math.max(0, k.v - BRAKE * dt);
      else k.v = Math.max(REV_MAX, k.v - d.acc * 0.55 * dt);
    } else {
      const f = (COAST + Math.abs(k.v) * 0.12) * dt;
      k.v = k.v > 0 ? Math.max(0, k.v - f) : Math.min(0, k.v + f);
    }
    if (k.v > cap) {
      // over the cap (boost ended, offroad, hit...) -> bleed off; offroad bleeds faster
      const bleed = (k.offroad ? 260 : 110) * dt;
      k.v = Math.max(cap, k.v - bleed);
    }
    if (k.offroad && k.v > 0) k.v *= 1 - (0.35 - w * 0.04) * dt;   // extra rolling drag on carpet
    if (k.v < REV_MAX) k.v = REV_MAX;

    // ---- steering ----
    const av = Math.abs(k.v);
    const speedF = clamp(av / 45, 0, 1) * (1 - 0.22 * clamp(av / d.maxV, 0, 1.4));
    const dirS = k.v >= 0 ? 1 : -1;
    if (k.drift) {
      // drifting: base rotation into the drift, steering tightens (into) or widens (counter)
      const rate = (k.driftDir * 0.72 + steer * 0.5) * d.turn * Math.max(speedF, 0.6);
      k.a += rate * dt;
      const into = steer * k.driftDir > 0.3;
      k.charge += dt * (into ? 1.25 : 0.8);
      addGauge(k, dt * (into ? 19 : 11), G);
      k.v *= 1 - 0.06 * dt;
    } else if (!spinning) {
      k.a += steer * d.turn * speedF * dirS * dt;
    }
    k.a = wrapAng(k.a);

    // ---- grip: movement angle follows heading ----
    let grip = d.grip;
    if (k.drift) grip *= 0.24;
    if (inPuddle) grip *= 0.12 + w * 0.05;    // light karts slide more in milk
    if (spinning) grip *= 0.5;
    const diff = angDiff(k.ma, k.a);
    k.ma = wrapAng(k.ma + diff * Math.min(1, grip * dt));
    // scrub speed while sliding sideways
    const slip = Math.abs(Math.sin(angDiff(k.ma, k.a)));
    if (slip > 0.05 && k.v > 0) k.v *= 1 - slip * 0.5 * dt;
    if (inPuddle && k.v > 0) {
      k.v *= 1 - 0.25 * dt;
      // a light kart wobbles in the milk
      k.a += (Math.random() - 0.5) * (0.6 / w) * dt * 6;
    }

    // clean driving at top speed fills a little gauge
    if (!k.drift && !k.offroad && k.v > d.maxV * 0.9 && k.boostT <= 0) addGauge(k, 3 * dt, G);

    // ---- integrate position ----
    k.x += Math.cos(k.ma) * k.v * dt;
    k.y += Math.sin(k.ma) * k.v * dt;
    if (k.v > k._topV) k._topV = k.v;

    // ---- track tracking ----
    if (T && T.N && T.nearestLocal) trackTrack(k, dt, G, T);

    // NaN safety net
    if (!isFinite(k.x) || !isFinite(k.y) || !isFinite(k.v) || !isFinite(k.a)) resetToTrack(k, T);

    k.prev.drift = driftBtn || !!inp.drift;
    k.prev.boost = boostBtn;
    k.prev.skill = skillBtn;
  }

  function wrapAng(a) {
    if (a > Math.PI || a < -Math.PI) a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a;
  }

  function addGauge(k, amt, G) {
    if (k.stock >= STOCK_MAX) { k.gauge = Math.min(GAUGE_MAX, k.gauge + amt); return; }
    k.gauge += amt;
    if (k.gauge >= GAUGE_MAX) {
      k.stock++; k.gauge = k.stock >= STOCK_MAX ? 0 : k.gauge - GAUGE_MAX;
      sfx(G, k, 'gauge');
    }
  }

  function resetToTrack(k, T) {
    if (!T || !T.PTS) { k.x = k.y = k.v = 0; k.a = k.ma = 0; return; }
    const p = T.PTS[k.idx];
    k.x = p[0]; k.y = p[1]; k.a = k.ma = T.TAN[k.idx]; k.v = 0; k.lat = 0;
  }

  function trackTrack(k, dt, G, T) {
    const N = T.N, oldIdx = k.idx;
    let r = T.nearestLocal(k.idx, k.x, k.y, 20);
    if (!r || r.d > T.BARRIER * 2.5) { const r2 = T.nearestAll ? T.nearestAll(k.x, k.y) : null; if (r2) r = r2; }
    if (!r) return;
    k.idx = r.i; k.lat = r.lat;
    k.offroad = Math.abs(r.lat) > T.OFFROAD_D;

    // invisible wall
    if (Math.abs(r.lat) > T.BARRIER) {
      const t = T.TAN[r.i], p = T.PTS[r.i], s = r.lat > 0 ? 1 : -1;
      const lat = s * (T.BARRIER - 0.5);
      k.x = p[0] - Math.sin(t) * lat; k.y = p[1] + Math.cos(t) * lat; k.lat = lat;
      // deflect movement along the wall (keep the tangential part, point slightly inward)
      const along = Math.abs(angDiff(t, k.ma)) <= Math.PI / 2 ? t : t + Math.PI;
      const fwdSign = along === t ? 1 : -1;
      const outward = Math.sin(angDiff(along, k.ma)) * s * fwdSign > 0;
      if (outward) k.ma = wrapAng(along - s * fwdSign * 0.12);
      if (k._bumpT <= 0) {
        k.v *= 0.6; k._bumpT = 0.35; sfx(G, k, 'bump');
        if (k.drift) { k.drift = false; k.driftDir = 0; k.charge = 0; }
      } else k.v *= 1 - 1.2 * dt;
      // nudge heading back toward track direction
      k.a = wrapAng(k.a + angDiff(k.a, Math.abs(angDiff(t, k.a)) > Math.PI / 2 ? t + Math.PI : t) * Math.min(1, 3 * dt) * 0.5);
    }

    // laps
    if (oldIdx > 0.8 * N && k.idx < 0.2 * N) {
      k.lap++;
      if (k.lap > k.maxLap) { k.maxLap = k.lap; if (G && G.onLap) G.onLap(k); }
    } else if (oldIdx < 0.2 * N && k.idx > 0.8 * N) {
      k.lap--;
    }
    k.prog = k.lap * N + k.idx;

    // wrong way detection
    const head = k.v >= 0 ? k.a : k.a + Math.PI;
    if (Math.abs(angDiff(T.TAN[k.idx], head)) > 1.9 && Math.abs(k.v) > 8) k.wrongT += dt;
    else k.wrongT = 0;
  }

  // ---------------------------------------------------------------------------
  // collide: weight-based kart-kart collisions
  // ---------------------------------------------------------------------------
  function collide(karts) {
    const R2 = KART_R * 2;
    for (let i = 0; i < karts.length; i++) {
      const A = karts[i];
      if (A.fx.ghost > 0) continue;
      for (let j = i + 1; j < karts.length; j++) {
        const B = karts[j];
        if (B.fx.ghost > 0) continue;
        let dx = B.x - A.x, dy = B.y - A.y;
        const dsq = dx * dx + dy * dy;
        if (dsq >= R2 * R2) continue;
        let dist = Math.sqrt(dsq);
        if (dist < 1e-4) { dx = Math.cos(A.a + 1.5708); dy = Math.sin(A.a + 1.5708); dist = 1; } else { dx /= dist; dy /= dist; }
        const mA = A.def.mass, mB = B.def.mass, M = mA + mB;
        const over = R2 - dist;
        // separate by mass ratio: light kart moves more
        A.x -= dx * over * (mB / M); A.y -= dy * over * (mB / M);
        B.x += dx * over * (mA / M); B.y += dy * over * (mA / M);
        // velocity exchange along normal
        const avx = Math.cos(A.ma) * A.v, avy = Math.sin(A.ma) * A.v;
        const bvx = Math.cos(B.ma) * B.v, bvy = Math.sin(B.ma) * B.v;
        const vn = (bvx - avx) * dx + (bvy - avy) * dy;
        if (vn < 0) {
          const J = -(1 + RESTITUTION) * vn / (1 / mA + 1 / mB);
          setVel(A, avx - dx * J / mA, avy - dy * J / mA);
          setVel(B, bvx + dx * J / mB, bvy + dy * J / mB);
          if (-vn > 15) {
            const G = PK.Game;
            if ((A.isPlayer || B.isPlayer) && G && G.sfx) G.sfx('bump');
          }
        }
        // lateral shove proportional to the other's mass (heavy shoves light)
        const shove = 6 * over;
        A.x -= dx * shove * (mB / M) * 0.1; A.y -= dy * shove * (mB / M) * 0.1;
        B.x += dx * shove * (mA / M) * 0.1; B.y += dy * shove * (mA / M) * 0.1;
      }
    }
  }
  function setVel(k, vx, vy) {
    const sp = Math.hypot(vx, vy);
    if (sp < 1e-3) { k.v = 0; return; }
    const ang = Math.atan2(vy, vx);
    const fwd = Math.cos(ang - k.a) >= 0;
    k.v = fwd ? sp : -Math.min(sp, -REV_MAX);
    k.ma = fwd ? ang : wrapAng(ang + Math.PI);
  }

  // ---------------------------------------------------------------------------
  // hit
  // ---------------------------------------------------------------------------
  function hit(k, type, dur) {
    const fx = k.fx;
    if (fx.shield > 0) { fx.shield = 0; return false; }
    if (type === 'spin') {
      fx.spin = Math.max(fx.spin, dur || 1.2);
      k.v *= 0.35;
      k.drift = false; k.driftDir = 0; k.charge = 0; k.boostT = 0;
    } else if (type === 'slow') {
      fx.slow = Math.max(fx.slow, (dur || 2) * (1.15 - k.def.weight * 0.07));
    }
    const G = PK.Game;
    if (k.isPlayer && G && G.sfx) G.sfx('hit');
    return true;
  }

  // ---------------------------------------------------------------------------
  // AI
  // ---------------------------------------------------------------------------
  // true if the next `n` centerline points contain no curve tighter than ~radius 220
  function straightAhead(T, i0, n, sp) {
    const N = T.N; let sum = 0;
    for (let m = 0; m < n; m += 2) {
      const da = angDiff(T.TAN[wrapI(i0 + m, N)], T.TAN[wrapI(i0 + m + 2, N)]);
      if (Math.abs(da) / (2 * sp) > 1 / 150) return false;
      sum += da;
    }
    return Math.abs(sum) < 0.5;
  }

  function aiInput(k, G) {
    const T = PK.Track;
    const out = { steer: 0, gas: true, brake: false, drift: false, boost: false, skill: false };
    if (!T || !T.N) return out;
    const N = T.N, sp = spacing(T), ai = k.ai, d = k.def;
    const dt = 1 / 60;
    ai.t += dt;
    const skill = k.isPlayer ? 0.92 : (ai.skill || 0.9);

    // ---- rubber banding ----
    if (!k.isPlayer) {
      const P = G && G.player;
      let target = 1;
      if (P && P !== k && G.state !== 'title') {
        const gap = (P.prog - k.prog) / N;   // laps; >0 = AI behind player
        target = 1 + clamp(gap * 0.25, -0.07, 0.07);
      }
      ai.rubber += (target - ai.rubber) * Math.min(1, dt * 0.8);
    } else ai.rubber = 1;

    // ---- racing line target ----
    const look = Math.round(3 + Math.max(0, k.v) * 0.065);
    const j = wrapI(k.idx + look, N);
    const tj = T.TAN[j], pj = T.PTS[j];
    const halfRoad = T.ROAD_W / 2 - 5;
    // drifting wide toward the edge -> aim back to the centre of the road
    const edge = Math.abs(k.lat) > halfRoad - 3;
    const lane = edge ? 0 : clamp(ai.lane + Math.sin(ai.t * 0.55 + ai.phase) * 3, -halfRoad, halfRoad);
    const tx = pj[0] - Math.sin(tj) * lane, ty = pj[1] + Math.cos(tj) * lane;
    const want = Math.atan2(ty - k.y, tx - k.x);
    let err = angDiff(k.a, want);
    out.steer = clamp(err * 2.4, -1, 1);

    // ---- curvature ahead -> target speed ----
    const span = Math.round(10 + Math.max(0, k.v) * 0.12);
    let kMax = 0, sumAng = 0;
    for (let m = 0; m < span; m += 2) {
      const a0 = T.TAN[wrapI(k.idx + m, N)], a1 = T.TAN[wrapI(k.idx + m + 2, N)];
      const da = angDiff(a0, a1);
      if (m < 24) sumAng += da;
      const kap = Math.abs(da) / (2 * sp);
      // far curvature matters less (we have room to brake)
      const wgt = 1 - m / (span * 1.6);
      if (kap * wgt > kMax) kMax = kap * wgt;
    }
    let cap = d.maxV * skill * ai.rubber;
    const turnEff = d.turn * 0.74 * (0.75 + skill * 0.25);
    let vt = kMax > 1e-4 ? Math.min(cap, turnEff / kMax) : cap;
    if (k.drift) vt = Math.max(vt, cap * 0.85);   // drifting turns tighter
    if (edge && !k.drift) vt *= 0.88;
    vt = Math.max(vt, 55);
    if (k.v > vt + 14) { out.gas = false; out.brake = true; }
    else if (k.v > vt + 4) { out.gas = false; }

    // ---- drifting through long sharp curves ----
    if (ai.driftCd > 0) ai.driftCd -= dt;
    if (!k.drift) {
      if (ai.driftCd <= 0 && skill >= 0.86 && Math.abs(sumAng) > 0.75 && k.v > 75 && !k.offroad) {
        ai.wantDrift = Math.random() < (skill - 0.8) * 4;
        ai.driftCd = 1.2;
        ai.driftSide = sumAng > 0 ? 1 : -1;
      }
      if (ai.wantDrift && Math.abs(sumAng) > 0.6) {
        out.drift = true;
        out.steer = ai.driftSide;
      } else ai.wantDrift = false;
    } else {
      // hold the drift while the curve continues; release on straight or big charge
      let near = 0;
      for (let m = 0; m < 10; m += 2) near += angDiff(T.TAN[wrapI(k.idx + m, N)], T.TAN[wrapI(k.idx + m + 2, N)]);
      const keep = Math.abs(near) > 0.1 && near * k.driftDir > 0 && k.charge < 2.4 && Math.abs(k.lat) < T.OFFROAD_D - 4;
      out.drift = keep;
      if (!keep) ai.wantDrift = false;
      out.gas = true; out.brake = false;
    }

    // ---- booster stock on straights ----
    if (k.stock > 0 && k.boostT <= 0 && !k.drift && k.v > cap * 0.6 && Math.abs(err) < 0.2 && straightAhead(T, k.idx, 50, sp)) {
      out.boost = !k.prev.boost;
    }

    // ---- unstuck ----
    if (ai.revT > 0) {
      ai.revT -= dt;
      out.gas = false; out.brake = true; out.drift = false;
      out.steer = -Math.sign(err || 1);
    } else if (Math.abs(k.v) < 6 && k.fx.spin <= 0 && (G ? G.state !== 'countdown' : true)) {
      ai.stuckT += dt;
      if (ai.stuckT > 1.5) { ai.stuckT = 0; ai.revT = 0.8; }
    } else ai.stuckT = 0;

    // also back out if facing the wrong way and crawling
    if (Math.abs(angDiff(T.TAN[k.idx], k.a)) > 2.2 && k.v < 30 && ai.revT <= 0) out.steer = err > 0 ? 1 : -1;

    out.skill = PK.Skills && PK.Skills.aiWants ? !!PK.Skills.aiWants(k, G) : false;
    return out;
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------
  function frame(k, camA) {
    const s = (k.isPlayer ? SPR_ME : SPR)[k.defIndex];
    if (!s) return null;
    if (k.fx.spin > 0) {
      const f = Math.floor(k.spinA / (Math.PI / 2)) & 3;
      return s[f === 0 ? 1 : f === 1 ? 2 : f === 2 ? 1 : 0];
    }
    let lean = 0;
    if (k.isPlayer) {
      if (k.drift) lean = k.driftDir;
      else if (k.steerIn > 0.3) lean = 1; else if (k.steerIn < -0.3) lean = -1;
    } else {
      const rel = angDiff(camA === undefined ? k.a : camA, k.a);
      if (k.drift) lean = k.driftDir;
      else if (rel > 0.22) lean = 1; else if (rel < -0.22) lean = -1;
    }
    return s[lean + 1];
  }

  // ---------------------------------------------------------------------------
  // drawFx: cheap pixel particles around the kart on screen
  // ---------------------------------------------------------------------------
  const STAR_COLS = ['#fff27a', '#ffffff', '#ffd040'];
  function drawFx(g, k, sx, sy, w) {
    if (!g || !(w > 0)) return;
    const s = Math.max(1, Math.round(w / 16));
    const hopPx = Math.round((k.hop || 0) * w / 6.5);
    const by = Math.round(sy) - hopPx;
    const lx = Math.round(sx - w * 0.31), rx = Math.round(sx + w * 0.31);   // cart wheels
    const R = Math.random;
    const px = (x, y, c, sz) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, sz || s, sz || s); };

    // drift sparks at rear wheels
    if (k.drift && k.charge > 0.15) {
      const c = k.charge >= MT_BIG ? (R() < 0.5 ? '#ff9a20' : '#ffd040') : k.charge >= MT_SMALL ? (R() < 0.5 ? '#40a0ff' : '#a0e0ff') : '#ffffff';
      const n = k.charge >= MT_SMALL ? 4 : 2;
      for (let i = 0; i < n; i++) {
        px(lx + (R() * 6 - 3) * s, by - R() * 3 * s, c);
        px(rx + (R() * 6 - 3) * s, by - R() * 3 * s, c);
      }
    }
    // boost flame from under the basket, between the wheels
    if (k.boostT > 0) {
      const ex1 = Math.round(sx - w * 0.19), ex2 = Math.round(sx + w * 0.19), ey = by - Math.round(w * 0.2);
      const len = 2 + ((R() * 3) | 0);
      for (let i = 0; i < len; i++) {
        const c = i === 0 ? '#ffffff' : i < 2 ? '#ffe060' : '#ff7a20';
        px(ex1 + (R() < 0.5 ? 0 : -s), ey + i * s, c);
        px(ex2 + (R() < 0.5 ? 0 : s), ey + i * s, c);
      }
    }
    // offroad dust
    if (k.offroad && Math.abs(k.v) > 25) {
      for (let i = 0; i < 3; i++) {
        const c = R() < 0.5 ? '#a08a68' : '#c8b490';
        px(lx - R() * 5 * s, by - R() * 4 * s, c);
        px(rx + R() * 5 * s, by - R() * 4 * s, c);
      }
    }
    // puddle (milk) splash
    if (k._puddle && Math.abs(k.v) > 20) {
      for (let i = 0; i < 3; i++) {
        px(lx + (R() * 8 - 6) * s, by - (1 + R() * 5) * s, R() < 0.6 ? '#ffffff' : '#e8f0ff');
        px(rx + (R() * 8 - 2) * s, by - (1 + R() * 5) * s, R() < 0.6 ? '#ffffff' : '#e8f0ff');
      }
    }
    // shield bubble
    if (k.fx.shield > 0 && (k.fx.shield > 1 || ((k.fx.shield * 10) | 0) % 2 === 0)) {
      const cx = sx, cy = by - w * SH / SW * 0.5, rr = w * 0.72;
      g.fillStyle = '#9ff0ff';
      for (let i = 0; i < 28; i++) {
        const an = i * TAU / 28;
        g.fillRect(Math.round(cx + Math.cos(an) * rr), Math.round(cy + Math.sin(an) * rr * 0.85), s, s);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(cx - rr * 0.45), Math.round(cy - rr * 0.5), s * 2, s);
    }
    // spin stars over the driver
    if (k.fx.spin > 0) {
      const cy = by - w * SH / SW * 1.02;
      for (let i = 0; i < 3; i++) {
        const an = k.spinA * 0.6 + i * TAU / 3;
        const x = Math.round(sx + Math.cos(an) * w * 0.4), y = Math.round(cy + Math.sin(an) * w * 0.12);
        g.fillStyle = STAR_COLS[i];
        g.fillRect(x, y - s, s, s * 3); g.fillRect(x - s, y, s * 3, s);
      }
    }
  }

  PK.Karts = { DEFS, init, create, update, collide, aiInput, hit, drawFx, frame, sprite, emptySprite };
})(window.PK);
