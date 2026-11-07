// PK.Stage3 — night street: ride the cart home, picking up the groceries that spilled from the torn bag.
//   Top-down neighbourhood (64x36 tiles of 16px) with a following camera. Collect every listed food, then reach 집.
//   Hazards: cars (roads A/B) and bikes (roads C/D) — they stop for you on crosswalks; a stray cat; puddles.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const W = 320, H = 180, T = 16;
  const MTW = 64, MTH = 36, MW = MTW * T, MH = MTH * T;
  const HUD_H = 20;
  const TIME_LIMIT = 90;
  const TAU = Math.PI * 2;
  const FONT = 'px DungGeunMo, Galmuri11, NeoDunggeunmo, monospace';
  const DEFAULT_ITEMS = [5, 0, 1, 2, 7, 14, 11, 15];
  const DECOY_POOL = [3, 9, 10, 12, 13, 8, 6, 4];
  const NAMES = ['사과', '바나나', '우유', '식빵', '소고기', '목살', '생선', '라면', '치즈', '케이크', '과자', '콜라', '컵케이크', '초코', '상추', '토마토'];
  // player physics
  const PR = 6, ACC = 430, VMAX = 86, VSLOW = 64, VDASH = 168, DASH_T = 0.3, DASH_CD = 2.2, PICK_R = 12;
  const PEN_CAR = 3, PEN_BIKE = 2, PEN_DECOY = 2;
  const INTRO_MSG = 1.8, INTRO_T = INTRO_MSG + 2.1;     // message, then 3-2-1 (0.7 s each)

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  const darken = (h, f) => (PK.U && PK.U.darken ? PK.U.darken(h, f) : h);
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? a : b; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // food sheet: 16 cells of 48x48 (drawImage only — must work from file://)
  const foodImg = new Image();
  foodImg.src = 'assets/food.png';

  // ---------------------------------------------------------------------------
  // map: tiles  B building  M mart  C store  O home  H home door  . sidewalk  r road
  //             z crosswalk (horizontal road)  y crosswalk (vertical road)  g grass  T tree
  //             s sand  a alley  p parking lot
  // ---------------------------------------------------------------------------
  const HROADS = [[8, 10], [25, 27]], VROADS = [[20, 22], [42, 44]];
  const START = { x: 152, y: 110 };
  const DOOR = { x: 928, y: 368 };            // bottom-centre of the 2-tile front door
  // required-item spots (filled in order of opts.items); spot 0 is the cat's target
  const SPOTS = [
    [592, 248],   // park lawn (the cat wants it)
    [90, 288],    // west alley dead end, by the bins
    [269, 115],   // by the bench next to the mart
    [509, 506],   // between parked cars in the lot
    [500, 50],    // playground sand
    [816, 236],   // east alley
    [932, 470],   // by the vending machine
    [296, 530],   // far end of the west sidewalk
    [896, 116],   // in front of the convenience store
    [432, 236],   // park, west lawn
    [60, 184],    // far west sidewalk
    [1000, 456],  // far east sidewalk
  ];
  const DECOYS = [[200, 376], [512, 340], [760, 104], [840, 452], [990, 196]];
  const PUDDLES = [[120, 188], [338, 236], [470, 290], [812, 262], [612, 420], [150, 292], [905, 456], [700, 150], [560, 108], [380, 470]]
    .map((p) => ({ x: p[0], y: p[1], rx: 9, ry: 5 }));
  const CAT_HOME = { x: 440, y: 328 };

  let grid = null, mapCv = null, emitCv = null;
  const RECTS = [], PROPS = [], LIGHTS = [];

  const BLD = 'BMCOH';
  const isBld = (c) => BLD.indexOf(c) >= 0;
  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= MTW || ty >= MTH ? '#' : grid[ty][tx]);
  const tileAtPx = (x, y) => tileAt(Math.floor(x / T), Math.floor(y / T));
  const tSolid = (c) => c === '#' || c === 'T' || isBld(c);
  const isRoad = (c) => c === 'r' || c === 'z' || c === 'y';
  const inRange = (rs, v) => { for (const r of rs) if (v >= r[0] && v <= r[1]) return r; return null; };

  function buildMap() {
    if (grid) return;
    grid = [];
    for (let y = 0; y < MTH; y++) grid.push(new Array(MTW).fill('B'));
    const fill = (x0, y0, x1, y1, c, only) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!only || grid[y][x] === only) grid[y][x] = c;
    };
    for (const [a, b] of HROADS) fill(0, a, MTW - 1, b, 'r');
    for (const [a, b] of VROADS) fill(a, 0, b, MTH - 1, 'r');
    for (const [a, b] of HROADS) { fill(0, a - 2, MTW - 1, a - 1, '.', 'B'); fill(0, b + 1, MTW - 1, b + 2, '.', 'B'); }
    for (const [a, b] of VROADS) { fill(a - 2, 0, a - 1, MTH - 1, '.', 'B'); fill(b + 1, 0, b + 2, MTH - 1, '.', 'B'); }
    // crosswalks around every intersection + mid-block ones
    for (const [a, b] of HROADS) for (const [c, d] of VROADS) {
      fill(c - 2, a, c - 1, b, 'z'); fill(d + 1, a, d + 2, b, 'z');
      fill(c, a - 2, d, a - 1, 'y'); fill(c, b + 1, d, b + 2, 'y');
    }
    fill(31, 8, 32, 10, 'z'); fill(10, 25, 11, 27, 'z'); fill(52, 25, 53, 27, 'z');
    fill(20, 17, 22, 18, 'y'); fill(42, 17, 44, 18, 'y');
    // blocks
    fill(3, 1, 15, 5, 'M');                       // mart
    fill(52, 1, 58, 5, 'C');                      // convenience store
    fill(27, 1, 36, 5, 's');                      // playground
    fill(25, 13, 39, 22, 'g'); fill(25, 17, 39, 18, '.'); fill(31, 13, 32, 22, '.');   // park + paths
    fill(4, 17, 17, 18, 'a');                     // west alley (dead end)
    fill(50, 13, 51, 22, 'a');                    // east alley
    fill(55, 18, 60, 22, 'O'); fill(57, 22, 58, 22, 'H');   // home
    fill(27, 30, 37, 34, 'p');                    // parking lot
    for (const [x, y] of [[26, 14], [29, 14], [35, 13], [38, 14], [26, 21], [38, 21], [29, 21], [36, 20], [25, 13], [33, 22], [39, 19]])
      if (grid[y][x] === 'g') grid[y][x] = 'T';

    // props (solid rects)
    const rect = (k, x, y, w, h, ex) => { const p = Object.assign({ k, x, y, w, h }, ex || {}); PROPS.push(p); RECTS.push(p); return p; };
    rect('bench', 258, 98, 22, 8);
    rect('bench', 528, 262, 22, 8);
    rect('bench', 420, 306, 22, 8);
    rect('bins', 65, 275, 9, 24);
    rect('vend', 950, 468, 14, 11);
    rect('vend', 860, 97, 14, 10);
    rect('slide', 452, 26, 10, 26);
    rect('swing', 536, 22, 32, 6);
    rect('hydrant', 302, 377, 6, 6);
    rect('hydrant', 622, 186, 6, 6);
    rect('plant', 898, 369, 8, 7);
    rect('plant', 950, 369, 8, 7);
    const PC = ['#d8d8dc', '#b8323a', '#3a5ab8', '#2a2a30', '#d8b03a'];
    [438, 470, 534, 566].forEach((x, i) => rect('pcar', x, 486, 14, 26, { col: PC[i % PC.length] }));
    rect('pcar', 470, 528, 14, 26, { col: PC[4] });
    // street lamps along the curbs (skip near spots / off-sidewalk)
    const near = (x, y, d) => SPOTS.concat(DECOYS).some((s) => Math.hypot(s[0] - x, s[1] - y) < d);
    const lamp = (x, y) => {
      if (tileAtPx(x, y) !== '.' || near(x, y, 20)) return;
      rect('lamp', x - 2, y - 2, 4, 4);
      LIGHTS.push({ x, y: y + 4, r: 40, lamp: true });
    };
    for (let x = 40; x < MW; x += 112) { lamp(x, 7 * T + 12); lamp(x + 56, 11 * T + 4); lamp(x + 28, 24 * T + 12); lamp(x + 84, 28 * T + 4); }
    for (let y = 40; y < MH; y += 112) { lamp(19 * T + 12, y); lamp(23 * T + 4, y + 56); lamp(41 * T + 12, y + 28); lamp(45 * T + 4, y + 84); }
    lamp(488, 266); lamp(536, 312);
    // other light sources
    LIGHTS.push({ x: 152, y: 104, r: 62 }, { x: 888, y: 106, r: 48 }, { x: 957, y: 462, r: 18 }, { x: 867, y: 110, r: 16 },
      { x: 124, y: 280, r: 24 }, { x: 808, y: 300, r: 22 });
  }

  // ---------------------------------------------------------------------------
  // drawing helpers (g = current target context)
  // ---------------------------------------------------------------------------
  let g = null;
  function R(c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function pc(cx, cy, r, c) {          // crisp pixel disc
    g.fillStyle = c;
    for (let dy = -r; dy <= r; dy++) { const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.6)); g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1); }
  }
  function text(s, x, y, col, size, align) {
    g.font = (size || 8) + FONT; g.textAlign = align || 'center'; g.textBaseline = 'middle';
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = '#000';
    g.fillText(s, x + 1, y + 1); g.fillText(s, x - 1, y); g.fillText(s, x + 1, y); g.fillText(s, x, y - 1);
    g.fillStyle = col; g.fillText(s, x, y);
  }
  function food(i, x, y, s) {
    if (!foodImg.complete || !foodImg.naturalWidth) return;
    const d = Math.round(48 * s);
    g.drawImage(foodImg, i * 48, 0, 48, 48, Math.round(x - d / 2), Math.round(y - d / 2), d, d);
  }
  // top-down car; mode 0 body, 1 lights only
  function car(cx, cy, horiz, dir, col, mode) {
    const L = 26, Wd = 12;
    const rl = (u, v, lu, lv, c) => {
      let x, y, w, h;
      if (horiz) { w = lu; h = lv; y = cy - Wd / 2 + v; x = dir > 0 ? cx - L / 2 + u : cx + L / 2 - u - lu; }
      else { w = lv; h = lu; x = cx - Wd / 2 + v; y = dir > 0 ? cy - L / 2 + u : cy + L / 2 - u - lu; }
      R(c, Math.round(x), Math.round(y), w, h);
    };
    if (mode) {
      rl(L - 1, 1, 1, 3, '#fff6c0'); rl(L - 1, Wd - 4, 1, 3, '#fff6c0');
      rl(0, 1, 1, 3, '#ff3a3a'); rl(0, Wd - 4, 1, 3, '#ff3a3a');
      return;
    }
    rl(17, -2, 2, Wd + 4, '#000');
    rl(-1, -1, L + 2, Wd + 2, '#000');
    rl(0, 0, L, Wd, col);
    rl(1, 1, L - 2, 1, 'rgba(255,255,255,0.25)');
    rl(4, 1, 4, Wd - 2, '#1c2740');
    rl(8, 1, 8, Wd - 2, darken(col, 0.82));
    rl(16, 1, 4, Wd - 2, '#26365a');
    rl(18, 2, 1, 3, '#5a76a8');
    rl(L - 1, 1, 1, 3, '#d8d0a0'); rl(L - 1, Wd - 4, 1, 3, '#d8d0a0');
    rl(0, 1, 1, 3, '#7a2020'); rl(0, Wd - 4, 1, 3, '#7a2020');
  }
  function bike(cx, cy, dir, shirt, mode) {
    cx = Math.round(cx); cy = Math.round(cy);
    if (mode) { R('#fff6c0', cx, cy + dir * 8, 1, 1); R('#ff3a3a', cx, cy - dir * 8, 1, 1); return; }
    R('#000', cx - 1, cy - 8, 3, 16); R('#3a3a40', cx, cy - 7, 1, 14);
    R('#000', cx - 4, cy + dir * 5 - 1, 9, 3); R('#9aa0aa', cx - 3, cy + dir * 5, 7, 1);
    R('#000', cx - 5, cy - 3, 11, 6); R(shirt, cx - 4, cy - 2, 9, 4);
    const hy = cy + dir * 1;
    R('#000', cx - 3, hy - 2, 6, 5); R('#2a1a14', cx - 2, hy - 1, 4, 3);
  }
  function cat(x, y, dir, moving, t) {
    x = Math.round(x); y = Math.round(y);
    const r = (dx, dy, w, h, c) => R(c, dir > 0 ? x + dx : x - dx - w, y + dy, w, h);
    const O = '#e39a48', D = '#a8642a', f = moving ? (Math.floor(t * 10) & 1) : 0;
    if (moving) { r(-4 + f, -5, 2, 1, D); r(1 - f, -5, 2, 1, D); r(-4 + (1 - f), 3, 2, 1, D); r(1 + f, 3, 2, 1, D); }
    const tw = Math.round(Math.sin(t * (moving ? 12 : 3)));
    r(-9, -1 + tw, 4, 2, '#000'); r(-8, tw, 3, 1, O);
    r(-6, -4, 11, 7, '#000'); r(-5, -3, 9, 5, O); r(-3, -3, 1, 5, D); r(0, -3, 1, 5, D);
    r(3, -5, 6, 8, '#000'); r(4, -4, 4, 6, O); r(4, -6, 1, 1, '#000'); r(7, -6, 1, 1, '#000');
    r(6, -3, 1, 1, '#c8f060'); r(6, 0, 1, 1, '#c8f060'); r(8, -2, 1, 2, '#f0a0a0');
  }

  // ---------------------------------------------------------------------------
  // prerendered map + emissive layer
  // ---------------------------------------------------------------------------
  const ROOFS = [
    { roof: '#3d3a52', hi: '#4d4a66', wall: '#6b6280', base: '#4a4458' },
    { roof: '#4a3f4f', hi: '#5c5062', wall: '#7a6670', base: '#54464e' },
    { roof: '#36404f', hi: '#465264', wall: '#5e6c7e', base: '#424c5a' },
    { roof: '#4b4a44', hi: '#5d5c54', wall: '#7c7462', base: '#575244' },
    { roof: '#423548', hi: '#54445c', wall: '#806878', base: '#5a4654' },
  ];
  const regionOf = (tx, ty) => {
    const ry = ty < 13 ? 0 : ty < 30 ? 1 : 2;
    return ((((tx >> 2) * 73856093) ^ (ry * 19349663)) >>> 0) % ROOFS.length;
  };

  function paintMap() {
    mapCv = mk(MW, MH); emitCv = mk(MW, MH);
    const m = mapCv.getContext('2d'), e = emitCv.getContext('2d');
    const rnd = PK.U.rng(20261107);
    for (let ty = 0; ty < MTH; ty++) for (let tx = 0; tx < MTW; tx++) { g = m; paintTile(tx, ty, rnd, e); }
    g = m;
    // warm pools under the lamps
    for (const L of LIGHTS) if (L.lamp) {
      pc(L.x, L.y + 2, L.r - 8, 'rgba(255,196,110,0.06)'); pc(L.x, L.y + 2, (L.r * 0.6) | 0, 'rgba(255,196,110,0.07)');
      pc(L.x, L.y + 2, (L.r * 0.32) | 0, 'rgba(255,214,140,0.08)');
    }
    for (const p of PROPS) { g = m; paintProp(p, e); }
    // tree canopies on top
    g = m;
    for (let ty = 0; ty < MTH; ty++) for (let tx = 0; tx < MTW; tx++) if (grid[ty][tx] === 'T') {
      const cx = tx * T + 8, cy = ty * T + 8;
      R('rgba(0,0,0,0.3)', cx - 8, cy + 6, 18, 4);
      pc(cx, cy, 10, '#000'); pc(cx, cy, 9, '#1d3824'); pc(cx - 1, cy - 1, 7, '#2b5032'); pc(cx - 3, cy - 3, 3, '#3d6a40');
      R('#4c7c4c', cx - 4, cy - 5, 2, 1);
    }
    // signs (lit)
    g = e;
    R('#000', 95, 51, 114, 13); R('#2f8a4a', 96, 52, 112, 11); R('#3fae5e', 96, 52, 112, 1); text('슈퍼마트', 152, 58, '#ffffff', 8);
    R('#000', 849, 51, 78, 13); R('#2a6ad8', 850, 52, 76, 11); R('#ffd84a', 850, 61, 76, 2); text('편의점 24', 888, 57, '#ffffff', 8);
    g = null;
  }

  function paintTile(tx, ty, rnd, e) {
    const c = grid[ty][tx], x = tx * T, y = ty * T;
    if (isBld(c)) { paintBld(tx, ty, c, rnd, e); return; }
    if (c === '.') {
      R('#55535f', x, y, T, T);
      R('#48464f', x, y + 7, T, 1); R('#48464f', x, y + 15, T, 1);
      R('#48464f', x + ((ty & 1) ? 3 : 11), y, 1, 7); R('#48464f', x + ((ty & 1) ? 11 : 3), y + 8, 1, 7);
      if (rnd() < 0.1) R('#4c4a55', x + ((rnd() * 10) | 0), y + ((rnd() * 10) | 0), 3, 2);
      // curbs
      if (isRoad(tileAt(tx, ty - 1))) { R('#8b8996', x, y, T, 2); R('#2a2830', x, y, T, 1); }
      if (isRoad(tileAt(tx, ty + 1))) { R('#8b8996', x, y + 14, T, 2); R('#2a2830', x, y + 15, T, 1); }
      if (isRoad(tileAt(tx - 1, ty))) { R('#8b8996', x, y, 2, T); R('#2a2830', x, y, 1, T); }
      if (isRoad(tileAt(tx + 1, ty))) { R('#8b8996', x + 14, y, 2, T); R('#2a2830', x + 15, y, 1, T); }
      return;
    }
    if (isRoad(c)) {
      R('#2a2c37', x, y, T, T);
      for (let i = 0; i < 4; i++) R(rnd() < 0.5 ? '#31333f' : '#24262f', x + ((rnd() * 15) | 0), y + ((rnd() * 15) | 0), 1, 1);
      const hr = inRange(HROADS, ty), vr = inRange(VROADS, tx);
      if (c === 'z') { for (let k = 1; k < T; k += 4) R('#c9cad2', x + 1, y + k, 14, 2); return; }
      if (c === 'y') { for (let k = 1; k < T; k += 4) R('#c9cad2', x + k, y + 1, 2, 14); return; }
      if (hr && !vr && ty === hr[0] + 1 && !(tx & 1)) R('#c9a23a', x + 3, y + 7, 10, 2);
      if (vr && !hr && tx === vr[0] + 1 && !(ty & 1)) R('#c9a23a', x + 7, y + 3, 2, 10);
      return;
    }
    if (c === 'g' || c === 'T') {
      R('#2c4632', x, y, T, T);
      for (let i = 0; i < 5; i++) R(rnd() < 0.5 ? '#3a5a3e' : '#233a29', x + ((rnd() * 15) | 0), y + ((rnd() * 15) | 0), 1, 2);
      return;
    }
    if (c === 's') {
      R('#7d6d50', x, y, T, T);
      for (let i = 0; i < 6; i++) R(rnd() < 0.5 ? '#8f7f60' : '#6a5c43', x + ((rnd() * 15) | 0), y + ((rnd() * 15) | 0), 1, 1);
      return;
    }
    if (c === 'a') {
      R('#3d3b46', x, y, T, T);
      R('#36343e', x, y + ((tx * 7 + ty * 3) % 14), T, 1);
      if (rnd() < 0.3) R('#2e2c35', x + ((rnd() * 10) | 0), y + ((rnd() * 12) | 0), 4, 1);
      return;
    }
    if (c === 'p') {
      R('#30323b', x, y, T, T);
      if (!(tx & 1) && ty <= 32) R('#a9aab2', x, y + (ty === 30 ? 3 : 0), 1, ty === 32 ? 12 : T);
      if (rnd() < 0.15) R('#2a2c34', x + 4, y + 6, 5, 3);
      return;
    }
    R('#000', x, y, T, T);
  }

  function paintBld(tx, ty, c, rnd, e) {
    const x = tx * T, y = ty * T;
    const fac = !isBld(tileAt(tx, ty + 1));
    const eL = !isBld(tileAt(tx - 1, ty)), eR = !isBld(tileAt(tx + 1, ty)), eU = !isBld(tileAt(tx, ty - 1));
    let pal = ROOFS[regionOf(tx, ty)];
    if (c === 'M') pal = { roof: '#a83c36', hi: '#c85048', wall: '#e9e2d0', base: '#b8b0a0' };
    if (c === 'C') pal = { roof: '#3a6a5a', hi: '#4a806e', wall: '#dcdcd4', base: '#a8a8a0' };
    if (c === 'O' || c === 'H') pal = { roof: '#8a4b36', hi: '#a05a42', wall: '#d9c39a', base: '#a8946e' };
    if (!fac) {
      R(pal.roof, x, y, T, T);
      if (c === 'O') { for (let k = 2; k < T; k += 4) R(darken(pal.roof, 0.8), x, y + k, T, 1); }
      else if (c === 'M' && ty === 4) { for (let k = 0; k < T; k += 4) R(k & 4 ? '#f2eee4' : '#c8403a', x + k, y + 9, 4, 7); R('#000', x, y + 8, T, 1); }
      else if (rnd() < 0.12) { R('#000', x + 4, y + 5, 7, 6); R('#7a7a86', x + 5, y + 6, 5, 4); R('#9a9aa6', x + 5, y + 6, 5, 1); }
      else if (rnd() < 0.05) { pc(x + 8, y + 8, 4, '#000'); pc(x + 8, y + 8, 3, '#6a7a8a'); }
      if (eU) R(pal.hi, x, y, T, 2);
      if (!eL && c === 'B' && isBld(tileAt(tx - 1, ty)) && regionOf(tx - 1, ty) !== regionOf(tx, ty)) R('#1a1822', x, y, 1, T);
    } else {
      R(pal.wall, x, y, T, T);
      R(darken(pal.wall, 0.55), x, y, T, 2);
      R(pal.base, x, y + 13, T, 3);
      if (c === 'M' || c === 'C') {
        const glass = c === 'M' ? '#d8f0ff' : '#e8fff4';
        R('#000', x, y + 3, T, 10); R(glass, x, y + 4, T, 8);
        g = e; R(glass, x, y + 4, T, 8); R('#000', x + 7, y + 4, 1, 8); R('rgba(255,255,255,0.6)', x + 1, y + 5, 2, 2); g = gMap();
        R('#000', x + 7, y + 4, 1, 8);
        if (c === 'M' && (tx === 9)) { R('#000', x + 1, y + 3, 14, 13); R('#bfe4f8', x + 2, y + 4, 5, 12); R('#bfe4f8', x + 9, y + 4, 5, 12); }
      } else if (c === 'H') {
        R('#000', x, y + 2, T, 14); R('#6b4423', x + (tx === 57 ? 1 : 0), y + 3, 15, 13);
        R('#5a381c', x + (tx === 57 ? 3 : 2), y + 5, 11, 4); R('#5a381c', x + (tx === 57 ? 3 : 2), y + 10, 11, 4);
        R('#ffd84a', tx === 57 ? x + 13 : x + 2, y + 9, 1, 2);
      } else {
        let lit = false;
        for (const wx of [2, 9]) {
          const on = c !== 'O' && rnd() < 0.5;
          R('#000', x + wx - 1, y + 3, 7, 8); R(on ? '#ffcf6a' : '#1a2034', x + wx, y + 4, 5, 6);
          if (on) { lit = true; g = e; R('#ffcf6a', x + wx, y + 4, 5, 6); R('#fff0b0', x + wx, y + 4, 2, 2); R('#000', x + wx + 2, y + 4, 1, 6); g = gMap(); }
          R('#000', x + wx + 2, y + 4, 1, 6);
        }
        if (lit) LIGHTS.push({ x: x + 8, y: y + 20, r: 15 });
      }
      R('#000', x, y + 15, T, 1);
    }
    if (eL) R('#000', x, y, 1, T);
    if (eR) R('#000', x + 15, y, 1, T);
    if (eU) R('#000', x, y, T, 1);
  }
  const gMap = () => mapCv.getContext('2d');

  function paintProp(p, e) {
    const { x, y, w, h } = p;
    switch (p.k) {
      case 'bench':
        R('rgba(0,0,0,0.3)', x, y + h, w, 2);
        R('#000', x - 1, y - 1, w + 2, h + 2);
        for (let k = 0; k < h; k += 2) R(k & 2 ? '#6e4526' : '#8a5a32', x, y + k, w, 2);
        R('#2a2a30', x + 2, y, 2, h); R('#2a2a30', x + w - 4, y, 2, h);
        break;
      case 'bins':
        for (let k = 0; k < 2; k++) { const cy = y + 5 + k * 13; pc(x + 4, cy, 5, '#000'); pc(x + 4, cy, 4, '#3d5a4a'); pc(x + 3, cy - 1, 2, '#5a806a'); }
        R('#e8e0c8', x + 10, y + 18, 3, 2); R('#c84a3a', x + 11, y + 6, 2, 2);
        break;
      case 'vend':
        R('#000', x - 1, y - 1, w + 2, h + 2); R('#c8323a', x, y, w, h); R('#e85058', x, y, w, 1);
        g = e; R('#e8f6ff', x + 1, y + h - 3, w - 2, 2); R('#ffd84a', x + 2, y + 2, 2, 2); R('#7dff8a', x + 6, y + 2, 2, 2); R('#e8f6ff', x + 10, y + 2, 2, 2); g = gMap();
        break;
      case 'slide':
        R('#000', x - 1, y - 1, w + 2, h + 2); R('#d8473a', x, y, w, h); R('#f06a5a', x + 2, y + 6, w - 4, h - 7);
        R('#888ea0', x, y, w, 5); for (let k = 0; k < 5; k += 2) R('#000', x, y + k, w, 1);
        break;
      case 'swing':
        R('#000', x - 1, y - 1, w + 2, h + 2); R('#5a6a8a', x, y, w, h); R('#7a8aaa', x, y, w, 1);
        R('#000', x + 6, y + h, 6, 4); R('#d8b03a', x + 7, y + h, 4, 3);
        R('#000', x + 20, y + h, 6, 4); R('#d8b03a', x + 21, y + h, 4, 3);
        break;
      case 'hydrant':
        pc(x + 3, y + 3, 3, '#000'); pc(x + 3, y + 3, 2, '#c8323a'); R('#f07070', x + 2, y + 2, 1, 1);
        break;
      case 'plant':
        R('#000', x - 1, y - 1, w + 2, h + 2); R('#a0603a', x, y, w, h); pc(x + 4, y + 2, 3, '#2f6a32'); R('#4a9a4a', x + 2, y, 2, 2);
        break;
      case 'pcar':
        R('rgba(0,0,0,0.3)', x + 1, y + 2, w, h);
        car(x + w / 2, y + h / 2, false, y > 500 ? -1 : 1, p.col, 0);
        break;
      case 'lamp': {
        const cx = x + 2, cy = y + 2;
        pc(cx, cy, 3, '#000'); pc(cx, cy, 2, '#3a3a44');
        g = e; R('#fff2b8', cx - 1, cy - 1, 3, 3); R('#ffffff', cx, cy, 1, 1); g = gMap();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // cart sprite (hero pushing from behind, seen from above) — 16 pre-rotated frames per colour
  // ---------------------------------------------------------------------------
  const CART_ROWS = [
    '..kkkkkkkkkkk..',
    '.kwwwwwwwwwwwk.',
    'ekwdwdwdwdwdwke',
    'ekwwwwwwwwwwwke',
    '.kwdwdwdwdwdwk.',
    '.kwwwwwwwwwwwk.',
    '.kwdwdwdwdwdwk.',
    '.kwwwwwwwwwwwk.',
    '.kwdwdwdwdwdwk.',
    '.kwwwwwwwwwwwk.',
    'ekwdwdwdwdwdwke',
    'ekwwwwwwwwwwwke',
    '..kwwwwwwwwwk..',
    '.kkkkkkkkkkkkk.',
    'kccscccccccscck',
    '..ksk.....ksk..',
    '..ksk.kkk.ksk..',
    '..kskkhhhkksk..',
    '..ktkhlhhhktk..',
    '.kttthhhhhtttk.',
    '.ktttkhhhktttk.',
    '.kttttkkkttttk.',
    '..ktttttttttk..',
    '...kkkkkkkkk...',
  ];
  const NROT = 16, RS = 30, COX = 7.5, COY = 12;
  const PILE = [[-2.5, -8], [2.5, -8], [0, -4], [-2.5, -3], [2.5, -3], [0, -9.5], [-3, -5.5], [3, -5.5], [0, -1.5], [-1, -7], [1, -2], [0, -6]];
  const rotCache = {};
  function cartSprites(col) {
    if (rotCache[col]) return rotCache[col];
    const pal = { k: '#000', w: '#b9bec8', d: '#4d5360', e: '#26262c', c: col, s: '#f1c9a0', t: '#7d8592', h: '#3b2a20', l: '#5a4232' };
    const sw = CART_ROWS[0].length, sh = CART_ROWS.length, arr = [];
    for (let i = 0; i < NROT; i++) {
      const th = i * TAU / NROT, cs = Math.cos(th), sn = Math.sin(th);
      const cv = mk(RS, RS), q = cv.getContext('2d');
      for (let y = 0; y < RS; y++) for (let x = 0; x < RS; x++) {
        const rx = x + 0.5 - RS / 2, ry = y + 0.5 - RS / 2;
        const sx = Math.floor(rx * cs + ry * sn + COX), sy = Math.floor(-rx * sn + ry * cs + COY);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const c2 = pal[CART_ROWS[sy][sx]];
        if (c2) { q.fillStyle = c2; q.fillRect(x, y, 1, 1); }
      }
      arr.push(cv);
    }
    return (rotCache[col] = arr);
  }

  // ---------------------------------------------------------------------------
  // DOM / input
  // ---------------------------------------------------------------------------
  let el = null, ctx = null, darkCv = null, dg = null;
  let active = false, raf = 0, last = -1, opts = {}, sprites = null, S = null;
  const keys = { l: false, r: false, u: false, d: false };
  const touch = { on: false, id: -1, sx: 0, sy: 0, lastTap: 0 };
  let dashReq = false, enterReq = false;

  function ensureDom() {
    if (el) return;
    if (!document.getElementById('stage3-css')) {
      const st = document.createElement('style');
      st.id = 'stage3-css';
      st.textContent = '#stage3{background:#000;padding:0;z-index:5;overflow:hidden}' +
        '#stage3 canvas{position:absolute;inset:0;width:100%;height:100%;display:block;' +
        'image-rendering:crisp-edges;image-rendering:pixelated;touch-action:none}';
      document.head.appendChild(st);
    }
    const wrap = document.getElementById('wrap') || document.body;
    const root = document.createElement('div');
    root.id = 'stage3'; root.className = 'ov';
    const cv = mk(W, H);
    root.appendChild(cv); wrap.appendChild(root);
    el = { root, cv };
    ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    darkCv = mk(W, H); dg = darkCv.getContext('2d');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', () => { keys.l = keys.r = keys.u = keys.d = false; touch.on = false; });
    cv.addEventListener('pointerdown', onPDown);
    cv.addEventListener('pointermove', (e) => { if (touch.on && e.pointerId === touch.id) { const p = toCanvas(e); touch.sx = p.x; touch.sy = p.y; } });
    const up = (e) => { if (e.pointerId === touch.id) touch.on = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function toCanvas(e) {
    const r = el.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / (r.width || 1) * W, y: (e.clientY - r.top) / (r.height || 1) * H };
  }
  function onPDown(e) {
    if (!active) return;
    e.preventDefault();
    const p = toCanvas(e);
    if (p.y < HUD_H && p.x > W - 14) { quit(); return; }
    if (S.st === 'fail' || S.st === 'clear') { enterReq = true; return; }
    const now = performance.now();
    if (now - touch.lastTap < 280) dashReq = true;
    touch.lastTap = now;
    touch.on = true; touch.id = e.pointerId; touch.sx = p.x; touch.sy = p.y;
    try { el.cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onKey(e) {
    if (!active) return;
    const down = e.type === 'keydown', k = e.key, code = e.code;
    let used = true;
    if (code === 'ArrowLeft' || code === 'KeyA' || k === 'ArrowLeft') keys.l = down;
    else if (code === 'ArrowRight' || code === 'KeyD' || k === 'ArrowRight') keys.r = down;
    else if (code === 'ArrowUp' || code === 'KeyW' || k === 'ArrowUp') keys.u = down;
    else if (code === 'ArrowDown' || code === 'KeyS' || k === 'ArrowDown') keys.d = down;
    else if (code === 'Space' || k === ' ') { if (down && !e.repeat) dashReq = true; }
    else if (code === 'Enter' || code === 'NumpadEnter' || k === 'Enter') { if (down && !e.repeat) enterReq = true; }
    else if (code === 'Escape' || k === 'Escape') { if (down) quit(); }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  const beep = (k) => { try { if (opts.beep) opts.beep(k); } catch (err) { /* ignore */ } };

  // ---------------------------------------------------------------------------
  // run state
  // ---------------------------------------------------------------------------
  const CAR_COLS = ['#d8d8dc', '#b8323a', '#3a5ab8', '#3a3a44', '#e0b040', '#4a8a5a', '#8a5aa8', '#c8c0a8'];
  const SHIRTS = ['#3cb84a', '#e0603a', '#f2c82c', '#5a8ae8'];

  function reset() {
    const rnd = PK.U.rng((Math.random() * 1e9) | 0);
    const list = (opts.items && opts.items.length ? opts.items : DEFAULT_ITEMS).slice(0, SPOTS.length);
    S = {
      st: 'intro', t: 0, time: TIME_LIMIT, endT: 0, lastCd: -1,
      P: { x: START.x, y: START.y, vx: 0, vy: 0, a: Math.PI / 2, dashT: 0, dashCd: 0, stun: 0, inv: 0, slip: 0 },
      items: [], req: [], got: [], nReq: list.length, gotN: 0,
      cars: [], bikes: [], cat: null, fx: [], texts: [],
      toast: '', toastT: 0, warnT: 0, shake: 0, camX: 0, camY: 0, allT: -1,
    };
    list.forEach((fi, i) => {
      const it = { fi: fi | 0, x: SPOTS[i][0], y: SPOTS[i][1], req: true, got: false, held: false, ph: rnd() * 3 };
      S.items.push(it); S.req.push(it);
    });
    DECOY_POOL.filter((f) => list.indexOf(f) < 0).slice(0, DECOYS.length)
      .forEach((fi, i) => S.items.push({ fi, x: DECOYS[i][0], y: DECOYS[i][1], req: false, got: false, held: false, ph: rnd() * 3 }));
    // traffic: 2 cars per lane on the horizontal roads, 1 bike per lane on the vertical roads
    let ci = 0;
    HROADS.forEach(([a]) => {
      [[a * T + 12, -1], [a * T + 36, 1]].forEach(([ly, dir], li) => {
        for (let k = 0; k < 2; k++) {
          const v0 = 56 + rnd() * 20;
          S.cars.push({ x: k * (MW / 2) + li * 170 + rnd() * 120, y: ly, dir, lane: ly, v0, v: v0, col: CAR_COLS[ci++ % CAR_COLS.length], honk: 0, horiz: true });
        }
      });
    });
    VROADS.forEach(([a], ri) => {
      [[a * T + 12, 1], [a * T + 36, -1]].forEach(([lx, dir], li) => {
        const v0 = 80 + rnd() * 20;
        S.bikes.push({ x: lx, y: (ri * 200 + li * 290 + rnd() * 80) % MH, dir, lane: lx, v0, v: v0, col: SHIRTS[(ri * 2 + li) % SHIRTS.length], honk: 0 });
      });
    });
    if (S.req[0]) S.cat = { x: CAT_HOME.x, y: CAT_HOME.y, st: 'idle', item: S.req[0], face: 1, moving: false, t: 0, bub: 0, say: '', sT: 0 };
    snapCam();
  }
  function snapCam() {
    S.camX = clamp(S.P.x - W / 2, 0, MW - W);
    S.camY = clamp(S.P.y - (H + HUD_H) / 2, -HUD_H, MH - H);
  }
  function toast(s, t) { S.toast = s; S.toastT = t || 1.8; }
  function ftext(x, y, s, col) { S.texts.push({ x, y, s, col, t: 0 }); }
  function burst(x, y, n, cols, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = (0.4 + Math.random() * 0.6) * (sp || 40);
      S.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, max: 0.35 + Math.random() * 0.3, col: cols[i % cols.length] });
    }
  }

  // ---------------------------------------------------------------------------
  // collision
  // ---------------------------------------------------------------------------
  function blocked(x, y, r, forCat) {
    const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r - 0.001) / T);
    const y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const c = tileAt(tx, ty);
      if (tSolid(c) || (forCat && isRoad(c))) return true;
    }
    for (let i = 0; i < RECTS.length; i++) {
      const q = RECTS[i];
      if (x + r > q.x && x - r < q.x + q.w && y + r > q.y && y - r < q.y + q.h) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  function update(dt) {
    S.t += dt;
    if (S.toastT > 0) S.toastT -= dt;
    if (S.warnT > 0) S.warnT -= dt;
    if (S.shake > 0) S.shake -= dt;
    for (let i = S.fx.length - 1; i >= 0; i--) { const f = S.fx[i]; f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.9; f.vy *= 0.9; if (f.t > f.max) S.fx.splice(i, 1); }
    for (let i = S.texts.length - 1; i >= 0; i--) { const f = S.texts[i]; f.t += dt; f.y -= 16 * dt; if (f.t > 1.1) S.texts.splice(i, 1); }
    const play = S.st === 'play';

    if (S.st === 'intro') {
      if (S.t >= INTRO_MSG) {
        const n = 3 - Math.floor((S.t - INTRO_MSG) / 0.7);
        if (n !== S.lastCd && n >= 1) { S.lastCd = n; beep(0); }
      }
      if (S.t >= INTRO_T) { S.st = 'play'; S.t = 0; beep(1); }
      enterReq = false; dashReq = false;
    } else if (play) {
      S.time -= dt;
      if (S.time <= 0) { S.time = 0; S.st = 'fail'; S.endT = 0; beep(0); }
      player(dt);
      catUpdate(dt);
      pickups();
      homeCheck();
      if (S.allT >= 0) S.allT += dt;
    } else {
      S.endT += dt;
      const P = S.P, k = Math.exp(-6 * dt); P.vx *= k; P.vy *= k;
      if (S.st === 'fail' && enterReq) { enterReq = false; reset(); return; }
      if (S.st === 'clear' && ((enterReq && S.endT > 0.3) || S.endT > 1.4)) { finish(); return; }
      enterReq = false;
    }
    traffic(dt, play);
    // camera
    const P = S.P;
    const tx = clamp(P.x + P.vx * 0.35 - W / 2, 0, MW - W), ty = clamp(P.y + P.vy * 0.35 - (H + HUD_H) / 2, -HUD_H, MH - H);
    const f = Math.min(1, dt * 5);
    S.camX += (tx - S.camX) * f; S.camY += (ty - S.camY) * f;
  }

  function player(dt) {
    const P = S.P;
    let ix = 0, iy = 0;
    if (keys.l) ix -= 1; if (keys.r) ix += 1; if (keys.u) iy -= 1; if (keys.d) iy += 1;
    if (touch.on) {
      const dx = touch.sx + S.camX - P.x, dy = touch.sy + S.camY - P.y, d = Math.hypot(dx, dy);
      if (d > 8) { ix = dx / d; iy = dy / d; }
    }
    let il = Math.hypot(ix, iy);
    if (il > 0) { ix /= il; iy /= il; }
    if (P.stun > 0) { P.stun -= dt; ix = iy = 0; il = 0; }
    P.inv -= dt; P.dashCd -= dt; P.slip -= dt; P.dashT -= dt;
    // puddles
    let sp = Math.hypot(P.vx, P.vy);
    for (const pd of PUDDLES) {
      const u = (P.x - pd.x) / pd.rx, v = (P.y - pd.y) / pd.ry;
      if (u * u + v * v < 1) {
        if (P.slip < 0.3 && sp > 30) { burst(P.x, P.y, 8, ['#8ab0e8', '#cfe0ff'], 50); ftext(P.x, P.y - 12, '미끌!', '#9ad0ff'); }
        P.slip = 0.75;
      }
    }
    const slip = P.slip > 0;
    const acc = ACC * (slip ? 0.22 : 1);
    P.vx += ix * acc * dt; P.vy += iy * acc * dt;
    const k = Math.exp(-(slip ? 0.5 : il > 0 ? 1.2 : 5.5) * dt);
    P.vx *= k; P.vy *= k;
    if (dashReq && P.dashCd <= 0 && P.stun <= 0) {
      const dx = il > 0 ? ix : Math.cos(P.a), dy = il > 0 ? iy : Math.sin(P.a);
      P.vx = dx * VDASH; P.vy = dy * VDASH; P.dashT = DASH_T; P.dashCd = DASH_CD;
      burst(P.x - dx * 10, P.y - dy * 10, 6, ['#cfcfd8', '#8a8a96'], 30);
    }
    dashReq = false;
    const c = tileAtPx(P.x, P.y);
    const vmax = P.dashT > 0 ? VDASH : (c === 'g' || c === 's') ? VSLOW : VMAX;
    sp = Math.hypot(P.vx, P.vy);
    if (sp > vmax) { const ns = Math.max(vmax, sp - 260 * dt); P.vx *= ns / sp; P.vy *= ns / sp; sp = ns; }
    const n = Math.max(1, Math.ceil(sp * dt / 3));
    for (let i = 0; i < n; i++) {
      const nx = P.x + P.vx * dt / n;
      if (blocked(nx, P.y, PR)) { if (Math.abs(P.vx) > 70) S.shake = 0.1; P.vx *= -0.3; } else P.x = nx;
      const ny = P.y + P.vy * dt / n;
      if (blocked(P.x, ny, PR)) { if (Math.abs(P.vy) > 70) S.shake = 0.1; P.vy *= -0.3; } else P.y = ny;
    }
    if (sp > 12 && P.stun <= 0) P.a += angDiff(P.a, Math.atan2(P.vy, P.vx)) * Math.min(1, dt * 12);
  }

  function hitBy(v, pen, horiz, isBike) {
    const P = S.P;
    const side = horiz ? (P.y >= v.y ? 1 : -1) : (P.x >= v.x ? 1 : -1);
    if (horiz) { P.vx = v.dir * 90; P.vy = side * 200; } else { P.vx = side * 200; P.vy = v.dir * 90; }
    P.stun = 0.45; P.inv = 1.6; P.dashT = 0;
    S.time = Math.max(0, S.time - pen);
    S.shake = 0.3;
    ftext(P.x, P.y - 14, '-' + pen + '초', '#ff6a5a');
    toast(isBike ? '자전거랑 부딪혔다! 조심!' : '쾅! 차 조심해야지!', 1.4);
    burst(P.x, P.y, 10, ['#ffd84a', '#ffffff', '#ff8a5a'], 60);
    beep(0);
  }

  function traffic(dt, live) {
    const P = S.P;
    const run = (list, horiz, pen, crossTile, len) => {
      for (const v of list) {
        let want = v.v0;
        for (const o of list) if (o !== v && o.lane === v.lane) {
          const d = (horiz ? o.x - v.x : o.y - v.y) * v.dir;
          if (d > 0 && d < len + 14) want = Math.min(want, d < len + 6 ? 0 : o.v);
        }
        if (live) {
          const ahead = (horiz ? P.x - v.x : P.y - v.y) * v.dir, off = Math.abs(horiz ? P.y - v.y : P.x - v.x);
          if (ahead > 0 && ahead < 72 && off < 15) {
            if (tileAtPx(P.x, P.y) === crossTile || ahead < 6) want = ahead < 46 ? 0 : Math.min(want, v.v0 * 0.35);
            else if (v.honk <= 0 && ahead < 60) { v.honk = 1.6; ftext(v.x, v.y - 12, horiz ? '빵빵!' : '따릉!', '#ffe08a'); }
          }
        }
        v.honk -= dt;
        v.v += clamp(want - v.v, -170 * dt, 70 * dt);
        if (horiz) {
          v.x += v.dir * v.v * dt;
          if (v.dir > 0 && v.x > MW + 40) v.x = -40; else if (v.dir < 0 && v.x < -40) v.x = MW + 40;
        } else {
          v.y += v.dir * v.v * dt;
          if (v.dir > 0 && v.y > MH + 30) v.y = -30; else if (v.dir < 0 && v.y < -30) v.y = MH + 30;
        }
        if (!live) continue;
        const hx = horiz ? 13 : 4, hy = horiz ? 6 : 8;
        const ox = P.x - v.x, oy = P.y - v.y;
        const px = hx + PR - Math.abs(ox), py = hy + PR - Math.abs(oy);
        if (px > 1 && py > 1) {
          if (v.v > 18 && P.inv <= 0) hitBy(v, pen, horiz, !horiz);
          else {   // stopped vehicle: just push out
            let nx = P.x, ny = P.y;
            if (px < py) nx += (ox >= 0 ? 1 : -1) * px; else ny += (oy >= 0 ? 1 : -1) * py;
            if (!blocked(nx, ny, PR)) { P.x = nx; P.y = ny; }
          }
        }
      }
    };
    run(S.cars, true, PEN_CAR, 'z', 26);
    run(S.bikes, false, PEN_BIKE, 'y', 16);
  }

  function catMove(c, dx, dy, sp, dt) {
    const d = Math.hypot(dx, dy) || 1;
    const base = Math.atan2(dy / d, dx / d) + Math.sin(c.t * 3) * 0.25;
    for (const off of [0, 0.6, -0.6, 1.3, -1.3, 2.0, -2.0]) {
      const a = base + off, nx = c.x + Math.cos(a) * sp * dt, ny = c.y + Math.sin(a) * sp * dt;
      if (!blocked(nx, ny, 4, true)) { c.x = nx; c.y = ny; if (Math.abs(Math.cos(a)) > 0.2) c.face = Math.cos(a) > 0 ? 1 : -1; c.moving = true; return; }
    }
    c.moving = false;
  }
  function catSay(c, s) { c.say = s; c.sT = 1.2; }
  function catUpdate(dt) {
    const c = S.cat; if (!c) return;
    const P = S.P, it = c.item;
    c.t += dt; c.sT -= dt; c.moving = false;
    const dP = Math.hypot(P.x - c.x, P.y - c.y);
    if (c.st === 'idle') {
      if (!it.got && Math.hypot(P.x - it.x, P.y - it.y) < 200) { c.st = 'go'; catSay(c, '야옹?'); }
    } else if (c.st === 'go') {
      if (it.got) { c.st = 'calm'; catSay(c, '냐…'); return; }
      catMove(c, it.x - c.x, it.y - c.y, 60, dt);
      if (Math.hypot(it.x - c.x, it.y - c.y) < 6) {
        it.held = true; c.st = 'flee'; catSay(c, '냥!');
        toast('고양이가 ' + NAMES[it.fi] + josa(NAMES[it.fi], '을', '를') + ' 물고 달아났다! 쫓아가!', 2.2);
      }
    } else if (c.st === 'flee') {
      if (dP < PR + 7) {
        it.held = false; it.x = c.x; it.y = c.y;
        c.st = 'scared'; c.sT = 0; c.runT = 1.6; catSay(c, '캬악!');
        toast('되찾았다! 얼른 주워!', 1.4); beep(1);
      } else if (dP < 150) catMove(c, c.x - P.x, c.y - P.y, 66, dt);
    } else if (c.st === 'scared') {
      c.runT -= dt;
      if (c.runT > 0) catMove(c, c.x - P.x, c.y - P.y, 80, dt); else c.st = 'calm';
    }
    if (it.held) { it.x = c.x + c.face * 7; it.y = c.y - 1; }
  }

  function pickups() {
    const P = S.P;
    for (const it of S.items) {
      if (it.got || it.held || Math.hypot(P.x - it.x, P.y - it.y) > PICK_R) continue;
      it.got = true;
      const nm = NAMES[it.fi] || '음식';
      if (it.req) {
        S.got.push(it.fi); S.gotN++;
        burst(it.x, it.y, 12, ['#ffd84a', '#ffffff', '#7dff8a'], 55);
        ftext(it.x, it.y - 10, nm + '!', '#7dff8a');
        beep(1);
        if (S.gotN >= S.nReq) { S.allT = 0; toast('다 주웠다! 이제 집으로 가자!', 2.4); }
        else toast('장바구니 ' + S.gotN + '/' + S.nReq, 1.0);
      } else {
        S.time = Math.max(0, S.time - PEN_DECOY);
        burst(it.x, it.y, 6, ['#ff8a5a', '#ffffff'], 40);
        ftext(it.x, it.y - 10, '-' + PEN_DECOY + '초', '#ff6a5a');
        toast(nm + josa(nm, '은', '는') + ' 목록에 없어! 우리 거 아니야.', 1.6);
        beep(0);
      }
    }
  }

  function homeCheck() {
    const P = S.P, dx = P.x - DOOR.x, dy = P.y - DOOR.y;
    if (Math.abs(dx) < 18 && dy > 0 && dy < 16) {
      if (S.gotN >= S.nReq) {
        S.st = 'clear'; S.endT = 0; P.vx = P.vy = 0; beep(1);
        burst(DOOR.x, DOOR.y, 20, ['#ffd84a', '#ffffff', '#ffcf6a'], 70);
      } else if (S.warnT <= 0) { toast('아직 못 주운 음식이 있어!', 1.8); S.warnT = 2.5; beep(0); }
    }
  }

  function finish() {
    const res = { timeLeft: Math.round(S.time * 10) / 10, collected: S.gotN, total: S.nReq, items: S.got.slice() };
    const cb = opts.onClear;
    stop();
    setTimeout(() => { if (cb) cb(res); }, 0);
  }
  function quit() {
    const cb = opts.onQuit;
    stop();
    setTimeout(() => { if (cb) cb(); }, 0);
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------
  function blitLayer(cv, cx, cy) {
    const sx = Math.max(0, cx), sy = Math.max(0, cy);
    const w = Math.min(MW, cx + W) - sx, h = Math.min(MH, cy + H) - sy;
    if (w > 0 && h > 0) g.drawImage(cv, sx, sy, w, h, sx - cx, sy - cy, w, h);
  }
  function hole(x, y, r) {
    dg.beginPath(); dg.globalAlpha = 0.35; dg.arc(x, y, r, 0, TAU); dg.fill();
    dg.beginPath(); dg.globalAlpha = 0.5; dg.arc(x, y, r * 0.7, 0, TAU); dg.fill();
    dg.beginPath(); dg.globalAlpha = 0.75; dg.arc(x, y, r * 0.42, 0, TAU); dg.fill();
  }
  const nearestTarget = () => {
    const P = S.P;
    let best = null, bd = 1e9;
    for (const it of S.req) if (!it.got) { const d = Math.hypot(it.x - P.x, it.y - P.y); if (d < bd) { bd = d; best = it; } }
    return best ? { x: best.x, y: best.y, d: bd } : { x: DOOR.x, y: DOOR.y + 8, d: Math.hypot(DOOR.x - P.x, DOOR.y + 8 - P.y), home: true };
  };

  function render() {
    g = ctx;
    const shk = S.shake > 0 ? 2 : 0;
    const cx = Math.round(S.camX + (shk ? (Math.random() * 2 - 1) * shk : 0));
    const cy = Math.round(S.camY + (shk ? (Math.random() * 2 - 1) * shk : 0));
    const t = performance.now() / 1000;
    const P = S.P, all = S.gotN >= S.nReq;
    R('#0b0d1c', 0, 0, W, H);
    blitLayer(mapCv, cx, cy);
    // puddles
    for (const pd of PUDDLES) {
      const x = Math.round(pd.x - cx), y = Math.round(pd.y - cy);
      if (x < -12 || x > W + 12 || y < -8 || y > H + 8) continue;
      R('#1a2848', x - 8, y - 3, 17, 7); R('#1a2848', x - 9, y - 2, 19, 5);
      R('#2e4a78', x - 6, y - 2, 12, 4);
      R('#9ab8e8', x - 4 + Math.round(Math.sin(t * 2 + pd.x) * 2), y - 1, 3, 1);
    }
    // home door glow (before darkness so it lights the ground)
    if (all) { g.fillStyle = 'rgba(255,214,120,' + (0.18 + 0.08 * Math.sin(t * 4)).toFixed(2) + ')'; g.fillRect(DOOR.x - 22 - cx, DOOR.y - cy, 44, 18); }
    // ground items
    for (const it of S.items) {
      if (it.got || it.held) continue;
      const x = it.x - cx, y = it.y - cy;
      if (x < -16 || x > W + 16 || y < -16 || y > H + 16) continue;
      R('rgba(0,0,0,0.35)', Math.round(x - 6), Math.round(y + 5), 12, 3);
      food(it.fi, x, y - 1 + Math.sin(t * 3 + it.ph) * 1.2, 0.36);
    }
    // y-sorted entities
    const ents = [];
    for (const v of S.cars) ents.push({ y: v.y, f: () => car(v.x - cx, v.y - cy, true, v.dir, v.col, 0) });
    for (const b of S.bikes) ents.push({ y: b.y, f: () => bike(b.x - cx, b.y - cy, b.dir, b.col, 0) });
    if (S.cat) {
      const c = S.cat;
      ents.push({ y: c.y, f: () => {
        cat(c.x - cx, c.y - cy, c.face, c.moving, c.t);
        if (c.item.held) food(c.item.fi, c.item.x - cx, c.item.y - cy, 0.24);
      } });
    }
    ents.push({ y: P.y, f: drawPlayer.bind(null, cx, cy) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.f();

    // darkness with light holes
    dg.globalCompositeOperation = 'source-over'; dg.globalAlpha = 1;
    dg.clearRect(0, 0, W, H);
    dg.fillStyle = 'rgba(6,8,30,0.68)'; dg.fillRect(0, 0, W, H);
    dg.globalCompositeOperation = 'destination-out'; dg.fillStyle = '#000';
    for (const L of LIGHTS) {
      const x = L.x - cx, y = L.y - cy;
      if (x < -L.r || x > W + L.r || y < -L.r || y > H + L.r) continue;
      hole(x, y, L.lamp ? L.r + Math.sin(t * 7 + L.x) * 0.5 : L.r);
    }
    hole(P.x - cx, P.y - cy, 30);
    for (const v of S.cars) hole(v.x + v.dir * 26 - cx, v.y - cy, 18);
    for (const b of S.bikes) hole(b.x - cx, b.y + b.dir * 14 - cy, 9);
    if (all) hole(DOOR.x - cx, DOOR.y + 6 - cy, 46 + Math.sin(t * 4) * 3);
    dg.globalCompositeOperation = 'source-over'; dg.globalAlpha = 1;
    g.drawImage(darkCv, 0, 0);

    // emissive
    blitLayer(emitCv, cx, cy);
    for (const v of S.cars) car(v.x - cx, v.y - cy, true, v.dir, v.col, 1);
    for (const b of S.bikes) bike(b.x - cx, b.y - cy, b.dir, b.col, 1);
    drawHome(cx, cy, all, t);
    // item sparkles
    for (const it of S.items) {
      if (it.got || it.held) continue;
      const ph = (t * 0.8 + it.ph) % 1.6;
      if (ph > 0.35) continue;
      const x = Math.round(it.x - cx + 6), y = Math.round(it.y - cy - 7), s = ph < 0.17 ? 1 : 2;
      R('#fff6c0', x - s, y, s * 2 + 1, 1); R('#fff6c0', x, y - s, 1, s * 2 + 1); R('#ffffff', x, y, 1, 1);
    }
    // cat bubble
    if (S.cat && S.cat.sT > 0) {
      const c = S.cat, x = c.x - cx, y = c.y - cy - 14;
      g.font = 8 + FONT; const w = Math.ceil(g.measureText(c.say).width) + 6;
      R('#000', Math.round(x - w / 2) - 1, Math.round(y - 6), w + 2, 12); R('#fff', Math.round(x - w / 2), Math.round(y - 5), w, 10);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#d8382f'; g.fillText(c.say, Math.round(x), Math.round(y));
    }
    // fx
    for (const f of S.fx) R(f.col, Math.round(f.x - cx), Math.round(f.y - cy), 2, 2);
    for (const f of S.texts) { g.globalAlpha = clamp(1.4 - f.t * 1.3, 0, 1); text(f.s, f.x - cx, f.y - cy, f.col, 8); }
    g.globalAlpha = 1;
    // guide arrow
    if (S.st === 'play' || S.st === 'intro') {
      const tg = nearestTarget();
      if (tg.d > 34) {
        const a = Math.atan2(tg.y - P.y, tg.x - P.x), r = 22 + Math.sin(t * 6) * 2;
        const ax = P.x - cx + Math.cos(a) * r, ay = P.y - cy + Math.sin(a) * r;
        const tri = (s, col) => {
          g.fillStyle = col; g.beginPath();
          g.moveTo(ax + Math.cos(a) * 5 * s, ay + Math.sin(a) * 5 * s);
          g.lineTo(ax + Math.cos(a + 2.4) * 4 * s, ay + Math.sin(a + 2.4) * 4 * s);
          g.lineTo(ax + Math.cos(a - 2.4) * 4 * s, ay + Math.sin(a - 2.4) * 4 * s);
          g.closePath(); g.fill();
        };
        tri(1.5, '#000'); tri(1, tg.home ? '#7dff8a' : '#ffd84a');
      }
    }
    hud(t);
    overlays(t);
  }

  function drawPlayer(cx, cy) {
    const P = S.P;
    if (P.inv > 0 && (Math.floor(P.inv * 12) & 1)) return;
    const th = ((P.a + Math.PI / 2) % TAU + TAU) % TAU;
    const i = Math.round(th / (TAU / NROT)) % NROT, ta = i * TAU / NROT;
    const x = Math.round(P.x - cx), y = Math.round(P.y - cy);
    R('rgba(0,0,0,0.3)', x - 8, y + 6, 16, 4);
    g.drawImage(sprites[i], x - RS / 2, y - RS / 2);
    // groceries piling up in the basket
    const cs = Math.cos(ta), sn = Math.sin(ta);
    for (let k = 0; k < S.got.length; k++) {
      const o = PILE[k % PILE.length], lx = o[0], ly = o[1] - (k >= PILE.length ? 1 : 0);
      food(S.got[k], x + lx * cs - ly * sn, y + lx * sn + ly * cs, 0.22);
    }
    if (P.dashCd > 0 && S.st === 'play') {
      const f = 1 - P.dashCd / DASH_CD;
      R('#000', x - 7, y + 12, 14, 3); R('#5a6a9a', x - 6, y + 13, Math.round(12 * f), 1);
    }
  }

  function drawHome(cx, cy, all, t) {
    const x = 55 * T - cx, y = 22 * T - cy;
    if (x < -120 || x > W + 20 || y < -40 || y > H + 20) return;
    for (const wt of [55, 56, 59, 60]) {
      const wx = wt * T - cx;
      if (all) { R('#ffcf6a', wx + 2, y + 4, 5, 6); R('#ffcf6a', wx + 9, y + 4, 5, 6); R('#fff0b0', wx + 2, y + 4, 2, 2); R('#000', wx + 4, y + 4, 1, 6); R('#000', wx + 11, y + 4, 1, 6); }
      else { R('#000', wx + 1, y + 3, 7, 8); R('#1a2034', wx + 2, y + 4, 5, 6); R('#000', wx + 8, y + 3, 7, 8); R('#1a2034', wx + 9, y + 4, 5, 6); }
    }
    // 집 sign above the door
    const sx = DOOR.x - cx, sy = 21 * T + 3 - cy;
    const on = all && (Math.floor(t * 3) & 1);
    R('#000', sx - 10, sy - 1, 20, 12);
    R(all ? (on ? '#ffd84a' : '#ffe9a0') : '#5a4a38', sx - 9, sy, 18, 10);
    text('집', sx, sy + 5, all ? '#8a2a1a' : '#a8946e', 8);
    if (all) {
      const by = Math.round(sy - 10 + Math.sin(t * 5) * 2);
      R('#7dff8a', sx - 1, by, 3, 4); R('#7dff8a', sx - 3, by + 2, 7, 1); R('#7dff8a', sx - 2, by + 3, 5, 1); R('#7dff8a', sx, by + 4, 1, 1);
    }
  }

  function hud(t) {
    R('rgba(8,10,28,0.88)', 0, 0, W, HUD_H); R('#3a3f66', 0, HUD_H - 1, W, 1); R('#000', 0, HUD_H, W, 1);
    const n = S.nReq;
    text('장바구니', 4, 6, '#cfd6ff', 8, 'left');
    text(S.gotN + '/' + n, 4, 15, S.gotN >= n ? '#7dff8a' : '#ffd84a', 8, 'left');
    const x0 = 44, step = Math.min(19, (W - x0 - 62) / Math.max(1, n));
    S.req.forEach((it, i) => {
      const x = Math.round(x0 + step * i + 9), y = 10;
      R('#000', x - 9, 1, 18, 18);
      R(it.got ? '#1d3a26' : it.held ? ((Math.floor(t * 4) & 1) ? '#7a2a2a' : '#4a1d1d') : '#232845', x - 8, 2, 16, 16);
      g.globalAlpha = it.got ? 0.5 : 1; food(it.fi, x, y, 0.36); g.globalAlpha = 1;
      if (it.got) {
        R('#000', x + 1, y + 1, 9, 7);
        R('#5dff6a', x + 2, y + 4, 2, 2); R('#5dff6a', x + 4, y + 5, 2, 2); R('#5dff6a', x + 6, y + 3, 2, 2); R('#5dff6a', x + 8, y + 2, 1, 2);
      }
    });
    // timer
    const tl = Math.ceil(S.time), low = tl <= 15;
    const col = low ? ((Math.floor(t * 4) & 1) ? '#ff5040' : '#ffb0a0') : '#ffffff';
    const tx = W - 46;
    pc(tx, 10, 5, '#000'); pc(tx, 10, 4, low ? '#7a2a2a' : '#e8e8f0'); R('#000', tx, 7, 1, 4); R('#000', tx, 10, 3, 1);
    text(tl + '초', tx + 8, 10, col, 10, 'left');
    text('✕', W - 6, 9, '#8a90b8', 8);
  }

  function panel(title, col, lines) {
    const w = 196, h = 34 + lines.length * 12, x = ((W - w) / 2) | 0, y = (((H - h) / 2) | 0) + 8;
    R('#000', x - 2, y - 2, w + 4, h + 4); R('#2a1f3d', x, y, w, h); R('rgba(255,255,255,0.12)', x, y, w, 2); R('rgba(0,0,0,0.35)', x, y + h - 2, w, 2);
    text(title, W / 2, y + 15, col, 16);
    lines.forEach((l, i) => text(l[0], W / 2, y + 34 + i * 12, l[1] || '#e8e0ff', 8));
  }

  function overlays(t) {
    if (S.st === 'intro') {
      if (S.t < INTRO_MSG) {
        R('rgba(0,0,0,0.6)', 0, 64, W, 54); R('#ffd84a', 0, 64, W, 1); R('#ffd84a', 0, 117, W, 1);
        text('떨어뜨린 음식을 주워 담아라!', W / 2, 78, '#ffd84a', 12);
        text('목록의 음식을 모두 담고 집으로 가자', W / 2, 95, '#ffffff', 8);
        text('방향키/WASD 이동 · SPACE 대시 · 건널목에선 차가 멈춰요', W / 2, 108, '#a8b0d8', 8);
      } else {
        const n = 3 - Math.floor((S.t - INTRO_MSG) / 0.7), f = ((S.t - INTRO_MSG) % 0.7) / 0.7;
        text(String(Math.max(1, n)), W / 2, 92, '#ffffff', Math.round(32 - f * 8));
      }
    } else if (S.st === 'play' && S.t < 0.7) {
      text('시작!', W / 2, 92, '#ffd84a', 24);
    }
    if (S.toastT > 0 && S.st === 'play') {
      g.font = 8 + FONT;
      const w = Math.ceil(g.measureText(S.toast).width) + 12, x = ((W - w) / 2) | 0;
      R('#000', x - 1, 159, w + 2, 15); R('rgba(30,24,52,0.92)', x, 160, w, 13);
      text(S.toast, W / 2, 167, '#ffffff', 8);
    }
    if (S.st === 'fail') {
      panel('시간 초과!', '#ff6a5a', [
        ['장바구니 ' + S.gotN + '/' + S.nReq + ' — 아직 길에 음식이 남았어…'],
        ['Enter: 다시 하기    Esc: 나가기', '#ffd84a'],
      ]);
    } else if (S.st === 'clear') {
      panel('집 도착!', '#7dff8a', [
        ['장바구니 ' + S.gotN + '/' + S.nReq + ' · 남은 시간 ' + Math.ceil(S.time) + '초'],
        ['오늘 저녁은 목살 파티다!', '#ffd84a'],
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // loop + API
  // ---------------------------------------------------------------------------
  function frame(now) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    const dt = last < 0 ? 0 : clamp((now - last) / 1000, 0, 0.05);
    last = now;
    update(dt);
    if (!active) return;
    render();
  }

  function start(o) {
    if (active) stop();
    opts = o || {};
    ensureDom();
    buildMap();
    if (!mapCv) paintMap();
    const defs = PK.Karts && PK.Karts.DEFS, d = defs && defs[opts.def | 0];
    sprites = cartSprites((d && d.color) || '#e03a3a');
    keys.l = keys.r = keys.u = keys.d = false; touch.on = false; dashReq = enterReq = false;
    reset();
    active = true;
    el.root.classList.add('on');
    last = -1;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; active = false;
    keys.l = keys.r = keys.u = keys.d = false; touch.on = false;
    if (el) el.root.classList.remove('on');
  }

  PK.Stage3 = {
    start, stop,
    get active() { return active; },
    // test hooks
    _state: () => S,
    _map: () => { buildMap(); return { grid, RECTS, SPOTS, DECOYS, DOOR, START, MW, MH, T, PR, blocked, tileAtPx, PUDDLES, LIGHTS }; },
  };
})(window.PK);
