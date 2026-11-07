// PK.Stage2 — 창고 탈출: top-down warehouse maze escape against the clock (after the checkout, the mart closes).
//   Tile map 40x24 (16px tiles) with a following camera, forklifts, puddles, closing shutters and flickering lights.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const U = PK.U;
  const W = 320, H = 180, T = 16, TAU = Math.PI * 2;
  const TIME = 70, PENALTY = 3;            // time limit (s), forklift hit penalty (s)
  const MAXV = 100, DASHV = 165, ACC = 260, TURN = 6.5, REV = 40;
  const DASH_T = 0.35, DASH_CD = 2.2;
  const HB = 5;                            // cart half box (px)
  const SHUT_DUR = 2.5;                    // shutter closing time
  const FONT = 'DungGeunMo, Galmuri11, NeoDunggeunmo, monospace';

  // # rack / wall, B box stack, ~ puddle, D shutter, S start, E exit
  const MAP = [
    '########################################',
    '#.......BB............................E#',
    '#.....................~~~..........B..E#',
    '#.................................BB..E#',
    '#...####################################',
    '#...####################################',
    '#....BB.............##.................#',
    '#.........~~~..........................#',
    '#...............................BB.....#',
    '############DDD#####################...#',
    '############DDD#####################...#',
    '#.......~~~~~..........................#',
    '#.......~~~~~..........................#',
    '#....BB.~~~~~..........................#',
    '#...####################################',
    '#...####################################',
    '#.................................BB...#',
    '#......................................#',
    '#...BB.................................#',
    '##################DDD###############...#',
    '##################DDD###############...#',
    '#.S...................B...~~~..........#',
    '#...........BB............~~~..........#',
    '########################################',
  ];
  const MW = MAP[0].length, MH = MAP.length;
  const SHUT_T0 = [6, 22];                 // elapsed time each shutter starts closing (sorted bottom → top)
  const FORKS = [                          // patrol lanes: row, x range (tiles), speed, start phase 0..1
    { row: 17, a: 6.5, b: 30.5, spd: 55, ph: 0.2 },
    { row: 12, a: 18.5, b: 34.5, spd: 65, ph: 0.7 },
    { row: 7, a: 8.5, b: 30.5, spd: 60, ph: 0.5 },
    { row: 2, a: 14.5, b: 30.5, spd: 75, ph: 0.1 },
  ];

  // sprites face up (-y); hero pushes from below
  const CART = [
    '.kkkkkkkkkkkk.', 'kwwwwwwwwwwwwk', 'kwdgdgdgdgdgwk', 'kwgdgdgdgdgdwk', 'kwdgdgdgdgdgwk', 'kwgdgdgdgdgdwk',
    'kwdgdgdgdgdgwk', 'kwgdgdgdgdgdwk', 'kwdgdgdgdgdgwk', 'kwgdgdgdgdgdwk', 'kwwwwwwwwwwwwk', '.kkkkkkkkkkkk.',
    'kcccccccccccck', 'kkskkkkkkkkskk', '.kt.kkkkkk.tk.', '.ktkhHhhhhktk.', 'kttkhhhhhhkttk', 'ktttkhhhhktttk',
    'kttttkkkkttttk', '.kttttttttttk.', '..kkkkkkkkkk..',
  ];
  const FORK = [
    '..kk......kk..', '..kf......fk..', '..kf......fk..', '..kf......fk..', '..kf......fk..', '.kkfkkkkkkfkk.',
    '.kmmmmmmmmmmk.', 'kkkkkkkkkkkkkk', 'kyyyyyyyyyyyyk', 'kyykkkkkkkkyyk', 'kyykdwwwwdkyyk', 'kyykdwwwwdkyyk',
    'kyykddddddkyyk', 'kyykkkkkkkkyyk', 'kyyyyyyyyyyyyk', 'kooooooooooook', 'kozozozozozook', 'koooooaaoooook',
    '.kkkkkkkkkkkk.',
  ];
  const PAL_FORK = { k: '#000000', f: '#9aa0a8', m: '#3a3d44', y: '#e8b02a', d: '#2a2c33', w: '#f2f2f2', o: '#c07a1a', z: '#1a1a1a', a: '#ffb000' };

  let el = null, cv = null, g = null, floorCv = null, lightCv = null, lg = null, miniCv = null, sprFork = null;
  let sprCart = null, cartCol = '';
  let active = false, opts = {}, raf = 0, last = 0, coarse = false;
  let mode = 'count', modeT = 0, elapsed = 0, timeLeft = TIME, lastCount = 4, shake = 0;
  let p = null, forks = [], shut = [], lamps = [], floats = [], parts = [], toastText = '', toastT = 0;
  let dashReq = false, camX = 0, camY = 0, clock = 0;
  const shutIdx = new Int8Array(MW * MH).fill(-1);
  const keys = Object.create(null);
  const pointers = new Map();

  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const ch = (tx, ty) => (tx < 0 || ty < 0 || tx >= MW || ty >= MH ? '#' : MAP[ty][tx]);
  const isWall = (tx, ty) => { const c = ch(tx, ty); return c === '#' || c === 'B'; };
  function solid(tx, ty) {
    const c = ch(tx, ty);
    if (c === '#' || c === 'B') return true;
    if (c === 'D') return shut[shutIdx[ty * MW + tx]].solid;
    return false;
  }
  function hits(x, y) {
    const x0 = Math.floor((x - HB) / T), x1 = Math.floor((x + HB - 0.001) / T);
    const y0 = Math.floor((y - HB) / T), y1 = Math.floor((y + HB - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // static data (shutters, lamps) — no DOM needed
  // ---------------------------------------------------------------------------
  (function initStatic() {
    const groups = [];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (MAP[y][x] !== 'D' || shutIdx[y * MW + x] >= 0) continue;
      const gi = groups.length, q = [[x, y]], grp = { x0: x, y0: y, x1: x, y1: y };
      shutIdx[y * MW + x] = gi;
      while (q.length) {
        const [cx, cy] = q.pop();
        grp.x0 = Math.min(grp.x0, cx); grp.y0 = Math.min(grp.y0, cy); grp.x1 = Math.max(grp.x1, cx); grp.y1 = Math.max(grp.y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (ch(nx, ny) === 'D' && shutIdx[ny * MW + nx] < 0) { shutIdx[ny * MW + nx] = gi; q.push([nx, ny]); }
        }
      }
      groups.push(grp);
    }
    // bottom-most shutter closes first
    const order = groups.map((gp, i) => i).sort((a, b) => groups[b].y0 - groups[a].y0);
    const remap = new Int8Array(groups.length);
    order.forEach((gi, k) => { remap[gi] = k; });
    for (let i = 0; i < shutIdx.length; i++) if (shutIdx[i] >= 0) shutIdx[i] = remap[shutIdx[i]];
    shut = order.map((gi, k) => {
      const gp = groups[gi];
      return { x: gp.x0 * T, y: gp.y0 * T, w: (gp.x1 - gp.x0 + 1) * T, h: (gp.y1 - gp.y0 + 1) * T, t0: SHUT_T0[k] || 30, prog: 0, solid: false, warned: false };
    });
    // ceiling lamps over each corridor
    let i = 0;
    for (const ly of [2.5, 7.5, 12.5, 17.5, 22]) for (const lx of [4, 10, 16, 22, 28, 34]) {
      const f = hash(i * 3.7);
      lamps.push({ x: lx * T, y: ly * T, r: 44, flick: f < 0.28, dim: f > 0.92 ? 0.3 : 1, seed: hash(i + 9.1) });
      i++;
    }
  })();

  // ---------------------------------------------------------------------------
  // DOM + sprites (lazy)
  // ---------------------------------------------------------------------------
  function build() {
    if (el) return;
    const st = document.createElement('style');
    st.textContent = '#stage2{background:#000;padding:0;z-index:5;overflow:hidden}' +
      '#stage2 canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;touch-action:none}';
    document.head.appendChild(st);
    el = document.createElement('div');
    el.id = 'stage2'; el.className = 'ov';
    cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    el.appendChild(cv);
    (document.getElementById('wrap') || document.body).appendChild(el);
    g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    lightCv = document.createElement('canvas');
    lightCv.width = W; lightCv.height = H;
    lg = lightCv.getContext('2d');
    sprFork = U.makeSprite(FORK, PAL_FORK);
    buildFloor();
    buildMini();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; pointers.clear(); });
    cv.addEventListener('pointerdown', onPDown);
    cv.addEventListener('pointermove', onPMove);
    cv.addEventListener('pointerup', onPUp);
    cv.addEventListener('pointercancel', onPUp);
    cv.addEventListener('contextmenu', (e) => { if (active) e.preventDefault(); });
  }

  function makeCart(col) {
    const n = parseInt(col.slice(1), 16);
    const lum = 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
    const bar = lum < 60 ? '#5a5a68' : col;
    sprCart = U.makeSprite(CART, {
      k: '#000000', w: '#c9d0d8', g: '#9aa3ad', d: '#5d646e', c: bar,
      s: '#f1c9a0', h: '#3b2a20', H: '#5a4232', t: '#7d8592',
    });
    cartCol = col;
  }

  function buildFloor() {
    floorCv = document.createElement('canvas');
    floorCv.width = MW * T; floorCv.height = MH * T;
    const f = floorCv.getContext('2d');
    const r = U.rng(7331);
    const F = (c, x, y, w, h) => { f.fillStyle = c; f.fillRect(x, y, w, h); };
    const border = (x, y) => x === 0 || y === 0 || x === MW - 1 || y === MH - 1;
    const wet = (x, y) => ch(x, y) === '~';
    // concrete floor
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const px = x * T, py = y * T;
      F(r() < 0.5 ? '#4a4e57' : '#474b54', px, py, T, T);
      if ((x & 1) === 0) F('#3e424a', px, py, 1, T);
      if ((y & 1) === 0) F('#3e424a', px, py, T, 1);
      for (let i = 0; i < 3; i++) F(r() < 0.5 ? '#565b65' : '#3d4149', px + ((r() * T) | 0), py + ((r() * T) | 0), 1, 1);
    }
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const c = MAP[y][x], px = x * T, py = y * T;
      if (c === '#') {
        if (border(x, y)) {                                   // concrete wall
          F('#2b2e36', px, py, T, T);
          for (let k = 3; k < T; k += 4) F('#24272e', px, py + k, T, 1);
          for (let k = 0; k < 4; k++) F('#24272e', px + ((k & 1) ? 4 : 11), py + k * 4, 1, 3);
          if (!isWall(x, y + 1) && y + 1 < MH) F('#3c404a', px, py + T - 1, T, 1);
        } else {                                              // pallet rack with goods
          F('#191b22', px, py, T, T);
          const v = r();
          if (v < 0.12) {
            F('#000', px + 1, py + 1, 14, 14); F('#6b4a2a', px + 2, py + 2, 12, 12);
            F('#523720', px + 2, py + 5, 12, 1); F('#523720', px + 2, py + 9, 12, 1);
          } else {
            const cs = v < 0.67 ? ['#a5743f', '#c4925a', '#7d5530'] : v < 0.87 ? ['#7b8a99', '#a3b2c0', '#5a6672'] : ['#2f5d8c', '#4a7fb5', '#21446a'];
            const bh = 10 + ((r() * 4) | 0);
            F('#000', px + 1, py + 1, 14, bh + 2); F(cs[0], px + 2, py + 2, 12, bh);
            F(cs[1], px + 2, py + 2, 12, 1); F(cs[2], px + 2, py + 1 + bh, 12, 1);
            if (v < 0.67) F('#dcc08a', px + 7, py + 2, 2, bh);
            else if (v >= 0.87) { F(cs[2], px + 2, py + 6, 12, 1); F(cs[2], px + 2, py + 9, 12, 1); }
            else F('rgba(255,255,255,0.25)', px + 3, py + 3, 2, bh - 3);
          }
          const up = !isWall(x, y - 1), dn = !isWall(x, y + 1);
          if (up) { F('#d0702a', px, py, T, 2); if (x % 3 === 0) F('#2b4c8c', px, py, 3, 3); }
          if (dn) { F('#000', px, py + T - 3, T, 1); F('#d0702a', px, py + T - 2, T, 2); if (x % 3 === 0) F('#2b4c8c', px, py + T - 3, 3, 3); }
        }
        continue;
      }
      if (isWall(x, y - 1) && ch(x, y - 1) === '#') F('rgba(0,0,0,0.35)', px, py, T, 3);
      if (ch(x - 1, y) === '#') F('rgba(0,0,0,0.22)', px, py, 2, T);
      // painted lane lines along racks
      if (ch(x, y - 1) === '#' && !border(x, y - 1)) F('#b8962a', px + 2, py + 5, 10, 1);
      if (ch(x, y + 1) === '#' && !border(x, y + 1)) F('#b8962a', px + 2, py + T - 5, 10, 1);
      if (c === '~') {
        const x0 = px + (wet(x - 1, y) ? 0 : 2), x1 = px + T - (wet(x + 1, y) ? 0 : 2);
        const y0 = py + (wet(x, y - 1) ? 0 : 2), y1 = py + T - (wet(x, y + 1) ? 0 : 2);
        F('#2c4a64', x0, y0, x1 - x0, y1 - y0);
        for (let i = 0; i < 2; i++) F('#4a7396', px + 2 + ((r() * 9) | 0), py + 3 + ((r() * 10) | 0), 3 + ((r() * 3) | 0), 1);
      } else if (c === 'B') {
        F('rgba(0,0,0,0.4)', px + 3, py + 3, 14, 14);
        F('#000', px + 1, py + 1, 14, 14); F('#b07a42', px + 2, py + 2, 12, 12);
        F('#cf9a5e', px + 2, py + 2, 12, 1); F('#85582e', px + 2, py + 13, 12, 1);
        F('#e2c48e', px + 2, py + 7, 12, 2); F('#c23a3a', px + 3, py + 3, 3, 2);
      } else if (c === 'S') {
        const col = 'rgba(235,235,235,0.35)';
        F(col, px - 4, py + 1, 24, 1); F(col, px - 4, py + 30, 24, 1); F(col, px - 4, py + 1, 1, 30); F(col, px + 19, py + 1, 1, 30);
      } else if (c === 'E') {
        F('rgba(40,200,90,0.18)', px, py, T, T);
        F('#2f9e55', px + 5, py + 4, 2, 2); F('#2f9e55', px + 7, py + 6, 2, 2); F('#2f9e55', px + 9, py + 8, 2, 2);
        F('#2f9e55', px + 7, py + 10, 2, 2); F('#2f9e55', px + 5, py + 12, 2, 2);
      }
    }
    // emergency exit door in the right wall
    let ey0 = MH, ey1 = 0;
    for (let y = 0; y < MH; y++) if (MAP[y][MW - 2] === 'E') { ey0 = Math.min(ey0, y); ey1 = Math.max(ey1, y); }
    const dx = (MW - 1) * T, dy = ey0 * T, dh = (ey1 - ey0 + 1) * T;
    F('#000', dx, dy, T, dh); F('#cfd6cf', dx + 1, dy + 1, 2, dh - 2);
    F('#2a8a4a', dx + 3, dy + 2, 11, dh - 4); F('#46c873', dx + 3, dy + 2, 1, dh - 4);
    F('#1f6b38', dx + 5, dy + 6, 7, dh / 2 - 9); F('#1f6b38', dx + 5, dy + dh / 2 + 3, 7, dh / 2 - 9);
    F('#dddddd', dx + 4, dy + dh / 2 - 1, 8, 2);
  }

  function buildMini() {
    miniCv = document.createElement('canvas');
    miniCv.width = MW; miniCv.height = MH;
    const m = miniCv.getContext('2d');
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const c = MAP[y][x];
      m.fillStyle = c === '#' ? '#5a6070' : c === 'B' ? '#8a6a40' : c === '~' ? '#2f5a80' : c === 'E' ? '#3fdc6a' : '#16181d';
      m.fillRect(x, y, 1, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // run state
  // ---------------------------------------------------------------------------
  function reset() {
    let sx = 2, sy = 21;
    for (let y = 0; y < MH; y++) { const i = MAP[y].indexOf('S'); if (i >= 0) { sx = i; sy = y; } }
    p = { x: sx * T + T / 2, y: sy * T + T, vx: 0, vy: 0, ang: 0, dashT: 0, dashCd: 0, inv: 0, wet: false, bump: 0 };
    forks = FORKS.map((d) => ({
      x: (d.a + (d.b - d.a) * d.ph) * T, y: d.row * T + T / 2, x0: d.a * T, x1: d.b * T,
      spd: d.spd, dir: d.ph < 0.5 ? 1 : -1, wait: 0, hw: 10, hh: 7,
    }));
    for (const s of shut) { s.prog = 0; s.solid = false; s.warned = false; s.hold = 0; }
    mode = 'count'; modeT = 0; elapsed = 0; timeLeft = TIME; lastCount = 4; shake = 0;
    floats = []; parts = []; toastText = ''; toastT = 0; dashReq = false;
    camX = U.clamp(p.x - W / 2, 0, MW * T - W); camY = U.clamp(p.y - H / 2, 0, MH * T - H);
  }

  function toast(s) { toastText = s; toastT = 2.2; }
  function beep(k) { if (opts.beep) { try { opts.beep(k); } catch (e) { /* ignore */ } } }

  function finish() {
    if (!active) return;
    const tl = Math.max(0, timeLeft), cb = opts.onClear;
    stop();
    setTimeout(() => { if (cb) cb({ timeLeft: tl }); }, 0);
  }
  function quit() {
    if (!active) return;
    const cb = opts.onQuit;
    stop();
    setTimeout(() => { if (cb) cb(); }, 0);
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------
  const BLOCK = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1 };
  function onKeyDown(e) {
    if (!active) return;
    const c = e.code;
    if (BLOCK[c]) e.preventDefault();
    if (c === 'Escape') { e.preventDefault(); quit(); return; }
    if (c === 'Enter' || c === 'NumpadEnter') {
      e.preventDefault();
      if (e.repeat) return;
      if (mode === 'fail') { beep(0); reset(); } else if (mode === 'clear') finish();
      return;
    }
    if (c === 'Space' && !e.repeat) dashReq = true;
    keys[c] = true;
  }
  function onKeyUp(e) { keys[e.code] = false; }

  function ptPos(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / (r.width || 1) * W, y: (e.clientY - r.top) / (r.height || 1) * H };
  }
  const QUIT_BTN = { x: W - 40, y: H - 15, w: 36, h: 12 };
  function onPDown(e) {
    if (!active) return;
    e.preventDefault();
    const pt = ptPos(e);
    if (coarse && pt.x >= QUIT_BTN.x && pt.x <= QUIT_BTN.x + QUIT_BTN.w && pt.y >= QUIT_BTN.y && pt.y <= QUIT_BTN.y + QUIT_BTN.h) { quit(); return; }
    if (mode === 'fail') { beep(0); reset(); return; }
    if (mode === 'clear') { finish(); return; }
    pointers.set(e.pointerId, pt);
    if (pointers.size >= 2) dashReq = true;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onPMove(e) { if (pointers.has(e.pointerId)) pointers.set(e.pointerId, ptPos(e)); }
  function onPUp(e) { pointers.delete(e.pointerId); }

  function readInput() {
    let ix = 0, iy = 0;
    if (keys.ArrowLeft || keys.KeyA) ix -= 1;
    if (keys.ArrowRight || keys.KeyD) ix += 1;
    if (keys.ArrowUp || keys.KeyW) iy -= 1;
    if (keys.ArrowDown || keys.KeyS) iy += 1;
    if (!ix && !iy && pointers.size) {
      const pt = pointers.values().next().value;
      const dx = pt.x - (p.x - camX), dy = pt.y - (p.y - camY);
      if (dx * dx + dy * dy > 64) { ix = dx; iy = dy; }
    }
    return [ix, iy];
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  function physics(dt, ix, iy) {
    const thrust = ix || iy ? 1 : 0;
    if (thrust) {
      const d = U.angDiff(p.ang, Math.atan2(iy, ix));
      p.ang += U.clamp(d, -TURN * dt, TURN * dt);
    }
    const fx = Math.cos(p.ang), fy = Math.sin(p.ang);
    let fwd = p.vx * fx + p.vy * fy, lat = -p.vx * fy + p.vy * fx;
    const wet = p.wet = ch(Math.floor(p.x / T), Math.floor(p.y / T)) === '~';
    lat *= Math.exp(-(wet ? 1.2 : 11) * dt);
    if (thrust) fwd += ACC * dt * (wet ? 0.55 : 1);
    else fwd *= Math.exp(-(wet ? 0.6 : 3) * dt);
    if (p.dashT > 0 && thrust) fwd = Math.max(fwd, 150);
    const top = p.dashT > 0 ? DASHV : MAXV;
    if (fwd > top) fwd = top + (fwd - top) * Math.exp(-6 * dt);
    if (fwd < -REV) fwd = -REV;
    p.vx = fx * fwd - fy * lat; p.vy = fy * fwd + fx * lat;
    // move with wall sliding (axis separated, substepped)
    const sp = Math.hypot(p.vx, p.vy), n = Math.max(1, Math.ceil(sp * dt / 3));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      const nx = p.x + p.vx * sdt;
      if (hits(nx, p.y)) { if (Math.abs(p.vx) > 70) p.bump = 0.12; p.vx *= -0.15; } else p.x = nx;
      const ny = p.y + p.vy * sdt;
      if (hits(p.x, ny)) { if (Math.abs(p.vy) > 70) p.bump = 0.12; p.vy *= -0.15; } else p.y = ny;
    }
    if (wet && sp > 30 && Math.random() < dt * 30) {
      parts.push({ x: p.x + (Math.random() - 0.5) * 8, y: p.y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, t: 0, life: 0.4, col: '#7fb3d8' });
    }
  }

  function update(dt) {
    clock += dt; modeT += dt;
    if (shake > 0) shake -= dt;
    if (toastT > 0) toastT -= dt;
    // forklifts always roll
    for (const f of forks) {
      if (f.wait > 0) { f.wait -= dt; continue; }
      f.x += f.dir * f.spd * dt;
      if (f.x > f.x1) { f.x = f.x1; f.dir = -1; f.wait = 0.8; } else if (f.x < f.x0) { f.x = f.x0; f.dir = 1; f.wait = 0.8; }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.t > q.life) parts.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t > 1.2) floats.splice(i, 1); }

    if (mode === 'count') {
      const c = 3 - Math.floor(modeT);
      if (c !== lastCount && c > 0) { lastCount = c; beep(0); }
      if (modeT >= 3) { mode = 'play'; modeT = 0; beep(1); }
    } else if (mode === 'play') {
      elapsed += dt; timeLeft -= dt;
      if (p.dashT > 0) p.dashT -= dt;
      if (p.dashCd > 0) p.dashCd -= dt;
      if (p.inv > 0) p.inv -= dt;
      if (p.bump > 0) p.bump -= dt;
      if (dashReq && p.dashCd <= 0) { p.dashT = DASH_T; p.dashCd = DASH_CD; }
      dashReq = false;
      const inp = readInput();
      physics(dt, inp[0], inp[1]);
      updateShutters(dt);
      // forklift bumps
      for (const f of forks) {
        if (p.inv > 0) break;
        if (Math.abs(p.x - f.x) < HB + f.hw && Math.abs(p.y - f.y) < HB + f.hh) {
          let dx = p.x - f.x, dy = p.y - f.y;
          if (Math.abs(dy) < 3) dy = (p.y < f.y + 0.01 ? -1 : 1) * 3;
          const d = Math.hypot(dx, dy) || 1;
          p.vx = dx / d * 140 + f.dir * (f.wait > 0 ? 0 : f.spd); p.vy = dy / d * 140;
          p.inv = 1.3; p.dashT = 0; shake = 0.35;
          timeLeft -= PENALTY;
          floats.push({ x: p.x, y: p.y - 10, t: 0, text: '-' + PENALTY + '초', col: '#ff5a4a' });
          toast('지게차 조심!');
        }
      }
      if (ch(Math.floor(p.x / T), Math.floor(p.y / T)) === 'E') { mode = 'clear'; modeT = 0; beep(1); }
      else if (timeLeft <= 0) { timeLeft = 0; mode = 'fail'; modeT = 0; beep(0); }
    } else {
      physics(dt, 0, 0);
      if (mode === 'clear' && modeT >= 1.5) finish();
    }
  }

  function updateShutters(dt) {
    for (const s of shut) {
      if (!s.warned && elapsed >= s.t0 - 2.5) { s.warned = true; if (p.y > s.y + s.h) toast('셔터가 곧 닫힌다! 서둘러!'); }
      if (elapsed < s.t0) continue;
      s.prog = Math.min(1, (elapsed - s.t0) / SHUT_DUR);
      if (s.prog > 0.55 && !s.solid) {
        const over = p.x + HB > s.x && p.x - HB < s.x + s.w && p.y + HB > s.y && p.y - HB < s.y + s.h;
        if (over) { s.t0 += dt; s.prog = 0.55; } else s.solid = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // draw
  // ---------------------------------------------------------------------------
  function R(c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function txt(s, x, y, col, size, align) {
    g.font = (size || 8) + 'px ' + FONT;
    g.textAlign = align || 'left'; g.textBaseline = 'top';
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = '#000';
    g.fillText(s, x - 1, y); g.fillText(s, x + 1, y); g.fillText(s, x, y - 1); g.fillText(s, x, y + 1); g.fillText(s, x + 1, y + 1);
    g.fillStyle = col; g.fillText(s, x, y);
  }
  function lampK(l) {
    if (!l.flick) return l.dim;
    if (Math.sin(clock * 0.9 + l.seed * 6) < 0.35) return l.dim;
    return hash(Math.floor(clock * 14) + l.seed * 100) > 0.45 ? l.dim : 0.12;
  }
  function hole(x, y, r, k) {
    if (x < -r || y < -r || x > W + r || y > H + r || k <= 0) return;
    const gr = lg.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,' + k + ')');
    gr.addColorStop(0.55, 'rgba(0,0,0,' + (k * 0.65) + ')');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    lg.fillStyle = gr; lg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function glow(x, y, r, col) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawShutter(s, ox, oy) {
    const x = Math.round(s.x - ox), y = Math.round(s.y - oy);
    if (x > W || y > H || x + s.w < 0 || y + s.h < 0) return;
    const sh = Math.round(s.h * s.prog);
    // hazard stripes on the threshold
    for (let i = 0; i < s.w; i += 4) R(((i >> 2) & 1) ? '#111' : '#e8c020', x + i, y + s.h - 3, 4, 2);
    if (sh > 0) {
      R('#000', x, y, s.w, sh + 1);
      R('#7a808a', x + 1, y, s.w - 2, sh);
      for (let k = 2; k < sh; k += 3) R('#5d636c', x + 1, y + k, s.w - 2, 1);
      for (let i = 0; i < s.w - 2; i += 4) R(((i >> 2) & 1) ? '#111' : '#e8c020', x + 1 + i, y + Math.max(0, sh - 2), 4, 2);
    }
    R('#000', x, y - 1, s.w, 6); R('#3a3d44', x + 1, y, s.w - 2, 4); R('#5a5f68', x + 1, y, s.w - 2, 1);
    R('#000', x, y, 2, s.h); R('#000', x + s.w - 2, y, 2, s.h);
    R('#8a9099', x, y, 1, s.h); R('#8a9099', x + s.w - 1, y, 1, s.h);
    if (s.warned && s.prog < 1 && Math.floor(clock * 6) % 2 === 0) {
      R('#ff3020', x - 2, y + 1, 3, 3); R('#ff3020', x + s.w - 1, y + 1, 3, 3);
    }
  }

  function drawFork(f, ox, oy) {
    const x = Math.round(f.x - ox), y = Math.round(f.y - oy);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
    R('rgba(0,0,0,0.35)', x - 9, y - 5, 20, 14);
    g.save(); g.translate(x, y); g.rotate(f.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.drawImage(sprFork, -7, -10);
    if (Math.floor(clock * 4) % 2 === 0) { g.fillStyle = '#fff2a0'; g.fillRect(-1, 7, 2, 1); }
    g.restore();
  }

  function drawCart(ox, oy) {
    const x = Math.round(p.x - ox), y = Math.round(p.y - oy);
    R('rgba(0,0,0,0.35)', x - 7, y - 6, 15, 15);
    if (p.inv > 0 && Math.floor(clock * 16) % 2 === 0) return;
    const a = Math.round(p.ang / (TAU / 16)) * (TAU / 16);
    g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
    g.drawImage(sprCart, -7, -10);
    g.restore();
    if (p.dashT > 0) {
      const bx = -Math.cos(p.ang), by = -Math.sin(p.ang);
      for (let i = 1; i <= 3; i++) R('rgba(255,230,140,' + (0.5 - i * 0.12) + ')', x + bx * (10 + i * 4) - 1, y + by * (10 + i * 4) - 1, 2, 2);
    }
  }

  function draw() {
    // camera
    camX = U.clamp(p.x - W / 2, 0, MW * T - W); camY = U.clamp(p.y - H / 2, 0, MH * T - H);
    let ox = Math.round(camX), oy = Math.round(camY);
    if (shake > 0) { ox += Math.round((Math.random() - 0.5) * 4); oy += Math.round((Math.random() - 0.5) * 4); }
    if (p.bump > 0) ox += Math.random() < 0.5 ? -1 : 1;
    R('#000', 0, 0, W, H);
    g.drawImage(floorCv, ox, oy, W, H, 0, 0, W, H);
    // puddle glints
    const t0x = Math.floor(ox / T), t0y = Math.floor(oy / T);
    for (let ty = t0y; ty <= t0y + 12; ty++) for (let tx = t0x; tx <= t0x + 21; tx++) {
      if (ch(tx, ty) !== '~') continue;
      const h = hash(tx * 31 + ty * 7);
      if (Math.sin(clock * 3 + h * 20) > 0.7) R('#a8d4f0', tx * T - ox + 3 + ((h * 9) | 0), ty * T - oy + 4 + ((h * 37) % 8 | 0), 2, 1);
    }
    for (const s of shut) drawShutter(s, ox, oy);
    for (const q of parts) R(q.col, Math.round(q.x - ox), Math.round(q.y - oy), 1, 1);
    for (const f of forks) drawFork(f, ox, oy);
    drawCart(ox, oy);

    // lighting: darkness with holes
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    lg.fillStyle = 'rgba(6,8,20,0.66)'; lg.fillRect(0, 0, W, H);
    lg.globalCompositeOperation = 'destination-out';
    for (const l of lamps) hole(l.x - ox, l.y - oy, l.r, 0.8 * lampK(l));
    hole(p.x - ox, p.y - oy, 46, 0.85);
    for (const f of forks) hole(f.x - ox + f.dir * 16, f.y - oy, 24, 0.7);
    const ex = (MW - 1) * T - ox, ey = 2.5 * T - oy;
    hole(ex, ey, 56, 1);
    lg.globalCompositeOperation = 'source-over';
    g.drawImage(lightCv, 0, 0);

    // additive glows
    g.globalCompositeOperation = 'lighter';
    glow(ex, ey, 40 + Math.sin(clock * 3) * 3, 'rgba(40,200,90,0.35)');
    for (const f of forks) {
      const fx = f.x - ox - f.dir * 7, fy = f.y - oy;
      if (fx > -20 && fx < W + 20 && fy > -20 && fy < H + 20 && Math.floor(clock * 3 + f.x * 0.01) % 2 === 0) glow(fx, fy, 12, 'rgba(255,170,0,0.45)');
    }
    for (const s of shut) if (s.warned && s.prog < 1 && Math.floor(clock * 6) % 2 === 0) glow(s.x - ox + s.w / 2, s.y - oy + 2, 18, 'rgba(255,40,20,0.35)');
    g.globalCompositeOperation = 'source-over';
    if (mode === 'play' && timeLeft < 10) R('rgba(200,20,20,' + (0.06 + 0.06 * Math.sin(clock * 8)) + ')', 0, 0, W, H);

    // exit sign
    const sx = Math.round((MW - 1) * T - ox - 26), sy = Math.round(T - oy - 13);
    if (sx > -40 && sx < W && sy > -20 && sy < H) {
      R('#000', sx, sy, 38, 12); R('#1fa04c', sx + 1, sy + 1, 36, 10);
      txt('비상구', sx + 19, sy + 2, '#eaffea', 8, 'center');
    }
    for (const f of floats) txt(f.text, f.x - ox, f.y - oy - f.t * 14, f.col, 8, 'center');

    drawHud(ox, oy);
  }

  function drawHud(ox, oy) {
    // timer
    R('rgba(0,0,0,0.6)', 3, 3, 62, 30);
    txt('남은 시간', 6, 5, '#c8d0e0', 8);
    const low = timeLeft < 10;
    const tc = timeLeft > 20 ? '#ffe9a8' : !low ? '#ffcc00' : (Math.floor(clock * 4) % 2 ? '#ff4a3a' : '#ffb0a0');
    txt(Math.max(0, timeLeft).toFixed(1), 6, 15, tc, 16);
    // dash meter
    const k = U.clamp(1 - p.dashCd / DASH_CD, 0, 1);
    txt('대시', 6, 36, '#c8d0e0', 8);
    R('#000', 27, 38, 32, 5); R(k >= 1 ? '#ffcc00' : '#7a6a30', 28, 39, Math.round(30 * k), 3);
    // minimap
    const mx = W - MW - 5, my = 4;
    R('#000', mx - 2, my - 2, MW + 4, MH + 4); R('#8a9099', mx - 1, my - 1, MW + 2, MH + 2);
    g.drawImage(miniCv, mx, my);
    for (const s of shut) if (s.solid || s.prog > 0) R(s.solid ? '#ff4030' : '#ffaa30', mx + s.x / T, my + s.y / T, s.w / T, s.h / T);
    for (const f of forks) R('#ffb000', mx + Math.floor(f.x / T), my + Math.floor(f.y / T), 1, 1);
    if (Math.floor(clock * 4) % 2 === 0) R('#ffffff', mx + Math.floor(p.x / T), my + Math.floor(p.y / T), 1, 1);
    R('rgba(255,255,255,0.25)', mx + ox / T, my + oy / T, W / T, 1);
    // edge arrow toward the exit
    const ex = (MW - 1) * T - ox, ey = 2.5 * T - oy;
    if (ex < 0 || ex > W || ey < 0 || ey > H) {
      const ax = U.clamp(ex, 14, W - 14), ay = U.clamp(ey, 50, H - 14);
      const a = Math.atan2(ey - ay, ex - ax);
      const c = Math.cos(a), s = Math.sin(a);
      g.save(); g.translate(Math.round(ax), Math.round(ay)); g.rotate(a);
      g.fillStyle = '#000'; g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -6); g.lineTo(-5, 6); g.closePath(); g.fill();
      g.fillStyle = Math.floor(clock * 3) % 2 ? '#3fdc6a' : '#9cffb8'; g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, -4); g.lineTo(-4, 4); g.closePath(); g.fill();
      g.restore();
      txt('EXIT', ax - c * 14, ay - s * 14 - 4, '#3fdc6a', 8, 'center');
    }
    if (toastT > 0 && (toastT > 0.5 || Math.floor(clock * 8) % 2)) txt(toastText, W / 2, 40, '#ffcc00', 8, 'center');
    if (coarse) { R('#000', QUIT_BTN.x, QUIT_BTN.y, QUIT_BTN.w, QUIT_BTN.h); R('#3a2a4a', QUIT_BTN.x + 1, QUIT_BTN.y + 1, QUIT_BTN.w - 2, QUIT_BTN.h - 2); txt('나가기', QUIT_BTN.x + QUIT_BTN.w / 2, QUIT_BTN.y + 2, '#ffe9a8', 8, 'center'); }

    // countdown / hints
    if (mode === 'count' || (mode === 'play' && modeT < 3)) {
      R('rgba(0,0,0,0.6)', 0, H - 34, W, 22);
      txt('비상구를 찾아 탈출하라!', W / 2, H - 33, '#9cffb8', 8, 'center');
      txt(coarse ? '화면을 누른 채 이동 · 두 손가락 터치 대시' : '방향키/WASD 이동 · SPACE 대시 · ESC 나가기', W / 2, H - 23, '#c8d0e0', 8, 'center');
    }
    if (mode === 'count') {
      const n = 3 - Math.floor(modeT), f = modeT % 1;
      txt(String(n), W / 2, 62 - (1 - f) * 4, '#ffffff', 32, 'center');
    } else if (mode === 'play' && modeT < 0.8) {
      txt('시작!', W / 2, 64, '#ffcc00', 32, 'center');
    }
    if (mode === 'fail') panel('시간 초과!', '#ff5a4a', '창고에 갇혀 버렸다...', coarse ? '터치: 다시하기' : '[Enter] 다시하기   [Esc] 나가기');
    else if (mode === 'clear') panel('탈출 성공!', '#9cffb8', '남은 시간 ' + Math.max(0, timeLeft).toFixed(1) + '초', coarse ? '터치: 계속' : '[Enter] 계속');
  }

  function panel(title, col, sub, foot) {
    const pw = 190, ph = 76, x = (W - pw) / 2, y = (H - ph) / 2 - 6;
    R('#000', x - 1, y - 1, pw + 2, ph + 2); R('#2a1f3d', x, y, pw, ph); R('#ffcc00', x, y, pw, 1); R('#ffcc00', x, y + ph - 1, pw, 1);
    txt(title, W / 2, y + 8, col, 32, 'center');
    txt(sub, W / 2, y + 44, '#ffe9a8', 8, 'center');
    if (Math.floor(clock * 2) % 2 === 0 || mode === 'fail') txt(foot, W / 2, y + 58, '#c8d0e0', 8, 'center');
  }

  function loop(now) {
    if (!active) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    if (!active) return;
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  function start(o) {
    opts = o || {};
    build();
    const defs = PK.Karts && PK.Karts.DEFS;
    const di = U.clamp(opts.def | 0, 0, defs ? defs.length - 1 : 0);
    const col = (defs && defs[di] && defs[di].color) || '#e03a3a';
    if (!sprCart || col !== cartCol) makeCart(col);
    coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    for (const k in keys) keys[k] = false;
    pointers.clear();
    reset();
    active = true;
    el.classList.add('on');
    if (raf) cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    active = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (el) el.classList.remove('on');
    for (const k in keys) keys[k] = false;
    pointers.clear();
  }

  PK.Stage2 = {
    start, stop,
    get active() { return active; },
    _dbg: { MAP, CART, FORK, FORKS, TIME },
  };
})(window.PK);
