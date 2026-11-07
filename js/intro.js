// PK.Intro — story cutscenes on a 320x180 pixel canvas with a typewriter dialogue box.
//   'intro'  (first launch): hungry at home → walk to 슈퍼마트 → pick 목살 → the checkout is across the store,
//            so a kart race to the register is announced at the start line (the race itself is the trip).
//   'checkout' (after the race): checkout scan (1st place = everything free) → closing time, locked in the stockroom
//            (→ Stage 2: warehouse escape).
//   'road'   (after Stage 2): out through the emergency exit → walking home, the bag tears and the food scatters
//            (→ Stage 3: pick it all up).
//   'home'   (after Stage 3): grilling 목살 at home — 끝.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const W = 320, H = 180;
  const LS_SEEN = 'pk_intro_v2', LS_KART = 'pk_kart_v1';
  const CPS = 28;                 // typewriter chars per second
  const FADE = 0.4;               // scene fade in/out (s)

  const lsGet = (k) => { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (window.localStorage) localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  let g = null, el = {}, spr = null;
  let active = false, onDone = null, beep = null, script = 'intro', markSeen = false, SCENES = [];
  let si = 0, li = 0, sceneT = 0, lineT = 0, shown = 0, fadeIn = 0, leaving = 0, last = -1;

  // food sheet: 16 cells of 48x48 (drawImage only — must work from file://)
  const foodImg = new Image();
  foodImg.src = 'assets/food.png';
  const F = { apple: 0, banana: 1, milk: 2, bread: 3, beef: 4, pork: 5, fish: 6, ramen: 7, cheese: 8, cake: 9, chips: 10, cola: 11, cupcake: 12, choco: 13, lettuce: 14, tomato: 15 };

  // ---------------------------------------------------------------------------
  // people (12x20 front view, 2 walk frames) — plain everyday folks
  // ---------------------------------------------------------------------------
  const BODY = [
    '....hhhh....', '...hhhhhh...', '..hhhhhhhh..', '..hssssssh..', '..sesssses..',
    '..ssssssss..', '...ssmmss...', '....ssss....', '...tttttt...', '..tttttttt..',
    '.tttttttttt.', '.tt.tttt.tt.', '.tt.tttt.tt.', '.ss.tttt.ss.', '...pppppp...',
    '...pppppp...',
  ];
  const LEGS_A = ['...pp..pp...', '...pp..pp...', '...pp..pp...', '..kkk..kkk..'];
  const LEGS_B = ['...pp..pp...', '..pp....pp..', '..pp....pp..', '.kkk....kkk.'];
  const PAL_ME = { h: '#3b2a20', s: '#f1c9a0', e: '#2a1a14', m: '#c46a5a', t: '#7d8592', p: '#34507e', k: '#eeeeee' };
  const PAL_CLERK = { h: '#1c1c22', s: '#e9bf95', e: '#2a1a14', m: '#c46a5a', t: '#f2f2f2', p: '#3a3a3a', k: '#222222' };

  function makeSprites() {
    const mk = PK.U.makeSprite;
    const pair = (pal) => [mk(BODY.concat(LEGS_A), pal), mk(BODY.concat(LEGS_B), pal)];
    spr = { me: pair(PAL_ME), clerk: pair(PAL_CLERK) };
  }

  // ---------------------------------------------------------------------------
  // drawing helpers
  // ---------------------------------------------------------------------------
  function R(c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function label(s, x, y, col, size) {
    g.font = (size || 8) + 'px DungGeunMo, Galmuri11, NeoDunggeunmo, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = col; g.fillText(s, Math.round(x), Math.round(y));
  }
  // x = center, by = feet; returns sprite top-left for attachments
  function person(pair, x, by, frame, bob) {
    const s = pair[frame ? 1 : 0], w = s.width * 2, h = s.height * 2;
    const x0 = Math.round(x - w / 2), y0 = Math.round(by - h - (bob || 0));
    R('rgba(0,0,0,0.18)', x0 + 2, by - 2, w - 4, 3);
    g.drawImage(s, x0, y0, w, h);
    return [x0, y0];
  }
  function clerk(x, by) {                          // white shirt + green apron
    const c = person(spr.clerk, x, by, 0, 0);
    R('#2f8a4a', c[0] + 6, c[1] + 18, 12, 14); R('#ffd84a', c[0] + 14, c[1] + 20, 3, 2);
    return c;
  }
  function pack(x, y) {                           // meat tray, top-left
    R('#000', x - 1, y - 1, 16, 9);
    R('#f4f4f4', x, y, 14, 7);
    R('#d9626b', x + 2, y + 1, 10, 4);
    R('#f3c3c3', x + 3, y + 2, 7, 1);
    R('#ffd84a', x + 9, y + 4, 4, 2);
  }
  // food sprite centered on (x, y); s = scale of the 48px cell
  function food(i, x, y, s) {
    if (!foodImg.complete || !foodImg.naturalWidth) return;
    const d = Math.round(48 * s);
    g.drawImage(foodImg, i * 48, 0, 48, 48, Math.round(x - d / 2), Math.round(y - d / 2), d, d);
  }
  // shopping bag: x = center, by = bottom; items peek out of the top
  function bag(x, by, w, h, items, s) {
    const x0 = Math.round(x - w / 2), y0 = by - h, sp = (w - 6) / 3;
    R('#cfcfca', x0 + 3, y0 - 4, 2, 5); R('#cfcfca', x0 + w - 5, y0 - 4, 2, 5);
    for (let j = 0; j < items.length; j++) food(items[j], x0 + 3 + (j % 4) * sp, y0 - 1 - (j >> 2) * 4, s);
    R('#000', x0 - 1, y0, w + 2, h + 1);
    R('#f6f6f2', x0, y0 + 1, w, h - 1);
    R('#3cb84a', x0, y0 + Math.round(h * 0.4), w, 2);
  }
  // kart from behind (PK.Karts.sprite may still be blank while its art loads); returns top y
  // empty = parked cart with nobody in it
  function kart(def, isP, cx, by, w, empty) {
    let s = null;
    try { s = PK.Karts && PK.Karts.sprite ? PK.Karts.sprite(def, isP, !!empty) : null; } catch (e) { s = null; }
    R('rgba(0,0,0,0.25)', Math.round(cx - w * 0.45), by - 3, Math.round(w * 0.9), 4);
    if (!s || !s.width) return by - w * 0.7;
    const h = Math.round(w * s.height / s.width);
    g.imageSmoothingEnabled = false;
    g.drawImage(s, Math.round(cx - w / 2), by - h, Math.round(w), h);
    return by - h;
  }
  function emote(s, x, y, t) {
    const yy = Math.round(y - 4 + Math.sin(t * 6) * 1.5);
    R('#000', x - 8, yy - 7, 16, 13);
    R('#fff', x - 7, yy - 6, 14, 11);
    R('#fff', x - 1, yy + 5, 3, 2);
    label(s, x, yy, '#d8382f', 9);
  }
  function tiles(y0, a, b) {
    for (let y = y0, r = 0; y < H; y += 12, r++) for (let x = 0; x < W; x += 16) R(((x >> 4) + r) & 1 ? a : b, x, y, 16, 12);
  }
  function boards(a, b, seam) {                   // wooden floor
    for (let y = 100, r = 0; y < H; y += 8, r++) {
      R(r & 1 ? a : b, 0, y, W, 8);
      for (let x = (r & 1) * 30; x < W; x += 60) R(seam, x, y, 1, 8);
    }
  }
  function myKart() {
    const n = PK.Karts && PK.Karts.DEFS ? PK.Karts.DEFS.length : 1;
    const k = parseInt(lsGet(LS_KART), 10);
    return k >= 0 && k < n ? k : 0;
  }
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  // ---------------------------------------------------------------------------
  // opening scenes
  // ---------------------------------------------------------------------------
  // layout: everything that matters stays above y≈134; the dialogue box covers the rest
  function sHome(t, li) {
    R('#e9dcbf', 0, 0, W, 100);
    R('#cdbb96', 0, 92, W, 8);
    boards('#a06c43', '#a8744a', '#875a37');
    // window with evening sky
    R('#fff', 34, 14, 76, 58);
    ['#c86a8a', '#f08a5a', '#ffb36b', '#ffd38a'].forEach((c, i) => R(c, 38, 18 + i * 12.5, 68, 13));
    R('#ffe9a0', 76, 52, 14, 14);
    R('#fff', 70, 18, 3, 50); R('#fff', 38, 42, 68, 3);
    R('#d8524a', 28, 10, 8, 68); R('#d8524a', 108, 10, 8, 68);
    // wall clock
    R('#3a2a20', 142, 20, 16, 16); R('#fff', 144, 22, 12, 12); R('#3a2a20', 149, 24, 2, 5); R('#3a2a20', 150, 28, 4, 2);
    // fridge
    const fx = 212, fy = 28, open = li >= 1;
    R('#000', fx - 1, fy - 1, 44, 92);
    R('#e3e9ec', fx, fy, 42, 90);
    if (open) {
      R('#fdf8e4', fx + 3, fy + 3, 36, 84);
      [24, 46, 66].forEach((y) => R('#cfd8dc', fx + 3, fy + y, 36, 2));
      R('#d8382f', fx + 30, fy + 56, 4, 10);  // one lonely ketchup
      R('#000', fx + 41, fy - 3, 14, 96); R('#d4dde1', fx + 42, fy - 2, 12, 94); R('#9aa6ad', fx + 44, fy + 30, 2, 18);
      g.fillStyle = 'rgba(255,248,200,0.22)';
      g.beginPath(); g.moveTo(fx, fy + 90); g.lineTo(fx + 42, fy + 90); g.lineTo(fx + 30, H); g.lineTo(fx - 40, H); g.fill();
    } else {
      R('#c3ccd1', fx, fy + 30, 42, 2);
      R('#9aa6ad', fx + 4, fy + 10, 2, 14); R('#9aa6ad', fx + 4, fy + 38, 2, 20);
    }
    // small table
    R('#7a4e2e', 20, 90, 64, 6); R('#6a4226', 26, 96, 4, 26); R('#6a4226', 74, 96, 4, 26);
    R('#fff', 40, 84, 12, 6); R('#ddd', 41, 83, 10, 2);
    const p = person(spr.me, 180, 128, 0, 0);
    if (li === 1) emote('…', 180, p[1] - 6, t);
    else if (li >= 2) emote('!', 180, p[1] - 6, t);
  }

  // shared street backdrop (dusk on the way there, night on the way back)
  // closed: the mart has shut for the night (shutter down, emergency exit beside it); exitOpen: that door stands open
  function street(t, night, closed, exitOpen) {
    const sky = night ? ['#070b24', '#0c1334', '#121c44', '#182452', '#1e2c5e', '#26366a'] : ['#4a3570', '#7a4888', '#c25a7a', '#ec8058', '#ffb06a', '#ffcf8a'];
    sky.forEach((c, i) => R(c, 0, i * 16, W, 16));
    if (night) {
      for (let i = 0; i < 28; i++) { const sx = (i * 73 + 11) % 190, sy = (i * 37 + 5) % 60; if (((t * 2 + i) | 0) % 7) R('#dfe6ff', sx, sy, 1, 1); }
      R('#fff6c8', 40, 14, 14, 14); R('#fffbe4', 42, 16, 4, 4); R(sky[0], 47, 12, 10, 12);   // crescent
    } else { R('#ffe9a0', 52, 60, 26, 14); R('#fff3c4', 56, 58, 18, 4); }
    // skyline
    [[0, 38, 34], [36, 52, 28], [66, 30, 40], [108, 58, 30], [140, 44, 36], [178, 64, 24]].forEach(([x, y, w], i) => {
      R(night ? '#161626' : '#3a2a4a', x, y, w, 108 - y);
      for (let wy = y + 6; wy < 98; wy += 10) for (let wx = x + 4; wx < x + w - 4; wx += 8) if ((wx * 7 + wy * 3 + i) % 5 < (night ? 3 : 2)) R('#ffd86a', wx, wy, 3, 4);
    });
    // mart
    R('#000', 195, 11, 126, 98);
    R(night ? '#c9c3b4' : '#f4efe2', 196, 12, 124, 96);
    R('#d8382f', 196, 12, 124, 18);
    label('슈퍼마트', 258, 21, night ? '#fff6a0' : '#fff', 12);
    for (let x = 196; x < 320; x += 12) R((x / 12) & 1 ? '#fff' : '#3cb84a', x, 30, 12, 8);
    R('#000', 239, 57, 54, 51);
    if (closed) {                                   // rolling shutter over the entrance
      R('#7d838c', 240, 58, 52, 50);
      for (let y = 61; y < 104; y += 4) R('#5f656e', 240, y, 52, 1);
      R('#3a3d44', 240, 104, 52, 4); R('#c8c8c8', 263, 101, 6, 2);
    } else if (night) { R('#ffe9a8', 240, 58, 52, 50); R('#fff6d0', 242, 60, 22, 46); R('#c8a860', 265, 58, 2, 50); }
    else { R('#9fd4e8', 240, 58, 52, 50); R('#c8eaf5', 242, 60, 22, 46); R('#5a8aa0', 265, 58, 2, 50); }
    if (closed) {                                   // emergency exit where the SALE poster used to be
      R('#000', 206, 55, 28, 10); R('#3cb84a', 207, 56, 26, 8); label('비상구', 220, 60, '#fff', 7);
      R('#000', 207, 66, 26, 42);
      if (exitOpen) {
        R('#15151c', 208, 67, 24, 41);
        R('#000', 199, 65, 10, 44); R('#2f7a4a', 200, 66, 8, 42); R('#ddd', 201, 86, 2, 3);
      } else {
        R('#2f7a4a', 208, 67, 24, 41); R('#24603a', 208, 67, 24, 1); R('#ddd', 228, 86, 2, 3);
      }
    } else {
      R('#000', 205, 63, 30, 30); R('#ffe14d', 206, 64, 28, 28);
      label('목살', 220, 73, '#d8382f', 9); label('SALE', 220, 85, '#d8382f', 7);
    }
    // carts by the door
    for (let i = 0; i < 2; i++) { const cx = 298 + i * 6; R('#9aa6ad', cx, 86, 14, 1); R('#9aa6ad', cx, 86, 1, 14); R('#9aa6ad', cx + 13, 86, 1, 14); R('#9aa6ad', cx, 99, 14, 1); R('#222', cx + 1, 102, 3, 3); R('#222', cx + 10, 102, 3, 3); }
    // street lamp
    R('#2a2a33', 150, 38, 3, 72); R('#2a2a33', 146, 36, 12, 4); R('#fff3a0', 148, 40, 8, 4);
    // sidewalk
    R(night ? '#5e5a66' : '#b9b2a8', 0, 108, W, H - 108);
    R(night ? '#46424e' : '#8e877e', 0, 108, W, 2);
    for (let x = 0; x < W; x += 32) R(night ? '#524e5a' : '#a49d93', x, 110, 1, H - 110);
    if (night) {
      g.fillStyle = 'rgba(255,240,160,0.16)';
      g.beginPath(); g.moveTo(148, 44); g.lineTo(156, 44); g.lineTo(186, 134); g.lineTo(118, 134); g.fill();
      if (closed) { if (exitOpen) { g.fillStyle = 'rgba(60,184,74,0.14)'; g.fillRect(196, 108, 44, 14); } }
      else { g.fillStyle = 'rgba(255,233,168,0.18)'; g.fillRect(232, 108, 68, 18); }   // light spilling from the door
    }
  }

  function sStreet(t, li) {
    street(t, false);
    const px = 24 + Math.min(t, 4.6) * 44, moving = t < 4.6;
    const fr = moving ? ((t * 7) | 0) & 1 : 0;
    const p = person(spr.me, px, 132, fr, moving && fr ? 1 : 0);
    if (li >= 1) emote('♪', px, p[1] - 6, t);
  }

  function sMeat(t, li) {
    R('#f3efe6', 0, 0, W, 96);
    tiles(96, '#e1e5e8', '#cdd3d8');
    R('#000', 109, 3, 102, 20); R('#d8382f', 110, 4, 100, 18); R('#666', 130, 0, 1, 3); R('#666', 190, 0, 1, 3);
    label('정육 코너', 160, 13, '#fff', 11);
    // meat case
    R('#000', 39, 29, 242, 75);
    R('#f8fbff', 40, 30, 240, 56);
    R('#dfe9ef', 40, 58, 240, 2);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
      const x = 48 + i * 26, y = 40 + row * 28;
      if (li >= 1 && row === 1 && i === 4) continue;      // the pack we picked
      pack(x, y);
    }
    R('#ffe14d', 150, 78, 20, 8); label('목살', 160, 82, '#d8382f', 7);
    g.fillStyle = 'rgba(180,225,240,0.25)'; g.fillRect(40, 30, 240, 56);
    R('#3d6e8f', 40, 86, 240, 18); R('#2c5470', 40, 86, 240, 2);
    const p = person(spr.me, 160, 132, 0, 0);
    if (li >= 1) pack(p[0] + 5, p[1] + 24);
    emote(li >= 2 ? '!' : li >= 1 ? '♪' : '!', 160, p[1] - 6, t);
  }

  // start line inside the mart: stocked aisle, far-away checkout sign, three karts from behind
  function sStart(me) {
    const n = PK.Karts && PK.Karts.DEFS ? PK.Karts.DEFS.length : 1;
    const a = (me + 1) % n, b = (me + 2) % n;
    return function (t, li) {
      R('#efe9da', 0, 0, W, 96);
      tiles(96, '#e1e5e8', '#cdd3d8');
      // shelving with stock
      R('#000', 5, 21, 310, 76); R('#c9d2d8', 6, 22, 308, 74);
      [42, 66, 90].forEach((by, r) => {
        for (let c = 0; c < 17; c++) food((c * 5 + r * 7 + 3) % 16, 16 + c * 18, by - 7, 0.4);
        R('#7d8a93', 6, by, 308, 3); R('#ffe14d', 6, by + 3, 308, 1);
      });
      for (let x = 6; x < 314; x += 77) R('#7d8a93', x, 22, 3, 74);
      // far checkout sign
      R('#555', 21, 0, 1, 5); R('#555', 55, 0, 1, 5);          // left side: the skip button sits top-right
      R('#000', 10, 4, 56, 15); R('#3cb84a', 11, 5, 54, 13);
      label('계산대 →', 38, 12, '#fff', 8);
      // start lights
      R('#333', 159, 0, 2, 4); R('#000', 141, 3, 38, 14); R('#222', 142, 4, 36, 12);
      for (let i = 0; i < 3; i++) {
        const on = li >= 1 && (li >= 3 ? true : i <= (((t * 2) | 0) % 3));
        R(on ? (li >= 3 ? '#40ff60' : '#ff4040') : '#552222', 146 + i * 11, 7, 7, 6);
      }
      // checkered start strip
      for (let x = 0, c = 0; x < W; x += 6, c++) { R(c & 1 ? '#222' : '#fff', x, 100, 6, 4); R(c & 1 ? '#fff' : '#222', x, 104, 6, 4); }
      const bob = (i) => (li >= 3 ? Math.round(Math.sin(t * 18 + i) * 0.8) : 0);
      kart(a, false, 82, 128 + bob(1), 52);
      kart(b, false, 238, 128 + bob(2), 52);
      const top = kart(me, true, 160, 130 + bob(0), 60);
      if (li >= 1 && li <= 2) emote('♪', 290, 30, t);
      if (li >= 3) emote('!', 160, top - 6, t);
    };
  }

  // ---------------------------------------------------------------------------
  // ending scenes
  // ---------------------------------------------------------------------------
  const ITEMS = [[F.pork, 12900], [F.apple, 2500], [F.banana, 3900], [F.milk, 2800], [F.ramen, 4500], [F.lettuce, 1900], [F.cola, 1800], [F.tomato, 4900]];
  const TOTAL = ITEMS.reduce((s, it) => s + it[1], 0);
  const STEP = 0.45;               // seconds per scanned item

  function sPay(free, me) {
    let t0 = -1;                   // scan start (scene time); keeps running even if lines are skipped
    return function (t, li) {
      R('#f3efe6', 0, 0, W, 96);
      tiles(96, '#e1e5e8', '#cdd3d8');
      R('#000', 149, 3, 82, 20); R('#3cb84a', 150, 4, 80, 18);
      label('계산대 1', 190, 13, '#fff', 10);
      const N = ITEMS.length;
      if (li >= 2 && t0 < 0) t0 = t;
      let pr = t0 < 0 ? 0 : (t - t0) / STEP;
      if (li >= 3) pr = N;
      pr = Math.min(pr, N);
      const n = Math.floor(pr), fr = pr - n;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += ITEMS[i][1];
      const c = clerk(262, 102);
      // register
      R('#000', 287, 49, 32, 30); R('#55555f', 288, 50, 30, 28);
      R('#1b2a1c', 290, 53, 26, 10);
      label((free && li >= 4 ? 0 : li >= 3 ? TOTAL : sum).toLocaleString('ko-KR'), 303, 58, '#9fe8a0', 7);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) R('#8a8a96', 292 + x * 6, 66 + y * 5, 4, 3);
      // counter + conveyor
      R('#000', 95, 79, 226, 40);
      R('#c9a77a', 96, 80, 224, 6);
      R('#8a6a4a', 96, 86, 224, 32);
      R('#2a2a2a', 96, 74, 94, 6);
      const run = t0 >= 0 && n < N;
      for (let x = 96 + ((run ? t * 20 : 0) | 0) % 10; x < 190; x += 10) R('#444', x, 75, 1, 4);
      R('#1a1a1a', 192, 76, 22, 4);
      const beepNow = run && fr >= 0.5 && fr < 0.7;
      R(beepNow ? '#ff4040' : '#702020', 196, 77, 14, 2);
      if (beepNow) { g.fillStyle = 'rgba(255,60,60,0.35)'; g.fillRect(192, 58, 22, 18); }
      // bag with what's been scanned
      bag(229, 80, 26, 16, ITEMS.slice(0, n).map((it) => it[0]), 0.36);
      // items on the belt (back to front)
      for (let i = N - 1; i >= n; i--) {
        let x, y = 68;
        if (i === n && t0 >= 0) {
          if (fr < 0.5) x = 180 + fr * 2 * 23;
          else if (fr < 0.7) x = 203;
          else { const k = (fr - 0.7) / 0.3; x = 203 + k * 26; y = 68 - Math.sin(k * Math.PI) * 14; }
        } else x = 180 - (i - n) * 10 + (t0 >= 0 ? Math.min(1, fr * 2) * 10 : 0);
        food(ITEMS[i][0], x, y, 0.4);
      }
      if (beepNow) { R('#000', 183, 41, 40, 11); R('#fff', 184, 42, 38, 9); label(won(ITEMS[n][1]), 203, 47, '#d8382f', 7); }
      // total
      if (li >= 3) {
        R('#000', 235, 27, 84, 19); R('#fff', 236, 28, 82, 17);
        if (free && li >= 4) {
          label(won(TOTAL), 277, 33, '#999', 7); R('#d8382f', 255, 33, 44, 1);
          label('0원!', 277, 41, '#d8382f', 8);
        } else label('합계 ' + won(TOTAL), 277, 37, '#222', 8);
      }
      // hero parked the (now empty) cart and walks up
      kart(me, true, 30, 132, 44, true);
      const wk = Math.min(t, 1.2) / 1.2, moving = wk < 1;
      const f = moving ? ((t * 7) | 0) & 1 : 0;
      const hx = 30 + wk * 50;
      const p = person(spr.me, hx, 132, f, moving && f ? 1 : 0);
      if (li === 1) emote('!', 262, c[1] - 6, t);
      if (li >= 4) {
        if (free) {
          emote('!!', hx, p[1] - 6, t);
          const cols = ['#ff4040', '#ffcc00', '#40c8ff', '#40ff60', '#ff80d0'];
          for (let i = 0; i < 30; i++) R(cols[i % 5], (i * 53 + 17 + Math.sin(t * 3 + i) * 6) % W, (t * 40 + i * 37) % 130, 2, 2);
        } else if (li === 4) emote('…', hx, p[1] - 6, t);
        else emote('♪', 262, c[1] - 6, t);
      }
    };
  }

  // closing time: the hero wandered into the stockroom with the cart; lights go out and the shutter comes down
  function sWarehouse(me) {
    let t0 = -1;                   // lights-out time (scene time)
    return function (t, li) {
      const dark = li >= 2;
      if (dark && t0 < 0) t0 = t;
      R('#5a5f66', 0, 0, W, 100);
      R('#4a4f56', 0, 92, W, 8);
      tiles(100, '#6e6a62', '#66625a');
      // ceiling lamps
      [60, 160, 260].forEach((x) => { R('#2a2a33', x - 1, 0, 2, 4); R('#000', x - 9, 4, 18, 4); R(dark ? '#3a3a40' : '#fff6c8', x - 8, 5, 16, 2); });
      // emergency exit (left)
      R('#000', 12, 24, 46, 13); R('#3cb84a', 13, 25, 44, 11); label('비상구', 35, 31, '#fff', 8);
      R('#000', 17, 39, 36, 62); R('#2f7a4a', 18, 40, 34, 60); R('#24603a', 18, 40, 34, 1); R('#ddd', 46, 70, 3, 2);
      // racks with boxes (middle)
      [66, 126, 183].forEach((x) => R('#c86a2a', x, 26, 3, 74));
      [44, 70, 96].forEach((by, r) => {
        R('#d8762a', 66, by, 120, 3);
        for (let c = 0, x = 70; x < 180; c++) {
          const bw = 14 + ((c * 7 + r * 5) % 4) * 3, bh = 12 + ((c * 3 + r) % 3) * 3;
          if (x + bw > 183) break;
          R('#000', x - 1, by - bh - 1, bw + 2, bh + 1); R('#b58a52', x, by - bh, bw, bh);
          R('#d9b77a', x + (bw >> 1) - 1, by - bh, 2, bh); R('#9a7240', x, by - 2, bw, 2);
          x += bw + 3;
        }
      });
      // shutter (right): the bright shop floor shows underneath while it closes
      const prog = t0 < 0 ? 0 : Math.min(li >= 3 ? 0.9 : 0.7, 0.12 + (t - t0) / 7);
      const sh = Math.round(76 * prog);
      R('#000', 195, 24, 110, 80);
      R('#ffe9a8', 196, 26, 108, 76); R('#e3d8b8', 196, 86, 108, 16);
      for (let x = 204; x < 304; x += 26) R('#c9d2d8', x, 40, 18, 46);
      R('#7d838c', 196, 26, 108, sh);
      for (let y = 29; y < 26 + sh - 3; y += 4) R('#5f656e', 196, y, 108, 1);
      if (sh > 0) R('#3a3d44', 196, 26 + sh - 3, 108, 3);
      // warning beacon
      const on = dark && ((t * 4) | 0) & 1;
      R('#000', 245, 13, 10, 9); R(on ? '#ff4040' : '#702020', 246, 14, 8, 7);
      // parked cart (empty) with the shopping bag in the basket, hero beside it
      const top = kart(me, true, 112, 132, 44, true);
      bag(112, top + 32, 18, 12, [F.pork, F.lettuce, F.banana, F.cola], 0.3);
      const p = person(spr.me, 152, 132, 0, 0);
      if (dark) {
        g.fillStyle = 'rgba(5,8,20,0.62)'; g.fillRect(0, 0, W, H);
        // what still glows in the dark: exit sign, the gap under the shutter, the beacon
        R('#3cb84a', 13, 25, 44, 11); label('비상구', 35, 31, '#fff', 8);
        g.fillStyle = 'rgba(60,184,74,0.16)'; g.fillRect(8, 20, 54, 84);
        g.fillStyle = 'rgba(255,233,168,0.45)'; g.fillRect(196, 26 + sh, 108, 76 - sh);
        if (on) { R('#ff4040', 246, 14, 8, 7); g.fillStyle = 'rgba(255,40,40,0.18)'; g.fillRect(230, 6, 40, 24); }
      }
      if (li === 1) emote('?', 152, p[1] - 6, t);
      else if (li === 2) emote('!', 152, p[1] - 6, t);
      else if (li >= 3) emote('!!', 152, p[1] - 6, t);
    };
  }

  // out through the emergency exit into the night, pushing the empty cart with the bag in it
  function sEscape(me) {
    return function (t, li) {
      street(t, true, true, true);
      const wk = Math.min(t, 1.6) / 1.6, moving = wk < 1;
      const fr = moving ? ((t * 7) | 0) & 1 : 0;
      const hx = 222 - wk * 80;
      const top = kart(me, true, hx - 30, 132, 40, true);
      bag(hx - 30, top + 29, 16, 11, [F.pork, F.lettuce, F.cola], 0.28);
      const p = person(spr.me, hx, 132, fr, moving && fr ? 1 : 0);
      if (li === 0) emote('!', hx, p[1] - 6, t);
      else emote(li === 1 ? '…' : '♪', hx, p[1] - 6, t);
    };
  }

  // walking home: the bag tears and every food item flies out across the street
  const SCATTER = [[30, 121], [68, 128], [100, 115], [140, 129], [182, 117], [220, 127], [256, 114], [292, 124]];
  function sNight(me) {
    let t0 = -1, stopX = 0;        // tear time (scene time) + where the hero stood
    return function (t, li) {
      street(t, true, true, false);
      const walkX = 262 - Math.min(t, 4.6) * 44;
      if (li >= 2 && t0 < 0) { t0 = t; stopX = walkX; }
      const torn = t0 >= 0, px = torn ? stopX : walkX, moving = !torn && t < 4.6;
      const fr = moving ? ((t * 7) | 0) & 1 : 0;
      kart(me, true, px - 30, 132, 40, true);
      const p = person(spr.me, px, 132, fr, moving && fr ? 1 : 0);
      const bx = p[0] + 23, bby = p[1] + 40;
      if (!torn) bag(bx, bby, 13, 11, [F.lettuce, F.banana, F.cola], 0.3);
      else {
        bag(bx, bby, 13, 11, [], 0.3);
        R('#000', bx - 4, bby - 2, 8, 2); R('#000', bx - 2, bby, 4, 1); R('#000', bx + 1, bby - 4, 2, 2);   // the rip
        const tt0 = t - t0, DUR = 0.75;
        for (let i = 0; i < ITEMS.length; i++) {
          const tt = tt0 - i * 0.06;
          if (tt < 0) continue;
          const tx = SCATTER[i][0], ty = SCATTER[i][1], sy = bby - 6;
          const u = Math.min(1, tt / DUR);
          const x = bx + (tx - bx) * u;
          let y = sy + (ty - sy) * u - Math.sin(u * Math.PI) * (26 + (i % 3) * 10);
          if (u >= 1) {
            y = ty - Math.abs(Math.sin((tt - DUR) * 9)) * 4 * Math.exp(-(tt - DUR) * 4);
            R('rgba(0,0,0,0.22)', Math.round(tx - 7), ty + 6, 14, 2);
          }
          food(ITEMS[i][0], x, y, 0.38);
        }
        if (tt0 < 0.35) { g.fillStyle = 'rgba(255,255,255,' + (0.5 * (1 - tt0 / 0.35)).toFixed(2) + ')'; g.fillRect(bx - 10, bby - 14, 20, 16); }
      }
      if (li === 1) emote('♪', px, p[1] - 6, t);
      else if (li === 2) emote('!', px, p[1] - 6, t);
      else if (li >= 3) emote('!!', px, p[1] - 6, t);
    };
  }

  function sDinner(t, li) {
    R('#d6c393', 0, 0, W, 100);
    R('#b8a375', 0, 92, W, 8);
    boards('#8a5a36', '#92603b', '#70482a');
    // night window
    R('#fff', 34, 14, 76, 58); R('#141a3c', 38, 18, 68, 50);
    for (let i = 0; i < 9; i++) R('#dfe6ff', 40 + (i * 23) % 64, 20 + (i * 17) % 44, 1, 1);
    R('#fff6c8', 86, 24, 10, 10); R('#141a3c', 90, 22, 8, 9);
    R('#fff', 70, 18, 3, 50); R('#fff', 38, 42, 68, 3);
    R('#d8524a', 28, 10, 8, 68); R('#d8524a', 108, 10, 8, 68);
    // fridge (full again)
    R('#000', 265, 27, 44, 92); R('#e3e9ec', 266, 28, 42, 90); R('#c3ccd1', 266, 58, 42, 2);
    R('#9aa6ad', 270, 38, 2, 14); R('#9aa6ad', 270, 66, 2, 20);
    // groceries bag on the floor
    bag(30, 128, 22, 18, [F.milk, F.apple, F.ramen], 0.36);
    // ceiling lamp + warm light
    R('#3a2a20', 147, 0, 2, 12); R('#000', 135, 11, 26, 9); R('#ffcf6a', 136, 12, 24, 7);
    g.fillStyle = 'rgba(255,225,140,0.14)';
    g.beginPath(); g.moveTo(136, 19); g.lineTo(160, 19); g.lineTo(214, 92); g.lineTo(76, 92); g.fill();
    // table
    R('#000', 69, 89, 148, 8); R('#7a4e2e', 70, 90, 146, 6); R('#6a4226', 76, 96, 4, 30); R('#6a4226', 206, 96, 4, 30);
    food(F.lettuce, 88, 82, 0.45);
    food(F.tomato, 186, 82, 0.45);
    food(F.cola, 205, 81, 0.45);
    // pan with 목살 browning over time
    R('#000', 109, 84, 48, 7); R('#2a2a2e', 110, 84, 46, 5); R('#3a3a40', 110, 84, 46, 1);
    R('#3a2a20', 157, 85, 16, 3);
    const k = Math.min(1, t / 6 + (li >= 2 ? 0.5 : 0));
    const mix = (a, b) => Math.round(a + (b - a) * k);
    const meat = 'rgb(' + mix(217, 150) + ',' + mix(98, 80) + ',' + mix(107, 46) + ')';
    for (let i = 0; i < 2; i++) {
      const mx = 115 + i * 19;
      R(meat, mx, 80, 16, 5); R(k > 0.5 ? '#e8c89a' : '#f3c3c3', mx + 2, 81, 11, 1);
      if (k > 0.6) { R('#5a3018', mx + 4, 80, 1, 5); R('#5a3018', mx + 10, 80, 1, 5); }
    }
    for (let i = 0; i < 6; i++) {
      const ph = (t * 0.7 + i / 6) % 1;
      g.fillStyle = 'rgba(240,240,240,' + (0.5 * (1 - ph)).toFixed(2) + ')';
      g.fillRect(Math.round(118 + i * 6 + Math.sin(t * 2 + i) * 3), Math.round(78 - ph * 34), 2, 2);
    }
    const p = person(spr.me, 236, 128, 0, 0);
    if (li >= 2) { R('#000', p[0] + 17, p[1] + 19, 8, 7); R('#4a9a3a', p[0] + 18, p[1] + 20, 6, 5); R('#9a5a32', p[0] + 19, p[1] + 22, 4, 2); }
    if (li <= 1) emote('♪', 236, p[1] - 6, t);
    else if (li === 2) emote('♥', 236, p[1] - 6, t);
  }

  // ---------------------------------------------------------------------------
  // scripts (built when play() starts so lines/art can depend on ctx)
  // ---------------------------------------------------------------------------
  const SCRIPTS = {
    intro: () => [
      { draw: sHome, lines: [
        ['나', '아… 배고프다. 저녁 뭐 먹지?'],
        ['나', '(냉장고를 연다) …텅 비었네.'],
        ['나', '그래, 오늘은 목살이다! 지글지글 구워 먹어야지.'],
        ['나', '마트 가서 목살 사 오자!'],
      ] },
      { draw: sStreet, lines: [
        ['', '해 질 무렵, 동네 슈퍼마트로 향했다.'],
        ['나', '오늘 목살 세일한다고 했지, 아마.'],
      ] },
      { draw: sMeat, lines: [
        ['나', '정육 코너… 찾았다, 목살!'],
        ['나', '두툼한 걸로 한 팩. 좋아, 이걸로.'],
        ['나', '자, 계산하자!'],
      ] },
      { draw: sStart(myKart()), lines: [
        ['', '그런데… 계산대가 매장 반대편 끝에 있다.'],
        ['안내 방송', '딩동~ 지금부터 계산대까지 카트 레이스를 시작합니다!'],
        ['안내 방송', '1등으로 계산대에 도착한 손님은 오늘 장 본 거 전부 공짜!'],
        ['나', '…공짜 목살? 카트 타고 계산대까지 간다!'],
      ] },
    ],
    // after the race: pay at the checkout, then get locked in the stockroom at closing time (→ Stage 2)
    checkout: (c) => {
      const place = c.place >= 1 ? c.place | 0 : 6, free = place === 1, me = myKart();
      return [
        { draw: sPay(free, me), lines: free ? [
          ['나', '헉헉… 계산대 도착!'],
          ['점원', '축하드려요! 1등으로 들어오셨네요!'],
          ['점원', '그럼 하나씩 찍어 드릴게요. 삑, 삑, 삑…'],
          ['점원', '전부 해서 ' + won(TOTAL) + '인데요…'],
          ['점원', '1등 상품으로 오늘 장 보신 건 전부 공짜예요!'],
          ['나', '공짜 목살이다! 감사합니다!'],
        ] : [
          ['나', '헉헉… 계산대 도착!'],
          ['점원', place + '등으로 들어오셨네요. 고생 많으셨어요!'],
          ['점원', '그럼 하나씩 찍어 드릴게요. 삑, 삑, 삑…'],
          ['점원', '전부 해서 ' + won(TOTAL) + '입니다.'],
          ['나', '공짜는 놓쳤지만… 목살은 지켰다. 카드로 할게요.'],
          ['점원', '다음엔 꼭 1등 하세요! 감사합니다~'],
        ] },
        { draw: sWarehouse(me), lines: [
          ['안내 방송', '딩동~ 고객 여러분, 곧 영업을 종료합니다.'],
          ['나', free ? '공짜로 장 봤다! 이제 집에… 어라? 여긴 창고잖아?' : '자, 이제 집에 가자… 어라? 여긴 창고잖아?'],
          ['', '철컥— 불이 꺼지고, 셔터가 내려오기 시작했다!'],
          ['나', '창고에 갇혔다! 셔터가 다 내려가기 전에 비상구로 탈출하자!'],
        ] },
      ];
    },
    // after Stage 2: out of the mart, walking home — the bag tears and the food scatters (→ Stage 3)
    road: (c) => {
      const place = c.place >= 1 ? c.place | 0 : 6, free = place === 1, me = myKart();
      return [
        { draw: sEscape(me), lines: [
          ['', '덜컹! 비상구 문을 밀고 밖으로 뛰쳐나왔다.'],
          ['나', '휴… 살았다. 하마터면 마트에서 밤새울 뻔했네.'],
          ['나', '카트는 내일 꼭 돌려드리자. 일단 집으로!'],
        ] },
        { draw: sNight(me), lines: [
          ['', '봉투를 손에 들고 카트를 밀며, 밤길을 걸어 집으로.'],
          ['나', free ? '공짜로 이만큼이라니… 오늘 운 좋다.' : '좀 지치긴 했지만… 장바구니는 든든하다.'],
          ['', '부욱— 그 순간, 봉투가 찢어졌다!'],
          ['나', '으악! 음식이 길바닥에 다 흩어졌잖아!'],
          ['나', '떨어뜨린 음식을 전부 주워 가야 해! 카트에 싹 담자!'],
        ] },
      ];
    },
    // after Stage 3: dinner at home — the end
    home: () => [
      { draw: sDinner, lines: [
        ['나', '드디어 집! 하나도 안 빠뜨리고 다 챙겨 왔다.'],
        ['나', '지글지글… 목살 굽는 소리 최고다.'],
        ['나', '상추에 싸서 한 입… 이 맛이지!'],
        ['', '오늘의 장보기, 완료. — 끝 —'],
      ] },
    ],
  };

  // ---------------------------------------------------------------------------
  // flow
  // ---------------------------------------------------------------------------
  const curLine = () => SCENES[si].lines[li];

  function setLine() {
    const ln = curLine();
    el.name.textContent = ln[0];
    el.name.style.display = ln[0] ? '' : 'none';
    el.box.classList.toggle('narr', !ln[0]);
    shown = 0; lineT = 0;
    el.text.textContent = '';
  }

  function advance() {
    if (!active || leaving > 0 || fadeIn > FADE * 0.5) return;
    const txt = curLine()[1];
    if (shown < txt.length) { shown = txt.length; return; }
    if (beep) beep(0);
    if (li + 1 < SCENES[si].lines.length) { li++; setLine(); }
    else leaving = FADE;
  }

  function finish() {
    if (!active) return;
    active = false;
    if (markSeen) lsSet(LS_SEEN, '1');
    el.root.classList.remove('on');
    const cb = onDone; onDone = null;
    // defer so the key that ended the cutscene isn't also handled by the next screen
    if (cb) setTimeout(cb, 0);
  }

  function frame(ts) {
    if (!active) return;
    requestAnimationFrame(frame);
    const now = ts / 1000;
    const dt = last < 0 ? 0 : Math.min(0.1, now - last);
    last = now;
    sceneT += dt; lineT += dt;
    if (fadeIn > 0) fadeIn -= dt;
    if (leaving > 0) {
      leaving -= dt;
      if (leaving <= 0) {
        leaving = 0;
        if (si + 1 >= SCENES.length) { finish(); return; }
        si++; li = 0; sceneT = 0; fadeIn = FADE; setLine();
      }
    }
    const txt = curLine()[1];
    if (shown < txt.length && fadeIn <= 0) {
      shown = Math.min(txt.length, shown + dt * CPS);
      el.text.textContent = txt.slice(0, Math.floor(shown));
    }
    el.next.style.visibility = shown >= txt.length && !leaving ? 'visible' : 'hidden';

    g.imageSmoothingEnabled = false;
    SCENES[si].draw(sceneT, li, lineT);
    const a = fadeIn > 0 ? fadeIn / FADE : leaving > 0 ? 1 - leaving / FADE : 0;
    if (a > 0) { g.fillStyle = 'rgba(0,0,0,' + Math.min(1, a).toFixed(3) + ')'; g.fillRect(0, 0, W, H); }
  }

  function onKey(e) {
    if (!active || e.repeat) return;
    const c = e.code || e.key;
    if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') { e.preventDefault(); advance(); }
    else if (c === 'Escape') finish();
  }

  function bind() {
    if (el.root) return;
    el = {
      root: document.getElementById('intro'), cv: document.getElementById('introCv'), box: document.getElementById('introBox'),
      name: document.getElementById('introName'), text: document.getElementById('introText'),
      next: document.getElementById('introNext'), skip: document.getElementById('introSkip'),
    };
    g = el.cv.getContext('2d');
    makeSprites();
    window.addEventListener('keydown', onKey);
    el.root.addEventListener('pointerdown', (e) => { if (e.target !== el.skip) advance(); });
    el.skip.addEventListener('click', finish);
  }

  PK.Intro = {
    seen: () => lsGet(LS_SEEN) === '1',
    // scene names per script (for the stage test menu)
    SCENES: { intro: ['집', '거리', '정육 코너', '출발선'], checkout: ['계산대', '창고'], road: ['탈출', '밤길'], home: ['저녁 식사'] },
    // story foods bought at the checkout (food.png cell indices, scan order) — the items Stage 3 scatters
    FOODS: ITEMS.map((it) => it[0]),
    // name: 'intro' | 'checkout' | 'road' | 'home'; ctx: { place (race result: checkout/road lines),
    //   scene (start index — test start, never sets the seen flag) }
    // beepFn(kind) for UI blips; done() is called once the cutscene ends or is skipped
    play(name, ctx, beepFn, done) {
      bind();
      ctx = ctx || {};
      script = SCRIPTS[name] ? name : 'intro';
      SCENES = SCRIPTS[script](ctx);
      const start = ctx.scene >= 0 ? Math.min(ctx.scene | 0, SCENES.length - 1) : 0;
      markSeen = script === 'intro' && ctx.scene == null;
      beep = beepFn; onDone = done;
      active = true; si = start; li = 0; sceneT = 0; leaving = 0; fadeIn = FADE; last = -1;
      setLine();
      el.root.classList.add('on');
      requestAnimationFrame(frame);
    },
  };
})(window.PK);
