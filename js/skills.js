// PK.Skills — six mart-themed kart skills (one per kart), world objects, AI usage.
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

  // ---------------------------------------------------------------- state
  const peels = [];   // {x, y, age, owner}
  const melons = [];  // {fi, lat, lv, x, y, h, t, owner, speed, bounces, target}
  const foams = [];   // {x, y, t, owner, r}
  let kst = new Map(); // kart -> per-kart skill state
  let clock = 0;       // internal seconds (advanced by update)
  let rnd = Math.random;

  // sprites (built in init)
  const SPR = { peel: null, melon: [null, null], foam: [], cart: null, magnet: null, coin: null, wrap: null };

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
            wrapT: 0, soapCd: 0, readySince: -1, aiDelay: 0.5, eager: 0.6 + rnd() * 0.4 };
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
      desc: '앞 카트에게 끌려가며 부스터 게이지를 최대 30 훔친다', icon: null }
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
    reset();
  }

  function reset() {
    peels.length = 0; melons.length = 0; foams.length = 0;
    kst = new Map();
    clock = 0;
    placeFoods();
  }

  // ---------------------------------------------------------------- food pickups on the road
  // Rows of groceries (assets/food.png, 16 cells of 48x48) across the track: drive through one
  // for boost gauge; it respawns a few seconds later. Sprites are painted when the sheet loads.
  const FOOD_KO = ['사과', '바나나', '우유', '식빵', '소고기', '목살', '생선', '라면', '치즈', '케이크', '과자', '콜라', '컵케이크', '초코', '상추', '토마토'];
  const FOOD_GAUGE = 25, FOOD_RESPAWN = 6, FOOD_R = 6;
  const foods = [], foodSpr = [];
  const foodImg = new Image();
  function foodSprites() {
    if (foodSpr.length) return;
    for (let i = 0; i < 16; i++) { const c = document.createElement('canvas'); c.width = c.height = 32; foodSpr.push(c); }
    foodImg.onload = () => foodSpr.forEach((c, i) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 32);
      g.drawImage(foodImg, i * 48, 0, 48, 48, 0, 0, 32, 32);
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
        foods.push({ x: p[0] - Math.sin(a) * lat, y: p[1] + Math.cos(a) * lat, kind: Math.floor(r() * 16), t: 0, ph: r() * TAU });
      }
    }
  }
  function updateFoods(dt, ks, G) {
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (f.t > 0) { f.t -= dt; continue; }
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j], dx = k.x - f.x, dy = k.y - f.y;
        if (dx * dx + dy * dy > FOOD_R * FOOD_R) continue;
        f.t = FOOD_RESPAWN;
        addGauge(k, FOOD_GAUGE, G);
        if (k.isPlayer) { sfx(G, 'pad'); if (G && typeof G.toast === 'function') G.toast(FOOD_KO[f.kind] + ' GET! +' + FOOD_GAUGE); }
        break;
      }
    }
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
    switch (id) {
      case 'cart_rush': useRush(k, G); break;
      case 'banana': useBanana(k, G); break;
      case 'watermelon': useMelon(k, G); break;
      case 'soap': useSoap(k, G); break;
      case 'bubble': useBubble(k, G); break;
      case 'magnet': useMagnet(k, G); break;
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
    kst.forEach((s, k) => {
      if (s.rushT > 0) {
        const c = Math.cos(k.a), sn = Math.sin(k.a);
        emit(k.x + c * 5.5, k.y + sn * 5.5, 0, SPR.cart, 7);
      }
      if (s.magT > 0) {
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

  PK.Skills = { DEFS, init, reset, tryUse, update, aiWants, sprites };
})(window.PK);
