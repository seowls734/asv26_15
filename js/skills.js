// PK.Skills — mart-themed kart skills (one per kart; bats/phase for the World 2 vampire/ghost), world objects, AI usage.
// Contract: see CONTRACT.md "PK.Skills". Only defines things at load time; real work in init().
window.PK = window.PK || {};
(function (PK) {
  'use strict';

  const TAU = Math.PI * 2;
  const MAX_PEELS = 12, MAX_MELONS = 8, MAX_FOAMS = 6;
  const PEEL_LIFE = 25, PEEL_R = 4, PEEL_GRACE = 1.0;
  const MELON_LIFE = 4, MELON_R = 5;
  const FOAM_LIFE = 6, FOAM_R = 12, FOAM_HIT_CD = 1.0;
  const RUSH_T = 0.9;
  const MAG_T = 1.6, MAG_STEAL = 30;
  const MAX_SWARMS = 4, BAT_LIFE = 4.5, BAT_R = 6, BAT_STEAL = 25, BAT_STUN = 0.7, DRAIN_T = 0.8;
  const PHASE_T = 3, PHASE_MUL = 1.12;

  // ---------------------------------------------------------------- state
  const peels = [];   // {x, y, age, owner}
  const swarms = [];  // {fi, lat, x, y, t, owner, speed, target} — bat flocks following the track
  const melons = [];  // {fi, lat, lv, x, y, h, t, owner, speed, bounces, target}
  const foams = [];   // {x, y, t, owner, r}
  let kst = new Map(); // kart -> per-kart skill state
  let clock = 0;       // internal seconds (advanced by update)
  let rnd = Math.random;

  // sprites (built in init)
  const SPR = { peel: null, melon: [null, null], foam: [], cart: null, magnet: null, coin: null, wrap: null,
                bat: [null, null], drop: null, wisp: null, gpx: [], box: [], boxSh: null, mis: [null, null], trail: [] };
  const glitches = [];  // {x, y, t} teleport pixel bursts
  // ❓ item boxes (rows across the road) + 장바구니 미사일 (homing basket from the box pool)
  const boxes = [];     // {x, y, t (respawn left), age, ph}
  const missiles = [];  // {fi, lat, x, y, h, t, owner, speed, target}
  const BOX_R = 6, BOX_RESPAWN = 3, BOX_ROLL = 0.8;
  const MIS_LIFE = 6, MIS_R = 5, MIS_V = 250, MIS_ACC = 60, MIS_STUN = 1.3, MAX_MIS = 6;
  const BOX_IDS = ['banana', 'turbo', 'shield', 'magnet', 'cloak', 'missile'];
  const BOX = {
    banana: { nameKo: '바나나', en: 'BANANA!', icon: null },
    turbo: { nameKo: '터보', en: 'TURBO!', icon: null },
    shield: { nameKo: '방패', en: 'SHIELD!', icon: null },
    magnet: { nameKo: '음식 자석', en: 'FOOD MAGNET!', icon: null },
    cloak: { nameKo: '유령 망토', en: 'CLOAK!', icon: null },
    missile: { nameKo: '장바구니 미사일', en: 'BASKET MISSILE!', icon: null }
  };
  const BOX_MAG_T = 5, BOX_SHIELD_T = 6;
  const TELE_FX = 0.7;

  // sprite pool for sprites()
  const POOL_N = 320;
  const pool = [];
  const out = [];
  for (let i = 0; i < POOL_N; i++) pool.push({ x: 0, y: 0, h: 0, spr: null, w: 1 });
  let pn = 0;
  function emit(x, y, h, spr, w) {
    if (pn >= POOL_N || !spr) return;
    const o = pool[pn++];
    o.x = x; o.y = y; o.h = h; o.spr = spr; o.w = w;
    out.push(o);
  }

  // foam bubble layout inside a cloud (unit offsets, size, bob phase)
  const FOAM_LAYOUT = [];
  (function () {
    const r = PK.U && PK.U.rng ? PK.U.rng(777) : Math.random;
    FOAM_LAYOUT.push({ ox: 0, oy: 0, s: 1.25, ph: 0, v: 0 });
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * TAU + r() * 0.5;
      const d = i % 2 ? 0.85 : 0.5;
      FOAM_LAYOUT.push({ ox: Math.cos(ang) * d, oy: Math.sin(ang) * d, s: 0.7 + r() * 0.6, ph: r() * TAU, v: i % 3 });
    }
  })();

  function S(k) {
    let s = kst.get(k);
    if (!s) {
      s = { rushT: 0, rushHit: new Set(), magT: 0, magTarget: null, coinT: 0, coinX: 0, coinY: 0,
            wrapT: 0, soapCd: 0, drainT: 0, drainFrom: null, readySince: -1, aiDelay: 0.5, eager: 0.6 + rnd() * 0.4,
            boxSince: -1, boxDelay: 0.8 };
      kst.set(k, s);
    }
    return s;
  }

  // ---------------------------------------------------------------- helpers
  const T = () => PK.Track;
  function wrapI(i, N) { return ((i % N) + N) % N; }
  function tanAt(i) { const t = T(); return t.TAN[wrapI(Math.floor(i), t.N)]; }
  function barrier() { const t = T(); return (t && t.BARRIER) || 30; }
  function sfx(G, n) { if (G && typeof G.sfx === 'function') G.sfx(n); }

  // circular track-index distance from a to b in race direction (0..N)
  function idxAhead(a, b, N) { return wrapI(b - a, N); }

  function giveBuff(k, t, mul) {
    const fx = k.fx;
    if (fx.buff > 0) fx.buffMul = Math.max(fx.buffMul || 1, mul);
    else fx.buffMul = mul;
    fx.buff = Math.max(fx.buff || 0, t);
  }

  function hitKart(victim, type, dur, G, owner) {
    if (!victim || victim.fx.ghost > 0) return false;
    let ok = true;
    if (PK.Karts && typeof PK.Karts.hit === 'function') ok = PK.Karts.hit(victim, type, dur);
    if (victim.isPlayer || (owner && owner.isPlayer)) sfx(G, ok ? 'hit' : 'bump');
    return ok;
  }

  // keep a world point inside the barrier (used for dropped objects)
  function clampToRoad(k, p, margin) {
    const t = T();
    if (!t || typeof t.nearestLocal !== 'function') return;
    const n = t.nearestLocal(k.idx | 0, p.x, p.y, 12);
    if (!n) return;
    const lim = barrier() - margin;
    if (Math.abs(n.lat) > lim) {
      const ex = n.lat - Math.sign(n.lat) * lim;
      const ta = t.TAN[n.i];
      p.x -= -Math.sin(ta) * ex; p.y -= Math.cos(ta) * ex;
    }
  }

  // sprite builder from a per-pixel char function
  function procSprite(w, h, fn, pal) {
    const rows = [];
    for (let y = 0; y < h; y++) { let r = ''; for (let x = 0; x < w; x++) r += fn(x, y); rows.push(r); }
    return PK.U.makeSprite(rows, pal);
  }
  // round bubble: o = rim, p = fill, w = highlight
  function bubbleSprite(n, pal) {
    const c = (n - 1) / 2, R = n / 2;
    return procSprite(n, n, (x, y) => {
      const d = Math.hypot(x - c, y - c);
      if (d > R - 0.1) return '.';
      if (d > R - 1.1) return 'o';
      if (Math.hypot(x - c * 0.55, y - c * 0.55) < n * 0.14 + 0.4) return 'w';
      return 'p';
    }, pal);
  }

  // ---------------------------------------------------------------- DEFS
  const DEFS = {
    cart_rush: { nameKo: '카트 러시', name: 'CART RUSH', cooldown: 10,
      desc: '쇼핑카트를 앞세워 0.9초 초고속 돌진! 들이받은 카트는 스핀', icon: null },
    banana: { nameKo: '바나나 껍질', name: 'BANANA', cooldown: 9,
      desc: '뒤에 바나나 껍질 3개를 깔아 밟은 카트를 미끄러뜨린다', icon: null },
    watermelon: { nameKo: '수박 투척', name: 'WATERMELON', cooldown: 11,
      desc: '앞쪽 카트를 쫓아 굴러가는 수박을 던져 스핀시킨다', icon: null },
    soap: { nameKo: '세제 거품', name: 'SOAP FOAM', cooldown: 10,
      desc: '뒤로 미끌미끌 거품을 뿌려 들어온 카트를 감속, 핸들이 흔들린다', icon: null },
    bubble: { nameKo: '뽁뽁이 실드', name: 'BUBBLE WRAP', cooldown: 12,
      desc: '5초간 공격 1회를 막는 뽁뽁이 실드 + 약간의 가속', icon: null },
    magnet: { nameKo: '할인 자석', name: 'MAGNET', cooldown: 13,
      desc: '앞 카트에게 끌려가며 부스터 게이지를 최대 30 훔친다', icon: null },
    bats: { nameKo: '박쥐 떼', name: 'BAT SWARM', cooldown: 12,
      desc: '박쥐 떼가 앞 카트를 쫓아가 기절시키고 부스터 게이지를 25 빨아온다', icon: null },
    phase: { nameKo: '유령화', name: 'PHASE', cooldown: 12,
      desc: '3초간 반투명해져 카트와 공격을 통과하고 살짝 빨라진다', icon: null },
    teleport: { nameKo: '순간이동', name: 'TELEPORT', cooldown: 28,
      desc: '1등 카트와 자리를 맞바꾼다! (이미 1등이면 발동하지 않음)', icon: null }
  };

  // ---------------------------------------------------------------- init
  function init() {
    const U = PK.U;
    // ---- icons (12x12)
    DEFS.cart_rush.icon = U.makeSprite([
      '............',
      'kk..........',
      '.kRRRRRRRRR.',
      '.kRwRwRwRwR.',
      '..RRRRRRRRR.',
      '..RwRwRwRw..',
      '..RRRRRRRR..',
      '...kkkkkkk..',
      '...k.....k..',
      '..kkkkkkkkk.',
      '..dd....dd..',
      '..dd....dd..'
    ], { R: '#e83030', w: '#ffd0d0', k: '#c8c8d8', d: '#202028' });

    DEFS.banana.icon = U.makeSprite([
      '............',
      '......k.....',
      '.....yy.....',
      '.....yy.....',
      '....yyyy....',
      '...yYyyYy...',
      '..yY.yy.Yy..',
      '.yY..yy..Yy.',
      '.yY..yY..Yy.',
      'yY...yY...Yy',
      'Y....Y.....Y',
      '............'
    ], { y: '#ffe040', Y: '#c09010', k: '#604010' });

    DEFS.watermelon.icon = procSprite(12, 12, (x, y) => {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d > 6) return '.';
      if (Math.hypot(x - 3.5, y - 3) < 1.1) return 'w';
      if (d > 5) return 'G';
      return ((x + Math.round(Math.sin(y * 0.6) * 1.2)) % 3 === 0) ? 'G' : 'g';
    }, { g: '#40b040', G: '#106010', w: '#c0ffc0' });

    DEFS.soap.icon = U.makeSprite([
      '....kkk.....',
      '....k.ww.o..',
      '...bbb..o.o.',
      '...bbb......',
      '..bbbbb..o..',
      '.bBbbbbb....',
      '.bBwwwbb..o.',
      '.bBwwwbb.o.o',
      '.bBbbbbb..o.',
      '.bBbbbbb....',
      '.bBbbbbb....',
      '..bbbbb.....'
    ], { b: '#40a0ff', B: '#2060c0', w: '#ffffff', k: '#d0d0d0', o: '#c0f0ff' });

    DEFS.bubble.icon = procSprite(12, 12, (x, y) => {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d > 6) return '.';
      if (d > 5) return 'o';
      if (Math.hypot(x - 3.5, y - 3.5) < 1.2) return 'w';
      return ((x % 3 === 1) && (y % 3 === 1)) ? 'd' : 'p';
    }, { o: '#ff70c0', p: '#ffd0f0', d: '#ffffff', w: '#ffffff' });

    DEFS.magnet.icon = U.makeSprite([
      '...RRRRRR...',
      '..RRRRRRRR..',
      '.RRRrrrrRRR.',
      '.RRR....RRR.',
      '.RRR....RRR.',
      '.RRR....RRR.',
      '.RRR....RRR.',
      '.WWW....WWW.',
      '.WWW....WWW.',
      '............',
      '.y.y....y.y.',
      '..y......y..'
    ], { R: '#e02020', r: '#ff8080', W: '#e0e0ea', y: '#ffe060' });

    DEFS.bats.icon = U.makeSprite([
      '............',
      '.b........b.',
      '.bb..b.b.bb.',
      '.bbb.bbbbbb.',
      'bbbbbrbrbbbb',
      'bbBbbbbbbBbb',
      'bB.bbbbbb.Bb',
      'b...bbbb...b',
      '.....bb.....',
      '..b......b..',
      '.bbb....bbb.',
      '..b......b..'
    ], { b: '#3a1c4a', B: '#7a2a5a', r: '#ff3040' });

    DEFS.phase.icon = U.makeSprite([
      '....oooo....',
      '..ooWWWWoo..',
      '.oWWWWWWWWo.',
      '.oWWWWWWWWo.',
      'oWWkkWWkkWWo',
      'oWWkkWWkkWWo',
      'oWWWWWWWWWWo',
      'oWWWWkkWWWWo',
      'oWWWWWWWWWWo',
      'oWWWWWWWWWWo',
      'oWoWWoWWoWWo',
      '.o..oo..oo.o'
    ], { o: '#8aa4e0', W: '#eef4ff', k: '#3a4a7a' });

    DEFS.teleport.icon = U.makeSprite([
      '..mm....cc..',
      '.m..m..c..c.',
      'm.gg.mc.gg.c',
      'm.gGg.cgGg.c',
      'm.gg.mc.gg.c',
      '.m..m..c..c.',
      '..mm....cc..',
      '.....ww.....',
      '....w..w....',
      '...wwwwww...',
      '.....ww..k..',
      '.k..........'
    ], { m: '#ff30c0', c: '#30e8ff', g: '#10c070', G: '#60ffb0', w: '#f0fff8', k: '#60ffb0' });

    // ---- world sprites
    SPR.peel = U.makeSprite([
      '...kk...',
      '..yyyy..',
      '.yYyyYy.',
      'yY.yy.Yy',
      'Y..YY..Y'
    ], { y: '#ffe040', Y: '#c09010', k: '#604010' });

    for (let f = 0; f < 2; f++) {
      SPR.melon[f] = procSprite(10, 10, (x, y) => {
        const d = Math.hypot(x - 4.5, y - 4.5);
        if (d > 5) return '.';
        if (Math.hypot(x - 3, y - 2.5) < 0.9) return 'w';
        if (d > 4.1) return 'G';
        return ((x + f * 2 + (y >> 2)) % 4 < 1) ? 'G' : 'g';
      }, { g: '#40b040', G: '#0e5a0e', w: '#d0ffd0' });
    }

    const foamPal = [
      { o: '#a0d8ff', p: '#e8f6ff', w: '#ffffff' },
      { o: '#c0a0ff', p: '#f0e8ff', w: '#ffffff' },
      { o: '#90f0e0', p: '#e8fff8', w: '#ffffff' }
    ];
    SPR.foam = [bubbleSprite(7, foamPal[0]), bubbleSprite(7, foamPal[1]), bubbleSprite(6, foamPal[2])];

    SPR.cart = U.makeSprite([
      'k............k',
      'kssssssssssssk',
      'kSsSsSsSsSsSsk',
      'kssssssssssssk',
      'kSsSsSsSsSsSsk',
      '.kssssssssssk.',
      '.kSsSsSsSsSsk.',
      '..kkkkkkkkkk..',
      '..k........k..',
      '..k........k..',
      '.dd........dd.',
      '.dd........dd.'
    ], { s: '#c8d0dc', S: '#7080a0', k: '#e83030', d: '#202020' });

    SPR.magnet = U.makeSprite([
      '.RRRRRR.',
      'RRrrrrRR',
      'RR....RR',
      'RR....RR',
      'RR....RR',
      'WW....WW',
      'WW....WW'
    ], { R: '#e02020', r: '#ff8080', W: '#e0e0ea' });

    SPR.coin = procSprite(5, 5, (x, y) => {
      const d = Math.hypot(x - 2, y - 2);
      if (d > 2.4) return '.';
      if (x === 1 && y === 1) return 'w';
      return d > 1.5 ? 'Y' : 'y';
    }, { y: '#ffe040', Y: '#c08000', w: '#ffffff' });

    SPR.wrap = bubbleSprite(5, { o: '#ff90d0', p: '#fff0fa', w: '#ffffff' });

    // bat: wings up / wings down (7x4)
    const batPal = { b: '#2a1438', B: '#5a2a6a', r: '#ff3040' };
    SPR.bat[0] = U.makeSprite(['b.....b', 'bb.b.bb', '.BbrbB.', '...b...'], batPal);
    SPR.bat[1] = U.makeSprite(['...b...', '.BbrbB.', 'bb...bb', 'b.....b'], batPal);
    SPR.drop = U.makeSprite(['.r.', 'rRr', '.r.'], { r: '#e01830', R: '#ff7080' });
    SPR.wisp = bubbleSprite(4, { o: '#b8c8f0', p: '#eef4ff', w: '#ffffff' });
    SPR.gpx = ['#ff30c0', '#30e8ff', '#60ffb0', '#ffffff'].map((c) => U.makeSprite(['xx', 'xx'], { x: c }));
    boxSprites();
    itemIcons();
    reset();
  }

  function reset() {
    peels.length = 0; melons.length = 0; foams.length = 0; swarms.length = 0; glitches.length = 0; missiles.length = 0;
    kst = new Map();
    clock = 0;
    magKart = null; magT = 0; saleT = 0;
    placeFoods();
    boxes.length = 0;   // 랜덤 박스 꺼짐 (placeBoxes 안 부름)
  }

  // ---------------------------------------------------------------- food pickups on the road
  // Rows of groceries (assets/food.png, 16 cells of 48x48) across the track: drive through one
  // for boost gauge; it respawns a few seconds later. Sprites are painted when the sheet loads.
  const FOOD_KO = ['사과', '바나나', '우유', '식빵', '소고기', '목살', '생선', '라면', '치즈', '케이크', '과자', '콜라', '컵케이크', '초코', '상추', '토마토'];
  // food grades: 0 일반 · 1 고급 · 2 희귀 · 3 전설 — worth 1 / 2 / 3 / 5 coins, rarer on the road
  //              사과 바나나 우유 식빵 소고기 목살 생선 라면 치즈 케이크 과자 콜라 컵케이크 초코 상추 토마토
  const FOOD_GRADE = [0, 0, 1, 0, 3, 3, 2, 0, 1, 2, 0, 0, 1, 1, 0, 0];
  const GRADES = [
    { ko: '일반', en: '', col: '', coin: 1, w: 6 },
    { ko: '고급', en: 'GOOD', col: '#4aa8ff', coin: 2, w: 3 },
    { ko: '희귀', en: 'RARE', col: '#c070ff', coin: 3, w: 1.4 },
    { ko: '전설', en: 'LEGEND', col: '#ffcc00', coin: 5, w: 0.6 },
  ];
  function pickKind(r) {   // weighted by grade (seeded, so every map keeps its layout)
    let sum = 0; for (let i = 0; i < 16; i++) sum += GRADES[FOOD_GRADE[i]].w;
    let x = r() * sum;
    for (let i = 0; i < 16; i++) { x -= GRADES[FOOD_GRADE[i]].w; if (x < 0) return i; }
    return 0;
  }
  const FOOD_GAUGE = 25, FOOD_RESPAWN = 6, FOOD_R = 6;
  const FMAG_T = 6, FMAG_R = 70, FMAG_V = 150;   // shop item '음식 자석': duration / pull radius / speed
  let magKart = null, magT = 0;
  const foods = [], foodSpr = [];
  const foodImg = new Image();
  function foodSprites() {
    if (foodSpr.length) return;
    for (let i = 0; i < 16; i++) { const c = document.createElement('canvas'); c.width = c.height = 32; foodSpr.push(c); }
    foodImg.onload = () => foodSpr.forEach((c, i) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 32);
      const gd = GRADES[FOOD_GRADE[i]];
      if (gd.col) {   // grade halo
        const rg = g.createRadialGradient(16, 16, 4, 16, 16, 16);
        rg.addColorStop(0, gd.col + 'cc'); rg.addColorStop(0.7, gd.col + '55'); rg.addColorStop(1, gd.col + '00');
        g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
      }
      g.drawImage(foodImg, i * 48, 0, 48, 48, 2, 2, 28, 28);
      if (FOOD_GRADE[i] >= 2) {   // sparkles in the corners for 희귀 / 전설
        g.fillStyle = '#ffffff';
        for (const [x, y] of [[2, 3], [28, 5], [4, 27], [27, 28]]) { g.fillRect(x, y - 1, 1, 3); g.fillRect(x - 1, y, 3, 1); }
      }
    });
    foodImg.src = 'assets/food.png';
  }
  function placeFoods() {
    foods.length = 0;
    const t = T();
    if (!t || !t.PTS || typeof document === 'undefined') return;
    foodSprites();
    const N = t.N, r = PK.U.rng(4242), rows = 9;
    for (let j = 0; j < rows; j++) {
      const i = Math.floor(N * (j + 0.5) / rows);
      if (i < 24 || i > N - 24) continue;           // keep the start straight clear
      const a = t.TAN[i], p = t.PTS[i];
      for (const lat of [-11, 0, 11]) {
        const x = p[0] - Math.sin(a) * lat, y = p[1] + Math.cos(a) * lat;
        foods.push({ x, y, hx: x, hy: y, kind: pickKind(r), t: 0, ph: r() * TAU });
      }
    }
  }
  // G.onFood(k, kind) (main.js) counts the player's foods as coins; AI karts only get the gauge
  function updateFoods(dt, ks, G) {
    if (magT > 0) { magT -= dt; if (magT <= 0) magKart = null; }
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (f.t > 0) { f.t -= dt; continue; }
      if (magKart) {   // item magnet: nearby food flies to the kart
        const dx = magKart.x - f.x, dy = magKart.y - f.y, d = Math.hypot(dx, dy);
        if (d < FMAG_R && d > 0.01) { const st = Math.min(d, FMAG_V * dt) / d; f.x += dx * st; f.y += dy * st; }
      }
      for (let j = 0; j < ks.length; j++) {   // item-box magnet (per kart)
        const mk = ks[j];
        if (!(mk._fmagT > 0) || mk === magKart) continue;
        const dx = mk.x - f.x, dy = mk.y - f.y, d = Math.hypot(dx, dy);
        if (d < FMAG_R && d > 0.01) { const st = Math.min(d, FMAG_V * dt) / d; f.x += dx * st; f.y += dy * st; }
      }
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j], dx = k.x - f.x, dy = k.y - f.y;
        if (dx * dx + dy * dy > FOOD_R * FOOD_R) continue;
        if (G && typeof G.pfx === 'function') G.pfx('food', f.x, f.y, 1.5);
        f.t = FOOD_RESPAWN; f.x = f.hx; f.y = f.hy;
        addGauge(k, FOOD_GAUGE, G);
        if (k.isPlayer) {
          sfx(G, 'pad');
          if (G && typeof G.onFood === 'function') G.onFood(k, f.kind);
          else if (G && typeof G.toast === 'function') G.toast('FOOD +' + FOOD_GAUGE);
        }
        break;
      }
    }
  }
  // time sale (main.js, once per race): every food back at once, a second row between the rows,
  // near-instant respawns; the extra row goes away when the sale ends
  let saleT = 0;
  function startSale(dur) {
    const t = T();
    if (!t || !t.PTS || !foods.length) return;
    saleT = dur;
    for (let i = 0; i < foods.length; i++) foods[i].t = 0;
    const N = t.N, rows = 9, r = PK.U.rng(99);
    for (let j = 0; j < rows; j++) {
      const i = Math.floor(N * (j + 1) / rows) % N;
      if (i < 24 || i > N - 24) continue;
      const a = t.TAN[i], p = t.PTS[i];
      for (const lat of [-6, 6]) {
        const x = p[0] - Math.sin(a) * lat, y = p[1] + Math.cos(a) * lat;
        foods.push({ x, y, hx: x, hy: y, kind: pickKind(r), t: 0, ph: r() * TAU, extra: true });
      }
    }
  }
  function updateSale(dt) {
    if (!(saleT > 0)) return;
    saleT -= dt;
    for (let i = 0; i < foods.length; i++) if (foods[i].t > 0.4) foods[i].t = 0.4;
    if (saleT <= 0) { saleT = 0; for (let i = foods.length - 1; i >= 0; i--) if (foods[i].extra) foods.splice(i, 1); }
  }
  const saleLeft = () => saleT;
  const foodIcon = (i) => foodSpr[i | 0] || null;
  const foodName = (i) => FOOD_KO[i | 0] || '';
  const foodGrade = (i) => GRADES[FOOD_GRADE[i | 0] || 0];   // { ko, en, col, coin }
  // kinds of the regular food rows on the current track (not the sale extras), each once
  const foodKinds = () => { const s = []; for (const f of foods) if (!f.extra && s.indexOf(f.kind) < 0) s.push(f.kind); return s; };

  // ---------------------------------------------------------------- ❓ item boxes
  // A few rows of 4 floating boxes across the road, between the food rows, clear of the start
  // straight, obstacles, boost pads and puddles. Driving through one gives a random race item
  // (k.boxItem, after a BOX_ROLL s roulette k.boxRoll) used with C / the touch item button (player)
  // or aiBox() (AI). A box respawns BOX_RESPAWN s after it is taken. Off in online races (G.online).
  const BOX_ROWS = [0.14, 0.36, 0.58, 0.8];
  function placeBoxes() {
    boxes.length = 0;
    const t = T();
    if (!t || !t.PTS || !t.N) return;
    const N = t.N, P = t.PTS, TA = t.TAN, half = (t.ROAD_W || 44) / 2;
    const food = [];
    for (let j = 0; j < 9; j++) { food.push(Math.floor(N * (j + 0.5) / 9)); food.push(Math.floor(N * (j + 1) / 9) % N); }
    const idist = (a, b) => { const d = Math.abs(a - b) % N; return Math.min(d, N - d); };
    const obs = t.obstacles || [], pads = t.pads || [], pud = t.puddles || [];
    const LATS = [-0.6, -0.2, 0.2, 0.6];
    const at = (i, lat) => [P[i][0] - Math.sin(TA[i]) * lat, P[i][1] + Math.cos(TA[i]) * lat];
    const valid = (i) => {
      if (i < N * 0.08 || i > N * 0.93) return false;
      if (food.some((f) => idist(f, i) < 4)) return false;
      if (obs.some((o) => idist(o.i, i) < 10)) return false;
      const p = P[i];
      if (pads.some((q) => Math.hypot(q.x - p[0], q.y - p[1]) < 22)) return false;
      if (pud.some((q) => Math.hypot(q.x - p[0], q.y - p[1]) < (q.r || 10) + 10)) return false;
      for (let l = 0; l < LATS.length; l++) {
        const b = at(i, LATS[l] * half);
        if (obs.some((o) => Math.hypot(o.x - b[0], o.y - b[1]) < o.r + 8)) return false;
      }
      return true;
    };
    let ph = 0;
    for (let r = 0; r < BOX_ROWS.length; r++) {
      const i0 = Math.round(N * BOX_ROWS[r]), reach = Math.max(4, Math.round(N * 0.035));
      let i = -1;
      for (let k = 0; k <= reach && i < 0; k++) {
        for (const sg of [1, -1]) { const j = wrapI(i0 + sg * k, N); if (valid(j)) { i = j; break; } }
      }
      if (i < 0) continue;
      for (let l = 0; l < LATS.length; l++) {
        const b = at(i, LATS[l] * half);
        boxes.push({ x: b[0], y: b[1], t: 0, age: 1, ph: ph, i });
        ph += 1.3;
      }
    }
  }
  // box: 12x12 cube with a '?' (4 colour frames cycled for the shimmer), plus a soft shadow
  function boxSprites() {
    const U = PK.U;
    const rows = [
      '.kkkkkkkkkk.',
      'kLLLLLLLLLLk',
      'kLMMMMMMMMDk',
      'kLMMwwwwMMDk',
      'kLMwwMMwwMDk',
      'kLMMMMMwwMDk',
      'kLMMMMwwMMDk',
      'kLMMMwwMMMDk',
      'kLMMMMMMMMDk',
      'kLMMMwwMMMDk',
      'kLDDDDDDDDDk',
      '.kkkkkkkkkk.'
    ];
    const cols = ['#ff4f9a', '#ffb020', '#3fc8ff', '#6ee05a'];
    SPR.box = cols.map((c) => U.makeSprite(rows, { k: '#1a0d22', L: mixHex(c, '#ffffff', 0.5), M: c, D: U.darken(c, 0.62), w: '#ffffff' }));
    SPR.boxSh = U.makeSprite(['.xxxxxx.', 'xxxxxxxx', '.xxxxxx.'], { x: 'rgba(0,0,0,0.32)' });
    // 장바구니 미사일: a teal shopping basket with an orange handle, two wobble frames
    const mp = { k: '#0e2a26', B: '#2fb6a0', b: '#1d7a6c', w: '#c8fff2', o: '#ff9a20', O: '#ffd060' };
    SPR.mis[0] = U.makeSprite([
      '...oooooo...',
      '..o......o..',
      '.oO......Oo.',
      'kkkkkkkkkkkk',
      'kwBBbBBbBBwk',
      'kBbBBbBBbBBk',
      '.kBBbBBbBBk.',
      '.kbBBbBBbBk.',
      '..kkkkkkkk..'
    ], mp);
    SPR.mis[1] = U.makeSprite([
      '..oooooo....',
      '.o......o...',
      'oO......Oo..',
      'kkkkkkkkkkkk',
      'kwBBbBBbBBwk',
      'kBbBBbBBbBBk',
      '.kBBbBBbBBk.',
      '.kbBBbBBbBk.',
      '..kkkkkkkk..'
    ], mp);
    SPR.trail = ['#ffffff', '#ffe060', '#ff9a20', '#c8c8d0'].map((c) => U.makeSprite(['xx', 'xx'], { x: c }));
  }
  function mixHex(a, b, t) {
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((na >> sh) & 255) + ((((nb >> sh) & 255) - ((na >> sh) & 255)) * t)).toString(16).padStart(2, '0');
    return '#' + ch(16) + ch(8) + ch(0);
  }
  // place in the race (1 = leader): finished karts and karts with more progress are ahead
  function placeOf(k, ks) {
    let pos = 1;
    for (let i = 0; i < ks.length; i++) { const o = ks[i]; if (o !== k && (o.finished || o.prog > k.prog)) pos++; }
    return pos;
  }
  // position-weighted odds: leaders get defensive items, the back of the pack the strong ones
  const BOX_W = { banana: 0, turbo: 0, shield: 0, magnet: 0, cloak: 0, missile: 0 };
  function boxWeights(pos, n) {
    const f = n > 1 ? (pos - 1) / (n - 1) : 0.5;   // 0 = 1st .. 1 = last
    BOX_W.banana = 6 + 30 * (1 - f);
    BOX_W.shield = 6 + 22 * (1 - f);
    BOX_W.magnet = 12;
    BOX_W.cloak = 6 + 10 * f;
    BOX_W.turbo = 6 + 26 * f;
    BOX_W.missile = pos <= 1 ? 0 : 4 + 24 * f;
    return BOX_W;
  }
  function rollBox(k, ks) {
    const w = boxWeights(placeOf(k, ks), ks.length);
    let sum = 0;
    for (let i = 0; i < BOX_IDS.length; i++) sum += w[BOX_IDS[i]];
    let r = rnd() * sum;
    for (let i = 0; i < BOX_IDS.length; i++) { r -= w[BOX_IDS[i]]; if (r < 0) return BOX_IDS[i]; }
    return 'banana';
  }
  function updateBoxes(dt, ks, G) {
    if (G && G.online) return;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.t > 0) { b.t -= dt; if (b.t <= 0) { b.t = 0; b.age = 0; } continue; }
      b.age += dt;
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j];
        if (k.finished || k.remote) continue;
        const dx = k.x - b.x, dy = k.y - b.y;
        if (dx * dx + dy * dy > BOX_R * BOX_R) continue;
        b.t = BOX_RESPAWN;
        if (G && typeof G.pfx === 'function') G.pfx('box', b.x, b.y, 3);
        if (!k.boxItem && !(k.boxRoll > 0)) {
          k.boxItem = rollBox(k, ks); k.boxRoll = BOX_ROLL; S(k).boxSince = -1;
          if (k.isPlayer) sfx(G, 'box');
          if (G && typeof G.onBox === 'function') G.onBox(k, k.boxItem);
        }
        break;
      }
    }
  }
  // fire the held box item; false when there is none / it is still rolling / the kart can't
  function useBox(k, G) {
    const id = k && k.boxItem;
    if (!id || k.boxRoll > 0 || k.finished || (k.fx && k.fx.spin > 0)) return false;
    if (G && G.online) return false;
    switch (id) {
      case 'banana': {
        const c = Math.cos(k.a), s = Math.sin(k.a);
        const p = { x: k.x - c * 9, y: k.y - s * 9, age: 0, owner: k };
        clampToRoad(k, p, 2);
        peels.push(p);
        while (peels.length > MAX_PEELS) peels.shift();
        if (k.isPlayer) sfx(G, 'skill');
        break;
      }
      case 'turbo': k.boostT = Math.max(k.boostT || 0, 1.5); giveBuff(k, 1.5, 1.22); if (k.isPlayer) sfx(G, 'boost'); break;
      case 'shield': k.fx.shield = Math.max(k.fx.shield || 0, BOX_SHIELD_T); S(k).wrapT = BOX_SHIELD_T; if (k.isPlayer) sfx(G, 'skill'); break;
      case 'magnet': k._fmagT = BOX_MAG_T; if (k.isPlayer) sfx(G, 'skill'); break;
      case 'cloak': usePhase(k); if (k.isPlayer) sfx(G, 'skill'); break;
      case 'missile': fireMissile(k, G); break;
      default: return false;
    }
    k.boxItem = ''; S(k).boxSince = -1;
    if (G && typeof G.onBoxUse === 'function') G.onBoxUse(k, id);
    return true;
  }
  // nearest kart ahead in race order (any distance), or null for the leader
  function aheadKart(k, G) {
    const ks = (G && G.karts) || [];
    let best = null, bd = 1e9;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k || o.finished) continue;
      const d = o.prog - k.prog;
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function fireMissile(k, G) {
    const t = T();
    const c = Math.cos(k.a), s = Math.sin(k.a);
    let fi = k.idx || 0, lat = k.lat || 0;
    if (t && typeof t.nearestLocal === 'function') {
      const n = t.nearestLocal(k.idx | 0, k.x + c * 6, k.y + s * 6, 12);
      if (n) { fi = n.i; lat = n.lat; }
    }
    const lim = barrier() - 3;
    const m = { fi, lat: PK.U.clamp(lat, -lim, lim), x: k.x + c * 6, y: k.y + s * 6, h: 2.5, t: 0, owner: k,
                speed: Math.max(MIS_V, (k.v || 0) + 110), target: aheadKart(k, G) };
    placeMelon(m);
    missiles.push(m);
    while (missiles.length > MAX_MIS) missiles.shift();
    if (k.isPlayer || (m.target && m.target.isPlayer)) sfx(G, 'missile');
  }
  function updateMissiles(dt, ks, G) {
    const t = T();
    if (!t || !t.PTS) return;
    const N = t.N, lim = barrier() - 2;
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.t += dt;
      m.speed += MIS_ACC * dt;
      if (m.t > MIS_LIFE) { if (G && G.pfx) G.pfx('fizz', m.x, m.y, m.h); missiles.splice(i, 1); continue; }
      let tg = m.target;
      if (!tg || tg.finished || tg.fx.phase > 0 || idxAhead(m.fi, tg.idx || 0, N) > N * 0.5) {
        tg = null; let bd = 80;
        for (let j = 0; j < ks.length; j++) {
          const k = ks[j];
          if (k === m.owner || k.finished || k.fx.phase > 0) continue;
          const d = idxAhead(m.fi, k.idx || 0, N);
          if (d < bd) { bd = d; tg = k; }
        }
        m.target = tg;
      }
      const dx = tg ? tg.x - m.x : 0, dy = tg ? tg.y - m.y : 0;
      if (tg && dx * dx + dy * dy < 26 * 26) {
        const dd = Math.hypot(dx, dy) || 1, st = Math.min(dd, m.speed * dt);
        m.x += dx / dd * st; m.y += dy / dd * st;
        m.fi = tg.idx || m.fi; m.lat = tg.lat || 0;
      } else {
        if (tg && idxAhead(m.fi, tg.idx || 0, N) < 60) m.lat += PK.U.clamp((tg.lat || 0) - m.lat, -8, 8) * 5 * dt;
        m.lat = PK.U.clamp(m.lat, -lim, lim);
        const i0 = wrapI(Math.floor(m.fi), N);
        const p0 = t.PTS[i0], p1 = t.PTS[(i0 + 1) % N];
        const seg = Math.max(0.5, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
        m.fi += (m.speed * dt) / seg;
        if (m.fi >= N) m.fi -= N;
        placeMelon(m);
      }
      m.h = 2.5 + Math.sin(m.t * 12) * 0.5;
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j];
        if (k === m.owner || k.fx.ghost > 0 || k.fx.phase > 0) continue;
        const ex = k.x - m.x, ey = k.y - m.y;
        if (ex * ex + ey * ey < MIS_R * MIS_R) {
          const ok = hitKart(k, 'spin', MIS_STUN, G, m.owner);
          if (G && G.pfx) G.pfx('boom', m.x, m.y, 2);
          if (G && typeof G.onMissileHit === 'function') G.onMissileHit(k, m.owner, ok);
          missiles.splice(i, 1);
          break;
        }
      }
    }
  }
  // a missile is closing in on k (HUD warning / AI defence)
  function incoming(k) {
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      if (m.target !== k || m.owner === k) continue;
      const dx = m.x - k.x, dy = m.y - k.y;
      if (dx * dx + dy * dy < 90 * 90) return true;
    }
    return false;
  }
  // AI: when to fire the held box item (also drives the player's kart in attract races)
  const NB = { aheadF: 0, aheadSide: 0, behindF: 0, behindSide: 0 };
  function nearby(k, ks) {
    const c = Math.cos(k.a), sn = Math.sin(k.a);
    NB.aheadF = 1e9; NB.aheadSide = 0; NB.behindF = 1e9; NB.behindSide = 0;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k) continue;
      const dx = o.x - k.x, dy = o.y - k.y;
      const f = dx * c + dy * sn, sd = -dx * sn + dy * c;
      if (f > 0 && f < NB.aheadF && Math.abs(sd) < f * 0.45 + 10) { NB.aheadF = f; NB.aheadSide = sd; }
      if (f < 0 && -f < NB.behindF && Math.abs(sd) < 18) { NB.behindF = -f; NB.behindSide = sd; }
    }
    return NB;
  }
  function aiBox(k, G) {
    if (!k.boxItem || k.boxRoll > 0 || k.finished || k.remote || (k.fx && k.fx.spin > 0)) return false;
    if (k.isPlayer && !(G && G.attract)) return false;
    const s = S(k);
    if (s.boxSince < 0) { s.boxSince = clock; s.boxDelay = 0.4 + rnd() * 1.2; return false; }
    const w = clock - s.boxSince;
    if (w < s.boxDelay) return false;
    const pf = 1 / 60, ks = (G && G.karts) || [], t = T(), N = (t && t.N) || 1;
    const nb = nearby(k, ks), c = Math.cos(k.a), sn = Math.sin(k.a);
    switch (k.boxItem) {
      case 'banana':
        if (nb.behindF < 35 && Math.abs(nb.behindSide) < 10) return rnd() < 18 * pf;
        return w > 10;
      case 'shield':
        if (dangerNear(k, c, sn)) return true;
        return w > 8 && rnd() < 0.5 * pf;
      case 'cloak':
        if (dangerNear(k, c, sn)) return true;
        if (nb.aheadF < 14 && Math.abs(nb.aheadSide) < 6) return rnd() < 18 * pf;
        return w > 9;
      case 'turbo': {
        if (k.drift || k.offroad) return false;
        if (t && t.TAN) {
          const i = k.idx | 0;
          const straight = Math.abs(PK.U.angDiff(t.TAN[wrapI(i, N)], t.TAN[wrapI(i + 14, N)])) < 0.15;
          const aligned = Math.abs(PK.U.angDiff(t.TAN[wrapI(i, N)], k.a)) < 0.18;
          if (straight && aligned) return rnd() < 12 * pf;
        }
        return w > 6;
      }
      case 'magnet': return true;
      case 'missile': {
        const tg = aheadKart(k, G);
        if (!tg) return w > 12;
        if (tg.prog - k.prog < 0.3 * N) return rnd() < 12 * pf;
        return w > 6;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- use
  function canUse(k, G) {
    if (!k || !k.def || !DEFS[k.def.skill]) return false;
    if (k.finished) return false;
    if (G && (G.state === 'countdown' || G.state === 'title' || G.state === 'select')) return false;
    return !(k.skillCd > 0);
  }

  function tryUse(k, G) {
    if (!canUse(k, G)) return false;
    const id = k.def.skill, def = DEFS[id];
    // teleport needs someone ahead to swap with; otherwise it isn't spent
    if (id === 'teleport' && !useTeleport(k, G)) {
      if (k.isPlayer && G && typeof G.toast === 'function') G.toast('ALREADY 1ST!');
      return false;
    }
    switch (id) {
      case 'cart_rush': useRush(k, G); break;
      case 'banana': useBanana(k, G); break;
      case 'watermelon': useMelon(k, G); break;
      case 'soap': useSoap(k, G); break;
      case 'bubble': useBubble(k, G); break;
      case 'magnet': useMagnet(k, G); break;
      case 'bats': useBats(k, G); break;
      case 'phase': usePhase(k, G); break;
    }
    k.skillCd = def.cooldown;
    S(k).readySince = -1;
    sfx(G, 'skill');
    if (k.isPlayer && G && typeof G.toast === 'function') G.toast(def.name + '!');
    return true;
  }

  function useRush(k) {
    const s = S(k);
    s.rushT = RUSH_T;
    s.rushHit.clear();
    giveBuff(k, RUSH_T, 1.5);
    k.fx.ghost = 0;
    k.boostT = Math.max(k.boostT || 0, 0.3);
  }

  function useBanana(k) {
    const c = Math.cos(k.a), s = Math.sin(k.a);
    for (let j = 0; j < 3; j++) {
      const back = 8 + j * 2.5, side = (j - 1) * 4.5;
      const p = { x: k.x - c * back - s * side, y: k.y - s * back + c * side, age: 0, owner: k };
      clampToRoad(k, p, 2);
      peels.push(p);
    }
    while (peels.length > MAX_PEELS) peels.shift();
  }

  function useMelon(k) {
    const t = T();
    const c = Math.cos(k.a), s = Math.sin(k.a);
    let fi = k.idx || 0, lat = k.lat || 0;
    if (t && typeof t.nearestLocal === 'function') {
      const n = t.nearestLocal(k.idx | 0, k.x + c * 6, k.y + s * 6, 12);
      if (n) { fi = n.i; lat = n.lat; }
    }
    const lim = barrier() - 3;
    lat = PK.U.clamp(lat, -lim, lim);
    const rel = PK.U.angDiff(tanAt(fi), k.a);
    const speed = Math.max(140, (k.v || 0) + 110);
    const m = { fi, lat, lv: Math.sin(rel) * speed * 0.5, x: k.x, y: k.y, h: 0, t: 0, owner: k,
                speed, bounces: 0, target: null };
    placeMelon(m);
    melons.push(m);
    while (melons.length > MAX_MELONS) melons.shift();
  }

  function useSoap(k) {
    const c = Math.cos(k.a), s = Math.sin(k.a);
    const p = { x: k.x - c * 14, y: k.y - s * 14, t: FOAM_LIFE, owner: k, r: 4 };
    clampToRoad(k, p, 4);
    foams.push(p);
    while (foams.length > MAX_FOAMS) foams.shift();
  }

  function useBubble(k) {
    k.fx.shield = Math.max(k.fx.shield || 0, 5);
    giveBuff(k, 1.5, 1.1);
    S(k).wrapT = 5;
  }

  // kart ahead in race order within 0.35 laps (smallest prog gap)
  function magnetTarget(k, G) {
    const t = T(), N = (t && t.N) || 1;
    let best = null, bd = 0.35 * N;
    const ks = (G && G.karts) || [];
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k || o.finished) continue;
      const d = o.prog - k.prog;
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function addGauge(k, amt, G) {
    k.gauge = (k.gauge || 0) + amt;
    if (k.gauge >= 100) {
      if ((k.stock || 0) < 2) {
        k.stock = (k.stock || 0) + 1;
        k.gauge -= 100;
        if (k.isPlayer) sfx(G, 'gauge');
      }
      if (k.gauge > 100) k.gauge = 100;
    }
  }

  function useMagnet(k, G) {
    const s = S(k);
    const tgt = magnetTarget(k, G);
    s.magT = MAG_T;
    s.magTarget = tgt;
    if (tgt) {
      const amt = Math.min(MAG_STEAL, Math.max(0, tgt.gauge || 0));
      tgt.gauge = (tgt.gauge || 0) - amt;
      addGauge(k, amt, G);
      giveBuff(k, MAG_T, 1.35);
      s.coinT = 0.9; s.coinX = tgt.x; s.coinY = tgt.y;
    } else {
      giveBuff(k, 1.0, 1.2);
      s.magT = 1.0;
    }
  }

  // bat swarm: launched just ahead of the vampire, then follows the track like a melon
  function useBats(k, G) {
    const t = T();
    const c = Math.cos(k.a), s = Math.sin(k.a);
    let fi = k.idx || 0, lat = k.lat || 0;
    if (t && typeof t.nearestLocal === 'function') {
      const n = t.nearestLocal(k.idx | 0, k.x + c * 6, k.y + s * 6, 12);
      if (n) { fi = n.i; lat = n.lat; }
    }
    const lim = barrier() - 3;
    const b = { fi, lat: PK.U.clamp(lat, -lim, lim), x: k.x + c * 6, y: k.y + s * 6, t: 0, owner: k,
                speed: Math.max(175, (k.v || 0) + 120), target: magnetTarget(k, G) };
    placeMelon(b);
    swarms.push(b);
    while (swarms.length > MAX_SWARMS) swarms.shift();
  }

  // phase: see-through for PHASE_T s — no kart collisions, immune to hits/hazards, small buff.
  // fx.ghost is set too so every existing ghost check (collide, peels, melons, foam) skips the kart.
  function usePhase(k) {
    const fx = k.fx;
    fx.phase = Math.max(fx.phase || 0, PHASE_T);
    fx.ghost = Math.max(fx.ghost || 0, PHASE_T);
    fx.slow = 0;
    giveBuff(k, PHASE_T, PHASE_MUL);
  }

  // teleport: the race leader = unfinished kart with the most progress (same order as main.js standings)
  function leaderOf(k, G) {
    const ks = (G && G.karts) || [];
    let best = null;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o.finished) continue;
      if (!best || o.prog > best.prog) best = o;
    }
    return best && best !== k && best.prog > k.prog ? best : null;
  }
  // swap where two karts are on the track: pose, speed and all lap bookkeeping (lap/maxLap/_mLap/
  // lapStart travel with the track position, so nobody gains or loses a lap). Effects/skills stay.
  const TELE_KEYS = ['x', 'y', 'a', 'ma', 'v', 'idx', 'lat', 'lap', 'maxLap', 'prog', '_mLap', 'lapStart', 'offroad', 'drift', 'driftDir', 'charge'];
  function useTeleport(k, G) {
    const o = leaderOf(k, G);
    if (!o) return false;
    for (let i = 0; i < TELE_KEYS.length; i++) { const f = TELE_KEYS[i], t = k[f]; k[f] = o[f]; o[f] = t; }
    k.wrongT = 0; o.wrongT = 0; k.hop = o.hop = 0;
    glitches.push({ x: k.x, y: k.y, t: TELE_FX }, { x: o.x, y: o.y, t: TELE_FX });
    while (glitches.length > 8) glitches.shift();
    if (k.isPlayer || o.isPlayer) sfx(G, 'glitch');
    if (o.isPlayer && G && typeof G.toast === 'function') G.toast('GLITCHED!');
    return true;
  }

  // ---------------------------------------------------------------- shop items (main.js: wallet, equip, one use per race)
  // auto: fired by main.js at GO instead of the C key
  const ITEMS = {
    rocket: { nameKo: '로켓 스타트', price: 6, auto: true, desc: '출발 신호와 동시에 자동으로 2초 로켓 부스트', icon: null },
    turbo: { nameKo: '터보 캔', price: 8, desc: '한 모금에 1.5초 초강력 부스트 (부스터보다 빠름)', icon: null },
    magnet: { nameKo: '음식 자석', price: 8, desc: '6초간 주변 음식을 끌어당긴다 (레이스당 10개 제한은 그대로)', icon: null },
    banana: { nameKo: '바나나 폭탄', price: 10, desc: '뒤로 바나나 껍질 5개를 넓게 뿌린다', icon: null },
    shield: { nameKo: '방패', price: 12, desc: '8초간 공격·껍질을 1번 막아 준다', icon: null },
    cloak: { nameKo: '유령 망토', price: 15, desc: '3초간 투명해져 카트와 공격을 통과하고 빨라진다', icon: null }
  };
  const ITEM_IDS = Object.keys(ITEMS);
  function itemIcons() {
    const U = PK.U;
    ITEMS.rocket.icon = U.makeSprite([
      '.....ww.....',
      '....wRRw....',
      '....RRRR....',
      '....RbbR....',
      '....RbbR....',
      '....RRRR....',
      '...RRRRRR...',
      '..RR.RR.RR..',
      '.....yy.....',
      '....yooy....',
      '.....oo.....',
      '.....y......'
    ], { R: '#e83030', w: '#ffd0d0', b: '#60c0ff', y: '#ffe040', o: '#ff8800' });
    ITEMS.turbo.icon = U.makeSprite([
      '....kkkk....',
      '...gggggg...',
      '...GGGGGG...',
      '...GyyyyG...',
      '...GGGyGG...',
      '...GGyGGG...',
      '...GyyyyG...',
      '...GGGyGG...',
      '...GGyGGG...',
      '...GGGGGG...',
      '...gggggg...',
      '....kkkk....'
    ], { k: '#c8c8d8', g: '#70e070', G: '#20a040', y: '#ffe040' });
    ITEMS.magnet.icon = DEFS.magnet.icon;
    ITEMS.banana.icon = U.makeSprite([
      '..k.....k...',
      '.yy....yy...',
      'yYy...yYy...',
      'Y.Y...Y.Y...',
      '............',
      '.....k......',
      '....yy....k.',
      '...yYy...yy.',
      '...Y.Y..yYy.',
      '........Y.Y.',
      '.oo.oo.oo...',
      'o..o..o..o..'
    ], { y: '#ffe040', Y: '#c09010', k: '#604010', o: '#ff8800' });
    ITEMS.shield.icon = U.makeSprite([
      '.bbbbbbbbbb.',
      'bBBBBBBBBBBb',
      'bBwwBBBBBBBb',
      'bBwBBByBBBBb',
      'bBBBByyyBBBb',
      'bBBByyyyyBBb',
      'bBBBByyyBBBb',
      '.bBBBByBBBb.',
      '.bBBBBBBBBb.',
      '..bBBBBBBb..',
      '...bBBBBb...',
      '....bbbb....'
    ], { b: '#203880', B: '#4080e0', w: '#c0e0ff', y: '#ffe040' });
    ITEMS.cloak.icon = DEFS.phase.icon;
    BOX.banana.icon = DEFS.banana.icon; BOX.turbo.icon = ITEMS.turbo.icon; BOX.shield.icon = ITEMS.shield.icon;
    BOX.magnet.icon = ITEMS.magnet.icon; BOX.cloak.icon = ITEMS.cloak.icon;
    BOX.missile.icon = U.makeSprite([
      '....oooo....',
      '...o....o...',
      '..oO....Oo..',
      'kkkkkkkkkkkk',
      'kwBBbBBbBBwk',
      'kBbBBbBBbBBk',
      '.kBBbBBbBBk.',
      '.kbBBbBBbBk.',
      '..kkkkkkkk..',
      '...y.yy.y...',
      '..y.y..y.y..',
      '...y....y...'
    ], { k: '#0e2a26', B: '#2fb6a0', b: '#1d7a6c', w: '#c8fff2', o: '#ff9a20', O: '#ffd060', y: '#ffd040' });
  }

  // fire a shop item for kart k; returns true when it went off (main.js then consumes it)
  function useItem(k, id, G) {
    if (!k || !ITEMS[id] || k.finished || k.fx.spin > 0) return false;
    switch (id) {
      case 'rocket': k.boostT = Math.max(k.boostT || 0, 2.0); giveBuff(k, 2.0, 1.1); sfx(G, 'boost'); break;
      case 'turbo': k.boostT = Math.max(k.boostT || 0, 1.5); giveBuff(k, 1.5, 1.22); sfx(G, 'boost'); break;
      case 'magnet': magKart = k; magT = FMAG_T; sfx(G, 'skill'); break;
      case 'banana': {
        const c = Math.cos(k.a), s = Math.sin(k.a);
        for (let j = 0; j < 5; j++) {
          const back = 8 + (j & 1) * 4, side = (j - 2) * 5;
          const p = { x: k.x - c * back - s * side, y: k.y - s * back + c * side, age: 0, owner: k };
          clampToRoad(k, p, 2);
          peels.push(p);
        }
        while (peels.length > MAX_PEELS) peels.shift();
        sfx(G, 'skill');
        break;
      }
      case 'shield': k.fx.shield = Math.max(k.fx.shield || 0, 8); S(k).wrapT = 8; sfx(G, 'skill'); break;
      case 'cloak': usePhase(k); sfx(G, 'skill'); break;
    }
    return true;
  }
  const itemMagnet = () => (magT > 0 ? magT : 0);

  // ---------------------------------------------------------------- update
  function placeMelon(m) {
    const t = T();
    if (!t || !t.PTS) return;
    const N = t.N;
    const i0 = wrapI(Math.floor(m.fi), N), i1 = (i0 + 1) % N;
    const f = m.fi - Math.floor(m.fi);
    const p0 = t.PTS[i0], p1 = t.PTS[i1];
    const a = t.TAN[i0] + PK.U.angDiff(t.TAN[i0], t.TAN[i1]) * f;
    m.x = p0[0] + (p1[0] - p0[0]) * f - Math.sin(a) * m.lat;
    m.y = p0[1] + (p1[1] - p0[1]) * f + Math.cos(a) * m.lat;
  }

  function update(dt, G) {
    if (!(dt > 0)) return;
    clock += dt;
    const ks = (G && G.karts) || [];
    const t = T();
    updateFoods(dt, ks, G);
    updateSale(dt);
    updateBoxes(dt, ks, G);
    updateMissiles(dt, ks, G);
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (k._fmagT > 0) k._fmagT = Math.max(0, k._fmagT - dt);
      if (k.boxRoll > 0) {
        k.boxRoll -= dt;
        if (k.boxRoll <= 0) { k.boxRoll = 0; if (k.isPlayer) sfx(G, 'gauge'); }
      }
      if (k.boxItem && !(G && G.online) && aiBox(k, G)) useBox(k, G);
    }
    for (let i = glitches.length - 1; i >= 0; i--) { glitches[i].t -= dt; if (glitches[i].t <= 0) glitches.splice(i, 1); }

    // cooldowns + per-kart timed effects
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (!(k.skillCd > 0)) k.skillCd = 0;
      else k.skillCd = Math.max(0, k.skillCd - dt);
      const s = kst.get(k);
      if (!s) continue;
      if (s.soapCd > 0) s.soapCd -= dt;
      if (s.wrapT > 0) { s.wrapT -= dt; if (!(k.fx.shield > 0)) s.wrapT = 0; }
      if (s.coinT > 0) s.coinT -= dt;
      if (s.drainT > 0) { s.drainT -= dt; if (s.drainT <= 0) s.drainFrom = null; }

      // cart rush: ram karts in front / at the side
      if (s.rushT > 0) {
        s.rushT -= dt;
        const c = Math.cos(k.a), sn = Math.sin(k.a);
        for (let j = 0; j < ks.length; j++) {
          const o = ks[j];
          if (o === k || s.rushHit.has(o)) continue;
          const dx = o.x - k.x, dy = o.y - k.y;
          const fwd = dx * c + dy * sn, side = -dx * sn + dy * c;
          if (fwd > -2.5 && fwd < 7.5 && Math.abs(side) < 6) {
            s.rushHit.add(o);
            hitKart(o, 'spin', 1.2, G, k);
          }
        }
      }

      // magnet: pull heading toward target
      if (s.magT > 0) {
        s.magT -= dt;
        const tg = s.magTarget;
        if (tg && !k.fx.spin) {
          const dx = tg.x - k.x, dy = tg.y - k.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 4 && dist < 260) {
            const da = PK.U.angDiff(k.a, Math.atan2(dy, dx));
            if (Math.abs(da) < 1.2) k.a += PK.U.clamp(da, -0.5, 0.5) * 2.2 * dt;
          }
        }
        if (s.magT <= 0) s.magTarget = null;
      }
    }

    // banana peels
    for (let i = peels.length - 1; i >= 0; i--) {
      const p = peels[i];
      p.age += dt;
      if (p.age > PEEL_LIFE) { peels.splice(i, 1); continue; }
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j];
        if (k === p.owner && p.age < PEEL_GRACE) continue;
        if (k.fx.ghost > 0) continue;
        const dx = k.x - p.x, dy = k.y - p.y;
        if (dx * dx + dy * dy < PEEL_R * PEEL_R) {
          hitKart(k, 'spin', 1.0, G, p.owner);
          peels.splice(i, 1);
          break;
        }
      }
    }

    // watermelons
    if (t && t.PTS) {
      const N = t.N, lim = barrier() - 3;
      for (let i = melons.length - 1; i >= 0; i--) {
        const m = melons[i];
        m.t += dt;
        if (m.t > MELON_LIFE) { melons.splice(i, 1); continue; }
        // homing target: nearest kart ahead along the track (re-evaluated every frame, cheap)
        let tg = null, bd = 30;
        for (let j = 0; j < ks.length; j++) {
          const k = ks[j];
          if (k === m.owner || k.finished) continue;
          const d = idxAhead(m.fi, k.idx || 0, N);
          if (d > 0 && d < bd) { bd = d; tg = k; }
        }
        m.target = tg;
        if (tg) m.lv += PK.U.clamp((tg.lat || 0) - m.lat, -6, 6) * 22 * dt;
        m.lv *= Math.max(0, 1 - 1.6 * dt);
        m.lat += m.lv * dt;
        if (Math.abs(m.lat) > lim) {
          m.lat = Math.sign(m.lat) * lim;
          m.lv = -m.lv * 0.7;
          m.bounces++;
          m.h = Math.max(m.h, 3);
          if (m.bounces > 2) { melons.splice(i, 1); continue; }
        }
        // advance along centerline
        const i0 = wrapI(Math.floor(m.fi), N);
        const p0 = t.PTS[i0], p1 = t.PTS[(i0 + 1) % N];
        const seg = Math.max(0.5, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
        m.fi = m.fi + (m.speed * dt) / seg;
        if (m.fi >= N) m.fi -= N;
        placeMelon(m);
        m.h = Math.abs(Math.sin(m.t * 9)) * 1.5 + Math.max(0, m.h - 1.5) * 0.9;
        // collide
        for (let j = 0; j < ks.length; j++) {
          const k = ks[j];
          if (k === m.owner || k.fx.ghost > 0) continue;
          const dx = k.x - m.x, dy = k.y - m.y;
          if (dx * dx + dy * dy < MELON_R * MELON_R) {
            hitKart(k, 'spin', 1.4, G, m.owner);
            melons.splice(i, 1);
            break;
          }
        }
      }
    }

    // bat swarms: chase the target kart ahead (re-acquire if lost/passed), stun + drain gauge
    if (t && t.PTS) {
      const N = t.N, lim = barrier() - 2;
      for (let i = swarms.length - 1; i >= 0; i--) {
        const b = swarms[i];
        b.t += dt;
        if (b.t > BAT_LIFE) { swarms.splice(i, 1); continue; }
        let tg = b.target;
        if (!tg || tg.finished || tg.fx.phase > 0 || idxAhead(b.fi, tg.idx || 0, N) > N * 0.5) {
          tg = null; let bd = 60;
          for (let j = 0; j < ks.length; j++) {
            const k = ks[j];
            if (k === b.owner || k.finished || k.fx.phase > 0) continue;
            const d = idxAhead(b.fi, k.idx || 0, N);
            if (d < bd) { bd = d; tg = k; }
          }
          b.target = tg;
        }
        const dx = tg ? tg.x - b.x : 0, dy = tg ? tg.y - b.y : 0;
        if (tg && dx * dx + dy * dy < 22 * 22) {
          // close: fly straight at it
          const dd = Math.hypot(dx, dy) || 1, st = Math.min(dd, b.speed * dt);
          b.x += dx / dd * st; b.y += dy / dd * st;
          b.fi = tg.idx || b.fi; b.lat = tg.lat || 0;
        } else {
          if (tg) b.lat += PK.U.clamp((tg.lat || 0) - b.lat, -8, 8) * 4 * dt;
          b.lat = PK.U.clamp(b.lat, -lim, lim);
          const i0 = wrapI(Math.floor(b.fi), N);
          const p0 = t.PTS[i0], p1 = t.PTS[(i0 + 1) % N];
          const seg = Math.max(0.5, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
          b.fi += (b.speed * dt) / seg;
          if (b.fi >= N) b.fi -= N;
          placeMelon(b);
        }
        for (let j = 0; j < ks.length; j++) {
          const k = ks[j];
          if (k === b.owner || k.fx.ghost > 0 || k.fx.phase > 0) continue;
          const ex = k.x - b.x, ey = k.y - b.y;
          if (ex * ex + ey * ey < BAT_R * BAT_R) {
            if (hitKart(k, 'spin', BAT_STUN, G, b.owner)) {
              k.fx.slow = Math.max(k.fx.slow || 0, 1.0);   // groggy after the stun
              const amt = Math.min(BAT_STEAL, Math.max(0, k.gauge || 0));
              k.gauge = (k.gauge || 0) - amt;
              addGauge(b.owner, amt, G);
              const so = S(b.owner); so.drainT = DRAIN_T; so.drainFrom = k;
            }
            swarms.splice(i, 1);
            break;
          }
        }
      }
    }

    // soap foam
    for (let i = foams.length - 1; i >= 0; i--) {
      const f = foams[i];
      f.t -= dt;
      if (f.t <= 0) { foams.splice(i, 1); continue; }
      f.r = Math.min(FOAM_R, f.r + dt * 24);
      const rr = f.r * (f.t < 1 ? 0.6 + 0.4 * f.t : 1);
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j];
        if (k === f.owner || k.fx.ghost > 0) continue;
        const dx = k.x - f.x, dy = k.y - f.y;
        if (dx * dx + dy * dy < rr * rr) {
          const s = S(k);
          if (!(s.soapCd > 0)) { s.soapCd = FOAM_HIT_CD; hitKart(k, 'slow', 1.2, G, f.owner); }
          if (!(k.fx.shield > 0)) k.a += (rnd() - 0.5) * 4 * dt; // slippery wobble
        }
      }
    }
  }

  // ---------------------------------------------------------------- AI
  function aiWants(k, G) {
    if (!canUse(k, G) || k.isPlayer) return false;
    const s = S(k);
    if (s.readySince < 0) { s.readySince = clock; s.aiDelay = 0.35 + rnd() * 1.1; return false; }
    const waited = clock - s.readySince;
    if (waited < s.aiDelay) return false;
    if (k.fx.spin > 0) return false;
    const pf = 1 / 60;                          // per-frame probability scale
    const ks = (G && G.karts) || [];
    const c = Math.cos(k.a), sn = Math.sin(k.a);
    const t = T(), N = (t && t.N) || 1;
    // forced use after waiting very long (keeps AI from hoarding)
    if (waited > 9 && rnd() < 0.5 * pf) return true;

    // nearest opponent relative positions
    let aheadF = 1e9, aheadSide = 0, behindF = 1e9, behindSide = 0;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k) continue;
      const dx = o.x - k.x, dy = o.y - k.y;
      const f = dx * c + dy * sn, sd = -dx * sn + dy * c;
      if (f > 0 && f < aheadF && Math.abs(sd) < f * 0.45 + 10) { aheadF = f; aheadSide = sd; }
      if (f < 0 && -f < behindF && Math.abs(sd) < 18) { behindF = -f; behindSide = sd; }
    }
    const e = s.eager;
    switch (k.def.skill) {
      case 'banana':
        return behindF < 40 && Math.abs(behindSide) < 12 && rnd() < 3 * e * pf * 6;
      case 'soap':
        return behindF < 35 && rnd() < 3 * e * pf * 6;
      case 'watermelon':
        return aheadF > 12 && aheadF < 120 && rnd() < 2.5 * e * pf * 6;
      case 'cart_rush': {
        if (aheadF < 25 && Math.abs(aheadSide) < 7) return rnd() < 4 * e * pf * 6;
        if (t && t.TAN) {
          const i = k.idx | 0;
          const straight = Math.abs(PK.U.angDiff(t.TAN[wrapI(i, N)], t.TAN[wrapI(i + 10, N)])) < 0.12;
          const aligned = Math.abs(PK.U.angDiff(t.TAN[wrapI(i, N)], k.a)) < 0.15;
          if (straight && aligned && !k.drift) return rnd() < 0.35 * e * pf;
        }
        return false;
      }
      case 'bubble': {
        if (k.fx.shield > 0) return false;
        if (dangerNear(k, c, sn)) return rnd() < 6 * pf * 6;
        // behind in race order -> occasional use for the speed buff
        let pos = 1;
        for (let i = 0; i < ks.length; i++) if (ks[i] !== k && ks[i].prog > k.prog) pos++;
        return pos > 2 && rnd() < 0.25 * e * pf;
      }
      case 'magnet': {
        const tg = magnetTarget(k, G);
        if (!tg) return false;
        const gap = tg.prog - k.prog;
        if (gap < 0.12 * N && (tg.gauge || 0) >= 15) return rnd() < 3 * e * pf * 6;
        return rnd() < 0.4 * e * pf;
      }
      case 'bats': {
        const tg = magnetTarget(k, G);
        if (!tg || tg.fx.phase > 0) return false;
        const gap = tg.prog - k.prog;
        if (gap < 0.1 * N) return rnd() < ((tg.gauge || 0) >= 15 ? 3 : 1.5) * e * pf * 6;
        return rnd() < 0.3 * e * pf;
      }
      case 'teleport': {
        // only when not leading and the leader is within reach (0.35 lap); more eager late in the race
        const ld = leaderOf(k, G);
        if (!ld || ld.prog - k.prog > 0.35 * N) return false;
        const late = (k.lap || 0) >= ((PK.C && PK.C.LAPS) || 3);
        return rnd() < (late ? 2 : 0.6) * e * pf;
      }
      case 'phase': {
        if (k.fx.phase > 0) return false;
        if (dangerNear(k, c, sn)) return rnd() < 6 * pf * 6;
        // boxed in by a kart right ahead -> phase through it
        if (aheadF < 14 && Math.abs(aheadSide) < 6) return rnd() < 3 * e * pf * 6;
        let pos = 1;
        for (let i = 0; i < ks.length; i++) if (ks[i] !== k && ks[i].prog > k.prog) pos++;
        return pos > 2 && rnd() < 0.25 * e * pf;
      }
    }
    return false;
  }

  // any threatening object near this kart (peel/foam ahead, melon from behind/near)
  function dangerNear(k, c, sn) {
    for (let i = 0; i < peels.length; i++) {
      const p = peels[i];
      if (p.owner === k && p.age < PEEL_GRACE) continue;
      const dx = p.x - k.x, dy = p.y - k.y, f = dx * c + dy * sn;
      if (f > 0 && f < 30 && Math.abs(-dx * sn + dy * c) < 8) return true;
    }
    for (let i = 0; i < foams.length; i++) {
      const p = foams[i];
      if (p.owner === k) continue;
      const dx = p.x - k.x, dy = p.y - k.y, f = dx * c + dy * sn;
      if (f > -p.r && f < p.r + 20 && Math.abs(-dx * sn + dy * c) < p.r + 4) return true;
    }
    for (let i = 0; i < melons.length; i++) {
      const m = melons[i];
      if (m.owner === k) continue;
      const dx = m.x - k.x, dy = m.y - k.y;
      if (dx * dx + dy * dy < 45 * 45) return true;
    }
    for (let i = 0; i < swarms.length; i++) {
      const b = swarms[i];
      if (b.owner === k) continue;
      const dx = b.x - k.x, dy = b.y - k.y;
      if (b.target === k && dx * dx + dy * dy < 60 * 60) return true;
    }
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      if (m.owner === k || m.target !== k) continue;
      const dx = m.x - k.x, dy = m.y - k.y;
      if (dx * dx + dy * dy < 70 * 70) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- sprites
  function sprites() {
    out.length = 0; pn = 0;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (f.t > 0) continue;
      emit(f.x, f.y, 1 + Math.sin(clock * 3 + f.ph) * 0.6, foodSpr[f.kind], 8);
    }
    // item boxes: bob, fake-spin (width pulses) and shimmer through 4 colours; pop in on respawn
    const online = PK.Game && PK.Game.online;
    if (!online && SPR.box.length) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.t > 0) continue;
        const sc = b.age < 0.3 ? 0.3 + b.age / 0.3 * 0.7 : 1;
        const spin = 0.72 + 0.28 * Math.abs(Math.cos(clock * 2.2 + b.ph));
        emit(b.x, b.y, 0, SPR.boxSh, 4.2 * sc);
        emit(b.x, b.y, 2.4 + Math.sin(clock * 2.6 + b.ph) * 0.7, SPR.box[((clock * 3 + b.ph) | 0) & 3], 5 * sc * spin);
      }
    }
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      emit(m.x, m.y, m.h, SPR.mis[((m.t * 12) | 0) & 1], 4.6);
      // flame + smoke trail behind it (back along the track direction)
      const ta = tanAt(m.fi), c = Math.cos(ta), sn = Math.sin(ta);
      for (let j = 0; j < 4; j++) {
        const u = ((clock * 7 + j * 0.25) % 1);
        emit(m.x - c * (2 + u * 7), m.y - sn * (2 + u * 7), m.h + 0.6 + u * 1.5, SPR.trail[j === 0 ? 1 : u < 0.4 ? 2 : 3], 1.3 * (1 - u * 0.5));
      }
    }
    const gk = (PK.Game && PK.Game.karts) || [];
    for (let i = 0; i < gk.length; i++) {
      const k = gk[i];
      if (k._fmagT > 0) emit(k.x, k.y, 9 + Math.sin(clock * 12) * 0.4, SPR.magnet, 4);
    }
    for (let i = 0; i < peels.length; i++) {
      const p = peels[i];
      // blink during the final 2 s
      if (p.age > PEEL_LIFE - 2 && ((p.age * 8) | 0) % 2) continue;
      emit(p.x, p.y, 0, SPR.peel, 4);
    }
    for (let i = 0; i < melons.length; i++) {
      const m = melons[i];
      emit(m.x, m.y, m.h, SPR.melon[((m.t * 10) | 0) & 1], 5);
    }
    for (let i = 0; i < foams.length; i++) {
      const f = foams[i];
      const fade = f.t < 1 ? f.t : 1;
      for (let j = 0; j < FOAM_LAYOUT.length; j++) {
        const L = FOAM_LAYOUT[j];
        const bob = Math.sin(clock * 3 + L.ph) * 0.6;
        emit(f.x + L.ox * f.r, f.y + L.oy * f.r, Math.max(0, 0.6 + bob + (j === 0 ? 1.5 : 0)),
             SPR.foam[L.v], (2.6 + 1.6 * L.s) * (0.4 + 0.6 * fade) * (0.5 + 0.5 * f.r / FOAM_R));
      }
    }
    // teleport: pixel scatter bursting out of both swap points
    for (let i = 0; i < glitches.length; i++) {
      const g = glitches[i], u = 1 - g.t / TELE_FX;
      for (let j = 0; j < 10; j++) {
        const an = j * 2.39996 + i, rr = (1.5 + (j % 4)) * (0.4 + u * 1.6);
        emit(g.x + Math.cos(an) * rr, g.y + Math.sin(an) * rr, 1 + ((j * 7) % 9) * (0.5 + u), SPR.gpx[(j + ((clock * 20) | 0)) & 3], 1.3 * (1 - u * 0.5));
      }
    }
    // bat swarm: 5 flapping bats circling the flock centre
    for (let i = 0; i < swarms.length; i++) {
      const b = swarms[i];
      for (let j = 0; j < 5; j++) {
        const an = b.t * 7 + j * (TAU / 5), rr = 2 + (j & 1) * 1.5;
        const fl = (((b.t * 14) | 0) + j) & 1;
        emit(b.x + Math.cos(an) * rr, b.y + Math.sin(an) * rr, 4 + Math.sin(b.t * 9 + j) * 1.5 + (j % 3), SPR.bat[fl], 2.2);
      }
    }
    kst.forEach((s, k) => {
      if (s.drainT > 0 && s.drainFrom) {   // blood drops drifting from the victim to the vampire
        const v = s.drainFrom;
        for (let j = 0; j < 4; j++) {
          const u = (DRAIN_T - s.drainT) / DRAIN_T * 1.6 - j * 0.2;
          if (u < 0 || u > 1) continue;
          emit(v.x + (k.x - v.x) * u, v.y + (k.y - v.y) * u, 4 + Math.sin(u * Math.PI) * 6, SPR.drop, 1.4);
        }
      }
      if (k.fx.phase > 0) {   // faint wisps trailing the phased ghost
        const c = Math.cos(k.a), sn = Math.sin(k.a);
        for (let j = 0; j < 3; j++) {
          const u = (clock * 1.5 + j / 3) % 1;
          emit(k.x - c * (3 + u * 9) + Math.sin(clock * 5 + j * 2) * 1.5 * -sn, k.y - sn * (3 + u * 9) + Math.sin(clock * 5 + j * 2) * 1.5 * c,
               3 + u * 4, SPR.wisp, 1.6 * (1 - u * 0.6));
        }
      }
      if (s.rushT > 0) {
        const c = Math.cos(k.a), sn = Math.sin(k.a);
        emit(k.x + c * 5.5, k.y + sn * 5.5, 0, SPR.cart, 7);
      }
      if (s.magT > 0 || (k === magKart && magT > 0)) {
        emit(k.x, k.y, 9 + Math.sin(clock * 12) * 0.4, SPR.magnet, 4);
        if (s.coinT > 0 && s.magTarget) {
          const tg = s.magTarget;
          for (let j = 0; j < 4; j++) {
            let u = (0.9 - s.coinT) / 0.9 * 1.6 - j * 0.2;
            if (u < 0 || u > 1) continue;
            emit(tg.x + (k.x - tg.x) * u, tg.y + (k.y - tg.y) * u, 4 + Math.sin(u * Math.PI) * 6, SPR.coin, 1.6);
          }
        }
      }
      if (s.wrapT > 0) {
        for (let j = 0; j < 3; j++) {
          const ang = clock * 2.5 + j * (TAU / 3);
          const hh = 2 + ((clock * 3 + j * 2.1) % 7);
          emit(k.x + Math.cos(ang) * 4, k.y + Math.sin(ang) * 4, hh, SPR.wrap, 1.8);
        }
      }
    });
    return out;
  }

  // test / console helpers: give a kart a box item (skips the roulette), inspect boxes and missiles
  function giveBox(k, id) { if (!k || !BOX[id]) return false; k.boxItem = id; k.boxRoll = 0; S(k).boxSince = -1; return true; }
  const boxInfo = () => ({ boxes: boxes.length, active: boxes.filter((b) => !(b.t > 0)).length, missiles: missiles.length, rows: boxes.map((b) => b.i) });
  PK.Skills = { DEFS, ITEMS, ITEM_IDS, BOX, BOX_IDS, BOX_ROLL, init, reset, tryUse, useItem, useBox, giveBox, boxWeights, boxInfo, incoming,
    itemMagnet, startSale, saleLeft, foodIcon, foodName, foodGrade, foodKinds, update, aiWants, sprites };
})(window.PK);
