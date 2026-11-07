// Shared constants & utilities. Loaded FIRST. Do not edit without updating CONTRACT.md.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const C = PK.C = {
    W: 320, H: 180, CX: 160,
    HORIZON: 60,      // screen row of the horizon; rows < HORIZON are background
    FOCAL: 160,       // projection focal length in screen px (90deg FOV)
    CAM_H: 15,        // camera height (world units)
    CAM_DIST: 27,     // camera distance behind player
    LAPS: 3,
    TEX: 1024,        // track texture size (world units == texels)
    TAU: Math.PI * 2,
    FOG_NEAR: 220, FOG_FAR: 720
  };
  C.PER = Math.round(C.TAU * C.FOCAL); // background columns for a full 360deg

  const U = PK.U = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.angDiff = (a, b) => { let d = (b - a) % C.TAU; if (d > Math.PI) d -= C.TAU; else if (d < -Math.PI) d += C.TAU; return d; };
  // Uint32 pixel for ImageData (little-endian ABGR)
  U.rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  U.hex = (h) => { const n = parseInt(h.slice(1), 16); return U.rgb((n >> 16) & 255, (n >> 8) & 255, n & 255); };
  U.darken = (h, f) => {
    const n = parseInt(h.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
    return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255);
  };
  // rows: array of equal-length strings; pal: {char: '#rrggbb'}; '.' or unknown = transparent
  U.makeSprite = (rows, pal) => {
    const c = document.createElement('canvas');
    c.width = rows[0].length; c.height = rows.length;
    const g = c.getContext('2d');
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const col = pal[r[x]]; if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } } });
    return c;
  };
  U.rng = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };
  U.BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
})(window.PK);
