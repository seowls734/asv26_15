// PK.Kart3D — low-poly Three.js kart models (cart bodies + drivers) and their per-frame animation.
// Local frame: origin = ground centre, +X forward, +Y up, +Z right. The renderer owns the group's
// world position / heading; update() only animates the inner rig (lean, hop, spin, FX).
window.PK = window.PK || {};
(function (PK) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const has3 = () => !!(window.THREE && window.THREE.BoxGeometry && window.THREE.Mesh);

  // ---------------------------------------------------------------------------
  // Colours
  // ---------------------------------------------------------------------------
  const hexN = (c) => parseInt(c.slice(1), 16);
  function mix(a, b, t) {
    const A = hexN(a), B = hexN(b);
    const ch = (s) => Math.round(((A >> s) & 255) + ((((B >> s) & 255) - ((A >> s) & 255)) * t));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  const shade = (c, t) => mix(c, '#000000', t), tint = (c, t) => mix(c, '#ffffff', t);

  const STEEL = '#a4aab6', STEEL_D = '#5e6270', WIRE = '#c9ced8', TYRE = '#26242c', DARKF = '#3a3a46';
  const WOOD = '#b07a40', WOOD_D = '#7a5230', CARD = '#c8995a', TAPE = '#e8d8a8';
  const SKIN = '#e9bf95', SHOE = '#2a2228', EYE = '#1a1418';
  // drivers [hair, shirt, skin] — same as karts.js (ME = cutscene hero, SHOPPERS = AI)
  const ME = ['#3b2a20', '#7d8592', '#f1c9a0'];
  const SHOPPERS = [['#1c1c22', '#c8504a'], ['#7a5232', '#3a8a5a'], ['#d8b860', '#4a6ab8'], ['#8a8a90', '#b85a9a'], ['#2a1a10', '#e0a030'], ['#5a3420', '#5a5a66']];
  // fallback defs when PK.Karts is not loaded (tests)
  const FALLBACK = [['RED', '#e03a3a'], ['BLU', '#3a6ee8'], ['GRN', '#3cb84a'], ['YEL', '#f2c82c'], ['PNK', '#f06aa8'], ['BLK', '#2a2a33'],
    ['VAMP', '#8a1c2b', 'vamp', '#e8c040'], ['GHOST', '#b8c8f0', 'ghost', '#eef4ff'], ['GLITCH', '#00e8b8', 'glitch', '#ff40d0']]
    .map((r, i) => ({ id: i, name: r[0], color: r[1], ch: r[2], gripCol: r[3] }));
  const getDef = (i) => {
    const D = PK.Karts && PK.Karts.DEFS;
    return (D && D[i]) || FALLBACK[i] || FALLBACK[0];
  };
  const BODY_IDS = ['cart', 'stroller', 'airport', 'granny', 'parcel', 'rearcar'];
  const PHASE_ALPHA = 0.42;

  // ---------------------------------------------------------------------------
  // Shared caches (geometries / materials are flagged userData.k3shared and never disposed per kart)
  // ---------------------------------------------------------------------------
  const GEO = {}, MAT = {}, TEX = {};
  let FADE = new Map();
  const f3 = (v) => (+v).toFixed(3);
  const shared = (o) => { o.userData = o.userData || {}; o.userData.k3shared = true; return o; };
  const geo = (key, make) => GEO[key] || (GEO[key] = shared(make()));
  const box = (w, h, d) => geo('b' + f3(w) + ',' + f3(h) + ',' + f3(d), () => new THREE.BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, seg, open, ts, tl) => geo('c' + [rt, rb, h].map(f3) + ',' + seg + ',' + (open ? 1 : 0) + ',' + f3(ts || 0) + ',' + f3(tl || TAU),
    () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!open, ts || 0, tl || TAU));
  // cylinder lying along Z (wheels, cross bars)
  const cylZ = (r, len, seg) => geo('z' + f3(r) + ',' + f3(len) + ',' + seg, () => {
    const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); return g;
  });
  const sph = (r, ws, hs, tl) => geo('s' + f3(r) + ',' + ws + ',' + hs + ',' + f3(tl || Math.PI),
    () => new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, tl || Math.PI));
  // half-pipe hood (stroller canopy): arc in the XY plane, axis along Z
  const hood = (r, len, ts, tl) => geo('h' + [r, len, ts, tl].map(f3), () => {
    const g = new THREE.CylinderGeometry(r, r, len, 10, 1, true, ts, tl); g.rotateX(Math.PI / 2); return g;
  });

  // mat(color, {op, em, ds, dw, map}) — Lambert, cached by its settings
  function mat(color, o) {
    o = o || {};
    const key = color + '|' + (o.op || 1) + '|' + (o.em || '') + '|' + (o.ds ? 1 : 0) + '|' + (o.dw === 0 ? 0 : 1) + '|' + (o.mapKey || '');
    if (MAT[key]) return MAT[key];
    const p = { color };
    if (o.op && o.op < 1) { p.transparent = true; p.opacity = o.op; }
    if (o.em) p.emissive = o.em;
    if (o.ds) p.side = THREE.DoubleSide;
    if (o.dw === 0) p.depthWrite = false;
    if (o.map) p.map = o.map;
    return (MAT[key] = shared(new THREE.MeshLambertMaterial(p)));
  }
  // faded copy for the phase (유령화) effect
  function fade(m) {
    let f = FADE.get(m);
    if (!f) {
      f = shared(m.clone());
      f.transparent = true; f.opacity = (m.transparent ? m.opacity : 1) * PHASE_ALPHA; f.depthWrite = false;
      FADE.set(m, f);
    }
    return f;
  }
  // tartan texture for the granny trolley (falls back to a flat colour without a DOM)
  function tartan(base) {
    if (TEX[base] !== undefined) return TEX[base];
    let t = null;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      const g = cv.getContext('2d');
      g.fillStyle = base; g.fillRect(0, 0, 32, 32);
      g.fillStyle = shade(base, 0.35); g.fillRect(0, 8, 32, 6); g.fillRect(8, 0, 6, 32);
      g.fillStyle = 'rgba(20,20,40,0.35)'; g.fillRect(0, 22, 32, 4); g.fillRect(22, 0, 4, 32);
      g.fillStyle = '#f0d860'; g.fillRect(0, 17, 32, 1); g.fillRect(17, 0, 1, 32);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 3, 32, 1); g.fillRect(3, 0, 1, 32);
      t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
      t.magFilter = THREE.NearestFilter;
      if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
      shared(t);
    } catch (e) { t = null; }
    return (TEX[base] = t);
  }

  // ---------------------------------------------------------------------------
  // Mesh helpers
  // ---------------------------------------------------------------------------
  function part(parent, g, m, x, y, z, rx, ry, rz) {
    const o = new THREE.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    if (rx) o.rotation.x = rx;
    if (ry) o.rotation.y = ry;
    if (rz) o.rotation.z = rz;
    o.castShadow = true;
    parent.add(o);
    return o;
  }
  // round rod between two points in the XY plane at depth z
  function rod(parent, m, r, x1, y1, x2, y2, z) {
    const dx = x2 - x1, dy = y2 - y1;
    return part(parent, cyl(r, r, Math.hypot(dx, dy), 6), m, (x1 + x2) / 2, (y1 + y2) / 2, z, 0, 0, Math.atan2(-dx, dy));
  }
  const zbar = (parent, m, r, len, x, y, z) => part(parent, cylZ(r, len, 8), m, x, y, z || 0);
  // wheel (spins about Z) with a visible spoke / hub
  function wheel(B, r, w, x, y, z, spokes) {
    const wm = part(B.rig, cylZ(r, w, 12), mat(TYRE), x, y, z);
    const hub = mat(B.hub);
    const n = spokes || 1;
    for (let i = 0; i < n; i++) part(wm, box(r * 1.7, r * (n > 1 ? 0.14 : 0.3), w + 0.06), n > 1 ? mat(WOOD_D) : hub, 0, 0, 0, 0, 0, (i * Math.PI) / n);
    if (n > 1) part(wm, cylZ(r * 0.22, w + 0.1, 8), hub, 0, 0, 0);
    B.wheels.push({ m: wm, r });
    return wm;
  }
  // tilted sub-group pivoting at (px, py); returns [group, toRig(lx, ly) → [x, y]]
  function tilt(rig, px, py, a) {
    const g = new THREE.Group(); g.position.set(px, py, 0); g.rotation.z = a; rig.add(g);
    const c = Math.cos(a), s = Math.sin(a);
    return [g, (lx, ly) => [px + lx * c - ly * s, py + lx * s + ly * c]];
  }
  const rotZ = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  // ---------------------------------------------------------------------------
  // Bodies. Each returns { drv: {pose, x, y}, hand: {x, y, z}, backX }.
  // B = { rig, d, bar, grip, hub, wheels }
  // ---------------------------------------------------------------------------
  const BODY = {};

  // 쇼핑카트: wire basket, tinted top rim / handle / seat flap, 4 casters, rear footboard
  BODY.cart = function (B) {
    const R = B.rig, wire = mat(WIRE), steel = mat(STEEL), bar = mat(B.bar), rim = mat(shade(B.bar, 0.12));
    const panel = mat('#c4ccdc', { op: 0.2, ds: 1, dw: 0 });
    const x0 = -1.0, x1 = 4.6, yb = 2.2, yt = 4.6, W = 2.9, L = x1 - x0, H = yt - yb, cx = (x0 + x1) / 2, cy = (yb + yt) / 2;
    // see-through panels
    part(R, box(L, H, 0.04), panel, cx, cy, W); part(R, box(L, H, 0.04), panel, cx, cy, -W);
    part(R, box(0.04, H, 2 * W), panel, x1, cy, 0); part(R, box(0.04, H, 2 * W), panel, x0, cy, 0);
    part(R, box(L, 0.04, 2 * W), panel, cx, yb, 0);
    // rims (top rim coloured)
    const t = 0.16;
    for (const [y, m] of [[yb, wire], [yt, rim]]) {
      for (const s of [-1, 1]) part(R, box(L + t, t, t), m, cx, y, s * W);
      part(R, box(t, t, 2 * W + t), m, x0, y, 0); part(R, box(t, t, 2 * W + t), m, x1, y, 0);
    }
    for (const x of [x0, x1]) for (const s of [-1, 1]) part(R, box(0.14, H, 0.14), wire, x, cy, s * W);
    // wires
    for (let i = 1; i <= 6; i++) {
      const x = x0 + (L * i) / 7, z = -W + (2 * W * i) / 7;
      for (const s of [-1, 1]) part(R, box(0.07, H, 0.07), wire, x, cy, s * W);
      part(R, box(0.07, H, 0.07), wire, x1, cy, z); part(R, box(0.07, H, 0.07), wire, x0, cy, z);
    }
    for (const y of [yb + H / 3, yb + (2 * H) / 3]) {
      for (const s of [-1, 1]) part(R, box(L, 0.07, 0.07), wire, cx, y, s * W);
      part(R, box(0.07, 0.07, 2 * W), wire, x1, y, 0); part(R, box(0.07, 0.07, 2 * W), wire, x0, y, 0);
    }
    // child-seat flap, front bumpers
    part(R, box(0.1, 1.5, 4.2), bar, x0 + 0.16, yt - 0.85, 0);
    for (const s of [-1, 1]) part(R, box(0.35, 0.5, 0.9), bar, x1 + 0.12, yb + 0.1, s * 2.5);
    // chassis
    const rl = 0.95;
    for (const s of [-1, 1]) {
      part(R, box(7.0, 0.18, 0.18), steel, 1.1, rl, s * 2.3);
      part(R, box(0.18, yb - rl, 0.18), steel, x0, (yb + rl) / 2, s * 2.3);
      part(R, box(0.18, yb - rl, 0.18), steel, x1 - 0.2, (yb + rl) / 2, s * 2.3);
      rod(R, steel, 0.12, x0, yt, -1.85, 5.15, s * 2.85);   // handle uprights
    }
    part(R, box(L - 0.6, 0.05, 4.4), panel, cx - 0.3, rl + 0.1, 0);   // lower tray
    // handle
    zbar(R, bar, 0.2, 6.0, -1.85, 5.15);
    for (const s of [-1, 1]) zbar(R, mat(B.grip), 0.27, 1.2, -1.85, 5.15, s * 1.5);
    // casters
    for (const x of [-0.8, 4.2]) for (const s of [-1, 1]) {
      part(R, box(0.2, 0.5, 0.5), mat(STEEL_D), x, 0.78, s * 2.3);
      wheel(B, 0.5, 0.38, x, 0.5, s * 2.3);
    }
    // footboard the driver stands on
    part(R, box(1.4, 0.12, 2.8), steel, -3.1, 0.62, 0);
    for (const s of [-1, 1]) part(R, box(1.3, 0.12, 0.14), steel, -2.4, 0.62, s * 1.3);
    return { drv: { pose: 'stand', x: -3.2, y: 0.68 }, hand: { x: -1.85, y: 5.15, z: 1.5 }, backX: -4.1 };
  };

  // 유모차: fabric seat + canopy in kart colour, big rear wheels, the driver sits inside
  BODY.stroller = function (B) {
    const R = B.rig, fab = mat(B.bar), fabD = mat(shade(B.bar, 0.25)), frame = mat(DARKF), grip = mat(B.grip);
    part(R, box(3.0, 0.4, 3.4), fab, 0.2, 2.4, 0);                         // seat
    part(R, box(0.4, 3.2, 3.4), fab, -1.4, 3.9, 0, 0, 0, 0.15);             // backrest
    for (const s of [-1, 1]) part(R, box(3.0, 1.0, 0.3), fabD, 0.2, 3.0, s * 1.85);
    part(R, box(0.3, 1.6, 3.0), fabD, 2.0, 1.6, 0);                        // footrest
    part(R, hood(2.3, 4.0, Math.PI / 2, Math.PI * 0.45), mat(B.bar, { ds: 1 }), 0.6, 3.4, 0);   // canopy
    part(R, box(2.6, 0.7, 2.8), mat(DARKF, { op: 0.75 }), 0, 1.25, 0);    // under-seat basket
    for (const s of [-1, 1]) {
      rod(R, frame, 0.14, -2.2, 0.95, -2.95, 5.65, s * 1.9);
      rod(R, frame, 0.14, 2.3, 0.55, 1.0, 2.3, s * 1.9);
      rod(R, frame, 0.12, -2.2, 0.95, 2.3, 0.55, s * 1.9);
    }
    zbar(R, grip, 0.2, 4.2, -2.95, 5.65);                                  // push handle
    zbar(R, grip, 0.16, 3.6, 1.6, 3.5);                                    // front bumper bar
    zbar(R, frame, 0.12, 5.2, -2.2, 0.95); zbar(R, frame, 0.12, 4.4, 2.3, 0.55);
    for (const s of [-1, 1]) { wheel(B, 0.95, 0.4, -2.2, 0.95, s * 2.7); wheel(B, 0.55, 0.35, 2.3, 0.55, s * 2.2); }
    return { drv: { pose: 'sit', x: -0.5, y: 2.6 }, hand: { x: 1.6, y: 3.5, z: 1.4 }, backX: -3.3 };
  };

  // 공항 카트: flat platform, tall back frame + handle, a suitcase and a duffel bag
  BODY.airport = function (B) {
    const R = B.rig, steel = mat(STEEL), bar = mat(B.bar);
    const sc = B.d.name === 'BLU' ? '#e8902c' : '#3d82d8';
    part(R, box(5.4, 0.3, 4.6), steel, 1.4, 0.95, 0);
    part(R, box(0.25, 0.7, 4.6), bar, 4.1, 1.3, 0);
    for (const s of [-1, 1]) {
      part(R, box(5.4, 0.22, 0.22), bar, 1.4, 1.2, s * 2.3);
      rod(R, steel, 0.16, -1.2, 1.0, -1.65, 5.1, s * 2.1);
    }
    zbar(R, steel, 0.12, 4.2, -1.36, 2.6); zbar(R, steel, 0.12, 4.2, -1.5, 3.9);
    zbar(R, bar, 0.22, 5.2, -1.7, 5.1);
    for (const s of [-1, 1]) zbar(R, mat(B.grip), 0.28, 1.1, -1.7, 5.1, s * 1.5);
    // suitcase
    part(R, box(3.0, 2.3, 3.8), mat(sc), 1.6, 2.25, 0);
    for (const s of [-1, 1]) part(R, box(3.06, 2.36, 0.2), mat(shade(sc, 0.25)), 1.6, 2.25, s * 1.0);
    part(R, box(0.3, 0.35, 1.2), mat('#2a2a30'), 1.6, 3.55, 0);
    part(R, box(0.05, 0.6, 0.9), mat('#f4f0e0'), 0.08, 2.5, 0.9);
    part(R, box(0.05, 0.45, 0.45), mat('#e04040'), 0.08, 1.8, -0.9);
    // duffel on top
    part(R, cylZ(0.75, 2.6, 10), mat('#6a4a34'), 2.0, 4.15, 0);
    part(R, box(0.2, 0.2, 2.7), mat('#3a2a1e'), 2.0, 4.9, 0);
    for (const x of [-0.7, 3.6]) for (const s of [-1, 1]) wheel(B, 0.5, 0.36, x, 0.5, s * 2.0);
    // rear step
    part(R, box(1.6, 0.14, 2.8), steel, -2.5, 0.6, 0);
    for (const s of [-1, 1]) part(R, box(1.2, 0.12, 0.14), steel, -1.6, 0.75, s * 1.2);
    return { drv: { pose: 'stand', x: -3.0, y: 0.67 }, hand: { x: -1.7, y: 5.1, z: 1.5 }, backX: -3.9 };
  };

  // 장바구니 캐리어: tilted two-wheel trolley with a tartan bag
  BODY.granny = function (B) {
    const R = B.rig, steel = mat(STEEL), bar = mat(B.bar);
    const tb = mix(B.bar, '#7a2030', 0.35), tx = tartan(tb);
    const bagM = tx ? mat('#ffffff', { map: tx, mapKey: 'tartan' + tb }) : mat(tb);
    const [g, to] = tilt(R, 2.0, 0.85, 0.38);
    for (const s of [-1, 1]) rod(g, bar, 0.13, 0, -0.2, 0, 4.4, s * 1.9);
    for (const s of [-1, 1]) rod(g, bar, 0.13, 0, 4.4, -0.45, 4.6, s * 1.9);
    zbar(g, bar, 0.2, 4.0, -0.45, 4.6);
    for (const s of [-1, 1]) zbar(g, mat(B.grip), 0.27, 1.0, -0.45, 4.6, s * 1.2);
    part(g, box(2.3, 3.6, 4.0), bagM, 1.3, 1.95, 0);                        // bag
    part(g, box(2.45, 0.5, 4.15), mat(shade(tb, 0.45)), 1.3, 3.95, 0);       // lid
    part(g, box(0.15, 1.0, 0.6), mat(shade(tb, 0.55)), 2.5, 3.5, 0);         // strap
    part(g, box(2.5, 0.15, 3.6), steel, 1.35, 0.05, 0);                      // foot plate
    zbar(g, steel, 0.1, 3.8, 0, 1.6);
    zbar(R, mat(STEEL_D), 0.13, 5.4, 2.0, 0.85);                              // axle
    for (const s of [-1, 1]) wheel(B, 0.85, 0.4, 2.0, 0.85, s * 2.6);
    const [hx, hy] = to(-0.45, 4.6);
    return { drv: { pose: 'stand', x: hx - 1.45, y: 0 }, hand: { x: hx, y: hy, z: 1.2 }, backX: hx - 2.35 };
  };

  // 택배 손수레: tilted hand truck with a stack of taped boxes
  BODY.parcel = function (B) {
    const R = B.rig, steel = mat(STEEL), bar = mat(B.bar);
    const [g, to] = tilt(R, 1.6, 0.75, 0.3);
    for (const s of [-1, 1]) {
      rod(g, bar, 0.15, 0, -0.5, 0, 4.4, s * 1.8);
      rod(g, bar, 0.15, 0, 4.4, -0.4, 4.7, s * 1.8);
    }
    for (const y of [1.6, 3.2]) zbar(g, steel, 0.1, 3.6, 0, y);
    zbar(g, bar, 0.18, 3.8, -0.4, 4.7);
    for (const s of [-1, 1]) zbar(g, mat(B.grip), 0.25, 1.0, -0.4, 4.7, s * 1.3);
    part(g, box(2.1, 0.15, 3.6), steel, 1.05, -0.6, 0);                       // nose plate
    const boxes = [[2.0, 1.7, 3.6, 1.1, 0.325], [1.8, 1.5, 3.0, 1.0, 1.925], [1.5, 1.2, 2.4, 0.9, 3.275]];
    boxes.forEach(([w, h, d, x, y], i) => {
      part(g, box(w, h, d), mat(shade(CARD, i * 0.07)), x, y, 0);
      part(g, box(w + 0.02, 0.03, 0.5), mat(TAPE), x, y + h / 2, 0);
      part(g, box(0.03, h + 0.02, 0.5), mat(TAPE), x + w / 2, y, 0);
      if (i < 2) part(g, box(0.03, 0.5, 0.75), mat(i ? '#e04040' : '#f8f6f0'), x + w / 2, y + 0.2, d / 2 - 0.6);
    });
    zbar(R, mat(STEEL_D), 0.13, 5.2, 1.6, 0.75);
    for (const s of [-1, 1]) wheel(B, 0.75, 0.4, 1.6, 0.75, s * 2.5);
    const [hx, hy] = to(-0.4, 4.7);
    return { drv: { pose: 'stand', x: hx - 1.45, y: 0 }, hand: { x: hx, y: hy, z: 1.3 }, backX: hx - 2.35 };
  };

  // 리어카: wooden bed on two big spoked wheels, shafts back to the driver
  BODY.rearcar = function (B) {
    const R = B.rig, wood = mat(WOOD), woodD = mat(WOOD_D), bar = mat(B.bar);
    part(R, box(5.2, 0.3, 4.8), wood, 1.0, 2.1, 0);                          // floor
    for (const s of [-1, 1]) {
      for (const y of [2.55, 3.1]) part(R, box(5.2, 0.45, 0.18), wood, 1.0, y, s * 2.4);
      part(R, box(5.3, 0.14, 0.26), bar, 1.0, 3.4, s * 2.4);                // painted cap
      for (const x of [3.6, -1.6]) part(R, box(0.22, 1.3, 0.22), woodD, x, 2.85, s * 2.4);
      rod(R, woodD, 0.15, 3.6, 1.88, -1.6, 1.88, s * 1.9);                   // shafts under the bed
      rod(R, woodD, 0.15, -1.6, 1.88, -2.95, 4.35, s * 1.9);                 // ...rising to the handle
      part(R, box(0.2, 1.9, 0.2), woodD, 3.3, 0.95, s * 1.9);                // front stand
    }
    for (const y of [2.55, 3.1]) part(R, box(0.18, 0.45, 4.8), wood, 3.6, y, 0);
    part(R, box(0.26, 0.14, 5.0), bar, 3.6, 3.4, 0);
    part(R, box(0.18, 0.45, 4.8), wood, -1.6, 2.45, 0);
    zbar(R, bar, 0.2, 4.2, -2.95, 4.35);
    for (const s of [-1, 1]) zbar(R, mat(B.grip), 0.27, 1.0, -2.95, 4.35, s * 1.5);
    zbar(R, mat(STEEL_D), 0.15, 5.9, 1.0, 1.6);
    for (const s of [-1, 1]) wheel(B, 1.6, 0.35, 1.0, 1.6, s * 2.95, 3);
    // cargo
    const sack = part(R, sph(1.0, 10, 8), mat('#d8c8a0'), 2.3, 2.95, -0.9); sack.scale.set(1.2, 0.85, 1);
    part(R, box(1.3, 1.0, 1.3), mat(CARD), 0.4, 2.75, 1.0);
    part(R, sph(0.7, 10, 8), mat('#3a8a3a'), 2.6, 2.95, 1.2);
    return { drv: { pose: 'stand', x: -4.1, y: 0 }, hand: { x: -2.95, y: 4.35, z: 1.5 }, backX: -5.0 };
  };

  // ---------------------------------------------------------------------------
  // Drivers
  // ---------------------------------------------------------------------------
  // limbs: two-part arm (sleeve + forearm) from shoulder to hand, in driver-group coords
  function arm(g, sx, sy, hx, hy, z, upper, lower, r) {
    const mx = (sx + hx) / 2, my = (sy + hy) / 2;
    rod(g, upper, r, sx, sy, mx, my, z);
    rod(g, lower, r * 0.9, mx, my, hx, hy, z);
  }

  function buildDriver(B, spec, hand, S) {
    const d = B.d, ch = d.ch;
    const g = new THREE.Group(); g.position.set(spec.x, spec.y, 0); B.rig.add(g);
    const hx = hand.x - spec.x, hy = hand.y - spec.y, hz = hand.z;
    const sit = spec.pose === 'sit';

    if (ch === 'ghost') {
      const sheet = mat('#f4f7ff', { op: 0.78, ds: 1, em: '#2a3450' });
      const base = sit ? 0.1 : 1.0, top = base + 3.4;
      part(g, cyl(1.3, 1.75, 3.4, 12, true), sheet, 0, base + 1.7, 0);
      part(g, sph(1.3, 12, 8, Math.PI / 2), sheet, 0, top, 0);
      const hem = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU, m = part(g, sph(0.45, 8, 6), sheet, Math.cos(a) * 1.62, base + (i & 1 ? 0.12 : -0.12), Math.sin(a) * 1.62);
        m.scale.set(1, 0.8, 1); hem.push(m);
      }
      const eye = mat(EYE);
      for (const s of [-1, 1]) {
        const e = part(g, sph(0.22, 8, 6), eye, 1.2, top + 0.3, s * 0.42); e.scale.set(0.6, 1.5, 1);
        part(g, sph(0.15, 6, 4), mat('#f4a0b8', { op: 0.8 }), 1.15, top - 0.1, s * 0.8);
      }
      part(g, sph(0.16, 8, 6), eye, 1.27, top - 0.35, 0).scale.set(0.5, 1.2, 1);
      for (const s of [-1, 1]) {
        rod(g, sheet, 0.35, 0.3, top - 0.6, hx, hy, s * ((1.4 + hz) / 2));
        part(g, sph(0.42, 8, 6), sheet, hx, hy, s * hz);
      }
      S.ghost = { g, baseY: spec.y, hem, hemY: base };
      return g;
    }

    let hair, shirt, skin, pants, eyeC = EYE;
    if (ch === 'vamp') { hair = '#14141c'; shirt = '#3a1424'; skin = '#e6e2ee'; pants = '#1a1420'; eyeC = '#e02030'; }
    else if (ch === 'glitch') { hair = '#30ff80'; shirt = '#ff2ad4'; skin = '#a8f4ff'; pants = '#1a1030'; eyeC = '#ffffff'; }
    else {
      const p = B.isPlayer ? ME : SHOPPERS[d.id % SHOPPERS.length];
      hair = p[0]; shirt = p[1]; skin = p[2] || SKIN; pants = B.isPlayer ? '#3d5a8c' : '#3a3f55';
    }
    const gl = ch === 'glitch';
    const M = (c) => (gl ? mat(c, { em: shade(c, 0.55) }) : mat(c));
    const mHair = M(hair), mShirt = M(shirt), mSkin = M(skin), mPants = M(pants), mShoe = M(SHOE), mEye = M(eyeC);

    // legs
    let hipY;
    if (sit) {
      hipY = 0.35;
      for (const s of [-1, 1]) {
        part(g, box(2.0, 0.8, 0.9), mPants, 1.0, 0.4, s * 0.55);
        part(g, box(0.8, 1.6, 0.85), mPants, 2.0, -0.4, s * 0.55);
        part(g, box(1.1, 0.4, 0.95), mShoe, 2.15, -1.25, s * 0.55);
      }
    } else {
      hipY = 2.6;
      for (const s of [-1, 1]) {
        part(g, box(0.85, 2.2, 0.9), mPants, 0, 1.5, s * 0.55);
        part(g, box(1.15, 0.4, 0.95), mShoe, 0.15, 0.2, s * 0.55);
      }
    }
    // torso leans forward from the hips
    const lean = sit ? -0.05 : -0.18;
    const tg = new THREE.Group(); tg.position.set(0, hipY, 0); tg.rotation.z = lean; g.add(tg);
    const torso = part(tg, box(1.5, 2.4, 2.5), mShirt, 0, 1.2, 0);
    // head
    const [shx, shy] = rotZ(0, 2.05, lean), [hdx, hdy] = rotZ(0.15, 3.45, lean);
    const hg = new THREE.Group(); hg.position.set(hdx, hipY + hdy, 0); g.add(hg);
    const head = part(hg, sph(1.1, 12, 10), mSkin, 0, 0, 0);
    part(hg, sph(1.2, 12, 8, Math.PI * 0.58), mHair, -0.05, 0, 0, 0, 0, 0.45);
    for (const s of [-1, 1]) part(hg, box(0.15, 0.32, 0.2), mEye, 1.03, 0.12, s * 0.4);

    if (ch === 'vamp') {
      // slicked hair + widow's peak, pointy ears, fangs, cape with red lining, high collar
      part(hg, box(0.45, 0.45, 0.3), mHair, 0.92, 0.72, 0, Math.PI / 4);
      for (const s of [-1, 1]) {
        part(hg, cyl(0, 0.22, 0.6, 5), mSkin, 0, 0.1, s * 1.15, s * Math.PI / 2 * 0.9);
        part(hg, box(0.1, 0.25, 0.1), mat('#ffffff'), 1.0, -0.45, s * 0.22);
      }
      const capeO = mat('#101016', { ds: 1 }), capeI = mat('#b01828', { ds: 1 });
      part(tg, box(0.14, 3.7, 3.1), capeO, -0.9, 0.55, 0, 0, 0, -0.14);
      part(tg, box(0.1, 3.6, 3.2), capeI, -0.8, 0.6, 0, 0, 0, -0.14);
      for (const s of [-1, 1]) {
        part(tg, box(0.12, 1.2, 1.1), capeO, -0.45, 2.75, s * 1.0, s * 0.45);
        part(tg, box(0.08, 1.15, 1.05), capeI, -0.35, 2.75, s * 0.98, s * 0.45);
      }
      part(tg, box(0.1, 1.2, 0.7), mat('#f4f0f4'), 0.76, 1.75, 0);
      part(tg, box(0.12, 0.25, 0.25), mat('#e8c040'), 0.8, 2.2, 0);
    } else if (!gl) {
      part(hg, box(0.5, 0.35, 1.6), mHair, 0.85, 0.78, 0, 0, 0, -0.5);          // fringe
      if (!B.isPlayer && d.id % 3 === 1) part(hg, sph(0.5, 8, 6), mHair, -1.15, -0.2, 0);   // ponytail
      if (!B.isPlayer && d.id % 3 === 2) part(hg, sph(0.45, 8, 6), mHair, -0.5, 1.15, 0);   // bun
    }
    // arms to the handle
    for (const s of [-1, 1]) {
      arm(g, shx, hipY + shy, hx, hy, s * ((1.4 + hz) / 2), mShirt, mSkin, 0.32);
      part(g, sph(0.4, 8, 6), mSkin, hx, hy, s * hz);
    }

    if (gl) {
      // chromatic copies + loose pixels; flicker swaps materials
      const cm = mat('#ff30c0', { op: 0.45, em: '#ff30c0', dw: 0 }), cc = mat('#30e8ff', { op: 0.45, em: '#30e8ff', dw: 0 });
      const copies = [];
      for (const [src, par] of [[torso, tg], [head, hg]]) for (const m of [cm, cc]) {
        const c = part(par, src.geometry, m, src.position.x, src.position.y, src.position.z);
        c.castShadow = false; c.userData.k3fx = true; copies.push(c);
      }
      const bits = [];
      const BC = ['#ff2ad4', '#30e8ff', '#30ff80', '#ffffff', '#ff2ad4'];
      for (let i = 0; i < 5; i++) {
        const b = part(g, box(0.45, 0.45, 0.45), mat(BC[i], { em: BC[i] }), 0, 0, 0);
        b.visible = false; b.userData.k3fx = true; bits.push(b);
      }
      const ALT = ['#30e8ff', '#ff2ad4', '#30ff80', '#ffffff'];
      const alts = [];
      g.traverse((o) => { if (o.isMesh && !o.userData.k3fx) { const c = ALT[alts.length % ALT.length]; alts.push([o, mat(c, { em: shade(c, 0.4) })]); } });
      S.glitch = { g, copies, bits, alts, t: 0, on: false };
    }
    return g;
  }

  // ---------------------------------------------------------------------------
  // FX: boost flames, shield bubble, blob shadow
  // ---------------------------------------------------------------------------
  function buildFx(root, rig, backX, S) {
    const fl = new THREE.Group(); fl.position.set(backX, 0.75, 0); fl.visible = false; rig.add(fl);
    const outer = mat('#ff7a20', { op: 0.85, em: '#ff5a00', dw: 0 }), inner = mat('#fff0a0', { op: 0.95, em: '#ffd040', dw: 0 });
    S.flames = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Group(); f.position.z = s * 1.4; fl.add(f);
      const a = part(f, cyl(0, 0.5, 1.8, 7), outer, -0.9, 0, 0, 0, 0, Math.PI / 2);
      const b = part(f, cyl(0, 0.28, 1.2, 6), inner, -0.6, 0, 0, 0, 0, Math.PI / 2);
      a.castShadow = b.castShadow = false;
      S.flames.push(f);
    }
    S.flameG = fl;
    const sh = part(rig, sph(5.8, 16, 12), mat('#8fe0ff', { op: 0.22, em: '#2a6a8a', dw: 0, ds: 1 }), 0.3, 3.9, 0);
    sh.visible = false; sh.castShadow = false; S.shield = sh;
    const bl = part(root, cyl(1, 1, 0.02, 20), mat('#000000', { op: 0.3, dw: 0 }), 0.3, 0.03, 0);
    bl.scale.set(4.6, 1, 3.4); bl.castShadow = false; bl.renderOrder = -1; S.shadow = bl;
    for (const o of [fl, sh, bl]) o.traverse((m) => { m.userData.k3fx = true; });
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  function build(defIndex, bodyId, isPlayer) {
    if (!has3()) return null;
    const d = getDef(defIndex | 0);
    const blk = d.name === 'BLK';
    const barC = blk ? '#5a5a68' : d.color, gripC = blk ? '#e8c040' : d.gripCol || d.color;
    const root = new THREE.Group(); root.name = 'kart3d';
    const rig = new THREE.Group(); rig.rotation.order = 'YXZ'; root.add(rig);
    const B = { rig, d, isPlayer: !!isPlayer, bar: barC, grip: gripC, hub: tint(gripC, 0.45), wheels: [] };
    const S = { rig, wheels: B.wheels, t: Math.random() * 10, lean: 0, yaw: 0, spinA: 0, phased: false, meshes: [], def: d, body: '' };
    const id = BODY[bodyId] ? bodyId : 'cart';
    S.body = id;
    const L = BODY[id](B);
    S.driver = buildDriver(B, L.drv, L.hand, S);
    buildFx(root, rig, L.backX, S);
    root.traverse((o) => { if (o.isMesh && !o.userData.k3fx) { o.userData.k3base = o.material; S.meshes.push(o); } });
    root.userData.kart3d = S;
    return root;
  }

  function update(group, k, dt) {
    const S = group && group.userData && group.userData.kart3d;
    if (!S || !has3() || !k) return null;
    dt = clamp(+dt || 0, 0, 0.1); S.t += dt;
    const fx = k.fx || {}, v = +k.v || 0, rig = S.rig;
    // wheels (spin rate capped so it doesn't strobe)
    for (const w of S.wheels) w.m.rotation.z -= clamp(v / w.r, -40, 40) * dt;
    // lean into the turn (+steer = right = +Z), a touch more while drifting
    const sp = clamp(Math.abs(v) / 60, 0, 1);
    const tgt = k.drift ? (k.driftDir || 0) * 0.13 : (k.steerIn || 0) * 0.08 * sp;
    S.lean += (tgt - S.lean) * Math.min(1, dt * 10);
    rig.rotation.x = S.lean;
    if (S.driver) S.driver.rotation.x = S.lean * 0.8;
    S.yaw += ((k.drift ? -(k.driftDir || 0) * 0.16 : 0) - S.yaw) * Math.min(1, dt * 8);
    // spin-out
    let spin = 0;
    if (fx.spin > 0) { if (typeof k.spinA === 'number') spin = k.spinA; else spin = (S.spinA += 16 * dt); } else S.spinA = 0;
    rig.rotation.y = S.yaw + spin;
    // hop + rumble
    const hop = Math.max(0, +k.hop || 0);
    rig.position.set(0, hop + Math.sin(S.t * 31) * 0.03 * sp, 0);
    const ss = 1 / (1 + hop * 0.18);
    S.shadow.scale.set(4.6 * ss, 1, 3.4 * ss);
    // boost flames
    const bt = +k.boostT || 0;
    S.flameG.visible = bt > 0;
    if (bt > 0) {
      const p = Math.min(1, bt * 2);
      for (const f of S.flames) { const r = 0.75 + Math.random() * 0.5; f.scale.set(p * r, 0.8 + p * 0.3, 0.8 + p * 0.3); }
    }
    // shield bubble
    const sh = +fx.shield || 0;
    S.shield.visible = sh > 0 && (sh > 0.5 || ((sh * 12) | 0) % 2 === 0);
    if (S.shield.visible) { const s = 1 + Math.sin(S.t * 6) * 0.03; S.shield.scale.set(s, s, s); S.shield.rotation.y = S.t * 0.8; }
    // phase: faded materials, blinking in the last 0.6 s
    const ph = +fx.phase || 0;
    const phased = ph > 0 && (ph > 0.6 || ((ph * 10) | 0) % 2 === 0);
    if (phased !== S.phased) {
      S.phased = phased;
      for (const m of S.meshes) m.material = phased ? fade(m.userData.k3base) : m.userData.k3base;
    }
    // ghost bobbing + hem sway
    if (S.ghost) {
      S.ghost.g.position.y = S.ghost.baseY + Math.sin(S.t * 2.6) * 0.3;
      S.ghost.hem.forEach((m, i) => { m.position.y = S.ghost.hemY + Math.sin(S.t * 4 + i * 1.7) * 0.15; });
    }
    // glitch jitter
    if (S.glitch) glitchTick(S, rig, dt);
    return group;
  }

  function glitchTick(S, rig, dt) {
    const G = S.glitch;
    if (G.t > 0) G.t -= dt; else if (Math.random() < dt * 2.5) G.t = 0.06 + Math.random() * 0.12;
    const on = G.t > 0;
    if (on) {
      rig.position.x = (Math.random() - 0.5) * 0.7;
      rig.position.z = (Math.random() - 0.5) * 0.7;
      G.g.scale.set(1, 1 + (Math.random() - 0.5) * 0.25, 1 + (Math.random() - 0.5) * 0.3);
    } else if (G.on) G.g.scale.set(1, 1, 1);
    const o = on ? 0.5 : 0.12 + Math.sin(S.t * 9) * 0.06;
    G.copies.forEach((c, i) => { c.position.z = (i & 1 ? o : -o) * (on ? Math.random() + 0.5 : 1); c.visible = on || ((S.t * 7) | 0) % 3 !== 0; });
    G.bits.forEach((b) => {
      b.visible = on || Math.random() < 0.02;
      if (b.visible) b.position.set((Math.random() - 0.5) * 3, 1 + Math.random() * 6, (Math.random() - 0.5) * 4);
    });
    if (on !== G.on && !S.phased) for (const [m, alt] of G.alts) m.material = on ? alt : m.userData.k3base;
    G.on = on;
  }

  function dispose(group) {
    if (!group || !has3()) return null;
    group.traverse((o) => {
      if (o.geometry && !(o.geometry.userData && o.geometry.userData.k3shared)) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (!(m.userData && m.userData.k3shared)) { if (m.map && !(m.map.userData && m.map.userData.k3shared)) m.map.dispose(); m.dispose(); }
    });
    if (group.parent) group.parent.remove(group);
    if (group.userData) group.userData.kart3d = null;
    return true;
  }

  // frees the shared caches too (e.g. when tearing the 3D renderer down)
  function clearCache() {
    if (!has3()) return null;
    for (const k in GEO) { GEO[k].dispose(); delete GEO[k]; }
    for (const k in MAT) { MAT[k].dispose(); delete MAT[k]; }
    for (const k in TEX) { if (TEX[k]) TEX[k].dispose(); delete TEX[k]; }
    FADE.forEach((f) => f.dispose()); FADE = new Map();
    return true;
  }

  const meshCount = (group) => { if (!group) return null; let n = 0; group.traverse((o) => { if (o.isMesh) n++; }); return n; };

  PK.Kart3D = { build, update, dispose, clearCache, meshCount, BODY_IDS };
  Object.defineProperty(PK.Kart3D, 'available', { get: has3, enumerable: true });
})(window.PK);
