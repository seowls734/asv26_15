// map.js — PK.Track: the race tracks. Five closed circuits (PK.Track.MAPS), each with its own
// centreline, floor texture, boost pads, hazards, billboard props, background wall and minimap.
//   PK.Track.load(id)   build (first time, then cached) and switch to map id (0..4)
//   PK.Track.init()     = load(0) (compatibility)
//   PK.Track.current    id of the loaded map; PK.Track.def = its definition
//   PK.Track.gripAt(x,y) grip multiplier for the kart physics (ice patches / icy floor)
//   PK.Track.fx         screen overlay style main.js draws: 'none' | 'frost' | 'dusk' | 'haunted'
window.PK = window.PK || {};
(function (PK) {
  'use strict';

  const SPACING = 6;                  // centerline resample spacing (units)
  const TS = 64;                      // outside-floor tile period (TS x TS lookup)
  const ICE_GRIP = 0.3;               // grip multiplier on an ice patch

  // ---------------------------------------------------------------- small helpers
  const rgbHex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pack = (c) => PK.U.rgb(Math.round(c[0]) & 255 | 0, Math.round(c[1]) & 255 | 0, Math.round(c[2]) & 255 | 0);
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const hash = (x, y) => (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0);

  // 3x5 bitmap glyphs (used for sprite signs and the background wall)
  const FONT = {
    S: ['111', '100', '111', '001', '111'], A: ['010', '101', '111', '101', '101'],
    L: ['100', '100', '100', '100', '111'], E: ['111', '100', '110', '100', '111'],
    B: ['110', '101', '110', '101', '110'], O: ['111', '101', '101', '101', '111'],
    I: ['111', '010', '010', '010', '111'], C: ['111', '100', '100', '100', '111'],
    P: ['110', '101', '110', '100', '100'], R: ['110', '101', '110', '101', '101'],
    H: ['101', '101', '111', '101', '101'], F: ['111', '100', '110', '100', '100'],
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
    '%': ['101', '001', '010', '100', '101'], '+': ['000', '010', '111', '010', '000'],
    '-': ['000', '000', '111', '000', '000'], ' ': ['000', '000', '000', '000', '000'],
    T: ['111', '010', '010', '010', '010'], M: ['101', '111', '111', '101', '101'],
    K: ['101', '101', '110', '101', '101'], D: ['110', '101', '101', '101', '110'],
    N: ['111', '101', '101', '101', '101'], U: ['101', '101', '101', '101', '111'],
    G: ['111', '100', '101', '101', '111'], W: ['101', '101', '111', '111', '101'],
    Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
    '!': ['010', '010', '010', '000', '010'], '>': ['100', '010', '001', '010', '100'],
    '<': ['001', '010', '100', '010', '001'], X: ['101', '101', '010', '101', '101'],
    V: ['101', '101', '101', '101', '010'], Q: ['111', '101', '101', '111', '001']
  };
  const textW = (s, sc) => (s.length * 4 - 1) * (sc || 1);

  // ---------------------------------------------------------------- floor tiles (TS x TS)
  // Each builder returns a TS*TS Uint32Array; it fills the texture and sampleOutside(), so the
  // floor is seamless past the texture edge.
  function makeTile(fn) {
    const t = new Uint32Array(TS * TS);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) t[y * TS + x] = pack(fn(x, y));
    return t;
  }
  // supermarket: 16-unit cream / warm-grey checker with grout (period 32)
  function martColor(X, Y) {
    const x = X & 31, y = Y & 31;
    const cream = [224, 214, 194], grey = [192, 185, 172], grout = [158, 150, 137];
    const gx = x & 15, gy = y & 15;
    if (gx === 0 || gy === 0) return grout;
    const c = (((x >> 4) + (y >> 4)) & 1) ? grey : cream;
    let f = 0;
    if (gx === 1 || gy === 1) f += 8;          // bevel highlight
    if (gx === 15 || gy === 15) f -= 7;        // bevel shadow
    const h = (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 27); // 0..31 speckle
    f += h < 3 ? -6 : h > 29 ? 4 : 0;
    return [clamp255(c[0] + f), clamp255(c[1] + f), clamp255(c[2] + f)];
  }
  // polished store floor (period 64): per-tile tone variation, a diagonal ceiling-light reflection
  // sheen, rare scuff marks and a few worn tiles
  const tileMart = () => makeTile((x, y) => {
    let c = martColor(x, y);
    const gx = x & 15, gy = y & 15;
    if (gx === 0 || gy === 0) return c;
    const cell = hash(x >> 4, (y >> 4) + 17) >>> 28;                       // 0..15 per tile
    let f = cell < 3 ? -5 : cell > 12 ? 4 : 0;
    const d = (x + y) & 63;                                               // reflection streaks
    if (d < 4) f += 14 - d * 3; else if (d > 26 && d < 29) f += 7;
    if (cell === 7 && ((x * 3 + y) % 11 === 0)) f -= 14;                  // worn tile
    if (((hash(x >> 1, y) >>> 26) === 0) && gy > 3 && gy < 13) f -= 16;   // black scuff
    return [clamp255(c[0] + f), clamp255(c[1] + f), clamp255(c[2] + f * 1.1)];
  });
  // freezer aisle: big frosty white / pale-blue tiles, frost speckles and scratches
  const tileIce = () => makeTile((x, y) => {
    const gx = x & 31, gy = y & 31;
    if (gx === 0 || gy === 0) return [150, 184, 206];
    let c = (((x >> 5) + (y >> 5)) & 1) ? [206, 226, 240] : [230, 241, 248];
    const h = hash(x, y) >>> 26;   // 0..63
    let f = 0;
    if (gx === 1 || gy === 1) f += 10;
    if (gx === 31 || gy === 31) f -= 8;
    if (h < 3) f += 14; else if (h > 60) f -= 10;
    if (((x + y * 3) % 23) === 0 && (h & 1)) f += 9;  // faint frost streaks
    const d = (x - y + 64) & 63;
    if (d < 3) f += 8;                                 // glassy sheen
    if (((x * 5 + y * 7) % 61) === 0) return [196, 214, 230];   // hairline cracks
    if ((hash(x * 7, y * 13) >>> 25) === 0) return [255, 255, 255]; // frost sparkle
    if (gx > 3 && gx < 12 && gy > 3 && gy < 12 && ((x >> 5) + (y >> 5) & 1) && ((gx + gy) & 7) === 0) f += 6; // crystal flakes
    return [clamp255(c[0] + f), clamp255(c[1] + f), clamp255(c[2] + f * 0.6)];
  });
  // produce market: honey wooden planks (8 high, 64 long, staggered seams, grain)
  const tileWood = () => makeTile((x, y) => {
    const row = y >> 3, gy = y & 7;
    const cols = [[200, 154, 98], [189, 143, 88], [210, 165, 108], [184, 134, 80]];
    const off = (row * 24) & 63, px = (x + off) & 63;
    let c = cols[(row + ((x + off) >> 6)) & 3];
    if (gy === 0) return [122, 85, 48];
    if (px === 0) return [134, 94, 54];
    let f = 0;
    if (gy === 1) f += 10;
    if (gy === 7) f -= 12;
    const g = hash(x >> 2, y) >>> 28;   // streaky grain
    if (g < 3) f -= 12; else if (g > 13) f += 6;
    if (((hash(x, y) >>> 27) === 0)) f -= 18; // knots
    if ((px === 2 || px === 61) && (gy === 3 || gy === 4)) return [92, 80, 70];   // nail heads
    if ((px === 3 || px === 62) && gy === 3) return [170, 160, 146];
    if (((row * 7 + ((x + off) >> 6)) % 5) === 0) f -= 9;                         // the odd darker plank
    if (gy === 2 && ((px >> 3) & 1)) f += 4;                                      // varnish shine
    c = [clamp255(c[0] + f), clamp255(c[1] + f * 0.9), clamp255(c[2] + f * 0.8)];
    return c;
  });
  // rooftop car park: dusky asphalt with painted parking bays
  const tileAsphalt = () => makeTile((x, y) => {
    const h = hash(x, y) >>> 27;
    let v = 76 + (h < 4 ? -10 : h > 28 ? 9 : (h & 3) * 2 - 3);
    const bx = x & 31;
    if ((bx === 0 || bx === 1) && y > 6 && y < 54) return [228, 214, 196];          // bay lines
    if (y >= 54 && y < 56 && (bx < 2 || bx > 29)) return [228, 214, 196];          // bay ends
    if (((x * 5 + y * 3) % 41) === 0) v -= 6;                                        // cracks
    const ox = x - 20, oy = y - 30;                                                  // oil stain in a bay
    if (ox * ox + oy * oy * 2 < 60) v -= 10 + ((hash(x, y) >>> 30) * 2);
    if ((hash(x * 3, y * 5) >>> 26) === 0) v += 22;                                   // light gravel
    if (y >= 58 && y < 60 && bx > 8 && bx < 24) return [214, 176, 40];                // yellow wheel-stop
    return [v + 4, v - 2, v + 6];
  });
  // ghost graveyard: moonlit night grass (blue-green), darker blade tufts, bare dirt patches,
  // the odd pale pebble / bone fleck. Already night-coloured (map 4 skips the haunted recolour).
  const tileGrave = () => makeTile((x, y) => {
    const h = hash(x, y) >>> 26, h2 = hash(x >> 3, y >> 3) >>> 28;     // fine + coarse noise
    let c = (h2 & 1) ? [62, 98, 88] : [68, 106, 92];
    if (h2 === 3 || h2 === 11) c = [74, 112, 96];                       // lighter clumps
    if (((x * 7 + y * 3) & 15) === 0 || h < 6) c = mix(c, [34, 60, 56], 0.6);  // blade shadows
    else if (h > 58) c = mix(c, [110, 146, 120], 0.5);                  // blade tips catching moonlight
    if ((hash(x * 5, y * 11) >>> 24) === 0) c = [176, 178, 168];        // pebble / bone fleck
    return c;
  });

  // glitch world: black void with a cyan wireframe grid (period 16), some cells dropped out,
  // magenta sub-grid, dead/stuck pixels
  const tileGlitch = () => makeTile((x, y) => {
    const gx = x & 15, gy = y & 15, cell = hash((x >> 4) + 5, (y >> 4) + 9) >>> 28;
    const h = hash(x, y) >>> 24;
    let c = cell === 3 ? [6, 4, 10] : [14, 10, 24];
    if (cell === 9) c = [28, 6, 34];                                        // corrupted cell
    if (cell !== 3) {
      if (gx === 0 || gy === 0) c = cell === 12 ? [180, 40, 200] : [40, 200, 220];   // wireframe
      else if (gx === 8 || gy === 8) c = mix(c, [120, 30, 150], 0.35);
      if (gx === 0 && gy === 0) c = [230, 255, 255];
    }
    if (h === 0) c = [60, 255, 120]; else if (h === 1) c = [255, 40, 200]; else if (h === 2) c = [255, 255, 255];
    return c;
  });

  // hedge maze garden centre: freshly mown lawn with light/dark mowing stripes, clover, daisies
  const lawnColor = (x, y) => {
    const h = hash(x, y) >>> 26, band = ((x + (y >> 1)) >> 4) & 1;
    let c = band ? [104, 168, 74] : [92, 154, 64];
    if (h < 5) c = mix(c, [56, 110, 44], 0.55); else if (h > 59) c = mix(c, [150, 206, 110], 0.45);
    if (((x * 5 + y * 3) & 31) === 0) c = mix(c, [70, 128, 52], 0.5);
    if ((hash(x * 3, y * 7) >>> 23) === 0) c = [246, 244, 230];                 // daisy
    else if ((hash(x * 11, y * 5) >>> 23) === 0) c = [248, 214, 72];            // buttercup
    return c;
  };
  const tileLawn = () => makeTile(lawnColor);
  // top of a clipped hedge seen from above: dense dark leaves, lighter sunlit clumps, shadowy gaps
  const hedgeTop = (x, y) => {
    const h = hash(x, y) >>> 26, h2 = hash((x >> 2) + 7, (y >> 2) + 3) >>> 28;
    let c = h2 < 5 ? [34, 84, 36] : h2 > 11 ? [62, 124, 52] : [46, 102, 42];
    if (h < 8) c = mix(c, [18, 48, 22], 0.6); else if (h > 57) c = mix(c, [120, 180, 90], 0.5);
    if ((hash(x * 13, y * 3) >>> 24) === 0) c = [220, 120, 170];                 // a few blossoms
    return c;
  };
  // TS x TS Uint32 tile -> canvas (for createPattern)
  function tileCanvas(t) {
    const tc = document.createElement('canvas');
    tc.width = TS; tc.height = TS;
    const tg = tc.getContext('2d'), im = tg.createImageData(TS, TS);
    new Uint32Array(im.data.buffer).set(t);
    tg.putImageData(im, 0, 0);
    return tc;
  }

  // ---------------------------------------------------------------- spline
  // Closed centripetal Catmull-Rom through ctrl, resampled to uniform arc-length spacing.
  function buildCenterline(P) {
    const M = P.length, dense = [];
    const SUB = 120;
    for (let s = 0; s < M; s++) {
      const p0 = P[(s - 1 + M) % M], p1 = P[s], p2 = P[(s + 1) % M], p3 = P[(s + 2) % M];
      const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
      const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
      const L = (pa, pb, ta, tb, t) => {
        const u = (t - ta) / (tb - ta);
        return [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u];
      };
      for (let k = 0; k < SUB; k++) {
        const t = t1 + (t2 - t1) * (k / SUB);
        const A1 = L(p0, p1, t0, t1, t), A2 = L(p1, p2, t1, t2, t), A3 = L(p2, p3, t2, t3, t);
        const B1 = L(A1, A2, t0, t2, t), B2 = L(A2, A3, t1, t3, t);
        dense.push(L(B1, B2, t1, t2, t));
      }
    }
    // cumulative arc length (closed)
    const D = dense.length, cum = new Float64Array(D + 1);
    for (let i = 0; i < D; i++) {
      const a = dense[i], b = dense[(i + 1) % D];
      cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const total = cum[D], N = Math.round(total / SPACING), step = total / N;
    const PTS = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * step;
      while (cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % D];
      const u = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      PTS.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    const TAN = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = PTS[(i - 1 + N) % N], b = PTS[(i + 1) % N];
      TAN[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    return { N, PTS, TAN, length: total };
  }

  // ---------------------------------------------------------------- pixel-art sprite helpers
  const PAL = {
    k: '#2a2622', K: '#4a443c', f: '#8e949a', F: '#c3c8cc', m: '#d9dde0', n: '#6f747a',
    w: '#ffffff', W: '#ecebe2', r: '#e04040', R: '#9e2424', o: '#f08a24', O: '#b05a10',
    y: '#f6d23a', Y: '#c09a18', g: '#4cb848', G: '#2a7a2a', b: '#3f78d8', B: '#25478f',
    c: '#5fd0e0', C: '#2f8a99', p: '#d860b0', P: '#8f3577', u: '#9a62d8', U: '#5c3590',
    t: '#a8743c', T: '#6e4720', l: '#e8c690', v: '#8fd06a', V: '#1f5a1f',
    e: '#e6eef3', E: '#9fb3c4', i: '#b8e2f4', I: '#6aa8cc', s: '#4a5560', z: '#6fe08a', h: '#c82828',
    a: '#3a3a44', A: '#22222a', x: '#ffe9a0', q: '#7a7f88', Q: '#a3a8b0'
  };
  const SHADE = { r: 'R', o: 'O', y: 'Y', g: 'G', b: 'B', c: 'C', p: 'P', u: 'U', W: 'E', t: 'T', s: 'a', e: 'E', q: 'n' };

  function Grid(w, h) {
    const a = [];
    for (let y = 0; y < h; y++) a.push(new Array(w).fill('.'));
    return {
      w, h,
      px(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) a[y][x] = c; },
      rect(x, y, rw, rh, c) { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) this.px(x + i, y + j, c); },
      ell(cx, cy, rx, ry, c) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            if (dx * dx + dy * dy <= 1) this.px(x, y, c);
          }
      },
      text(s, x, y, c) {
        for (const ch of s) {
          const gl = FONT[ch] || FONT[' '];
          for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gl[j][i] === '1') this.px(x + i, y + j, c);
          x += 4;
        }
      },
      sprite() { return PK.U.makeSprite(a.map((r) => r.join('')), PAL); }
    };
  }

  // Food display stand (32x40 px): one item from assets/food.png (16 cells of 48x48) on a striped table.
  // Canvases are made at build time and repainted when the sheet loads (drawImage only, so file:// works).
  const foodImg = new Image(), foodJobs = [];
  foodImg.onload = () => { for (const f of foodJobs) f(); };
  const FOOD_PRODUCE = [0, 1, 14, 15], FOOD_GROCERY = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  function makeFoodStand(i, cloth) {
    if (!foodImg.src) foodImg.src = 'assets/food.png';
    const c = document.createElement('canvas');
    c.width = 32; c.height = 40;
    const g = c.getContext('2d');
    const paint = () => {
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 40);
      g.fillStyle = '#000'; g.fillRect(1, 27, 30, 13);
      g.fillStyle = typeof cloth === 'string' ? cloth : '#d8382f'; g.fillRect(2, 28, 28, 5);  // cloth
      g.fillStyle = '#f2f2f2'; for (let x = 4; x < 30; x += 6) g.fillRect(x, 28, 3, 5);
      g.fillStyle = '#8a6a4a'; g.fillRect(2, 33, 28, 7);                       // table front
      g.fillStyle = '#6a4e34'; g.fillRect(2, 33, 28, 1);
      g.fillStyle = '#000'; g.fillRect(10, 34, 12, 5);                         // price tag
      g.fillStyle = '#ffe14d'; g.fillRect(11, 35, 10, 3);
      if (foodImg.complete && foodImg.naturalWidth) g.drawImage(foodImg, i * 48, 0, 48, 48, 1, -1, 30, 30);
    };
    paint();
    foodJobs.push(paint);
    return c;
  }

  // Grocery shelf (32x30 px). kind selects stock style.
  const SHELF_KINDS = [
    { hdr: 'b', cols: ['c', 'g', 'r', 'o', 'W'], shape: 'bottle', pw: [2, 3], ph: [5, 6] }, // drinks
    { hdr: 'o', cols: ['y', 'o', 'r', 'p', 'g'], shape: 'bag', pw: [3, 4], ph: [3, 5] },    // snacks
    { hdr: 'r', cols: ['r', 'y', 'b', 'g', 'u'], shape: 'box', pw: [3, 4], ph: [5, 6] },    // cereal
    { hdr: 'g', cols: ['b', 'c', 'W', 'u', 'p'], shape: 'bottle', pw: [2, 3], ph: [4, 6] }, // cleaning
    { hdr: 'y', cols: ['r', 'o', 'y', 'W'], shape: 'box', pw: [3, 4], ph: [3, 4] }          // ramen
  ];
  function makeShelf(kind, rnd) {
    const K = SHELF_KINDS[kind], g = Grid(32, 30);
    g.rect(0, 0, 32, 4, K.hdr); g.rect(0, 3, 32, 1, SHADE[K.hdr]);
    g.rect(3, 1, 9, 1, 'w'); g.rect(14, 1, 5, 1, 'w'); g.rect(21, 1, 8, 1, 'w');   // header "label"
    g.rect(2, 4, 28, 21, 'K');                                                      // dark back panel
    g.rect(0, 4, 2, 26, 'f'); g.rect(30, 4, 2, 26, 'f'); g.rect(1, 4, 1, 26, 'F');  // uprights
    const boards = [10, 17, 24];
    let top = 4;
    for (const bd of boards) {
      const bot = bd - 1, avail = bot - top + 1;
      let x = 2;
      while (x < 30) {
        let pw = K.pw[0] + Math.floor(rnd() * (K.pw[1] - K.pw[0] + 1));
        pw = Math.min(pw, 30 - x);
        if (rnd() < 0.07) { x += pw; continue; } // an empty gap on the shelf
        const ph = Math.min(avail, K.ph[0] + Math.floor(rnd() * (K.ph[1] - K.ph[0] + 1)));
        const c = K.cols[Math.floor(rnd() * K.cols.length)], cs = SHADE[c];
        if (K.shape === 'bottle') {
          const y0 = bot - ph + 3;
          g.rect(x, y0, pw, bot - y0 + 1, c);
          if (pw > 2) g.rect(x + pw - 1, y0, 1, bot - y0 + 1, cs);
          const nx = x + ((pw - 1) >> 1);
          g.px(nx, y0 - 1, c); g.px(nx, y0 - 2, 'w');
          g.px(x, y0 + 1, 'w');
        } else {
          const y0 = bot - ph + 1;
          g.rect(x, y0, pw, ph, c);
          g.rect(x + pw - 1, y0, 1, ph, cs);
          if (K.shape === 'bag') { g.px(x, y0, cs); g.px(x + pw - 1, y0, 'K'); } // crimped bag top
          if (pw >= 3 && ph >= 3) g.px(x + 1, y0 + 1, 'w');
        }
        x += pw;
      }
      g.rect(2, bd, 28, 1, 'm');
      for (let tx = 4; tx < 28; tx += 7) { g.px(tx, bd, 'y'); g.px(tx + 1, bd, 'y'); } // price tags
      top = bd + 1;
    }
    g.rect(0, 25, 32, 5, 'f'); g.rect(2, 26, 28, 3, 'n'); g.rect(0, 25, 32, 1, 'F'); // kick plate
    return g.sprite();
  }

  // Can pyramid on a pallet (18x22)
  function makeCans(c) {
    const g = Grid(18, 22), cs = SHADE[c];
    for (let lv = 0; lv < 4; lv++) {
      const n = 4 - lv, y = 15 - lv * 5;
      for (let k = 0; k < n; k++) {
        const x = 1 + lv * 2 + k * 4;
        g.rect(x, y, 4, 1, 'F');
        g.rect(x, y + 1, 4, 3, c); g.rect(x + 3, y + 1, 1, 3, cs);
        g.rect(x, y + 2, 3, 1, 'w');
        g.rect(x, y + 4, 4, 1, 'f');
      }
    }
    g.rect(0, 20, 18, 2, 't'); g.rect(1, 21, 2, 1, 'T'); g.rect(8, 21, 2, 1, 'T'); g.rect(15, 21, 2, 1, 'T');
    return g.sprite();
  }

  // Cardboard box pyramid (21x18) with brand stickers
  function makeBoxes(c) {
    const g = Grid(21, 18);
    for (let lv = 0; lv < 3; lv++) {
      const n = 3 - lv, y = 12 - lv * 6;
      for (let k = 0; k < n; k++) {
        const x = lv * 3 + k * 7;
        g.rect(x, y, 7, 6, 'l'); g.rect(x + 6, y, 1, 6, 't'); g.rect(x, y + 5, 7, 1, 't');
        g.rect(x + 3, y, 1, 2, 'T');            // tape
        g.rect(x + 1, y + 2, 3, 2, c); g.px(x + 2, y + 2, 'w');
      }
    }
    return g.sprite();
  }

  // Shopping cart (16x14); full = has groceries inside
  function makeCart(full) {
    const g = Grid(16, 14);
    g.rect(0, 0, 3, 1, 'h'); g.px(2, 1, 'f');                   // red handle
    for (let r = 0; r < 4; r++) {                                // tapered wire basket
      const x0 = 3 + (r >> 1), x1 = 15 - (r >> 1);
      g.rect(x0, 2 + r * 2, x1 - x0, 1, 'F');
      for (let x = x0; x < x1; x += 2) g.px(x, 3 + r * 2, 'f');
    }
    if (full) { g.rect(5, 1, 3, 2, 'g'); g.rect(8, 0, 2, 3, 'r'); g.rect(11, 1, 3, 2, 'y'); g.px(12, 0, 'o'); }
    g.rect(6, 10, 7, 1, 'f'); g.px(6, 11, 'f'); g.px(12, 11, 'f');
    g.rect(5, 12, 2, 2, 'k'); g.rect(11, 12, 2, 2, 'k');
    return g.sprite();
  }

  // Fruit stand (26x18): wooden crate table with a heap of fruit on top
  function makeFruit(kind, rnd) {
    const g = Grid(26, 18);
    g.rect(0, 9, 26, 7, 't'); g.rect(0, 11, 26, 1, 'T'); g.rect(0, 14, 26, 1, 'T');
    g.rect(0, 9, 26, 1, 'l');
    g.rect(1, 16, 2, 2, 'T'); g.rect(23, 16, 2, 2, 'T');
    if (kind === 0) {           // watermelons
      const ms = [[5, 7], [12.5, 7], [20, 7], [8.5, 3.5], [16.5, 3.5]];
      for (const [cx, cy] of ms) {
        g.ell(cx, cy, 3.6, 2.6, 'g');
        for (let x = Math.floor(cx) - 2; x <= cx + 2; x += 2) for (let y = Math.floor(cy) - 2; y <= cy + 2; y++)
          if (Math.abs(x + 0.5 - cx) < 3 && Math.abs(y + 0.5 - cy) < 2.4) g.px(x, y, 'V');
        g.px(Math.floor(cx) - 2, Math.floor(cy) - 1, 'v');
      }
    } else {                    // apples / oranges / mixed with bananas
      const c = kind === 1 ? 'r' : 'o';
      for (let row = 0; row < 4; row++) {
        const y = 7 - row * 2, x0 = 1 + row * 3, x1 = 25 - row * 3;
        for (let x = x0; x + 2 <= x1; x += 2) {
          let cc = c;
          if (kind === 3) cc = rnd() < 0.5 ? 'r' : 'g';
          g.rect(x, y, 2, 2, cc); g.px(x, y, cc === 'g' ? 'v' : 'y'); // highlight
          g.px(x + 1, y + 1, SHADE[cc]);
        }
      }
      if (kind === 3) { g.rect(9, 0, 6, 1, 'y'); g.rect(8, 1, 2, 1, 'y'); g.rect(14, 1, 2, 1, 'Y'); }
    }
    g.rect(21, 0, 5, 4, 'w'); g.rect(22, 1, 3, 1, 'r'); g.rect(22, 2, 2, 1, 'k'); g.rect(23, 4, 1, 5, 'T'); // price card
    return g.sprite();
  }

  // Sign on a pole (19x26)
  function makeSign(txt, bg, fg) {
    const g = Grid(19, 26);
    g.rect(0, 0, 19, 9, bg === 'y' ? 'r' : 'k');
    g.rect(1, 1, 17, 7, bg);
    g.text(txt, Math.floor((19 - textW(txt)) / 2), 2, fg);
    g.rect(9, 9, 2, 15, 'f'); g.px(9, 9, 'F');
    g.rect(6, 24, 7, 2, 'n');
    return g.sprite();
  }

  // Checkout counter with conveyor, register and lane lamp (34x22)
  function makeCheckout(num) {
    const g = Grid(34, 22);
    g.rect(1, 4, 2, 18, 'f');
    g.rect(0, 0, 5, 6, 'y'); g.rect(0, 5, 5, 1, 'Y');
    g.text(String(num % 10), 1, 0, 'k');
    g.rect(4, 12, 30, 10, 'e'); g.rect(4, 19, 30, 3, 'E');
    g.rect(4, 15, 30, 2, 'r');
    g.rect(4, 10, 22, 2, 'k'); g.rect(4, 10, 22, 1, 'K');
    g.rect(7, 8, 3, 2, 'g'); g.rect(12, 7, 2, 3, 'o'); g.rect(16, 8, 4, 2, 'b'); // items on belt
    g.rect(26, 10, 8, 2, 'F');
    g.rect(29, 6, 2, 4, 'f');
    g.rect(25, 1, 9, 6, 's'); g.rect(26, 2, 7, 4, 'z'); g.rect(27, 3, 3, 1, 'w');
    g.rect(26, 8, 7, 2, 'n');
    return g.sprite();
  }

  // Chest freezer (34x18)
  function makeFreezer(rnd) {
    const g = Grid(34, 18);
    g.rect(0, 1, 34, 1, 'F');
    g.rect(0, 2, 34, 4, 'i');
    for (let x = 1; x < 33; x += 3) {
      const c = ['c', 'b', 'W', 'p', 'r'][Math.floor(rnd() * 5)];
      g.rect(x, 3 + Math.floor(rnd() * 2), 2, 2, c);
    }
    g.rect(0, 2, 1, 4, 'F'); g.rect(33, 2, 1, 4, 'F'); g.rect(16, 2, 2, 4, 'F');
    g.px(3, 2, 'w'); g.px(4, 2, 'w'); g.px(20, 2, 'w');
    g.rect(0, 6, 34, 12, 'e'); g.rect(0, 15, 34, 3, 'E');
    g.rect(0, 11, 34, 2, 'b'); g.rect(13, 8, 8, 2, 'c');
    return g.sprite();
  }

  // Upright glass-door cooler (24x32)
  function makeCooler(rnd) {
    const g = Grid(24, 32);
    g.rect(0, 0, 24, 32, 'e');
    g.rect(0, 0, 24, 4, 'b'); g.rect(3, 1, 6, 1, 'w'); g.rect(11, 2, 9, 1, 'w');
    for (const dx of [2, 13]) {
      g.rect(dx, 5, 9, 24, 'I');
      for (const sy of [11, 17, 23, 28]) {
        g.rect(dx, sy, 9, 1, 'F');
        for (let x = dx; x < dx + 9; x += 2) {
          const c = ['c', 'g', 'r', 'o', 'W', 'y'][Math.floor(rnd() * 6)];
          g.rect(x, sy - 4, 1, 4, c); g.px(x, sy - 5, 'w');
        }
      }
      g.px(dx + 1, 6, 'i'); g.px(dx + 2, 7, 'i'); g.px(dx + 3, 8, 'i');
    }
    g.rect(10, 14, 1, 6, 'F'); g.rect(13, 14, 1, 6, 'F');
    g.rect(0, 29, 24, 3, 'E');
    return g.sprite();
  }

  // ---- 냉동 코너 props -------------------------------------------------------------
  // Ice block stack (16x14)
  function makeIce() {
    const g = Grid(16, 14);
    for (const x0 of [0, 8]) {
      g.rect(x0, 6, 8, 8, 'i'); g.rect(x0 + 7, 6, 1, 8, 'I'); g.rect(x0, 13, 8, 1, 'I');
      g.px(x0 + 1, 7, 'w'); g.px(x0 + 2, 7, 'w'); g.px(x0 + 1, 8, 'w');
    }
    g.rect(4, 0, 8, 6, 'e'); g.rect(11, 0, 1, 6, 'E'); g.rect(4, 5, 8, 1, 'E');
    g.px(5, 1, 'w'); g.px(6, 1, 'w'); g.px(5, 2, 'w');
    return g.sprite();
  }
  // Penguin mascot (10x14)
  function makePenguin() {
    const g = Grid(10, 14);
    g.ell(5, 8, 4.4, 5.4, 'A');
    g.ell(5, 9, 2.8, 4, 'w');
    g.ell(5, 3, 3, 3, 'A');
    g.px(4, 2, 'w'); g.px(6, 2, 'w'); g.px(4, 3, 'k'); g.px(6, 3, 'k');
    g.rect(4, 4, 3, 1, 'o');
    g.rect(2, 13, 2, 1, 'o'); g.rect(6, 13, 2, 1, 'o');
    g.rect(1, 1, 8, 1, 'r'); g.rect(3, 0, 4, 1, 'r'); g.px(5, 0, 'w');    // little red hat
    return g.sprite();
  }

  // ---- 청과 시장 props -------------------------------------------------------------
  // Market stall (34x34): striped awning on poles over a crate table heaped with produce
  function makeAwning(col, rnd) {
    const g = Grid(34, 34), cs = SHADE[col] || 'G';
    for (let x = 0; x < 34; x++) {
      const on = ((x >> 2) & 1) === 0;
      g.rect(x, 1, 1, 8, on ? col : 'W');
      g.px(x, 9, (x & 3) === 1 || (x & 3) === 2 ? (on ? col : 'W') : '.');  // scalloped edge
    }
    g.rect(0, 0, 34, 1, cs); g.rect(0, 8, 34, 1, cs);
    g.rect(1, 9, 2, 25, 'T'); g.rect(31, 9, 2, 25, 'T');
    g.rect(2, 22, 30, 10, 't'); g.rect(2, 22, 30, 1, 'l'); g.rect(2, 26, 30, 1, 'T'); g.rect(2, 29, 30, 1, 'T');
    g.rect(3, 32, 3, 2, 'T'); g.rect(28, 32, 3, 2, 'T');
    const prod = ['r', 'o', 'y', 'g', 'v', 'u'];
    for (let row = 0; row < 3; row++) {
      const y = 20 - row * 2, x0 = 4 + row * 3, x1 = 30 - row * 3;
      for (let x = x0; x + 2 <= x1; x += 2) {
        const c = prod[Math.floor(rnd() * prod.length)];
        g.rect(x, y, 2, 2, c); g.px(x, y, c === 'g' || c === 'v' ? 'z' : 'y'); g.px(x + 1, y + 1, SHADE[c] || 'G');
      }
    }
    g.rect(13, 11, 8, 5, 'k'); g.rect(14, 12, 6, 3, 'W'); g.rect(15, 13, 4, 1, 'r');  // price board
    return g.sprite();
  }
  // Fruit crate (16x12)
  function makeCrate(c, rnd) {
    const g = Grid(16, 12), cs = SHADE[c] || 'G';
    g.rect(0, 5, 16, 7, 't'); g.rect(0, 5, 16, 1, 'l'); g.rect(0, 8, 16, 1, 'T'); g.rect(0, 11, 16, 1, 'T');
    g.rect(0, 5, 1, 7, 'T'); g.rect(15, 5, 1, 7, 'T');
    for (let row = 0; row < 2; row++) for (let x = 1 + row * 2; x + 2 <= 15 - row * 2; x += 2) {
      const y = 3 - row * 2, cc = rnd() < 0.15 ? 'g' : c;
      g.rect(x, y, 2, 2, cc); g.px(x, y, 'y'); g.px(x + 1, y + 1, cc === 'g' ? 'G' : cs);
    }
    return g.sprite();
  }

  // ---- 옥상 주차장 props -----------------------------------------------------------
  // Parked car seen from behind (26x18)
  function makeCar(col) {
    const g = Grid(26, 18), cs = SHADE[col] || 'n';
    g.rect(5, 0, 16, 1, cs); g.rect(4, 1, 18, 6, col);
    g.rect(6, 2, 14, 4, 'I'); g.rect(6, 2, 14, 1, 'i'); g.px(7, 3, 'w'); g.px(8, 3, 'w');
    g.rect(1, 7, 24, 7, col); g.rect(1, 12, 24, 2, cs); g.rect(0, 8, 1, 4, cs); g.rect(25, 8, 1, 4, cs);
    g.rect(2, 8, 4, 2, 'r'); g.rect(20, 8, 4, 2, 'r'); g.px(2, 8, 'x'); g.px(23, 8, 'x');
    g.rect(9, 9, 8, 3, 'w'); g.rect(10, 10, 6, 1, 'K');
    g.rect(0, 14, 26, 1, 'n');
    g.rect(2, 15, 5, 3, 'A'); g.rect(19, 15, 5, 3, 'A');
    return g.sprite();
  }
  // Light pole (9x42)
  function makeLamp() {
    const g = Grid(9, 42);
    g.rect(4, 5, 1, 35, 'q'); g.rect(3, 5, 1, 35, 'Q');
    g.rect(0, 2, 9, 3, 'a'); g.rect(1, 5, 7, 1, 'x'); g.rect(3, 5, 3, 1, 'w');
    g.rect(2, 39, 5, 3, 'n');
    return g.sprite();
  }
  // Traffic cone (7x9)
  function makeCone() {
    const g = Grid(7, 9);
    g.rect(3, 0, 1, 2, 'o'); g.rect(2, 2, 3, 2, 'w'); g.rect(2, 4, 3, 1, 'o'); g.rect(1, 5, 5, 2, 'o'); g.rect(1, 5, 5, 1, 'w');
    g.rect(0, 7, 7, 2, 'k');
    return g.sprite();
  }
  // Concrete jersey barrier (22x9)
  function makeJersey() {
    const g = Grid(22, 9);
    g.rect(3, 0, 16, 3, 'F'); g.rect(1, 3, 20, 6, 'Q'); g.rect(0, 6, 22, 3, 'q');
    for (let x = 3; x < 19; x += 6) g.rect(x, 1, 3, 1, 'r');
    g.rect(0, 8, 22, 1, 'n');
    return g.sprite();
  }

  // ---- 자정의 유령 마트 props --------------------------------------------------------
  // Tombstone (12x16)
  function makeTomb() {
    const g = Grid(12, 16);
    g.ell(6, 5, 5.5, 5, 'q'); g.rect(1, 5, 10, 9, 'q');
    g.rect(1, 5, 1, 9, 'Q'); g.rect(10, 5, 1, 9, 'n');
    g.text('RIP', 0, 5, 'a');
    g.px(8, 11, 'n'); g.px(7, 12, 'n');
    g.rect(0, 14, 12, 2, 'G'); g.px(2, 13, 'g'); g.px(9, 13, 'g');
    return g.sprite();
  }
  // Jack-o'-lantern (14x12)
  function makePumpkin() {
    const g = Grid(14, 12);
    g.ell(7, 7, 6.5, 4.6, 'o');
    g.rect(4, 3, 1, 8, 'O'); g.rect(9, 3, 1, 8, 'O');
    g.rect(6, 0, 2, 3, 'G');
    g.px(4, 5, 'y'); g.px(5, 5, 'y'); g.px(5, 4, 'y'); g.px(9, 5, 'y'); g.px(8, 5, 'y'); g.px(8, 4, 'y');
    g.rect(4, 8, 6, 1, 'y'); g.px(5, 9, 'y'); g.px(8, 9, 'y');
    return g.sprite();
  }
  // Candles (10x13)
  function makeCandle() {
    const g = Grid(10, 13);
    for (const [x, h] of [[1, 6], [4, 8], [7, 5]]) {
      g.rect(x, 11 - h, 2, h, 'W'); g.px(x + 1, 12 - h, 'E');
      g.px(x, 9 - h, 'o'); g.px(x + 1, 9 - h, 'y'); g.px(x, 8 - h, 'y'); g.px(x, 10 - h, 'x');
    }
    g.rect(0, 11, 10, 2, 'Y');
    return g.sprite();
  }
  // Floating ghost (12x14)
  function makeGhost() {
    const g = Grid(12, 14);
    g.ell(6, 5, 5.5, 5.2, 'e'); g.rect(1, 5, 10, 7, 'e');
    for (let x = 1; x < 11; x += 3) { g.px(x, 12, 'e'); g.px(x + 1, 12, 'e'); g.px(x + 1, 13, 'e'); }
    g.rect(1, 5, 1, 7, 'E');
    g.rect(3, 4, 2, 3, 'A'); g.rect(7, 4, 2, 3, 'A'); g.rect(5, 8, 2, 2, 'A');
    return g.sprite();
  }

  // ---- 유령 묘지 서킷 props ----------------------------------------------------------
  const line = (g, x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (let k = 0; k <= n; k++) g.px(Math.round(x0 + (x1 - x0) * k / (n || 1)), Math.round(y0 + (y1 - y0) * k / (n || 1)), c);
  };
  // Slab headstone, mossy and cracked (12x16)
  function makeSlab() {
    const g = Grid(12, 16);
    g.rect(1, 1, 10, 13, 'Q'); g.rect(2, 0, 8, 1, 'Q');
    g.rect(10, 1, 1, 13, 'n'); g.rect(1, 1, 1, 13, 'F');
    g.rect(4, 3, 4, 1, 'n'); g.rect(5, 2, 2, 4, 'n');          // carved cross
    g.rect(3, 8, 6, 1, 'q'); g.rect(3, 10, 5, 1, 'q');          // worn inscription
    line(g, 8, 4, 6, 8, 'n'); g.px(2, 12, 'G'); g.px(3, 13, 'G'); g.px(9, 13, 'G');
    g.rect(0, 14, 12, 2, 'V'); g.px(1, 13, 'g'); g.px(10, 13, 'g');
    return g.sprite();
  }
  // Stone cross on a plinth (10x18)
  function makeCross() {
    const g = Grid(10, 18);
    g.rect(4, 0, 3, 14, 'Q'); g.rect(0, 3, 10, 3, 'Q');
    g.rect(6, 0, 1, 14, 'n'); g.rect(0, 5, 10, 1, 'n'); g.px(4, 0, 'F'); g.px(0, 3, 'F');
    g.px(5, 9, 'G'); g.px(4, 11, 'G');
    g.rect(2, 14, 7, 2, 'q'); g.rect(1, 16, 9, 2, 'n');
    return g.sprite();
  }
  // Wrought-iron fence section with spear tips (26x14)
  function makeFence() {
    const g = Grid(26, 14);
    for (let x = 2; x < 25; x += 3) { g.rect(x, 2, 1, 12, 'A'); g.px(x, 1, 'a'); g.px(x, 0, 's'); }
    g.rect(0, 4, 26, 1, 'A'); g.rect(0, 11, 26, 1, 'A');
    for (const x of [0, 24]) { g.rect(x, 1, 2, 13, 'a'); g.rect(x, 0, 2, 1, 's'); }
    for (let x = 3; x < 24; x += 6) { g.px(x, 6, 'a'); g.px(x + 1, 7, 'a'); g.px(x, 8, 'a'); }  // scrollwork
    g.px(7, 12, 'G'); g.px(16, 13, 'G');
    return g.sprite();
  }
  // Mausoleum / crypt with pediment, columns, a cracked door leaking green light (32x32)
  function makeCrypt() {
    const g = Grid(32, 32);
    for (let r = 0; r < 7; r++) g.rect(15 - r * 2, 3 + r, 2 + r * 4, 1, r === 0 ? 'F' : 'q');   // pediment
    g.rect(14, 0, 4, 1, 'n'); g.rect(15, 0, 2, 3, 'n');                                        // roof cross stub
    g.rect(1, 10, 30, 2, 'F'); g.rect(1, 11, 30, 1, 'n');                                      // cornice
    g.rect(3, 12, 26, 17, 'Q');
    for (const x of [4, 25]) { g.rect(x, 12, 3, 17, 'F'); g.rect(x + 2, 12, 1, 17, 'q'); }   // columns
    g.rect(11, 15, 10, 14, 'A'); g.rect(12, 14, 8, 1, 'A');                                    // doorway
    g.rect(15, 16, 1, 13, 'z'); g.px(15, 15, 'v'); g.px(14, 27, 'z'); g.px(16, 28, 'z');       // eerie glow
    g.rect(12, 17, 2, 2, 'a'); g.rect(18, 17, 2, 2, 'a');
    g.rect(9, 12, 14, 2, 'n'); g.text('RIP', 10, 12, 'K');
    g.rect(0, 29, 32, 3, 'n'); g.rect(1, 29, 30, 1, 'q');                                      // steps
    for (const [x, y] of [[3, 27], [5, 24], [28, 26], [26, 13], [8, 10], [22, 10]]) g.px(x, y, 'G');
    return g.sprite();
  }
  // Dead tree silhouette (26x36)
  function makeTree() {
    const g = Grid(26, 36);
    g.rect(11, 14, 4, 20, 'K'); g.rect(10, 30, 6, 4, 'K'); g.rect(8, 33, 10, 3, 'K');
    g.rect(14, 14, 1, 20, 'k');
    const br = [[12, 16, 4, 6], [4, 6, 1, 2], [4, 6, 6, 1], [13, 15, 21, 5], [21, 5, 24, 1], [21, 5, 19, 0],
      [13, 20, 2, 14], [14, 11, 13, 2], [13, 2, 10, 0], [14, 22, 24, 15], [8, 10, 9, 4]];
    for (const [a, b, c, d] of br) { line(g, a, b, c, d, 'K'); line(g, a + 1, b, c + 1, d, 'k'); }
    g.rect(19, 6, 3, 2, 'A'); g.px(21, 5, 'A'); g.px(20, 6, 'y');                              // a crow
    return g.sprite();
  }
  // Fresh grave: dirt mound, wooden cross and a curl of ground fog (20x14)
  function makeGrave() {
    const g = Grid(20, 14);
    g.ell(10, 10, 9.5, 3.6, 'T'); g.ell(10, 9.5, 8, 2.6, 't'); g.px(6, 8, 'l'); g.px(13, 9, 'l');
    g.rect(3, 1, 2, 9, 't'); g.rect(1, 3, 6, 2, 't'); g.px(4, 1, 'T'); g.rect(4, 3, 1, 7, 'T');
    for (const [x, y, w] of [[8, 5, 6], [11, 4, 5], [14, 6, 4], [0, 12, 4], [16, 11, 4]]) g.rect(x, y, w, 1, 'E');
    g.px(10, 5, 'e'); g.px(13, 4, 'e');
    return g.sprite();
  }

  // ---- extra dressing for maps 0-3 -------------------------------------------------
  // Yellow "wet floor" A-frame (10x14)
  function makeWetSign() {
    const g = Grid(10, 14);
    for (let r = 0; r < 12; r++) g.rect(4 - (r >> 2), r, 2 + (r >> 2) * 2, 1, 'y');
    g.rect(1, 12, 1, 2, 'Y'); g.rect(8, 12, 1, 2, 'Y');
    g.rect(4, 3, 2, 5, 'k'); g.rect(4, 9, 2, 1, 'k'); g.px(3, 1, 'Y');
    return g.sprite();
  }
  // Potted plant (14x22)
  function makePlant(rnd) {
    const g = Grid(14, 22);
    for (let k = 0; k < 18; k++) {
      const x = 2 + Math.floor(rnd() * 10), y = 1 + Math.floor(rnd() * 12), c = rnd() < 0.4 ? 'G' : rnd() < 0.7 ? 'g' : 'v';
      g.ell(x, y, 2, 1.4, c);
    }
    g.rect(6, 10, 2, 5, 'G');
    g.rect(3, 15, 8, 7, 'O'); g.rect(2, 15, 10, 2, 'o'); g.rect(9, 17, 2, 5, 'R');
    return g.sprite();
  }
  // Shrink-wrapped water bottle packs on a pallet (20x16)
  function makeWater() {
    const g = Grid(20, 16);
    for (const [x0, y0] of [[1, 8], [10, 8], [5, 1]]) {
      g.rect(x0, y0, 9, 7, 'i');
      for (let x = x0; x < x0 + 9; x += 2) { g.rect(x, y0, 1, 7, 'I'); g.px(x, y0, 'c'); }
      g.rect(x0, y0 + 3, 9, 2, 'b'); g.px(x0 + 1, y0 + 1, 'w');
    }
    g.rect(0, 15, 20, 1, 't');
    return g.sprite();
  }
  // Snowman with a scarf (12x18)
  function makeSnowman() {
    const g = Grid(12, 18);
    g.ell(6, 13, 5.2, 4.5, 'w'); g.ell(6, 6.5, 3.8, 3.4, 'w'); g.rect(9, 10, 2, 7, 'e');
    g.px(5, 5, 'k'); g.px(7, 5, 'k'); g.px(6, 7, 'o'); g.px(7, 7, 'o');
    g.rect(3, 9, 7, 2, 'r'); g.rect(8, 11, 2, 3, 'r');
    g.rect(3, 2, 6, 1, 'A'); g.rect(4, 0, 4, 2, 'A');
    g.px(6, 12, 'k'); g.px(6, 14, 'k');
    return g.sprite();
  }
  // Ice-cream chest freezer with a cone sign (30x26)
  function makeIceCream() {
    const g = Grid(30, 26);
    g.rect(13, 0, 4, 2, 'p'); g.ell(15, 2, 3, 2, 'W'); g.rect(13, 1, 4, 1, 'y');   // scoops
    for (let r = 0; r < 6; r++) g.rect(13 + (r >> 1), 4 + r, 4 - (r >> 1) * 2 || 1, 1, 't');
    g.rect(14, 10, 2, 3, 'f');
    g.rect(0, 13, 30, 1, 'F'); g.rect(0, 14, 30, 3, 'i');
    for (let x = 1; x < 29; x += 3) g.rect(x, 14, 2, 2, ['p', 'y', 'W', 'o', 'c'][(x / 3 | 0) % 5]);
    g.rect(0, 17, 30, 9, 'e'); g.rect(0, 23, 30, 3, 'E'); g.rect(0, 19, 30, 2, 'p'); g.rect(11, 20, 8, 1, 'w');
    return g.sprite();
  }
  // Flower bucket stand (26x20)
  function makeFlowers(rnd) {
    const g = Grid(26, 20);
    for (let b = 0; b < 4; b++) {
      const x0 = 1 + b * 6, c = ['r', 'y', 'p', 'W', 'u', 'o'][Math.floor(rnd() * 6)];
      for (let k = 0; k < 7; k++) { const x = x0 + Math.floor(rnd() * 5), y = 1 + Math.floor(rnd() * 6); g.px(x, y + 2, 'G'); g.rect(x, y, 2, 2, c); g.px(x, y, 'y'); }
      g.rect(x0, 9, 5, 6, 'n'); g.rect(x0, 9, 5, 1, 'F'); g.rect(x0 + 4, 10, 1, 5, 'k');
    }
    g.rect(0, 15, 26, 5, 't'); g.rect(0, 15, 26, 1, 'l'); g.rect(0, 18, 26, 1, 'T');
    return g.sprite();
  }
  // Burlap potato sacks (22x14)
  function makeSacks() {
    const g = Grid(22, 14);
    for (const [cx, cy] of [[5, 9], [16, 9], [10.5, 5]]) {
      g.ell(cx, cy, 5, 4.4, 'l'); g.ell(cx + 1, cy + 1, 3.6, 3, 't');
      g.rect(Math.round(cx) - 1, Math.round(cy) - 5, 3, 2, 'T'); g.px(Math.round(cx) - 2, Math.round(cy) - 1, 'w');
    }
    return g.sprite();
  }
  // Tall stack of produce crates (16x30)
  function makeCrateStack(rnd) {
    const g = Grid(16, 30);
    for (let lv = 0; lv < 3; lv++) {
      const y = 22 - lv * 9, c = ['r', 'o', 'y', 'g', 'u'][Math.floor(rnd() * 5)];
      g.rect(0, y, 16, 8, 't'); g.rect(0, y, 16, 1, 'l'); g.rect(0, y + 3, 16, 1, 'T'); g.rect(0, y + 7, 16, 1, 'T');
      g.rect(0, y, 1, 8, 'T'); g.rect(15, y, 1, 8, 'T');
      for (let x = 2; x < 14; x += 3) { g.rect(x, y + 1, 2, 2, c); g.px(x, y + 1, 'y'); }
    }
    g.rect(2, 1, 12, 4, 'k'); g.rect(3, 2, 10, 2, 'W'); g.rect(4, 2, 4, 1, 'r');          // price card
    return g.sprite();
  }
  // Bunting: two poles with a sagging string of triangle flags (34x26)
  function makeBunting() {
    const g = Grid(34, 26), cols = ['r', 'y', 'g', 'b', 'p', 'o'];
    g.rect(0, 0, 2, 26, 'T'); g.rect(32, 0, 2, 26, 'T'); g.px(0, 0, 'l'); g.px(32, 0, 'l');
    for (let x = 2; x < 32; x++) {
      const y = 2 + Math.round(Math.sin((x - 2) / 30 * Math.PI) * 5);
      g.px(x, y, 'k');
      if ((x - 2) % 5 === 1) { const c = cols[((x - 2) / 5 | 0) % cols.length]; g.rect(x, y + 1, 3, 1, c); g.rect(x, y + 2, 3, 1, c); g.px(x + 1, y + 3, c); g.px(x + 1, y + 4, c); }
    }
    g.rect(0, 24, 4, 2, 'K'); g.rect(30, 24, 4, 2, 'K');
    return g.sprite();
  }
  // Drinks vending machine (16x28)
  function makeVending(col) {
    const g = Grid(16, 28), cs = SHADE[col] || 'n';
    g.rect(0, 0, 16, 28, col); g.rect(15, 0, 1, 28, cs); g.rect(0, 0, 16, 1, 'w');
    g.rect(2, 3, 10, 14, 'I');
    for (let r = 0; r < 3; r++) for (let x = 3; x < 12; x += 2) g.rect(x, 5 + r * 4, 1, 3, ['r', 'c', 'y', 'g', 'W'][(x + r) % 5]);
    g.rect(13, 4, 2, 6, 'k'); g.px(13, 5, 'x'); g.px(13, 7, 'x');
    g.rect(3, 20, 9, 4, 'A'); g.rect(2, 25, 12, 1, cs);
    return g.sprite();
  }
  // Rubbish bin (8x11)
  function makeBin() {
    const g = Grid(8, 11);
    g.rect(0, 0, 8, 2, 'n'); g.rect(1, 2, 6, 9, 'G'); g.rect(6, 2, 1, 9, 'V');
    g.rect(2, 4, 1, 5, 'g'); g.rect(4, 4, 1, 5, 'g'); g.px(3, 0, 'F');
    return g.sprite();
  }
  // Parking barrier gate with a ticket box (30x18)
  function makeGate() {
    const g = Grid(30, 18);
    g.rect(0, 4, 6, 14, 'y'); g.rect(5, 4, 1, 14, 'Y'); g.rect(1, 6, 4, 3, 'A'); g.px(2, 7, 'z');
    g.rect(1, 11, 4, 1, 'k');
    for (let x = 6; x < 30; x++) g.rect(x, 6, 1, 2, ((x >> 2) & 1) ? 'w' : 'r');
    g.rect(28, 7, 1, 11, 'n');
    g.rect(0, 2, 6, 2, 'r'); g.px(2, 2, 'x');
    return g.sprite();
  }
  // Rooftop planter tree (16x30)
  function makePotTree(rnd) {
    const g = Grid(16, 30);
    for (let k = 0; k < 26; k++) { const a = rnd() * Math.PI * 2, d = rnd() * 6; g.ell(8 + Math.cos(a) * d, 9 + Math.sin(a) * d * 0.9, 2.2, 1.8, rnd() < 0.4 ? 'G' : rnd() < 0.5 ? 'g' : 'o'); }
    g.rect(7, 16, 2, 8, 'T');
    g.rect(2, 23, 12, 7, 'Q'); g.rect(2, 23, 12, 1, 'F'); g.rect(12, 24, 2, 6, 'n');
    return g.sprite();
  }
  // Cart corral: rail with a row of nested carts (32x16)
  function makeCorral() {
    const g = Grid(32, 16);
    for (let k = 0; k < 4; k++) {
      const x0 = 2 + k * 6;
      for (let r = 0; r < 3; r++) g.rect(x0 + r, 3 + r * 2, 10 - r * 2, 1, 'F');
      g.rect(x0 + 2, 12, 2, 2, 'k'); g.rect(x0 + 7, 12, 2, 2, 'k'); g.rect(x0, 2, 2, 1, 'h');
    }
    g.rect(0, 1, 32, 1, 'b'); g.rect(0, 9, 32, 1, 'b'); g.rect(0, 1, 1, 15, 'B'); g.rect(31, 1, 1, 15, 'B');
    g.rect(12, 0, 8, 1, 'y');
    return g.sprite();
  }

  // ---- 글리치 월드 props --------------------------------------------------------------
  // Error dialog window (30x22)
  function makeErrWin(title) {
    const g = Grid(30, 22);
    g.rect(0, 0, 30, 22, 'A'); g.rect(1, 1, 28, 20, 'F'); g.rect(1, 1, 28, 5, 'B');
    g.rect(24, 2, 4, 3, 'r'); g.px(25, 3, 'w'); g.px(26, 3, 'w');
    g.text(title, 2, 1, 'w');
    g.rect(3, 8, 7, 7, 'y'); g.rect(6, 9, 1, 3, 'k'); g.px(6, 13, 'k');                      // warning icon
    g.rect(12, 9, 14, 1, 'n'); g.rect(12, 11, 11, 1, 'n'); g.rect(12, 13, 13, 1, 'n');
    g.rect(10, 16, 10, 5, 'f'); g.rect(11, 17, 8, 3, 'F'); g.text('OK', 12, 16, 'k');
    for (const y of [5, 14]) g.rect(0, y, 30, 1, 'p');                                       // tearing
    g.rect(18, 5, 12, 1, 'c');
    return g.sprite();
  }
  // big "404" monolith with RGB split (30x18)
  function make404() {
    const g = Grid(30, 18);
    g.rect(0, 0, 30, 18, 'A');
    const big = (ch, x0, col) => { const gl = FONT[ch]; for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gl[j][i] === '1') g.rect(x0 + i * 3, 2 + j * 2, 3, 2, col); };
    ['4', '0', '4'].forEach((ch, k) => { big(ch, 1 + k * 9, 'p'); big(ch, 3 + k * 9, 'c'); big(ch, 2 + k * 9, 'w'); });
    g.rect(0, 13, 30, 1, 'z'); g.text('ERR', 9, 13, 'z');
    g.rect(0, 16, 30, 2, 'K');
    return g.sprite();
  }
  // Broken polygon: floating wireframe shards (22x24)
  function makeShard(col) {
    const g = Grid(22, 24);
    const tri = (a, b, c2) => { line(g, a[0], a[1], b[0], b[1], col); line(g, b[0], b[1], c2[0], c2[1], col); line(g, c2[0], c2[1], a[0], a[1], col); };
    tri([2, 14], [11, 1], [19, 12]); tri([4, 17], [12, 21], [18, 15]); tri([8, 8], [14, 9], [11, 15]);
    g.rect(9, 5, 4, 4, SHADE[col] || 'U'); g.px(11, 1, 'w'); g.px(2, 14, 'w');
    g.rect(10, 22, 2, 2, 'A');
    return g.sprite();
  }
  // Wireframe cube (18x20)
  function makeWireCube() {
    const g = Grid(18, 20);
    const sq = (x, y, w) => { g.rect(x, y, w, 1, 'z'); g.rect(x, y + w - 1, w, 1, 'z'); g.rect(x, y, 1, w, 'z'); g.rect(x + w - 1, y, 1, w, 'z'); };
    sq(1, 6, 11); sq(6, 1, 11);
    for (const [a, b] of [[[1, 6], [6, 1]], [[11, 6], [16, 1]], [[1, 16], [6, 11]], [[11, 16], [16, 11]]]) line(g, a[0], a[1], b[0], b[1], 'v');
    g.rect(7, 18, 4, 2, 'A');
    return g.sprite();
  }
  // Missing-texture block (16x16 magenta/black checker)
  function makeMissing() {
    const g = Grid(16, 16);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) g.px(i, j, ((i >> 2) + (j >> 2)) & 1 ? 'A' : 'p');
    g.rect(0, 0, 16, 1, 'w');
    return g.sprite();
  }
  // Giant mouse cursor (14x20)
  function makeCursor() {
    const g = Grid(14, 20);
    for (let r = 0; r < 14; r++) g.rect(0, r, Math.min(r + 1, 11), 1, 'k');
    for (let r = 1; r < 13; r++) g.rect(1, r, Math.min(r - 1, 9), 1, 'w');
    g.rect(4, 14, 3, 6, 'k'); g.rect(7, 16, 3, 4, 'k'); g.rect(5, 14, 1, 5, 'w'); g.rect(8, 16, 1, 3, 'w');
    return g.sprite();
  }
  // Loading bar stuck at 99% (28x11)
  function makeLoadBar() {
    const g = Grid(28, 11);
    g.rect(0, 0, 28, 11, 'A'); g.rect(1, 1, 26, 3, 'k'); g.rect(1, 1, 25, 3, 'z');
    g.text('99%', 8, 5, 'w');
    for (let x = 1; x < 26; x += 4) g.px(x, 2, 'v');
    return g.sprite();
  }
  // Colour-bar test-pattern panel on legs (24x24)
  function makeBars() {
    const g = Grid(24, 24);
    ['W', 'y', 'c', 'z', 'p', 'r', 'b'].forEach((c, k) => g.rect(1 + k * 3, 1, 3, 12, c));
    g.rect(1, 13, 21, 3, 'A'); for (let x = 1; x < 22; x += 2) g.px(x, 14, 'w');
    g.rect(0, 0, 23, 1, 'n'); g.rect(0, 16, 23, 1, 'n');
    g.rect(4, 17, 2, 7, 'n'); g.rect(17, 17, 2, 7, 'n');
    g.rect(0, 6, 23, 1, 'k'); g.rect(6, 6, 12, 1, 'w');                                      // tear
    return g.sprite();
  }

  // ---- 미로 정원 props ---------------------------------------------------------------
  // Clipped hedge wall block (32x28): bumpy top, leaf clusters, shadowed base, optional blossoms
  function makeHedge(rnd, flowers) {
    const g = Grid(32, 28);
    g.rect(0, 3, 32, 25, 'G');
    for (let x = 0; x < 32; x++) { const h = Math.floor(rnd() * 3); g.rect(x, 3 - h, 1, h, 'G'); if (h === 2) g.px(x, 1, 'g'); }
    for (let k = 0; k < 80; k++) { const x = Math.floor(rnd() * 32), y = 2 + Math.floor(rnd() * 21); g.px(x, y, rnd() < 0.55 ? 'g' : 'v'); if (rnd() < 0.5) g.px(x + 1, y, 'g'); }
    for (let k = 0; k < 50; k++) g.px(Math.floor(rnd() * 32), 5 + Math.floor(rnd() * 20), 'V');
    g.rect(0, 23, 32, 5, 'V'); for (let x = 1; x < 32; x += 3) g.px(x, 23, 'G');
    g.rect(0, 3, 1, 25, 'V'); g.rect(31, 3, 1, 25, 'V');
    if (flowers) for (let k = 0; k < 10; k++) { const x = Math.floor(rnd() * 30) + 1, y = 3 + Math.floor(rnd() * 18); g.px(x, y, flowers); g.px(x, y + 1, 'y'); }
    return g.sprite();
  }
  // Topiary in a terracotta pot (16x30): 0 = ball, 1 = cone, 2 = spiral
  function makeTopiary(shape) {
    const g = Grid(16, 30);
    if (shape === 0) { g.ell(8, 9, 7.5, 7.5, 'G'); g.ell(6.5, 7.5, 5, 5, 'g'); g.px(5, 5, 'v'); g.px(6, 5, 'v'); g.px(4, 6, 'v'); }
    else if (shape === 1) { for (let r = 0; r < 20; r++) { const w = 2 + Math.floor(r * 0.7) * 2; g.rect(8 - (w >> 1), r, w, 1, 'G'); g.rect(8 - (w >> 1), r, w >> 1, 1, 'g'); } }
    else for (let k = 0; k < 4; k++) { const rr = 2.5 + k * 1.3; g.ell(8, 3 + k * 5 + rr * 0.5, rr, 2.4, 'G'); g.ell(7, 2.5 + k * 5 + rr * 0.5, rr - 1, 1.4, 'g'); }
    g.rect(7, 18, 2, 5, 'T');
    g.rect(3, 23, 10, 7, 'O'); g.rect(2, 23, 12, 2, 'o'); g.rect(11, 25, 2, 5, 'R');
    return g.sprite();
  }
  // Stone fountain (30x26): two basins, water jet and splashes
  function makeFountain() {
    const g = Grid(30, 26);
    g.rect(14, 0, 2, 9, 'i'); g.px(13, 1, 'w'); g.px(16, 2, 'w'); g.px(12, 4, 'i'); g.px(17, 5, 'i');
    g.ell(15, 9, 6, 2, 'Q'); g.ell(15, 8.5, 5, 1.2, 'c'); g.rect(13, 10, 4, 7, 'Q'); g.rect(16, 10, 1, 7, 'q');
    g.px(9, 11, 'i'); g.px(21, 11, 'i'); g.px(8, 13, 'i'); g.px(22, 13, 'i');
    g.ell(15, 18, 14.5, 3.5, 'F'); g.ell(15, 17.5, 13, 2.2, 'c'); g.ell(13, 17.2, 7, 1, 'i');
    g.rect(1, 18, 28, 6, 'Q'); g.rect(1, 22, 28, 2, 'q'); g.rect(0, 24, 30, 2, 'n');
    for (let x = 3; x < 28; x += 6) g.rect(x, 19, 1, 3, 'F');
    return g.sprite();
  }
  // Garden bench (22x13)
  function makeBench() {
    const g = Grid(22, 13);
    g.rect(1, 0, 20, 2, 't'); g.rect(1, 3, 20, 2, 't'); g.rect(1, 1, 20, 1, 'T'); g.rect(1, 4, 20, 1, 'T');
    g.rect(0, 7, 22, 2, 'l'); g.rect(0, 8, 22, 1, 't');
    for (const x of [1, 19]) { g.rect(x, 0, 2, 13, 'A'); }
    g.rect(1, 10, 20, 1, 'A');
    return g.sprite();
  }
  // Garden gnome (9x13)
  function makeGnome() {
    const g = Grid(9, 13);
    g.px(4, 0, 'r'); g.rect(3, 1, 3, 1, 'r'); g.rect(2, 2, 5, 2, 'r'); g.rect(2, 4, 5, 1, 'R');
    g.rect(3, 5, 3, 1, 'l'); g.px(4, 5, 'o');
    g.rect(2, 6, 5, 3, 'w'); g.rect(3, 9, 3, 1, 'w');
    g.rect(1, 7, 1, 3, 'b'); g.rect(7, 7, 1, 3, 'b'); g.rect(2, 9, 1, 2, 'b'); g.rect(6, 9, 1, 2, 'b');
    g.rect(2, 11, 2, 2, 'T'); g.rect(5, 11, 2, 2, 'T');
    return g.sprite();
  }
  // Round hay bale (16x13)
  function makeHay() {
    const g = Grid(16, 13);
    g.ell(8, 6.5, 7.8, 6.3, 'Y'); g.ell(7.5, 6, 6.8, 5.4, 'y');
    for (let r = 2; r < 7; r += 2) for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; g.px(Math.round(7.5 + Math.cos(t) * r), Math.round(6 + Math.sin(t) * r * 0.85), 'Y'); }
    g.rect(0, 5, 16, 1, 'T'); g.px(3, 2, 'x'); g.px(5, 1, 'x'); g.px(11, 10, 'O');
    return g.sprite();
  }
  // Robot lawn mower (14x9)
  function makeMower() {
    const g = Grid(14, 9);
    g.rect(1, 2, 12, 4, 'o'); g.rect(2, 1, 10, 1, 'o'); g.rect(1, 5, 12, 1, 'O'); g.rect(4, 2, 6, 2, 'A'); g.px(5, 2, 'z'); g.px(8, 2, 'r');
    g.rect(0, 6, 4, 3, 'k'); g.rect(10, 6, 4, 3, 'k'); g.px(1, 7, 'n'); g.px(11, 7, 'n'); g.rect(4, 7, 6, 1, 'V');
    return g.sprite();
  }
  // Yellow chevron turn sign on two posts (22x22); dir 1 = turn right, -1 = turn left
  function makeArrowSign(dir) {
    const g = Grid(22, 22);
    g.rect(0, 0, 22, 12, 'k'); g.rect(1, 1, 20, 10, 'y');
    for (const x0 of [4, 11]) for (let r = 0; r < 4; r++) {
      const x = dir > 0 ? x0 + r : x0 + 3 - r;
      g.rect(x, 2 + r, 3, 1, 'k'); g.rect(x, 9 - r, 3, 1, 'k');
    }
    g.rect(4, 12, 2, 10, 'f'); g.rect(16, 12, 2, 10, 'f'); g.px(4, 12, 'F'); g.px(16, 12, 'F');
    return g.sprite();
  }
  // Dead-end board (16x20): red "X" plate on a post
  function makeDeadEnd() {
    const g = Grid(16, 20);
    g.rect(0, 0, 16, 11, 'R'); g.rect(1, 1, 14, 9, 'r'); g.rect(2, 2, 12, 7, 'w');
    for (let k = 0; k < 6; k++) { g.rect(4 + k, 2 + k, 2, 1, 'r'); g.rect(10 - k, 2 + k, 2, 1, 'r'); }
    g.rect(7, 11, 2, 9, 'T');
    return g.sprite();
  }

  // ---- obstacle / extra dressing sprites --------------------------------------------------
  // Cart tipped on its side with groceries spilling out (22x12)
  function makeTippedCart() {
    const g = Grid(22, 12);
    for (let c = 0; c < 4; c++) { g.rect(2 + c * 3, 1 + (c >> 1), 1, 9 - (c >> 1), 'F'); }
    g.rect(2, 1, 11, 1, 'F'); g.rect(2, 9, 11, 1, 'F'); for (let y = 3; y < 9; y += 2) g.rect(3, y, 9, 1, 'f');
    g.rect(13, 2, 1, 7, 'h'); g.rect(14, 1, 1, 3, 'h');
    g.rect(0, 10, 3, 2, 'k'); g.rect(10, 10, 3, 2, 'k');
    g.rect(15, 8, 3, 3, 'r'); g.rect(18, 9, 2, 2, 'y'); g.rect(16, 6, 2, 2, 'g'); g.px(20, 10, 'o'); g.px(19, 7, 'W'); g.rect(4, 4, 3, 3, 'b');
    return g.sprite();
  }
  // Freezer trolley stacked with ice-cream tubs (16x16)
  function makeFrTrolley() {
    const g = Grid(16, 16);
    g.rect(0, 0, 2, 12, 'f'); g.rect(0, 0, 4, 1, 'F');
    g.rect(2, 10, 14, 2, 'F'); g.rect(2, 11, 14, 1, 'f');
    for (const [x, y, c] of [[3, 6, 'b'], [9, 6, 'p'], [6, 2, 'c']]) { g.rect(x, y, 6, 4, 'e'); g.rect(x, y, 6, 1, c); g.rect(x + 1, y + 2, 4, 1, c); }
    g.rect(2, 12, 2, 2, 'k'); g.rect(13, 12, 2, 2, 'k'); g.rect(3, 14, 12, 1, 'n');
    return g.sprite();
  }
  // Watermelon (11x9), two roll frames
  function makeMelon(f) {
    const g = Grid(11, 9);
    g.ell(5.5, 4.5, 5.4, 4.3, 'G');
    for (let x = f; x < 11; x += 3) for (let y = 0; y < 9; y++) if (Math.hypot((x + 0.5 - 5.5) / 5.4, (y + 0.5 - 4.5) / 4.3) < 1) g.px(x, y, 'V');
    g.px(3, 1, 'v'); g.px(2, 2, 'v');
    return g.sprite();
  }
  // Three traffic cones (19x9)
  function makeConeTrio() {
    const g = Grid(19, 9);
    for (const x0 of [0, 6, 12]) {
      g.rect(x0 + 3, 0, 1, 2, 'o'); g.rect(x0 + 2, 2, 3, 2, 'w'); g.rect(x0 + 2, 4, 3, 1, 'o'); g.rect(x0 + 1, 5, 5, 2, 'o'); g.rect(x0 + 1, 5, 5, 1, 'w');
      g.rect(x0, 7, 7, 2, 'k');
    }
    return g.sprite();
  }
  // Stack of red shopping baskets (12x12)
  function makeBaskets() {
    const g = Grid(12, 12);
    for (let k = 0; k < 4; k++) { const y = 8 - k * 2; g.rect(1, y, 10, 3, 'r'); g.rect(1, y + 2, 10, 1, 'R'); for (let x = 2; x < 11; x += 2) g.px(x, y + 1, 'R'); }
    g.rect(0, 1, 12, 1, 'k'); g.rect(0, 1, 1, 3, 'k'); g.rect(11, 1, 1, 3, 'k');
    return g.sprite();
  }
  // Promo balloon bunch tied to a weight (12x26)
  function makeBalloons() {
    const g = Grid(12, 26);
    for (const [x, y, c] of [[3, 3, 'r'], [8, 3, 'y'], [5.5, 7, 'b']]) { g.ell(x, y, 3, 3.4, c); g.px(Math.floor(x) - 1, Math.floor(y) - 2, 'w'); }
    line(g, 3, 6, 6, 22, 'f'); line(g, 8, 6, 6, 22, 'f'); line(g, 5, 10, 6, 22, 'f');
    g.rect(4, 22, 4, 4, 'n'); g.rect(4, 22, 4, 1, 'F');
    return g.sprite();
  }
  // Market parasol over a small table (24x26)
  function makeParasol(col) {
    const g = Grid(24, 26);
    for (let r = 0; r < 7; r++) { const w = 6 + r * 3; for (let x = 0; x < w; x++) { const X = 12 - (w >> 1) + x; g.px(X, 1 + r, ((X >> 2) & 1) ? col : 'W'); } }
    g.rect(1, 8, 22, 1, SHADE[col] || 'G'); g.rect(11, 0, 2, 1, 'T');
    g.rect(11, 9, 2, 13, 'T');
    g.rect(4, 19, 16, 2, 't'); g.rect(4, 20, 16, 1, 'T'); g.rect(5, 21, 1, 5, 'T'); g.rect(18, 21, 1, 5, 'T');
    g.rect(7, 17, 3, 2, 'r'); g.rect(13, 17, 3, 2, 'o');
    return g.sprite();
  }
  // Yellow/black bollard (5x11)
  function makeBollard() {
    const g = Grid(5, 11);
    g.rect(1, 0, 3, 10, 'y'); for (let y = 1; y < 10; y += 3) g.rect(1, y, 3, 1, 'k'); g.px(1, 0, 'x'); g.rect(0, 10, 5, 1, 'n');
    return g.sprite();
  }
  // EV charging post (10x20)
  function makeCharger() {
    const g = Grid(10, 20);
    g.rect(1, 0, 8, 18, 'W'); g.rect(1, 0, 8, 2, 'g'); g.rect(8, 2, 1, 16, 'E');
    g.rect(2, 4, 5, 4, 'A'); g.rect(3, 5, 3, 2, 'z'); g.rect(3, 10, 3, 3, 'k'); line(g, 4, 13, 6, 17, 'k');
    g.rect(0, 18, 10, 2, 'n');
    return g.sprite();
  }

  // ---------------------------------------------------------------- backgrounds
  // Each builder paints a PER x HORIZON table of [r,g,b]; finishBg() hazes it into the FOG colour.
  function bgCanvas() {
    const C = PK.C, PER = C.PER, HZ = C.HORIZON;
    const pix = new Array(PER * HZ);
    const set = (col, row, c) => { if (row >= 0 && row < HZ) pix[row * PER + (((col % PER) + PER) % PER)] = c; };
    const rect = (c0, r0, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(c0 + i, r0 + j, c); };
    const text = (s, c0, r0, c, sc) => {
      for (const ch of s) {
        const gl = FONT[ch] || FONT[' '];
        for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gl[j][i] === '1') rect(c0 + i * sc, r0 + j * sc, sc, sc, c);
        c0 += 4 * sc;
      }
    };
    const vgrad = (r0, r1, a, b) => { for (let r = r0; r < r1; r++) { const c = mix(rgbHex(a), rgbHex(b), (r - r0) / Math.max(1, r1 - r0 - 1)); for (let x = 0; x < PER; x++) pix[r * PER + x] = c; } };
    return { PER, HZ, pix, set, rect, text, vgrad };
  }
  function finishBg(b, fogHex, haze) {
    const fog = rgbHex(fogHex), out = new Uint32Array(b.PER * b.HZ);
    for (let r = 0; r < b.HZ; r++) {
      const h = Math.min(1, Math.max(0, haze(r)));
      for (let x = 0; x < b.PER; x++) out[r * b.PER + x] = pack(mix(b.pix[r * b.PER + x], fog, h));
    }
    return out;
  }
  const martHaze = (HZ, CEIL) => (r) => (r < CEIL ? 0.08 : r < 48 ? 0.18 : 0.18 + 0.82 * ((r - 47) / (HZ - 48)));

  // Indoor back wall: ceiling with fluorescent panels, hanging aisle signs, SALE banners,
  // shelf silhouettes, fading into FOG at the horizon row.
  function bgMart(o) {
    o = o || {};
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, text = b.text, H = rgbHex, pix = b.pix;
    const CEIL = 14;
    for (let r = 0; r < HZ; r++) {
      const c = r < CEIL ? mix(H('#b8b09f'), H('#d6cebd'), r / (CEIL - 1)) : mix(H('#e3d9c5'), H('#ece3d0'), (r - CEIL) / (HZ - CEIL));
      for (let x = 0; x < PER; x++) pix[r * PER + x] = c;
    }
    const bands = [{ y: 1, h: 3, n: 20, fr: 0.55 }, { y: 6, h: 2, n: 30, fr: 0.5 }, { y: 10, h: 1, n: 45, fr: 0.45 }];
    for (const bd of bands) {
      const segW = PER / bd.n, pw = Math.floor(segW * bd.fr);
      for (let s = 0; s < bd.n; s++) {
        const c0 = Math.floor(s * segW + (segW - pw) / 2);
        rect(c0 - 1, bd.y - 1, pw + 2, bd.h + 2, H('#a9a191'));
        rect(c0, bd.y, pw, bd.h, H('#fffdf2'));
        if (bd.h > 1) rect(c0, bd.y + bd.h - 1, pw, 1, H('#eee9d8'));
      }
    }
    rect(0, CEIL, PER, 1, H('#857c6d')); rect(0, CEIL + 1, PER, 1, H('#a39a89'));
    if (o.glow) {                                   // light pools on the upper wall under the panels
      const segW = PER / 20;
      for (let sI = 0; sI < 20; sI++) {
        const cx = (sI + 0.5) * segW;
        for (let r = CEIL + 2; r < 31; r++) for (let x = Math.floor(cx - 14); x < cx + 14; x++) {
          const f = (1 - Math.abs(x - cx) / 14) * (1 - (r - CEIL) / 18) * 0.35;
          const i = r * PER + (((x % PER) + PER) % PER);
          if (f > 0) pix[i] = mix(pix[i], [255, 252, 236], f);
        }
      }
    }
    const rnd = PK.U.rng(o.seed || 4242);
    const prodCols = ['#d65a50', '#e09a40', '#e8cf5a', '#6cb860', '#5a8ad8', '#62c2d0', '#c870b0', '#f0eee4'].map(H);
    const hdrCols = ['#3f78d8', '#f08a24', '#e04040', '#4cb848', '#f6d23a'].map(H);
    const nS = 30;
    for (let s = 0; s < nS; s++) {
      const c0 = Math.floor(s * PER / nS), c1 = Math.floor((s + 1) * PER / nS) - 2;
      const top = 31 + Math.floor(rnd() * 5);
      rect(c0, top, c1 - c0, HZ - top, H('#5d564c'));
      rect(c0, top, 1, HZ - top, H('#857d70')); rect(c1 - 1, top, 1, HZ - top, H('#857d70'));
      rect(c0, top, c1 - c0, 2, hdrCols[s % hdrCols.length]);
      for (let by = top + 7; by < HZ; by += 5) {
        for (let x = c0 + 1; x < c1 - 1; x += 2) {
          if (rnd() < 0.1) continue;
          const pc = prodCols[Math.floor(rnd() * prodCols.length)];
          const ph = 2 + Math.floor(rnd() * 2);
          rect(x, by - ph, 2, ph, pc);
          set(x + 1, by - ph, mix(pc, [0, 0, 0], 0.25));
        }
        rect(c0 + 1, by, c1 - c0 - 2, 1, H('#a8a092'));
      }
    }
    const banners = o.banners || [o.banner || 'SALE'];
    let aisle = 1;
    for (let k = 0; k < 12; k++) {
      const p = Math.floor(k * PER / 12 + PER / 24);
      if (k % 4 === 0) {
        rect(p - 16, CEIL + 2, 1, 2, H('#6e675c')); rect(p + 15, CEIL + 2, 1, 2, H('#6e675c'));
        rect(p - 23, 18, 46, 12, H('#9e2219'));
        rect(p - 22, 19, 44, 10, H('#d93a2e'));
        rect(p - 22, 19, 44, 1, H('#ffd83a')); rect(p - 22, 28, 44, 1, H('#ffd83a'));
        const banner = banners[(k / 4 | 0) % banners.length];
        text(banner, p - Math.floor(textW(banner, 2) / 2), 20, H('#ffe25a'), 2);
        for (let i = 0; i < 6; i++) { set(p - 23 + i * 9, 30, H('#d93a2e')); set(p - 22 + i * 9, 30, H('#d93a2e')); set(p - 22 + i * 9, 31, H('#d93a2e')); }
      } else {
        const s = String(aisle++), w = 15;
        rect(p - 5, CEIL + 2, 1, 3, H('#6e675c')); rect(p + 4, CEIL + 2, 1, 3, H('#6e675c'));
        rect(p - (w >> 1) - 1, 18, w + 2, 9, H('#1d3f75'));
        rect(p - (w >> 1), 19, w, 7, H('#2d5fa8'));
        text(s, p - Math.floor(textW(s) / 2), 20, H('#ffffff'), 1);
      }
    }
    // promo danglers: little diamond price cards on strings between the aisle signs
    for (let k = 0; k < 36; k++) {
      const p = Math.floor((k + 0.5) * PER / 36) + 9, c = H(['#ffd83a', '#ff5a4a', '#4ab0ff'][k % 3]);
      rect(p, CEIL + 2, 1, 5 + (k & 1) * 2, H('#8a8070'));
      const y0 = CEIL + 7 + (k & 1) * 2;
      for (let r = 0; r < 5; r++) { const w = r < 3 ? r : 4 - r; rect(p - w, y0 + r, w * 2 + 1, 1, c); }
      set(p, y0 + 2, H('#ffffff'));
    }
    return finishBg(b, o.fog || '#ece2cd', martHaze(HZ, CEIL));
  }

  // Freezer wall: cold white ceiling panels, frost and icicles, glass-door cooler wall, ICE signs
  function bgFreezer(fogHex) {
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, H = rgbHex;
    const CEIL = 14;
    b.vgrad(0, CEIL, '#b4c8d6', '#d6e4ee');
    b.vgrad(CEIL, HZ, '#e2edf4', '#eef5fa');
    const bands = [{ y: 1, h: 3, n: 18 }, { y: 6, h: 2, n: 28 }, { y: 10, h: 1, n: 42 }];
    for (const bd of bands) {
      const segW = PER / bd.n, pw = Math.floor(segW * 0.6);
      for (let s = 0; s < bd.n; s++) {
        const c0 = Math.floor(s * segW + (segW - pw) / 2);
        rect(c0 - 1, bd.y - 1, pw + 2, bd.h + 2, H('#9fb6c8'));
        rect(c0, bd.y, pw, bd.h, H('#f6fcff'));
      }
    }
    rect(0, CEIL, PER, 1, H('#7a94a8')); rect(0, CEIL + 1, PER, 1, H('#a8c0d0'));
    const rnd = PK.U.rng(9191);
    for (let x = 0; x < PER; x += 2) {                       // icicles along the seam
      const l = 1 + Math.floor(rnd() * 4);
      for (let j = 0; j < l; j++) set(x, CEIL + 2 + j, H(j === l - 1 ? '#c8e4f4' : '#f4fbff'));
    }
    const bottle = ['#5fd0e0', '#4cb848', '#e04040', '#f08a24', '#f6d23a', '#ffffff', '#d860b0'].map(H);
    const nS = 26;
    for (let s = 0; s < nS; s++) {
      const c0 = Math.floor(s * PER / nS), c1 = Math.floor((s + 1) * PER / nS) - 1;
      const top = 26 + Math.floor(rnd() * 4);
      rect(c0, top, c1 - c0, HZ - top, H('#8aa2b6'));
      rect(c0, top, c1 - c0, 6, H('#2f5f9f'));
      b.text(s % 2 ? 'ICE' : '-20', c0 + Math.floor((c1 - c0 - 11) / 2), top + 1, H('#ffffff'), 1);
      const mid = (c0 + c1) >> 1;
      for (const [d0, d1] of [[c0 + 2, mid - 1], [mid + 1, c1 - 2]]) {
        rect(d0, top + 7, d1 - d0, HZ - top - 7, H('#4f7fa8'));
        for (let sy = top + 12; sy < HZ; sy += 5) {
          for (let x = d0 + 1; x < d1 - 1; x += 2) { if (rnd() < 0.15) continue; rect(x, sy - 3, 1, 3, bottle[Math.floor(rnd() * bottle.length)]); }
          rect(d0, sy, d1 - d0, 1, H('#a8cce4'));
        }
        set(d0 + 1, top + 8, H('#e8f6ff')); set(d0 + 2, top + 9, H('#e8f6ff'));
      }
      rect(mid, top + 7, 1, HZ - top - 7, H('#c3d4e0'));
    }
    // hanging snowflake boards
    for (let k = 0; k < 10; k++) {
      const p = Math.floor(k * PER / 10 + PER / 20);
      rect(p - 4, CEIL + 2, 1, 4, H('#6e8494')); rect(p + 4, CEIL + 2, 1, 4, H('#6e8494'));
      rect(p - 9, 19, 19, 9, H('#1d4f85')); rect(p - 8, 20, 17, 7, H('#3f88c8'));
      // pixel snowflake
      const cx = p, cy = 23, wc = H('#ffffff');
      for (let d = -2; d <= 2; d++) { set(cx + d, cy, wc); set(cx, cy + d, wc); }
      set(cx - 1, cy - 1, wc); set(cx + 1, cy + 1, wc); set(cx - 1, cy + 1, wc); set(cx + 1, cy - 1, wc);
    }
    for (let x = 0; x < PER; x++) {                         // frost crust on the ceiling edge
      const l = 1 + ((hash(x, 3) >>> 30));
      for (let j = 0; j < l; j++) set(x, j, H('#f4fbff'));
      if ((hash(x, 9) >>> 27) === 0) set(x, CEIL + 6 + (x & 7), H('#ffffff'));   // sparkles on the glass
    }
    for (let x = 0; x < PER; x++) {                         // cold vapour rolling out of the coolers
      const t = x / PER * Math.PI * 2, h = 5 + Math.round(3 * Math.sin(t * 13) + 2 * Math.sin(t * 31 + 2));
      for (let r = HZ - h; r < HZ; r++) { const i = r * PER + x; b.pix[i] = mix(b.pix[i], [246, 252, 255], 0.55 * (r - (HZ - h) + 1) / h); }
    }
    // big "FROZEN" header boards hung between the snowflake boards
    for (let k = 0; k < 5; k++) {
      const p = Math.floor((k + 0.25) * PER / 5);
      rect(p - 22, CEIL + 2, 1, 3, H('#6e8494')); rect(p + 21, CEIL + 2, 1, 3, H('#6e8494'));
      rect(p - 25, 17, 50, 9, H('#e8f6ff')); rect(p - 24, 18, 48, 7, H('#2f6fb8'));
      b.text('FROZEN', p - Math.floor(textW('FROZEN') / 2), 19, H('#ffffff'), 1);
      for (let x = p - 25; x < p + 25; x += 3) set(x, 26, H('#f4fbff'));
    }
    return finishBg(b, fogHex, (r) => (r < CEIL ? 0.06 : r < 46 ? 0.2 : 0.2 + 0.8 * ((r - 45) / (HZ - 46))));
  }

  // Market hall: wooden beams, string lights, a wall of green-striped stalls heaped with produce
  function bgMarket(fogHex) {
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, H = rgbHex;
    const CEIL = 14;
    b.vgrad(0, CEIL, '#5a3c24', '#7a5634');
    b.vgrad(CEIL, HZ, '#ead8b2', '#f0e2c0');
    for (const y of [2, 7, 11]) { rect(0, y, PER, y === 2 ? 2 : 1, H('#3e2814')); rect(0, y + (y === 2 ? 2 : 1), PER, 1, H('#9a7448')); }
    for (let x = 0; x < PER; x += 67) rect(x, 0, 2, CEIL, H('#3e2814'));
    // string lights: sagging wires with warm bulbs
    const bulbs = ['#ffd84a', '#ff8a3a', '#fff2b0', '#ff5a5a'].map(H);
    const span = 48;
    for (let x = 0; x < PER; x++) {
      const u = (x % span) / span, y = CEIL + 1 + Math.round(Math.sin(u * Math.PI) * 4);
      set(x, y, H('#3a2a1a'));
      if (x % 6 === 3) { set(x, y + 1, bulbs[(x / 6 | 0) % 4]); set(x, y + 2, bulbs[(x / 6 | 0) % 4]); }
    }
    const flags = ['#e04040', '#f6d23a', '#4cb848', '#3f78d8', '#d860b0', '#f08a24'].map(H);
    const fspan = 72;
    for (let x = 0; x < PER; x++) {                         // bunting
      const u = (x % fspan) / fspan, y = 3 + Math.round(Math.sin(u * Math.PI) * 6);
      set(x, y, H('#2a1a0c'));
      if (x % 6 === 1) { const c = flags[(x / 6 | 0) % flags.length]; rect(x, y + 1, 4, 1, c); rect(x, y + 2, 4, 1, c); rect(x + 1, y + 3, 2, 1, c); set(x + 1, y + 4, c); }
    }
    for (let x = 36; x < PER; x += 144) {                   // paper lanterns
      rect(x, 0, 1, 8, H('#2a1a0c'));
      rect(x - 2, 8, 5, 5, H('#e04040')); rect(x - 1, 7, 3, 7, H('#e04040')); rect(x - 1, 9, 3, 3, H('#ffb040')); set(x, 10, H('#fff2b0'));
      rect(x - 1, 14, 3, 1, H('#2a1a0c'));
    }
    const rnd = PK.U.rng(5150);
    const prod = ['#e04040', '#f08a24', '#f6d23a', '#6cb860', '#8fd06a', '#9a62d8', '#f0eee4'].map(H);
    const awn = [['#3f9a4a', '#f2f2e6'], ['#2f7a3a', '#f6e8b0'], ['#4cb848', '#ffffff']];
    const nS = 22;
    for (let s = 0; s < nS; s++) {
      const c0 = Math.floor(s * PER / nS), c1 = Math.floor((s + 1) * PER / nS) - 2;
      const top = 25 + Math.floor(rnd() * 4), A = awn[s % awn.length];
      for (let x = c0; x < c1; x++) {
        const on = (((x - c0) >> 2) & 1) === 0;
        rect(x, top, 1, 6, H(on ? A[0] : A[1]));
        if (((x - c0) & 3) === 1 || ((x - c0) & 3) === 2) set(x, top + 6, H(on ? A[0] : A[1]));
      }
      rect(c0, top, c1 - c0, 1, H('#1f5a2a'));
      rect(c0 + 1, top + 7, 1, HZ - top - 7, H('#6e4720')); rect(c1 - 2, top + 7, 1, HZ - top - 7, H('#6e4720'));
      const tb = top + 15;
      for (let row = 0; row < 3; row++) for (let x = c0 + 3 + row * 2; x < c1 - 3 - row * 2; x += 2) {
        const pc = prod[Math.floor(rnd() * prod.length)];
        rect(x, tb - 2 - row * 2, 2, 2, pc); set(x, tb - 2 - row * 2, mix(pc, [255, 255, 255], 0.35));
      }
      rect(c0 + 2, tb, c1 - c0 - 4, HZ - tb, H('#a8743c'));
      for (let y = tb + 2; y < HZ; y += 3) rect(c0 + 2, y, c1 - c0 - 4, 1, H('#6e4720'));
      if (s % 4 === 1) {                                  // chalkboard "FRESH" sign
        const p = (c0 + c1) >> 1;
        rect(p - 11, top + 8, 23, 7, H('#24301f')); rect(p - 12, top + 8, 1, 7, H('#8a6a4a')); rect(p + 12, top + 8, 1, 7, H('#8a6a4a'));
        b.text('FRESH', p - 9, top + 9, H('#f4f0d8'), 1);
      }
    }
    // garlic / chilli braids and hanging scales from the beams
    for (let x = 12; x < PER; x += 54) {
      const chilli = (x / 54 | 0) % 2;
      rect(x, CEIL, 1, 3, H('#3a2a1a'));
      for (let j = 0; j < 6; j++) { set(x - 1 + (j & 1), CEIL + 3 + j, H(chilli ? '#d8302a' : '#f4ecd8')); set(x + (j & 1), CEIL + 3 + j, H(chilli ? '#a02018' : '#d8ccb0')); }
    }
    for (let x = 100; x < PER; x += 230) { rect(x, CEIL, 1, 6, H('#5a5048')); rect(x - 4, CEIL + 6, 9, 1, H('#a8a8a8')); rect(x - 4, CEIL + 7, 1, 2, H('#a8a8a8')); rect(x + 4, CEIL + 7, 1, 2, H('#a8a8a8')); rect(x - 5, CEIL + 9, 3, 1, H('#c8c8c8')); rect(x + 3, CEIL + 9, 3, 1, H('#c8c8c8')); }
    return finishBg(b, fogHex, (r) => (r < CEIL ? 0.05 : r < 47 ? 0.15 : 0.15 + 0.85 * ((r - 46) / (HZ - 47))));
  }

  // Rooftop at dusk: purple-orange sky, low sun, city skyline with lit windows, parapet wall
  function bgSkyline(fogHex) {
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, H = rgbHex, pix = b.pix;
    const stops = [[0, '#241a44'], [18, '#5a2f62'], [34, '#b2506a'], [46, '#ec8250'], [HZ - 1, '#ffb878']];
    for (let r = 0; r < HZ; r++) {
      let k = 0; while (k < stops.length - 2 && r > stops[k + 1][0]) k++;
      const a = stops[k], c = stops[k + 1];
      const col = mix(H(a[1]), H(c[1]), Math.min(1, (r - a[0]) / Math.max(1, c[0] - a[0])));
      for (let x = 0; x < PER; x++) pix[r * PER + x] = col;
    }
    const rnd = PK.U.rng(3131);
    for (let i = 0; i < 70; i++) set(Math.floor(rnd() * PER), Math.floor(rnd() * 18), H(rnd() < 0.3 ? '#ffe9c0' : '#c8b8e8'));
    // big retro sun with stripes cut out of its lower half
    const sx = Math.floor(PER * 0.3), sy = 44, R = 15;
    for (let y = sy - R; y <= sy + R; y++) for (let x = sx - R; x <= sx + R; x++) {
      const d = Math.hypot(x - sx, y - sy);
      if (d > R || (y > sy - 2 && ((y - sy) % 4 === 0 || (y - sy) % 4 === 1 && y > sy + 5))) continue;
      set(x, y, mix(H('#fff2a0'), H('#ff9a50'), (y - (sy - R)) / (2 * R)));
    }
    for (let y = sy - R - 12; y <= sy + R + 12; y++) for (let xx = sx - R - 12; xx <= sx + R + 12; xx++) {   // halo
      const d = Math.hypot(xx - sx, y - sy);
      if (d > R && d < R + 12 && y >= 0 && y < HZ) { const i = y * PER + xx; pix[i] = mix(pix[i], H('#ffd090'), 0.35 * (1 - (d - R) / 12)); }
    }
    for (let k = 0; k < 12; k++) {                          // long thin cloud streaks
      const cx = Math.floor(rnd() * PER), cy = 20 + Math.floor(rnd() * 18), w = 30 + Math.floor(rnd() * 70);
      rect(cx, cy, w, 1, H(cy < 30 ? '#8a4a7a' : '#e08a7a')); rect(cx + 6, cy + 1, w - 14, 1, H('#6a3a6a'));
    }
    for (let k = 0; k < 8; k++) {                           // birds
      const bx = Math.floor(rnd() * PER), by = 8 + Math.floor(rnd() * 16), c = H('#1e1430');
      set(bx, by, c); set(bx - 1, by - 1, c); set(bx + 1, by - 1, c); set(bx - 2, by - 1, c); set(bx + 2, by - 1, c);
    }
    // far skyline
    let x = 0;
    while (x < PER) {
      const w = 6 + Math.floor(rnd() * 14), top = 30 + Math.floor(rnd() * 14);
      rect(x, top, w, HZ - top, H('#6a3a6e'));
      x += w + Math.floor(rnd() * 3);
    }
    // near skyline with lit windows, antennas and red beacons
    x = 0;
    while (x < PER) {
      const w = 10 + Math.floor(rnd() * 18), top = 36 + Math.floor(rnd() * 12);
      rect(x, top, w, HZ - top, H('#2e2040'));
      rect(x, top, w, 1, H('#4a3460'));
      for (let wy = top + 3; wy < HZ - 6; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) {
        if (rnd() < 0.45) rect(wx, wy, 1, 2, H(rnd() < 0.8 ? '#ffd86a' : '#9fe8ff'));
      }
      if (rnd() < 0.35) { const ax = x + (w >> 1); rect(ax, top - 6, 1, 6, H('#2e2040')); set(ax, top - 7, H('#ff4040')); }
      else if (rnd() < 0.3 && w > 12) {                      // water tower
        const tx = x + 3; rect(tx, top - 7, 6, 5, H('#2e2040')); rect(tx + 1, top - 2, 1, 2, H('#2e2040')); rect(tx + 4, top - 2, 1, 2, H('#2e2040'));
        for (let r = 0; r < 2; r++) rect(tx + r, top - 8 - r, 6 - r * 2, 1, H('#2e2040'));
      } else if (rnd() < 0.25 && w > 14) {                   // rooftop neon sign
        const nc = H(rnd() < 0.5 ? '#ff5ac8' : '#5af0ff'); rect(x + 2, top - 5, w - 4, 4, H('#1a1028')); rect(x + 3, top - 4, w - 6, 1, nc); rect(x + 3, top - 2, w - 6, 1, nc);
      }
      x += w + 1 + Math.floor(rnd() * 4);
    }
    // parapet wall of the roof deck
    rect(0, HZ - 7, PER, 7, H('#8a7f8a')); rect(0, HZ - 7, PER, 1, H('#c8b8b8'));
    for (let px = 0; px < PER; px += 24) rect(px, HZ - 6, 1, 6, H('#6a6070'));
    // floodlight masts along the parapet and a rooftop billboard
    for (let px = 40; px < PER; px += 160) {
      rect(px, HZ - 22, 1, 15, H('#3a3046')); rect(px - 3, HZ - 24, 7, 2, H('#3a3046')); rect(px - 2, HZ - 22, 5, 1, H('#fff2c0'));
      for (let r = 1; r < 8; r++) for (let i = -r; i <= r; i++) { const q = (HZ - 21 + r) * PER + ((px + i) % PER + PER) % PER; pix[q] = mix(pix[q], H('#fff2c0'), 0.12); }
    }
    for (let k = 0; k < 3; k++) {
      const p = Math.floor((k + 0.6) * PER / 3);
      rect(p - 20, HZ - 26, 40, 13, H('#1a1028')); rect(p - 19, HZ - 25, 38, 11, H('#ff8a3a'));
      b.text('PARK', p - Math.floor(textW('PARK', 2) / 2), HZ - 24, H('#fff6e0'), 2);
      rect(p - 14, HZ - 13, 1, 6, H('#2e2040')); rect(p + 13, HZ - 13, 1, 6, H('#2e2040'));
    }
    return finishBg(b, fogHex, (r) => (r < 44 ? 0 : r < HZ - 7 ? 0.12 * (r - 43) / (HZ - 50) : 0.3 + 0.7 * ((r - (HZ - 7)) / 6)));
  }

  // Graveyard at midnight: black → night-blue sky, stars, a huge haloed full moon, bats, rolling
  // hills with a ruined chapel, crypt and dead-tree silhouettes, an iron fence, mist on the ground.
  function bgGraveyard(fogHex) {
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, H = rgbHex, pix = b.pix;
    const stops = [[0, '#04050b'], [16, '#0a1128'], [34, '#17254a'], [48, '#2a3a62'], [HZ - 1, '#41537a']];
    for (let r = 0; r < HZ; r++) {
      let k = 0; while (k < stops.length - 2 && r > stops[k + 1][0]) k++;
      const a = stops[k], c = stops[k + 1];
      const col = mix(H(a[1]), H(c[1]), Math.min(1, (r - a[0]) / Math.max(1, c[0] - a[0])));
      for (let x = 0; x < PER; x++) pix[r * PER + x] = col;
    }
    const rnd = PK.U.rng(6613);
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(rnd() * PER), y = Math.floor(rnd() * 34), c = H(rnd() < 0.25 ? '#fff6d0' : '#a8b8e8');
      set(x, y, c);
      if (rnd() < 0.08) { set(x - 1, y, mix(c, pix[y * PER + x], 0.5)); set(x + 1, y, mix(c, pix[y * PER + x], 0.5)); }
    }
    // full moon with halo and craters (two of them half-way round, so it is in view more often)
    for (const mx of [Math.floor(PER * 0.58), Math.floor(PER * 0.08)]) {
      const my = 17, R = mx > PER / 2 ? 11 : 6;
      for (let y = my - R - 9; y <= my + R + 9; y++) for (let x = mx - R - 9; x <= mx + R + 9; x++) {
        if (y < 0 || y >= HZ) continue;
        const d = Math.hypot(x - mx, y - my), i = y * PER + (((x % PER) + PER) % PER);
        if (d <= R) {
          let c = mix(H('#fbf6dc'), H('#d8d6c0'), Math.max(0, (x - mx + y - my) / (2 * R)));
          const cr = [[-3, -2, 2.4], [3, 3, 2], [2, -5, 1.4], [-4, 4, 1.6], [5, -1, 1.2]];
          for (const [cx, cy, rr] of cr) if (Math.hypot(x - mx - cx * R / 11, y - my - cy * R / 11) < rr * R / 11) c = mix(c, H('#b8b49c'), 0.6);
          pix[i] = c;
        } else if (d < R + 9) pix[i] = mix(pix[i], H('#9aa8cc'), 0.32 * (1 - (d - R) / 9));
      }
    }
    // bats
    for (let k = 0; k < 9; k++) {
      const x = Math.floor(rnd() * PER), y = 6 + Math.floor(rnd() * 20), c = H('#020308');
      set(x, y, c); set(x - 1, y - 1, c); set(x + 1, y - 1, c); set(x - 2, y, c); set(x + 2, y, c);
    }
    // far hills
    const hill = (amp, base, f1, f2, ph, col) => {
      for (let x = 0; x < PER; x++) {
        const t = x / PER * Math.PI * 2;
        const top = Math.round(base - amp * (0.6 * Math.sin(t * f1 + ph) + 0.4 * Math.sin(t * f2 + ph * 2.3)));
        rect(x, top, 1, HZ - top, col);
      }
    };
    hill(5, 42, 3, 7, 0.7, H('#1a2444'));
    // chapel with steeple, crypt roofs and dead trees on the near ridge
    const sil = H('#0b1022');
    hill(3, 48, 5, 11, 2.1, sil);
    const chapel = (cx) => {
      rect(cx - 10, 38, 20, HZ - 38, sil);
      for (let r = 0; r < 6; r++) rect(cx - 10 + r * 2, 32 + r, 20 - r * 4, 1, sil);           // roof
      rect(cx + 4, 22, 5, 16, sil); for (let r = 0; r < 6; r++) rect(cx + 6 - (r >> 1), 16 + r, 1 + (r >> 1) * 2, 1, sil);
      rect(cx + 6, 12, 1, 4, sil); rect(cx + 5, 13, 3, 1, sil);                                   // spire cross
      rect(cx - 4, 41, 2, 3, H('#e8b850')); rect(cx + 1, 41, 2, 3, H('#e8b850'));               // lit windows
      set(cx + 6, 26, H('#e8b850'));
    };
    chapel(Math.floor(PER * 0.34)); chapel(Math.floor(PER * 0.83));
    const tree = (x0, h) => {
      const top = HZ - 12 - h;
      rect(x0, top, 2, HZ - top, sil);
      for (let k = 0; k < 5; k++) {
        const dir = k & 1 ? 1 : -1, len = 3 + Math.floor(rnd() * 5), y0 = top + 2 + Math.floor(rnd() * h * 0.6);
        for (let j = 0; j < len; j++) set(x0 + (dir > 0 ? 2 : -1) + dir * j, y0 - (j >> 1), sil);
      }
      set(x0, top - 1, sil); set(x0 + 1, top - 2, sil); set(x0 - 1, top - 2, sil);
    };
    for (let k = 0; k < 26; k++) tree(Math.floor(rnd() * PER), 8 + Math.floor(rnd() * 14));
    for (let k = 0; k < 14; k++) {                          // crypt roofs / headstones on the ridge
      const x = Math.floor(rnd() * PER), w = 5 + Math.floor(rnd() * 8), top = HZ - 14 - Math.floor(rnd() * 4);
      rect(x, top, w, HZ - top, sil);
      for (let r = 1; r <= 2; r++) rect(x + r, top - r, w - 2 * r, 1, sil);
    }
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(rnd() * PER), top = HZ - 11 - Math.floor(rnd() * 3);
      rect(x, top, 2, HZ - top, sil); set(x, top - 1, sil);
    }
    // iron fence along the horizon
    const iron = H('#060812');
    rect(0, HZ - 9, PER, 1, iron); rect(0, HZ - 4, PER, 1, iron);
    for (let x = 0; x < PER; x += 3) { rect(x, HZ - 11, 1, 11, iron); }
    for (let x = 0; x < PER; x += 60) { rect(x, HZ - 13, 2, 13, iron); set(x, HZ - 14, iron); set(x + 1, HZ - 14, iron); }
    // a few jack-o'-lantern glints in the dark
    for (let k = 0; k < 10; k++) { const x = Math.floor(rnd() * PER); rect(x, HZ - 3, 2, 1, H('#f08a24')); set(x, HZ - 2, H('#ffd84a')); }
    // mist: rows near the horizon fade into FOG, plus a few brighter fog banks
    const fogC = H(fogHex);
    for (let x = 0; x < PER; x++) {
      const t = x / PER * Math.PI * 2, h = 4 + Math.round(3 * Math.sin(t * 9) + 2 * Math.sin(t * 23 + 1));
      for (let r = HZ - h; r < HZ; r++) pix[r * PER + x] = mix(pix[r * PER + x], mix(fogC, [200, 214, 230], 0.25), 0.45);
    }
    return finishBg(b, fogHex, (r) => (r < 40 ? 0 : r < HZ - 6 ? 0.1 * (r - 39) / (HZ - 46) : 0.25 + 0.75 * ((r - (HZ - 6)) / 5)));
  }

  // Glitch void: black → violet, scanlines, a perspective wireframe grid, SMPTE colour bars,
  // torn horizontal slices, floating ERROR / 404 text, dead-pixel noise
  function bgGlitch(fogHex) {
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, H = rgbHex, pix = b.pix;
    b.vgrad(0, HZ, '#020006', '#2a0a3a');
    const rnd = PK.U.rng(5005);
    // horizon wireframe: horizontal lines bunching toward the horizon + converging verticals
    for (let k = 1; k < 9; k++) { const r = HZ - Math.round(20 / k); rect(0, r, PER, 1, H(k & 1 ? '#3fd8f0' : '#c040e0')); }
    for (let x = 0; x < PER; x += 16) for (let r = HZ - 20; r < HZ; r++) if ((hash(x, 1) >>> 29) !== 0) set(x, r, H('#2fa8c8'));   // a few missing
    // colour-bar billboards
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].map(H);
    for (let k = 0; k < 5; k++) {
      const x0 = Math.floor(k * PER / 5 + rnd() * 80), y0 = 10 + Math.floor(rnd() * 14), w = 7;
      bars.forEach((c, i) => rect(x0 + i * w, y0, w, 14, c));
      rect(x0, y0 + 14, w * 7, 3, H('#101010'));
      for (let i = 0; i < 7; i++) rect(x0 + i * w, y0 + 14, w, 1, bars[6 - i]);
    }
    // floating text
    const words = ['ERROR', '404', 'NULL', 'GLITCH', 'FATAL', '0X0F'];
    for (let k = 0; k < 10; k++) {
      const w = words[k % words.length], x = Math.floor(rnd() * PER), y = 3 + Math.floor(rnd() * 34), sc = rnd() < 0.3 ? 2 : 1;
      b.text(w, x + 1, y, H('#00e8ff'), sc); b.text(w, x - 1, y, H('#ff2ad0'), sc); b.text(w, x, y, H('#ffffff'), sc);
    }
    // dead pixels / noise
    for (let i = 0; i < 400; i++) set(Math.floor(rnd() * PER), Math.floor(rnd() * HZ), H(['#ffffff', '#ff2ad0', '#00e8ff', '#40ff80'][i & 3]));
    // torn slices: copy a band shifted sideways, with a colour cast
    for (let k = 0; k < 6; k++) {
      const r0 = Math.floor(rnd() * (HZ - 4)), hh = 1 + Math.floor(rnd() * 2), sh = Math.floor(rnd() * 24) - 12;
      const cast = [[255, 0, 200], [0, 230, 255], [60, 255, 120]][k % 3];
      for (let r = r0; r < r0 + hh; r++) {
        const row = pix.slice(r * PER, (r + 1) * PER);
        for (let x = 0; x < PER; x++) pix[r * PER + x] = mix(row[(((x + sh) % PER) + PER) % PER], cast, 0.3);
      }
    }
    // scanlines
    for (let r = 0; r < HZ; r += 2) for (let x = 0; x < PER; x++) pix[r * PER + x] = mix(pix[r * PER + x], [0, 0, 0], 0.35);
    return finishBg(b, fogHex, (r) => (r < HZ - 8 ? 0 : (r - (HZ - 8)) / 8 * 0.8));
  }

  // Garden-centre hedge maze: glasshouse roof over a bright sky, distant trees, a tall clipped
  // hedge wall with topiary crowns, arches and flower beds along its foot
  function bgGarden(fogHex) {
    const b = bgCanvas(), PER = b.PER, HZ = b.HZ, rect = b.rect, set = b.set, H = rgbHex, pix = b.pix;
    b.vgrad(0, HZ, '#7cbce8', '#dcf0f4');
    const rnd = PK.U.rng(6060);
    for (let k = 0; k < 14; k++) {                                // soft clouds
      const cx = Math.floor(rnd() * PER), cy = 8 + Math.floor(rnd() * 14), w = 20 + Math.floor(rnd() * 30);
      for (let j = 0; j < 4; j++) rect(cx + j * 3, cy - j, w - j * 6, 1 + (j === 0 ? 1 : 0), H('#f4fbff'));
    }
    // glasshouse roof: white mullions and ridge beams across the top
    for (let x = 0; x < PER; x += 22) for (let r = 0; r < 20; r++) set(x + (r >> 1), r, H('#eef6f8'));
    rect(0, 0, PER, 2, H('#f4f8f8')); rect(0, 10, PER, 1, H('#d8e8ec')); rect(0, 20, PER, 1, H('#c8dce0'));
    for (let x = 0; x < PER; x += 66) rect(x, 0, 2, 22, H('#e4eef0'));
    // hanging baskets from the beams
    for (let x = 30; x < PER; x += 132) { rect(x, 20, 1, 5, H('#5a4a3a')); rect(x - 3, 25, 7, 3, H('#8a5a30')); for (let i = -4; i <= 4; i += 2) set(x + i, 24, H(i & 2 ? '#e05090' : '#f0d040')); set(x - 3, 28, H('#3f8a3a')); set(x + 3, 29, H('#3f8a3a')); }
    // distant tree line
    for (let x = 0; x < PER; x++) {
      const t = x / PER * Math.PI * 2, top = Math.round(34 - 3 * Math.sin(t * 17) - 2 * Math.sin(t * 41 + 1) - (hash(x >> 2, 5) >>> 30));
      rect(x, top, 1, HZ - top, H(((x >> 3) & 1) ? '#4f8a5a' : '#467e52'));
    }
    // tall hedge wall with topiary crowns and arches
    const hw = 40;
    for (let x = 0; x < PER; x++) {
      for (let r = hw; r < HZ; r++) {
        const h = hash(x, r) >>> 28;
        pix[r * PER + x] = H(h < 3 ? '#1f5a26' : h > 12 ? '#4c9a48' : '#2f7a34');
      }
      set(x, hw, H('#5aa850'));
    }
    for (let k = 0; k < 28; k++) {                                // crowns: balls and cones
      const x = Math.floor(k * PER / 28 + 8), ball = k % 3 !== 1;
      if (ball) { for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) if (i * i + j * j <= 25) set(x + i, hw - 6 + j, H(i + j < -3 ? '#5aa850' : '#2f7a34')); rect(x, hw - 1, 1, 1, H('#3a2a1a')); }
      else for (let r = 0; r < 12; r++) rect(x - (r >> 1), hw - 12 + r, (r >> 1) * 2 + 1, 1, H(r < 3 ? '#5aa850' : '#2f7a34'));
    }
    for (let k = 0; k < 9; k++) {                                 // arches into the maze
      const x = Math.floor(k * PER / 9 + 40);
      for (let r = hw + 6; r < HZ; r++) { const w = r < hw + 10 ? Math.round(Math.sqrt(16 - (hw + 10 - r) * (hw + 10 - r)) * 1.5) : 6; rect(x - w, r, w * 2, 1, H('#123a18')); }
    }
    for (let x = 0; x < PER; x++) if ((hash(x, 77) >>> 29) === 0) { set(x, HZ - 2, H(['#f05a8a', '#f6d23a', '#ffffff', '#b070e0'][x & 3])); set(x, HZ - 1, H('#2f7a34')); }
    return finishBg(b, fogHex, (r) => (r < 34 ? 0.04 : r < hw ? 0.12 : 0.1 + 0.6 * ((r - hw) / (HZ - hw))));
  }

  // ---------------------------------------------------------------- road styles
  const ROAD_MART = {
    railPost: '#5d5a55', railDark: '#7a1c1c', railTop: '#cf3a2c', scuff: 'rgba(90,70,50,0.06)', shadow: 'rgba(60,50,40,0.10)',
    curbBase: '#1f1d1b', curb: '#f2c418', lane: ['#62778b', '#6b8094', '#73899d', '#6b8094'], line: '#f4f4f0',
    propShadow: 'rgba(60,45,30,0.16)', edge: '#ffffff', kerb: ['#d8382f', '#f4f4f0'], mark: 'rgba(244,244,240,0.75)', dim: 0.12
  };
  const ROAD_ICE = {
    railPost: '#6a7a88', railDark: '#3a5a7a', railTop: '#cfe6f6', scuff: 'rgba(255,255,255,0.10)', shadow: 'rgba(40,70,100,0.12)',
    curbBase: '#2a4a6a', curb: '#ffffff', lane: ['#22507e', '#2a5a8a', '#326496', '#2a5a8a'], line: '#e8f6ff',
    propShadow: 'rgba(40,80,120,0.16)', edge: '#ffffff', kerb: ['#2f6fb8', '#ffffff'], mark: 'rgba(232,246,255,0.7)', dim: 0.2
  };
  const ROAD_WOOD = {
    railPost: '#4a2e16', railDark: '#6e4720', railTop: '#d8b070', scuff: 'rgba(90,60,30,0.08)', shadow: 'rgba(60,40,20,0.14)',
    curbBase: '#1f4a24', curb: '#f2f2e6', lane: ['#4c535e', '#555c68', '#5d6572', '#555c68'], line: '#f6e8b0',
    propShadow: 'rgba(60,40,20,0.20)', edge: '#fff4d0', kerb: ['#3f9a4a', '#f2f2e6'], mark: 'rgba(246,232,176,0.7)', dim: 0.22
  };
  const ROAD_ASPHALT = {
    railPost: '#5a5560', railDark: '#7a7480', railTop: '#f2c418', scuff: 'rgba(0,0,0,0.06)', shadow: 'rgba(20,10,20,0.14)',
    curbBase: '#1a1a1e', curb: '#f2c418', lane: ['#5e6274', '#666a7c', '#6e7286', '#666a7c'], line: '#f4f0e8',
    propShadow: 'rgba(20,10,30,0.24)', edge: '#ffffff', kerb: ['#d8382f', '#f4f0e8'], mark: 'rgba(244,240,232,0.7)', dim: 0.35
  };
  const ROAD_GRAVE = {   // packed-dirt cemetery path, stone edging, wrought-iron rail
    railPost: '#141320', railDark: '#262434', railTop: '#6c6880', scuff: 'rgba(10,20,30,0.10)', shadow: 'rgba(8,10,24,0.22)',
    curbBase: '#3a3640', curb: '#a29ea6', lane: ['#8a7660', '#937e68', '#9c8670', '#937e68'], line: '#5a4a3e',
    propShadow: 'rgba(4,6,20,0.32)', edge: '#c8c2cc', dim: 0.3
  };
  const ROAD_GLITCH = {
    railPost: '#ff2ad0', railDark: '#1a0828', railTop: '#00e8ff', scuff: 'rgba(0,0,0,0.25)', shadow: 'rgba(255,40,200,0.12)',
    curbBase: '#08040e', curb: '#ff2ad0', lane: ['#1c1430', '#221a3a', '#281f44', '#221a3a'], line: '#40ff80',
    propShadow: 'rgba(0,232,255,0.14)'
  };
  const ROAD_GARDEN = {  // raked gravel path, stone edging, low box-hedge border
    railPost: '#173e1a', railDark: '#1f4a20', railTop: '#4a9a40', scuff: 'rgba(30,60,20,0.06)', shadow: 'rgba(20,40,10,0.18)',
    curbBase: '#5a5048', curb: '#d8d0c0', lane: ['#a89474', '#b4a080', '#bcaa8a', '#b4a080'], line: 'rgba(240,232,212,0.8)',
    propShadow: 'rgba(10,30,10,0.28)', edge: '#e4dcc8', kerb: ['#a8503a', '#e8dcc4'], mark: 'rgba(255,250,235,0.75)'
  };
  const MUD = { rim: '#4a3424', fill: '#6e5038', hi: '#a08060' };
  const GLITCHP = { rim: '#00e8ff', fill: '#ff2ad0', hi: '#ffffff' };
  const MILK = { rim: '#b9c8d4', fill: '#f5f6f2', hi: '#ffffff' };
  const JUICE = { rim: '#c86a14', fill: '#f8a030', hi: '#ffe0a0' };
  const OIL = { rim: '#14121a', fill: '#2a2632', hi: '#8a7aa8' };
  const SLIME = { rim: '#2a7a3a', fill: '#7af08a', hi: '#e0ffe0' };

  // ---------------------------------------------------------------- prop layouts
  // ctx: { tryAdd, lib, rnd, pick, shelfSpr, W, B, T, TEX }
  // generic: lining both sides of the road + outer ring + random fillers
  function genericProps(c, cfg) {
    const T = c.T, N = T.N, P = T.PTS, TAN = T.TAN, B = c.B, W = c.W;
    if (cfg.special) cfg.special(c);
    const step = cfg.step || 8;
    for (let i = 0; i < N; i += step) {
      if (i < 4 || i > N - 4) continue;
      for (const side of [-1, 1]) {
        const t = TAN[i], base = P[i];
        const r = cfg.side(base, i, side);
        if (!r) continue;
        const sc = cfg.vary ? 0.88 + c.rnd() * 0.24 : 1;
        const lat = side * (B + 6 + W[r[0]] * sc * 0.3 + 3 + (cfg.vary ? c.rnd() * 6 : 0));
        c.tryAdd(base[0] - Math.sin(t) * lat, base[1] + Math.cos(t) * lat, r[0], r[1], false, sc);
        if (cfg.back && (i / step | 0) % 2 === 0) {          // a second, deeper row for depth
          const rb = cfg.back(), lb = lat + side * 34;
          if (rb) c.tryAdd(base[0] - Math.sin(t) * lb, base[1] + Math.cos(t) * lb, rb[0], rb[1], false, sc);
        }
      }
    }
    const lo = -40, hi = c.TEX + 40, st = 100;
    for (let s = lo; s < hi; s += st) {
      let r = cfg.ring(); c.tryAdd(s, lo, r[0], r[1], true);
      r = cfg.ring(); c.tryAdd(hi, s, r[0], r[1], true);
      r = cfg.ring(); c.tryAdd(hi - (s - lo), hi, r[0], r[1], true);
      r = cfg.ring(); c.tryAdd(lo, hi - (s - lo), r[0], r[1], true);
    }
    const props = T.props, max = cfg.max || 180;
    for (let tries = 0; tries < 4000 && props.length < max; tries++) {
      const x = 20 + c.rnd() * 984, y = 20 + c.rnd() * 984;
      const r = cfg.fill(x, y);
      if (r) c.tryAdd(x, y, r[0], r[1], false, cfg.vary ? 0.8 + c.rnd() * 0.4 : 1);
    }
  }

  // map 0: the original supermarket layout (kept bit-for-bit: same rng sequence)
  function props0(c) {
    const T = c.T, rnd = c.rnd, lib = c.lib, W = c.W, B = c.B, pick = c.pick, shelfSpr = c.shelfSpr, tryAdd = c.tryAdd;
    const N = T.N, P = T.PTS, TAN = T.TAN, props = T.props;
    const zone = (x, y) => {
      if (x > 400 && x < 680 && y > 365 && y < 455) return 'checkout';
      if (y < 235) return 'frozen';
      if (x < 300 && y > 230 && y < 800) return 'produce';
      return 'grocery';
    };
    const make = (z, x, y, trackside) => {
      const r = rnd();
      if (z === 'checkout') return r < 0.7 ? ['checkout', null] : ['cart', pick(lib.cart)];
      if (z === 'frozen') {
        if (trackside) return r < 0.55 ? ['freezer', pick(lib.freezer)] : ['cooler', pick(lib.cooler)];
        return r < 0.4 ? ['freezer', pick(lib.freezer)] : r < 0.75 ? ['cooler', pick(lib.cooler)] : r < 0.9 ? ['sign', pick(lib.sign)] : ['cart', pick(lib.cart)];
      }
      if (z === 'produce') {
        if (trackside) return r < 0.5 ? ['fruit', pick(lib.fruit)] : r < 0.88 ? ['food', pick(lib.foodP)] : ['sign', lib.sign[2]];
        return r < 0.4 ? ['fruit', pick(lib.fruit)] : r < 0.6 ? ['food', pick(lib.foodP)] : r < 0.75 ? ['boxes', pick(lib.boxes)]
          : r < 0.88 ? ['sign', pick(lib.sign)] : ['cart', pick(lib.cart)];
      }
      if (trackside) return r < 0.5 ? ['shelf', shelfSpr([0, 1, 2, 3, 4])] : r < 0.74 ? ['food', pick(lib.foodG)] : r < 0.82 ? ['cans', pick(lib.cans)] : r < 0.87 ? ['water', lib.water] : r < 0.9 ? ['wet', lib.wet] : r < 0.96 ? ['baskets', lib.baskets] : ['balloons', lib.balloons];
      if (r > 0.97) return ['plant', pick(lib.plant)];
      if (r > 0.93) return [r > 0.95 ? 'balloons' : 'baskets', r > 0.95 ? lib.balloons : lib.baskets];
      return r < 0.4 ? ['shelf', shelfSpr([0, 1, 2, 3, 4])] : r < 0.58 ? ['food', pick(lib.foodG)] : r < 0.7 ? ['cans', pick(lib.cans)]
        : r < 0.8 ? ['boxes', pick(lib.boxes)] : r < 0.9 ? ['sign', pick(lib.sign)] : ['cart', pick(lib.cart)];
    };
    // 1) checkout counters in the hairpin infield, a cart corral near the start
    let lane = 1;
    for (let x = 470; x <= 640; x += 40) tryAdd(x, 410 + (lane & 1) * 4, 'checkout', makeCheckout(lane++));
    for (let k = 0; k < 5; k++) tryAdd(520 + k * 19, 800, 'cart', lib.cart[k & 1]);
    tryAdd(470, 800, 'sign', lib.sign[0]);
    tryAdd(640, 800, 'corral', lib.corral);
    for (const [x, y] of [[300, 300], [720, 420], [300, 700], [760, 760]]) tryAdd(x, y, 'plant', pick(lib.plant));
    for (const [x, y] of [[560, 260], [430, 600], [610, 640]]) tryAdd(x, y, 'water', lib.water);
    // 2) aisle walls: props lining both sides of the track every ~36 units
    for (let i = 0; i < N; i += 8) {
      if (i < 4 || i > N - 4) continue; // keep the start line view open
      for (const side of [-1, 1]) {
        const t = TAN[i], base = P[i];
        const z0 = zone(base[0], base[1]);
        if (z0 === 'checkout') continue;
        const [kind, spr0] = make(z0, base[0], base[1], true);
        const lat = side * (B + 6 + W[kind] * 0.3 + 3);
        const x = base[0] - Math.sin(t) * lat, y = base[1] + Math.cos(t) * lat;
        if (zone(x, y) === 'checkout') continue;
        if (spr0) tryAdd(x, y, kind, spr0);
      }
    }
    // 3) outer ring of shelves outside the texture so the horizon isn't empty
    const lo = -40, hi = c.TEX + 40, step = 100;
    for (let s = lo; s < hi; s += step) {
      tryAdd(s, lo, 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
      tryAdd(hi, s, 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
      tryAdd(hi - (s - lo), hi, 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
      tryAdd(lo, hi - (s - lo), 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
    }
    // 4) random fillers across the store floor (infields, margins)
    for (let tries = 0; tries < 4000 && props.length < 226; tries++) {
      const x = 20 + rnd() * 984, y = 20 + rnd() * 984;
      const z = zone(x, y);
      const [kind, spr0] = make(z, x, y, false);
      tryAdd(x, y, kind, spr0 || makeCheckout(lane++));
    }
  }

  function props1(c) {     // 냉동 코너
    const L = c.lib, pick = c.pick, rnd = c.rnd;
    genericProps(c, {
      max: 230, step: 7, vary: true,
      back() { const r = rnd(); return r < 0.6 ? ['cooler', pick(L.cooler)] : r < 0.8 ? ['ftrolley', L.ftrolley] : ['icecream', L.icecream]; },
      special(c2) {
        for (let k = 0; k < 4; k++) c2.tryAdd(470 + (k & 1) * 22, 300 + k * 60, 'penguin', L.penguin);
        for (const [x, y] of [[250, 420], [250, 600], [740, 420], [720, 760]]) c2.tryAdd(x, y, 'snowman', L.snowman);
        for (const [x, y] of [[250, 300], [745, 300], [480, 560]]) c2.tryAdd(x, y, 'icecream', L.icecream);
      },
      side() {
        const r = rnd();
        return r < 0.4 ? ['freezer', pick(L.freezer)] : r < 0.76 ? ['cooler', pick(L.cooler)] : r < 0.86 ? ['ice', L.ice] : r < 0.91 ? ['icecream', L.icecream]
          : r < 0.94 ? ['wet', L.wet] : r < 0.97 ? ['ftrolley', L.ftrolley] : ['sign', pick(L.signIce)];
      },
      ring() { return ['cooler', pick(L.cooler)]; },
      fill() {
        const r = rnd();
        return r < 0.3 ? ['freezer', pick(L.freezer)] : r < 0.55 ? ['cooler', pick(L.cooler)] : r < 0.75 ? ['ice', L.ice]
          : r < 0.82 ? ['penguin', L.penguin] : r < 0.87 ? ['snowman', L.snowman] : r < 0.91 ? ['icecream', L.icecream] : r < 0.95 ? ['sign', pick(L.signIce)] : ['cart', pick(L.cart)];
      }
    });
  }
  function props2(c) {     // 청과 시장
    const L = c.lib, pick = c.pick, rnd = c.rnd;
    genericProps(c, {
      max: 240, step: 7, vary: true,
      back() { const r = rnd(); return r < 0.5 ? ['awning', pick(L.awning)] : r < 0.75 ? ['parasol', pick(L.parasol)] : ['cstack', pick(L.cstack)]; },
      special(c2) { for (const [x, y] of [[320, 300], [300, 520], [700, 480], [640, 760], [460, 700]]) c2.tryAdd(x, y, 'bunting', L.bunting); },
      side() {
        const r = rnd();
        return r < 0.34 ? ['awning', pick(L.awning)] : r < 0.58 ? ['food', pick(L.foodP)] : r < 0.72 ? ['crate', pick(L.crate)] : r < 0.8 ? ['cstack', pick(L.cstack)]
          : r < 0.86 ? ['flowers', pick(L.flowers)] : r < 0.9 ? ['sacks', L.sacks] : r < 0.95 ? ['parasol', pick(L.parasol)] : ['fruit', pick(L.fruit)];
      },
      ring() { return rnd() < 0.75 ? ['awning', pick(L.awning)] : ['bunting', L.bunting]; },
      fill() {
        const r = rnd();
        return r < 0.2 ? ['awning', pick(L.awning)] : r < 0.34 ? ['fruit', pick(L.fruit)] : r < 0.5 ? ['crate', pick(L.crate)] : r < 0.6 ? ['cstack', pick(L.cstack)]
          : r < 0.7 ? ['food', pick(L.foodP)] : r < 0.78 ? ['flowers', pick(L.flowers)] : r < 0.85 ? ['sacks', L.sacks] : r < 0.9 ? ['bunting', L.bunting]
          : r < 0.95 ? ['sign', pick(L.signMk)] : ['cart', pick(L.cart)];
      }
    });
  }
  function props3(c) {     // 옥상 주차장
    const L = c.lib, pick = c.pick, rnd = c.rnd;
    genericProps(c, {
      max: 225, step: 7,
      back() { const r = rnd(); return r < 0.55 ? ['car', pick(L.car)] : r < 0.75 ? ['lamp', L.lamp] : ['charger', L.charger]; },
      special(c2) {
        c2.tryAdd(560, 705, 'gate', L.gate); c2.tryAdd(560, 575, 'corral', L.corral);
        for (const [x, y] of [[380, 400], [620, 420], [620, 160], [300, 700]]) c2.tryAdd(x, y, 'vending', pick(L.vending));
      },
      side() {
        const r = rnd();
        return r < 0.4 ? ['car', pick(L.car)] : r < 0.53 ? ['lamp', L.lamp] : r < 0.7 ? ['cone', L.cone] : r < 0.84 ? ['jersey', L.jersey]
          : r < 0.88 ? ['ptree', pick(L.ptree)] : r < 0.91 ? ['bin', L.bin] : r < 0.94 ? ['bollard', L.bollard] : r < 0.97 ? ['charger', L.charger] : ['vending', pick(L.vending)];
      },
      ring() { const r = rnd(); return r < 0.4 ? ['lamp', L.lamp] : r < 0.75 ? ['jersey', L.jersey] : ['ptree', pick(L.ptree)]; },
      fill() {
        const r = rnd();
        return r < 0.5 ? ['car', pick(L.car)] : r < 0.58 ? ['lamp', L.lamp] : r < 0.7 ? ['cone', L.cone] : r < 0.8 ? ['jersey', L.jersey]
          : r < 0.86 ? ['ptree', pick(L.ptree)] : r < 0.9 ? ['vending', pick(L.vending)] : r < 0.94 ? ['bin', L.bin] : ['sign', L.signP];
      }
    });
  }
  // 유령 묘지 서킷: the moonlit pond sits inside the big right-hand curve
  const POND = { x: 775, y: 345, rx: 92, ry: 76 };
  const inPond = (x, y, m) => { const dx = (x - POND.x) / (POND.rx + m), dy = (y - POND.y) / (POND.ry + m); return dx * dx + dy * dy < 1; };
  function props4(c) {
    const L = c.lib, pick = c.pick, rnd = c.rnd;
    const tomb = () => (rnd() < 0.5 ? ['tomb', L.tomb] : ['slab', L.slab]);
    genericProps(c, {
      max: 220, step: 8,
      back() { const r = rnd(); return r < 0.45 ? ['tree', L.tree] : r < 0.75 ? tomb() : ['cross', L.cross]; },
      special(c2) {
        // central cemetery: rows of headstones and crosses behind an iron fence, crypts at the back
        for (let row = 0; row < 4; row++) for (let k = 0; k < 6; k++) {
          const x = 235 + k * 34 + (row & 1) * 12, y = 300 + row * 46, r = rnd();
          const [kind, spr] = r < 0.4 ? ['tomb', L.tomb] : r < 0.7 ? ['slab', L.slab] : r < 0.9 ? ['cross', L.cross] : ['grave', L.grave];
          c2.tryAdd(x, y, kind, spr);
        }
        for (const [x, y] of [[300, 250], [400, 255], [560, 420], [640, 455]]) c2.tryAdd(x, y, 'crypt', L.crypt);
        for (let x = 225; x < 440; x += 25) { c2.tryAdd(x, 492, 'fence', L.fence); }
        // dead trees and ghosts around the pond, candles at the crypt doors, pumpkins at the start
        for (let k = 0; k < 10; k++) {
          const a = k / 10 * Math.PI * 2 + 0.3;
          c2.tryAdd(POND.x + Math.cos(a) * (POND.rx + 16), POND.y + Math.sin(a) * (POND.ry + 16), k % 3 === 1 ? 'ghost' : 'tree', k % 3 === 1 ? L.ghost : L.tree);
        }
        for (const [x, y] of [[300, 270], [400, 275], [585, 440]]) c2.tryAdd(x, y, 'candle', L.candle);
        for (let k = 0; k < 4; k++) c2.tryAdd(190, 470 + k * 60, 'pumpkin', L.pumpkin);
        // the hairpin "crypt gate": a crypt and fences in its eye
        c2.tryAdd(560, 630, 'crypt', L.crypt);
      },
      side(base) {
        if (inPond(base[0], base[1], 60)) return rnd() < 0.5 ? ['tree', L.tree] : null;
        const r = rnd();
        return r < 0.22 ? tomb() : r < 0.42 ? ['fence', L.fence] : r < 0.52 ? ['cross', L.cross] : r < 0.62 ? ['pumpkin', L.pumpkin]
          : r < 0.72 ? ['candle', L.candle] : r < 0.82 ? ['tree', L.tree] : r < 0.9 ? ['grave', L.grave] : ['ghost', L.ghost];
      },
      ring() { const r = rnd(); return r < 0.45 ? ['tree', L.tree] : r < 0.75 ? ['crypt', L.crypt] : ['fence', L.fence]; },
      fill(x, y) {
        if (inPond(x, y, 14)) return null;
        const r = rnd();
        return r < 0.3 ? tomb() : r < 0.42 ? ['cross', L.cross] : r < 0.54 ? ['grave', L.grave] : r < 0.64 ? ['tree', L.tree]
          : r < 0.72 ? ['pumpkin', L.pumpkin] : r < 0.8 ? ['candle', L.candle] : r < 0.88 ? ['ghost', L.ghost] : r < 0.94 ? ['crypt', L.crypt] : ['fence', L.fence];
      }
    });
  }

  // floor decals before the road (map 4): moonlit pond with reeds, footpaths, open graves, moss
  function decor4(g) {
    const rnd = PK.U.rng(4404);
    // trodden footpaths through the cemetery
    g.strokeStyle = 'rgba(92,78,68,0.75)'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(215, 520); g.lineTo(430, 520); g.moveTo(350, 230); g.lineTo(350, 500); g.moveTo(230, 410); g.lineTo(440, 410); g.stroke();
    // moss / dark grass blotches
    for (let k = 0; k < 120; k++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(30,58,50,0.5)' : 'rgba(96,130,110,0.25)';
      g.beginPath(); g.ellipse(rnd() * 1024, rnd() * 1024, 6 + rnd() * 18, 4 + rnd() * 10, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    // pond: muddy bank, reeds, dark water, ripples, the moon's reflection
    const P = POND;
    g.fillStyle = '#4a4440'; g.beginPath(); g.ellipse(P.x, P.y, P.rx + 7, P.ry + 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16233c'; g.beginPath(); g.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d2e4e'; g.beginPath(); g.ellipse(P.x - 8, P.y - 6, P.rx - 14, P.ry - 14, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(150,170,210,0.35)'; g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.ellipse(P.x + 18, P.y - 10, 12 + k * 10, 6 + k * 5, 0, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#e8e8d0'; g.beginPath(); g.arc(P.x + 18, P.y - 10, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c8c8b4'; g.beginPath(); g.arc(P.x + 15, P.y - 12, 3, 0, Math.PI * 2); g.fill();
    for (const [lx, ly] of [[P.x - 40, P.y + 30], [P.x - 10, P.y + 44], [P.x + 45, P.y + 25]]) {   // lily pads
      g.fillStyle = '#2a5a3a'; g.beginPath(); g.arc(lx, ly, 6, 0.4, Math.PI * 2); g.lineTo(lx, ly); g.fill();
    }
    g.fillStyle = '#2c4a34';
    for (let k = 0; k < 70; k++) {
      const a = rnd() * Math.PI * 2, rr = 0.94 + rnd() * 0.12;
      g.fillRect(Math.round(P.x + Math.cos(a) * P.rx * rr), Math.round(P.y + Math.sin(a) * P.ry * rr) - 3, 1, 3 + (rnd() * 3 | 0));
    }
    // open graves in the central plot
    for (const [x, y] of [[262, 345], [330, 437], [405, 345]]) {
      g.fillStyle = '#5a4a3e'; g.fillRect(x - 9, y - 5, 18, 10);
      g.fillStyle = '#140e10'; g.fillRect(x - 7, y - 3, 14, 6);
    }
  }

  // cobblestone sections laid over the dirt road (map 4: crypt chicane and the hairpin gate)
  function road4(g, T) {
    const P = T.PTS, TAN = T.TAN, N = T.N, half = T.ROAD_W / 2 - 2, rnd = PK.U.rng(9044);
    for (const [f0, f1] of [[0.165, 0.305], [0.505, 0.625]]) {
      const i0 = Math.round(f0 * N), i1 = Math.round(f1 * N);
      g.lineWidth = T.ROAD_W - 2; g.strokeStyle = '#3e3a44'; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(P[i0][0], P[i0][1]);
      for (let i = i0 + 1; i <= i1; i++) g.lineTo(P[i][0], P[i][1]);
      g.stroke();
      for (let i = i0; i <= i1; i++) {
        const t = TAN[i], sx = -Math.sin(t), sy = Math.cos(t);
        for (let lat = -half + 2 + (i & 1) * 2.5; lat < half - 1; lat += 5) {
          const x = P[i][0] + sx * lat, y = P[i][1] + sy * lat, v = rnd();
          g.fillStyle = v < 0.3 ? '#7c7884' : v < 0.65 ? '#8c8892' : v < 0.9 ? '#9a96a0' : '#6a7a62';  // some mossy
          g.fillRect(Math.round(x - 1.8), Math.round(y - 1.8), 4, 4);
          g.fillStyle = '#b0acb4'; g.fillRect(Math.round(x - 1.8), Math.round(y - 1.8), 2, 1);
        }
      }
    }
  }
  // scattered floor decals (precomputed into the texture; the road strokes later cover the lane)
  const blob = (g, x, y, rx, ry, a, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); g.fill(); };
  function decor0(g) {               // supermarket floor: dropped receipts, price stickers, cereal, cardboard, scuffs
    const rnd = PK.U.rng(1001);
    for (let k = 0; k < 90; k++) blob(g, rnd() * 1024, rnd() * 1024, 6 + rnd() * 16, 2 + rnd() * 4, rnd() * 3, 'rgba(120,100,80,0.07)');
    for (let k = 0; k < 160; k++) {
      const x = rnd() * 1024 | 0, y = rnd() * 1024 | 0, r = rnd();
      if (r < 0.25) { g.fillStyle = '#f4f4ee'; g.fillRect(x, y, 2, 4); g.fillStyle = '#b8b8b0'; g.fillRect(x, y + 1, 2, 1); }      // receipt
      else if (r < 0.5) { g.fillStyle = ['#ffe14d', '#ff6a5a', '#7ad0ff'][k % 3]; g.fillRect(x, y, 3, 2); }                   // sticker
      else if (r < 0.75) { g.fillStyle = '#e0b060'; for (let i = 0; i < 6; i++) g.fillRect(x + (rnd() * 8 | 0), y + (rnd() * 6 | 0), 1, 1); } // cereal
      else { g.fillStyle = '#c89a5a'; g.fillRect(x, y, 4 + (rnd() * 4 | 0), 3); g.fillStyle = '#a07840'; g.fillRect(x, y + 2, 4, 1); } // cardboard
    }
  }
  function decor1(g) {               // freezer: frost patches, meltwater puddles, footprints in the rime
    const rnd = PK.U.rng(1101);
    for (let k = 0; k < 70; k++) blob(g, rnd() * 1024, rnd() * 1024, 8 + rnd() * 22, 6 + rnd() * 14, rnd() * 3, 'rgba(255,255,255,0.28)');
    for (let k = 0; k < 40; k++) { const x = rnd() * 1024, y = rnd() * 1024; blob(g, x, y, 5 + rnd() * 6, 3 + rnd() * 3, rnd() * 3, 'rgba(120,170,210,0.25)'); blob(g, x - 1, y - 1, 2, 1, 0, 'rgba(255,255,255,0.6)'); }
    g.fillStyle = 'rgba(150,180,210,0.35)';
    for (let k = 0; k < 12; k++) { let x = rnd() * 1000, y = rnd() * 1000; const a = rnd() * 6.28; for (let s = 0; s < 10; s++) { g.fillRect((x + (s & 1) * 3) | 0, y | 0, 2, 3); x += Math.cos(a) * 6; y += Math.sin(a) * 6; } }
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 600; k++) g.fillRect(rnd() * 1024 | 0, rnd() * 1024 | 0, 1, 1);
  }
  function decor2(g) {               // market: sawdust, fallen leaves, squashed tomatoes, straw
    const rnd = PK.U.rng(1201);
    for (let k = 0; k < 80; k++) blob(g, rnd() * 1024, rnd() * 1024, 8 + rnd() * 18, 4 + rnd() * 8, rnd() * 3, 'rgba(230,200,140,0.22)');
    for (let k = 0; k < 220; k++) {
      const x = rnd() * 1024 | 0, y = rnd() * 1024 | 0, r = rnd();
      if (r < 0.45) { g.fillStyle = rnd() < 0.5 ? '#4cb848' : '#8fd06a'; g.fillRect(x, y, 2, 1); g.fillRect(x + 1, y + 1, 2, 1); }   // leaf
      else if (r < 0.6) { blob(g, x, y, 2.5, 1.8, 0, '#c8302a'); g.fillStyle = '#f07060'; g.fillRect(x - 1, y - 1, 1, 1); }          // tomato
      else if (r < 0.85) { g.fillStyle = '#e8cf7a'; g.fillRect(x, y, 4, 1); g.fillRect(x + 2, y + 1, 3, 1); }                        // straw
      else { g.fillStyle = '#f08a24'; g.fillRect(x, y, 2, 2); g.fillStyle = '#ffc060'; g.fillRect(x, y, 1, 1); }                        // orange
    }
  }
  function decor3(g) {               // painted arrows + "P" bays on the roof deck infields
    const rnd = PK.U.rng(1301);
    for (let k = 0; k < 18; k++) {   // manhole covers / drains
      const x = 40 + rnd() * 944, y = 40 + rnd() * 944;
      blob(g, x, y, 6, 6, 0, '#2a2630'); blob(g, x, y, 5, 5, 0, '#4a4650');
      g.fillStyle = '#2a2630'; for (let j = -3; j <= 3; j += 2) g.fillRect(x - 4 | 0, y + j | 0, 8, 1);
    }
    g.strokeStyle = 'rgba(20,16,24,0.22)'; g.lineWidth = 1.5;   // old tyre marks in the bays
    for (let k = 0; k < 30; k++) { const x = rnd() * 1024, y = rnd() * 1024, a = rnd() * 6.28, r = 20 + rnd() * 40; for (const o of [0, 4]) { g.beginPath(); g.arc(x, y, r + o, a, a + 0.8 + rnd()); g.stroke(); } }
    g.fillStyle = 'rgba(240,230,210,0.55)';
    for (const [x, y, a] of [[620, 705, 0], [620, 575, Math.PI], [640, 160, 0], [200, 450, Math.PI / 2]]) {
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillRect(-20, -4, 26, 8); g.beginPath(); g.moveTo(6, -12); g.lineTo(22, 0); g.lineTo(6, 12); g.closePath(); g.fill();
      g.restore();
    }
  }

  // map 5: 글리치 월드
  function props5(c) {
    const L = c.lib, pick = c.pick, rnd = c.rnd;
    genericProps(c, {
      max: 200, step: 8,
      back() { const r = rnd(); return r < 0.4 ? ['shard', pick(L.shard)] : r < 0.7 ? ['cube', L.cube] : ['errwin', pick(L.errwin)]; },
      side() {
        const r = rnd();
        return r < 0.2 ? ['errwin', pick(L.errwin)] : r < 0.34 ? ['missing', L.missing] : r < 0.5 ? ['shard', pick(L.shard)] : r < 0.62 ? ['cube', L.cube]
          : r < 0.72 ? ['cursor', L.cursor] : r < 0.82 ? ['loadbar', L.loadbar] : r < 0.9 ? ['bars', L.bars] : ['e404', L.e404];
      },
      ring() { const r = rnd(); return r < 0.4 ? ['e404', L.e404] : r < 0.7 ? ['bars', L.bars] : ['errwin', pick(L.errwin)]; },
      fill() {
        const r = rnd();
        return r < 0.2 ? ['shard', pick(L.shard)] : r < 0.36 ? ['missing', L.missing] : r < 0.5 ? ['cube', L.cube] : r < 0.64 ? ['errwin', pick(L.errwin)]
          : r < 0.74 ? ['e404', L.e404] : r < 0.84 ? ['cursor', L.cursor] : r < 0.92 ? ['loadbar', L.loadbar] : ['bars', L.bars];
      }
    });
  }
  // floor: missing-texture checker patches, RGB-shifted blocks, noise, torn streaks
  function decor5(g) {
    const rnd = PK.U.rng(5150);
    for (let k = 0; k < 26; k++) {
      const x = Math.floor(rnd() * 980), y = Math.floor(rnd() * 980), w = 16 + Math.floor(rnd() * 5) * 8, h = 16 + Math.floor(rnd() * 4) * 8;
      for (let j = 0; j < h; j += 8) for (let i = 0; i < w; i += 8) { g.fillStyle = ((i + j) >> 3) & 1 ? '#000000' : '#ff00dc'; g.fillRect(x + i, y + j, 8, 8); }
    }
    for (let k = 0; k < 60; k++) {
      const x = rnd() * 1024, y = rnd() * 1024, w = 10 + rnd() * 60, h = 2 + rnd() * 8;
      g.fillStyle = ['rgba(0,232,255,0.45)', 'rgba(255,42,208,0.45)', 'rgba(64,255,128,0.4)', 'rgba(0,0,0,0.8)'][k & 3];
      g.fillRect(x | 0, y | 0, w | 0, h | 0);
    }
    for (let k = 0; k < 1400; k++) { g.fillStyle = ['#ffffff', '#00e8ff', '#ff2ad0', '#40ff80'][k & 3]; g.fillRect(rnd() * 1024 | 0, rnd() * 1024 | 0, 1, 1); }
  }
  // road: corrupted lane blocks
  function road5(g, T) {
    const P = T.PTS, TAN = T.TAN, N = T.N, rnd = PK.U.rng(5251), half = T.ROAD_W / 2 - 3;
    for (let i = 0; i < N; i += 3) {
      if (rnd() > 0.22) continue;
      const t = TAN[i], lat = (rnd() * 2 - 1) * half, x = P[i][0] - Math.sin(t) * lat, y = P[i][1] + Math.cos(t) * lat;
      const w = 3 + (rnd() * 8 | 0), h = 2 + (rnd() * 4 | 0);
      g.fillStyle = ['#00e8ff', '#ff2ad0', '#40ff80', '#000000', '#3a2a60'][rnd() * 5 | 0];
      g.fillRect(x | 0, y | 0, w, h);
    }
  }

  // map 6: 미로 정원 — hedge walls on both sides, dead-end alcoves, chevron signs at blind corners
  function props6(c) {
    const T = c.T, L = c.lib, rnd = c.rnd, pick = c.pick, N = T.N, P = T.PTS, TAN = T.TAN, B = c.B, ad = PK.U.angDiff;
    // 1) dead-end side alcoves: a gravel spur off a straight into a big hedge block (visual only:
    //    the invisible wall still closes the mouth, where the box-hedge border runs across it)
    const SL = 62, spurs = T._spurs = [];
    for (let i = 30; i < N - 30 && spurs.length < 7; i += 5) {
      if (T._bend(i) > 0.03 || T._bend((i + 9) % N) > 0.06 || T._bend((i - 9 + N) % N) > 0.06) continue;
      if (spurs.some((s) => Math.min(Math.abs(s.i - i), N - Math.abs(s.i - i)) < 60)) continue;
      const sides = rnd() < 0.5 ? [1, -1] : [-1, 1];
      for (const side of sides) {
        const t = TAN[i], nx = -Math.sin(t) * side, ny = Math.cos(t) * side, tx = Math.cos(t), ty = Math.sin(t);
        let ok = true;
        for (let s = B; s <= B + SL + 16 && ok; s += 6) for (const w of [-18, 0, 18]) {
          const x = P[i][0] + nx * s + tx * w, y = P[i][1] + ny * s + ty * w;
          if (x < 24 || y < 24 || x > 1000 || y > 1000) { ok = false; break; }
          const r = T.nearestAll(x, y), di = Math.min(Math.abs(r.i - i), N - Math.abs(r.i - i));
          if (di > 18 && r.d < B + 14) { ok = false; break; }
        }
        if (!ok) continue;
        spurs.push({ i, x0: P[i][0], y0: P[i][1], nx, ny, tx, ty, L: SL });
        break;
      }
    }
    T._noProp = (x, y) => {
      for (const s of spurs) {
        const dx = x - s.x0, dy = y - s.y0, al = dx * s.nx + dy * s.ny, pp = dx * s.tx + dy * s.ty;
        if (al > B - 6 && al < B + s.L + 12 && Math.abs(pp) < 24) return true;
      }
      return false;
    };
    const feats = [['fountain', L.fountain], ['bench', L.bench], ['topiary', L.topiary[0]], ['gnome', L.gnome], ['topiary', L.topiary[2]], ['hay', L.hay], ['bench', L.bench]];
    spurs.forEach((s, k) => {
      const at = (al, pp) => [s.x0 + s.nx * al + s.tx * pp, s.y0 + s.ny * al + s.ty * pp];
      const f = feats[k % feats.length];
      let p = at(B + s.L - 8, 0); c.tryAdd(p[0], p[1], f[0], f[1], true);
      p = at(B + s.L + 18, 0); c.tryAdd(p[0], p[1], 'hedge', pick(L.hedge), true);                 // the hedge that closes it
      for (const pp of [-16, 16]) { p = at(B + s.L + 12, pp); c.tryAdd(p[0], p[1], 'hedge', pick(L.hedge), true); }
      p = at(B + 10, 13); c.tryAdd(p[0], p[1], 'deadend', L.deadend, true);                        // "X" board at the mouth
    });
    // 2) chevron signs on the outside of blind corners that follow a long run-up
    let last = -99;
    for (let i = 0; i < N; i++) {
      const bi = T._bend(i);
      if (bi < 1.0 || i - last < 20) continue;
      let peak = true;
      for (let k = -5; k <= 5; k++) if (T._bend((i + k + N) % N) > bi) { peak = false; break; }
      if (!peak) continue;
      last = i;
      const i0 = (i - 14 + N) % N, i1 = (i + 14) % N;
      if (T._bend((i - 26 + N) % N) > 0.12) continue;                                           // only after a straight
      const dir = ad(TAN[i0], TAN[i1]) > 0 ? 1 : -1, t = TAN[i0];
      for (const dd of [B + 22, B + 30]) {
        if (c.tryAdd(P[i][0] + Math.cos(t) * dd, P[i][1] + Math.sin(t) * dd, 'arrow', L.arrow[dir > 0 ? 1 : 0])) break;
      }
    }
    // 3) the hedge walls: one clipped block every ~24 units on both sides (shared between
    //    neighbouring corridors, where it forms the wall between them)
    for (let i = 0; i < N; i += 4) {
      for (const side of [-1, 1]) {
        const t = TAN[i], lat = side * (B + 14);
        c.tryAdd(P[i][0] - Math.sin(t) * lat, P[i][1] + Math.cos(t) * lat, 'hedge', pick(L.hedge));
      }
    }
    // 4) outer ring + the hedge blocks' interiors
    const lo = -30, hi = c.TEX + 30;
    for (let s = lo; s < hi; s += 26) {
      c.tryAdd(s, lo, 'hedge', pick(L.hedge), true); c.tryAdd(hi, s, 'hedge', pick(L.hedge), true);
      c.tryAdd(hi - (s - lo), hi, 'hedge', pick(L.hedge), true); c.tryAdd(lo, hi - (s - lo), 'hedge', pick(L.hedge), true);
    }
    for (let tries = 0; tries < 5000 && T.props.length < 360; tries++) {
      const x = 20 + rnd() * 984, y = 20 + rnd() * 984, r = rnd();
      const k = r < 0.8 ? ['hedge', pick(L.hedge)] : r < 0.88 ? ['topiary', pick(L.topiary)] : r < 0.93 ? ['hay', L.hay] : r < 0.97 ? ['gnome', L.gnome] : ['fountain', L.fountain];
      c.tryAdd(x, y, k[0], k[1]);
    }
  }
  // floor (map 6): hedge tops everywhere off the path, gravel spurs into the dead-end alcoves
  function decor6(g, T) {
    g.fillStyle = g.createPattern(tileCanvas(makeTile(hedgeTop)), 'repeat');
    g.fillRect(0, 0, PK.C.TEX, PK.C.TEX);
    const B = T.BARRIER;
    for (const s of T._spurs || []) {
      const a = [s.x0 + s.nx * (B - 8), s.y0 + s.ny * (B - 8)], e = [s.x0 + s.nx * (B + s.L - 8), s.y0 + s.ny * (B + s.L - 8)];
      g.lineCap = 'round';
      for (const [w, col] of [[30, '#3e2e20'], [27, '#cfc6b0'], [23, '#b4a080']]) {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(e[0], e[1]); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(e[0], e[1], w * 0.5 + 6, 0, Math.PI * 2); g.fill();
      }
      const rnd = PK.U.rng(s.i * 31 + 7);
      for (let k = 0; k < 160; k++) {
        const al = B - 6 + rnd() * (s.L + 8), pp = (rnd() - 0.5) * 22;
        g.fillStyle = rnd() < 0.5 ? '#9a8668' : '#d4c6a8';
        g.fillRect(Math.round(s.x0 + s.nx * al + s.tx * pp), Math.round(s.y0 + s.ny * al + s.ty * pp), 1, 1);
      }
      g.lineCap = 'butt';
    }
  }
  // gravel grain + raked stripes on the maze path
  function road6(g, T) {
    const P = T.PTS, TAN = T.TAN, N = T.N, rnd = PK.U.rng(6161), half = T.ROAD_W / 2 - 3;
    for (let i = 0; i < N; i++) {
      const t = TAN[i], sx = -Math.sin(t), sy = Math.cos(t);
      for (let k = 0; k < 12; k++) {
        const lat = (rnd() * 2 - 1) * half, v = rnd();
        g.fillStyle = v < 0.4 ? '#8e7a5c' : v < 0.8 ? '#d0c0a0' : '#ece2cc';
        g.fillRect(Math.round(P[i][0] + sx * lat), Math.round(P[i][1] + sy * lat), 1, 1);
      }
    }
  }
  // closed rectilinear route through grid nodes (pitch 100) -> spline control points with
  // rounded 90-degree corners (radius ~R)
  function mazeCtrl(nodes, R) {
    const Pn = nodes.map((n) => [110 + 100 * n[0], 110 + 100 * n[1]]), M = Pn.length, out = [Pn[0]];
    for (let k = 1; k < M; k++) {
      const c = Pn[k], a = Pn[k - 1], b = Pn[(k + 1) % M];
      const di = [Math.sign(c[0] - a[0]), Math.sign(c[1] - a[1])], dO = [Math.sign(b[0] - c[0]), Math.sign(b[1] - c[1])];
      out.push([c[0] - di[0] * R, c[1] - di[1] * R]);
      out.push([c[0] - (di[0] - dO[0]) * R * 0.3, c[1] - (di[1] - dO[1]) * R * 0.3]);
      out.push([c[0] + dO[0] * R, c[1] + dO[1] * R]);
    }
    return out;
  }
  const MAZE_NODES = [[4, 8], [8, 8], [8, 5], [7, 5], [7, 7], [5, 7], [5, 4], [8, 4], [8, 0], [6, 0], [6, 2], [4, 2], [4, 0],
    [0, 0], [0, 3], [3, 3], [3, 5], [0, 5], [0, 8]];

  // ---------------------------------------------------------------- map definitions
  const MAPDEFS = [
    {
      id: 0, name: 'SUPERMART CIRCUIT', nameKo: '슈퍼마트 서킷', secret: false,
      desc: '진열대 사이를 누비는 기본 서킷 · 계산대 헤어핀과 청과 S자',
      ctrl: [
        [420, 888], [790, 880], [878, 822], [893, 680], [862, 545], [770, 492],
        [470, 488], [378, 462], [350, 405], [378, 352], [470, 336], [610, 336],
        [692, 302], [712, 225], [665, 165], [330, 146], [205, 160], [148, 255],
        [184, 372], [142, 490], [184, 608], [148, 722], [175, 830], [270, 882]
      ],
      tile: tileMart, fog: '#ece2cd', bg: () => bgMart({ banners: ['SALE', 'FRESH', 'DRINK'], glow: true }), road: ROAD_MART, puddle: MILK, decor: decor0, stencil: ['SALE', 'CART'],
      pads: [[0.07, 8], [0.30, -8], [0.62, 0], [0.70, 9]],
      puddles: [[0.19, -9, 8], [0.475, 10, 7], [0.80, -10, 9], [0.875, 9, 8]],
      ice: [], grip: 1, theme: 1, fx: 'none', seed: 20261107, mini: { bg: 'rgba(236,226,205,0.16)', edge: '#f2c418', road: '#fffaf0' }, props: props0
    },
    {
      id: 1, name: 'FREEZER CORNER', nameKo: '냉동 코너', secret: false,
      desc: '냉동 진열대 사이 두 갈래 골목 · 꽁꽁 언 빙판에선 미끄러져요!',
      ctrl: [
        [470, 905], [760, 905], [880, 870], [915, 780], [915, 680], [870, 570], [915, 460], [915, 230], [880, 140],
        [790, 105], [670, 110], [600, 160], [580, 260], [580, 540], [555, 630], [480, 665], [405, 630], [385, 540],
        [385, 280], [360, 180], [280, 130], [180, 135], [120, 200], [105, 330], [105, 770], [140, 870], [240, 905], [340, 905]
      ],
      tile: tileIce, fog: '#dcecf6', bg: () => bgFreezer('#dcecf6'), road: ROAD_ICE, puddle: MILK, decor: decor1, stencil: ['ICE', '-20'], skid: 'rgba(255,255,255,0.5)',
      pads: [[0.06, 0], [0.24, 8], [0.42, -8], [0.86, 0]],
      puddles: [],
      ice: [[0.15, 0, 16], [0.29, -6, 14], [0.50, 0, 17], [0.66, 6, 15], [0.75, 0, 15], [0.95, -4, 14]],
      grip: 0.85, theme: 1, fx: 'frost', seed: 777001, mini: { bg: 'rgba(200,230,250,0.18)', edge: '#6ab8e8', road: '#ffffff' }, props: props1
    },
    {
      id: 2, name: 'PRODUCE MARKET', nameKo: '청과 시장', secret: false,
      desc: '초록 차양 아래 나무 바닥 · 굽이치는 S자와 쏟아진 오렌지 주스',
      ctrl: [
        [500, 895], [680, 895], [830, 845], [900, 730], [840, 610], [890, 480], [870, 330], [770, 245], [650, 290],
        [545, 385], [440, 350], [400, 240], [330, 140], [200, 150], [130, 270], [195, 400], [145, 520], [195, 640],
        [145, 760], [190, 860], [290, 893], [390, 895]
      ],
      tile: tileWood, fog: '#efe2c0', bg: () => bgMarket('#efe2c0'), road: ROAD_WOOD, puddle: JUICE, decor: decor2, stencil: ['FRESH'],
      pads: [[0.06, 0], [0.33, 7], [0.56, -6], [0.66, 0]],
      puddles: [[0.22, 8, 8], [0.45, -9, 7], [0.78, 9, 8], [0.90, -8, 7]],
      ice: [], grip: 1, theme: 1, fx: 'none', seed: 777002, mini: { bg: 'rgba(240,226,190,0.16)', edge: '#4cb848', road: '#fff2c8' }, props: props2
    },
    {
      id: 3, name: 'ROOFTOP PARKING', nameKo: '옥상 주차장', secret: false,
      desc: '노을 지는 옥상 주차장 · 지그재그 헤어핀 4연속과 기름 웅덩이',
      ctrl: [
        [420, 905], [790, 905], [865, 880], [885, 835], [865, 790], [790, 770], [500, 770], [440, 750], [420, 705],
        [440, 660], [500, 640], [790, 640], [865, 620], [885, 575], [865, 530], [790, 510], [420, 510], [345, 480],
        [315, 400], [330, 315], [400, 250], [480, 225], [790, 225], [870, 200], [885, 150], [860, 108], [790, 95],
        [220, 95], [140, 130], [110, 220], [110, 800], [140, 880], [230, 905], [320, 905]
      ],
      tile: tileAsphalt, fog: '#d98a72', bg: () => bgSkyline('#d98a72'), road: ROAD_ASPHALT, puddle: OIL, stencil: ['SLOW', 'STOP'], zebra: true,
      pads: [[0.05, 0], [0.27, -7], [0.62, 7], [0.82, 0]],
      puddles: [[0.15, 9, 7], [0.40, -9, 7], [0.55, 9, 8], [0.72, -9, 7]],
      ice: [], grip: 1, theme: 1, fx: 'dusk', seed: 777003, mini: { bg: 'rgba(255,170,120,0.16)', edge: '#ff8a50', road: '#fff0e0' }, props: props3, decor: decor3
    },
    {
      id: 4, name: 'GHOST GRAVEYARD', nameKo: '유령 묘지 서킷', secret: true,
      desc: '10% 확률로 나타나는 비밀 맵 · 달빛 묘지의 납골당 시케인과 연못 커브, 엑토플라즘 조심!',
      ctrl: [
        [120, 560], [120, 400], [145, 260], [225, 165], [340, 125], [440, 150], [495, 235], [570, 290], [650, 245],
        [690, 160], [770, 110], [870, 135], [920, 230], [925, 370], [890, 480], [800, 545], [640, 555], [520, 560],
        [450, 600], [440, 660], [490, 705], [600, 710], [760, 710], [860, 750], [890, 840], [830, 905], [700, 915],
        [580, 880], [470, 840], [360, 860], [270, 910], [170, 895], [120, 820], [120, 700]
      ],
      tile: tileGrave, fog: '#34405c', bg: () => bgGraveyard('#34405c'), road: ROAD_GRAVE, puddle: SLIME, skid: 'rgba(40,28,20,0.3)', stencil: ['RIP'],
      pads: [[0.03, 0], [0.37, -7], [0.63, 7], [0.80, 0]],
      puddles: [[0.21, -9, 8], [0.41, 9, 8], [0.58, -8, 7], [0.86, 9, 8]],
      ice: [], grip: 1, theme: 2, ownNight: true, fx: 'haunted', seed: 777004, mini: { bg: 'rgba(40,60,90,0.35)', edge: '#7af08a', road: '#d8e0f0' }, props: props4, decor: decor4, overRoad: road4
    },
    {
      id: 5, name: 'GLITCH WORLD', nameKo: '글리치 월드', secret: true,
      desc: '1% 확률의 초희귀 비밀 맵 · 좁은 도로, 연속 시케인과 헤어핀, 깨진 텍스처 함정!',
      ctrl: [
        [900, 420], [900, 620], [870, 760], [790, 830], [690, 800], [610, 880], [520, 820], [430, 890], [330, 850],
        [240, 900], [140, 860], [110, 760], [170, 680], [110, 600], [130, 480], [240, 450], [360, 500], [450, 600],
        [520, 680], [590, 620], [580, 500], [520, 400], [400, 340], [250, 330], [140, 280], [130, 170], [220, 110],
        [380, 120], [480, 190], [580, 130], [700, 180], [790, 120], [880, 140], [900, 230], [900, 300]
      ],
      roadW: 36, barrier: 34, skid: null, grain: 0.5,
      tile: tileGlitch, fog: '#1a0a2a', bg: () => bgGlitch('#1a0a2a'), road: ROAD_GLITCH, puddle: GLITCHP, iceStyle: 'glitch',
      pads: [[0.04, 0], [0.62, 0]],
      puddles: [[0.12, 6, 7], [0.19, -6, 7], [0.28, 6, 7], [0.36, -6, 7], [0.52, 5, 7], [0.69, -6, 7], [0.80, 6, 7], [0.90, -5, 7]],
      ice: [[0.16, 0, 10], [0.50, 0, 10], [0.83, 0, 10]],
      grip: 1, theme: 1, fx: 'glitch', seed: 777005, mini: { bg: 'rgba(20,0,30,0.5)', edge: '#ff2ad0', road: '#00e8ff' }, props: props5, decor: decor5, overRoad: road5
    },
    {
      id: 6, name: 'HEDGE MAZE', nameKo: '미로 정원', secret: false, noMinimap: true,
      desc: '키 큰 생울타리 미로 · 직각 코너와 지그재그, 막다른 길 조심! (미니맵 없음)',
      ctrl: mazeCtrl(MAZE_NODES, 34),
      roadW: 40, barrier: 34,
      tile: tileLawn, fog: '#d4ecd0', bg: () => bgGarden('#d4ecd0'), road: ROAD_GARDEN, puddle: MUD, skid: 'rgba(90,70,50,0.22)', stencil: ['MAZE'],
      pads: [[0.04, 0], [0.384, 6], [0.612, -6], [0.89, 0]],
      puddles: [[0.258, 8, 7], [0.48, -8, 7], [0.738, 8, 7]],
      ice: [], grip: 1, theme: 1, fx: 'none', seed: 777006, mini: { bg: 'rgba(60,120,60,0.2)', edge: '#2f7a34', road: '#e8dcc0' },
      props: props6, decor: decor6, overRoad: road6
    }
  ];

  // ---------------------------------------------------------------- obstacles per map
  // kinds(rnd) -> [{kind, spr, w (billboard width), r (collision radius), mid (1 = may sit on the
  // centre line, 2 = always centre)}]; moving(rnd) -> sweeping obstacles {kind, spr, w, r, spd, frames}
  const OBS = (kind, spr, w, r, mid) => ({ kind, spr, w, r, mid: mid || 0 });
  const OBSTACLES = {
    0: { n: 9, kinds: () => [OBS('boxes', makeBoxes('r'), 15, 6), OBS('wet', makeWetSign(), 8, 3.5, 2), OBS('tcart', makeTippedCart(), 17, 6.5),
      OBS('cans', makeCans('b'), 13, 5.5), OBS('boxes', makeBoxes('b'), 15, 6), OBS('wet', makeWetSign(), 8, 3.5, 2)] },
    1: { n: 8, kinds: () => [OBS('ice', makeIce(), 12, 5, 1), OBS('ftrolley', makeFrTrolley(), 13, 5.5), OBS('ice', makeIce(), 12, 5)],
      moving: () => [{ kind: 'slideice', spr: makeIce(), w: 12, r: 5, spd: 1.3 }] },
    2: { n: 8, bendMul: 1.4, kinds: (rnd) => [OBS('crate', makeCrate('o', rnd), 13, 5.5), OBS('sacks', makeSacks(), 15, 6), OBS('crate', makeCrate('r', rnd), 13, 5.5),
      OBS('melons', makeFruit(0, rnd), 18, 7)],
      moving: () => { const fr = [makeMelon(0), makeMelon(1)]; return [{ kind: 'melon', spr: fr[0], frames: fr, w: 9, r: 4, spd: 1.8 }, { kind: 'melon', spr: fr[1], frames: fr, w: 9, r: 4, spd: 2.1 }]; } },
    3: { n: 9, kinds: () => [OBS('cones', makeConeTrio(), 15, 5.5), OBS('jersey', makeJersey(), 17, 6.5), OBS('car', makeCar('r'), 20, 8),
      OBS('cones', makeConeTrio(), 15, 5.5), OBS('jersey', makeJersey(), 17, 6.5), OBS('car', makeCar('b'), 20, 8)] },
    4: { n: 9, kinds: () => [OBS('tomb', makeTomb(), 10, 4.5, 1), OBS('pumpkin', makePumpkin(), 11, 4.5, 2), OBS('slab', makeSlab(), 10, 4.5), OBS('cross', makeCross(), 9, 4)] },
    5: { n: 7, bendMul: 1.4, kinds: () => [OBS('missing', makeMissing(), 11, 4.5, 1), OBS('cube', makeWireCube(), 12, 5)],
      moving: () => [{ kind: 'glitchcube', spr: makeMissing(), w: 10, r: 4.2, spd: 2.4 }] },
    6: { n: 10, kinds: (rnd) => [OBS('hay', makeHay(), 13, 5.5), OBS('topiary', makeTopiary(0), 11, 4.5, 1), OBS('gnome', makeGnome(), 7, 3, 2), OBS('hay', makeHay(), 13, 5.5),
      OBS('pot', makePlant(rnd), 10, 4.2, 1)],
      moving: () => [{ kind: 'mower', spr: makeMower(), w: 11, r: 4.5, spd: 1.2 }, { kind: 'mower', spr: makeMower(), w: 11, r: 4.5, spd: 1.5 }] }
  };

  // ---------------------------------------------------------------- the Track object
  let TILE = new Uint32Array(TS * TS);   // outside tile of the current map / theme
  // darker copy of a floor tile (ABGR pixels): the ground next to the road is dimmed by f (0..1)
  function dimTile(t, f) {
    if (!(f > 0)) return t;
    const k = 1 - f, o = new Uint32Array(t.length);
    for (let i = 0; i < t.length; i++) {
      const v = t[i], r = (v & 255) * k, g = ((v >>> 8) & 255) * k, b = ((v >>> 16) & 255) * k;
      o[i] = (v & 0xff000000) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
    }
    return o;
  }
  const cache = [];

  const T = PK.Track = {
    name: '슈퍼마트 서킷', nameKo: '슈퍼마트 서킷',
    MAPS: MAPDEFS.map((d) => ({ id: d.id, name: d.name, nameKo: d.nameKo, secret: !!d.secret, desc: d.desc, noMinimap: !!d.noMinimap })),
    current: -1, def: null,
    N: 0, PTS: null, TAN: null, length: 0,
    ROAD_W: 44, OFFROAD_D: 27, BARRIER: 40,
    texData: null, FOG: 0,
    pads: [], puddles: [], ice: [], props: [], obstacles: [], grip: 1, fx: 'none',
    mini: null,
    _bg: null, _miniS: 1, _miniOX: 0, _miniOY: 0,

    init() { this.load(0); },

    // Build (first time) and switch to map id. Everything a race reads is swapped in.
    load(id) {
      id = Math.max(0, Math.min(MAPDEFS.length - 1, id | 0));
      const def = MAPDEFS[id];
      let e = cache[id];
      if (!e) e = cache[id] = this._build(def);
      this.current = id; this.def = def;
      this.name = def.nameKo; this.nameKo = def.nameKo; this.nameEn = def.name;
      this.N = e.N; this.PTS = e.PTS; this.TAN = e.TAN; this.length = e.length;
      this.ROAD_W = e.ROAD_W; this.OFFROAD_D = e.ROAD_W / 2 + 5; this.BARRIER = e.BARRIER;
      this.pads = e.pads; this.puddles = e.puddles; this.ice = e.ice; this.props = e.props; this.obstacles = e.obstacles;
      this.grip = def.grip; this.fx = def.fx;
      this.mini = e.mini; this._miniS = e.miniS; this._miniOX = e.miniOX; this._miniOY = e.miniOY;
      this._w1 = { bg: e.bg, tex: e.tex, tile: e.tile, fog: e.fog };
      this._w2 = e.night || null;
      this.theme = 1;
      this._bg = e.bg; this.texData = e.tex; TILE = e.tile; this.FOG = e.fog;
      if (def.theme === 2) { this.setTheme(2); e.night = this._w2; }
      return this;
    },

    _build(def) {
      const U = PK.U;
      const cl = buildCenterline(def.ctrl);
      this.N = cl.N; this.PTS = cl.PTS; this.TAN = cl.TAN; this.length = cl.length;
      this.ROAD_W = def.roadW || 44; this.OFFROAD_D = this.ROAD_W / 2 + 5; this.BARRIER = def.barrier || 40;
      TILE = dimTile(def.tile(), def.road && def.road.dim);
      const fog = U.hex(def.fog);
      this._placePadsAndPuddles(def);
      this._placeProps(def);
      this._placeObstacles(def);
      const tex = this._buildTexture(def);
      const bg = def.bg();
      const m = this._buildMini(def);
      return {
        N: cl.N, PTS: cl.PTS, TAN: cl.TAN, length: cl.length, ROAD_W: this.ROAD_W, BARRIER: this.BARRIER,
        pads: this.pads, puddles: this.puddles, ice: this.ice, props: this.props, obstacles: this.obstacles,
        tex, bg, tile: TILE, fog, mini: m.cv, miniS: m.s, miniOX: m.ox, miniOY: m.oy, night: null
      };
    },

    // ---- queries -----------------------------------------------------------------------
    // Nearest centerline index among i0-win..i0+win (wrapping). lat = signed offset along the
    // right vector (-sin t, cos t) of TAN[i]; d = |lat| (perpendicular distance to centerline).
    nearestLocal(i0, x, y, win) {
      const N = this.N, P = this.PTS;
      let best = -1, bd = Infinity;
      i0 = ((Math.round(i0) % N) + N) % N;
      for (let k = -win; k <= win; k++) {
        let i = i0 + k;
        if (i < 0) i += N; else if (i >= N) i -= N;
        const dx = x - P[i][0], dy = y - P[i][1], dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      }
      return this._res(best, x, y);
    },
    nearestAll(x, y) {
      const N = this.N, P = this.PTS;
      let best = 0, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const dx = x - P[i][0], dy = y - P[i][1], dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      }
      return this._res(best, x, y);
    },
    _res(i, x, y) {
      const p = this.PTS[i], t = this.TAN[i];
      const lat = (x - p[0]) * -Math.sin(t) + (y - p[1]) * Math.cos(t);
      return { i, d: Math.abs(lat), lat };
    },
    // grip multiplier at a world point: the map's base grip, much less on an ice patch
    gripAt(x, y) {
      const a = this.ice;
      for (let i = 0; i < a.length; i++) {
        const q = a[i], dx = x - q.x, dy = y - q.y;
        if (dx * dx + dy * dy < q.r * q.r) return this.grip * ICE_GRIP;
      }
      return this.grip;
    },

    sampleOutside(ix, iy) { return TILE[((iy & 63) << 6) | (ix & 63)]; },

    // ---- background: copy precomputed PER x HORIZON table with camera column offset ----
    drawBackground(buf, camA) {
      const C = PK.C, PER = C.PER, W = C.W, HZ = C.HORIZON, bg = this._bg;
      const c0 = ((Math.round(camA * C.FOCAL) - C.CX) % PER + PER) % PER;
      for (let y = 0; y < HZ; y++) {
        const src = y * PER, dst = y * W;
        let c = c0;
        for (let x = 0; x < W; x++) {
          buf[dst + x] = bg[src + c];
          if (++c === PER) c = 0;
        }
      }
    },

    toMini(x, y) { return [x * this._miniS + this._miniOX, y * this._miniS + this._miniOY]; },

    // ---- theme --------------------------------------------------------------------------
    // setTheme(1) = the map's own colours, setTheme(2) = haunted midnight recolour of the current
    // map (cached). load() applies it automatically for maps with theme 2 (map 4), so main.js no
    // longer needs to call it; kept for compatibility.
    theme: 1,
    setTheme(w) {
      w = w === 2 ? 2 : 1;
      if (w === this.theme || !this._bg || !this.texData || !this._w1) return;
      if (w === 2 && !this._w2) this._w2 = this.def && this.def.ownNight ? this._w1 : this._buildNight(this._w1);
      const s = w === 2 ? this._w2 : this._w1;
      this._bg = s.bg; this.texData = s.tex; TILE = s.tile; this.FOG = s.fog;
      this.theme = w;
    },
    _buildNight(src) {
      const PER = PK.C.PER, U = PK.U;
      // dim + cold: lights go teal-grey, colours keep a little saturation, a faint purple lift
      const night = (c) => {
        const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
        return U.rgb(clamp255(r * 0.36 + 10) | 0, clamp255(g * 0.42 + 8) | 0, clamp255(b * 0.52 + 20) | 0);
      };
      const mapArr = (a) => { const o = new Uint32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = night(a[i]); return o; };
      const bg = mapArr(src.bg);
      // fluorescent panels: most flicker out (dark), the survivors glow a sickly green
      const HZ = PK.C.HORIZON;
      for (let r = 0; r < Math.min(HZ, 14); r++) {
        for (let x = 0; x < PER; x++) {
          const c = src.bg[r * PER + x], R = c & 255, G = (c >>> 8) & 255, B = (c >>> 16) & 255;
          if (R + G + B < 700) continue;
          const seg = (x / 9) | 0, h = ((seg * 2654435761) >>> 0) % 7;
          bg[r * PER + x] = h < 2 ? U.rgb(150, 236, 196) : U.rgb(44, 40, 64);
        }
      }
      return { bg, tex: mapArr(src.tex), tile: mapArr(src.tile), fog: night(src.fog) };
    },

    // ---- build steps ------------------------------------------------------------------
    // max heading change over +-6 points (small = straight)
    _bend(i) {
      const N = this.N;
      return Math.abs(PK.U.angDiff(this.TAN[(i - 6 + N) % N], this.TAN[(i + 6) % N]));
    },
    _nearestStraight(i) {
      const N = this.N;
      for (let k = 0; k < N / 2; k++) {
        for (const s of [1, -1]) {
          const j = ((i + s * k) % N + N) % N;
          if (this._bend(j) < 0.06) return j;
        }
      }
      return i;
    },
    // the sharpest point within +-range of i (corner apex)
    _nearestBend(i, range) {
      const N = this.N;
      let best = i, bb = -1;
      for (let k = -range; k <= range; k++) {
        const j = ((i + k) % N + N) % N, b = this._bend(j);
        if (b > bb) { bb = b; best = j; }
      }
      return best;
    },

    _placePadsAndPuddles(def) {
      const N = this.N, P = this.PTS, TAN = this.TAN;
      const at = (i, lat) => {
        const t = TAN[i];
        return [P[i][0] - Math.sin(t) * lat, P[i][1] + Math.cos(t) * lat];
      };
      this.pads = [];
      for (const [f, lat] of def.pads) {
        const i = this._nearestStraight(Math.round(f * N));
        const p = at(i, lat);
        this.pads.push({ x: p[0], y: p[1], a: TAN[i], i });
      }
      this.puddles = [];
      for (const [f, lat, r] of def.puddles) {
        const i = Math.round(f * N);
        const p = at(i, lat);
        this.puddles.push({ x: p[0], y: p[1], r, i });
      }
      this.ice = [];
      for (const [f, lat, r] of def.ice || []) {
        const i = this._nearestBend(Math.round(f * N), 14);
        const p = at(i, lat);
        this.ice.push({ x: p[0], y: p[1], r, i });
      }
    },

    _placeProps(def) {
      const U = PK.U, rnd = U.rng(def.seed), B = this.BARRIER;
      // sprite library (base set first, in the original order, so map 0's rng sequence is unchanged)
      const shelves = [];
      for (let k = 0; k < SHELF_KINDS.length; k++) for (let v = 0; v < 2; v++) shelves.push({ kind: k, spr: makeShelf(k, rnd) });
      const lib = {
        cans: ['r', 'g', 'b'].map(makeCans),
        boxes: ['r', 'b'].map(makeBoxes),
        cart: [makeCart(false), makeCart(true)],
        fruit: [0, 1, 2, 3].map((k) => makeFruit(k, rnd)),
        sign: [makeSign('SALE', 'y', 'r'), makeSign('50%', 'r', 'w'), makeSign('1+1', 'g', 'w')],
        freezer: [makeFreezer(rnd), makeFreezer(rnd)],
        cooler: [makeCooler(rnd), makeCooler(rnd)],
        foodP: FOOD_PRODUCE.map((i) => makeFoodStand(i, def.id === 2 ? '#3f9a4a' : null)),
        foodG: FOOD_GROCERY.map((i) => makeFoodStand(i))
      };
      {   // extra dressing (own rng, so the base sequence above stays identical)
        const r3 = U.rng(def.seed ^ 0x3c3c);
        lib.wet = makeWetSign(); lib.plant = [makePlant(r3), makePlant(r3)]; lib.water = makeWater(); lib.bin = makeBin();
        lib.baskets = makeBaskets(); lib.balloons = makeBalloons(); lib.ftrolley = makeFrTrolley(); lib.parasol = ['r', 'g', 'o'].map(makeParasol);
        lib.bollard = makeBollard(); lib.charger = makeCharger();
        if (def.id === 0 || def.id === 3) lib.corral = makeCorral();
        if (def.id === 1) { lib.snowman = makeSnowman(); lib.icecream = makeIceCream(); }
        if (def.id === 2) { lib.flowers = [makeFlowers(r3), makeFlowers(r3)]; lib.sacks = makeSacks(); lib.cstack = [makeCrateStack(r3), makeCrateStack(r3)]; lib.bunting = makeBunting(); }
        if (def.id === 3) { lib.vending = ['r', 'b', 'g'].map(makeVending); lib.gate = makeGate(); lib.ptree = [makePotTree(r3), makePotTree(r3)]; }
      }
      // extra sprites for the other maps (own rng so the base sequence above stays identical)
      if (def.id !== 0) {
        const r2 = U.rng(def.seed ^ 0x5a5a);
        if (def.id === 1) { lib.ice = makeIce(); lib.penguin = makePenguin(); lib.signIce = [makeSign('ICE', 'c', 'w'), makeSign('-20', 'b', 'w')]; }
        if (def.id === 2) {
          lib.awning = ['g', 'G', 'v', 'g'].map((c) => makeAwning(c, r2));
          lib.crate = ['r', 'o', 'y', 'g', 'u'].map((c) => makeCrate(c, r2));
          lib.signMk = [makeSign('SALE', 'y', 'r'), makeSign('1+1', 'g', 'w')];
        }
        if (def.id === 3) {
          lib.car = ['r', 'b', 'W', 'y', 'g', 's', 'u', 'c'].map(makeCar);
          lib.lamp = makeLamp(); lib.cone = makeCone(); lib.jersey = makeJersey(); lib.signP = makeSign('P', 'b', 'w');
        }
        if (def.id === 4) {
          lib.tomb = makeTomb(); lib.pumpkin = makePumpkin(); lib.candle = makeCandle(); lib.ghost = makeGhost();
          lib.slab = makeSlab(); lib.cross = makeCross(); lib.fence = makeFence(); lib.crypt = makeCrypt(); lib.tree = makeTree(); lib.grave = makeGrave();
        }
        if (def.id === 5) {
          lib.errwin = [makeErrWin('ERR'), makeErrWin('404'), makeErrWin('NULL')]; lib.e404 = make404();
          lib.shard = ['c', 'p', 'z'].map(makeShard); lib.cube = makeWireCube(); lib.missing = makeMissing();
          lib.cursor = makeCursor(); lib.loadbar = makeLoadBar(); lib.bars = makeBars();
        }
        if (def.id === 6) {
          lib.hedge = [makeHedge(r2), makeHedge(r2), makeHedge(r2, 'p'), makeHedge(r2, 'W'), makeHedge(r2)];
          lib.topiary = [0, 1, 2].map(makeTopiary); lib.fountain = makeFountain(); lib.bench = makeBench(); lib.gnome = makeGnome();
          lib.hay = makeHay(); lib.mower = makeMower(); lib.arrow = [makeArrowSign(-1), makeArrowSign(1)]; lib.deadend = makeDeadEnd();
        }
      }
      const W = {
        shelf: 34, cans: 14, boxes: 16, cart: 10, fruit: 22, sign: 13, freezer: 34, cooler: 22, checkout: 30, food: 15,
        ice: 12, penguin: 8, awning: 30, crate: 12, car: 22, lamp: 8, cone: 5, jersey: 18, tomb: 10, pumpkin: 10, candle: 7, ghost: 10,
        slab: 10, cross: 9, fence: 22, crypt: 30, tree: 24, grave: 16,
        wet: 6, plant: 10, water: 14, bin: 6, corral: 28, snowman: 9, icecream: 28, flowers: 22, sacks: 16, cstack: 13, bunting: 30,
        vending: 13, gate: 26, ptree: 12,
        errwin: 26, e404: 28, shard: 18, cube: 14, missing: 13, cursor: 10, loadbar: 22, bars: 20,
        hedge: 26, topiary: 12, fountain: 26, bench: 16, gnome: 7, hay: 13, mower: 11, arrow: 13, deadend: 11,
        tcart: 17, ftrolley: 13, melon: 10, cones: 15, baskets: 10, balloons: 10, parasol: 22, bollard: 4, charger: 8
      };
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const props = this.props = [];
      const self = this;
      this._noProp = null; this._spurs = null;
      // Accept a prop if it is clear of the road (center beyond BARRIER+6, plus a margin for its
      // half-width so the billboard doesn't hang over the lane) and not crowding another prop.
      const tryAdd = (x, y, kind, spr, ignoreRoad, scale) => {
        const w = W[kind] * (scale || 1);
        if (!spr) return false;
        if (!ignoreRoad && self.nearestAll(x, y).d < B + 6 + w * 0.3) return false;
        if (!ignoreRoad && self._noProp && self._noProp(x, y)) return false;
        for (let k = 0; k < props.length; k++) {
          const q = props[k], dx = q.x - x, dy = q.y - y;
          const md = Math.max(18, (q.w + w) * 0.45);
          if (dx * dx + dy * dy < md * md) return false;
        }
        props.push({ x, y, spr, w, kind });
        return true;
      };
      const shelfSpr = (kinds) => { const ok = shelves.filter((s) => kinds.indexOf(s.kind) >= 0); return pick(ok).spr; };
      def.props({ T: this, rnd, lib, W, B, pick, shelfSpr, tryAdd, TEX: PK.C.TEX });
    },

    // ---- obstacles ------------------------------------------------------------------------
    // Solid themed obstacles ON the road (also pushed into props so main.js draws them as
    // billboards). Each: {x, y, r, spr, w, kind, obstacle: true, i, lat, lo, hi, mv}. lo..hi =
    // the lateral band it can occupy (moving ones sweep it). Rules: never on the start straight,
    // boost pads, puddles / ice or food rows; one per spot, covering <= ~40% of the road width,
    // edge ones hug a kerb, centre ones are small, moving ones stay on one half of the road.
    // Karts collide with them in PK.Karts.collide (phased karts pass through).
    _placeObstacles(def) {
      const N = this.N, P = this.PTS, TAN = this.TAN, half = this.ROAD_W / 2;
      const obs = this.obstacles = [];
      const spec = OBSTACLES[def.id];
      if (!spec) return;
      const rnd = PK.U.rng(def.seed ^ 0x0b57);
      const kinds = spec.kinds(rnd), movers = spec.moving ? spec.moving(rnd) : [];
      const foodRows = [];
      for (let j = 0; j < 9; j++) { foodRows.push(Math.floor(N * (j + 0.5) / 9)); foodRows.push(Math.floor(N * (j + 1) / 9) % N); }
      const idist = (a, b) => { const d = Math.abs(a - b) % N; return Math.min(d, N - d); };
      const hazards = this.pads.map((q) => [q.x, q.y, 30]).concat(this.puddles.map((q) => [q.x, q.y, q.r + 16]), this.ice.map((q) => [q.x, q.y, q.r + 16]));
      const valid = (i, straight) => {
        if (i < N * 0.09 || i > N * 0.92) return false;                                  // start straight / grid
        const bl = (straight ? 0.2 : 0.42) * (spec.bendMul || 1);
        if (this._bend(i) > bl || this._bend((i + 8) % N) > bl + 0.12 || this._bend((i - 8 + N) % N) > bl + 0.12) return false;
        if (foodRows.some((f) => idist(f, i) < 6)) return false;
        if (obs.some((o) => idist(o.i, i) < 22)) return false;
        const p = P[i];
        return hazards.every((h) => Math.hypot(h[0] - p[0], h[1] - p[1]) > h[2]);
      };
      const at = (i, lat) => [P[i][0] - Math.sin(TAN[i]) * lat, P[i][1] + Math.cos(TAN[i]) * lat];
      const n = spec.n, f0 = 0.1, f1 = 0.91, total = n + movers.length;
      const slots = [];
      for (let s = 0; s < total; s++) slots.push(f0 + (f1 - f0) * (s + 0.5) / total);
      // movers take the slots with the longest straights nearby, statics the rest
      const moverSlots = new Set();
      if (movers.length) {
        const score = slots.map((f, s) => { let b = 0; const i = Math.round(f * N); for (let k = -20; k <= 20; k += 4) b += this._bend(((i + k) % N + N) % N); return [b, s]; }).sort((a, b) => a[0] - b[0]);
        for (let m = 0; m < movers.length; m++) moverSlots.add(score[m][1]);
      }
      let ki = 0, mi = 0, side = rnd() < 0.5 ? 1 : -1;
      slots.forEach((f, s) => {
        const isMover = moverSlots.has(s), i0 = Math.round(f * N);
        let i = -1;
        for (let k = 0; k < Math.round(N / total * 0.6) && i < 0; k++) {
          for (const sg of [1, -1]) { const j = ((i0 + sg * k) % N + N) % N; if (valid(j, isMover)) { i = j; break; } }
        }
        if (i < 0) return;
        side = -side;
        // coming out of a corner karts run wide: put the obstacle on the inside of that exit
        let turn = 0;
        for (let k = 0; k < 30; k += 2) turn += PK.U.angDiff(TAN[((i - k - 2) % N + N) % N], TAN[((i - k) % N + N) % N]);
        if (Math.abs(turn) > 0.3) side = turn > 0 ? 1 : -1;
        if (isMover) {
          const m = movers[mi++ % movers.length], c = side * half * 0.45, amp = half * 0.3;
          const p = at(i, c);
          obs.push({ x: p[0], y: p[1], r: m.r, spr: m.spr, w: m.w, kind: m.kind, obstacle: true, i, lat: c, lo: c - amp, hi: c + amp, vx: 0, vy: 0,
            mv: { c, amp, spd: m.spd || 1.6, ph: rnd() * 6.28, frames: m.frames || null } });
          return;
        }
        const o = kinds[ki++ % kinds.length];
        const mid = o.mid && (o.r <= 4.6) && Math.abs(turn) < 0.4 && (rnd() < 0.5 || o.mid === 2);
        const lat = mid ? 0 : side * (half - o.r + 1.5);
        const p = at(i, lat);
        obs.push({ x: p[0], y: p[1], r: o.r, spr: o.spr, w: o.w, kind: o.kind, obstacle: true, i, lat, lo: lat, hi: lat, vx: 0, vy: 0, mv: null });
      });
      for (const o of obs) this.props.push(o);
    },
    // advance moving obstacles (called once per fixed step from PK.Karts.collide)
    tickObstacles(dt) {
      const obs = this.obstacles;
      if (!obs || !obs.length) return;
      const P = this.PTS, TAN = this.TAN;
      for (let k = 0; k < obs.length; k++) {
        const o = obs[k], m = o.mv;
        if (!m) continue;
        m.ph += dt * m.spd;
        const lat = m.c + m.amp * Math.sin(m.ph), t = TAN[o.i], vl = m.amp * m.spd * Math.cos(m.ph);
        o.vx = -Math.sin(t) * vl; o.vy = Math.cos(t) * vl;
        o.lat = lat; o.x = P[o.i][0] - Math.sin(t) * lat; o.y = P[o.i][1] + Math.cos(t) * lat;
        if (m.frames) o.spr = m.frames[((m.ph * 2.2) | 0) & 1];
      }
    },

    _buildTexture(def) {
      const C = PK.C, TEX = C.TEX, P = this.PTS, N = this.N, RS = def.road, ROAD_W = this.ROAD_W, BARRIER = this.BARRIER;
      const cv = document.createElement('canvas');
      cv.width = TEX; cv.height = TEX;
      const g = cv.getContext('2d');

      // floor tiles (identical to sampleOutside)
      const img = g.createImageData(TEX, TEX);
      const d32 = new Uint32Array(img.data.buffer);
      for (let y = 0; y < TEX; y++) {
        const row = (y & 63) << 6, o = y * TEX;
        for (let x = 0; x < TEX; x++) d32[o + x] = TILE[row | (x & 63)];
      }
      g.putImageData(img, 0, 0);

      // a TSxTS canvas of the same tiles, used as a pattern to repaint floor inside the rail
      const tc = document.createElement('canvas');
      tc.width = TS; tc.height = TS;
      const tg = tc.getContext('2d');
      const timg = tg.createImageData(TS, TS);
      new Uint32Array(timg.data.buffer).set(TILE);
      tg.putImageData(timg, 0, 0);
      const tilePat = g.createPattern(tc, 'repeat');

      if (def.decor) def.decor(g, this);

      // contact shadows under props: a soft drop shadow cast down-right by the ceiling lights / sun,
      // plus a darker core right under the base (reads well from the raised camera)
      for (const p of this.props) {
        if (p.obstacle || p.x < -20 || p.y < -20 || p.x > TEX + 20 || p.y > TEX + 20) continue;
        const h = p.spr && p.spr.width ? p.w * p.spr.height / p.spr.width : p.w;
        g.fillStyle = RS.propShadow;
        g.beginPath(); g.ellipse(p.x + h * 0.12, p.y + h * 0.1, p.w * 0.42 + h * 0.08, p.w * 0.26 + h * 0.06, 0.6, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(p.x, p.y, p.w * 0.3, p.w * 0.2, 0, 0, Math.PI * 2); g.fill();
      }

      const path = () => {
        g.beginPath();
        g.moveTo(P[0][0], P[0][1]);
        for (let i = 1; i < N; i++) g.lineTo(P[i][0], P[i][1]);
        g.closePath();
      };
      const stroke = (w, style, dash) => {
        g.lineWidth = w; g.strokeStyle = style;
        g.setLineDash(dash || []);
        path(); g.stroke();
      };
      g.lineJoin = 'round'; g.lineCap = 'butt';

      // guard rail at BARRIER: posts, dark base, bright top edge, floor inside
      stroke(2 * BARRIER + 8, RS.railPost, [3, 15]);
      stroke(2 * BARRIER + 4, RS.railDark);
      stroke(2 * BARRIER + 1, RS.railTop);
      stroke(2 * BARRIER - 2, tilePat);
      stroke(2 * BARRIER - 2, RS.scuff);
      stroke(ROAD_W + 12, RS.shadow);

      // lane: striped curbs, lane bands, dashed center line
      stroke(ROAD_W + 6, RS.curbBase);
      stroke(ROAD_W + 6, RS.curb, [6, 6]);
      // racing kerbs (two-colour blocks) through the corners
      if (RS.kerb) {
        const bendAt = (i) => this._bend(i);
        let i = 0;
        while (i < N) {
          if (bendAt(i) < 0.42) { i++; continue; }
          let j = i; while (j < N && bendAt(j) >= 0.32) j++;
          g.beginPath(); g.moveTo(P[Math.max(0, i - 3)][0], P[Math.max(0, i - 3)][1]);
          for (let k = Math.max(0, i - 2); k <= Math.min(N - 1, j + 3); k++) g.lineTo(P[k][0], P[k][1]);
          g.lineWidth = ROAD_W + 8; g.setLineDash([]); g.strokeStyle = RS.kerb[0]; g.stroke();
          g.setLineDash([5, 5]); g.strokeStyle = RS.kerb[1]; g.stroke(); g.setLineDash([]);
          i = j + 1;
        }
      }
      stroke(ROAD_W, RS.lane[0]);
      // a clear 2 px edge line on both sides (the road reads as a road even far away)
      stroke(ROAD_W - 1, RS.edge || RS.curb); stroke(ROAD_W - 5, RS.lane[0]);
      stroke(ROAD_W - 6, RS.lane[1]);
      stroke(ROAD_W - 22, RS.lane[2]);
      stroke(ROAD_W - 30, RS.lane[3]);
      stroke(1.6, RS.line, [9, 9]);
      g.setLineDash([]);
      this._roadDetail(g, def, RS);
      if (RS.mark) this._roadMarks(g, RS.mark);
      if (def.overRoad) def.overRoad(g, this, RS);
      this._obstacleMarks(g, RS);

      // boost pads: orange plates with yellow chevrons pointing along the race direction
      for (const p of this.pads) {
        g.save(); g.translate(p.x, p.y); g.rotate(p.a);
        g.fillStyle = '#7a3a08'; g.fillRect(-8, -7, 16, 14);
        g.fillStyle = '#f07818'; g.fillRect(-7, -6, 14, 12);
        g.strokeStyle = '#ffe23a'; g.lineWidth = 2; g.lineJoin = 'miter';
        for (const cx of [-3.5, 1.5]) {
          g.beginPath(); g.moveTo(cx, -4.5); g.lineTo(cx + 3.5, 0); g.lineTo(cx, 4.5); g.stroke();
        }
        g.restore();
      }
      g.lineJoin = 'round';

      // puddles (milk / juice / oil / slime): blobs with a rim and a highlight
      const prnd = PK.U.rng(777), PC = def.puddle;
      for (const q of this.puddles) {
        const blobs = [[0, 0, q.r * 0.75]];
        for (let k = 0; k < 6; k++) {
          const a = prnd() * Math.PI * 2, rr = q.r * (0.35 + prnd() * 0.3);
          const dist = q.r - rr - 0.5;
          blobs.push([Math.cos(a) * dist, Math.sin(a) * dist, rr]);
        }
        const fillBlobs = (grow, col) => {
          g.fillStyle = col;
          for (const b of blobs) { g.beginPath(); g.arc(q.x + b[0], q.y + b[1], b[2] + grow, 0, Math.PI * 2); g.fill(); }
        };
        fillBlobs(1, PC.rim);
        fillBlobs(0, PC.fill);
        g.fillStyle = PC.hi;
        g.beginPath(); g.arc(q.x - q.r * 0.3, q.y - q.r * 0.3, q.r * 0.25, 0, Math.PI * 2); g.fill();
      }

      // ice patches: glassy pale-cyan sheets with white scratches
      const irnd = PK.U.rng(4711);
      if (def.iceStyle === 'glitch') {                   // corrupt tiles: magenta/black missing-texture squares
        for (const q of this.ice) {
          const s = 4, n = Math.ceil(q.r * 2 / s);
          g.fillStyle = '#00e8ff'; g.fillRect(q.x - q.r - 1, q.y - q.r - 1, n * s + 2, n * s + 2);
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = (i + j) & 1 ? '#000000' : '#ff00dc'; g.fillRect(q.x - q.r + i * s, q.y - q.r + j * s, s, s); }
        }
      } else for (const q of this.ice) {
        g.fillStyle = '#8cc4e4'; g.beginPath(); g.arc(q.x, q.y, q.r + 1, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#d4f0ff'; g.beginPath(); g.arc(q.x, q.y, q.r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#b4e0f6'; g.beginPath(); g.arc(q.x + q.r * 0.25, q.y + q.r * 0.2, q.r * 0.55, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const a = irnd() * Math.PI, l = q.r * (0.4 + irnd() * 0.5), ox = (irnd() - 0.5) * q.r, oy = (irnd() - 0.5) * q.r;
          g.beginPath(); g.moveTo(q.x + ox - Math.cos(a) * l / 2, q.y + oy - Math.sin(a) * l / 2); g.lineTo(q.x + ox + Math.cos(a) * l / 2, q.y + oy + Math.sin(a) * l / 2); g.stroke();
        }
      }

      // start/finish: 2 rows of black/white checks across the road at PTS[0]
      {
        const p = P[0], a = this.TAN[0], sq = 4, n = Math.ceil(ROAD_W / sq);
        g.save(); g.translate(p[0], p[1]); g.rotate(a);
        for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) {
          g.fillStyle = ((r + k) & 1) ? '#1a1a1a' : '#fafafa';
          g.fillRect(-sq + r * sq, -ROAD_W / 2 + k * sq, sq, Math.min(sq, ROAD_W / 2 - (-ROAD_W / 2 + k * sq)));
        }
        g.restore();
      }

      const out = g.getImageData(0, 0, TEX, TEX);
      return new Uint32Array(out.data.buffer);
    },

    // surface detail on the lane (all maps, baked once): fine grain, worn edge chips, tyre / drift
    // marks through the corners, a zebra crossing or two, big stencilled words on the straights
    _roadDetail(g, def, RS) {
      const N = this.N, P = this.PTS, TAN = this.TAN, half = this.ROAD_W / 2, rnd = PK.U.rng(def.seed ^ 0x77aa), ad = PK.U.angDiff;
      const at = (i, lat) => [P[i][0] - Math.sin(TAN[i]) * lat, P[i][1] + Math.cos(TAN[i]) * lat];
      const gr = def.grain == null ? 1 : def.grain;
      for (let i = 0; i < N; i++) {                                   // grain + edge chips
        for (let k = 0; k < 9 * gr; k++) {
          const q = at(i, (rnd() * 2 - 1) * (half - 2));
          g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
          g.fillRect(q[0] | 0, q[1] | 0, 1, 1);
        }
        if (rnd() < 0.35) {
          const sd = rnd() < 0.5 ? 1 : -1, q = at(i, sd * (half - 1 - rnd() * 2));
          g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(q[0] | 0, q[1] | 0, 1 + (rnd() * 2 | 0), 1);
        }
      }
      // drift marks: paired arcs swinging to the outside of every real corner
      const skid = def.skid === undefined ? 'rgba(20,16,12,0.13)' : def.skid;
      if (skid) {
        g.strokeStyle = skid; g.lineWidth = 1.2; g.setLineDash([]);
        let i = 0;
        while (i < N) {
          if (this._bend(i) < 0.45) { i++; continue; }
          let j = i; while (j < N && this._bend(j) >= 0.35) j++;
          const i0 = Math.max(0, i - 4), i1 = Math.min(N - 1, j + 8), sg = ad(TAN[i0], TAN[i1]) > 0 ? 1 : -1;
          for (const [amp, off] of [[11, 0], [7, 5]]) for (const pair of [-1.6, 1.6]) {
            g.beginPath();
            for (let k = i0; k <= i1; k++) {
              const u = (k - i0) / Math.max(1, i1 - i0), q = at(k, -sg * (off * 0.4 + amp * Math.sin(Math.PI * u)) + pair - sg * off);
              if (k === i0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
            }
            g.stroke();
          }
          i = j + 1;
        }
      }
      // free spots on straights (clear of the start, hazards, obstacles and food rows)
      const avoid = this.pads.concat(this.puddles, this.ice, this.obstacles || []);
      const food = []; for (let j = 0; j < 9; j++) { food.push(Math.floor(N * (j + 0.5) / 9)); food.push(Math.floor(N * (j + 1) / 9) % N); }
      const used = [];
      const free = (i, clr) => i > 30 && i < N - 30 && this._bend(i) < 0.06 && this._bend((i + 6) % N) < 0.08 && this._bend(i - 6) < 0.08
        && food.every((f) => Math.abs(f - i) > 5) && used.every((u) => Math.abs(u - i) > 40)
        && avoid.every((q) => Math.hypot(q.x - P[i][0], q.y - P[i][1]) > clr);
      const local = (i, fn) => { g.save(); g.translate(P[i][0], P[i][1]); g.rotate(TAN[i]); fn(); g.restore(); };
      if (def.zebra) {                                                // pedestrian crossings (rooftop)
        let n = 0;
        for (let i = Math.floor(N * 0.2); i < N && n < 3; i += 7) {
          if (!free(i, 30)) continue;
          used.push(i); n++;
          local(i, () => { g.fillStyle = 'rgba(244,240,232,0.8)'; for (let y = -half + 3; y < half - 3; y += 6) g.fillRect(-5, y, 10, 3); });
        }
      }
      const words = def.stencil || [];
      let w = 0;
      for (let i = Math.floor(N * 0.12); i < N && w < words.length * 2; i += 5) {
        if (!free(i, 34)) continue;
        used.push(i);
        const word = words[w % words.length], sc = 2, tw = textW(word, sc);
        local(i, () => {
          g.fillStyle = RS.mark || 'rgba(255,255,255,0.7)';
          let c0 = -tw / 2;
          for (const ch of word) {
            const gl = FONT[ch] || FONT[' '];
            for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (gl[r][c] === '1') g.fillRect((4 - r) * sc - 5, c0 + c * sc, sc, sc);
            c0 += 4 * sc;
          }
        });
        w++;
      }
    },

    // baked under the obstacles: a contact shadow + themed debris; moving ones get a scuffed track
    _obstacleMarks(g) {
      const rnd = PK.U.rng(5309), TAN = this.TAN, P = this.PTS;
      const DEB = { boxes: ['#c89a5a', '#8a6a3a'], tcart: ['#e04040', '#f6d23a', '#4cb848', '#f0f0f0'], cans: ['#3f78d8', '#c3c8cc'],
        ice: ['#e8f8ff', '#b8e2f4'], ftrolley: ['#e8f8ff'], crate: ['#f08a24', '#a8743c'], sacks: ['#c8a870'], melons: ['#e04050', '#2a7a2a'],
        cones: ['#f08a24'], jersey: ['#a3a8b0'], car: ['#1a1a1e'], tomb: ['#6e5c4c', '#4a443c'], pumpkin: ['#f08a24'], slab: ['#6e5c4c'], cross: ['#6e5c4c'],
        missing: ['#ff00dc', '#000000'], cube: ['#40ff80'], hay: ['#f6d23a', '#c09a18'], topiary: ['#2a7a2a'], gnome: ['#e04040'], pot: ['#b05a10'] };
      for (const o of this.obstacles || []) {
        const t = TAN[o.i], sx = -Math.sin(t), sy = Math.cos(t);
        if (o.mv) {
          const m = o.mv, a = m.c - m.amp, b = m.c + m.amp, px = P[o.i][0], py = P[o.i][1];
          g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = o.r * 1.6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(px + sx * a, py + sy * a); g.lineTo(px + sx * b, py + sy * b); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
          for (const off of [-o.r * 0.5, o.r * 0.5]) {
            const ox = Math.cos(t) * off, oy = Math.sin(t) * off;
            g.beginPath(); g.moveTo(px + sx * a + ox, py + sy * a + oy); g.lineTo(px + sx * b + ox, py + sy * b + oy); g.stroke();
          }
          g.lineCap = 'butt';
          continue;
        }
        g.fillStyle = 'rgba(0,0,0,0.30)';
        g.beginPath(); g.ellipse(o.x + 1.5, o.y + 1, o.r * 1.15, o.r * 0.8, t, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.beginPath(); g.ellipse(o.x, o.y, o.r * 0.8, o.r * 0.55, t, 0, Math.PI * 2); g.fill();
        if (o.kind === 'wet') { g.fillStyle = 'rgba(190,225,250,0.55)'; g.beginPath(); g.ellipse(o.x, o.y, 7, 5, t, 0, Math.PI * 2); g.fill(); continue; }
        const deb = DEB[o.kind] || ['#000'];
        for (let k = 0; k < 14; k++) {
          const a = rnd() * Math.PI * 2, d = o.r * (0.9 + rnd() * 0.9);
          g.fillStyle = deb[k % deb.length];
          g.fillRect(Math.round(o.x + Math.cos(a) * d), Math.round(o.y + Math.sin(a) * d), 1 + (rnd() < 0.3 ? 1 : 0), 1);
        }
      }
    },

    // painted markings: start-grid slots behind PTS[0] and turn arrows on the run-up to big corners
    _roadMarks(g, col) {
      const N = this.N, P = this.PTS, TAN = this.TAN, ad = PK.U.angDiff;
      const local = (i, lat, fn) => {
        const t = TAN[i], x = P[i][0] - Math.sin(t) * lat, y = P[i][1] + Math.cos(t) * lat;
        g.save(); g.translate(x, y); g.rotate(t); fn(); g.restore();
      };
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.2; g.setLineDash([]);
      for (let s = 0; s < 6; s++) {
        const i = ((N - 4 - (s >> 1) * 3) % N + N) % N;
        local(i, (s & 1) ? 10 : -10, () => { g.beginPath(); g.moveTo(-4, -5); g.lineTo(5, -5); g.lineTo(5, 5); g.lineTo(-4, 5); g.stroke(); });
      }
      const avoid = this.pads.concat(this.puddles, this.ice);
      let last = -999;
      for (let i = 0; i < N; i++) {
        const b = ad(TAN[(i - 6 + N) % N], TAN[(i + 6) % N]);
        if (Math.abs(b) < 0.75 || i - last < 45) continue;
        last = i;
        const j = (i - 20 + N) % N;
        if (j > N - 30 || j < 6) continue;                        // keep the start area clean
        const ok = avoid.every((q) => Math.hypot(q.x - P[j][0], q.y - P[j][1]) > 24);
        if (!ok || this._bend(j) > 0.45) continue;
        const sg = b > 0 ? 1 : -1;
        local(j, 0, () => {
          g.fillRect(-9, -1.5, 9, 3);
          g.beginPath(); g.moveTo(-1, -1.5); g.quadraticCurveTo(5, -1.5, 5, sg * 4); g.lineTo(2, sg * 4); g.quadraticCurveTo(2, 1.5, -1, 1.5); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(0.5, sg * 4); g.lineTo(6.5, sg * 4); g.lineTo(3.5, sg * 8.5); g.closePath(); g.fill();
        });
      }
    },

    _buildMini(def) {
      const P = this.PTS, N = this.N;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const s = 54 / Math.max(x1 - x0, y1 - y0);
      const ox = (60 - (x1 - x0) * s) / 2 - x0 * s, oy = (60 - (y1 - y0) * s) / 2 - y0 * s;
      const tm = (x, y) => [x * s + ox, y * s + oy];
      const cv = document.createElement('canvas');
      cv.width = 60; cv.height = 60;
      const g = cv.getContext('2d');
      const path = () => {
        g.beginPath();
        for (let i = 0; i <= N; i++) { const m = tm(P[i % N][0], P[i % N][1]); if (i) g.lineTo(m[0], m[1]); else g.moveTo(m[0], m[1]); }
        g.closePath();
      };
      const mc = (def && def.mini) || {};
      if (mc.bg) {                                   // faint themed plate with a 1px frame
        g.fillStyle = mc.bg; g.fillRect(1, 1, 58, 58);
        g.fillStyle = mc.edge || '#f2efe6'; g.globalAlpha = 0.35;
        g.fillRect(1, 0, 58, 1); g.fillRect(1, 59, 58, 1); g.fillRect(0, 1, 1, 58); g.fillRect(59, 1, 1, 58);
        g.globalAlpha = 1;
      }
      g.lineJoin = 'round';
      g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.5)'; path(); g.stroke();
      g.lineWidth = 3.4; g.strokeStyle = mc.edge || '#b8b2a6'; path(); g.stroke();
      g.lineWidth = 1.8; g.strokeStyle = mc.road || '#f2efe6'; path(); g.stroke();
      const dot = (x, y, c) => { const q = tm(x, y); g.fillStyle = c; g.fillRect(Math.round(q[0]) - 1, Math.round(q[1]) - 1, 2, 2); };
      for (const q of this.pads) dot(q.x, q.y, '#ff9a2a');
      for (const q of this.puddles) dot(q.x, q.y, (def && def.puddle && def.puddle.fill) || '#ffffff');
      for (const q of this.ice) dot(q.x, q.y, (def && def.iceStyle === 'glitch') ? '#ff00dc' : '#9fe8ff');
      for (const q of this.obstacles || []) dot(q.x, q.y, '#5a4a40');
      const m = tm(P[0][0], P[0][1]);
      const sx = Math.round(m[0]) - 2, sy = Math.round(m[1]) - 2;    // chequered start flag
      g.fillStyle = '#000'; g.fillRect(sx - 1, sy - 1, 6, 6);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { g.fillStyle = ((i >> 1) + (j >> 1)) & 1 ? '#111' : '#fff'; g.fillRect(sx + i, sy + j, 1, 1); }
      return { cv, s, ox, oy };
    }
  };
})(window.PK);
