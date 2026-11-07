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
  const MT_SMALL = 0.7, MT_BIG = 1.5, MT_ULTRA = 2.4;   // mini-turbo charge thresholds (s): blue / orange / purple sparks
  const PAD_R = 9;              // boost pad detection radius
  const KART_R = 4;             // collision radius
  const RESTITUTION = 0.45;
  const GAUGE_MAX = 100, STOCK_MAX = 2;
  // drift combo: a new drift within COMBO_WIN s of the last one steps the combo (max x5); each step
  // adds COMBO_STEP to the drift gauge multiplier. A fizzled drift, a hit or a long straight resets it.
  const COMBO_WIN = 1.2, COMBO_MAX = 5, COMBO_STEP = 0.25;
  // slipstream: tucked 6..18 units behind a kart going the same way for SLIP_CHARGE s, then pull out
  const SLIP_MIN = 6, SLIP_MAX = 18, SLIP_SIDE = 4.5, SLIP_CHARGE = 1.0, SLIP_BUFF = 1.4, SLIP_MUL = 1.12;

  // ---------------------------------------------------------------------------
  // Kart definitions. Stats are derived from weight (1 light .. 5 heavy):
  //   maxV     = 138 + w*5          (143 .. 163 units/s)   heavy = higher top speed
  //   acc      = 150 - w*14         (136 .. 80 units/s^2)  light = quicker
  //   turn     = 2.75 - w*0.12      (2.63 .. 2.15 rad/s)   light = tighter
  //   grip     = 6.4 + w*0.4        (6.8 .. 8.4 /s)        heavy = more planted
  //   mass     = 50 + w*30          (80 .. 200 kg)
  //   boostPow = 1.48 - w*0.03      (1.45 .. 1.33)         light gets a stronger boost
  // Optional extras: tune {stat: delta} on top of the formula, grip = grip colour,
  // ch = character driver shown for both AI and player (see CHARS).
  // ---------------------------------------------------------------------------
  const RAW = [
    { name: 'RED', nameKo: '레드', color: '#e03a3a', weight: 3, skill: 'cart_rush', desc: '속도와 핸들링이 균형 잡힌 올라운더 카트' },
    { name: 'BLU', nameKo: '블루', color: '#3a6ee8', weight: 2, skill: 'banana', desc: '가속이 좋고 다루기 쉬운 경쾌한 카트' },
    { name: 'GRN', nameKo: '그린', color: '#3cb84a', weight: 4, skill: 'watermelon', desc: '묵직하고 최고 속도가 높은 파워 카트' },
    { name: 'YEL', nameKo: '옐로', color: '#f2c82c', weight: 1, skill: 'soap', desc: '가볍고 코너링이 날카로운 초경량 카트' },
    { name: 'PNK', nameKo: '핑크', color: '#f06aa8', weight: 2, skill: 'bubble', desc: '민첩한 가속과 부드러운 드리프트의 카트' },
    { name: 'BLK', nameKo: '블랙', color: '#2a2a33', weight: 5, skill: 'magnet', desc: '최고 속도와 몸싸움 최강, 대신 굼뜬 중전차' },
    // World 2 characters
    { name: 'VAMP', nameKo: '뱀파이어', color: '#8a1c2b', weight: 4, skill: 'bats', ch: 'vamp', grip: '#e8c040',
      tune: { maxV: 4, acc: 8 }, desc: '묵직한 차체에 날카로운 가속, 밤을 달리는 귀족 카트' },
    { name: 'GHOST', nameKo: '유령', color: '#b8c8f0', weight: 1, skill: 'phase', ch: 'ghost', grip: '#eef4ff',
      tune: { mass: -15, turn: 0.1, grip: -0.3, boostPow: 0.02 }, desc: '깃털처럼 가볍고 둥실둥실 미끄러지는 초민첩 카트' },
    // secret: won by finishing 1st on the glitch map
    { name: 'GLITCH', nameKo: '글리치', color: '#00e8b8', weight: 3, skill: 'teleport', ch: 'glitch', grip: '#ff40d0',
      tune: { maxV: 4, acc: 8, turn: 0.08 }, desc: '버그로 태어난 카트. 모든 능력이 평균 이상, 가끔 화면이 깨진다' }
  ];
  const DEFS = RAW.map((r, i) => {
    const w = r.weight, t = r.tune || {};
    const st = (key, v) => +(v + (t[key] || 0)).toFixed(2);
    const d = {
      id: i, name: r.name, nameKo: r.nameKo, color: r.color, weight: w,
      mass: st('mass', 50 + w * 30),
      maxV: st('maxV', 138 + w * 5),
      acc: st('acc', 150 - w * 14),
      turn: st('turn', 2.75 - w * 0.12),
      grip: st('grip', 6.4 + w * 0.4),
      boostPow: st('boostPow', 1.48 - w * 0.03),
      skill: r.skill, desc: r.desc
    };
    if (r.ch) d.ch = r.ch;
    if (r.grip) d.gripCol = r.grip;
    return d;
  });
  // Kart line-up per world (indices into DEFS). main.js uses ROSTER[world] for the kart
  // select and the race grid. World 2 drops YEL/PNK and adds VAMP/GHOST.
  const ROSTER = { 1: [0, 1, 2, 3, 4, 5], 2: [0, 1, 2, 5, 6, 7] };

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
  // R hair, r hair shade, h hair shine, k skin, K skin shade, e ear (inner), S shirt, s collar,
  // t shirt shade, w shirt highlight, n seam / fold. Light from the upper left.
  const DRV_HEAD = [
    '.........rrRRRRrr.........',
    '.......rRRRhhhRRRRr.......',
    '......rRRhhhhhhRRRRr......',
    '......RRhhhRRRRRRRRR......',
    '.....rRhhRRRRRRRRRRRr.....',
    '.....RRhRRRRRRRRRRRRR.....',
    '....kRRRRRRRRRRRRRRRRk....',
    '...kkRRRRRRRRRRRRRRRRkk...',
    '...KeRRRRRRRRRRRRRRRReK...',
    '....KrRRRRRRRRRRRRRRrK....',
    '.....rrRRRRRRRRRRRRrr.....',
    '......rrrrRRRRRRrrrr......',
    '.......KkkkkkkkkkkK.......',
    '........KKKKKKKKKK........'
  ];
  const DRV_BODY = [
    '....SSSSSsskkkkssSSSSS....',
    '..wwwSSSnSSSSSSSSnSSSSSt..',
    '.twwSSSSnSSSSSSSSnSSSSStt.',
    'twSSSSSSnSSSSSSSSnSSSSSStt',
    'twSSSSSSnSSSSSSSSnSSSSSStt',
    'ttSSSSSSntSSSSSSSnSSSSSttt',
    'ttSSSSSStSSSSSSSStSSSSSttt',
    'tttSSSSSSSSSSSSSSSSSSSSttt'
  ];
  // hairstyles for the everyday shoppers: ponytail (T hair tie) and a cap (C cap, c shade, L shine, b button)
  const PONY_HEAD = [
    '.........rrRRRRrr.........',
    '.......rRRRhhhRRRRr.......',
    '......rRRhhhhhhRRRRr......',
    '......RRhhhrTTrRRRRR......',
    '.....rRhhRRrhRrRRRRRr.....',
    '.....RRhRRrRhRRrRRRRR.....',
    '....kRRRRRrRhRRrRRRRRk....',
    '...kkRRRRRrhRRRrRRRRRkk...',
    '...KeRRRRRrRhRRrRRRRReK...',
    '....KrRRRRRrRRrRRRRRrK....',
    '.....rrRRRRrRRrRRRRrr.....',
    '......rrrrRrRRrRrrrr......',
    '.......KkkkrRRrkkkK.......',
    '........KKKrRRrKKK........'
  ];
  const PONY_BODY = [
    '....SSSSSssrRRrssSSSSS....',
    '..wwwSSSnSSrRRrSSnSSSSSt..',
    '.twwSSSSnSSSRrSSSnSSSSStt.',
    'twSSSSSSnSSSrrSSSnSSSSSStt',
    'twSSSSSSnSSSSSSSSnSSSSSStt',
    'ttSSSSSSntSSSSSSSnSSSSSttt',
    'ttSSSSSStSSSSSSSStSSSSSttt',
    'tttSSSSSSSSSSSSSSSSSSSSttt'
  ];
  const CAP_HEAD = [
    '.........ccCbbCcc.........',
    '.......cLLLCCCCCCCc.......',
    '......cLLLLCCCCCCCCc......',
    '......CCCCCccccCCCCC......',
    '.....cCCCCCRRRRCCCCCc.....',
    '.....CCCCCCcbbcCCCCCC.....',
    '....kRRRRRRRRRRRRRRRRk....',
    '...kkRRRRRRRRRRRRRRRRkk...',
    '...KeRRRRRRRRRRRRRRRReK...',
    '....KrRRRRRRRRRRRRRRrK....',
    '.....rrRRRRRRRRRRRRrr.....',
    '......rrrrRRRRRRrrrr......',
    '.......KkkkkkkkkkkK.......',
    '........KKKKKKKKKK........'
  ];
  const BUN_HEAD = [
    '..........rRRRRr..........',
    '..........RhhRRR..........',
    '.......rRRrRRRRrRRr.......',
    '......RRhhhRRRRRRRRR......',
    '.....rRhhRRRRRRRRRRRr.....',
    '.....RRhRRRRRRRRRRRRR.....',
    '....kRRRRRRRRRRRRRRRRk....',
    '...kkRRRRRRRRRRRRRRRRkk...',
    '...KeRRRRRRRRRRRRRRRReK...',
    '....KrRRRRRRRRRRRRRRrK....',
    '.....rrRRRRRRRRRRRRrr.....',
    '......rrrrRRRRRRrrrr......',
    '.......KkkkkkkkkkkK.......',
    '........KKKKKKKKKK........'
  ];
  const STYLES = { pony: [PONY_HEAD, PONY_BODY], cap: [CAP_HEAD, DRV_BODY], bun: [BUN_HEAD, DRV_BODY] };
  const DRV_X = (SW - 26) >> 1;

  // character drivers (26 wide, same row counts as DRV_HEAD / DRV_BODY).
  // sym(edge, mid): edge mirrored on both sides, mid centred with dots.
  const sym = (e, m) => {
    const n = 26 - e.length * 2 - m.length, p = n >> 1;
    return e + rep('.', p) + m + rep('.', n - p) + e.split('').reverse().join('');
  };
  // vampire: H slicked hair, h shine, e/E pale pointed ear, k pale neck, C cape collar, c red lining, P cape fold
  const VAMP_HEAD = [
    sym('', 'HHhhhhHH'),
    sym('', 'HHHHHhhHHHHH'),
    sym('', 'HHHHHHhhHHHHHH'),
    sym('c', 'HHhHHHhhHHHhHH'),
    sym('Cc', 'HHHhHHHhhHHHhHHH'),
    sym('Cc', 'eHHHHhHHhhHHhHHHHe'),
    sym('CCc', 'eeHHHHHhHhhHhHHHHHee'),
    sym('CCc', 'EeHHHHHHhhhhHHHHHHeE'),
    sym('CCCc', 'EHHHHHHHHHHHHHHHHE'),
    sym('CCCCc', 'HHHHHHHHHHHHHHHH'),
    sym('CCCCCc', 'HHHHHHHHHHHHHH'),
    sym('CCCCCCc', 'HHHHHhhHHHHH'),
    sym('CCCCCCCc', 'kkkkkkkkkk'),
    sym('CCCCCCCCC', 'CCCCCCCC')
  ];
  const VAMP_BODY = [
    sym('', rep('C', 20)),
    sym('c', rep('C', 11) + 'PP' + rep('C', 11)),
    sym('cP', rep('C', 10) + 'PP' + rep('C', 10)),
    sym('cP', rep('C', 10) + 'PP' + rep('C', 10)),
    sym('ccP', rep('C', 9) + 'PP' + rep('C', 9)),
    sym('ccP', rep('C', 9) + 'PP' + rep('C', 9)),
    sym('ccPP', rep('C', 8) + 'PP' + rep('C', 8)),
    sym('ccPP', rep('C', 8) + 'PP' + rep('C', 8))
  ];
  // ghost: o pale outline, W sheet, w sheet shade, g faint glow (all slightly see-through)
  const GHOST_HEAD = [
    sym('', 'oo..oo..oo'),
    sym('', 'oWWooWWooWWo'),
    sym('', 'oWWWWWWWWWWWWo'),
    sym('g', 'oWWWWWWWWWWWWWWo'),
    sym('', 'oWWWWWWWWWWWWWWWWo'),
    sym('', 'oWWWWWWWWWWWWWWWWo'),
    sym('', 'oWWWWWWWWWWWWWWWWo'),
    sym('', 'owWWWWWWWWWWWWWWwo'),
    sym('.g', 'owwWWWWWWWWWWWWwwo'),
    sym('', 'owwwWWWWWWWWWWwwwo'),
    sym('', 'owwwwWWWWWWwwwwo'),
    sym('', 'owwwwwwwwwwwwo'),
    sym('', 'owwwwwwwwwwwwwwo'),
    sym('', 'owwwwwwwwwwwwwwwwo')
  ];
  const GHOST_BODY = [
    sym('', 'o' + rep('w', 18) + 'o'),
    sym('', 'o' + rep('W', 20) + 'o'),
    sym('', 'o' + rep('W', 22) + 'o'),
    sym('', 'o' + rep('W', 24) + 'o'),
    sym('o', rep('W', 11) + 'ww' + rep('W', 11)),
    sym('o', 'w' + rep('W', 10) + 'ww' + rep('W', 10) + 'w'),
    sym('o', rep('w', 24)),
    sym('', 'ow..owwo..owwo..owwo..wo')
  ];
  // glitch: the normal driver silhouette filled with corrupted noise (g/G green, m magenta, c cyan, w white,
  // k black), a few rows torn sideways; paint() adds magenta/cyan ghost copies (split: true)
  const glitchRows = (mask, seed, tear) => mask.map((r, y) => {
    let s = '';
    for (let x = 0; x < r.length; x++) {
      if (r[x] === '.') { s += '.'; continue; }
      const h = ((x * 7 + y * 13 + seed) * 2654435761 >>> 0) % 23;
      s += h < 9 ? 'g' : h < 14 ? 'G' : h < 17 ? 'k' : h < 19 ? 'm' : h < 21 ? 'c' : 'w';
    }
    const sh = tear[y] || 0;   // torn scanline: shift the row
    return sh > 0 ? rep('.', sh) + s.slice(0, s.length - sh) : sh < 0 ? s.slice(-sh) + rep('.', -sh) : s;
  });
  const GLITCH_HEAD = glitchRows(DRV_HEAD, 5, { 3: 2, 4: 2, 9: -2, 10: -1 }).map((r, y) => (y === 6 ? r.replace(/[gGkmw]/g, 'c') : r));
  const GLITCH_BODY = glitchRows(DRV_BODY, 11, { 2: -2, 5: 1 });
  const CHARS = {
    glitch: { head: GLITCH_HEAD, body: GLITCH_BODY, split: true,
      pal: { g: '#10c070', G: '#60ffb0', k: '#081010', m: '#ff30c0', c: '#30e8ff', w: '#f0fff8' } },
    vamp: { head: VAMP_HEAD, body: VAMP_BODY,
      pal: { H: '#16121e', h: '#3e3850', e: '#ece4f2', E: '#b8acc8', k: '#d8d0e4', C: '#1c0e16', P: '#2e1424', c: '#c0182e' } },
    ghost: { head: GHOST_HEAD, body: GHOST_BODY,
      pal: { o: 'rgba(150,178,236,0.9)', W: 'rgba(246,249,255,0.86)', w: 'rgba(200,214,244,0.82)', g: 'rgba(214,236,255,0.6)' } }
  };
  const PHASE_ALPHA = 0.42;   // phased (유령화) frames are pre-faded copies at this alpha

  const SPR = [];     // SPR[defIndex] = [left, center, right], driven by an everyday shopper
  const SPR_ME = [];  // same karts driven by the cutscene hero (the player)
  const SPR_EMPTY = []; // SPR_EMPTY[defIndex] = straight-on cart with nobody in it (parked carts in cutscenes)
  const SPR_PHASE = []; // SPR_PHASE[defIndex] = faded [l, c, r] for karts with the 'phase' skill (else undefined)
  // drivers: [hair, shirt, skin]. ME matches PAL_ME in intro.js.
  const ME = ['#3b2a20', '#7d8592', '#f1c9a0'];
  // shoppers: [hair, shirt, skin, hairstyle, cap colour]
  const SHOPPERS = [['#1c1c22', '#c8504a', '#f1c9a0', 'pony'], ['#7a5232', '#3a8a5a', '#d9a878', 'cap', '#e0e0e8'], ['#d8b860', '#4a6ab8', '#f6d6b8', 'bun'],
    ['#8a8a90', '#b85a9a', '#e9bf95', 'cap', '#3a5aa8'], ['#2a1a10', '#e0a030', '#b07a52', ''], ['#5a3420', '#5a5a66', '#e2b48a', 'pony']];
  const JOBS = [];    // {cv, d, drv, dx, fcv?} — repainted when the cart image arrives (drv null = empty cart, fcv = faded copy)
  const SPR_PHASE_ME = []; // player copy of SPR_PHASE (follows the player body)
  const ME_JOBS = [];   // ME_JOBS[defIndex] = paint jobs of the player frames (repainted by setPlayerBody)
  const BODY_CACHE = {};   // bodySprite canvases by 'body|defIndex[|e]'
  const mkCv = () => { const c = document.createElement('canvas'); c.width = SW; c.height = SH; return c; };
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
    const bar = blk ? '#5a5a68' : d.color, grip = blk ? '#e8c040' : d.gripCol || d.color;
    const p = (c) => ({ L: mixW(c, 0.35), M: c, m: U.darken(c, 0.86), D: U.darken(c, 0.68), d: U.darken(c, 0.52) });
    return { bar: p(bar), grip: p(grip), hub: mixW(grip, 0.45), hubD: U.darken(grip, 0.85) };
  }
  function drvPal(drv) {
    const U = PK.U, skin = drv[2] || '#e9bf95';
    const cap = drv[4] || U.darken(drv[1], 0.7);
    return { R: drv[0], r: U.darken(drv[0], 0.7), h: mixW(drv[0], 0.28), k: skin, K: U.darken(skin, 0.86), e: U.darken(skin, 0.76),
      S: drv[1], s: U.darken(drv[1], 0.8), t: U.darken(drv[1], 0.78), w: mixW(drv[1], 0.22), n: U.darken(drv[1], 0.88),
      T: '#ff5a8a', C: cap, c: U.darken(cap, 0.75), L: mixW(cap, 0.3), b: mixW(cap, 0.45) };
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

  // driver: body shifts 2px, head 4px into the lean (tilt). Head rows y 0..13, body rows y 14..21.
  function drawDriver(g, j) {
    if (!j.drv) return;
    const dx = j.dx;
    const C = j.d.ch && CHARS[j.d.ch];
    const sty = !C && STYLES[j.drv[3]];
    const dp = C ? C.pal : drvPal(j.drv), hd = C ? C.head : sty ? sty[0] : DRV_HEAD, bd = C ? C.body : sty ? sty[1] : DRV_BODY;
    if (C && C.split) {   // chromatic ghost copies, offset left/right
      const one = (col) => { const p = {}; for (const ch in dp) p[ch] = col; return p; };
      const pm = one('rgba(255,40,200,0.55)'), pc = one('rgba(40,230,255,0.55)');
      blit(g, bd, pm, DRV_X + dx * 2 - 2, hd.length); blit(g, hd, pm, DRV_X + dx * 4 - 2, 0);
      blit(g, bd, pc, DRV_X + dx * 2 + 2, hd.length + 1); blit(g, hd, pc, DRV_X + dx * 4 + 2, 1);
    }
    blit(g, bd, dp, DRV_X + dx * 2, hd.length);
    blit(g, hd, dp, DRV_X + dx * 4, 0);
  }

  // ---------------------------------------------------------------------------
  // Everyday cart bodies (cosmetic only, player kart). 'cart' = assets/cart.png as above; the
  // others are drawn procedurally on the same SW x SH layout, seen from behind: back() before the
  // driver, front() after it (rims / bars that the driver sits inside or behind). The accent part
  // (handle / frame / fabric) uses the kart colour (cartPal bar), grips use cartPal grip.
  // ---------------------------------------------------------------------------
  const BODIES = [
    { id: 'cart', nameKo: '쇼핑카트', desc: '마트의 기본 쇼핑카트' },
    { id: 'stroller', nameKo: '유모차', desc: '푹신한 시트에 쏙 들어가 앉는 아기 유모차' },
    { id: 'airport', nameKo: '공항 카트', desc: '여행 가방을 싣고 달리는 공항 수하물 카트' },
    { id: 'granny', nameKo: '장바구니 캐리어', desc: '시장 갈 때 끌고 다니는 체크무늬 장바구니' },
    { id: 'parcel', nameKo: '택배 손수레', desc: '택배 상자를 높이 쌓은 든든한 손수레' },
    { id: 'rearcar', nameKo: '리어카', desc: '큰 바퀴 두 개가 달린 정겨운 나무 리어카' }
  ];
  const OUT = '#0b0708', TYRE = '#26242c', TYRE_L = '#4a4852', STEEL = '#9aa0ac', STEEL_D = '#5e6270';
  const rect = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const obox = (g, c, x, y, w, h) => { rect(g, OUT, x, y, w, h); rect(g, c, x + 1, y + 1, w - 2, h - 2); };
  const rbox = (g, c, x, y, w, h) => {   // outlined box with 1px rounded corners
    rect(g, OUT, x + 1, y, w - 2, h); rect(g, OUT, x, y + 1, w, h - 2); rect(g, c, x + 1, y + 1, w - 2, h - 2);
  };
  // chunky bar like the cart handle: outline, light / main / dark rows, grips at both ends
  function hbar(g, cp, x, y, w, gw) {
    rbox(g, cp.bar.M, x, y, w, 5);
    rect(g, cp.bar.L, x + 1, y + 1, w - 2, 1); rect(g, cp.bar.d, x + 1, y + 3, w - 2, 1);
    if (gw) for (const gx of [x + 1, x + w - 1 - gw]) {
      rect(g, cp.grip.M, gx, y + 1, gw, 3); rect(g, cp.grip.L, gx, y + 1, gw, 1); rect(g, cp.grip.d, gx, y + 3, gw, 1);
    }
  }
  // vertical tube (frame / rail) in the accent colour
  function tube(g, cp, x, y, w, h) { obox(g, cp.bar.M, x, y, w, h); if (w > 2) rect(g, cp.bar.L, x + 1, y + 1, 1, h - 2); }
  let WCOL = null;   // wheel rects collected while painting (for the wheel decoration overlays)
  function wheel(g, cp, x, y, w, h) {
    if (WCOL) WCOL.push([x, y, w, h]);
    rbox(g, cp.tyre || TYRE, x, y, w, h);
    rect(g, cp.tyreL || TYRE_L, x + 1, y + 2, 1, h - 4);
    const hw = Math.max(1, (w - 4) >> 1) + (w > 6 ? 1 : 0), hh = Math.max(1, (h - 4) >> 1);
    const hx = x + ((w - hw) >> 1), hy = y + ((h - hh) >> 1);
    rect(g, cp.hub, hx, hy, hw, hh); rect(g, cp.hubD, hx, hy + hh - 1, hw, 1);
  }
  const BODY_DRAW = {
    stroller: {
      back(g, cp) {
        // handle tubes down the sides (bar itself is drawn in front)
        obox(g, STEEL, 4, 14, 3, 38); obox(g, STEEL, 41, 14, 3, 38);
        // small front wheels (far), basket under the seat, big rear wheels
        wheel(g, cp, 15, 51, 6, 7); wheel(g, cp, 27, 51, 6, 7);
        obox(g, '#3a3440', 11, 41, 26, 9);
        rect(g, '#5a5464', 12, 44, 24, 1); rect(g, '#5a5464', 12, 47, 24, 1);
        for (let x = 14; x < 36; x += 4) rect(g, '#5a5464', x, 42, 1, 7);
        wheel(g, cp, 1, 43, 9, 15); wheel(g, cp, 38, 43, 9, 15);
        // padded seat in the kart colour (quilted)
        rbox(g, cp.bar.M, 7, 21, 34, 22);
        rect(g, cp.bar.D, 8, 38, 32, 4); rect(g, cp.bar.d, 8, 41, 32, 1);
        for (let x = 12; x < 40; x += 6) rect(g, cp.bar.m, x, 24, 1, 14);
        rect(g, cp.bar.m, 8, 30, 32, 1);
      },
      front(g, cp) {
        // soft seat rim (driver sits inside), white trim, then the push bar across the neck
        rbox(g, cp.bar.L, 6, 19, 36, 4); rect(g, '#f4f0ea', 7, 20, 34, 1);
        hbar(g, cp, 3, 10, 42, 5);
      }
    },
    airport: {
      back(g, cp) {
        // side posts, the suitcase the driver sits on, the base plate, casters
        tube(g, cp, 4, 13, 4, 36); tube(g, cp, 40, 13, 4, 36);
        wheel(g, cp, 15, 52, 5, 6); wheel(g, cp, 28, 52, 5, 6);
        rbox(g, '#4a5878', 9, 21, 30, 27);
        for (let x = 13; x < 37; x += 5) rect(g, '#3a4660', x, 23, 2, 23);
        rect(g, '#5e6e94', 10, 22, 28, 1);
        rect(g, '#9a9aa8', 10, 22, 2, 2); rect(g, '#9a9aa8', 36, 22, 2, 2);
        rect(g, '#9a9aa8', 10, 45, 2, 2); rect(g, '#9a9aa8', 36, 45, 2, 2);
        obox(g, '#f2e6b8', 29, 33, 6, 5); rect(g, '#c04030', 30, 34, 4, 1);   // luggage tag
        obox(g, STEEL, 2, 47, 44, 5); rect(g, '#c8ccd6', 3, 48, 42, 1);
        for (let x = 7; x < 42; x += 5) rect(g, STEEL_D, x, 49, 3, 1);
        wheel(g, cp, 4, 51, 7, 7); wheel(g, cp, 37, 51, 7, 7);
      },
      front(g, cp) {
        rect(g, OUT, 9, 20, 30, 1); rect(g, '#6a7aa0', 10, 21, 28, 1);   // suitcase top edge
        hbar(g, cp, 2, 10, 44, 6);
      }
    },
    granny: {
      back(g, cp) {
        // rods up to the handle, outer frame, the two big wheels and axle
        obox(g, STEEL, 14, 13, 3, 10); obox(g, STEEL, 31, 13, 3, 10);
        obox(g, STEEL, 7, 22, 3, 30); obox(g, STEEL, 38, 22, 3, 30);
        rect(g, STEEL_D, 10, 51, 28, 2);
        obox(g, STEEL, 21, 50, 6, 4);   // stand foot
        // tartan bag in the kart colour
        rbox(g, cp.bar.M, 9, 21, 30, 29);
        for (let x = 12; x < 38; x += 7) rect(g, cp.bar.D, x, 22, 2, 27);
        for (let y = 25; y < 49; y += 7) rect(g, cp.bar.D, 10, y, 28, 2);
        for (let x = 12; x < 38; x += 7) for (let y = 25; y < 49; y += 7) rect(g, cp.bar.d, x, y, 2, 2);
        for (let x = 15; x < 38; x += 7) rect(g, cp.bar.L, x, 22, 1, 27);
        rbox(g, cp.bar.m, 13, 30, 22, 8); rect(g, cp.bar.L, 14, 31, 20, 1);   // front pocket
        rect(g, '#e8c040', 23, 33, 2, 2);                                     // pocket clasp
        rect(g, cp.bar.d, 10, 47, 28, 2);
        wheel(g, cp, 2, 42, 9, 15); wheel(g, cp, 37, 42, 9, 15);
      },
      front(g, cp) {
        rbox(g, cp.bar.L, 8, 19, 32, 4); rect(g, cp.bar.D, 9, 21, 30, 1);   // drawstring rim
        for (let x = 11; x < 38; x += 4) rect(g, '#f4f0ea', x, 20, 1, 1);
        hbar(g, cp, 11, 10, 26, 0);
      }
    },
    parcel: {
      back(g, cp) {
        // rails, cardboard boxes stacked on the nose plate, wheels
        tube(g, cp, 6, 12, 4, 41); tube(g, cp, 38, 12, 4, 41);
        rect(g, STEEL_D, 10, 30, 1, 2); rect(g, STEEL_D, 37, 30, 1, 2);
        const box = (x, y, w, h) => {
          obox(g, '#c8945a', x, y, w, h);
          rect(g, '#dcae78', x + 1, y + 1, w - 2, 1); rect(g, '#a87440', x + 1, y + h - 3, w - 2, 2);
          rect(g, '#e8d0a0', x + (w >> 1) - 2, y + 1, 4, h - 2);   // packing tape
        };
        box(10, 34, 28, 17);
        obox(g, '#f6f4ee', 13, 39, 8, 6); rect(g, '#5e6270', 14, 41, 6, 1); rect(g, '#5e6270', 14, 43, 4, 1);   // shipping label
        box(13, 21, 22, 14);
        rect(g, '#2a6ad0', 28, 26, 4, 3);   // "this side up" print
        obox(g, STEEL, 5, 50, 38, 4); rect(g, '#c8ccd6', 6, 51, 36, 1);
        wheel(g, cp, 0, 45, 8, 13); wheel(g, cp, 40, 45, 8, 13);
      },
      front(g, cp) {
        rect(g, OUT, 13, 20, 22, 1); rect(g, '#dcae78', 14, 21, 20, 1);   // top box edge
        hbar(g, cp, 5, 10, 38, 5);
      }
    },
    rearcar: {
      back(g, cp) {
        // pull bar + shaft tips ahead of the driver (mostly hidden behind the head)
        tube(g, cp, 6, 12, 3, 12); tube(g, cp, 39, 12, 3, 12);
        hbar(g, cp, 5, 11, 38, 0);
        // big wheels seen edge-on, mudguards, axle
        rect(g, '#3a3030', 6, 48, 36, 3);
        if (WCOL) WCOL.push([0, 31, 7, 27], [41, 31, 7, 27]);
        rbox(g, cp.tyre || TYRE, 0, 31, 7, 27); rbox(g, cp.tyre || TYRE, 41, 31, 7, 27);
        rect(g, cp.tyreL || TYRE_L, 1, 34, 1, 21); rect(g, cp.tyreL || TYRE_L, 46, 34, 1, 21);
        rect(g, cp.hub, 6, 47, 3, 4); rect(g, cp.hub, 39, 47, 3, 4);
        rect(g, cp.hubD, 6, 50, 3, 1); rect(g, cp.hubD, 39, 50, 3, 1);
        obox(g, cp.bar.D, 0, 29, 8, 3); obox(g, cp.bar.D, 40, 29, 8, 3);
        // wooden tailgate with painted corner posts
        obox(g, '#a8743c', 5, 21, 38, 21);
        for (let y = 26; y < 41; y += 5) rect(g, '#7a5028', 6, y, 36, 1);
        for (let y = 22; y < 41; y += 5) rect(g, '#c8925a', 6, y, 36, 1);
        tube(g, cp, 5, 21, 4, 21); tube(g, cp, 39, 21, 4, 21);
        rect(g, '#3a3030', 9, 42, 30, 3);
        obox(g, '#e03a3a', 10, 36, 4, 3); obox(g, '#e03a3a', 34, 36, 4, 3);   // reflectors
      },
      front(g, cp) {
        obox(g, cp.bar.M, 4, 19, 40, 4); rect(g, cp.bar.L, 5, 20, 38, 1);   // top rail of the bed
      }
    }
  };
  let playerBody = 'cart';
  const bodyOk = (id) => (id === 'cart' || BODY_DRAW[id] ? id : 'cart');

  // ---------------------------------------------------------------------------
  // Kart decorations (cosmetic, player kart only): a hat on the driver's head, a small flag on a
  // pole at the back of the kart, recoloured wheels. Drawn with fillRect only (file:// safe).
  // The head starts at canvas row 0, so hats cover the top rows of the head (nothing goes above).
  // ---------------------------------------------------------------------------
  const DECOS = {
    hat: [{ id: 'none', nameKo: '없음' }, { id: 'cap', nameKo: '야구 모자' }, { id: 'crown', nameKo: '왕관' },
      { id: 'santa', nameKo: '산타 모자' }, { id: 'helmet', nameKo: '헬멧' }, { id: 'bunny', nameKo: '토끼 귀' }],
    flag: [{ id: 'none', nameKo: '없음' }, { id: 'checker', nameKo: '체크 깃발' }, { id: 'korea', nameKo: '태극 깃발' },
      { id: 'pirate', nameKo: '해적 깃발' }, { id: 'heart', nameKo: '하트 깃발' }, { id: 'rainbow', nameKo: '무지개 깃발' }],
    wheel: [{ id: 'none', nameKo: '기본 바퀴' }, { id: 'gold', nameKo: '황금 바퀴' }, { id: 'neon', nameKo: '네온 바퀴' },
      { id: 'fire', nameKo: '불꽃 바퀴' }, { id: 'ice', nameKo: '얼음 바퀴' }]
  };
  const DECO_KINDS = ['hat', 'flag', 'wheel'];
  const NO_DECO = { hat: 'none', flag: 'none', wheel: 'none' };
  const decoOk = (kind, id) => (DECOS[kind] && DECOS[kind].some((e) => e.id === id) ? id : 'none');
  let playerDeco = Object.assign({}, NO_DECO);
  const DECO_CACHE = {};   // decoSprite canvases by 'kind|id|defIndex|body'

  // head outline per driver type: EXT[key][row] = [x0, x1] (head-local columns) or null
  const HEAD_RE = { hero: /[RrhkKe]/, vamp: /[HhEe]/, ghost: /[oWw]/ };
  const EXT = {};
  function headExt(key) {
    if (EXT[key]) return EXT[key];
    const rows = key === 'vamp' ? VAMP_HEAD : key === 'ghost' ? GHOST_HEAD : DRV_HEAD, re = HEAD_RE[key] || HEAD_RE.hero;
    return (EXT[key] = rows.map((r) => {
      let a = -1, b = -1;
      for (let x = 0; x < r.length; x++) if (re.test(r[x])) { if (a < 0) a = x; b = x; }
      return a < 0 ? null : [a, b];
    }));
  }
  // hat pixels in head-local coords (26 wide, centre between cols 12|13), drawn for the right side;
  // side -1 mirrors the asymmetric bits (santa tip). Returns [[x, y, colour | null(clear)], ...].
  function hatPix(id, E, side, d) {
    const grid = new Map();
    const put = (x, y, c) => grid.set(x + ',' + y, [x, y, c]);
    const span = (y, a, b, c) => { for (let x = a; x <= b; x++) put(x, y, c); };
    const ext = (y) => E[y] || E[4];
    if (id === 'cap') {
      const M = '#2e62d8', L = '#6e9cf2', D = '#1c3c8e';
      for (let y = 0; y <= 5; y++) span(y, ext(y)[0], ext(y)[1], y === 5 ? D : M);
      span(1, ext(1)[0] + 1, ext(1)[0] + 3, L); span(2, ext(2)[0] + 1, ext(2)[0] + 2, L);
      put(12, 0, L); put(13, 0, L);                                   // top button
      for (let y = 3; y <= 4; y++) for (let x = 11; x <= 14; x++) grid.delete(x + ',' + y);   // back opening (hair shows)
      span(5, 11, 14, '#d8d8e0');                                     // strap
    } else if (id === 'crown') {
      const G = '#f2c230', L = '#fff0a0', D = '#b07a10', RU = '#e02838', SA = '#2a7af0';
      for (let y = 0; y <= 2; y++) if (E[y]) span(y, E[y][0], E[y][1], null);   // clear the hair above the band
      const a = ext(4)[0] + 1, b = ext(4)[1] - 1;
      span(3, a, b, L); span(4, a, b, G); span(5, a, b, D);
      span(2, a, a + 2, G); span(1, a, a + 1, G); put(a, 0, L);       // left point
      span(2, b - 2, b, G); span(1, b - 1, b, G); put(b, 0, L);       // right point
      span(2, 11, 14, G); span(1, 12, 13, G); put(12, 0, RU); put(13, 0, RU);   // centre point + ruby
      put(a, 1, L); put(a, 2, L); put(11, 2, L); put(12, 1, L);
      put(12, 4, RU); put(13, 4, RU); put(a + 2, 4, SA); put(b - 2, 4, SA);
    } else if (id === 'santa') {
      const R = '#d8282c', Rl = '#f25a5a', F = '#f8f4f0', Fd = '#c8c2cc';
      for (let y = 0; y <= 4; y++) span(y, ext(y)[0], ext(y)[1], R);
      span(1, ext(1)[0] + 1, ext(1)[0] + 2, Rl);
      const fa = ext(5)[0] - 1, fb = ext(5)[1] + 1;
      span(5, fa, fb, F); span(6, fa, fb, F); put(fa, 6, Fd); put(fb, 6, Fd); span(6, 11, 14, Fd);
      // floppy tip hanging to one side with a pompom
      const t0 = ext(0)[1];
      span(0, t0 + 1, t0 + 3, R); span(1, ext(1)[1] + 1, ext(1)[1] + 3, R); span(2, ext(2)[1] + 1, ext(2)[1] + 2, R);
      const px = ext(2)[1] + 3;
      span(2, px, px + 2, F); span(3, px, px + 2, F); span(4, px, px + 2, F); put(px + 2, 4, Fd); put(px, 2, '#ffffff');
    } else if (id === 'helmet') {
      const W = '#f4f4f8', Wd = '#c4c8d4', O = '#3a3a48', S = d ? d.color : '#e03a3a', Sl = mixW(S, 0.35);
      for (let y = 0; y <= 10; y++) {
        if (!E[y]) continue;
        const a = E[y][0] - (y >= 1 ? 1 : 0), b = E[y][1] + (y >= 1 ? 1 : 0);
        span(y, a, b, y >= 10 ? O : W);
        if (y < 10) { put(a, y, O); put(b, y, O); put(b - 1, y, Wd); }
        if (y === 9) span(y, a + 1, b - 1, Wd);
      }
      span(0, ext(0)[0], ext(0)[1], O);
      for (let y = 0; y <= 9; y++) { put(12, y, y ? Sl : O); put(13, y, y ? S : O); }   // stripe in the kart colour
      put(ext(2)[0] + 1, 2, '#ffffff'); put(ext(3)[0] + 1, 3, '#ffffff');               // shine
    } else if (id === 'bunny') {
      const W = '#faf6fa', P = '#f49ac0', O = '#6a5a6e';
      const a = ext(3)[0] + 2, b = ext(3)[1] - 2;
      for (let y = 0; y <= 4; y++) {
        const off = y <= 1 ? 1 : 0;
        for (const [cx, dir] of [[a, -1], [b, 1]]) {
          const x = cx + dir * off;
          put(x - 2, y, O); put(x - 1, y, W); put(x, y, y ? P : W); put(x + 1, y, W); put(x + 2, y, O);
        }
      }
      span(5, ext(5)[0], ext(5)[1], P); span(5, 12, 13, '#ffffff');   // headband with a little bow
    } else return [];
    const out = [...grid.values()];
    if (side < 0) for (const p of out) p[0] = 25 - p[0];
    return out;
  }
  function drawHat(g, j, id) {
    if (!j.drv || id === 'none') return;
    const key = j.d.ch === 'vamp' || j.d.ch === 'ghost' ? j.d.ch : 'hero';
    const px = hatPix(id, headExt(key), j.dx > 0 ? -1 : 1, j.d);
    const x0 = DRV_X + j.dx * 4;
    const C = j.d.ch && CHARS[j.d.ch];
    if (C && C.split) {   // glitch: chromatic copies like the head
      for (const [x, y, c] of px) if (c) { rect(g, 'rgba(255,40,200,0.55)', x0 + x - 2, y, 1, 1); rect(g, 'rgba(40,230,255,0.55)', x0 + x + 2, y + 1, 1, 1); }
    }
    for (const [x, y, c] of px) { if (c) rect(g, c, x0 + x, y, 1, 1); else g.clearRect(x0 + x, y, 1, 1); }
  }

  // flags: 8x6 inner pattern inside a 10x8 outlined cloth, on a pole beside the driver's head
  const FLAG_PAL = { K: '#1a1a20', W: '#f4f4f0', R: '#d8283a', B: '#2a5ad0', P: '#ffd0e0', w: '#ffffff',
    o: '#ff8a20', y: '#ffd830', g: '#3cc050', v: '#8a50d0' };
  const FLAGS = {
    checker: ['KKWWKKWW', 'KKWWKKWW', 'WWKKWWKK', 'WWKKWWKK', 'KKWWKKWW', 'KKWWKKWW'],
    korea: ['KWWWWWWK', 'KWWRRWWK', 'WWRRRBWW', 'WWRBBBWW', 'KWWBBWWK', 'KWWWWWWK'],
    pirate: ['KKWWWWKK', 'KWWWWWWK', 'KWKWWKWK', 'KWWWWWWK', 'KKWKKWKK', 'KWKKKKWK'],
    heart: ['PPPPPPPP', 'PRRPPRRP', 'PRwRRRRP', 'PRRRRRRP', 'PPRRRRPP', 'PPPRRPPP'],
    rainbow: ['RRRRRRRR', 'oooooooo', 'yyyyyyyy', 'gggggggg', 'BBBBBBBB', 'vvvvvvvv']
  };
  function drawFlag(g, j, id) {
    const F = FLAGS[id];
    if (!F) return;
    const left = j.dx > 0;   // opposite to the lean (the head moves into the lean)
    const px = left ? 10 : 36, fx = left ? 0 : 38;   // pole (2 px) / cloth box x
    rect(g, '#5a5e6a', px, 1, 2, 16); rect(g, '#d8dce4', left ? px : px + 1, 1, 1, 16);
    rect(g, '#f2c230', px, 0, 2, 1);                  // gold knob
    rect(g, OUT, fx, 1, 10, 8);
    blit(g, F, FLAG_PAL, fx + 1, 2);
  }

  // wheels: palette swap (tyre, tyre light, hub) + a few effect pixels around each wheel
  const WHEEL_PAL = {
    gold: { tyre: '#8a6410', tyreL: '#f6dc70', hub: '#fff0a0', hubD: '#c8960e' },
    neon: { tyre: '#0e2a38', tyreL: '#50f4ff', hub: '#c0ffff', hubD: '#20c8e8' },
    fire: { tyre: '#4a1208', tyreL: '#ff8a20', hub: '#ffd848', hubD: '#e84010' },
    ice: { tyre: '#5a8ec0', tyreL: '#e4f8ff', hub: '#d4f4ff', hubD: '#88c4ec' }
  };
  function wheelFx(g, id, ws) {
    for (const [x, y, w, h] of ws) {
      if (id === 'gold') { rect(g, '#ffffff', x + 1, y + 1, 1, 1); rect(g, '#fff6c8', x + w - 2, y + h - 2, 1, 1); }
      else if (id === 'neon') {
        rect(g, 'rgba(80,240,255,0.55)', x - 1, y + 1, 1, h - 2); rect(g, 'rgba(80,240,255,0.55)', x + w, y + 1, 1, h - 2);
        rect(g, 'rgba(80,240,255,0.4)', x + 1, y - 1, w - 2, 1);
        rect(g, '#a0ffff', x + 1, y, w - 2, 1);
      } else if (id === 'fire') {   // little flames licking up from the tyre top
        const H = [1, 3, 2, 3, 1, 2, 3, 2];
        for (let i = 1; i < w - 1; i++) {
          const hh = H[(i + x) % H.length];
          for (let k = 1; k <= hh; k++) rect(g, k === 1 ? '#ffd040' : k === 2 ? '#ff7a18' : '#e02a10', x + i, y - k + 1, 1, 1);
        }
      } else if (id === 'ice') {
        rect(g, '#ffffff', x + 1, y + 1, 1, 1); rect(g, '#ffffff', x + w - 2, y + 2, 1, 1);
        rect(g, 'rgba(220,248,255,0.7)', x + 1, y, w - 2, 1);
      }
    }
  }

  function paint(j) {
    const g = j.cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, SW, SH);
    const dc = j.deco || NO_DECO, wp = WHEEL_PAL[dc.wheel];
    const cp = wp ? Object.assign(cartPal(j.d), wp) : cartPal(j.d);
    const B = j.body && j.body !== 'cart' && BODY_DRAW[j.body];
    if (B) {   // procedural body: no cart.png needed
      const ws = WCOL = [];
      B.back(g, cp, j); drawDriver(g, j); drawHat(g, j, dc.hat); drawFlag(g, j, dc.flag); B.front(g, cp, j);
      WCOL = null;
      if (wp) wheelFx(g, dc.wheel, ws);
      fadeCopy(j);
      return;
    }
    const img = imgOk ? IMG : null;
    if (img) g.drawImage(img, 0, CART_Y); else fallbackCart(g, cp, CART_Y);
    drawDriver(g, j); drawHat(g, j, dc.hat); drawFlag(g, j, dc.flag);
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
    if (wp) {   // decorated wheels: repaint the two casters with our own pixels (cart.png / fallback)
      const ws = WCOL = [];
      wheel(g, cp, 7, CART_Y + 42, 6, 7); wheel(g, cp, 35, CART_Y + 42, 6, 7);
      WCOL = null;
      wheelFx(g, dc.wheel, ws);
    }
    fadeCopy(j);
  }
  function fadeCopy(j) {
    if (!j.fcv) return;   // faded copy for the phase skill
    const f = j.fcv.getContext('2d');
    f.imageSmoothingEnabled = false;
    f.clearRect(0, 0, SW, SH);
    f.globalAlpha = PHASE_ALPHA; f.drawImage(j.cv, 0, 0); f.globalAlpha = 1;
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
    SPR.length = 0; SPR_ME.length = 0; SPR_EMPTY.length = 0; SPR_PHASE.length = 0; SPR_PHASE_ME.length = 0;
    JOBS.length = 0; ME_JOBS.length = 0;
    for (const key in BODY_CACHE) delete BODY_CACHE[key];
    for (const key in DECO_CACHE) delete DECO_CACHE[key];
    for (const d of DEFS) {
      const fade = d.skill === 'phase';
      const build = (drv, body, jobs) => {
        const fr = [], fd = fade ? [] : undefined;
        for (const dx of [-1, 0, 1]) {
          const cv = mkCv();
          const j = { cv, d, drv, dx, body };
          if (jobs) j.deco = playerDeco;
          if (fade) { j.fcv = mkCv(); fd.push(j.fcv); }
          JOBS.push(j); if (jobs) jobs.push(j); paint(j);
          fr.push(cv);
        }
        return { fr, fd };
      };
      const shop = SHOPPERS[d.id % SHOPPERS.length];
      const ai = build(shop, 'cart');
      SPR.push(ai.fr);
      SPR_PHASE[d.id] = ai.fd;
      // player frames get their own canvases (repainted in place by setPlayerBody); character
      // karts (d.ch) show the same driver for AI and player
      const mj = [];
      const me = build(d.ch ? shop : ME, playerBody, mj);
      ME_JOBS.push(mj);
      SPR_ME.push(me.fr);
      SPR_PHASE_ME[d.id] = me.fd;
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

  // player body: repaint the player frames (SPR_ME / SPR_PHASE_ME) in place; AI keeps the cart
  function setPlayerBody(id) {
    playerBody = bodyOk(id);
    PK.Karts.playerBody = playerBody;
    for (const jobs of ME_JOBS) for (const j of jobs) { j.body = playerBody; paint(j); }
    return playerBody;
  }
  // player decorations: { hat, flag, wheel } (missing keys keep the current item, unknown ids -> 'none');
  // repaints the player frames in place, keeping the player body
  function setPlayerDeco(o) {
    const n = {};
    for (const kind of DECO_KINDS) n[kind] = o && o[kind] !== undefined ? decoOk(kind, o[kind]) : playerDeco[kind];
    playerDeco = n;
    PK.Karts.playerDeco = Object.assign({}, n);
    for (const jobs of ME_JOBS) for (const j of jobs) { j.deco = playerDeco; paint(j); }
    return PK.Karts.playerDeco;
  }
  // shop card preview: current player body + defIndex's player driver wearing just that one item (cached)
  function decoSprite(kind, id, defIndex) {
    const d = DEFS[defIndex];
    if (!d || !DECOS[kind] || !PK.U || typeof document === 'undefined') return null;
    const item = decoOk(kind, id), key = kind + '|' + item + '|' + defIndex + '|' + playerBody;
    if (DECO_CACHE[key]) return DECO_CACHE[key];
    const deco = Object.assign({}, NO_DECO); deco[kind] = item;
    const j = { cv: mkCv(), d, drv: d.ch ? SHOPPERS[d.id % SHOPPERS.length] : ME, dx: 0, body: playerBody, deco };
    JOBS.push(j); paint(j);   // repaints when cart.png arrives
    return (DECO_CACHE[key] = j.cv);
  }
  // straight-on (centre) frame of a body with that def's player driver/colour, for shop cards (cached)
  function bodySprite(bodyId, defIndex, empty) {
    const d = DEFS[defIndex];
    if (!d || !PK.U || typeof document === 'undefined') return null;
    const body = bodyOk(bodyId), key = body + '|' + defIndex + (empty ? '|e' : '');
    if (BODY_CACHE[key]) return BODY_CACHE[key];
    const drv = empty ? null : d.ch ? SHOPPERS[d.id % SHOPPERS.length] : ME;
    const j = { cv: mkCv(), d, drv, dx: 0, body };
    JOBS.push(j); paint(j);   // in JOBS so the cart body repaints when cart.png arrives
    return (BODY_CACHE[key] = j.cv);
  }

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
      fx: { spin: 0, slow: 0, shield: 0, buff: 0, buffMul: 1, ghost: 0, phase: 0 },   // phase = 유령화 timer
      spinA: 0,
      ai: { lane: clamp(lat * 0.6, -roadHalf, roadHalf), phase: Math.random() * TAU, skill: 0.9, rubber: 1,
            stuckT: 0, revT: 0, driftCd: 0, wantDrift: false, t: 0 },
      prev: { drift: false, boost: false, skill: false },
      // internal (underscore = private to karts.js)
      combo: 0, slipT: 0,   // drift combo step (0 = none) / slipstream charge time (>= SLIP_CHARGE = ready)
      _hopV: 0, _bumpT: 0, _obsT: 0, obsHits: 0, _obsLast: null, _obsAge: 99, _obsRep: 0, _obsPass: 0, _onPad: false, _puddle: false, _topV: 0, _sinceDrift: 99
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
    // wheel-spin stall (rocket start pressed too early, main.js): no drive for a moment
    if (k._stallT > 0) { k._stallT = Math.max(0, k._stallT - dt); gas = false; }
    k._brake = brake && k.v > 35;
    steerRaw = clamp(steerRaw, -1, 1);
    // smooth steering (digital keys -> analog feel): ramp in at 7/s, settle back faster (12/s)
    const back = Math.abs(steerRaw) < Math.abs(k.steerIn) || steerRaw * k.steerIn < 0;
    const sr = (back ? 12 : 7) * dt;
    k.steerIn += clamp(steerRaw - k.steerIn, -sr, sr);
    const steer = k.steerIn;
    const centred = Math.abs(steerRaw) < 0.1;

    // ---- status effect timers ----
    if (fx.spin > 0) { fx.spin -= dt; k.spinA += 16 * dt; if (fx.spin <= 0) { fx.spin = 0; k.spinA = 0; } }
    if (fx.slow > 0) fx.slow = Math.max(0, fx.slow - dt);
    if (fx.shield > 0) fx.shield = Math.max(0, fx.shield - dt);
    if (fx.ghost > 0) fx.ghost = Math.max(0, fx.ghost - dt);
    if (fx.phase > 0) fx.phase = Math.max(0, fx.phase - dt);
    if (fx.buff > 0) { fx.buff = Math.max(0, fx.buff - dt); if (fx.buff === 0) fx.buffMul = 1; }
    if (k.boostT > 0) k.boostT = Math.max(0, k.boostT - dt);
    if (k._bumpT > 0) k._bumpT -= dt;
    if (k._wallT > 0) k._wallT -= dt;
    if (k._sparkT > 0) k._sparkT -= dt;
    if (k._mtBurst > 0) k._mtBurst -= dt;
    if (k._obsT > 0) k._obsT -= dt;
    if (k._obsAge < 99) k._obsAge += dt;
    if (k._obsPass > 0) k._obsPass -= dt;
    k._touchAge = (k._touchAge || 0) + dt;

    // ---- surface checks ----
    let inPuddle = false;
    if (T && T.puddles && !(fx.phase > 0)) {   // phased karts float over puddles
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
        k.combo = k.combo > 0 && k._sinceDrift < COMBO_WIN ? Math.min(COMBO_MAX, k.combo + 1) : 1;      }
      k._sinceDrift += dt;
      if (k._sinceDrift > COMBO_WIN) k.combo = 0;   // straight too long: chain broken
    } else if (!driftBtn || k.v < DRIFT_END_V || spinning) {
      // release -> mini-turbo
      const cm = 1 + COMBO_STEP * Math.max(0, k.combo - 1);
      if (!spinning && k.v >= DRIFT_END_V) {
        if (k.charge >= MT_ULTRA) { k.boostT = Math.max(k.boostT, 1.3); addGauge(k, 16 * cm, G); sfx(G, k, 'boost'); k._mtTier = 3; k._mtBurst = 0.3; }
        else if (k.charge >= MT_BIG) { k.boostT = Math.max(k.boostT, 1.0); addGauge(k, 12 * cm, G); sfx(G, k, 'boost'); k._mtTier = 2; k._mtBurst = 0.3; }
        else if (k.charge >= MT_SMALL) { k.boostT = Math.max(k.boostT, 0.5); addGauge(k, 6 * cm, G); sfx(G, k, 'boost'); k._mtTier = 1; k._mtBurst = 0.25; }
      }
      if (spinning || k.charge < MT_SMALL) k.combo = 0;   // a fizzled drift breaks the chain
      k.drift = false; k.driftDir = 0; k.charge = 0; k._sinceDrift = 0;
    }

    // ---- speed cap ----
    let cap = d.maxV;
    const offMul = 0.42 + w * 0.04;              // heavy karts are less slowed offroad (0.46 .. 0.62)
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
    // speed-sensitive: a little less steering at top speed (still enough for every corner)
    const speedF = clamp(av / 45, 0, 1) * (1 - 0.25 * clamp(av / d.maxV, 0, 1.4));
    const dirS = k.v >= 0 ? 1 : -1;
    // drift entry eases in over ~0.2 s instead of snapping sideways
    k._driftIn = k.drift ? Math.min(1, (k._driftIn || 0) + dt * 5) : 0;
    if (k.drift) {
      // drifting: base rotation into the drift, steering tightens (into) or widens (counter)
      const rate = (k.driftDir * 0.72 * k._driftIn + steer * 0.5) * d.turn * Math.max(speedF, 0.6);
      k.a += rate * dt;
      const into = steer * k.driftDir > 0.3;
      k.charge += dt * (into ? 1.25 : 0.8);
      addGauge(k, dt * (into ? 19 : 11) * (1 + COMBO_STEP * Math.max(0, k.combo - 1)), G);
      k.v *= 1 - 0.06 * dt;
    } else if (!spinning) {
      k.a += steer * d.turn * speedF * dirS * dt;
      // self-align: with the wheel centred, the nose settles onto the travel direction
      if (centred && k.v > 20) k.a += angDiff(k.a, k.ma) * Math.min(1, 2.5 * dt);
    }
    k.a = wrapAng(k.a);

    // ---- grip: movement angle follows heading ----
    let grip = d.grip;
    if (T && T.gripAt) grip *= T.gripAt(k.x, k.y);   // per-map grip (icy floor / ice patches)
    // drift: low grip; on exit grip recovers over ~0.3 s so the slide straightens out smoothly
    k._gripR = k.drift ? 0.24 : Math.min(1, (k._gripR == null ? 1 : k._gripR) + dt * 2.5);
    grip *= k._gripR;
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

    slipstream(k, dt, G);

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

  // slipstream: charge while tucked behind a kart heading the same way; pulling out with a full
  // charge gives a short speed buff. G.onSlip(k) (main.js) toasts it for the player.
  function slipstream(k, dt, G) {
    const ks = G && G.karts;
    if (!ks || k.v < 60 || k.fx.spin > 0 || (G.state && G.state !== 'race' && !G.attract)) { if (k.slipT < SLIP_CHARGE) k.slipT = 0; return; }
    const c = Math.cos(k.ma), s = Math.sin(k.ma);
    let tucked = false;
    for (let i = 0; i < ks.length; i++) {
      const o = ks[i];
      if (o === k || o.fx.phase > 0) continue;
      const dx = o.x - k.x, dy = o.y - k.y, f = dx * c + dy * s;
      if (f < SLIP_MIN || f > SLIP_MAX || Math.abs(-dx * s + dy * c) > SLIP_SIDE) continue;
      if (Math.abs(angDiff(k.ma, o.ma)) < 0.4) { tucked = true; break; }
    }
    if (tucked) {
      const was = k.slipT;
      k.slipT += dt;
      if (was < SLIP_CHARGE && k.slipT >= SLIP_CHARGE && k.isPlayer && G.onSlip) G.onSlip(k, false);
    } else if (k.slipT >= SLIP_CHARGE) {   // pulled out: release
      const fx = k.fx;
      fx.buffMul = fx.buff > 0 ? Math.max(fx.buffMul || 1, SLIP_MUL) : SLIP_MUL;
      fx.buff = Math.max(fx.buff || 0, SLIP_BUFF);
      k.slipT = 0; k._slipGo = SLIP_BUFF;
      if (k.isPlayer && G.onSlip) G.onSlip(k, true);
    } else k.slipT = 0;
    if (k._slipGo > 0) k._slipGo -= dt;
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
      // how hard it hit: the speed going into the wall (straight-on hits hurt, glancing ones scrape)
      const imp = Math.abs(k.v) * Math.abs(Math.sin(angDiff(t, k.ma)));
      const hard = imp > 38 && k._bumpT <= 0 && !(k.fx && k.fx.phase > 0);
      // a hard hit bounces the kart back off the wall a little
      const lat = s * (T.BARRIER - (hard ? 2.6 : 0.5));
      k.x = p[0] - Math.sin(t) * lat; k.y = p[1] + Math.cos(t) * lat; k.lat = lat;
      // deflect movement along the wall (keep the tangential part, point slightly inward)
      const along = Math.abs(angDiff(t, k.ma)) <= Math.PI / 2 ? t : t + Math.PI;
      const fwdSign = along === t ? 1 : -1;
      const outward = Math.sin(angDiff(along, k.ma)) * s * fwdSign > 0;
      if (outward) k.ma = wrapAng(along - s * fwdSign * 0.12);
      if (hard) {
        // 쿵! big speed loss, a dust puff and (player) a thud + small shake
        k.v *= 0.4; k._bumpT = 0.45; k._wallT = 0.35; k._wallSide = s;
        k.ma = wrapAng(k.ma - s * 0.25 * (Math.abs(angDiff(t, k.ma)) <= Math.PI / 2 ? 1 : -1));   // kicked back inward
        sfx(G, k, 'wall');
        if (k.drift) { k.drift = false; k.driftDir = 0; k.charge = 0; }
        k.combo = 0;
      } else if (k._bumpT <= 0) {
        k.v *= 0.8; k._bumpT = 0.35; sfx(G, k, 'bump');   // a scrape along the wall
        if (k.drift) { k.drift = false; k.driftDir = 0; k.charge = 0; }
      } else k.v *= 1 - 1.2 * dt;
      if (Math.abs(k.v) > 18) { k._sparkT = Math.max(k._sparkT || 0, hard ? 0.3 : 0.16); k._sparkSide = s; k._sparkBig = hard ? 1 : 0; }
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
    const T = PK.Track;
    if (T && T.tickObstacles) T.tickObstacles(1 / 60);   // moving obstacles advance once per fixed step
    for (let i = 0; i < karts.length; i++) {
      const A = karts[i];
      if (A.fx.ghost > 0 || A.fx.phase > 0) continue;
      for (let j = i + 1; j < karts.length; j++) {
        const B = karts[j];
        if (B.fx.ghost > 0 || B.fx.phase > 0) continue;
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
          if (-vn > 8) {   // 몸싸움: sparks on the touching sides of both karts
            const ra = -Math.sin(A.a) * dx + Math.cos(A.a) * dy, rb = -Math.sin(B.a) * -dx + Math.cos(B.a) * -dy;
            A._sparkT = 0.22; A._sparkSide = ra >= 0 ? 1 : -1; A._sparkBig = -vn > 30 ? 1 : 0;
            B._sparkT = 0.22; B._sparkSide = rb >= 0 ? 1 : -1; B._sparkBig = A._sparkBig;
          }
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
    if (T && T.obstacles && T.obstacles.length) collideObstacles(karts, T.obstacles);
  }
  // track obstacles (PK.Track.obstacles: immovable circles, some sliding sideways): push the kart
  // out, reflect the inward part of its velocity (small bounce), and on a fresh hit scrub the
  // speed (keeps 62% of the sliding part), cancel the drift and the combo. Phased karts pass through.
  const OBS_BOUNCE = 0.22, OBS_KEEP = 0.62, OBS_CD = 0.4;
  function collideObstacles(karts, obs) {
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (k.fx.phase > 0 || k.fx.ghost > 0) continue;
      for (let j = 0; j < obs.length; j++) {
        const o = obs[j], rr = o.r + KART_R;
        if (k._obsPass > 0 && k._obsLast === o) continue;   // AI rescue: wedged on this one, let it slip past
        let nx = k.x - o.x, ny = k.y - o.y;
        const dsq = nx * nx + ny * ny;
        if (dsq >= rr * rr) continue;
        const d = Math.sqrt(dsq);
        if (d < 1e-4) { nx = -Math.cos(k.ma); ny = -Math.sin(k.ma); } else { nx /= d; ny /= d; }
        k.x = o.x + nx * rr; k.y = o.y + ny * rr;
        // anti-stuck (player and AI): pressed against the same obstacle (head-on, or squeezed against
        // the wall) -> after 0.5 s slide round it toward the open road, after 1.3 s slip past it
        if (k._touchO !== o || k._touchAge > 0.2) { k._touchO = o; k._touchT = 0; }
        k._touchAge = 0; k._touchT += 1 / 60;
        if (k._touchT > 0.5) {
          const T = PK.Track, ta = T && T.TAN ? T.TAN[o.i] || 0 : 0;
          // the way out, sideways across the road: toward the centre line, or (obstacle on the centre
          // line) round the side the kart is already on. +lat = (-sin, cos) of the track direction.
          const toPlus = Math.abs(o.lat || 0) < 4 ? (k.lat || 0) >= (o.lat || 0) : (o.lat || 0) < 0;
          const wx = -Math.sin(ta) * (toPlus ? 1 : -1), wy = Math.cos(ta) * (toPlus ? 1 : -1);
          let tx = -ny, ty = nx;
          if (tx * wx + ty * wy < 0) { tx = -tx; ty = -ty; }
          const sv = 40 / 60;
          k.x += tx * sv; k.y += ty * sv;
        }
        if (k._touchT > 1.3) { k._obsPass = 0.8; k._obsLast = o; k._touchT = 0; continue; }
        const ovx = o.vx || 0, ovy = o.vy || 0;
        const vx = Math.cos(k.ma) * k.v - ovx, vy = Math.sin(k.ma) * k.v - ovy;
        const vn = vx * nx + vy * ny;
        if (vn >= 0) continue;
        const hard = !(k._obsT > 0), keep = hard ? OBS_KEEP : 0.92;
        const tx = vx - vn * nx, ty = vy - vn * ny;
        setVel(k, tx * keep - nx * vn * OBS_BOUNCE + ovx, ty * keep - ny * vn * OBS_BOUNCE + ovy);
        if (hard && -vn > 12) {
          k._obsT = OBS_CD; k.obsHits = (k.obsHits || 0) + 1; k.combo = 0;
          k._obsRep = k._obsLast === o && k._obsAge < 4 ? k._obsRep + 1 : 1; k._obsLast = o; k._obsAge = 0;
          if (!k.isPlayer && k._obsRep >= 3) { k._obsPass = 1.2; k._obsRep = 0; }
          if (k.ai) {
            k.ai.avoidO = o; k.ai.avoidS = k.lat > (o.lo + o.hi) / 2 ? 1 : -1;   // slide off on the side we hit it
          }
          if (k.drift) { k.drift = false; k.driftDir = 0; k.charge = 0; }
          const G = PK.Game;
          if (k.isPlayer && G && G.sfx) G.sfx('bump');
        }
      }
    }
  }
  // AI: the nearest obstacle ahead whose (swept) band overlaps the planned lane -> a lane beside it
  // (the side with more room, kept until it is passed) and its index to aim past.
  function avoidObstacle(k, T, lane, ahead) {
    const obs = T.obstacles, ai = k.ai;
    if (!obs || !obs.length || k.fx.phase > 0) { ai.avoidO = null; return null; }
    const N = T.N;
    let best = null, bm = 1e9;
    for (let n = 0; n < obs.length; n++) {
      const o = obs[n];
      let m = ((o.i - k.idx) % N + N) % N;
      if (m > N / 2) m -= N;
      if (m < -1 || m > ahead) continue;
      const pad = o.r + KART_R + 4.5, lo = o.lo - pad, hi = o.hi + pad;
      const a = Math.min(lane, k.lat), b = Math.max(lane, k.lat);
      if (ai.avoidO !== o && (b < lo || a > hi)) continue;
      if (m < bm) { bm = m; best = { o, lo, hi, m }; }
    }
    if (!best) { ai.avoidO = null; return null; }
    const o = best.o, half = T.ROAD_W / 2;
    if (ai.avoidO !== o) {
      // pass on the side the kart is already on if that gap is wide enough, else the wider gap
      // (a kart already out on the shoulder beyond it may pass on the shoulder, up to the wall)
      const mid = (o.lo + o.hi) / 2, cur = k.lat > mid ? 1 : -1, need = 2;
      const wl = cur < 0 ? T.BARRIER - 6 : half - 2, wr = cur > 0 ? T.BARRIER - 6 : half - 2;
      const roomL = best.lo + wl, roomR = wr - best.hi;
      ai.avoidO = o; ai.avoidS = (cur > 0 ? roomR : roomL) >= need ? cur : (roomR > roomL ? 1 : -1);
      if (best.m < 15 && Math.abs(mid) > 3 && cur * mid > 0) ai.avoidS = cur;   // already out on the shoulder beside it: stay there
    }
    const lim = (ai.avoidS > 0) === (k.lat > (o.lo + o.hi) / 2) ? T.BARRIER - 6 : half - 3;
    const nl = clamp(ai.avoidS > 0 ? best.hi + 1 : best.lo - 1, -lim, lim);
    return { lane: nl, i: o.i, m: best.m };
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
    if (fx.phase > 0) return false;   // phased ghost: immune
    if (fx.shield > 0) { fx.shield = 0; return false; }
    k.combo = 0; k.slipT = 0;
    if (type === 'spin') {
      fx.spin = Math.max(fx.spin, dur || 1.2);
      k.v *= 0.35;
      k.drift = false; k.driftDir = 0; k.charge = 0; k.boostT = 0;
    } else if (type === 'slow') {
      fx.slow = Math.max(fx.slow, (dur || 2) * (1.15 - k.def.weight * 0.07));
    }
    const G = PK.Game;
    if (k.isPlayer && G && G.sfx) { G.sfx('hit'); if (type === 'spin') G.sfx('skid'); }
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
        if (G.hard) target = Math.max(target, 1.03);   // glitch map: the field never eases off
      }
      ai.rubber += (target - ai.rubber) * Math.min(1, dt * 0.8);
    } else ai.rubber = 1;

    // ---- racing line target ----
    const look = Math.round(3 + Math.max(0, k.v) * 0.065);
    let j = wrapI(k.idx + look, N);
    const halfRoad = T.ROAD_W / 2 - 5;
    // drifting wide toward the edge -> aim back to the centre of the road
    const edge = Math.abs(k.lat) > halfRoad - 3;
    let lane = edge ? 0 : clamp(ai.lane + Math.sin(ai.t * 0.55 + ai.phase) * 3, -halfRoad, halfRoad);
    // obstacle ahead in the way -> steer for a gap beside it
    const av = avoidObstacle(k, T, lane, look + 24);
    if (av) { lane = av.lane; j = av.m > 3 ? wrapI(k.idx + clamp(av.m, 4, Math.round(look * 0.7)), N) : wrapI(av.i + 4, N); }   // short look-ahead: converge onto the gap
    const tj = T.TAN[j], pj = T.PTS[j];
    const tx = pj[0] - Math.sin(tj) * lane, ty = pj[1] + Math.cos(tj) * lane;
    const want = Math.atan2(ty - k.y, tx - k.x);
    let err = angDiff(k.a, want);
    out.steer = clamp(err * (av ? 3.2 : 2.4) + (av ? clamp((lane - k.lat) * 0.08, -0.6, 0.6) : 0), -1, 1);   // + lateral pull while threading

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
    if (av && av.m < look + 10 && Math.abs(k.lat - lane) > 5) vt = Math.min(vt, cap * 0.72);   // not lined up yet: ease off
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
      if (av && av.m < look + 6) ai.wantDrift = false;   // threading past an obstacle: no drift
      if (ai.wantDrift && Math.abs(sumAng) > 0.6) {
        out.drift = true;
        out.steer = ai.driftSide;
      } else ai.wantDrift = false;
    } else {
      // hold the drift while the curve continues; release on straight or big charge
      let near = 0;
      for (let m = 0; m < 10; m += 2) near += angDiff(T.TAN[wrapI(k.idx + m, N)], T.TAN[wrapI(k.idx + m + 2, N)]);
      const keep = Math.abs(near) > 0.1 && near * k.driftDir > 0 && k.charge < 2.4 && Math.abs(k.lat) < T.OFFROAD_D - 4 && !(av && av.m < look + 6);
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
  // phased karts (fx.phase > 0) get the pre-faded frames, blinking in the last 0.6 s
  function frame(k, camA) {
    let s = (k.isPlayer ? SPR_ME : SPR)[k.defIndex];
    const ph = k.fx && k.fx.phase;
    const PH = (k.isPlayer ? SPR_PHASE_ME : SPR_PHASE)[k.defIndex];
    if (ph > 0 && PH && (ph > 0.6 || ((ph * 10) | 0) % 2 === 0)) s = PH;
    if (!s) return null;
    if (k.fx.spin > 0) {
      const f = Math.floor(k.spinA / (Math.PI / 2)) & 3;
      return s[f === 0 ? 1 : f === 1 ? 2 : f === 2 ? 1 : 0];
    }
    let lean = 0;
    if (k.isPlayer) {
      // hysteresis: lean in past 0.35, come back below 0.15 (no flicker between frames)
      const l0 = k._lean || 0, si = k.steerIn;
      if (k.drift) lean = k.driftDir;
      else if (l0 !== 0 && si * l0 > 0.15) lean = l0;
      else if (si > 0.35) lean = 1; else if (si < -0.35) lean = -1;
      k._lean = lean;
    } else {
      const rel = angDiff(camA === undefined ? k.a : camA, k.a);
      if (k.drift) lean = k.driftDir;
      else if (rel > 0.22) lean = 1; else if (rel < -0.22) lean = -1;
    }
    // glitch driver: the frame jumps now and then
    if (k.def.ch === 'glitch' && Math.random() < 0.05) return s[(Math.random() * 3) | 0];
    return s[lean + 1];
  }

  // ---------------------------------------------------------------------------
  // drawFx: cheap pixel particles around the kart on screen
  // ---------------------------------------------------------------------------
  const STAR_COLS = ['#fff27a', '#ffffff', '#ffd040'];
  const SPARK = [['#ffffff', '#d8e0ff'], ['#40a0ff', '#a0e0ff', '#ffffff'], ['#ff9a20', '#ffd040', '#fff0a0'], ['#b040ff', '#e0a0ff', '#ff70f0', '#ffffff']];
  function drawFx(g, k, sx, sy, w) {
    if (!g || !(w > 0)) return;
    const s = Math.max(1, Math.round(w / 16));
    const hopPx = Math.round((k.hop || 0) * w / 6.5);
    const by = Math.round(sy) - hopPx;
    const lx = Math.round(sx - w * 0.31), rx = Math.round(sx + w * 0.31);   // cart wheels
    const R = Math.random;
    const px = (x, y, c, sz) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, sz || s, sz || s); };

    // drift: tyre smoke puffs, then sparks at the rear wheels whose colour shows the mini-turbo
    // tier (white -> blue -> orange -> purple)
    if (k.drift && Math.abs(k.v) > 30 && R() < 0.6) {
      const side = k.driftDir > 0 ? lx : rx;
      px(side + (R() * 6 - 3) * s, by - (1 + R() * 4) * s, R() < 0.5 ? 'rgba(220,220,230,0.55)' : 'rgba(180,180,190,0.45)', s * 2);
    }
    if (k.drift && k.charge > 0.15) {
      const tier = k.charge >= MT_ULTRA ? 3 : k.charge >= MT_BIG ? 2 : k.charge >= MT_SMALL ? 1 : 0;
      const pal = SPARK[tier];
      const n = 2 + tier + (tier >= 2 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const c = pal[(R() * pal.length) | 0], big = tier >= 2 && R() < 0.3 ? s + 1 : s;
        px(lx + (R() * 7 - 3.5) * s, by - R() * (3 + tier) * s, c, big);
        px(rx + (R() * 7 - 3.5) * s, by - R() * (3 + tier) * s, c, big);
      }
    }
    // mini-turbo release: a short ring of sparks in the tier colour
    if (k._mtBurst > 0) {
      const pal = SPARK[k._mtTier || 1], u = 1 - k._mtBurst / 0.3, rr = w * (0.25 + u * 0.5);
      for (let i = 0; i < 8; i++) {
        const an = i * TAU / 8 + u;
        px(sx + Math.cos(an) * rr, by - w * 0.15 + Math.sin(an) * rr * 0.45, pal[i % pal.length]);
      }
    }
    // boost flame from under the basket, between the wheels (longer, two-pixel core)
    if (k.boostT > 0) {
      const ex1 = Math.round(sx - w * 0.19), ex2 = Math.round(sx + w * 0.19), ey = by - Math.round(w * 0.2);
      const len = 3 + ((R() * 4) | 0) + (k.boostT > 1 ? 1 : 0);
      for (let i = 0; i < len; i++) {
        const c = i === 0 ? '#ffffff' : i < 2 ? '#fff4a0' : i < 4 ? '#ffb030' : '#ff5a20';
        const wob = R() < 0.5 ? 0 : s;
        px(ex1 - wob, ey + i * s, c, i < 3 ? s + (s > 1 ? 1 : 0) : s);
        px(ex2 + wob, ey + i * s, c, i < 3 ? s + (s > 1 ? 1 : 0) : s);
        if (i >= 2 && R() < 0.35) { px(ex1 - s * 2 * R(), ey + i * s, '#ff7a20'); px(ex2 + s * 2 * R(), ey + i * s, '#ff7a20'); }
      }
    }
    // offroad dust (bigger, sandier clouds kicked out sideways)
    if (k.offroad && Math.abs(k.v) > 25) {
      const n = Math.abs(k.v) > 70 ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const c = R() < 0.4 ? '#a08a68' : R() < 0.7 ? '#c8b490' : 'rgba(214,200,168,0.6)';
        const sz = R() < 0.4 ? s * 2 : s;
        px(lx - R() * 7 * s, by - R() * 5 * s, c, sz);
        px(rx + R() * 7 * s, by - R() * 5 * s, c, sz);
      }
    }
    // 💥 metal sparks (wall scrape / kart-to-kart contact): short yellow-white streaks flying up and
    // out from the touching side, a few hot orange ones falling
    if (k._sparkT > 0) {
      const ex = k._sparkSide > 0 ? rx + s * 2 : lx - s * 2, dir = k._sparkSide > 0 ? 1 : -1;
      const n = k._sparkBig ? 9 : 5, ey = by - Math.round(w * 0.32);
      for (let i = 0; i < n; i++) {
        const c = R() < 0.25 ? '#ffffff' : R() < 0.7 ? '#ffe14d' : '#ffa21a';
        const len = 1 + ((R() * 3) | 0), ox = dir * R() * 9 * s, oy = -R() * 7 * s + R() * 3 * s;
        for (let q = 0; q < len; q++) px(ex + ox + dir * q * s, ey + oy - q * s * 0.6, c);
      }
      if (R() < 0.6) px(ex + dir * R() * 5 * s, ey + R() * 6 * s, '#ff7a20');
    }
    // 쿵! wall hit: a burst of grey-brown dust and white sparks on the wall side
    if (k._wallT > 0) {
      const f = k._wallT / 0.35, ex = k._wallSide > 0 ? rx : lx, dir = k._wallSide > 0 ? 1 : -1;
      for (let i = 0; i < 7; i++) {
        const c = R() < 0.3 ? '#ffffff' : R() < 0.6 ? '#b8a890' : 'rgba(200,190,170,0.7)';
        px(ex + dir * R() * 10 * s * (1.3 - f), by - R() * 9 * s * (1.2 - f * 0.5), c, R() < 0.5 ? s * 2 : s);
      }
    }
    // hard braking: grey tyre smoke at both wheels
    if (k._brake && !k.offroad) {
      for (let i = 0; i < 2; i++) {
        const c = R() < 0.5 ? 'rgba(210,210,220,0.6)' : 'rgba(160,160,172,0.5)';
        px(lx + (R() * 4 - 2) * s, by - R() * 3 * s, c, s * 2);
        px(rx + (R() * 4 - 2) * s, by - R() * 3 * s, c, s * 2);
      }
    }
    // wheel-spin stall (rocket start too early): a puff of white/grey smoke
    if (k._stallT > 0) {
      for (let i = 0; i < 4; i++) {
        const c = R() < 0.5 ? 'rgba(240,240,245,0.75)' : 'rgba(170,170,180,0.6)';
        px(lx + (R() * 8 - 4) * s, by - R() * 6 * s, c, s * 2);
        px(rx + (R() * 8 - 4) * s, by - R() * 6 * s, c, s * 2);
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
    // slipstream: wind streaks along the sides (charged = white, released buff = cyan)
    if (k.slipT >= SLIP_CHARGE || k._slipGo > 0) {
      g.fillStyle = k._slipGo > 0 ? 'rgba(160,240,255,0.8)' : 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 2; i++) {
        const yy = by - w * (0.3 + R() * 0.8), len = Math.max(2, Math.round(w * (0.25 + R() * 0.3)));
        g.fillRect(Math.round(sx - w * 0.62 - R() * 2), Math.round(yy), s, len);
        g.fillRect(Math.round(sx + w * 0.62 + R() * 2), Math.round(yy), s, len);
      }
    }
    // glitch kart: stray noise pixels / a torn bar beside the driver
    if (k.def.ch === 'glitch' && R() < 0.35) {
      const gy = by - w * SH / SW * (0.4 + R() * 0.6);
      const gc = R() < 0.4 ? '#ff30c0' : R() < 0.7 ? '#30e8ff' : '#60ffb0';
      if (R() < 0.3) px(sx - w * 0.5 + R() * w * 0.3, gy, gc, Math.max(1, Math.round(w * (0.2 + R() * 0.4))));
      else for (let i = 0; i < 3; i++) px(sx + (R() - 0.5) * w * 1.1, gy + (R() - 0.5) * w * 0.3, gc);
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

  PK.Karts = { DEFS, ROSTER, init, create, update, collide, aiInput, hit, drawFx, frame, sprite, emptySprite,
    BODIES, setPlayerBody, bodySprite, playerBody, DECOS, setPlayerDeco, decoSprite, playerDeco: Object.assign({}, NO_DECO) };
})(window.PK);
