// map.js — PK.Track: "슈퍼마트 서킷", a closed circuit running through the aisles of a supermarket.
// Builds (in init): centerline spline, 1024x1024 Mode-7 floor texture, boost pads, milk puddles,
// billboard props (shelves, carts, fruit stands...), the indoor background wall table and the minimap.
window.PK = window.PK || {};
(function (PK) {
  'use strict';

  const ROAD_W = 44;
  const OFFROAD_D = ROAD_W / 2 + 5;   // 27
  const BARRIER = 40;                 // invisible wall distance (red guard rail drawn here)
  const SPACING = 6;                  // centerline resample spacing (units)

  // Control points in race order (closed loop). PTS[0] lies on the first one.
  //  bottom aisle straight (east) -> right wall sweep (north) -> long aisle 2 (west) ->
  //  checkout hairpin (right-hander) -> short aisle (east) -> kink north -> frozen-food top
  //  straight (west) -> produce S-bend (south) -> bottom-left corner back to the start.
  const CTRL = [
    [420, 888], [790, 880], [878, 822], [893, 680], [862, 545], [770, 492],
    [470, 488], [378, 462], [350, 405], [378, 352], [470, 336], [610, 336],
    [692, 302], [712, 225], [665, 165], [330, 146], [205, 160], [148, 255],
    [184, 372], [142, 490], [184, 608], [148, 722], [175, 830], [270, 882]
  ];

  // ---------------------------------------------------------------- small helpers
  const rgbHex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pack = (c) => PK.U.rgb(Math.round(c[0]) & 255 | 0, Math.round(c[1]) & 255 | 0, Math.round(c[2]) & 255 | 0);
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  // 3x5 bitmap glyphs (used for sprite signs and the background wall)
  const FONT = {
    S: ['111', '100', '111', '001', '111'], A: ['010', '101', '111', '101', '101'],
    L: ['100', '100', '100', '100', '111'], E: ['111', '100', '110', '100', '111'],
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
    '%': ['101', '001', '010', '100', '101'], '+': ['000', '010', '111', '010', '000'],
    ' ': ['000', '000', '000', '000', '000']
  };
  const textW = (s, sc) => (s.length * 4 - 1) * (sc || 1);

  // ---------------------------------------------------------------- floor tiles
  // 16-unit cream / warm-grey checker tiles with grout, period 32 => a 32x32 lookup table.
  // Used both to fill the texture and by sampleOutside(), so the floor is seamless.
  const TILE = new Uint32Array(32 * 32);
  function buildTile() {
    const cream = [224, 214, 194], grey = [192, 185, 172], grout = [158, 150, 137];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const gx = x & 15, gy = y & 15;
        let c;
        if (gx === 0 || gy === 0) c = grout;
        else {
          c = (((x >> 4) + (y >> 4)) & 1) ? grey : cream;
          let f = 0;
          if (gx === 1 || gy === 1) f += 8;          // bevel highlight
          if (gx === 15 || gy === 15) f -= 7;        // bevel shadow
          const h = (Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 27); // 0..31 speckle
          f += h < 3 ? -6 : h > 29 ? 4 : 0;
          c = [clamp255(c[0] + f), clamp255(c[1] + f), clamp255(c[2] + f)];
        }
        TILE[y * 32 + x] = pack(c);
      }
    }
  }

  // ---------------------------------------------------------------- spline
  // Closed centripetal Catmull-Rom through CTRL, resampled to uniform arc-length spacing.
  function buildCenterline() {
    const P = CTRL, M = P.length, dense = [];
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
    e: '#e6eef3', E: '#9fb3c4', i: '#b8e2f4', I: '#6aa8cc', s: '#4a5560', z: '#6fe08a', h: '#c82828'
  };
  const SHADE = { r: 'R', o: 'O', y: 'Y', g: 'G', b: 'B', c: 'C', p: 'P', u: 'U', W: 'E', t: 'T' };

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
  // Canvases are made at init and repainted when the sheet loads (drawImage only, so file:// works).
  const foodImg = new Image(), foodJobs = [];
  foodImg.onload = () => { for (const f of foodJobs) f(); };
  const FOOD_PRODUCE = [0, 1, 14, 15], FOOD_GROCERY = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  function makeFoodStand(i) {
    if (!foodImg.src) foodImg.src = 'assets/food.png';
    const c = document.createElement('canvas');
    c.width = 32; c.height = 40;
    const g = c.getContext('2d');
    const paint = () => {
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 40);
      g.fillStyle = '#000'; g.fillRect(1, 27, 30, 13);
      g.fillStyle = '#d8382f'; g.fillRect(2, 28, 28, 5);                       // cloth
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

  // ---------------------------------------------------------------- the Track object
  const T = PK.Track = {
    name: '슈퍼마트 서킷',
    N: 0, PTS: null, TAN: null,
    ROAD_W, OFFROAD_D, BARRIER,
    texData: null, FOG: 0,
    pads: [], puddles: [], props: [],
    mini: null,
    _bg: null, _miniS: 1, _miniOX: 0, _miniOY: 0,

    init() {
      const C = PK.C, U = PK.U;
      buildTile();
      const cl = buildCenterline();
      this.N = cl.N; this.PTS = cl.PTS; this.TAN = cl.TAN; this.length = cl.length;
      this.FOG = U.hex('#ece2cd');
      this._placePadsAndPuddles();
      this._placeProps();
      this._buildTexture();
      this._buildBackground();
      this._buildMini();
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

    sampleOutside(ix, iy) { return TILE[((iy & 31) << 5) | (ix & 31)]; },

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

    _placePadsAndPuddles() {
      const N = this.N, P = this.PTS, TAN = this.TAN;
      const at = (i, lat) => {
        const t = TAN[i];
        return [P[i][0] - Math.sin(t) * lat, P[i][1] + Math.cos(t) * lat];
      };
      // boost pads on straights: bottom aisle, aisle 2, top frozen straight, left of top straight
      this.pads = [];
      const padSpec = [[0.07, 8], [0.30, -8], [0.62, 0], [0.70, 9]];
      for (const [f, lat] of padSpec) {
        const i = this._nearestStraight(Math.round(f * N));
        const p = at(i, lat);
        this.pads.push({ x: p[0], y: p[1], a: TAN[i], i });
      }
      // spilled milk: on corners/approaches, away from pads and start
      this.puddles = [];
      const pudSpec = [[0.19, -9, 8], [0.475, 10, 7], [0.80, -10, 9], [0.875, 9, 8]];
      for (const [f, lat, r] of pudSpec) {
        const i = Math.round(f * N);
        const p = at(i, lat);
        this.puddles.push({ x: p[0], y: p[1], r, i });
      }
    },

    _placeProps() {
      const U = PK.U, rnd = U.rng(20261107), N = this.N, P = this.PTS, TAN = this.TAN, B = BARRIER;
      // sprite library
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
        foodP: FOOD_PRODUCE.map(makeFoodStand),
        foodG: FOOD_GROCERY.map(makeFoodStand)
      };
      const W = { shelf: 34, cans: 14, boxes: 16, cart: 10, fruit: 22, sign: 13, freezer: 34, cooler: 22, checkout: 30, food: 15 };
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const props = this.props = [];
      const self = this;

      // Accept a prop if it is clear of the road (center beyond BARRIER+6, plus a margin for its
      // half-width so the billboard doesn't hang over the lane) and not crowding another prop.
      const tryAdd = (x, y, kind, spr, ignoreRoad) => {
        const w = W[kind];
        if (!ignoreRoad && self.nearestAll(x, y).d < B + 6 + w * 0.3) return false;
        for (let k = 0; k < props.length; k++) {
          const q = props[k], dx = q.x - x, dy = q.y - y;
          const md = Math.max(18, (q.w + w) * 0.45);
          if (dx * dx + dy * dy < md * md) return false;
        }
        props.push({ x, y, spr, w, kind });
        return true;
      };
      const shelfSpr = (kinds) => { const ok = shelves.filter((s) => kinds.indexOf(s.kind) >= 0); return pick(ok).spr; };
      // store zones
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
        if (trackside) return r < 0.6 ? ['shelf', shelfSpr([0, 1, 2, 3, 4])] : r < 0.9 ? ['food', pick(lib.foodG)] : ['cans', pick(lib.cans)];
        return r < 0.4 ? ['shelf', shelfSpr([0, 1, 2, 3, 4])] : r < 0.58 ? ['food', pick(lib.foodG)] : r < 0.7 ? ['cans', pick(lib.cans)]
          : r < 0.8 ? ['boxes', pick(lib.boxes)] : r < 0.9 ? ['sign', pick(lib.sign)] : ['cart', pick(lib.cart)];
      };

      // 1) checkout counters in the hairpin infield, a cart corral near the start
      let lane = 1;
      for (let x = 470; x <= 640; x += 40) tryAdd(x, 410 + (lane & 1) * 4, 'checkout', makeCheckout(lane++));
      for (let k = 0; k < 5; k++) tryAdd(520 + k * 19, 800, 'cart', lib.cart[k & 1]);
      tryAdd(470, 800, 'sign', lib.sign[0]);

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
      const lo = -40, hi = C_TEX() + 40, step = 100;
      for (let s = lo; s < hi; s += step) {
        tryAdd(s, lo, 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
        tryAdd(hi, s, 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
        tryAdd(hi - (s - lo), hi, 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
        tryAdd(lo, hi - (s - lo), 'shelf', shelfSpr([0, 1, 2, 3, 4]), true);
      }

      // 4) random fillers across the store floor (infields, margins)
      for (let tries = 0; tries < 4000 && props.length < 196; tries++) {
        const x = 20 + rnd() * 984, y = 20 + rnd() * 984;
        const z = zone(x, y);
        const [kind, spr0] = make(z, x, y, false);
        tryAdd(x, y, kind, spr0 || makeCheckout(lane++));
      }
    },

    _buildTexture() {
      const C = PK.C, TEX = C.TEX, P = this.PTS, N = this.N;
      const cv = document.createElement('canvas');
      cv.width = TEX; cv.height = TEX;
      const g = cv.getContext('2d');

      // floor tiles (identical to sampleOutside)
      const img = g.createImageData(TEX, TEX);
      const d32 = new Uint32Array(img.data.buffer);
      for (let y = 0; y < TEX; y++) {
        const row = (y & 31) << 5, o = y * TEX;
        for (let x = 0; x < TEX; x++) d32[o + x] = TILE[row | (x & 31)];
      }
      g.putImageData(img, 0, 0);

      // a 32x32 canvas of the same tiles, used as a pattern to repaint floor inside the rail
      const tc = document.createElement('canvas');
      tc.width = 32; tc.height = 32;
      const tg = tc.getContext('2d');
      const timg = tg.createImageData(32, 32);
      new Uint32Array(timg.data.buffer).set(TILE);
      tg.putImageData(timg, 0, 0);
      const tilePat = g.createPattern(tc, 'repeat');

      // soft contact shadows under props
      g.fillStyle = 'rgba(60,45,30,0.16)';
      for (const p of this.props) {
        if (p.x < -20 || p.y < -20 || p.x > TEX + 20 || p.y > TEX + 20) continue;
        g.beginPath(); g.arc(p.x, p.y, p.w * 0.32, 0, Math.PI * 2); g.fill();
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

      // guard rail at BARRIER: grey posts, dark red base, bright red top edge, floor inside
      stroke(2 * BARRIER + 8, '#5d5a55', [3, 15]);
      stroke(2 * BARRIER + 4, '#7a1c1c');
      stroke(2 * BARRIER + 1, '#cf3a2c');
      stroke(2 * BARRIER - 2, tilePat);
      // slight scuffed band just inside the rail
      stroke(2 * BARRIER - 2, 'rgba(90,70,50,0.06)');
      stroke(ROAD_W + 12, 'rgba(60,50,40,0.10)');      // shadow beyond hazard curbs

      // lane: hazard-stripe curbs, polished epoxy, sheen, dashed center line
      stroke(ROAD_W + 6, '#1f1d1b');
      stroke(ROAD_W + 6, '#f2c418', [6, 6]);
      stroke(ROAD_W, '#62778b');
      stroke(ROAD_W - 6, '#6b8094');
      stroke(ROAD_W - 22, '#73899d');
      stroke(ROAD_W - 30, '#6b8094');
      stroke(1.6, '#f4f4f0', [9, 9]);
      g.setLineDash([]);

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

      // spilled milk puddles: white blobs with blue-ish rim and a highlight
      const prnd = PK.U.rng(777);
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
        fillBlobs(1, '#b9c8d4');
        fillBlobs(0, '#f5f6f2');
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(q.x - q.r * 0.3, q.y - q.r * 0.3, q.r * 0.25, 0, Math.PI * 2); g.fill();
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
      this.texData = new Uint32Array(out.data.buffer);
    },

    // Indoor back wall: ceiling with fluorescent panels, hanging aisle signs, SALE banners,
    // shelf silhouettes, fading into FOG at the horizon row. Precomputed once, wraps over PER.
    _buildBackground() {
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
      const H = rgbHex;
      const CEIL = 14;
      // ceiling gradient + wall gradient
      for (let r = 0; r < HZ; r++) {
        const c = r < CEIL ? mix(H('#b8b09f'), H('#d6cebd'), r / (CEIL - 1)) : mix(H('#e3d9c5'), H('#ece3d0'), (r - CEIL) / (HZ - CEIL));
        for (let x = 0; x < PER; x++) pix[r * PER + x] = c;
      }
      // fluorescent light panels in 3 perspective bands (bigger near the top)
      const bands = [{ y: 1, h: 3, n: 20, fr: 0.55 }, { y: 6, h: 2, n: 30, fr: 0.5 }, { y: 10, h: 1, n: 45, fr: 0.45 }];
      for (const b of bands) {
        const segW = PER / b.n, pw = Math.floor(segW * b.fr);
        for (let s = 0; s < b.n; s++) {
          const c0 = Math.floor(s * segW + (segW - pw) / 2);
          rect(c0 - 1, b.y - 1, pw + 2, b.h + 2, H('#a9a191'));
          rect(c0, b.y, pw, b.h, H('#fffdf2'));
          if (b.h > 1) rect(c0, b.y + b.h - 1, pw, 1, H('#eee9d8'));
        }
      }
      // ceiling/wall seam
      rect(0, CEIL, PER, 1, H('#857c6d')); rect(0, CEIL + 1, PER, 1, H('#a39a89'));

      // shelf silhouettes along the back wall
      const rnd = PK.U.rng(4242);
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
      // 12 hanging slots: every 4th is a big SALE banner, others are blue aisle-number signs
      let aisle = 1;
      for (let k = 0; k < 12; k++) {
        const p = Math.floor(k * PER / 12 + PER / 24);
        if (k % 4 === 0) {
          rect(p - 16, CEIL + 2, 1, 2, H('#6e675c')); rect(p + 15, CEIL + 2, 1, 2, H('#6e675c'));
          rect(p - 23, 18, 46, 12, H('#9e2219'));
          rect(p - 22, 19, 44, 10, H('#d93a2e'));
          rect(p - 22, 19, 44, 1, H('#ffd83a')); rect(p - 22, 28, 44, 1, H('#ffd83a'));
          text('SALE', p - Math.floor(textW('SALE', 2) / 2), 20, H('#ffe25a'), 2);
          for (let i = 0; i < 6; i++) { set(p - 23 + i * 9, 30, H('#d93a2e')); set(p - 22 + i * 9, 30, H('#d93a2e')); set(p - 22 + i * 9, 31, H('#d93a2e')); }
        } else {
          const s = String(aisle++), w = 15;
          rect(p - 5, CEIL + 2, 1, 3, H('#6e675c')); rect(p + 4, CEIL + 2, 1, 3, H('#6e675c'));
          rect(p - (w >> 1) - 1, 18, w + 2, 9, H('#1d3f75'));
          rect(p - (w >> 1), 19, w, 7, H('#2d5fa8'));
          text(s, p - Math.floor(textW(s) / 2), 20, H('#ffffff'), 1);
        }
      }
      // haze: light warm interior haze on the wall, fully FOG at the bottom row
      const fog = rgbHex('#ece2cd');
      const bg = new Uint32Array(PER * HZ);
      for (let r = 0; r < HZ; r++) {
        const h = r < CEIL ? 0.08 : r < 48 ? 0.18 : 0.18 + 0.82 * ((r - 47) / (HZ - 48));
        for (let x = 0; x < PER; x++) bg[r * PER + x] = pack(mix(pix[r * PER + x], fog, Math.min(1, h)));
      }
      this._bg = bg;
    },

    _buildMini() {
      const P = this.PTS, N = this.N;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const s = 54 / Math.max(x1 - x0, y1 - y0);
      this._miniS = s;
      this._miniOX = (60 - (x1 - x0) * s) / 2 - x0 * s;
      this._miniOY = (60 - (y1 - y0) * s) / 2 - y0 * s;
      const cv = document.createElement('canvas');
      cv.width = 60; cv.height = 60;
      const g = cv.getContext('2d');
      const path = () => {
        g.beginPath();
        for (let i = 0; i <= N; i++) { const m = this.toMini(P[i % N][0], P[i % N][1]); if (i) g.lineTo(m[0], m[1]); else g.moveTo(m[0], m[1]); }
        g.closePath();
      };
      g.lineJoin = 'round';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.45)'; path(); g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#f2efe6'; path(); g.stroke();
      const m = this.toMini(P[0][0], P[0][1]);
      g.fillStyle = '#ff4a3a'; g.fillRect(Math.round(m[0]) - 1, Math.round(m[1]) - 1, 3, 3);
      this.mini = cv;
    }
  };

  function C_TEX() { return PK.C.TEX; }
})(window.PK);
