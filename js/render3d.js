// PK.R3D — real 3D view with Three.js (window.THREE, classic build). It only draws: the game logic,
// camera follow (camX/camY/camA) and HUD stay in main.js. The map's painted floor texture becomes the
// ground, its 360° background table becomes a sky cylinder, props / obstacles / food / skill effects
// stand as billboards, and karts are PK.Kart3D models. If THREE is missing, available is false and
// main.js keeps the classic Mode-7 renderer.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const T3 = () => window.THREE;
  // kartModels: false = pixel kart sprites on the 3D map (the user's choice), true = PK.Kart3D models
  const R = PK.R3D = { available: false, active: false, kartModels: false, init, render, dispose };

  let renderer = null, scene = null, camera = null, canvas = null, wrapEl = null;
  let hemi = null, sun = null, fog = null;
  let mapGroup = null, sky = null, builtMap = -1, builtTheme = 0;
  let cw = 0, ch = 0;
  const texCache = new Map();            // source canvas -> THREE texture
  const propSprites = [];                // [{ sprite, prop }]
  let fxPool = [];                       // sprites reused for PK.Skills.sprites()
  let kartList = null, kartBody = '', kartModels = new Map();
  let lastT = 0;

  // ---------------------------------------------------------------- helpers
  const C = () => PK.C;
  function u32ToCss(v) {                // ImageData uint32 (ABGR little-endian) -> 0xRRGGBB
    return ((v & 255) << 16) | (((v >>> 8) & 255) << 8) | ((v >>> 16) & 255);
  }
  function canvasFromU32(data, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    img.data.set(new Uint8ClampedArray(data.buffer, data.byteOffset, w * h * 4));
    g.putImageData(img, 0, 0);
    return c;
  }
  function pixelTex(src, repeat) {
    const THREE = T3();
    const t = new THREE.CanvasTexture(src);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = repeat ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
    t.generateMipmaps = !!repeat;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  // sprite canvases from the 2D game (props, food, effects) -> cached textures
  function spriteTex(cv) {
    let t = texCache.get(cv);
    if (!t) { t = pixelTex(cv, false); t._age = 0; texCache.set(cv, t); }
    return t;
  }

  // ---------------------------------------------------------------- voxels
  // A sprite canvas -> a block model: every opaque pixel (2x2 for big sprites) is a cube with
  // its colour, 2 voxels thick; only faces next to empty space are emitted. Origin = bottom centre,
  // width along X, height along Y, front faces +Z. Cached per canvas (props share sprites).
  const voxCache = new Map();
  let voxMaterial = null;
  function voxMat() {
    if (!voxMaterial) { voxMaterial = new (T3().MeshLambertMaterial)({ vertexColors: true, side: T3().DoubleSide }); voxMaterial._shared = true; }
    return voxMaterial;
  }
  function voxelGeo(cv) {
    if (voxCache.has(cv)) return voxCache.get(cv);
    let res = null;
    try {
      const THREE = T3(), w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
      const step = w > 24 || h > 30 ? 2 : 1, cols = Math.ceil(w / step), rows = Math.ceil(h / step), DEP = 2;
      const solid = new Uint8Array(cols * rows), rgb = new Float32Array(cols * rows * 3);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        // a cell is solid if most of its pixels are; colour = average of the opaque ones
        let n = 0, r = 0, g = 0, b = 0;
        for (let yy = 0; yy < step; yy++) for (let xx = 0; xx < step; xx++) {
          const px = x * step + xx, py = y * step + yy;
          if (px >= w || py >= h) continue;
          const o = (py * w + px) * 4;
          if (d[o + 3] > 110) { n++; r += d[o]; g += d[o + 1]; b += d[o + 2]; }
        }
        if (n * 2 >= step * step || (step === 1 && n)) {
          const k = y * cols + x;
          solid[k] = 1; rgb[k * 3] = r / n / 255; rgb[k * 3 + 1] = g / n / 255; rgb[k * 3 + 2] = b / n / 255;
        }
      }
      const pos = [], nor = [], col = [];
      const at = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows ? solid[y * cols + x] : 0);
      const quad = (a, b, c, e, n, cr, cg, cb, shade) => {
        pos.push(...a, ...b, ...c, ...a, ...c, ...e);
        for (let i = 0; i < 6; i++) { nor.push(...n); col.push(cr * shade, cg * shade, cb * shade); }
      };
      const x0 = -cols / 2, z0 = -DEP / 2;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (!solid[y * cols + x]) continue;
        const k = (y * cols + x) * 3, cr = rgb[k], cg = rgb[k + 1], cb = rgb[k + 2];
        const X = x0 + x, Y = rows - 1 - y, Xb = X + 1, Yb = Y + 1, Z = z0, Zb = z0 + DEP;
        quad([X, Y, Zb], [Xb, Y, Zb], [Xb, Yb, Zb], [X, Yb, Zb], [0, 0, 1], cr, cg, cb, 1);        // front
        quad([Xb, Y, Z], [X, Y, Z], [X, Yb, Z], [Xb, Yb, Z], [0, 0, -1], cr, cg, cb, 0.7);        // back
        if (!at(x, y - 1)) quad([X, Yb, Zb], [Xb, Yb, Zb], [Xb, Yb, Z], [X, Yb, Z], [0, 1, 0], cr, cg, cb, 1.1);   // top
        if (!at(x, y + 1)) quad([X, Y, Z], [Xb, Y, Z], [Xb, Y, Zb], [X, Y, Zb], [0, -1, 0], cr, cg, cb, 0.6);     // bottom
        if (!at(x - 1, y)) quad([X, Y, Z], [X, Y, Zb], [X, Yb, Zb], [X, Yb, Z], [-1, 0, 0], cr, cg, cb, 0.8);     // left
        if (!at(x + 1, y)) quad([Xb, Y, Zb], [Xb, Y, Z], [Xb, Yb, Z], [Xb, Yb, Zb], [1, 0, 0], cr, cg, cb, 0.85); // right
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col.map((v) => Math.min(1, v)), 3));
        geo._shared = true;
        res = { geo, cols, rows };
      }
    } catch (e) { res = null; }   // e.g. a tainted canvas on file:// -> billboard instead
    voxCache.set(cv, res);
    return res;
  }

  // ---------------------------------------------------------------- init
  function init(wrap, under) {
    const THREE = T3();
    if (!THREE || !THREE.WebGLRenderer) { R.available = false; return false; }
    try {
      wrapEl = wrap;
      canvas = document.createElement('canvas');
      canvas.id = 'game3d';
      // z-index -1: behind the 2D canvas (HUD) and every menu / button overlay (#wrap's transform makes it
      // its own stacking context, so this stays inside the game box)
      canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:none;z-index:-1;pointer-events:none;';
      wrap.insertBefore(canvas, under || wrap.firstChild);
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
      scene = new THREE.Scene();
      // Mode-7 equivalent: focal 160 px on a 180 px tall view, horizon 30 px above centre
      const vfov = 2 * Math.atan((C().H / 2) / C().FOCAL) * 180 / Math.PI;
      camera = new THREE.PerspectiveCamera(vfov, C().W / C().H, 0.5, 4000);
      hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f70, 0.95);
      sun = new THREE.DirectionalLight(0xffffff, 0.55);
      sun.position.set(-0.4, 1, 0.3);
      scene.add(hemi, sun);
      fog = new THREE.Fog(0x000000, C().FOG_NEAR, C().FOG_FAR + 200);
      scene.fog = fog;
      R.available = true;
      return true;
    } catch (e) {
      R.available = false;
      return false;
    }
  }

  // ---------------------------------------------------------------- per-map scene
  function clearMap() {
    if (mapGroup) {
      scene.remove(mapGroup);
      mapGroup.traverse((o) => { if (o.geometry && !o.geometry._shared) o.geometry.dispose(); if (o.material && !o.material._shared) { if (o.material.map && !o.material.map._cached) o.material.map.dispose(); o.material.dispose(); } });
    }
    if (sky) { scene.remove(sky); sky.geometry.dispose(); sky.material.map.dispose(); sky.material.dispose(); sky = null; }
    propSprites.length = 0;
    mapGroup = null;
  }

  function buildMap() {
    const THREE = T3(), Tk = PK.Track, TEX = C().TEX;
    clearMap();
    mapGroup = new THREE.Group();
    builtMap = Tk.current; builtTheme = Tk.theme;

    // fog / light colours from the map
    const fogCol = u32ToCss(Tk.FOG);
    fog.color.setHex(fogCol);
    scene.background = new THREE.Color(fogCol);
    const night = Tk.fx === 'haunted' || Tk.fx === 'glitch';
    hemi.intensity = night ? 0.6 : 0.95;
    hemi.color.setHex(night ? 0xb8a8ff : 0xffffff);
    sun.intensity = night ? 0.3 : 0.55;

    // ground: the painted TEX x TEX floor (road, kerbs, decals) + the outside tile around it
    if (Tk.texData) {
      const tex = pixelTex(canvasFromU32(Tk.texData, TEX, TEX), true);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
      const g = new THREE.PlaneGeometry(TEX, TEX);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
      m.position.set(TEX / 2, 0, TEX / 2);
      mapGroup.add(m);
      // outside: sample the 64x64 tile through sampleOutside()
      const tile = new Uint32Array(64 * 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) tile[y * 64 + x] = Tk.sampleOutside(x, y);
      const tt = pixelTex(canvasFromU32(tile, 64, 64), true);
      const S = 9000;
      tt.repeat.set(S / 64, S / 64);
      const og = new THREE.PlaneGeometry(S, S);
      og.rotateX(-Math.PI / 2);
      const om = new THREE.Mesh(og, new THREE.MeshLambertMaterial({ map: tt }));
      om.position.set(TEX / 2, -0.08, TEX / 2);
      mapGroup.add(om);
    }

    // Minecraft-style kerbs: a row of cube blocks along both road edges (one InstancedMesh)
    if (Tk.PTS && Tk.N) {
      const B = 3, off = Tk.ROAD_W / 2 + B / 2 + 0.6;
      const wallCol = Tk.fx === 'glitch' ? 0xff3cc8 : Tk.fx === 'haunted' ? 0x6a5a7a : Tk.fx === 'frost' ? 0x9fd4ff : 0xd8382f;
      const spots = [];
      let acc = 0;
      for (let i = 0; i < Tk.N; i++) {
        const a = Tk.PTS[i], b = Tk.PTS[(i + 1) % Tk.N];
        acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc < B) continue;
        acc = 0;
        const t = Tk.TAN[i];
        for (const side of [-1, 1]) spots.push([a[0] - Math.sin(t) * off * side, a[1] + Math.cos(t) * off * side, t, spots.length]);
      }
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(B, B, B), new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      const cA = new THREE.Color(wallCol), cB = new THREE.Color(0xf2f2f2);
      spots.forEach((s, n) => {
        q.setFromAxisAngle(up, -s[2]);
        mtx.compose(new THREE.Vector3(s[0], B / 2, s[1]), q, one);
        inst.setMatrixAt(n, mtx);
        inst.setColorAt(n, ((n >> 2) & 1) ? cA : cB);   // red / white blocks
      });
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      mapGroup.add(inst);
    }

    // props and obstacles: their pixel art built out of little cube voxels, turned to face the road
    // (obstacles move -> updated per frame). If a sprite can't be read, it stays a flat billboard.
    const props = Tk.props || [];
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p.spr) continue;
      const vox = voxelGeo(p.spr);
      const w = p.w, h = w * p.spr.height / p.spr.width;
      let obj;
      if (vox) {
        obj = new THREE.Mesh(vox.geo, voxMat());
        const s = w / vox.cols;                 // voxel size in world units
        obj.scale.set(s, s, s);
        // face the nearest point of the road
        const r = Tk.nearestAll(p.x, p.y), c = Tk.PTS[r.i];
        obj.rotation.y = Math.atan2(c[0] - p.x, c[1] - p.y);
        obj.userData.voxel = true;
      } else {
        const mat = new THREE.SpriteMaterial({ map: spriteTex(p.spr), transparent: true, alphaTest: 0.35 });
        mat.map._cached = true;
        obj = new THREE.Sprite(mat);
        obj.center.set(0.5, 0);
        obj.scale.set(w, h, 1);
      }
      obj.position.set(p.x, 0, p.y);
      mapGroup.add(obj);
      propSprites.push({ sprite: obj, prop: p });
    }

    // blocky white clouds over the outdoor maps
    if (Tk.fx === 'dusk' || Tk.fx === 'haunted' || (Tk.def && (Tk.def.maze || Tk.def.noMinimap))) {
      const cm = new THREE.MeshLambertMaterial({ color: Tk.fx === 'haunted' ? 0x7a7090 : 0xffffff, transparent: true, opacity: 0.9 });
      cm.fog = false;
      const rnd = PK.U.rng(Tk.current * 977 + 13);
      for (let i = 0; i < 26; i++) {
        const cg = new THREE.Group();
        const n = 2 + ((rnd() * 4) | 0);
        for (let j = 0; j < n; j++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(60 + rnd() * 80, 14, 40 + rnd() * 50), cm);
          b.position.set(j * 45 - n * 20, rnd() * 6, (rnd() - 0.5) * 40);
          cg.add(b);
        }
        const a = rnd() * Math.PI * 2, d = 700 + rnd() * 900;
        cg.position.set(TEX / 2 + Math.cos(a) * d, 230 + rnd() * 120, TEX / 2 + Math.sin(a) * d);
        mapGroup.add(cg);
      }
    }

    // sky: the 360° background table on a cylinder around the camera
    if (Tk._bg) {
      const PER = C().PER, HZ = C().HORIZON;
      const bgTex = pixelTex(canvasFromU32(Tk._bg, PER, HZ), false);
      const Rr = 2600, top = Rr * HZ / C().FOCAL, seg = 96;
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * Math.PI * 2, x = Math.cos(a) * Rr, z = Math.sin(a) * Rr, u = i / seg;
        pos.push(x, 0, z, x, top, z);
        uv.push(u, 0, u, 1);
        if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.DoubleSide, fog: false, depthWrite: false }));
      sky.renderOrder = -1;
      scene.add(sky);
    }
    scene.add(mapGroup);
  }

  // ---------------------------------------------------------------- karts
  function syncKarts(G) {
    const THREE = T3(), body = PK.Karts.playerBody || 'cart';
    if (kartList === G.karts && kartBody === body && kartModels.size === G.karts.length) return;
    kartModels.forEach((m) => { if (PK.Kart3D && PK.Kart3D.dispose) PK.Kart3D.dispose(m); else scene.remove(m); });
    kartModels = new Map();
    kartList = G.karts; kartBody = body;
    for (const k of G.karts) {
      let m = null;
      if (R.kartModels && PK.Kart3D && PK.Kart3D.available) {
        try { m = PK.Kart3D.build(k.defIndex, k.isPlayer ? body : 'cart', k.isPlayer); } catch (e) { m = null; }
      }
      if (!m) {   // pixel karts: the 2D kart sprite as a billboard on a soft shadow
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.3 }));
        s.center.set(0.5, 0);
        m = new THREE.Group(); m.add(s); m.userData.sprite = s;
        const sh = new THREE.Mesh(new THREE.CircleGeometry(3, 16),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
        sh.rotation.x = -Math.PI / 2; sh.position.y = 0.05; sh.scale.set(1, 0.6, 1);
        m.add(sh);
      }
      scene.add(m);
      kartModels.set(k, m);
    }
  }
  function placeKarts(G, camA, dt) {
    kartModels.forEach((m, k) => {
      m.position.set(k.x, 0, k.y);
      m.rotation.y = -k.a;
      if (m.userData.sprite) {
        const spr = PK.Karts.frame(k, camA);
        if (spr) {
          const s = m.userData.sprite, w = 6.5;
          s.material.map = spriteTex(spr); s.material.needsUpdate = true;
          s.scale.set(w, w * spr.height / spr.width, 1);
          s.position.y = k.hop || 0;
        }
        m.rotation.y = 0;
      } else if (PK.Kart3D && PK.Kart3D.update) {
        try { PK.Kart3D.update(m, k, dt); } catch (e) { /* ignore */ }
      }
    });
  }

  // food pickups + skill effects (bananas, melons, bats, coins …) as billboards each frame
  function placeFx() {
    const THREE = T3();
    const list = (PK.Skills && PK.Skills.sprites && PK.Skills.sprites()) || [];
    while (fxPool.length < list.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.3 }));
      s.center.set(0.5, 0);
      scene.add(s);
      fxPool.push(s);
    }
    for (let i = 0; i < fxPool.length; i++) {
      const s = fxPool[i], o = list[i];
      if (!o || !o.spr) { s.visible = false; continue; }
      const t = spriteTex(o.spr);
      if (s.material.map !== t) { s.material.map = t; s.material.needsUpdate = true; }
      s.visible = true;
      s.position.set(o.x, o.h || 0, o.y);
      s.scale.set(o.w, o.w * o.spr.height / o.spr.width, 1);
    }
  }

  // ---------------------------------------------------------------- frame
  function resizeTo() {
    const w = wrapEl.clientWidth || C().W, h = wrapEl.clientHeight || C().H;
    if (w === cw && h === ch) return;
    cw = w; ch = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(G, camX, camY, camA) {
    if (!R.available || !G || !G.player) return;
    const now = performance.now() / 1000, dt = lastT ? Math.min(0.1, now - lastT) : 1 / 60;
    lastT = now;
    canvas.style.display = 'block';
    resizeTo();
    const Tk = PK.Track;
    if (builtMap !== Tk.current || builtTheme !== Tk.theme) buildMap();

    // moving obstacles follow their props
    for (let i = 0; i < propSprites.length; i++) {
      const e = propSprites[i];
      e.sprite.position.set(e.prop.x, 0, e.prop.y);
    }
    // texture canvases repainted by the 2D code (images loading, glitch flicker): refresh now and then
    if (((now * 2) | 0) !== R._tick) { R._tick = (now * 2) | 0; texCache.forEach((t) => { t.needsUpdate = true; }); }

    syncKarts(G);
    placeKarts(G, camA, dt);
    placeFx();

    // camera: same place as the Mode-7 camera, pitched down so the horizon sits ~1/3 from the top
    const ch = C().CAM_H, p = G.player;
    camera.position.set(camX, ch, camY);
    const pitch = Math.atan((C().H / 2 - C().HORIZON) / C().FOCAL);
    const fx = Math.cos(camA), fz = Math.sin(camA), L = 100;
    camera.lookAt(camX + fx * L, ch - Math.tan(pitch) * L, camY + fz * L);
    if (sky) sky.position.set(camX, ch - 2, camY);
    sun.position.set(p.x - 300, 600, p.y + 200);
    renderer.render(scene, camera);
  }

  function hide() { if (canvas) canvas.style.display = 'none'; }
  R.hide = hide;

  function dispose() {
    clearMap();
    texCache.forEach((t) => t.dispose()); texCache.clear();
    if (renderer) renderer.dispose();
  }
})(window.PK);
