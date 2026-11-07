// PK.Game — engine: game states, input, Mode-7 renderer, billboards, HUD, audio, DOM menus.
// Flow: title → (게임 시작 | 맵 선택) → kart select → race → results → Enter = next map (0→1→2→3→0…).
// Every new race has a 10% chance to become the secret ghost map (PK.Track map 4) instead.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const C = PK.C, U = PK.U;
  const W = C.W, H = C.H, CX = C.CX, HOR = C.HORIZON, FOCAL = C.FOCAL, CAM_H = C.CAM_H, TEX = C.TEX;
  const FOG_NEAR = C.FOG_NEAR, FOG_FAR = C.FOG_FAR;
  const DT = 1 / 60;
  const KART_W = 6.5;              // kart world width
  const LS_BEST = 'pk_best_v1', LS_KART = 'pk_kart_v1', LS_MAP = 'pk_map_v1';
  const ATTRACT_RESET = 75;        // seconds before the attract race is re-seeded
  const GHOST_MAP = 4, GHOST_CHANCE = 0.10;
  const SAME_SPEED = { maxV: 153, acc: 108, boostPow: 1.39 };   // the old middle-weight kart's numbers
  const AI_SPEED = 1.15;                                          // AI rivals run 1.15× the player's speed
  // the cup rotation: every non-secret map in PK.Track.MAPS (0–3, plus any new ones such as the maze map)
  let REGULAR = [0, 1, 2, 3];
  const NORMAL_KARTS = [0, 1, 2, 3, 4, 5], GHOST_KARTS = [6, 7];   // vampire + ghost join the ghost map
  // the ghost kart (7) becomes playable: top 3 on the ghost map gives a 50% chance to win it
  const GHOST_KART = 7, LS_GHOST_KART = 'pk_ghost_kart', GHOST_REWARD_PLACE = 3, GHOST_REWARD_CHANCE = 0.5;
  // glitch map (PK.Track map 5): 1% roll before the ghost roll, hard AI; 1st place unlocks the glitch kart (8)
  const GLITCH_MAP = 5, GLITCH_CHANCE = 0.01, GLITCH_KART = 8, LS_GLITCH_KART = 'pk_glitch_kart';
  const SECRET_MAPS = [GHOST_MAP, GLITCH_MAP];
  // foods = coins: max 10 per race for the player, banked into the wallet when the race is finished
  const LS_COINS = 'pk_coins', LS_ITEMS = 'pk_items', LS_EQUIP = 'pk_equip', FOOD_CAP = 10;

  const G = PK.Game = {
    state: 'title', karts: [], player: null, time: 0, raceTime: 0,
    mapId: 0, ghostRace: false,
    attract: true,       // true while title/select/menus (no laps counted, sfx muted)
    standings: [], muted: false,
    hard: false,         // glitch map: AI never eases off (karts.js rubber band)
    init, onLap, onFood, sfx, toast,
    // debug helper (console): start a race on any map directly, e.g. PK.Game.debugRace(4)
    debugRace(id) { startRace(selIdx, id | 0, false); },
    // tests / console: advance the game by n fixed steps without waiting for frames
    debugStep(n) { for (let i = 0; i < (n | 0); i++) step(1 / 60); },
    debugShot() { render(); return canvas.toDataURL('image/png'); },
  };

  // ---------------------------------------------------------------------------
  // module state
  // ---------------------------------------------------------------------------
  let canvas, ctx, img, buf;
  const rowZ = new Float32Array(H), rowFog = new Float32Array(H);
  let camX = 0, camY = 0, camA = 0;
  const keys = Object.create(null);
  const touch = { left: false, right: false, gas: false, brake: false, drift: false, boost: false, skill: false, item: false };
  let cdT = 0, lastCd = 4, goT = 0, finT = 0, attractT = 0, surpriseT = 0, mapBannerT = 0;
  let toastText = '', toastT = 0, bannerText = '', bannerT = 0, bannerCol = '#ffcc00';
  let shakeT = 0, shakeMag = 0, glitchT = 0;
  let selIdx = 0, playerDef = 0;
  let baseMap = 0;                 // regular map of the rotation (the next race goes to baseMap + 1)
  let pendingMap = 0;              // map the kart select will start
  let selectFrom = 'title';        // where '← 뒤로' in the kart select goes
  let raceMap = 0;                 // map of the current race
  let best = { total: 0, lap: 0 }, newRecord = false, newLapRecord = false;
  let coarse = false;
  let pauseFrom = 'race', pauseSel = 0, mapSel = 0;
  let el = {}, cardEls = [], pauseBtns = [], mapBtns = [];

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  const lsGet = (k) => { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (window.localStorage) localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function fmt(t) {
    if (!(t > 0)) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + pad2(Math.floor(s)) + '.' + pad2(Math.floor((s % 1) * 100));
  }
  const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  const MAPS = () => PK.Track.MAPS || [{ id: 0, nameKo: '슈퍼마트 서킷', name: 'SUPERMART CIRCUIT' }];
  const mapInfo = (id) => MAPS()[id] || MAPS()[0];
  const ghostOwned = () => lsGet(LS_GHOST_KART) === '1';
  const glitchOwned = () => lsGet(LS_GLITCH_KART) === '1';
  const hasGlitchMap = () => !!MAPS()[GLITCH_MAP];
  // characters: only 레드 (0) is free; the other basic karts and the vampire are bought with food
  // coins in the shop. Ghost / glitch are never for sale — they are won on their secret maps.
  const FREE_KART = 0;
  const CHAR_SHOP = [
    { def: 1, key: 'pk_own_kart_1', price: 10 },
    { def: 2, key: 'pk_own_kart_2', price: 15 },
    { def: 3, key: 'pk_own_kart_3', price: 15 },
    { def: 4, key: 'pk_own_kart_4', price: 20 },
    { def: 5, key: 'pk_own_kart_5', price: 25 },
    { def: 6, key: 'pk_own_kart_6', price: 50 },   // 뱀파이어: the only special character for sale
  ];
  const charOwned = (c) => lsGet(c.key) === '1';
  // everyday cart bodies (cosmetic, PK.Karts.BODIES): the shopping cart is free, the rest are bought
  const LS_BODY = 'pk_body';
  const BODY_PRICE = { cart: 0, stroller: 15, airport: 20, granny: 25, parcel: 30, rearcar: 40 };
  const BODIES = () => (PK.Karts.BODIES || []).filter((b) => b.id in BODY_PRICE);
  const bodyOwned = (id) => id === 'cart' || lsGet('pk_own_body_' + id) === '1';
  const bodyEquipped = () => { const id = lsGet(LS_BODY) || 'cart'; return bodyOwned(id) && BODIES().some((b) => b.id === id) ? id : 'cart'; };
  function applyBody() {
    if (PK.Karts.setPlayerBody) { try { PK.Karts.setPlayerBody(bodyEquipped()); } catch (e) { /* ignore */ } }
  }
  // kart decorations (PK.Karts.DECOS: hat / flag / wheel), bought once, one of each kind worn
  const LS_DECO = 'pk_deco';
  const DECO_KO = { hat: '모자', flag: '깃발', wheel: '바퀴' };
  const DECO_PRICE = {
    hat: { cap: 10, crown: 30, santa: 15, helmet: 20, bunny: 15 },
    flag: { checker: 8, korea: 12, pirate: 15, heart: 10, rainbow: 18 },
    wheel: { gold: 25, neon: 18, fire: 22, ice: 15 },
  };
  const DECO_LIST = () => {
    const D = PK.Karts.DECOS || {}, out = [];
    ['hat', 'flag', 'wheel'].forEach((kind) => (D[kind] || []).forEach((d) => { if (d.id !== 'none' && DECO_PRICE[kind][d.id]) out.push({ kind, id: d.id, nameKo: d.nameKo }); }));
    return out;
  };
  const decoOwned = (kind, id) => id === 'none' || lsGet('pk_own_deco_' + kind + '_' + id) === '1';
  function decoWorn() {
    let o = {};
    try { o = JSON.parse(lsGet(LS_DECO) || '{}') || {}; } catch (e) { o = {}; }
    const r = {};
    ['hat', 'flag', 'wheel'].forEach((k) => { r[k] = o[k] && decoOwned(k, o[k]) ? o[k] : 'none'; });
    return r;
  }
  function applyDeco() {
    if (PK.Karts.setPlayerDeco) { try { PK.Karts.setPlayerDeco(decoWorn()); } catch (e) { /* ignore */ } }
  }
  const playable = () => {
    const r = [FREE_KART];
    CHAR_SHOP.forEach((c) => { if (charOwned(c) && c.def < PK.Karts.DEFS.length) r.push(c.def); });
    if (ghostOwned()) r.push(GHOST_KART);
    if (glitchOwned() && GLITCH_KART < PK.Karts.DEFS.length) r.push(GLITCH_KART);
    return r;
  };
  let ghostReward = '';   // '', 'got', 'miss' (ghost map) or 'glitch' (glitch map) for the results panel

  // ---- wallet / items (shop). Items are spent when used, so an unused one survives R retry.
  const ITEMS = () => PK.Skills.ITEMS || {};
  const wallet = () => Math.max(0, parseInt(lsGet(LS_COINS), 10) || 0);
  const setWallet = (n) => lsSet(LS_COINS, String(Math.max(0, n | 0)));
  function inv() {
    try { const o = JSON.parse(lsGet(LS_ITEMS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }
  const setInv = (o) => lsSet(LS_ITEMS, JSON.stringify(o));
  const owned = (id) => Math.max(0, inv()[id] | 0);
  // equipped item for the next race ('' = none); dropped once none are left
  function equipped() { const id = lsGet(LS_EQUIP) || ''; return ITEMS()[id] && owned(id) > 0 ? id : ''; }
  const setEquip = (id) => lsSet(LS_EQUIP, id || '');
  function buyItem(id) {
    const it = ITEMS()[id];
    if (!it || wallet() < it.price) return false;
    setWallet(wallet() - it.price);
    const o = inv(); o[id] = (o[id] | 0) + 1; setInv(o);
    if (!equipped()) setEquip(id);   // first purchase gets equipped right away
    return true;
  }
  // reduced motion ('화면 흔들림 줄이기'): no shake, speed lines or screen-wide flicker/glitch
  const LS_CALM = 'pk_calm';
  let calm = false;
  function toggleCalm() {
    calm = !calm;
    lsSet(LS_CALM, calm ? '1' : '0');
    refreshCalm();
    if (calm) shakeT = 0;
    toast(calm ? 'CALM MODE ON' : 'CALM MODE OFF');
  }
  function refreshCalm() {
    const t = '🌙 화면 흔들림 줄이기: ' + (calm ? '켬' : '끔');
    if (el.btnCalm) el.btnCalm.textContent = t;
    for (let i = 0; i < pauseBtns.length; i++) if (pauseBtns[i].getAttribute('data-act') === 'calm') pauseBtns[i].textContent = t;
  }
  // easy controls ('쉬운 조작', on by default): light steering help toward the racing line while accelerating, auto drift
  const LS_EASY = 'pk_easy';
  let easy = true;
  // real 3D view (js/render3d.js + Three.js) — off: the user chose the pixel Mode-7 map again.
  // Set to true (and load three.js + render3d.js in index.html) to bring the 3D map back.
  let view3d = false;
  const use3d = () => view3d && PK.R3D && PK.R3D.available;
  function toggleEasy() {
    easy = !easy;
    lsSet(LS_EASY, easy ? '1' : '0');
    refreshEasy();
    toast(easy ? 'EASY CONTROLS ON' : 'EASY CONTROLS OFF');
  }
  function refreshEasy() {
    const t = '🎮 쉬운 조작: ' + (easy ? '켬' : '끔');
    if (el.btnEasy) el.btnEasy.textContent = t;
    for (let i = 0; i < pauseBtns.length; i++) if (pauseBtns[i].getAttribute('data-act') === 'easy') pauseBtns[i].textContent = t;
  }
  let foodRace = 0, coinsBanked = false;   // foods eaten this race (coins), banked yet?
  let raceItem = '', itemUsed = false, itemPrev = false;
  // 🚀 rocket start: gas first pressed in the last RS_WIN s of the "1" -> RS_BOOST s boost at GO;
  // gas held since the "3" (cdT > RS_EARLY when the hold began) -> RS_STALL s wheel-spin stall.
  // AI karts: RS_AI_GOOD chance of a good start (a slightly shorter boost), else a normal one.
  const RS_WIN = 0.35, RS_EARLY = 2.0, RS_BOOST = 1.2, RS_STALL = 0.4, RS_AI_GOOD = 0.35, RS_AI_BOOST = 1.0;
  let rsFrom = -1;   // cdT when the current gas hold began (-1 = not held)
  // 💨 position feedback: a new place must hold POS_HOLD s before it counts (no flicker side by side)
  const POS_HOLD = 0.2, POS_PULSE = 0.45, POS_FLASH = 0.5;
  let posShown = -1, posCand = -1, posCandT = 0, posPulse = 0, posFlash = 0, ovtCool = 0, ovtT = 0;
  // ✨ juice: speed-line burst on a fresh boost, finish confetti
  let speedBurst = 0, lastBoostT = 0, confT = 0, tbHas = null;
  // counters for tests / the console (PK.Game.dbg)
  G.dbg = { rocket: '', rocketAI: 0, overtakes: 0, overtaken: 0, boxGot: 0, boxUsed: 0, boxUsedAI: 0, missileHits: 0, podium: 0, confetti: 0, parts: 0 };

  // best times per map: map 0 keeps the old key, the others 'pk_best_v1_m<id>'
  const bestKey = (id) => (id === 0 ? LS_BEST : LS_BEST + '_m' + id);
  function loadBest(id) {
    try { const b = JSON.parse(lsGet(bestKey(id)) || 'null'); if (b) return { total: +b.total || 0, lap: +b.lap || 0 }; } catch (e) { /* ignore */ }
    return { total: 0, lap: 0 };
  }

  // ---------------------------------------------------------------------------
  // 👻 ghost mode (title): a solo race (no AI) against your own best run on that map. Every race
  // records the run (position + steering every GH_DT s); the fastest one per map is kept and replayed
  // as a see-through kart in ghost mode. Off in online / test races.
  // Saved as 'pk_ghostrun_m<id>' = { t: finish time, d: defIndex, p: [x, y, steer, ...] }.
  // ---------------------------------------------------------------------------
  const GH_DT = 0.1;
  const ghostKey = (id) => 'pk_ghostrun_m' + id;
  let ghostMode = false, ghRec = null, ghRun = null, ghKart = null;
  function ghostLoad(id) {
    try {
      const o = JSON.parse(lsGet(ghostKey(id)) || 'null');
      if (o && o.t > 0 && Array.isArray(o.p) && o.p.length >= 6) return o;
    } catch (e) { /* ignore */ }
    return null;
  }
  function ghostBegin(attract) {
    ghRec = null; ghRun = null; ghKart = null;
    if (attract || G.online || testMode) return;
    ghRec = [];
    const o = ghostMode ? ghostLoad(raceMap) : null;
    if (!o) return;
    ghRun = o;
    const def = PK.Karts.DEFS[o.d] ? o.d : 0;
    // drawn with the player's own sprites (isPlayer) but never added to G.karts: no collisions / standings
    ghKart = { ghostRun: true, isPlayer: true, defIndex: def, def: PK.Karts.DEFS[def], fx: {}, x: o.p[0], y: o.p[1],
      a: 0, ma: 0, v: 0, steerIn: 0, drift: false, driftDir: 0, hop: 0, alpha: 0.45 };
  }
  function ghostRecord() {
    const k = G.player;
    if (!ghRec || !k || k.finished) return;
    while (ghRec.length / 3 * GH_DT <= G.raceTime) {
      ghRec.push(Math.round(k.x * 10) / 10, Math.round(k.y * 10) / 10, Math.round((k.steerIn || 0) * 100) / 100);
    }
  }
  function ghostSave(k) {
    if (!ghRec || G.online || testMode || ghRec.length < 6) return false;
    const old = ghostLoad(raceMap);
    if (old && !(k.finishTime < old.t)) return false;
    lsSet(ghostKey(raceMap), JSON.stringify({ t: Math.round(k.finishTime * 100) / 100, d: k.defIndex, p: ghRec }));
    return true;
  }
  // move the ghost to where the recorded run was at this race time; false = nothing to show
  function ghostPlace() {
    if (!ghKart || !ghRun || G.online) return false;
    const st = G.state;
    if (st !== 'countdown' && st !== 'race' && st !== 'finished') return false;
    const P = ghRun.p, n = P.length / 3, tt = st === 'countdown' ? 0 : G.raceTime;
    if (tt > ghRun.t + 0.6) return false;            // its run is over: it vanishes past the line
    const f = Math.min(n - 1.001, tt / GH_DT), i = f | 0, u = f - i, j = Math.min(n - 1, i + 1);
    const x = P[i * 3] + (P[j * 3] - P[i * 3]) * u, y = P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * u;
    const dx = x - ghKart.x, dy = y - ghKart.y;
    if (dx * dx + dy * dy > 0.0004) ghKart.a = ghKart.ma = Math.atan2(dy, dx);
    else if (i === 0 && n > 2) {
      // still on the grid: face along the track like the real karts
      let m = 1; while (m < n - 1 && Math.abs(P[m * 3] - P[0]) + Math.abs(P[m * 3 + 1] - P[1]) < 0.5) m++;
      ghKart.a = ghKart.ma = Math.atan2(P[m * 3 + 1] - P[1], P[m * 3] - P[0]);
    }
    ghKart.x = x; ghKart.y = y;
    ghKart.steerIn = P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * u;
    ghKart.alpha = 0.38 + Math.sin(G.time * 5) * 0.08;
    return true;
  }
  // console / tests: PK.Game.ghostInfo()
  G.ghostInfo = () => ({ mode: ghostMode, rec: ghRec ? ghRec.length / 3 : -1, run: ghRun ? ghRun.t : 0, at: ghKart ? [Math.round(ghKart.x), Math.round(ghKart.y)] : null });
  // title '👻 고스트 모드': pick a map, then a kart, then race the ghost
  // lobby sub-menus: '🎮 다른 모드' (maps / GP / ghost / online) and '⚙ 설정'
  function goModes() { G.state = 'modes'; G.attract = true; showOnly('modes'); }
  function goSettings() {
    G.state = 'settings'; G.attract = true; showOnly('settings');
  }
  function goGhostMode() { ghostMode = true; gp = null; goMaps(); }
  // finish in ghost mode: who won? (old = the ghost's time before this run, 0 = no ghost yet)
  function ghostResult(k, old) {
    const b = el.mapBanner;
    if (!b) return;
    b.innerHTML = '';
    if (!(old > 0)) {
      b.appendChild(mk('b', null, '👻 첫 고스트 기록 완성!'));
      b.appendChild(mk('small', null, '다음 판부터 이 기록의 고스트와 대결해요'));
    } else if (k.finishTime < old) {
      b.appendChild(mk('b', null, '🏆 고스트를 이겼어요!'));
      b.appendChild(mk('small', null, (old - k.finishTime).toFixed(2) + '초 빨랐어요 · 이번 기록이 새 고스트가 돼요'));
    } else {
      b.appendChild(mk('b', null, '👻 고스트가 이겼어요'));
      b.appendChild(mk('small', null, (k.finishTime - old).toFixed(2) + '초 차이 · 다시 도전해 보세요 (R)'));
    }
    b.className = 'on';
    mapBannerT = 3.2;
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------
  function init() {
    canvas = document.getElementById('game');
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    img = ctx.createImageData(W, H);
    buf = new Uint32Array(img.data.buffer);
    for (let y = HOR; y < H; y++) {
      const z = CAM_H * FOCAL / (y - HOR + 0.5);
      rowZ[y] = z;
      rowFog[y] = U.clamp((z - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
    }

    const reg = (PK.Track.MAPS || []).filter((m) => !m.secret).map((m) => m.id);
    if (reg.length) REGULAR = reg;
    const bm = parseInt(lsGet(LS_MAP), 10);
    baseMap = REGULAR.indexOf(bm) >= 0 ? bm : 0;
    pendingMap = baseMap;
    PK.Track.load(baseMap);
    PK.Karts.init();
    PK.Skills.init();
    // every character has the same speed (top speed, acceleration, boost); only handling and skills differ
    PK.Karts.DEFS.forEach((d) => { d.maxV = SAME_SPEED.maxV; d.acc = SAME_SPEED.acc; d.boostPow = SAME_SPEED.boostPow; });
    applyBody();   // the player's equipped everyday cart (shop)
    applyDeco();   // and decorations

    const sk = parseInt(lsGet(LS_KART), 10);
    selIdx = playable().indexOf(sk) >= 0 ? sk : 0;
    playerDef = selIdx;

    el = {
      wrap: document.getElementById('wrap'), title: document.getElementById('title'), select: document.getElementById('select'),
      cards: document.getElementById('cards'), touch: document.getElementById('touch'), best: document.getElementById('best'),
      btnStart: document.getElementById('btnStart'), btnGo: document.getElementById('btnGo'), btnBack: document.getElementById('btnBack'),
      btnMaps: document.getElementById('btnMaps'), maps: document.getElementById('maps'), mapList: document.getElementById('mapList'),
      btnMapsBack: document.getElementById('btnMapsBack'), pause: document.getElementById('pause'),
      btnPause: document.getElementById('btnPause'), mapBanner: document.getElementById('mapBanner'),
      shop: document.getElementById('shop'), shopList: document.getElementById('shopList'), shopCoins: document.getElementById('shopCoins'),
      btnShop: document.getElementById('btnShop'), btnShopBack: document.getElementById('btnShopBack'),
      dex: document.getElementById('dex'), dexList: document.getElementById('dexList'), dexInfo: document.getElementById('dexInfo'),
      btnDex: document.getElementById('btnDex'), btnDexBack: document.getElementById('btnDexBack'),
      ach: document.getElementById('ach'), achList: document.getElementById('achList'), achInfo: document.getElementById('achInfo'),
      btnAch: document.getElementById('btnAch'), btnAchBack: document.getElementById('btnAchBack'), playerTitle: document.getElementById('playerTitle'),
      rank: document.getElementById('rank'), rankList: document.getElementById('rankList'), rankTabs: document.getElementById('rankTabs'),
      rankInfo: document.getElementById('rankInfo'), rankNick: document.getElementById('rankNick'),
      btnRank: document.getElementById('btnRank'), btnRankBack: document.getElementById('btnRankBack'), btnNick: document.getElementById('btnNick'),
      coins: document.getElementById('coins'), btnItem: document.getElementById('btnItem'), tbItem: document.getElementById('tbItem'),
      btnCalm: document.getElementById('btnCalm'), btnEasy: document.getElementById('btnEasy'),
      ctest: document.getElementById('ctest'), ctList: document.getElementById('ctList'), ctMaps: document.getElementById('ctMaps'),
      ctInfo: document.getElementById('ctInfo'), ctGhost: document.getElementById('ctGhost'), ctGlitch: document.getElementById('ctGlitch'),
      btnTest: document.getElementById('btnTest'), btnMapTest: document.getElementById('btnMapTest'),
      mtest: document.getElementById('mtest'), mtList: document.getElementById('mtList'),
      ovt: document.getElementById('ovt'),
    };
    calm = lsGet(LS_CALM) !== '0';   // calm (no shake / flicker) is on unless the player turned it off
    easy = lsGet(LS_EASY) !== '0';   // easy controls too
    // console/test access to the wallet + shop
    G.store = { wallet, setWallet, inv, owned, equipped, setEquip, buy: buyItem, race: () => ({ food: foodRace, item: raceItem, used: itemUsed }) };
    coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || !!(PK.Mobile && PK.Mobile.touchy);
    buildSelect();
    buildFx();
    bindInput();
    refreshCalm();
    refreshEasy();
    // 3D view: a WebGL canvas under the 2D one (which then only carries the HUD and overlays)
    if (PK.R3D && PK.R3D.init) { try { PK.R3D.init(el.wrap, canvas); } catch (e) { /* stays 2D */ } }
    resize();
    window.addEventListener('resize', resize);
    goTitle();
    if (PK.Intro && !PK.Intro.seen()) playIntro();   // 🎬 opening cutscene on the very first launch
    requestAnimationFrame(loop);
  }

  function resize() {
    const vw = window.innerWidth || W, vh = window.innerHeight || H;
    const s = Math.min(vw / W, vh / H);
    const w = Math.floor(W * s), h = Math.floor(H * s);
    if (el.wrap) {
      el.wrap.style.width = w + 'px'; el.wrap.style.height = h + 'px';
      el.wrap.style.fontSize = U.clamp(w / 58, 9, 20).toFixed(1) + 'px';
    }
  }

  // ---------------------------------------------------------------------------
  // states / overlays
  // ---------------------------------------------------------------------------
  function show(e, on) { if (e && e.classList) e.classList.toggle('on', !!on); }
  const RACE_STATES = { countdown: 1, race: 1, finished: 1 };
  // one place that decides which DOM overlay is visible
  // ---------------------------------------------------------------------------
  // 🎓 tutorial (first race only), 📅 daily challenge, 🏆 Grand Prix
  // ---------------------------------------------------------------------------
  // per-race counters for the daily challenge
  let rstat = { mt: 0, wall: 0, ovt0: 0 }, prevMt = false;
  function rstatReset() { rstat = { mt: 0, wall: 0, ovt0: G.dbg.overtakes | 0 }; prevMt = false; }
  function rstatTick() {
    const p = G.player;
    if (!p) return;
    const mt = (p._mtBurst || 0) > 0;
    if (mt && !prevMt) rstat.mt++;
    prevMt = mt;
  }

  // ---- 🎓 tutorial: short hints on the first race, each until done (or a timeout)
  const LS_TUT = 'pk_tut_v1';
  let tut = -1, tutT = 0, tutHold = 0;
  function TUT() {
    const k = !coarse;
    return [
      { msg: k ? '🚀 GO! 가 뜨기 직전에 ↑ 를 누르면 로켓 스타트!' : '🚀 GO! 가 뜨기 직전에 가속을 누르면 로켓 스타트!', state: 'countdown', done: () => false, max: 99 },
      { msg: k ? '↑ 가속 · ← → 방향 · ↓ 브레이크' : '조이스틱으로 가속하고 방향을 바꿔요', done: (p) => Math.abs(p.v) > 50, hold: 1, max: 8 },
      { msg: k ? '🌀 커브에서 Space 를 누른 채 방향키 → 드리프트! 불꽃이 커지면 놓아서 미니 터보' : '🌀 커브에서 드리프트 버튼을 누른 채 꺾기 → 불꽃이 커지면 놓아서 미니 터보', done: () => rstat.mt > 0, max: 16 },
      { msg: k ? '⚡ 부스터 게이지가 차면 Z 로 부스터!' : '⚡ 부스터 게이지가 차면 부스터 버튼!', done: (p) => p.boostT > 0.6 && !(p._mtBurst > 0), max: 10 },
      { msg: '🍎 길 위의 음식을 먹으면 코인! (한 판에 10개까지)', done: () => foodRace > 0, max: 8 },
      { msg: k ? '✨ X 는 캐릭터마다 다른 고유 스킬 · 벽과 풀밭은 느려져요!' : '✨ 스킬 버튼은 캐릭터마다 달라요 · 벽과 풀밭은 느려져요!', done: () => false, max: 5 },
    ];
  }
  function tutStart() {
    tut = -1; tutT = 0;
    if (G.online || testMode || lsGet(LS_TUT) === '1') { tutShow(''); return; }
    tutNext();
  }
  function tutNext() {
    const L = TUT();
    tut++; tutT = 0; tutHold = 0;
    if (tut >= L.length) { tut = -1; lsSet(LS_TUT, '1'); tutShow(''); return; }
    tutShow(L[tut].msg);
  }
  function tutShow(msg) {
    const b = document.getElementById('tutBox');
    if (!b) return;
    b.textContent = msg; b.className = msg ? 'on' : '';
  }
  function tutTick(dt) {
    if (tut < 0) return;
    const L = TUT(), s = L[tut], p = G.player, st = G.state;
    const tb = document.getElementById('tutBox'); if (tb) tb.style.visibility = st === 'paused' ? 'hidden' : '';
    if (st === 'finished') { tut = -1; lsSet(LS_TUT, '1'); tutShow(''); return; }
    if (!p || (st !== 'race' && st !== 'countdown')) return;
    if (s.state === 'countdown') { if (st === 'race') tutNext(); return; }
    if (st !== 'race') return;
    tutT += dt;
    if (s.done(p)) tutHold += dt; else tutHold = 0;
    if (tutHold >= (s.hold || 0.01) || tutT > s.max) tutNext();
  }

  // ---- 📅 daily challenge: one mission a day (same for everyone on that date), 🍎 +8 once
  const LS_DAILY = 'pk_daily', DAILY_COINS = 8;
  const DAILY = [
    { id: 'mt', name: '미니 터보 5번 쓰고 완주하기', ok: (r) => r.mt >= 5 },
    { id: 'nowall', name: '벽에 세게 박지 않고 완주하기', ok: (r) => r.wall === 0 },
    { id: 'food', name: '한 판에 음식 7개 이상 먹기', ok: (r) => r.food >= 7 },
    { id: 'top3', name: '3등 안에 들어오기', ok: (r) => r.place <= 3 },
    { id: 'win', name: '1등으로 완주하기', ok: (r) => r.place === 1 },
    { id: 'rocket', name: '로켓 스타트 성공하고 완주하기', ok: (r) => r.rocket },
    { id: 'ovt', name: '한 판에 5번 추월하기', ok: (r) => r.ovt >= 5 },
  ];
  function dayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function todayDaily() {
    const k = dayKey();
    let h = 7; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return DAILY[h % DAILY.length];
  }
  function dailyDone() { try { const o = JSON.parse(lsGet(LS_DAILY) || 'null'); return !!(o && o.d === dayKey() && o.done); } catch (e) { return false; } }
  function refreshDaily() {
    const b = document.getElementById('daily');
    if (!b) return;
    const c = todayDaily(), d = dailyDone();
    b.textContent = '📅 오늘의 도전: ' + c.name + (d ? '  ✅ 완료!' : '  · 🍎 +' + DAILY_COINS);
    b.classList.toggle('done', d);
  }
  function dailyCheck(k, place) {
    if (dailyDone()) return;
    const c = todayDaily();
    const r = { mt: rstat.mt, wall: rstat.wall, food: foodRace, place, rocket: G.dbg.rocket === 'good', ovt: (G.dbg.overtakes | 0) - rstat.ovt0 };
    if (!c.ok(r)) return;
    lsSet(LS_DAILY, JSON.stringify({ d: dayKey(), done: true }));
    setWallet(wallet() + DAILY_COINS);
    achQueue.push({ head: '📅 오늘의 도전 성공!', sub: c.name + ' · 🍎 +' + DAILY_COINS });
    achShowNext();
  }

  // ---- 🏆 Grand Prix: the regular maps in a row with the same rivals, points per race
  const GP_PTS = [10, 8, 6, 5, 4, 3], GP_COINS = [20, 12, 8];
  let gp = null;   // { round, pts: { defIndex: points }, roster: [defIndex], scored: round, place }
  function goGP() {
    ghostMode = false;
    const maps = REGULAR.slice(0, 4);   // the 4 circuits (the maze is left out)
    pendingMap = maps[0]; selectFrom = 'title';
    goSelect();
    gp = { round: 0, maps, pts: {}, roster: null, scored: -1 };
  }
  function gpScore() {
    if (!gp || gp.scored === gp.round) return;
    gp.scored = gp.round;
    const st = computeStandings().slice();
    st.forEach((k, i) => { gp.pts[k.defIndex] = (gp.pts[k.defIndex] || 0) + (GP_PTS[i] || 0); });
  }
  function gpTable() {
    const ids = [playerDef].concat(gp.roster || []);
    return ids.map((d) => ({ d, me: d === playerDef, pts: gp.pts[d] || 0 })).sort((a, b) => b.pts - a.pts || (a.me ? -1 : b.me ? 1 : 0));
  }
  function gpNext() {
    gpScore();
    gp.round++;
    if (gp.round < gp.maps.length) { startRace(playerDef, gp.maps[gp.round], false); return; }
    gpFinal();
  }
  function gpFinal() {
    const tb = gpTable(), place = tb.findIndex((r) => r.me) + 1, prize = GP_COINS[place - 1] || 0;
    if (prize) setWallet(wallet() + prize);
    musicStop();
    G.state = 'gpfinal'; G.attract = true;
    showOnly('gpfinal');
    const box = document.getElementById('gpList'), info = document.getElementById('gpInfo');
    if (box) {
      box.innerHTML = '';
      tb.forEach((r, i) => {
        const d = PK.Karts.DEFS[r.d] || {};
        const row = mk('div', 'gprow' + (r.me ? ' me' : ''));
        row.appendChild(mk('b', null, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.'));
        const nm = mk('span', null, (r.me ? '나 · ' : '') + (d.nameKo || '?')); nm.style.color = d.color || '#fff';
        row.appendChild(nm);
        row.appendChild(mk('i', null, r.pts + '점'));
        box.appendChild(row);
      });
    }
    if (info) info.textContent = place === 1 ? '🏆 그랑프리 우승! 🍎 +' + prize : place <= 3 ? place + '등! 🍎 +' + prize : place + '등 · 다음엔 시상대에 올라가 봐요!';
    gp.place = place;
    sfx(place === 1 ? 'finish' : 'lap');
  }
  function gpFinalDone() {
    const place = gp ? gp.place : 6;
    gp = null;
    goTitle();
  }

  // ---- cutscene runner (js/intro.js)
  function playScript(name, ctx, done) {
    if (!PK.Intro) { setTimeout(done, 0); return; }
    G.state = 'intro'; G.attract = true;
    showOnly('intro');
    musicStop();
    PK.Intro.play(name, ctx, uiBeep, done);
  }

  // 🎬 opening cutscene (js/intro.js): home → street → meat corner → start line, then the title.
  // Plays once on first launch (pk_intro_v2), again from the title's '오프닝 다시 보기'.
  function playIntro() {
    if (!PK.Intro) return;
    G.state = 'intro'; G.attract = true;
    showOnly('intro');
    PK.Intro.play('intro', {}, uiBeep, goTitle);
  }
  function showOnly(which) {
    show(el.title, which === 'title'); show(el.select, which === 'select'); show(el.maps, which === 'maps');
    show(el.pause, which === 'pause'); show(el.shop, which === 'shop'); show(el.dex, which === 'dex'); show(el.ach, which === 'ach'); show(el.rank, which === 'rank');
    show(el.ctest, which === 'ctest'); show(el.mtest, which === 'mtest');
    show(document.getElementById('gpfinal'), which === 'gpfinal');
    show(document.getElementById('modes'), which === 'modes'); show(document.getElementById('settings'), which === 'settings');
    if (which !== 'race' && which !== 'pause') tutShow('');
    if (which === 'pause') musicStop();
    else if (which !== 'race') musicPlay(-1);   // menus: calm title loop
    const racing = which === 'race' || which === 'pause';
    show(el.touch, coarse && which === 'race');
    if (el.tbItem) el.tbItem.style.display = !G.online || (raceItem && !ITEMS()[raceItem].auto) ? '' : 'none';
    tbHas = null;
    show(el.btnPause, which === 'race');
    if (!racing) hideMapBanner();
  }

  function updateBestText() {
    if (!el.best) return;
    const b = loadBest(baseMap), m = mapInfo(baseMap);
    el.best.textContent = m.nameKo + ' 최고 기록: ' + (b.total > 0 ? fmt(b.total) + '  ·  베스트 랩 ' + fmt(b.lap) : '없음');
    if (el.coins) el.coins.textContent = '🍎 코인 ' + wallet();
  }

  function goTitle() {
    G.state = 'title'; G.attract = true; gp = null;
    showOnly('title');
    refreshDaily();
    refreshTitle();
    updateBestText();
    setupRace(randomKart(), true, baseMap);
  }

  function randomKart() { return NORMAL_KARTS[(Math.random() * NORMAL_KARTS.length) | 0]; }

  // '게임 시작': kart select for the next map of the rotation
  function startGame() { ghostMode = false; gp = null; pendingMap = baseMap; selectFrom = 'title'; goSelect(); }

  function goSelect() {
    G.state = 'select'; G.attract = true;
    showOnly('select');
    if (el.btnBack) el.btnBack.textContent = '← 뒤로';
    refreshCards();
    refreshItemBtn();
    if (!G.karts.length || raceMap !== pendingMap) setupRace(randomKart(), true, pendingMap);
  }

  // ---------------------------------------------------------------------------
  // map select (title)
  // ---------------------------------------------------------------------------
  function goMaps() {
    G.state = 'maps'; G.attract = true; gp = null;
    showOnly('maps');
    const mt = el.maps && el.maps.querySelector('.stitle');
    if (mt) mt.textContent = ghostMode ? '👻 고스트 모드 · 맵 선택' : '맵 선택';
    buildMapList();
    if (SECRET_MAPS.indexOf(raceMap) >= 0) setupRace(randomKart(), true, baseMap);
  }
  function buildMapList() {
    const list = el.mapList;
    if (!list) return;
    list.innerHTML = '';
    mapBtns = [];
    // the ghost map is never listed: it only shows up as the 10% surprise on the other maps
    selectableMaps().forEach((m, i) => {
      const b = mk('button', 'btn mbtn');
      const bt = loadBest(m.id);
      b.appendChild(mk('b', null, (i + 1) + '. ' + m.nameKo));
      b.appendChild(mk('small', null, m.desc || ''));
      b.appendChild(mk('i', null, bt.total > 0 ? fmt(bt.total) : '--:--.--'));
      b.addEventListener('click', () => { ensureAudio(); mapSel = i; refreshMapSel(); pickMap(i); });
      b.addEventListener('pointerenter', () => { if (mapSel !== i) { mapSel = i; refreshMapSel(); } });
      list.appendChild(b);
      mapBtns.push(b);
    });
    mapSel = Math.min(mapSel, mapBtns.length - 1);
    refreshMapSel();
  }
  function refreshMapSel() { for (let i = 0; i < mapBtns.length; i++) mapBtns[i].classList.toggle('sel', i === mapSel); }
  const selectableMaps = () => MAPS().filter((m) => !m.secret && SECRET_MAPS.indexOf(m.id) < 0);
  function pickMap(i) {
    const m = selectableMaps()[i];
    if (!m) return;
    uiBeep(1);
    pendingMap = m.id; selectFrom = 'maps';
    goSelect();
  }

  // ---------------------------------------------------------------------------
  // shop (title): buy items with food coins, equip one for the next races
  // ---------------------------------------------------------------------------
  let shopSel = 0, shopCards = [], shopMsg = '', shopTab = 'item';
  // shop tabs (칸): items / characters / cart bodies / decorations
  const SHOP_TABS = [['item', '🎒 아이템'], ['char', '🧑 캐릭터'], ['body', '🛒 카트'], ['deco', '🎀 꾸미기']];
  function setShopTab(t) { if (t === shopTab) return; shopTab = t; shopSel = 0; shopMsg = ''; uiBeep(0); buildShop(); }
  function goShop() {
    G.state = 'shop'; G.attract = true;
    showOnly('shop');
    shopMsg = '';
    buildShop();
  }
  function buildShop() {
    const list = el.shopList, I = ITEMS(), ids = PK.Skills.ITEM_IDS || Object.keys(I);
    if (el.shopCoins) el.shopCoins.textContent = '🍎 보유 코인 ' + wallet() + (shopMsg ? '  ·  ' + shopMsg : '');
    if (!list) return;
    const tabs = document.getElementById('shopTabs');
    if (tabs) {
      tabs.innerHTML = '';
      SHOP_TABS.forEach(([t, label], n) => {
        const b = mk('button', 'btn ' + (t === shopTab ? '' : 'alt'), label + ' (' + (n + 1) + ')');
        b.addEventListener('click', () => { ensureAudio(); setShopTab(t); });
        tabs.appendChild(b);
      });
    }
    list.innerHTML = '';
    shopCards = [];
    const eq = equipped();
    if (shopTab === 'item') ids.forEach((id, i) => {
      const it = I[id], n = owned(id), can = wallet() >= it.price;
      const c = mk('div', 'icard' + (id === eq ? ' eq' : ''));
      c.dataset.sid = id;
      const hd = mk('div', 'ihead');
      const cv = copyCanvas(it.icon, '#ffcc00', 12, 12);
      hd.appendChild(cv);
      const nm = mk('div', 'iname', it.nameKo);
      nm.appendChild(mk('small', null, '🍎 ' + it.price));
      hd.appendChild(nm);
      c.appendChild(hd);
      c.appendChild(mk('div', 'idesc', it.desc + (it.auto ? '' : ' · C키')));
      const ft = mk('div', 'ifoot');
      ft.appendChild(mk('span', null, '보유 ' + n));
      const bb = mk('button', 'btn ibtn' + (can ? '' : ' off'), '구매');
      bb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopBuy(id); });
      ft.appendChild(bb);
      const eb = mk('button', 'btn alt ibtn' + (n > 0 ? '' : ' off'), id === eq ? '해제' : '장착');
      eb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopEquip(id); });
      ft.appendChild(eb);
      c.appendChild(ft);
      c.addEventListener('click', () => { if (shopSel !== i) { shopSel = i; refreshShopSel(); uiBeep(0); } });
      list.appendChild(c);
      shopCards.push(c);
    });
    // character cards: buy once, then pick them on kart select
    const SD = PK.Skills.DEFS || {};
    if (shopTab === 'char') CHAR_SHOP.forEach((ch) => {
      const d = PK.Karts.DEFS[ch.def];
      if (!d) return;
      const i = shopCards.length, have = charOwned(ch), can = !have && wallet() >= ch.price;
      const sd = SD[d.skill] || {};
      const c = mk('div', 'icard char' + (have ? ' eq' : ''));
      c.dataset.sid = 'char:' + ch.def;
      const hd = mk('div', 'ihead');
      const cv = copyCanvas(PK.Karts.sprite(ch.def, true), d.color, 16, 12);
      hd.appendChild(cv);
      const nm = mk('div', 'iname', '캐릭터 · ' + d.nameKo);
      nm.appendChild(mk('small', null, have ? '보유 중' : '🍎 ' + ch.price));
      hd.appendChild(nm);
      c.appendChild(hd);
      c.appendChild(mk('div', 'idesc', '스킬: ' + (sd.nameKo || d.skill) + (sd.desc ? ' — ' + sd.desc : '')));
      const ft = mk('div', 'ifoot');
      ft.appendChild(mk('span', null, have ? '카트 선택에서 고르기' : '한 번 사면 계속 사용'));
      const bb = mk('button', 'btn ibtn' + (can ? '' : ' off'), have ? '보유 ✓' : '구매');
      bb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopBuy('char:' + ch.def); });
      ft.appendChild(bb);
      c.appendChild(ft);
      c.addEventListener('click', () => { if (shopSel !== i) { shopSel = i; refreshShopSel(); uiBeep(0); } });
      list.appendChild(c);
      shopCards.push(c);
    });
    // everyday cart bodies: buy once, then equip (looks only)
    const curBody = bodyEquipped();
    if (shopTab === 'body') BODIES().forEach((b) => {
      const i = shopCards.length, have = bodyOwned(b.id), price = BODY_PRICE[b.id], can = !have && wallet() >= price;
      const c = mk('div', 'icard body' + (b.id === curBody ? ' eq' : ''));
      c.dataset.sid = 'body:' + b.id;
      const hd = mk('div', 'ihead');
      let spr = null;
      try { spr = PK.Karts.bodySprite ? PK.Karts.bodySprite(b.id, selIdx) : null; } catch (e) { spr = null; }
      hd.appendChild(copyCanvas(spr, '#9aa6ad', 16, 12));
      const nm = mk('div', 'iname', '카트 · ' + b.nameKo);
      nm.appendChild(mk('small', null, have ? (b.id === curBody ? '장착 중' : '보유 중') : '🍎 ' + price));
      hd.appendChild(nm);
      c.appendChild(hd);
      c.appendChild(mk('div', 'idesc', (b.desc || '') + ' · 모양만 바뀌어요'));
      const ft = mk('div', 'ifoot');
      ft.appendChild(mk('span', null, have ? '보유' : '한 번 사면 계속 사용'));
      if (!have) {
        const bb = mk('button', 'btn ibtn' + (can ? '' : ' off'), '구매');
        bb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopBuy('body:' + b.id); });
        ft.appendChild(bb);
      }
      const eb = mk('button', 'btn alt ibtn' + (have && b.id !== curBody ? '' : ' off'), b.id === curBody ? '장착 중' : '장착');
      eb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopEquip('body:' + b.id); });
      ft.appendChild(eb);
      c.appendChild(ft);
      c.addEventListener('click', () => { if (shopSel !== i) { shopSel = i; refreshShopSel(); uiBeep(0); } });
      list.appendChild(c);
      shopCards.push(c);
    });
    // decorations: hats / flags / wheels — buy once, wear one of each kind (tap again to take off)
    const worn = decoWorn();
    if (shopTab === 'deco') DECO_LIST().forEach((dc) => {
      const i = shopCards.length, have = decoOwned(dc.kind, dc.id), on = worn[dc.kind] === dc.id;
      const price = DECO_PRICE[dc.kind][dc.id], can = !have && wallet() >= price;
      const c = mk('div', 'icard deco' + (on ? ' eq' : ''));
      c.dataset.sid = 'deco:' + dc.kind + ':' + dc.id;
      const hd = mk('div', 'ihead');
      let spr = null;
      try { spr = PK.Karts.decoSprite ? PK.Karts.decoSprite(dc.kind, dc.id, selIdx) : null; } catch (e) { spr = null; }
      hd.appendChild(copyCanvas(spr, '#9aa6ad', 16, 12));
      const nm = mk('div', 'iname', DECO_KO[dc.kind] + ' · ' + dc.nameKo);
      nm.appendChild(mk('small', null, have ? (on ? '장착 중' : '보유 중') : '🍎 ' + price));
      hd.appendChild(nm);
      c.appendChild(hd);
      c.appendChild(mk('div', 'idesc', '카트 꾸미기 · 내 카트에 ' + DECO_KO[dc.kind] + '을(를) 달아요'));
      const ft = mk('div', 'ifoot');
      ft.appendChild(mk('span', null, have ? '보유' : '한 번 사면 계속 사용'));
      if (!have) {
        const bb = mk('button', 'btn ibtn' + (can ? '' : ' off'), '구매');
        bb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopBuy('deco:' + dc.kind + ':' + dc.id); });
        ft.appendChild(bb);
      }
      const eb = mk('button', 'btn alt ibtn' + (have ? '' : ' off'), on ? '해제' : '장착');
      eb.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); shopSel = i; shopEquip('deco:' + dc.kind + ':' + dc.id); });
      ft.appendChild(eb);
      c.appendChild(ft);
      c.addEventListener('click', () => { if (shopSel !== i) { shopSel = i; refreshShopSel(); uiBeep(0); } });
      list.appendChild(c);
      shopCards.push(c);
    });
    shopSel = U.clamp(shopSel, 0, Math.max(0, shopCards.length - 1));
    refreshShopSel();
  }
  function wearDeco(kind, id) {
    const o = decoWorn();
    o[kind] = id;
    lsSet(LS_DECO, JSON.stringify(o));
    applyDeco(); buildSelect();
  }
  function refreshShopSel() {
    for (let i = 0; i < shopCards.length; i++) shopCards[i].classList.toggle('sel', i === shopSel);
    const c = shopCards[shopSel];
    if (c && c.scrollIntoView && G.state === 'shop') { try { c.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }
  function shopBuy(id) {
    if (String(id).indexOf('deco:') === 0) {
      const [, kind, did] = id.split(':'), dc = DECO_LIST().find((x) => x.kind === kind && x.id === did);
      if (!dc) return;
      const price = DECO_PRICE[kind][did];
      if (decoOwned(kind, did)) { uiBeep(0); shopMsg = dc.nameKo + '은(는) 이미 있어요'; }
      else if (wallet() < price) { uiBeep(0); shopMsg = '코인이 부족해요'; }
      else {
        setWallet(wallet() - price); lsSet('pk_own_deco_' + kind + '_' + did, '1');
        wearDeco(kind, did);   // worn right away
        uiBeep(1); sfx('gauge'); shopMsg = dc.nameKo + ' 구매 · 장착!';
      }
      buildShop();
      return;
    }
    if (String(id).indexOf('body:') === 0) {
      const bid = id.slice(5), b = BODIES().find((x) => x.id === bid);
      if (!b) return;
      if (bodyOwned(bid)) { uiBeep(0); shopMsg = b.nameKo + '은(는) 이미 있어요'; }
      else if (wallet() < BODY_PRICE[bid]) { uiBeep(0); shopMsg = '코인이 부족해요'; }
      else {
        setWallet(wallet() - BODY_PRICE[bid]); lsSet('pk_own_body_' + bid, '1');
        lsSet(LS_BODY, bid); applyBody(); buildSelect();   // a new cart is ridden right away
        uiBeep(1); sfx('gauge'); shopMsg = b.nameKo + ' 구매 · 장착!';
      }
      buildShop();
      return;
    }
    if (String(id).indexOf('char:') === 0) {
      const ch = CHAR_SHOP.find((c) => 'char:' + c.def === id), d = ch && PK.Karts.DEFS[ch.def];
      if (!ch || !d) return;
      if (charOwned(ch)) { uiBeep(0); shopMsg = d.nameKo + '은(는) 이미 있어요'; }
      else if (wallet() < ch.price) { uiBeep(0); shopMsg = '코인이 부족해요'; }
      else {
        setWallet(wallet() - ch.price); lsSet(ch.key, '1'); uiBeep(1); sfx('gauge'); shopMsg = d.nameKo + ' 캐릭터 획득!';
        if (CHAR_SHOP.filter(charOwned).length >= 3) achGrant('collector');
      }
      buildShop();
      return;
    }
    const it = ITEMS()[id];
    if (!it) return;
    if (buyItem(id)) { uiBeep(1); shopMsg = it.nameKo + ' 구매!'; }
    else { uiBeep(0); shopMsg = '코인이 부족해요'; }
    buildShop();
  }
  function shopEquip(id) {
    if (String(id).indexOf('deco:') === 0) {
      const [, kind, did] = id.split(':'), dc = DECO_LIST().find((x) => x.kind === kind && x.id === did);
      if (!dc || !decoOwned(kind, did)) { uiBeep(0); shopMsg = '먼저 구매하세요'; }
      else if (decoWorn()[kind] === did) { wearDeco(kind, 'none'); uiBeep(0); shopMsg = dc.nameKo + ' 해제'; }
      else { wearDeco(kind, did); uiBeep(1); shopMsg = dc.nameKo + ' 장착'; }
      buildShop();
      return;
    }
    if (String(id).indexOf('body:') === 0) {
      const bid = id.slice(5), b = BODIES().find((x) => x.id === bid);
      if (!b || !bodyOwned(bid)) { uiBeep(0); shopMsg = '먼저 구매하세요'; }
      else { lsSet(LS_BODY, bid); applyBody(); buildSelect(); uiBeep(1); shopMsg = b.nameKo + ' 장착'; }
      buildShop();
      return;
    }
    if (String(id).indexOf('char:') === 0) { uiBeep(0); shopMsg = '캐릭터는 카트 선택에서 골라요'; buildShop(); return; }
    if (owned(id) <= 0) { uiBeep(0); shopMsg = '먼저 구매하세요'; }
    else if (equipped() === id) { setEquip(''); uiBeep(0); shopMsg = '장착 해제'; }
    else { setEquip(id); uiBeep(1); shopMsg = ITEMS()[id].nameKo + ' 장착'; }
    buildShop();
  }
  const shopId = () => { const c = shopCards[shopSel]; return c && c.dataset ? c.dataset.sid || '' : ''; };

  // ---------------------------------------------------------------------------
  // character test (title, K): any character on any map right away + unlock / coin cheats
  // ---------------------------------------------------------------------------
  let testMode = false, testKart = 0, testMap = 0, testSel = 0, testBtns = [];
  function goTest() {
    G.state = 'ctest'; G.attract = true; testMode = false;
    showOnly('ctest');
    buildTest();
    if (SECRET_MAPS.indexOf(raceMap) >= 0 || raceMap !== baseMap) setupRace(randomKart(), true, baseMap);
  }
  function buildTest() {
    const box = el.ctList, mb = el.ctMaps, defs = PK.Karts.DEFS, SD = PK.Skills.DEFS || {};
    if (!box || !mb) return;
    box.innerHTML = ''; mb.innerHTML = '';
    testBtns = [];
    const pl = playable();
    defs.forEach((d, i) => {
      const b = mk('button', 'btn alt tchar' + (i === testKart ? ' sel' : ''));
      let spr = null;
      try { spr = PK.Karts.sprite(i, true); } catch (e) { spr = null; }
      const cv = copyCanvas(spr, d.color, 16, 12); cv.className = 'kspr';
      b.appendChild(cv);
      const nm = mk('b', null, d.nameKo); nm.style.color = d.color;
      b.appendChild(nm);
      b.appendChild(mk('small', null, ((SD[d.skill] || {}).nameKo || d.skill) + (pl.indexOf(i) < 0 ? ' · 🔒' : '')));
      b.addEventListener('click', () => { ensureAudio(); testKart = i; uiBeep(0); buildTest(); });
      box.appendChild(b);
      testBtns.push(b);
    });
    MAPS().forEach((m, i) => {
      const b = mk('button', 'btn alt tmap' + (i === testMap ? ' sel' : ''), (m.secret || SECRET_MAPS.indexOf(m.id) >= 0 ? '★ ' : (i + 1) + '. ') + m.nameKo);
      b.addEventListener('click', () => { ensureAudio(); testMap = i; uiBeep(0); buildTest(); });
      mb.appendChild(b);
    });
    if (el.ctInfo) el.ctInfo.textContent = '🍎 코인 ' + wallet() + ' · 👻 유령 ' + (ghostOwned() ? '해금' : '잠김') + ' · 🌀 글리치 ' + (glitchOwned() ? '해금' : '잠김');
    if (el.ctGhost) el.ctGhost.textContent = ghostOwned() ? '👻 유령 잠그기' : '👻 유령 해금';
    if (el.ctGlitch) el.ctGlitch.textContent = glitchOwned() ? '🌀 글리치 잠그기' : '🌀 글리치 해금';
  }
  function testStart() { uiBeep(1); testFrom = 'ctest'; startRace(testKart, testMap, false, true); }
  // map test (title, T): every map incl. the secret ones, picked map always loads, current kart
  let testFrom = 'ctest';
  function goMapTest() {
    G.state = 'mtest'; G.attract = true; testMode = false;
    showOnly('mtest');
    const list = el.mtList;
    if (list) {
      list.innerHTML = '';
      MAPS().forEach((m, i) => {
        const b = mk('button', 'btn mbtn' + (m.secret || SECRET_MAPS.indexOf(m.id) >= 0 ? ' secret' : ''));
        b.appendChild(mk('b', null, (SECRET_MAPS.indexOf(m.id) >= 0 || m.secret ? '★ ' : (i + 1) + '. ') + m.nameKo));
        b.appendChild(mk('small', null, m.desc || ''));
        const bt = loadBest(m.id);
        b.appendChild(mk('i', null, bt.total > 0 ? fmt(bt.total) : '--:--.--'));
        b.addEventListener('click', () => { ensureAudio(); uiBeep(1); testFrom = 'mtest'; startRace(selIdx, m.id, false, true); });
        list.appendChild(b);
      });
    }
    if (SECRET_MAPS.indexOf(raceMap) >= 0 || raceMap !== baseMap) setupRace(randomKart(), true, baseMap);
  }
  const testBack = () => (testFrom === 'mtest' ? goMapTest() : goTest());
  function testToggle(key) { lsSet(key, lsGet(key) === '1' ? '0' : '1'); uiBeep(1); buildTest(); }
  function testCoins() { setWallet(wallet() + 10); uiBeep(1); buildTest(); }

  // music (js/music.js, optional): calm loop on menus, map track in races.
  // musicWant = track that should be playing (null = silence); started once the AudioContext exists
  const M = () => PK.Music;
  let musicWant = null, musicCur = null, musicInit = false;
  function musicSync() {
    const m = M();
    if (!m || !ac || !musicInit || musicWant === musicCur) return;
    try {
      if (musicWant === null) { if (m.stop) m.stop(); }
      else { if (m.play) m.play(musicWant); if (m.setLastLap) m.setLastLap(false); }
    } catch (e) { /* ignore */ }
    musicCur = musicWant;
  }
  function musicPlay(id) { musicWant = id; musicSync(); }
  function musicStop() { musicWant = null; musicSync(); }
  function musicLastLap() { const m = M(); if (m && musicInit && m.setLastLap) { try { m.setLastLap(true); } catch (e) { /* ignore */ } } }

  // kart select: one button cycles through owned items (+ none)
  function itemLabel(id) { return id ? ITEMS()[id].nameKo + ' ×' + owned(id) : '없음'; }
  function refreshItemBtn() { if (el.btnItem) el.btnItem.textContent = '🎒 아이템: ' + itemLabel(equipped()); }
  function cycleItem() {
    const ids = (PK.Skills.ITEM_IDS || []).filter((id) => owned(id) > 0);
    const list = [''].concat(ids), cur = list.indexOf(equipped());
    setEquip(list[(cur + 1) % list.length]);
    refreshItemBtn();
    uiBeep(0);
  }

  // ---------------------------------------------------------------------------
  // races
  // ---------------------------------------------------------------------------
  // start a race on mapId; roll = do the 10% ghost-map roll (new races, not R retries)
  // test = character-test race: any kart (locked too) on any map, no ghost roll/records/unlocks
  function startRace(defIdx, mapId, roll, test) {
    testMode = !!test;
    if (testMode) roll = false;
    if (!testMode && playable().indexOf(defIdx) < 0) defIdx = NORMAL_KARTS[0];
    if (!(defIdx >= 0 && defIdx < PK.Karts.DEFS.length)) defIdx = NORMAL_KARTS[0];
    if (!MAPS()[mapId]) mapId = baseMap;
    ghostReward = '';
    playerDef = defIdx;
    if (!testMode) { selIdx = defIdx; lsSet(LS_KART, String(defIdx)); }
    if (!testMode && REGULAR.indexOf(mapId) >= 0) { baseMap = mapId; lsSet(LS_MAP, String(mapId)); }
    let surprise = false;
    if (ghostMode || gp) roll = false;
    if (roll && SECRET_MAPS.indexOf(mapId) < 0) {
      // 1% glitch world first (only once map.js has it), then the 10% ghost map
      if (hasGlitchMap() && Math.random() < GLITCH_CHANCE) { mapId = GLITCH_MAP; surprise = true; }
      else if (Math.random() < GHOST_CHANCE) { mapId = GHOST_MAP; surprise = true; }
    }
    // this race's item: the equipped one, if any are left (spent only when used)
    raceItem = equipped(); itemUsed = false; itemPrev = true;
    if (el.tbItem) el.tbItem.classList.remove('used');
    foodRace = 0; coinsBanked = false; saleAt = -1; saleDone = false;
    rsFrom = -1;
    rstatReset();
    G.state = 'countdown';
    showOnly('race');
    setupRace(defIdx, false, mapId);
    cdT = surprise ? 4.4 : 3; lastCd = 4; goT = 0;
    surpriseT = surprise ? 1.4 : 0;
    showMapBanner(mapId, surprise);
    tutStart();
    if (musicCur === mapId) musicCur = null;   // restart the track on retry
    musicPlay(mapId);
    if (surprise) sfx(mapId === GLITCH_MAP ? 'glitch' : 'spooky');
  }
  // spend the race's item (C key / touch button, or automatically at GO for auto items)
  function useRaceItem() {
    if (!raceItem || itemUsed || G.attract || G.state !== 'race') return false;
    const p = G.player;
    if (!PK.Skills.useItem(p, raceItem, G)) return false;
    itemUsed = true;
    const o = inv(); o[raceItem] = Math.max(0, (o[raceItem] | 0) - 1); setInv(o);
    toast(ITEM_EN[raceItem] || 'ITEM!');
    if (el.tbItem) el.tbItem.classList.add('used');
    return true;
  }
  // C / touch '아이템': an item-box item (or one still rolling) goes first, else the shop item
  function pressItem() {
    const p = G.player;
    if (p && !G.online && (p.boxItem || p.boxRoll > 0)) { useBoxItem(); return; }
    useRaceItem();
  }
  function useBoxItem() {
    const p = G.player;
    if (!p || G.attract || G.state !== 'race' || !PK.Skills.useBox) return false;
    return PK.Skills.useBox(p, G);
  }
  // item-box hooks (js/skills.js)
  G.onBox = (k) => { if (!G.attract && k.isPlayer) G.dbg.boxGot++; };
  G.onBoxUse = (k, id) => {
    if (G.attract) return;
    if (k.isPlayer) { G.dbg.boxUsed++; const B = PK.Skills.BOX && PK.Skills.BOX[id]; toast(B ? B.en : 'ITEM!'); }
    else G.dbg.boxUsedAI++;
  };
  G.onMissileHit = (victim, owner, ok) => {
    if (G.attract) return;
    G.dbg.missileHits++;
    if (!ok) { if (victim.isPlayer) toast('BLOCKED!'); return; }
    if (victim.isPlayer) toast('BASKET HIT!');
    else if (owner && owner.isPlayer) toast('DIRECT HIT!');
  };
  const ITEM_EN = { rocket: 'ROCKET START!', turbo: 'TURBO!', magnet: 'FOOD MAGNET!', banana: 'BANANA BOMB!', shield: 'SHIELD!', cloak: 'CLOAK!' };
  // ---- 음식 도감: { foodIndex: times eaten }. A new food pays DEX_NEW coins, the full set DEX_ALL.
  const LS_DEX = 'pk_dex', DEX_N = 16, DEX_NEW = 2, DEX_ALL = 30;
  function dex() { try { const o = JSON.parse(lsGet(LS_DEX) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  const dexCount = (d) => Object.keys(d).filter((k) => d[k] > 0).length;
  function dexRecord(kind) {
    if (!(kind >= 0 && kind < DEX_N)) return;
    const d = dex(), isNew = !(d[kind] > 0);
    d[kind] = (d[kind] | 0) + 1;
    lsSet(LS_DEX, JSON.stringify(d));
    if (!isNew) return;
    const n = dexCount(d), name = (PK.Skills.foodName && PK.Skills.foodName(kind)) || '';
    let reward = DEX_NEW;
    if (n >= DEX_N && lsGet('pk_dex_done') !== '1') { reward += DEX_ALL; lsSet('pk_dex_done', '1'); setTimeout(() => achGrant('dex_done'), 2500); }
    setWallet(wallet() + reward);
    const b = el.mapBanner;
    if (b) {
      b.innerHTML = '';
      b.appendChild(mk('b', null, n >= DEX_N ? '📖 음식 도감 완성!' : '📖 새 음식 발견! ' + name + ' (' + n + '/' + DEX_N + ')'));
      b.appendChild(mk('small', null, '🍎 +' + reward + ' 코인' + (n >= DEX_N ? ' · 16가지 음식을 전부 모았어요!' : '')));
      b.className = 'on' + (n >= DEX_N ? ' surprise' : '');
      mapBannerT = n >= DEX_N ? 4 : 2.2;
    }
    sfx('gauge');
  }

  // ---- 업적 / 칭호: one-time achievements pay coins and unlock a title to show on the title screen
  const LS_ACH = 'pk_ach', LS_TITLE = 'pk_title', LS_STATS = 'pk_stats';
  const ACH = [
    { id: 'first_race', name: '첫 완주', desc: '레이스를 처음으로 완주하기', coins: 5, title: '🛒 초보 드라이버' },
    { id: 'first_win', name: '첫 우승', desc: '1등으로 완주하기', coins: 10, title: '🏆 우승자' },
    { id: 'all_maps', name: '마트 정복', desc: '일반 맵을 전부 1등으로 완주하기', coins: 30, title: '👑 마트 정복자' },
    { id: 'ghost_win', name: '유령 사냥', desc: '유령 묘지 서킷에서 1등 하기', coins: 20, title: '👻 유령 사냥꾼' },
    { id: 'glitch_win', name: '글리치 정복', desc: '글리치 월드에서 1등 하기', coins: 30, title: '🌀 글리치 정복자' },
    { id: 'maze', name: '미로 탈출', desc: '미로 정원 완주하기', coins: 10, title: '🌿 길찾기 달인' },
    { id: 'full_cart', name: '장바구니 가득', desc: '한 판에 음식 10개 먹기', coins: 5, title: '🍎 먹보' },
    { id: 'combo5', name: '드리프트 장인', desc: '드리프트 콤보 X5 달성하기', coins: 10, title: '🔥 드리프트 장인' },
    { id: 'dex_done', name: '미식가', desc: '음식 도감 16개 완성하기', coins: 20, title: '📖 미식가' },
    { id: 'rich', name: '부자', desc: '코인 100개 모으기', coins: 10, title: '💰 부자' },
    { id: 'collector', name: '수집가', desc: '캐릭터 3명 사기', coins: 15, title: '🧸 수집가' },
    { id: 'veteran', name: '베테랑', desc: '레이스 10판 완주하기', coins: 15, title: '🎖 베테랑' },
  ];
  function achDone() { try { const o = JSON.parse(lsGet(LS_ACH) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function stats() { try { const o = JSON.parse(lsGet(LS_STATS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  const setStats = (o) => lsSet(LS_STATS, JSON.stringify(o));
  let achQueue = [], achBusy = false;
  function achGrant(id) {
    const a = ACH.find((x) => x.id === id), done = achDone();
    if (!a || done[id]) return false;
    done[id] = Date.now();
    lsSet(LS_ACH, JSON.stringify(done));
    setWallet(wallet() + a.coins);
    if (!lsGet(LS_TITLE)) lsSet(LS_TITLE, id);   // the first title is worn right away
    achQueue.push(a);
    achShowNext();
    return true;
  }
  // one banner at a time (they may come in bursts at the finish line)
  function achShowNext() {
    if (achBusy || !achQueue.length) return;
    const a = achQueue.shift(), b = el.mapBanner;
    achBusy = true;
    if (b) {
      b.innerHTML = '';
      b.appendChild(mk('b', null, a.head || '🏅 업적 달성! ' + a.name));
      b.appendChild(mk('small', null, a.sub || a.desc + ' · 🍎 +' + a.coins + ' · 칭호 「' + a.title + '」'));
      b.className = 'on surprise';
      mapBannerT = 2.6;
    }
    sfx('gauge');
    setTimeout(() => { achBusy = false; achShowNext(); }, 2700);
  }
  // race finished (not test races, not the F debug finish)
  function achOnFinish(p) {
    const place = computeStandings().indexOf(p) + 1, st = stats();
    st.races = (st.races | 0) + 1;
    st.wins = Array.isArray(st.wins) ? st.wins : [];
    if (place === 1 && st.wins.indexOf(raceMap) < 0) st.wins.push(raceMap);
    setStats(st);
    achGrant('first_race');
    if (place === 1) achGrant('first_win');
    if (REGULAR.every((m) => st.wins.indexOf(m) >= 0)) achGrant('all_maps');
    if (place === 1 && raceMap === GHOST_MAP) achGrant('ghost_win');
    if (place === 1 && raceMap === GLITCH_MAP) achGrant('glitch_win');
    if (PK.Track.def && (PK.Track.def.noMinimap || PK.Track.def.maze)) achGrant('maze');
    if (st.races >= 10) achGrant('veteran');
  }
  function achTick() {   // cheap checks, about once a second
    if (G.state === 'race' && G.player && (G.player.combo || 0) >= 5) achGrant('combo5');
    if (wallet() >= 100) achGrant('rich');
  }
  const titleOf = () => { const id = lsGet(LS_TITLE); const a = ACH.find((x) => x.id === id); return a && achDone()[id] ? a.title : ''; };
  function refreshTitle() { if (el.playerTitle) el.playerTitle.textContent = titleOf() ? '칭호 「' + titleOf() + '」' : ''; }

  // ---- 🏆 랭킹: per-map top 10 (worldwide via Firebase when js/rank-config.js is set)
  let rankMap = 0, rankReq = 0;
  function goRank() {
    G.state = 'rank'; G.attract = true;
    showOnly('rank');
    rankMap = Math.max(0, Math.min(MAPS().length - 1, baseMap | 0));   // the last regular map raced
    if (el.rankNick && PK.Rank) el.rankNick.value = PK.Rank.nick();
    buildRank();
  }
  // one combined board: every map's records in a single table (map name on each row), fastest first
  async function buildRank() {
    const tabs = el.rankTabs, list = el.rankList;
    if (tabs) tabs.innerHTML = '';
    if (!list || !PK.Rank) return;
    list.innerHTML = '<div class="rmsg">불러오는 중…</div>';
    const ms = MAPS(), req = ++rankReq;
    const res = PK.Rank.topAll ? await PK.Rank.topAll(ms.map((m) => m.id)) : await PK.Rank.top(rankMap);
    if (req !== rankReq) return;   // a newer tab was picked meanwhile
    if (el.rankInfo) el.rankInfo.textContent = (res.online ? '🌏 전 세계 랭킹' : (PK.Rank.configured ? '⚠ 온라인 연결 실패 · 이 기기 기록' : '📱 이 기기 기록 (온라인 랭킹 설정 전)')) + ' · 내 이름 ' + PK.Rank.nick();
    list.innerHTML = '';
    if (!res.list.length) { list.appendChild(mk('div', 'rmsg', '아직 기록이 없어요. 첫 기록을 세워 보세요!')); return; }
    res.list.forEach((e, i) => {
      const r = mk('div', 'rrow' + (e.me ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''));
      r.appendChild(mk('b', null, ['🥇', '🥈', '🥉'][i] || (i + 1) + '.'));
      r.appendChild(mk('span', 'rname', e.name));
      const m = ms.find((x) => x.id === e.map);
      r.appendChild(mk('span', 'rmap', m ? (m.secret ? '★ ' : '') + m.nameKo : ''));
      r.appendChild(mk('span', 'rkart', (PK.Karts.DEFS[e.kart] || {}).nameKo || ''));
      r.appendChild(mk('span', 'rtime', fmt(e.time)));
      list.appendChild(r);
    });
  }

  function goAch() {
    G.state = 'ach'; G.attract = true;
    showOnly('ach');
    buildAch();
  }
  function buildAch() {
    const list = el.achList, done = achDone(), cur = lsGet(LS_TITLE);
    if (el.achInfo) el.achInfo.textContent = '달성 ' + ACH.filter((a) => done[a.id]).length + ' / ' + ACH.length + (titleOf() ? '  ·  지금 칭호 「' + titleOf() + '」' : '');
    if (!list) return;
    list.innerHTML = '';
    ACH.forEach((a) => {
      const ok = !!done[a.id], c = mk('div', 'acard' + (ok ? ' ok' : '') + (ok && cur === a.id ? ' on' : ''));
      c.appendChild(mk('b', null, (ok ? '✅ ' : '🔒 ') + a.name));
      c.appendChild(mk('div', 'adesc', a.desc));
      c.appendChild(mk('small', null, '🍎 +' + a.coins + ' · 칭호 「' + a.title + '」'));
      if (ok) {
        const bt = mk('button', 'btn ibtn' + (cur === a.id ? ' off' : ''), cur === a.id ? '장착 중' : '칭호 달기');
        bt.addEventListener('click', () => { ensureAudio(); uiBeep(1); lsSet(LS_TITLE, a.id); refreshTitle(); buildAch(); });
        c.appendChild(bt);
      }
      list.appendChild(c);
    });
  }

  function goDex() {
    G.state = 'dex'; G.attract = true;
    showOnly('dex');
    buildDex();
  }
  function buildDex() {
    const list = el.dexList, d = dex(), n = dexCount(d);
    if (el.dexInfo) el.dexInfo.innerHTML = (n >= DEX_N ? '<span class="full">✓ 완성! </span>' : '') + '모은 음식 ' + n + ' / ' + DEX_N;
    if (!list) return;
    list.innerHTML = '';
    for (let i = 0; i < DEX_N; i++) {
      const have = d[i] > 0, c = mk('div', 'dcard' + (have ? '' : ' no'));
      const src = PK.Skills.foodIcon && PK.Skills.foodIcon(i);
      const cv = copyCanvas(src, '#444', 32, 32);
      if (!have) {   // unknown foods show as a dark silhouette (no pixel reads, works on file://)
        const g = cv.getContext('2d');
        g.globalCompositeOperation = 'source-in'; g.fillStyle = '#0d0a14'; g.fillRect(0, 0, cv.width, cv.height);
      }
      c.appendChild(cv);
      c.appendChild(mk('b', null, have ? PK.Skills.foodName(i) : '???'));
      c.appendChild(mk('small', null, have ? d[i] + '번 먹음' : '미발견'));
      list.appendChild(c);
    }
  }

  // player ate a food: +1 coin up to FOOD_CAP per race; also fills the 음식 도감
  function onFood(k, kind) {
    if (G.attract || !k.isPlayer || G.state !== 'race') return;
    dexRecord(kind);
    if (foodRace < FOOD_CAP) {
      foodRace++;
      toast(foodRace >= FOOD_CAP ? 'FOOD ' + FOOD_CAP + '/' + FOOD_CAP + ' MAX!' : '+1 FOOD ' + foodRace + '/' + FOOD_CAP);
      if (foodRace >= FOOD_CAP && !testMode) achGrant('full_cart');
    } else toast('FOOD FULL ' + FOOD_CAP + '/' + FOOD_CAP);
  }
  // slipstream (karts.js): charged / released
  function onSlip(k, go) { if (!G.attract && k.isPlayer) { toast(go ? 'SLIPSTREAM GO!' : 'SLIPSTREAM'); if (go) sfx('pad'); } }
  G.onSlip = onSlip;

  // time sale: once per race, a few seconds into lap 2 — 10 s of instant food respawns + an extra row
  const SALE_T = 10;
  let saleAt = -1, saleDone = false;
  function updateSale() {
    const p = G.player;
    if (saleDone || !p || G.attract) return;
    if (saleAt < 0) { if ((p.lap || 0) >= 2) saleAt = G.raceTime + 2 + Math.random() * 8; return; }
    if (G.raceTime < saleAt) return;
    saleDone = true;
    if (PK.Skills.startSale) PK.Skills.startSale(SALE_T);
    const b = el.mapBanner;
    if (b) {
      b.innerHTML = '';
      b.appendChild(mk('b', null, '🛒 타임 세일!'));
      b.appendChild(mk('small', null, '10초 동안 음식이 마구 쏟아져요 (코인은 레이스당 10개까지)'));
      b.className = 'on sale';
      mapBannerT = 2.6;
    }
    sfx('sale');
  }

  function bankCoins() {
    if (coinsBanked || G.attract) return;
    coinsBanked = true;
    setWallet(wallet() + foodRace);
  }
  function retryRace() { if (G.online) return; startRace(playerDef, raceMap, false, testMode); }
  function nextRace() {
    if (G.online) { if (PK.Net) PK.Net.toLobby(); return; }   // online 2P: back to the room lobby
    if (testMode) { testBack(); return; }
    if (gp) { gpNext(); return; }
    startRace(playerDef, REGULAR[(REGULAR.indexOf(baseMap) + 1) % REGULAR.length], true);
  }

  // gas held during the countdown (keys, touch gas, or the virtual joystick pushed anywhere but down)
  function cdGas() {
    const J = PK.Joy;
    return !!(keys.ArrowUp || keys.KeyW || touch.gas || (J && J.active && (+J.y || 0) < 0.45));
  }
  function rocketStart() {
    const p = G.player;
    let res = 'normal';
    if (p && rsFrom >= 0) res = rsFrom <= RS_WIN ? 'good' : rsFrom > RS_EARLY ? 'early' : 'normal';
    if (p && res === 'good') {
      p.boostT = Math.max(p.boostT || 0, RS_BOOST); p.v = Math.max(p.v || 0, 45);
      toast('ROCKET START!'); sfx('boost'); speedBurst = 0.5; boostKick(0.35);
      pfx('rocket', p.x, p.y, 0, p.a);
    } else if (p && res === 'early') {
      p._stallT = RS_STALL; toast('TOO EARLY!'); sfx('stall');
      pfx('stall', p.x, p.y, 0, p.a);
    }
    G.dbg.rocket = res;
    G.dbg.rocketAI = 0;
    for (let i = 0; i < G.karts.length; i++) {
      const k = G.karts[i];
      if (k === p || k.remote) continue;
      if (Math.random() < RS_AI_GOOD) { k.boostT = Math.max(k.boostT || 0, RS_AI_BOOST); k.v = Math.max(k.v || 0, 35); G.dbg.rocketAI++; }
    }
    rsFrom = -1;
  }
  // overtakes: the player's place (stable for POS_HOLD s) went up / down
  function trackPos(dt) {
    const p = G.player;
    if (!p || p.finished || G.attract) return;
    const pos = computeStandings().indexOf(p);
    if (posShown < 0) { posShown = pos; posCand = pos; return; }
    if (pos !== posCand) { posCand = pos; posCandT = 0; } else posCandT += dt;
    if (pos === posShown || posCandT < POS_HOLD) return;
    if (pos < posShown) {
      posPulse = POS_PULSE; posFlash = 0; G.dbg.overtakes++;
      if (ovtCool <= 0) { showOvertake(pos); sfx('pass'); ovtCool = 0.7; }
    } else { posFlash = POS_FLASH; posPulse = 0; G.dbg.overtaken++; }
    posShown = pos;
  }
  function showOvertake(pos) {
    const e = el.ovt;
    if (!e) return;
    e.textContent = '추월! ' + (pos + 1) + '등';
    e.className = '';
    void e.offsetWidth;   // restart the CSS pop animation
    e.className = 'on' + (pos === 0 ? ' top' : '');
    ovtT = 0.9;
  }
  function hideOvertake() { ovtT = 0; if (el.ovt) el.ovt.className = ''; }

  // ---------------------------------------------------------------------------
  // world particles (pooled, no allocation): sparkles, confetti bursts, smoke puffs
  // ---------------------------------------------------------------------------
  const PN = 220, parts = [];
  for (let i = 0; i < PN; i++) parts.push({ on: false, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, life: 1, col: '#fff', sz: 0.5, g: 60 });
  let pHead = 0;
  const CONF_COLS = ['#ff4f9a', '#ffb020', '#3fc8ff', '#6ee05a', '#ffe14d', '#b070ff', '#ffffff'];
  const SPARK_COLS = ['#ffffff', '#fff27a', '#ffd040', '#9fe8ff'];
  const BOOM_COLS = ['#ffffff', '#ffe060', '#ff9a20', '#ff5a20'];
  const SMOKE_COLS = ['rgba(235,235,240,0.8)', 'rgba(190,190,200,0.7)', 'rgba(150,150,160,0.6)'];
  function spawnP(x, y, h, vx, vy, vh, life, col, sz, g) {
    const q = parts[pHead]; pHead = (pHead + 1) % PN;
    q.on = true; q.x = x; q.y = y; q.h = h; q.vx = vx; q.vy = vy; q.vh = vh; q.t = 0; q.life = life; q.col = col; q.sz = sz; q.g = g;
  }
  function burst(x, y, h, n, cols, sp, up, life, sz, g) {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      const an = R() * C.TAU, v = sp * (0.4 + R() * 0.6);
      spawnP(x, y, h, Math.cos(an) * v, Math.sin(an) * v, up * (0.5 + R() * 0.7), life * (0.7 + R() * 0.5), cols[(R() * cols.length) | 0], sz * (0.7 + R() * 0.6), g);
    }
  }
  // kind: food | box | boom | fizz | rocket | stall; a = kart heading (puffs go out the back)
  function pfx(kind, x, y, h, a) {
    h = h || 0;
    switch (kind) {
      case 'food': burst(x, y, h + 1, 10, SPARK_COLS, 22, 34, 0.5, 0.45, 70); break;
      case 'box': burst(x, y, h, 20, CONF_COLS, 34, 42, 0.8, 0.55, 75); break;
      case 'boom': burst(x, y, h, 18, BOOM_COLS, 40, 30, 0.45, 0.6, 50); burst(x, y, h, 6, SMOKE_COLS, 12, 14, 0.7, 1.0, -6); break;
      case 'fizz': burst(x, y, h, 8, SMOKE_COLS, 10, 10, 0.5, 0.7, -4); break;
      case 'rocket': case 'stall': {
        const c = Math.cos(a || 0), s2 = Math.sin(a || 0), n = kind === 'rocket' ? 14 : 10;
        for (let i = 0; i < n; i++) {
          const R = Math.random, side = (R() - 0.5) * 6;
          const col = kind === 'rocket' && i < 6 ? BOOM_COLS[(R() * 4) | 0] : SMOKE_COLS[(R() * 3) | 0];
          spawnP(x - c * 3 - s2 * side, y - s2 * 3 + c * side, 0.5, -c * (20 + R() * 30) + (R() - 0.5) * 10, -s2 * (20 + R() * 30) + (R() - 0.5) * 10,
            8 + R() * 14, 0.5 + R() * 0.4, col, 0.7 + R() * 0.6, -4);
        }
        break;
      }
    }
  }
  G.pfx = pfx;
  function updateParts(dt) {
    let n = 0;
    for (let i = 0; i < PN; i++) {
      const q = parts[i];
      if (!q.on) continue;
      q.t += dt;
      if (q.t >= q.life) { q.on = false; continue; }
      n++;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vh -= q.g * dt; q.h += q.vh * dt;
      if (q.h < 0) { q.h = 0; q.vh *= -0.35; q.vx *= 0.6; q.vy *= 0.6; }
      const dr = 1 - 1.5 * dt; q.vx *= dr; q.vy *= dr;
    }
    G.dbg.parts = n;
  }
  function clearParts() { for (let i = 0; i < PN; i++) parts[i].on = false; }
  function drawParts() {
    for (let i = 0; i < PN; i++) {
      const q = parts[i];
      if (!q.on) continue;
      const dx = q.x - camX, dy = q.y - camY;
      const z = dx * pfx_ + dy * pfy_;
      if (z < 3 || z > FOG_FAR) continue;
      const sc = FOCAL / z;
      const sx = CX + (dx * prx_ + dy * pry_) * sc;
      if (sx < -4 || sx > W + 4) continue;
      const sy = HOR + CAM_H * sc - q.h * sc;
      const sz = Math.max(1, Math.min(4, Math.round(q.sz * sc)));
      const fade = 1 - q.t / q.life;
      ctx.globalAlpha = fade < 0.3 ? fade / 0.3 : 1;
      ctx.fillStyle = q.col;
      ctx.fillRect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), sz, sz);
    }
    ctx.globalAlpha = 1;
  }
  // finish confetti (screen space, ~2 s, skipped in calm mode)
  const CONF_N = 90, conf = [];
  for (let i = 0; i < CONF_N; i++) conf.push({ x: 0, y: 0, vx: 0, vy: 0, c: '#fff', w: 2, h: 1, ph: 0 });
  const CONF_T = 2.4;
  function startConfetti() {
    if (calm) return;
    const R = Math.random;
    for (let i = 0; i < CONF_N; i++) {
      const q = conf[i];
      q.x = R() * W; q.y = -R() * 110 - 4; q.vx = (R() - 0.5) * 30; q.vy = 70 + R() * 60;
      q.c = CONF_COLS[(R() * CONF_COLS.length) | 0]; q.w = R() < 0.5 ? 2 : 3; q.h = R() < 0.5 ? 1 : 2; q.ph = R() * 6.28;
    }
    confT = CONF_T; G.dbg.confetti++;
  }
  function drawConfetti() {
    if (!(confT > 0)) return;
    ctx.globalAlpha = confT < 0.5 ? confT / 0.5 : 1;
    const t = G.time;
    for (let i = 0; i < CONF_N; i++) {
      const q = conf[i];
      q.y += q.vy * DT; q.x += (q.vx + Math.sin(t * 5 + q.ph) * 18) * DT;
      if (q.y < -2 || q.y > H) continue;
      const flip = Math.sin(t * 9 + q.ph) > 0;   // tumbling: the strip turns edge-on and back
      ctx.fillStyle = q.c;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), flip ? q.w : 1, flip ? q.h : q.w);
    }
    ctx.globalAlpha = 1;
  }

  // map title banner (DOM, so Korean renders crisply) shown during the countdown
  function showMapBanner(id, surprise) {
    const b = el.mapBanner;
    if (!b) return;
    const m = mapInfo(id);
    b.innerHTML = '';
    const gl = id === GLITCH_MAP;
    if (surprise) {
      b.appendChild(mk('b', null, '?!  ' + (gl ? '글리치 월드' : m.nameKo)));
      b.appendChild(mk('small', null, gl ? '세계가 깨졌다! 모두 최고 실력… 1등하면 🌀 글리치 획득' : '비밀 맵 등장! 뱀파이어와 유령이 나타났다…'));
    } else {
      b.appendChild(mk('b', null, (gl ? '🌀 ' : m.secret ? '👻 ' : 'MAP ' + (id + 1) + ' · ') + m.nameKo));
      b.appendChild(mk('small', null, m.desc || ''));
    }
    b.className = 'on' + (id === GHOST_MAP ? ' ghost' : '') + (gl ? ' glitch' : '') + (surprise ? ' surprise' : '');
    mapBannerT = surprise ? 4.2 : 2.8;
  }
  function hideMapBanner() { mapBannerT = 0; if (el.mapBanner) el.mapBanner.className = ''; }

  // Build the 6-kart grid. Player starts in the back row. The ghost map swaps two normal AI
  // karts for the vampire and the ghost.
  function setupRace(defIdx, attract, mapId) {
    G.attract = attract;
    mapId = mapId | 0;
    if (PK.Track.current !== mapId) PK.Track.load(mapId);   // load BEFORE Skills.reset (foods use PTS)
    raceMap = mapId; G.mapId = mapId; G.ghostRace = mapId === GHOST_MAP;
    const glitch = mapId === GLITCH_MAP;
    G.hard = glitch && !attract;
    best = loadBest(mapId);
    PK.Skills.reset();
    const T = PK.Track, N = T.N, nDefs = PK.Karts.DEFS.length;
    let order = shuffle(NORMAL_KARTS.filter((i) => i !== defIdx && i < nDefs));
    if (G.ghostRace) order = shuffle(order.slice(0, 3).concat(GHOST_KARTS.filter((i) => i < nDefs && i !== defIdx)));
    // glitch world: one glitch rival joins (unless the player drives it)
    if (glitch && GLITCH_KART < nDefs && defIdx !== GLITCH_KART) order = shuffle(order.slice(0, 4).concat([GLITCH_KART]));
    if (order.length > 5) order.length = 5;
    if (ghostMode && !attract) order = [];   // 👻 ghost mode: just you (and your ghost)
    if (gp && !attract) { if (!gp.roster) gp.roster = order.slice(); else order = shuffle(gp.roster.slice()); }   // 🏆 same rivals all GP
    const n = order.length + 1;
    // back row = slots n-2, n-1 (n even). Random side.
    order.splice(n - 1 - (Math.random() < 0.5 ? 1 : 0), 0, defIdx);
    const karts = [];
    let ai = 0;
    for (let s = 0; s < n; s++) {
      const r = s >> 1, lat = (s & 1) ? 10 : -10;
      const gi = (((N - 4 - r * 3) % N) + N) % N;
      const di = order[s], isP = di === defIdx;
      const k = PK.Karts.create(di, gi, lat, isP);
      if (!isP && k.ai) {
        k.ai.skill = 0.86 + 0.10 * (n > 2 ? ai / (n - 2) : 0); ai++;
        if (GHOST_KARTS.indexOf(di) >= 0) k.ai.skill = 0.95;   // the final bosses drive well
        if (glitch) k.ai.skill = 1.0 + 0.02 * Math.random();   // HARD: everyone at top skill
      }
      // AI karts are AI_SPEED× faster than the player (their own copy of the def, so the player's stays as is)
      if (!isP) k.def = Object.assign({}, k.def, { maxV: k.def.maxV * AI_SPEED, acc: k.def.acc * AI_SPEED });
      if (!k.lapTimes) k.lapTimes = [];
      if (k.maxLap == null) k.maxLap = 0;
      k._mLap = 0;  // main's own lap counter for onLap (robust to karts.js updating maxLap)
      k.lapStart = 0; k.finished = false; k.finishTime = 0;
      karts.push(k);
      if (isP) G.player = k;
    }
    G.karts = karts;
    G.standings = karts.slice();
    G.raceTime = 0;
    ghostBegin(attract);
    attractT = 0; finT = 0; newRecord = false; newLapRecord = false;
    toastT = 0; bannerT = 0; shakeT = 0;
    posShown = -1; posCand = -1; posCandT = 0; posPulse = 0; posFlash = 0; ovtCool = 0; hideOvertake();
    speedBurst = 0; lastBoostT = 0; confT = 0; clearParts();
    const p = G.player;
    camA = p.a;
    camX = p.x - Math.cos(camA) * C.CAM_DIST; camY = p.y - Math.sin(camA) * C.CAM_DIST;
  }

  // ---------------------------------------------------------------------------
  // pause menu
  // ---------------------------------------------------------------------------
  function openPause() {
    if (!RACE_STATES[G.state]) return;
    if (G.online) { if (PK.Net) PK.Net.menu(); return; }   // online 2P: menu only, the race never freezes
    pauseFrom = G.state; G.state = 'paused';
    for (const k in keys) keys[k] = false;
    for (const k in touch) touch[k] = false;
    showOnly('pause');
    pauseSel = 0; refreshPauseSel();
  }
  function resumePause() {
    if (G.state !== 'paused') return;
    G.state = pauseFrom;
    showOnly('race');
    if (pauseFrom !== 'finished') { musicPlay(raceMap); if (G.player && G.player.lap >= C.LAPS) musicLastLap(); }
  }
  function autoPause() { if (RACE_STATES[G.state] && G.state !== 'finished') openPause(); }
  function refreshPauseSel() { for (let i = 0; i < pauseBtns.length; i++) pauseBtns[i].classList.toggle('sel', i === pauseSel); }
  function pauseAction(act) {
    uiBeep(act === 'resume' ? 0 : 1);
    if (act === 'calm') toggleCalm();
    if (act === 'easy') toggleEasy();
    else if (act === 'resume') resumePause();
    else if (act === 'retry') retryRace();
    else if (act === 'maps') goMaps();
    else goTitle();
  }

  // ---------------------------------------------------------------------------
  // contract callbacks
  // ---------------------------------------------------------------------------
  function onLap(k) {
    if (G.attract || (G.state !== 'race' && G.state !== 'finished')) return;
    if (k.lap <= (k._mLap || 0)) return;
    k._mLap = k.lap;
    if (k.lap > (k.maxLap || 0)) k.maxLap = k.lap;
    if (k.finished) return;
    if (!k.lapTimes) k.lapTimes = [];
    if (k.lap >= 2) k.lapTimes.push(G.raceTime - (k.lapStart || 0));
    k.lapStart = G.raceTime;
    if (k.lap > C.LAPS) {
      k.finished = true; k.finishTime = G.raceTime;
      if (k.isPlayer) playerFinish(k);
    } else if (k.isPlayer && k.lap >= 2) {
      banner(k.lap === C.LAPS ? 'FINAL LAP!' : 'LAP ' + k.lap, k.lap === C.LAPS ? '#ff8800' : '#ffcc00');
      sfx('lap');
      if (k.lap === C.LAPS) musicLastLap();
    }
  }

  function playerFinish(k) {
    G.state = 'finished'; finT = 0;
    sfx('finish');
    startConfetti(); hideOvertake();
    banner('FINISH!', '#ffffff');
    const bl = k.lapTimes.length ? Math.min.apply(null, k.lapTimes) : 0;
    if (!(best.total > 0) || k.finishTime < best.total) { best.total = k.finishTime; newRecord = true; }
    if (bl > 0 && (!(best.lap > 0) || bl < best.lap)) { best.lap = bl; newLapRecord = true; }
    if (testMode) { newRecord = false; newLapRecord = false; }
    if (newRecord || newLapRecord) lsSet(bestKey(raceMap), JSON.stringify(best));
    const ghOld = ghRun ? ghRun.t : 0;
    if (ghostSave(k)) G.dbg.ghostSaved = (G.dbg.ghostSaved || 0) + 1;
    if (ghostMode && !testMode && !G.online) ghostResult(k, ghOld);
    bankCoins();
    if (!testMode && !ghostMode) rollGhostReward(k);   // solo ghost races: no unlock rolls / achievements
    if (!testMode && !ghostMode) achOnFinish(k);
    const place = computeStandings().indexOf(k) + 1;
    if (!testMode && !ghostMode && !G.online) dailyCheck(k, place);
    if (!testMode && PK.Rank) PK.Rank.submit(raceMap, k.finishTime, k.defIndex);   // ranking board
    musicStop();
  }

  // ghost map: finishing in the top 3 gives a 50% chance to win the ghost kart.
  // glitch map: finishing 1st always wins the glitch kart.
  function rollGhostReward(p) {
    ghostReward = '';
    if (raceMap === GLITCH_MAP) {
      if (glitchOwned() || p.defIndex === GLITCH_KART || computeStandings().indexOf(p) !== 0) return;
      ghostReward = 'glitch';
      lsSet(LS_GLITCH_KART, '1');
      const b = el.mapBanner;
      if (b) {
        b.innerHTML = '';
        b.appendChild(mk('b', null, '🌀 글리치 캐릭터 획득!'));
        b.appendChild(mk('small', null, '이제 카트 선택에서 글리치를 고를 수 있어요'));
        b.className = 'on glitch surprise';
        mapBannerT = 4;
      }
      sfx('glitch');
      return;
    }
    if (raceMap !== GHOST_MAP || ghostOwned() || p.defIndex === GHOST_KART) return;
    const place = computeStandings().indexOf(p) + 1;
    if (!(place >= 1 && place <= GHOST_REWARD_PLACE)) return;
    if (Math.random() < GHOST_REWARD_CHANCE) {
      ghostReward = 'got';
      lsSet(LS_GHOST_KART, '1');   // its card shows on the next kart select
      showRewardBanner(true);
      sfx('gauge');
    } else {
      ghostReward = 'miss';
      showRewardBanner(false);
    }
  }
  function showRewardBanner(got) {
    const b = el.mapBanner;
    if (!b) return;
    b.innerHTML = '';
    b.appendChild(mk('b', null, got ? '👻 유령 캐릭터 획득!' : '👻 아쉽다… 유령이 도망갔다'));
    b.appendChild(mk('small', null, got ? '이제 카트 선택에서 유령을 고를 수 있어요' : '3등 안에 들면 50% 확률로 유령을 얻을 수 있어요'));
    b.className = 'on ghost' + (got ? ' surprise' : '');
    mapBannerT = 4;
  }

  // debug: finish the race on the spot, keeping the current place (no best-time save)
  function debugFinish() {
    const p = G.player, stand = computeStandings(), pos = stand.indexOf(p);
    for (let i = 0; i < pos; i++) { const k = stand[i]; if (!k.finished) { k.finished = true; k.finishTime = G.raceTime - (pos - i) * 0.5; } }
    p.finished = true; p.finishTime = G.raceTime;
    G.state = 'finished'; finT = 0; newRecord = false; newLapRecord = false;
    sfx('finish');
    startConfetti(); hideOvertake();
    banner('FINISH!', '#ffffff');
    bankCoins();
    if (!testMode) rollGhostReward(p);
    musicStop();
  }

  function toast(text) { toastText = String(text).toUpperCase(); toastT = 1.5; }
  function banner(text, col) { bannerText = text; bannerT = 1.6; bannerCol = col || '#ffcc00'; }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------
  const PIN = { steer: 0, left: false, right: false, gas: false, brake: false, drift: false, boost: false, skill: false };
  function playerInput() {
    const J = PK.Joy;
    if (J && J.active) {
      // virtual joystick (js/joystick.js): analog steer; anything but pulling down accelerates.
      // Its arrow-key events are ignored here so they don't double up.
      const jx = U.clamp(+J.x || 0, -1, 1), jy = U.clamp(+J.y || 0, -1, 1);
      PIN.steer = jx; PIN.left = jx < -0.3; PIN.right = jx > 0.3;
      PIN.brake = jy > 0.45 || !!(keys.KeyS || touch.brake);
      PIN.gas = !PIN.brake && (jy < 0.45 || Math.abs(jx) > 0.25) || !!(keys.KeyW || touch.gas);
    } else {
      const L = !!(keys.ArrowLeft || keys.KeyA || touch.left), R = !!(keys.ArrowRight || keys.KeyD || touch.right);
      PIN.left = L; PIN.right = R; PIN.steer = (R ? 1 : 0) - (L ? 1 : 0);
      PIN.gas = !!(keys.ArrowUp || keys.KeyW || touch.gas);
      PIN.brake = !!(keys.ArrowDown || keys.KeyS || touch.brake);
    }
    PIN.drift = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.drift);
    PIN.boost = !!(keys.KeyZ || touch.boost);
    PIN.skill = !!(keys.KeyX || touch.skill);
    if (easy) easyAssist(PIN);
    lastGas = !!PIN.gas;
    return PIN;
  }

  // easy controls: a light steering help toward the racing line and auto drift in corners, only while
  // the player is driving (gas held). Nothing moves by itself: no auto gas, no steering when idle.
  function easyAssist(inp) {
    const p = G.player;
    if (!p || !PK.Karts.aiInput || !inp.gas) return;
    let ai;
    try { ai = PK.Karts.aiInput(p, G); } catch (e) { return; }
    if (!ai) return;
    const user = +inp.steer || 0, aiS = U.clamp(+ai.steer || 0, -1, 1);
    inp.steer = Math.abs(user) < 0.05 ? aiS * 0.45 : U.clamp(user * 0.8 + aiS * 0.25, -1, 1);
    inp.left = inp.steer < -0.3; inp.right = inp.steer > 0.3;
    if (ai.drift && Math.abs(user) > 0.35) inp.drift = true;   // corners drift by themselves while turning
  }

  const isEnter = (c) => c === 'Enter' || c === 'Space' || c === 'NumpadEnter';
  const PREVENT = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1 };
  function onKeyDown(e) {
    ensureAudio();
    // typing in a text box (nickname, room code): leave the keys to the box, except Enter / Esc
    const tg = e.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA');
    if (typing && e.key !== 'Escape') return;
    const c = e.code || e.key;
    if (PREVENT[c]) e.preventDefault();
    const rep = e.repeat;
    keys[c] = true;
    if (rep) return;
    if (PK.Net && PK.Net.key && PK.Net.key(c)) return;   // online 2P lobby / race keys (js/net.js)
    if (c === 'KeyM') { toggleMute(); return; }
    const st = G.state;
    if (st === 'intro') return;   // PK.Intro handles its own keys
    if (st === 'title') {
      if (isEnter(c)) { uiBeep(1); startGame(); }
      else if (c === 'KeyL') { uiBeep(0); ghostMode = false; goMaps(); }
      else if (c === 'KeyS') { uiBeep(0); goShop(); }
      else if (c === 'KeyD') { uiBeep(0); goDex(); }
      else if (c === 'KeyH') { uiBeep(0); goAch(); }
      else if (c === 'KeyK') { uiBeep(0); goRank(); }
      else if (c === 'KeyV') toggleCalm();
      else if (c === 'KeyG') { uiBeep(0); goGhostMode(); }
      else if (c === 'KeyO') { uiBeep(0); goSettings(); }
      else if (c === 'KeyN') { uiBeep(0); goModes(); }
    } else if (st === 'rank') {
      if (c === 'Escape' || c === 'Backspace') { uiBeep(0); goTitle(); }
    } else if (st === 'modes' || st === 'settings') {
      if (c === 'Escape' || c === 'Backspace') { uiBeep(0); goTitle(); }
      else if (st === 'modes' && c === 'KeyL') { uiBeep(0); ghostMode = false; goMaps(); }
      else if (st === 'modes' && c === 'KeyG') { uiBeep(0); goGhostMode(); }
    } else if (st === 'gpfinal') {
      if (isEnter(c) || c === 'Escape') { uiBeep(1); gpFinalDone(); }
    } else if (st === 'dex' || st === 'ach') {
      if (c === 'Escape' || c === 'Backspace' || isEnter(c)) { uiBeep(0); goTitle(); }
    } else if (st === 'ctest') {
      if (isEnter(c)) testStart();
      else if (c === 'Escape' || c === 'Backspace') { uiBeep(0); goTitle(); }
    } else if (st === 'mtest') {
      if (c === 'Escape' || c === 'Backspace') { uiBeep(0); goTitle(); }
    } else if (st === 'shop') {
      const n = shopCards.length || 1, cols = 3;
      let d = 0;
      if (c === 'ArrowLeft' || c === 'KeyA') d = -1;
      else if (c === 'ArrowRight' || c === 'KeyD') d = 1;
      else if (c === 'ArrowUp' || c === 'KeyW') d = -cols;
      else if (c === 'ArrowDown' || c === 'KeyS') d = cols;
      const tn = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[c];
      if (tn !== undefined) setShopTab(SHOP_TABS[tn][0]);
      else if (c === 'KeyQ') setShopTab(SHOP_TABS[(SHOP_TABS.findIndex((x) => x[0] === shopTab) + 1) % SHOP_TABS.length][0]);
      else if (d) { shopSel = ((shopSel + d) % n + n) % n; refreshShopSel(); uiBeep(0); }
      else if (isEnter(c) && shopId()) shopBuy(shopId());
      else if ((c === 'KeyE' || c === 'KeyC') && shopId()) shopEquip(shopId());
      else if (c === 'Escape' || c === 'Backspace') { uiBeep(0); goTitle(); }
    } else if (st === 'maps') {
      const n = mapBtns.length;
      if (c === 'ArrowUp' || c === 'KeyW') { mapSel = (mapSel - 1 + n) % n; refreshMapSel(); uiBeep(0); }
      else if (c === 'ArrowDown' || c === 'KeyS') { mapSel = (mapSel + 1) % n; refreshMapSel(); uiBeep(0); }
      else if (isEnter(c)) pickMap(mapSel);
      else if (c === 'Escape') { uiBeep(0); goTitle(); }
    } else if (st === 'select') {
      const r = playable(), n = r.length;
      let d = 0;
      if (c === 'ArrowLeft' || c === 'KeyA') d = -1;
      else if (c === 'ArrowRight' || c === 'KeyD') d = 1;
      else if (c === 'ArrowUp' || c === 'KeyW') d = -3;
      else if (c === 'ArrowDown' || c === 'KeyS') d = 3;
      if (d) { const pos = Math.max(0, r.indexOf(selIdx)); selIdx = r[((pos + d) % n + n) % n]; refreshCards(); uiBeep(0); }
      else if (isEnter(c)) { uiBeep(1); startRace(selIdx, pendingMap, pendingMap !== GHOST_MAP); }
      else if (c === 'KeyC') cycleItem();
      else if (c === 'Escape') selectBack();
    } else if (st === 'countdown' || st === 'race') {
      if (c === 'KeyR') retryRace();
      else if (c === 'KeyF' && st === 'race') debugFinish();
      else if (c === 'Escape' || c === 'KeyP') { uiBeep(0); openPause(); }
    } else if (st === 'finished') {
      if (isEnter(c) && finT > 1.2) { uiBeep(1); nextRace(); }
      else if (c === 'KeyR') retryRace();
      else if (c === 'Escape' || c === 'KeyP') { uiBeep(0); openPause(); }
    } else if (st === 'paused') {
      const n = pauseBtns.length || 1;
      if (c === 'Escape' || c === 'KeyP') pauseAction('resume');
      else if (c === 'ArrowUp' || c === 'KeyW') { pauseSel = (pauseSel - 1 + n) % n; refreshPauseSel(); uiBeep(0); }
      else if (c === 'ArrowDown' || c === 'KeyS') { pauseSel = (pauseSel + 1) % n; refreshPauseSel(); uiBeep(0); }
      else if (isEnter(c) && pauseBtns[pauseSel]) pauseAction(pauseBtns[pauseSel].getAttribute('data-act'));
    }
  }
  function onKeyUp(e) { keys[e.code || e.key] = false; }
  function selectBack() { uiBeep(0); if (selectFrom === 'maps') goMaps(); else goTitle(); }

  function bindInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; autoPause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
    window.addEventListener('pointerdown', ensureAudio);
    window.addEventListener('touchstart', ensureAudio, { passive: true });
    const on = (e, f) => { if (e) e.addEventListener('click', f); };
    on(el.btnStart, () => { ensureAudio(); uiBeep(1); startGame(); });
    on(el.btnMaps, () => { ensureAudio(); uiBeep(1); ghostMode = false; goMaps(); });
    on(el.btnMapsBack, () => { uiBeep(0); goTitle(); });
    on(el.btnShop, () => { ensureAudio(); uiBeep(1); goShop(); });
    on(el.btnShopBack, () => { uiBeep(0); goTitle(); });
    on(el.btnDex, () => { ensureAudio(); uiBeep(1); goDex(); });
    on(el.btnDexBack, () => { uiBeep(0); goTitle(); });
    on(el.btnAch, () => { ensureAudio(); uiBeep(1); goAch(); });
    on(el.btnAchBack, () => { uiBeep(0); goTitle(); });
    on(el.btnRank, () => { ensureAudio(); uiBeep(1); goRank(); });
    on(el.btnRankBack, () => { uiBeep(0); goTitle(); });
    on(el.btnNick, () => { if (PK.Rank && el.rankNick) { PK.Rank.setNick(el.rankNick.value); uiBeep(1); buildRank(); } });
    on(el.btnItem, () => { ensureAudio(); cycleItem(); });
    on(el.btnCalm, () => { ensureAudio(); toggleCalm(); });
    on(el.btnEasy, () => { ensureAudio(); toggleEasy(); });
    on(document.getElementById('btnIntro'), () => { ensureAudio(); uiBeep(1); playIntro(); });
    on(document.getElementById('btnGP'), () => { ensureAudio(); uiBeep(1); goGP(); });
    on(document.getElementById('btnModes'), () => { ensureAudio(); uiBeep(1); goModes(); });
    on(document.getElementById('btnSettings'), () => { ensureAudio(); uiBeep(1); goSettings(); });
    on(document.getElementById('modesBack'), () => { uiBeep(0); goTitle(); });
    on(document.getElementById('settingsBack'), () => { uiBeep(0); goTitle(); });
    on(document.getElementById('gpOk'), () => { ensureAudio(); gpFinalDone(); });
    on(document.getElementById('btnGhost'), () => { ensureAudio(); uiBeep(1); goGhostMode(); });
    on(el.btnTest, () => { ensureAudio(); uiBeep(1); goTest(); });
    on(el.btnMapTest, () => { ensureAudio(); uiBeep(1); goMapTest(); });
    const byId = (id) => document.getElementById(id);
    on(byId('ctStart'), () => { ensureAudio(); testStart(); });
    on(byId('ctBack'), () => { uiBeep(0); goTitle(); });
    on(byId('mtBack'), () => { uiBeep(0); goTitle(); });
    on(el.ctGhost, () => testToggle(LS_GHOST_KART));
    on(el.ctGlitch, () => testToggle(LS_GLITCH_KART));
    on(byId('ctCoins'), testCoins);
    on(el.btnGo, () => { ensureAudio(); uiBeep(1); startRace(selIdx, pendingMap, pendingMap !== GHOST_MAP); });
    on(el.btnBack, selectBack);
    on(el.btnPause, () => { ensureAudio(); uiBeep(0); openPause(); });
    if (el.btnPause) el.btnPause.addEventListener('pointerdown', (e) => e.stopPropagation());
    pauseBtns = el.pause && el.pause.querySelectorAll ? Array.prototype.slice.call(el.pause.querySelectorAll('[data-act]')) : [];
    pauseBtns.forEach((b, i) => {
      b.addEventListener('click', () => { ensureAudio(); pauseSel = i; pauseAction(b.getAttribute('data-act')); });
      b.addEventListener('pointerenter', () => { pauseSel = i; refreshPauseSel(); });
    });
    canvas.addEventListener('pointerdown', () => {
      if (G.state === 'finished' && finT > 1.2) { uiBeep(1); nextRace(); }
    });
    // touch buttons (hold-to-press)
    const btns = el.touch && el.touch.querySelectorAll ? el.touch.querySelectorAll('.tb') : [];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i], key = b.getAttribute('data-k');
      if (!key) continue;
      const down = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        ensureAudio();
        touch[key] = true; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      };
      const up = () => { touch[key] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ---------------------------------------------------------------------------
  // kart select DOM
  // ---------------------------------------------------------------------------
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function copyCanvas(src, fallbackColor, w, h) {
    const c = document.createElement('canvas');
    c.width = (src && src.width) || w; c.height = (src && src.height) || h;
    const g = c.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      if (src) g.drawImage(src, 0, 0);
      else { g.fillStyle = fallbackColor || '#888'; g.fillRect(1, 1, c.width - 2, c.height - 2); }
    }
    return c;
  }
  function buildSelect() {
    const defs = PK.Karts.DEFS, SD = PK.Skills.DEFS || {};
    const rng = (f) => { let lo = Infinity, hi = -Infinity; defs.forEach((d) => { lo = Math.min(lo, d[f]); hi = Math.max(hi, d[f]); }); return [lo, hi]; };
    const R = { maxV: rng('maxV'), acc: rng('acc'), turn: rng('turn') };
    const pct = (f, v) => { const r = R[f]; return Math.round(100 * (r[1] > r[0] ? 0.25 + 0.75 * (v - r[0]) / (r[1] - r[0]) : 0.7)); };
    if (!el.cards) return;
    el.cards.innerHTML = '';
    cardEls = [];
    defs.forEach((d, i) => {
      const card = mk('div', 'card');
      const head = mk('div', 'khead');
      let spr = null;
      try { spr = PK.Karts.sprite(i, true); } catch (e) { spr = null; }
      const cv = copyCanvas(spr, d.color, 16, 12); cv.className = 'kspr';
      head.appendChild(cv);
      const nm = mk('div', 'kname', d.nameKo);
      nm.style.color = d.color;
      nm.appendChild(mk('small', null, d.name));
      const hb = mk('div');
      hb.appendChild(nm);
      const wt = mk('div', 'wt', '무게 ' + '■'.repeat(d.weight) + '□'.repeat(Math.max(0, 5 - d.weight)) + ' ');
      wt.appendChild(mk('span', null, d.mass + 'kg'));
      hb.appendChild(wt);
      head.appendChild(hb);
      card.appendChild(head);
      [['최고속도', 'maxV'], ['가속', 'acc'], ['핸들링', 'turn']].forEach(([lab, f]) => {
        const st = mk('div', 'stat');
        st.appendChild(mk('b', null, lab));
        const bar = mk('div', 'bar'), fill = mk('i');
        fill.style.width = pct(f, d[f]) + '%';
        bar.appendChild(fill); st.appendChild(bar);
        card.appendChild(st);
      });
      const sd = SD[d.skill] || {};
      const sk = mk('div', 'skill');
      sk.appendChild(copyCanvas(sd.icon, '#ffcc00', 12, 12));
      const sb = mk('div');
      sb.appendChild(mk('div', 'sname', '스킬: ' + (sd.nameKo || d.skill)));
      sb.appendChild(mk('div', 'sdesc', sd.desc || d.desc || ''));
      sk.appendChild(sb);
      card.appendChild(sk);
      card.addEventListener('click', () => { ensureAudio(); if (selIdx !== i) uiBeep(0); selIdx = i; refreshCards(); });
      card.addEventListener('dblclick', () => { uiBeep(1); startRace(i, pendingMap, pendingMap !== GHOST_MAP); });
      el.cards.appendChild(card);
      cardEls.push(card);
    });
    refreshCards();
  }
  function refreshCards() {
    // 레드 + karts bought in the shop (incl. the vampire) + ghost / glitch once won
    const r = playable();
    for (let i = 0; i < cardEls.length; i++) cardEls[i].style.display = r.indexOf(i) < 0 ? 'none' : '';
    for (let i = 0; i < cardEls.length; i++) {
      cardEls[i].classList.toggle('sel', i === selIdx);
      if (i === selIdx && cardEls[i].scrollIntoView && G.state === 'select') { try { cardEls[i].scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
    }
  }

  // ---------------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------------
  let last = -1, acc = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const now = (ts || 0) / 1000;
    let d = last < 0 ? DT : now - last;
    last = now;
    if (!(d > 0)) d = 0;
    if (d > 0.25) d = 0.25;           // clamp big gaps (tab switch etc.)
    acc += d;
    let n = 0;
    while (acc >= DT && n < 8) { step(DT); acc -= DT; n++; }
    if (n >= 8) acc = 0;
    render();
    updateEngine();
  }

  function simulate(dt) {
    const ks = G.karts, K = PK.Karts;
    const race = G.state === 'race';
    // shop item: C key / touch button, rising edge, once per race
    const ib = !!(keys.KeyC || touch.item);
    if (race && ib && !itemPrev) pressItem();
    itemPrev = ib;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (k.remote) { if (PK.Net) PK.Net.drive(k, dt); continue; }   // online friend: network-driven
      const inp = (k.isPlayer && race) ? playerInput() : K.aiInput(k, G);
      // skill rising edge must be checked BEFORE update (update overwrites k.prev)
      if (inp && inp.skill && !(k.prev && k.prev.skill)) PK.Skills.tryUse(k, G);
      K.update(k, inp, dt, G);
    }
    K.collide(ks);
    if (G.online && PK.Net) PK.Net.pin(ks);   // the friend's kart stays where the network says
    PK.Skills.update(dt, G);
  }

  function step(dt) {
    G.time += dt;
    if (((G.time) | 0) !== ((G.time - dt) | 0)) achTick();
    if (toastT > 0) toastT -= dt;
    if (bannerT > 0) bannerT -= dt;
    if (shakeT > 0) shakeT -= dt;
    const st = G.state;
    if (PK.Net && PK.Net.tick) PK.Net.tick(dt);   // online 2P: send/receive, scheduled start
    if (st === 'paused') return;     // frozen: no simulation, race timer stopped
    if (goT > 0) goT -= dt;
    if (surpriseT > 0) surpriseT -= dt;
    if (posPulse > 0) posPulse -= dt;
    if (posFlash > 0) posFlash -= dt;
    if (ovtCool > 0) ovtCool -= dt;
    if (ovtT > 0) { ovtT -= dt; if (ovtT <= 0) hideOvertake(); }
    if (speedBurst > 0) speedBurst -= dt;
    if (confT > 0) confT -= dt;
    updateParts(dt);
    if (mapBannerT > 0) { mapBannerT -= dt; if (mapBannerT <= 0) hideMapBanner(); }
    tutTick(dt);
    if (st === 'title' || st === 'select' || st === 'maps' || st === 'shop' || st === 'dex' || st === 'ach' || st === 'rank' || st === 'online' || st === 'ctest' || st === 'mtest') {
      simulate(dt);
      attractT += dt;
      if (attractT > ATTRACT_RESET) setupRace(randomKart(), true, raceMap);
    } else if (st === 'countdown') {
      if (cdGas()) { if (rsFrom < 0) rsFrom = cdT; } else rsFrom = -1;
      refreshTb();
      cdT -= dt;
      const n = Math.ceil(cdT);
      if (n < lastCd && n >= 1) { lastCd = n; sfx('beep'); }
      if (cdT <= 0) {
        G.state = 'race'; goT = 0.9; sfx('go');
        rocketStart();
        // shop 로켓 스타트 fires at GO: a guaranteed rocket start (cancels a too-early stall)
        if (raceItem && ITEMS()[raceItem].auto && useRaceItem() && G.player) G.player._stallT = 0;
      }
    } else if (st === 'race' || st === 'finished') {
      G.raceTime += dt;
      if (st === 'finished') finT += dt;
      simulate(dt);
      if (st === 'race') { updateSale(dt); trackPos(dt); refreshTb(); ghostRecord(); rstatTick(); }
      const pl = G.player;
      if (pl && st === 'race') {
        if ((pl.boostT || 0) > lastBoostT + 0.3) { speedBurst = 0.35; boostKick(0.22); }   // a fresh boost: speed-line burst + kick
        lastBoostT = pl.boostT || 0;
      }
    }
    // camera follow: track the movement direction (not the drift-rotated facing), soft dead-zone,
    // gentle follow rate and a yaw-rate cap so drifts and bumps don't swing the view
    const p = G.player;
    if (p) {
      const tgt = typeof p.ma === 'number' ? p.ma : p.a;
      let da = U.angDiff(camA, tgt);
      const dz = 0.03;
      da = Math.abs(da) < dz ? 0 : da - Math.sign(da) * dz;
      const big = Math.abs(da) > 1.2;   // teleport / respawn: catch up quickly
      let step = da * Math.min(1, (big ? 8 : 2.8) * dt);
      const cap = (big ? 6 : 2.4) * dt;
      step = U.clamp(step, -cap, cap);
      camA += step;
      if (camA > Math.PI) camA -= C.TAU; else if (camA < -Math.PI) camA += C.TAU;
      camX = p.x - Math.cos(camA) * C.CAM_DIST;
      camY = p.y - Math.sin(camA) * C.CAM_DIST;
    }
  }

  // touch '아이템' button: dimmed when there is nothing to use
  function refreshTb() {
    if (!el.tbItem) return;
    const p = G.player;
    const has = !!(p && !G.online && (p.boxItem || p.boxRoll > 0)) || !!(raceItem && !ITEMS()[raceItem].auto && !itemUsed);
    if (has === tbHas) return;
    tbHas = has;
    el.tbItem.classList.toggle('used', !has);
  }

  // ---------------------------------------------------------------------------
  // standings
  // ---------------------------------------------------------------------------
  function cmpStand(a, b) {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.prog - a.prog;
  }
  function computeStandings() {
    const s = G.standings, ks = G.karts;
    s.length = ks.length;
    for (let i = 0; i < ks.length; i++) s[i] = ks[i];
    s.sort(cmpStand);
    return s;
  }

  // ---------------------------------------------------------------------------
  // renderer
  // ---------------------------------------------------------------------------
  const BAY = U.BAYER;
  function drawGround() {
    const T = PK.Track, tex = T.texData, FOG = T.FOG;
    const fx = Math.cos(camA), fy = Math.sin(camA), rx = -fy, ry = fx;
    for (let y = HOR; y < H; y++) {
      const fogT = rowFog[y];
      let o = y * W;
      if (fogT >= 1) { buf.fill(FOG, o, o + W); continue; }
      const z = rowZ[y], k = z / FOCAL;
      let wx = camX + fx * z - rx * CX * k, wy = camY + fy * z - ry * CX * k;
      const sx = rx * k, sy = ry * k;
      const by = (y & 3) << 2;
      for (let x = 0; x < W; x++, o++, wx += sx, wy += sy) {
        if (fogT > 0 && fogT > BAY[by | (x & 3)]) { buf[o] = FOG; continue; }
        const ix = Math.floor(wx), iy = Math.floor(wy);
        buf[o] = (ix >= 0 && iy >= 0 && ix < TEX && iy < TEX) ? tex[iy * TEX + ix] : T.sampleOutside(ix, iy);
      }
    }
  }

  // pooled billboard records
  const pool = [], vis = [];
  function getRec(i) { let r = pool[i]; if (!r) { r = pool[i] = { z: 0, sx: 0, gy: 0, s: 0, spr: null, w: 0, h: 0, kart: null }; } return r; }
  const byDepth = (a, b) => b.z - a.z;
  let pfx_ = 1, pfy_ = 0, prx_ = 0, pry_ = 1;

  // project one world object; returns true if added
  function addBill(n, x, y, h, spr, w, kart) {
    const dx = x - camX, dy = y - camY;
    const z = dx * pfx_ + dy * pfy_;
    if (z < 3 || z > FOG_FAR) return n;
    const s = FOCAL / z;
    const sx = CX + (dx * prx_ + dy * pry_) * s;
    const sw = w * s;
    if (sx + sw < 0 || sx - sw > W) return n;
    const r = getRec(n);
    r.z = z; r.sx = sx; r.gy = HOR + CAM_H * s; r.s = s; r.spr = spr; r.w = w; r.h = h || 0; r.kart = kart;
    vis[n] = r;
    return n + 1;
  }

  function drawBillboards() {
    const T = PK.Track;
    pfx_ = Math.cos(camA); pfy_ = Math.sin(camA); prx_ = -pfy_; pry_ = pfx_;
    let n = 0;
    const props = T.props || [];
    for (let i = 0; i < props.length; i++) { const p = props[i]; if (p.spr) n = addBill(n, p.x, p.y, 0, p.spr, p.w, null); }
    const ks = G.karts;
    for (let i = 0; i < ks.length; i++) { const k = ks[i]; n = addBill(n, k.x, k.y, 0, null, KART_W, k); }
    if (ghostPlace()) n = addBill(n, ghKart.x, ghKart.y, 0, null, KART_W, ghKart);
    const ss = PK.Skills.sprites() || [];
    for (let i = 0; i < ss.length; i++) { const o = ss[i]; if (o && o.spr) n = addBill(n, o.x, o.y, o.h, o.spr, o.w, null); }
    vis.length = n;
    vis.sort(byDepth);
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const r = vis[i];
      const fade = r.z > FOG_NEAR ? 1 - (r.z - FOG_NEAR) / (FOG_FAR - FOG_NEAR) : 1;
      if (fade <= 0.02) continue;
      // ghost '유령화' skill may set k.alpha (0..1): multiply with the fog fade
      const ka = r.kart && typeof r.kart.alpha === 'number' && r.kart.alpha === r.kart.alpha ? U.clamp(r.kart.alpha, 0, 1) : 1;
      ctx.globalAlpha = fade * ka;
      if (r.kart) drawKart(r);
      else {
        const spr = r.spr, sw = r.w * r.s, sh = sw * spr.height / spr.width;
        const bottom = r.gy - r.h * r.s;
        const x0 = Math.round(r.sx - sw / 2), y0 = Math.round(bottom - sh);
        if (y0 > H) continue;
        ctx.drawImage(spr, x0, y0, Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawKart(r) {
    const k = r.kart, s = r.s, sw = KART_W * s;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const shH = Math.max(1, Math.round(sw * 0.16));
    ctx.fillRect(Math.round(r.sx - sw * 0.45), Math.round(r.gy - shH * 0.6), Math.max(1, Math.round(sw * 0.9)), shH);
    const spr = PK.Karts.frame(k, camA);
    if (spr) {
      const sh = sw * spr.height / spr.width;
      const bottom = r.gy - (k.hop || 0) * s;
      // smooth turning: besides the 3 lean frames, the sprite rolls into the turn, shears sideways
      // in drifts and (for karts heading away from the camera's direction) narrows a little, so the
      // kart turns gradually instead of snapping between frames
      const tgt = kartTurn(k);
      k._turnVis = (k._turnVis || 0) + (tgt - (k._turnVis || 0)) * 0.18;
      let t = k._turnVis, roll = t * 0.11, shear = t * (k.drift ? 0.22 : 0.1);
      let sx = 1 - Math.min(0.22, Math.abs(t) * (k.isPlayer ? 0.06 : 0.2)), lift = 0;
      // spun out (banana, missile, melon…): a full 360° turn on the spot — the sprite narrows,
      // flips (its back side shown mirrored) and widens again, bouncing a little
      if (k.fx && k.fx.spin > 0) {
        const c = Math.cos(k.spinA || 0);
        sx = Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
        roll = Math.sin(k.spinA || 0) * 0.08; shear = 0;
        lift = Math.abs(Math.sin((k.spinA || 0) * 2)) * sw * 0.06;
      }
      ctx.save();
      ctx.translate(Math.round(r.sx), Math.round(bottom - lift));
      ctx.rotate(roll);
      ctx.transform(1, 0, -shear, 1, 0, 0);
      ctx.scale(sx, 1);
      ctx.drawImage(spr, -Math.round(sw / 2), -Math.round(sh), Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
      ctx.restore();
    }
    if (k.ghostRun) {   // a 'GHOST' tag over the best-run kart (only when near enough to read)
      if (sw > 18) { const a = ctx.globalAlpha; ctx.globalAlpha = Math.min(1, a * 2); textC('GHOST', Math.round(r.sx), Math.round(r.gy - sw * 1.3 - 7), 1, '#bfe4ff', true); ctx.globalAlpha = a; }
      return;
    }
    PK.Karts.drawFx(ctx, k, r.sx, r.gy, sw);
  }
  // how much a kart looks turned (-1 left .. 1 right): the player's steering / drift, the AI's
  // heading relative to the camera
  function kartTurn(k) {
    if (k.fx && k.fx.spin > 0) return 0;
    if (k.isPlayer) return U.clamp((k.steerIn || 0) + (k.drift ? (k.driftDir || 0) * 0.6 : 0), -1, 1);
    return U.clamp(U.angDiff(camA, k.a) * 1.4 + (k.drift ? (k.driftDir || 0) * 0.5 : 0), -1, 1);
  }

  // corner warning: how much the track turns 36..120 units ahead of the player
  function drawCornerWarn(p, blink) {
    const T = PK.Track, N = T.N, TAN = T.TAN;
    if (!TAN || !(p.idx >= 0)) return;
    const d = U.angDiff(TAN[(p.idx + 6) % N], TAN[(p.idx + 20) % N]);
    const a = Math.abs(d);
    if (a < 0.75) return;
    const n = a > 1.35 ? 3 : 2, dir = d > 0 ? 1 : -1;   // + = turning right on screen
    const col = n === 3 ? (blink || calm ? '#ff5a3a' : '#ffcc00') : '#ffcc00';
    const w = 7, gap = 3, total = n * w + (n - 1) * gap, x0 = CX - total / 2, y0 = bannerT > 0 || toastT > 0 ? 66 : 44;   // below a banner / toast
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (w + gap);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? col : '#000';
        for (let r = 0; r < 9; r++) {
          const off = 4 - Math.abs(r - 4);   // 0..4..0: a '>' shape
          const px = dir > 0 ? x + off : x + 4 - off;
          if (pass) ctx.fillRect(px, y0 + r, 3, 1);
          else ctx.fillRect(px - 1, y0 + r - 1, 5, 3);
        }
      }
    }
  }

  // a fresh boost / rocket start: a short, light screen shake (none in calm mode)
  function boostKick(t) {
    if (calm || G.attract) return;
    shakeT = Math.max(shakeT, t); shakeMag = Math.max(1, shakeMag);
  }
  function drawSpeedLines() {
    const p = G.player;
    if (!p || !(p.boostT > 0) || G.state === 'countdown') return;
    // a few short, faint streaks at the screen edges (boost only); a fresh boost bursts more,
    // longer streaks reaching further in for a moment. Calm mode keeps the light version only.
    const br = speedBurst > 0 && !calm, n = br ? 14 : 4;
    ctx.fillStyle = br ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)';
    for (let i = 0; i < n; i++) {
      const left = i & 1;
      const y = (br ? HOR - 10 : HOR + 20) + ((Math.random() * (H - HOR - (br ? 0 : 30))) | 0);
      const len = (br ? 14 : 6) + ((Math.random() * (br ? 26 : 12)) | 0);
      const x = left ? ((Math.random() * (br ? 40 : 18)) | 0) : W - len - ((Math.random() * (br ? 40 : 18)) | 0);
      ctx.fillRect(x, y, len, 1);
    }
  }

  // glitch world / teleport: occasional thin torn scanline bands (small offsets) and a faint
  // magenta/cyan split strip. Rare and short; skipped entirely in calm mode.
  let glitchNext = 1.5, glitchOn = 0;
  function drawGlitchFx(world) {
    if (calm) return;
    if (world) {
      glitchNext -= DT;
      if (glitchNext <= 0) { glitchOn = 0.08 + Math.random() * 0.12; glitchNext = 2.5 + Math.random() * 4; }
    }
    if (glitchT > 0) glitchT -= DT;
    if (glitchOn > 0) glitchOn -= DT;
    if (!(glitchOn > 0) && !(glitchT > 0)) {
      if (world) {   // idle: faint scanlines only
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        for (let y = HOR; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      }
      return;
    }
    const n = 1 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const y = HOR + ((Math.random() * (H - HOR - 8)) | 0), h = 2 + ((Math.random() * 4) | 0);
      const dx = ((Math.random() * 2 - 1) * 5) | 0;
      if (dx) ctx.drawImage(canvas, 0, y, W, h, dx, y, W, h);
    }
    const sy = HOR + ((Math.random() * (H - HOR - 12)) | 0);
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,40,200,0.14)' : 'rgba(40,230,255,0.14)';
    ctx.fillRect(0, sy, W, 3 + ((Math.random() * 6) | 0));
  }

  // ---------------------------------------------------------------------------
  // Per-map screen layers (drawn over the 3D view, under the HUD), picked by PK.Track.fx.
  // 'haunted' (secret ghost map): cold purple multiply tint, vignette, drifting fog wisps and the
  // odd fluorescent flicker (the map colours themselves come from PK.Track.setTheme(2)).
  // ---------------------------------------------------------------------------
  let fxVig = null, fxWisp = null, fxDusk = null, fxFrost = null, flickT = 0, flickNext = 3;
  const WISPS = [], SNOW = [];
  function buildFx() {
    try {
      fxVig = document.createElement('canvas'); fxVig.width = W; fxVig.height = H;
      const g = fxVig.getContext('2d');
      const gr = g.createRadialGradient(CX, H * 0.55, 40, CX, H * 0.55, W * 0.62);
      gr.addColorStop(0, 'rgba(6,0,16,0)'); gr.addColorStop(0.65, 'rgba(6,0,16,0.25)'); gr.addColorStop(1, 'rgba(4,0,10,0.72)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      fxWisp = document.createElement('canvas'); fxWisp.width = 64; fxWisp.height = 16;
      const w = fxWisp.getContext('2d');
      w.setTransform(1, 0, 0, 0.25, 0, 0);
      const wg = w.createRadialGradient(32, 32, 0, 32, 32, 32);
      wg.addColorStop(0, 'rgba(190,240,230,0.55)'); wg.addColorStop(0.6, 'rgba(160,200,220,0.18)'); wg.addColorStop(1, 'rgba(160,200,220,0)');
      w.fillStyle = wg; w.fillRect(0, 0, 64, 64);
    } catch (e) { fxVig = null; fxWisp = null; }
    try {
      fxDusk = document.createElement('canvas'); fxDusk.width = W; fxDusk.height = H;
      const g = fxDusk.getContext('2d');
      const lg = g.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, 'rgba(255,150,90,0.20)'); lg.addColorStop(0.4, 'rgba(255,120,80,0.06)'); lg.addColorStop(1, 'rgba(90,40,120,0.16)');
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(CX, H * 0.55, 60, CX, H * 0.55, W * 0.62);
      rg.addColorStop(0, 'rgba(40,10,60,0)'); rg.addColorStop(1, 'rgba(40,10,60,0.38)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
      fxFrost = document.createElement('canvas'); fxFrost.width = W; fxFrost.height = H;
      const f = fxFrost.getContext('2d');
      const fg = f.createRadialGradient(CX, H * 0.55, 70, CX, H * 0.55, W * 0.6);
      fg.addColorStop(0, 'rgba(220,240,255,0)'); fg.addColorStop(1, 'rgba(220,240,255,0.42)');
      f.fillStyle = fg; f.fillRect(0, 0, W, H);
    } catch (e) { fxDusk = null; fxFrost = null; }
    const rnd = U.rng(777);
    for (let i = 0; i < 26; i++) SNOW.push({ x: rnd() * W, y: rnd() * H, v: 8 + rnd() * 14, z: 0.3 + rnd() * 0.7, ph: rnd() * 6, s: rnd() < 0.3 ? 2 : 1 });
    for (let i = 0; i < 9; i++) WISPS.push({ x: rnd() * 1000, y: HOR - 6 + rnd() * 70, v: 3 + rnd() * 6, s: 0.8 + rnd() * 1.6, ph: rnd() * 6 });
  }
  function drawNightFx() {
    const t = G.time;
    ctx.save();
    // cold tint
    try { ctx.globalCompositeOperation = 'multiply'; } catch (e) { /* ignore */ }
    ctx.fillStyle = ctx.globalCompositeOperation === 'multiply' ? '#b4a2dc' : 'rgba(20,6,40,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    // fog wisps (parallax with the camera heading)
    if (fxWisp) {
      const span = W + 120;
      for (let i = 0; i < WISPS.length; i++) {
        const w = WISPS[i];
        const x = ((((w.x + t * w.v - camA * 160 * (0.6 + 0.1 * i)) % span) + span) % span) - 60;
        const y = w.y + Math.sin(t * 0.7 + w.ph) * 3;
        ctx.globalAlpha = 0.22 + 0.12 * Math.sin(t * 0.5 + w.ph);
        ctx.drawImage(fxWisp, Math.round(x), Math.round(y), Math.round(64 * w.s), Math.round(16 * w.s));
      }
      ctx.globalAlpha = 1;
    }
    if (fxVig) ctx.drawImage(fxVig, 0, 0);
    // rare, soft flicker: the lights dip briefly (off in calm mode)
    flickNext -= DT;
    if (flickNext <= 0) { flickT = 0.08 + Math.random() * 0.12; flickNext = 6 + Math.random() * 8; }
    if (flickT > 0) {
      flickT -= DT;
      if (!calm) { ctx.fillStyle = 'rgba(0,0,8,0.2)'; ctx.fillRect(0, 0, W, H); }
    }
    ctx.restore();
  }

  function render() {
    if (!ctx || !G.player) return;
    if (use3d()) {
      // 3D: the WebGL canvas below draws the world; this canvas keeps only HUD / overlays
      canvas.style.background = 'transparent';
      ctx.clearRect(0, 0, W, H);
      try { PK.R3D.render(G, camX, camY, camA); } catch (e) { view3d = false; }   // broken 3D -> 2D
    } else {
      if (PK.R3D && PK.R3D.hide) PK.R3D.hide();
      canvas.style.background = '';
      PK.Track.drawBackground(buf, camA);
      drawGround();
      let ox = 0, oy = 0;
      if (shakeT > 0) {
        ox = Math.round((Math.random() * 2 - 1) * shakeMag);
        oy = Math.round((Math.random() * 2 - 1) * shakeMag);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      }
      ctx.putImageData(img, ox, oy);
      ctx.save();
      if (ox || oy) ctx.translate(ox, oy);
      drawBillboards();
      drawParts();
      ctx.restore();
    }
    const fx = PK.Track.fx;
    if (fx === 'haunted') drawNightFx();
    else if (fx === 'dusk') drawDuskFx();
    else if (fx === 'frost') drawFrostFx();
    if (fx === 'glitch' || glitchT > 0) drawGlitchFx(fx === 'glitch' && G.state !== 'paused');
    if (surpriseT > 0 && !calm) drawSurprise();
    drawSpeedLines();
    const st = G.state === 'paused' ? pauseFrom : G.state;
    if (st === 'countdown' || st === 'race' || st === 'finished') drawHUD(st);
    drawConfetti();
  }

  // rooftop at dusk: warm sunset glow from the top, soft violet corners (one precomputed layer)
  function drawDuskFx() { if (fxDusk) ctx.drawImage(fxDusk, 0, 0); }
  // freezer: icy vignette + a few drifting snow flakes
  function drawFrostFx() {
    if (fxFrost) ctx.drawImage(fxFrost, 0, 0);
    const t = G.time;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < SNOW.length; i++) {
      const f = SNOW[i];
      const x = ((((f.x + Math.sin(t * 0.8 + f.ph) * 8 - camA * 160 * f.z) % (W + 8)) + W + 8) % (W + 8)) - 4;
      const y = (((f.y + t * f.v) % (H + 4)) + H + 4) % (H + 4) - 2;
      ctx.fillRect(Math.round(x), Math.round(y), f.s, f.s);
    }
  }
  // secret map surprise: purple/white strobe for a moment
  function drawSurprise() {
    const on = ((surpriseT * 5) | 0) & 1, gl = raceMap === GLITCH_MAP;   // slow, soft pulse
    ctx.fillStyle = gl ? (on ? 'rgba(40,230,255,0.22)' : 'rgba(255,40,200,0.22)') : (on ? 'rgba(200,170,255,0.25)' : 'rgba(40,0,70,0.25)');
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------------------
  // 3x5 bitmap font
  // ---------------------------------------------------------------------------
  // 3 columns x 5 rows per glyph
  const FONT_ROWS = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'],
    ':': ['...', '.#.', '...', '.#.', '...'], '/': ['..#', '..#', '.#.', '#..', '#..'], '.': ['...', '...', '...', '...', '.#.'],
    '!': ['.#.', '.#.', '.#.', '...', '.#.'], '-': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
    "'": ['.#.', '.#.', '...', '...', '...'], ' ': ['...', '...', '...', '...', '...'],
  };
  // glyph -> flat list of horizontal runs [x, y, len, ...]
  const GLYPH = Object.create(null);
  for (const ch in FONT_ROWS) {
    const rows = FONT_ROWS[ch], runs = [];
    for (let y = 0; y < 5; y++) {
      let x = 0;
      while (x < 3) {
        if (rows[y][x] === '#') { let l = 0; while (x + l < 3 && rows[y][x + l] === '#') l++; runs.push(x, y, l); x += l; } else x++;
      }
    }
    GLYPH[ch] = runs;
  }
  const textW = (s, sc) => (s.length ? s.length * 4 * sc - sc : 0);
  function textRaw(s, x, y, sc) {
    for (let i = 0; i < s.length; i++) {
      const g = GLYPH[s[i]] || GLYPH[' '];
      const gx = x + i * 4 * sc;
      for (let j = 0; j < g.length; j += 3) ctx.fillRect(gx + g[j] * sc, y + g[j + 1] * sc, g[j + 2] * sc, sc);
    }
  }
  function text(s, x, y, sc, col, shadow) {
    s = String(s).toUpperCase();
    x = Math.round(x); y = Math.round(y);
    if (shadow !== false) { const o = sc >= 4 ? 2 : 1; ctx.fillStyle = '#000'; textRaw(s, x + o, y + o, sc); }
    ctx.fillStyle = col || '#fff';
    textRaw(s, x, y, sc);
  }
  function textC(s, cx, y, sc, col, shadow) { s = String(s).toUpperCase(); text(s, cx - textW(s, sc) / 2, y, sc, col, shadow); }
  function textR(s, rx, y, sc, col, shadow) { s = String(s).toUpperCase(); text(s, rx - textW(s, sc), y, sc, col, shadow); }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const POSCOL = ['#ffd800', '#dfe3f0', '#e8964a', '#ffffff', '#ffffff', '#ffffff'];
  function box(x, y, w, h, fill) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  }

  // HUD. Desktop: gauge/speed bottom-left, skill bottom-centre, minimap bottom-right.
  // Touch (coarse): those move to the top strip so the on-screen buttons don't hide them.
  function drawHUD(st) {
    const p = G.player, t = G.time;
    const stand = computeStandings();
    const pos = stand.indexOf(p);
    const blink = ((t * 4) | 0) & 1;
    const T = PK.Track, ghost = raceMap === GHOST_MAP || raceMap === GLITCH_MAP;
    const mapTag = (raceMap === GLITCH_MAP ? 'ERR ' : ghost ? '??? ' : 'MAP ' + (raceMap + 1) + ' ') + (T.nameEn || '');

    // lap (top-left)
    const lap = U.clamp(p.lap || 1, 1, C.LAPS);
    text('LAP', 4, 4, 1, '#ffcc00');
    text(lap + '/' + C.LAPS, 4, 11, 2, '#fff');
    // race time (center top) + map name
    textC(fmt(G.raceTime || 0.0001).replace('--:--.--', '0:00.00'), CX, 4, 2, '#fff');
    if (ghostMode && !G.online) textC(ghRun ? 'GHOST ' + fmt(ghRun.t) : 'GHOST: FIRST RUN', CX, coarse ? 24 : 16, 1, '#bfe4ff', true);
    if (coarse) textC(mapTag, CX, 16, 1, ghost ? '#c8a0ff' : '#a898c8');
    else text(mapTag, 4, 23, 1, ghost ? '#c8a0ff' : '#a898c8');
    // position (top-right)
    if (pos >= 0) {
      const ps = ORD[pos] || (pos + 1) + 'TH';
      const pr = W - 28;   // leaves the top-right corner to the ⏸ button
      // overtake: the number pops bigger and hops; overtaken: it turns red for a moment
      let pc = POSCOL[pos] || '#fff', big = 4, oy = 0;
      if (posFlash > 0) pc = '#ff5050';
      if (posPulse > 0) { const u = posPulse / POS_PULSE; oy = -Math.round(Math.sin(u * Math.PI) * 3); if (u > 0.35) big = 5; pc = u > 0.6 ? '#ffffff' : pc; }
      textR(ps.slice(0, 1), pr - textW(ps.slice(1), 2) - 2, Math.max(0, 4 + oy - (big - 4) * 2), big, pc);
      textR(ps.slice(1), pr, 4, 2, pc);
    }

    // speed + booster gauge
    const kmh = Math.round(Math.abs(p.v || 0) * 0.8);
    const gw = 56, gh = 6;
    let gx, gy;
    if (coarse) { gx = 36; gy = 11; text(kmh + ' KM/H', gx, gy + 9, 1, p.boostT > 0 ? '#ffcc00' : '#fff'); }
    else { gx = 4; gy = H - 24; text(kmh + ' KM/H', 4, H - 12, 2, p.boostT > 0 ? '#ffcc00' : '#fff'); }
    box(gx, gy, gw, gh, '#1a1028');
    const gv = U.clamp(p.gauge || 0, 0, 100) / 100;
    ctx.fillStyle = gv >= 0.999 ? '#fff' : '#ff9a00';
    ctx.fillRect(gx, gy, Math.round(gw * gv), gh);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(gx, gy, Math.round(gw * gv), 2);
    for (let i = 0; i < 2; i++) {
      const sx = gx + gw + 4 + i * 9, lit = (p.stock || 0) > i;
      box(sx, gy - 1, 7, 8, lit ? (blink ? '#ffe14d' : '#ff8800') : '#2a2038');
    }
    if ((p.stock || 0) > 0 && !coarse) text('Z', gx + gw + 23, gy - 1, 1, blink ? '#fff' : '#ffcc00');
    text('BOOST', gx, gy - 7, 1, '#ffb347');

    // skill icon
    const SD = PK.Skills.DEFS && PK.Skills.DEFS[p.def.skill];
    if (SD) {
      const is = coarse ? 18 : 24, ix = coarse ? 236 : 104, iy = coarse ? 4 : H - 30;
      const ready = !((p.skillCd || 0) > 0);
      box(ix - 1, iy - 1, is + 2, is + 2, ready && blink ? '#ffcc00' : '#1a1028');
      if (SD.icon) ctx.drawImage(SD.icon, ix, iy, is, is);
      if (!ready) {
        const f = U.clamp(p.skillCd / (SD.cooldown || 1), 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        const hh = Math.round(is * f);
        ctx.fillRect(ix, iy, is, hh);
        textC(String(Math.ceil(p.skillCd)), ix + is / 2, iy + is / 2 - 2, 1, '#fff');
      }
      if (!coarse) text('X', ix + is + 4, iy + is - 5, 1, ready ? (blink ? '#fff' : '#ffcc00') : '#776a8a');
    }

    // food coins (both layouts: left, under the lap / map name)
    const fi = PK.Skills.foodIcon && PK.Skills.foodIcon(0);
    if (fi) ctx.drawImage(fi, 4, 30, 9, 9);
    text(foodRace + '/' + FOOD_CAP, 15, 32, 1, foodRace >= FOOD_CAP ? '#ffcc00' : '#fff');
    // drift combo (next to the boost label)
    if ((p.combo || 0) >= 2) text('X' + p.combo + ' COMBO', gx + 24, gy - 7, 1, blink ? '#ffe14d' : '#ff8800');
    // time sale countdown
    const sl = PK.Skills.saleLeft ? PK.Skills.saleLeft() : 0;
    if (sl > 0) textC('SALE ' + Math.ceil(sl), CX, coarse ? 24 : 18, 1, blink ? '#ff6060' : '#ffe14d');
    // equipped shop item (desktop: right of the skill icon; touch: under the skill icon)
    const IT = raceItem && ITEMS()[raceItem];
    if (IT) {
      const is = 18, ix = coarse ? 236 : 140, iy = coarse ? 26 : H - 24;
      box(ix - 1, iy - 1, is + 2, is + 2, itemUsed ? '#120c1c' : (blink ? '#40c0ff' : '#1a1028'));
      if (IT.icon) { ctx.globalAlpha = itemUsed ? 0.3 : 1; ctx.drawImage(IT.icon, ix, iy, is, is); ctx.globalAlpha = 1; }
      if (!coarse) text(itemUsed ? '-' : IT.auto ? 'GO' : 'C', ix + is + 3, iy + is - 5, 1, itemUsed ? '#776a8a' : '#9fe8ff');
    }

    // ❓ item-box slot (left, under the food counter): roulette while rolling, then the item
    if (false && !G.online && PK.Skills.BOX) {   // 랜덤 박스 슬롯 숨김
      const bs = 18, bx = 4, by = 42, BX = PK.Skills.BOX, ids = PK.Skills.BOX_IDS;
      const rolling = p.boxRoll > 0, has = p.boxItem && !rolling;
      box(bx - 1, by - 1, bs + 2, bs + 2, rolling ? ((((t * 16) | 0) & 1) ? '#ff4f9a' : '#3fc8ff') : has ? (blink ? '#ffcc00' : '#b06a10') : '#1a1028');
      ctx.fillStyle = '#120c1c'; ctx.fillRect(bx, by, bs, bs);
      if (rolling) {
        const ic = BX[ids[(((p.boxRoll * p.boxRoll) * 40) | 0) % ids.length]].icon;   // spins fast, slows down
        if (ic) ctx.drawImage(ic, bx + 1, by + 1, bs - 2, bs - 2);
      } else if (has) {
        const ic = BX[p.boxItem] && BX[p.boxItem].icon;
        if (ic) ctx.drawImage(ic, bx + 1, by + 1, bs - 2, bs - 2);
        if (!coarse) text('C', bx + bs + 3, by + bs - 5, 1, blink ? '#fff' : '#ffcc00');
      } else textC('?', bx + bs / 2, by + 4, 2, '#3a2c52', false);
      // homing basket closing in
      if (st === 'race' && PK.Skills.incoming && PK.Skills.incoming(p) && blink) textC('! INCOMING !', CX, 78, 2, '#ff4040');
    }

    // minimap (desktop: bottom-right 60x60; touch: top-right under the position, 48x48)
    // the maze map hides it on purpose: find the way yourself
    if (T.mini && !(T.def && (T.def.noMinimap || T.def.maze))) {
      const ms = coarse ? 0.8 : 1;
      const mw = Math.round((T.mini.width || 60) * ms), mh = Math.round((T.mini.height || 60) * ms);
      const mx = W - mw - 3, my = coarse ? 27 : H - mh - 3;
      ctx.fillStyle = 'rgba(10,6,20,0.6)'; ctx.fillRect(mx - 1, my - 1, mw + 2, mh + 2);
      ctx.drawImage(T.mini, mx, my, mw, mh);
      for (let i = G.karts.length - 1; i >= 0; i--) {
        const k = G.karts[i];
        if (k === p) continue;
        const m = T.toMini(k.x, k.y);
        const kx = Math.round(mx + m[0] * ms), ky = Math.round(my + m[1] * ms);
        ctx.fillStyle = '#000'; ctx.fillRect(kx - 2, ky - 2, 4, 4);
        ctx.fillStyle = k.color || k.def.color; ctx.fillRect(kx - 1, ky - 1, 2, 2);
      }
      const m = T.toMini(p.x, p.y);
      const px2 = Math.round(mx + m[0] * ms), py2 = Math.round(my + m[1] * ms);
      ctx.fillStyle = '#000'; ctx.fillRect(px2 - 2, py2 - 2, 5, 5);
      ctx.fillStyle = blink ? '#fff' : (p.color || p.def.color); ctx.fillRect(px2 - 1, py2 - 1, 3, 3);
    }

    // countdown
    if (st === 'countdown' && cdT <= 3) {
      const n = Math.max(1, Math.ceil(cdT));
      const col = n === 3 ? '#ff4040' : n === 2 ? '#ff9a00' : '#ffe14d';
      const frac = cdT - Math.floor(cdT);
      const sc = frac > 0.8 ? 12 : 10;
      textC(String(n), CX, 70 - sc * 2.5, sc, col);
    } else if (goT > 0) {
      textC('GO!', CX, 48, 8, blink ? '#40ff60' : '#c8ffd0');
    }

    // wrong way
    if (st === 'race' && p.wrongT > 1 && blink) textC('WRONG WAY', CX, 64, 3, '#ff4040');

    // ⚠ corner ahead: yellow chevrons point the way before a sharp bend (2 = bend, 3 = hairpin)
    if (st === 'race' && !(p.wrongT > 1)) drawCornerWarn(p, blink);

    // banner + toast
    if (bannerT > 0 && st !== 'countdown') textC(bannerText, CX, 34, 3, bannerCol);
    if (toastT > 0) textC(toastText, CX, bannerT > 0 ? 50 : 36, 2, '#9fe8ff');

    // results
    if (st === 'finished' && finT > 1.2 && !G.online) drawResults(stand, blink);   // online: js/net.js panel
  }

  // 🏁 podium: the top 3 standing on gold / silver / bronze blocks (1st in the middle, higher),
  // rising in one after the other; the winner hops, a few twinkles around it
  const POD = [
    { place: 1, x: 40, w: 36, h: 32, col: '#ffd800', dk: '#b08a00', sw: 32, delay: 0.5 },
    { place: 2, x: 8, w: 32, h: 22, col: '#dfe3f0', dk: '#8a90a8', sw: 28, delay: 0.25 },
    { place: 3, x: 76, w: 32, h: 15, col: '#e8964a', dk: '#9a5a22', sw: 28, delay: 0 },
  ];
  function drawPodium(stand) {
    const px = 4, py = 22, pw = 108, ph = 136, base = py + ph - 24, t = G.time, u0 = finT - 1.2;
    ctx.fillStyle = '#000'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    ctx.fillStyle = 'rgba(30,20,48,0.94)'; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#ff8800'; ctx.fillRect(px, py, pw, 2); ctx.fillRect(px, py + ph - 2, pw, 2);
    textC('TOP 3', px + pw / 2, py + 6, 2, '#ffcc00');
    // spotlight cone behind the winner
    ctx.fillStyle = 'rgba(255,240,180,0.07)';
    for (let i = 0; i < 6; i++) ctx.fillRect(px + 58 - 6 - i * 3, py + 18 + i * 12, 12 + i * 6, 12);
    for (let n = 0; n < POD.length; n++) {
      const d = POD[n], k = stand[d.place - 1];
      if (!k) continue;
      const bx = px + d.x - 4, top = base - d.h;
      // block
      ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, top - 1, d.w + 2, d.h + 2);
      ctx.fillStyle = d.col; ctx.fillRect(bx, top, d.w, d.h);
      ctx.fillStyle = d.dk; ctx.fillRect(bx, top + d.h - 3, d.w, 3); ctx.fillRect(bx + d.w - 2, top, 2, d.h);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(bx, top, d.w, 1);
      textC(String(d.place), bx + d.w / 2, top + Math.min(4, d.h - 10), 2, '#2a1a08', false);
      // kart sprite rising onto it
      const u = U.clamp((u0 - d.delay) / 0.35, 0, 1), e = 1 - (1 - u) * (1 - u);
      let spr = null;
      try { spr = PK.Karts.sprite(k.defIndex, k.isPlayer); } catch (er) { spr = null; }
      if (spr && u > 0) {
        const sw = d.sw, sh = Math.round(sw * spr.height / spr.width);
        const hop = d.place === 1 && u >= 1 ? Math.round(Math.abs(Math.sin(t * 4)) * 3) : 0;
        const sy = Math.round(top - sh * e - hop);
        ctx.save();
        ctx.beginPath(); ctx.rect(bx - 6, py + 16, d.w + 12, top - py - 16); ctx.clip();   // rises from behind the block
        ctx.drawImage(spr, Math.round(bx + (d.w - sw) / 2), sy, sw, sh);
        ctx.restore();
        if (d.place === 1 && u >= 1) {
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < 4; i++) {
            if (((t * 6 + i * 1.7) | 0) % 3) continue;
            const tx = bx + 2 + ((i * 23 + ((t * 2) | 0) * 7) % (d.w - 4)), ty = sy - 2 + ((i * 13) % 20);
            ctx.fillRect(tx, ty, 1, 3); ctx.fillRect(tx - 1, ty + 1, 3, 1);
          }
        }
      }
      // name + time under the podium
      const nm = k.isPlayer ? 'YOU' : String(k.name || k.def.name).slice(0, 7);
      textC(nm, bx + d.w / 2, base + 4, 1, k.isPlayer ? '#ffcc00' : '#ffffff');
      textC(k.finished ? fmt(k.finishTime).replace(/^0:/, '') : '--.--', bx + d.w / 2, base + 12, 1, '#a898c8', false);
    }
    G.dbg.podium++;
  }

  function drawResults(stand, blink) {
    // podium on the left, the table on the right
    drawPodium(stand);
    const px = 116, py = 22, pw = 200, ph = 136, PCX = px + pw / 2;
    ctx.fillStyle = '#000'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    ctx.fillStyle = 'rgba(30,20,48,0.94)'; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#ff8800'; ctx.fillRect(px, py, pw, 2); ctx.fillRect(px, py + ph - 2, pw, 2);
    textC('RESULTS', PCX, py + 6, 2, '#ffcc00');
    // coins earned this race (left) / wallet (right)
    const fi = PK.Skills.foodIcon && PK.Skills.foodIcon(0);
    if (fi) ctx.drawImage(fi, px + 6, py + 5, 9, 9);
    text('+' + foodRace + (testMode ? ' TEST' : ''), px + 17, py + 7, 1, '#ffe14d', false);
    textR('COIN ' + wallet(), px + pw - 6, py + 7, 1, '#ffe14d', false);
    textC((raceMap === GHOST_MAP ? '??? ' : 'MAP ' + (raceMap + 1) + ' ') + (PK.Track.nameEn || ''), PCX, py + 15, 1, raceMap === GHOST_MAP ? '#c8a0ff' : '#a898c8', false);
    const c0 = px + 6, cChip = px + 15, cName = px + 26, cTime = px + 58, cLap = px + 102, cTag = px + 172;
    const hy = py + 25;
    text('TIME', cTime, hy, 1, '#a898c8', false);
    text('BEST LAP', cLap, hy, 1, '#a898c8', false);
    for (let i = 0; i < stand.length; i++) {
      const k = stand[i], y = hy + 9 + i * 12;
      if (k.isPlayer) { ctx.fillStyle = 'rgba(255,200,0,0.22)'; ctx.fillRect(px + 3, y - 3, pw - 6, 11); }
      text(String(i + 1), c0, y, 1, POSCOL[i] || '#fff');
      ctx.fillStyle = '#000'; ctx.fillRect(cChip - 1, y - 1, 9, 7);
      ctx.fillStyle = k.color || k.def.color; ctx.fillRect(cChip, y, 7, 5);
      text(k.name || k.def.name, cName, y, 1, k.isPlayer ? '#ffcc00' : '#fff');
      text(k.finished ? fmt(k.finishTime) : '--:--.--', cTime, y, 1, '#fff');
      const bl = k.lapTimes && k.lapTimes.length ? Math.min.apply(null, k.lapTimes) : 0;
      text(fmt(bl), cLap, y, 1, '#e8e0f8');
      if (k.isPlayer) text('YOU', cTag, y, 1, '#ffcc00');
    }
    const y = hy + 9 + stand.length * 12 + 2;
    if (newRecord || newLapRecord) {
      textC(newRecord ? 'NEW RECORD!' : 'NEW LAP RECORD!', PCX, y, 2, blink ? '#ff8800' : '#ffe14d');
    }
    if (ghostReward === 'got') textC('GHOST KART UNLOCKED!', PCX, y + 12, 1, blink ? '#c8a0ff' : '#ffffff');
    else if (ghostReward === 'miss') textC('THE GHOST GOT AWAY...', PCX, y + 12, 1, '#a898c8');
    else if (ghostReward === 'glitch') textC('GLITCH KART UNLOCKED!', PCX, y + 12, 1, blink ? '#00e8b8' : '#ff40d0');
    if (gp) textC('GRAND PRIX ' + (gp.round + 1) + '/' + gp.maps.length, PCX, py + ph - 19, 1, '#ffcc00');
    const nx = gp ? (gp.round + 1 < gp.maps.length ? 'ENTER: NEXT ROUND' : 'ENTER: GP RESULTS') : testMode ? 'ENTER: CHAR TEST' : 'ENTER: NEXT MAP';
    if (((G.time * 2) | 0) & 1) textC(nx + '  R: RETRY  ESC: MENU', PCX, py + ph - 10, 1, '#fff');
  }

  // ---------------------------------------------------------------------------
  // audio
  // ---------------------------------------------------------------------------
  let ac = null, master = null, sfxBus = null, engO = null, engO2 = null, engF = null, engG = null, noiseBuf = null;
  let skidG = null, skidO = null, skidF = null, engDip = 0, engLastT = 0, lastGas = false;   // drift squeal loop, engine dip after hits
  const lastSfx = Object.create(null);
  function ensureAudio() {
    if (ac) { if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = G.muted ? 0 : 0.55; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
      // engine: sawtooth + sub square -> lowpass -> gain
      engO = ac.createOscillator(); engO.type = 'sawtooth'; engO.frequency.value = 50;
      engO2 = ac.createOscillator(); engO2.type = 'square'; engO2.frequency.value = 25;
      engF = ac.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 400; engF.Q.value = 4;
      engG = ac.createGain(); engG.gain.value = 0;
      const sub = ac.createGain(); sub.gain.value = 0.4;
      engO.connect(engF); engO2.connect(sub); sub.connect(engF); engF.connect(engG); engG.connect(master);
      engO.start(); engO2.start();
      const len = (ac.sampleRate * 0.5) | 0;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // tyre squeal (drift / hard braking): looped hiss through a narrow band + a wavering high tone
      const sn = ac.createBufferSource(); sn.buffer = noiseBuf; sn.loop = true;
      skidF = ac.createBiquadFilter(); skidF.type = 'bandpass'; skidF.frequency.value = 2600; skidF.Q.value = 5;
      skidO = ac.createOscillator(); skidO.type = 'triangle'; skidO.frequency.value = 950;
      const so = ac.createGain(); so.gain.value = 0.35;
      skidG = ac.createGain(); skidG.gain.value = 0;
      sn.connect(skidF); skidF.connect(skidG); skidO.connect(so); so.connect(skidG); skidG.connect(sfxBus);
      sn.start(); skidO.start();
    } catch (e) { ac = null; }
    if (ac && !musicInit && PK.Music && PK.Music.init) {
      try { PK.Music.init(ac, master); musicInit = true; if ('muted' in PK.Music) PK.Music.muted = G.muted; } catch (e) { musicInit = false; }
      musicSync();
    }
  }
  function toggleMute() {
    G.muted = !G.muted;
    if (ac && master) master.gain.setTargetAtTime(G.muted ? 0 : 0.55, ac.currentTime, 0.02);
    if (PK.Music && 'muted' in PK.Music) PK.Music.muted = G.muted;   // music runs through master anyway
    toast(G.muted ? 'SOUND OFF' : 'SOUND ON');
  }
  function tone(type, f0, f1, dur, vol, delay) {
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, fc, delay) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 2000;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + dur + 0.03);
  }
  function uiBeep(kind) { if (!ac) return; try { if (kind) { tone('square', 660, 660, 0.06, 0.12); tone('square', 990, 990, 0.08, 0.12, 0.06); } else tone('square', 520, 520, 0.05, 0.1); } catch (e) { /* ignore */ } }

  function sfx(name) {
    // screen shake is visual, so trigger it even without audio
    // (hits only, 1 px; none for bumps or in calm mode)
    if (!G.attract && !calm && name === 'hit') { shakeT = 0.2; shakeMag = 1; }
    if (!G.attract && !calm && name === 'wall') { shakeT = 0.25; shakeMag = 2; }
    if (!G.attract && name === 'wall' && G.state === 'race') rstat.wall++;
    if (!G.attract && name === 'glitch') glitchT = 0.35;   // teleport / glitch world: brief screen glitch
    if (!G.attract && (name === 'wall' || name === 'bump' || name === 'hit')) engDip = Math.max(engDip, name === 'bump' ? 0.5 : 1);
    if (!ac || G.attract || G.muted) return;
    const now = ac.currentTime;
    if (lastSfx[name] !== undefined && now - lastSfx[name] < 0.06) return;
    lastSfx[name] = now;
    try {
      switch (name) {
        case 'beep': tone('square', 440, 440, 0.18, 0.2); break;
        case 'go': tone('square', 880, 880, 0.45, 0.22); tone('square', 1320, 1320, 0.45, 0.08); break;
        case 'boost': tone('sawtooth', 180, 720, 0.45, 0.16); noise(0.4, 0.18, 1800); break;
        case 'pad': tone('triangle', 500, 1300, 0.22, 0.2); tone('square', 1000, 1600, 0.12, 0.05, 0.05); break;
        case 'skill': tone('square', 520, 520, 0.06, 0.12); tone('square', 780, 780, 0.06, 0.12, 0.06); tone('square', 1040, 1040, 0.1, 0.12, 0.12); break;
        case 'hit': noise(0.35, 0.35, 1200); tone('sawtooth', 320, 50, 0.4, 0.18); break;
        case 'bump': tone('triangle', 140, 50, 0.12, 0.3); noise(0.08, 0.15, 600); break;
        // tyre squeal for a spin-out: a high sliding screech over hiss
        case 'skid': tone('sawtooth', 1500, 820, 0.55, 0.07); tone('square', 1180, 700, 0.5, 0.04, 0.03); noise(0.6, 0.16, 4200); break;
        // hard wall hit: a low thud + crunch
        case 'wall': tone('sine', 110, 38, 0.28, 0.4); tone('triangle', 220, 60, 0.16, 0.22); noise(0.22, 0.3, 900); break;
        case 'lap': [660, 880, 1100].forEach((f, i) => tone('square', f, f, 0.1, 0.14, i * 0.09)); break;
        case 'finish': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, i === 5 ? 0.5 : 0.12, 0.15, i * 0.12)); break;
        case 'spooky': tone('sine', 620, 140, 1.3, 0.22); tone('triangle', 930, 210, 1.1, 0.1, 0.12); tone('square', 92, 60, 1.2, 0.06); noise(0.9, 0.12, 700); break;
        case 'gauge': tone('square', 1200, 1200, 0.05, 0.1); tone('square', 1600, 1600, 0.08, 0.1, 0.06); break;
        case 'glitch': for (let i = 0; i < 7; i++) { const f = 200 + Math.random() * 1800; tone(i & 1 ? 'square' : 'sawtooth', f, f * (0.5 + Math.random()), 0.05, 0.1, i * 0.045); } noise(0.3, 0.12, 4000, 0.05); break;
        case 'sale': [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => tone('square', f, f, i === 5 ? 0.3 : 0.08, 0.13, i * 0.09)); break;
        case 'box': [880, 1175, 1480].forEach((f, i) => tone('square', f, f, 0.05, 0.1, i * 0.04)); noise(0.12, 0.08, 3000); break;
        case 'missile': tone('sawtooth', 260, 900, 0.35, 0.12); noise(0.35, 0.12, 2500); break;
        case 'stall': noise(0.45, 0.2, 900); tone('sawtooth', 110, 70, 0.4, 0.12); break;
        case 'pass': tone('square', 988, 988, 0.05, 0.1); tone('square', 1480, 1480, 0.09, 0.1, 0.05); break;
        default: tone('square', 700, 700, 0.05, 0.08);
      }
    } catch (e) { /* ignore */ }
  }

  // engine: pitch climbs with speed through 4 soft 'gears' (a small dip at each shift), brighter and
  // louder on the throttle; offroad muffles and lowers it; wall / kart hits make it drop with a thud
  // (engDip). The drift squeal loop (skidG) follows the player's drift and hard braking.
  const GEARS = [0, 0.28, 0.52, 0.76, 1.5];
  function updateEngine() {
    if (!ac || !engG) return;
    const p = G.player, st = G.state, t = ac.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - engLastT)); engLastT = t;
    engDip = Math.max(0, engDip - dt * 2.2);
    let vol = 0, f = 45, fc = 400, sq = 0, sf = 2600, so = 950;
    if (p && !G.attract && (st === 'countdown' || st === 'race' || st === 'finished')) {
      const r = Math.min(1.5, Math.abs(p.v || 0) / ((p.def && p.def.maxV) || 140));
      const b = p.boostT > 0, gas = st === 'countdown' ? (keys.ArrowUp || keys.KeyW || touch.gas) : lastGas && st === 'race';
      let gi = 0; while (gi < GEARS.length - 2 && r >= GEARS[gi + 1]) gi++;
      const inGear = Math.min(1, (r - GEARS[gi]) / (GEARS[gi + 1] - GEARS[gi]));   // 0..1 within this gear
      f = 40 + r * 70 + inGear * 38 + gi * 6 + (b ? 30 : 0) + (gas ? 10 : 0) + (st === 'countdown' && gas ? 25 : 0);
      fc = 250 + f * (gas ? 8 : 5.5);
      vol = 0.045 + r * 0.035 + (gas ? 0.02 : 0) + (b ? 0.05 : 0);
      if (p.offroad && Math.abs(p.v) > 5) { f *= 0.82; fc *= 0.45; vol *= 1.1; }   // bogged down in the grass / dirt
      if (engDip > 0) { f *= 1 - 0.42 * engDip; fc *= 1 - 0.55 * engDip; }        // 쿵: the revs fall away
      // tyre squeal: drifting fast (louder with a bigger slip), or braking hard on the road
      const slip = Math.abs(Math.sin(U.angDiff(p.ma, p.a) || 0));
      if (st === 'race' && !p.offroad && Math.abs(p.v) > 30) {
        if (p.drift) { sq = 0.05 + Math.min(0.06, slip * 0.12); sf = 2200 + slip * 1600; so = 820 + slip * 420 + Math.sin(t * 31) * 40; }
        else if (p._brake) { sq = 0.04; sf = 3000; so = 1150 + Math.sin(t * 40) * 50; }
      }
    }
    try {
      engO.frequency.setTargetAtTime(f, t, 0.06);
      engO2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      engF.frequency.setTargetAtTime(fc, t, 0.06);
      engG.gain.setTargetAtTime(vol, t, 0.1);
      if (skidG) {
        skidG.gain.setTargetAtTime(G.muted ? 0 : sq, t, sq > 0 ? 0.03 : 0.08);
        skidF.frequency.setTargetAtTime(sf, t, 0.05);
        skidO.frequency.setTargetAtTime(so, t, 0.03);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // online 2P (js/net.js): a 2-kart race (me + the friend's network-driven kart, no AI).
  // slot 0 = host (left), slot 1 = guest (right), side by side on the front row.
  // Online races count like test races (no best times / ranking / unlocks); coins are still banked.
  // ---------------------------------------------------------------------------
  function startOnlineRace(defIdx, mapId, slot, remoteDef) {
    ghostMode = false;
    if (playable().indexOf(defIdx) < 0) defIdx = NORMAL_KARTS[0];
    if (!MAPS()[mapId]) mapId = REGULAR[0];
    if (!(remoteDef >= 0 && remoteDef < PK.Karts.DEFS.length)) remoteDef = NORMAL_KARTS[0];
    testMode = true; ghostReward = ''; playerDef = defIdx;
    raceItem = equipped(); itemUsed = false; itemPrev = true;
    if (el.tbItem) el.tbItem.classList.remove('used');
    foodRace = 0; coinsBanked = false; saleAt = -1; saleDone = false;
    rsFrom = -1;
    G.online = true;
    G.state = 'countdown';
    showOnly('race');
    setupRace(defIdx, false, mapId);
    const N = PK.Track.N, gi = ((N - 4) % N + N) % N;
    const mk2 = (di, lat, me) => {
      const k = PK.Karts.create(di, gi, lat, me);
      k.lapTimes = []; k.maxLap = 0; k._mLap = 0; k.lapStart = 0; k.finished = false; k.finishTime = 0;
      return k;
    };
    const p = mk2(defIdx, slot ? 10 : -10, true), r = mk2(remoteDef, slot ? -10 : 10, false);
    r.remote = true; r.name = 'FRIEND';
    G.karts = [p, r]; G.standings = G.karts.slice(); G.player = p;
    camA = p.a; camX = p.x - Math.cos(camA) * C.CAM_DIST; camY = p.y - Math.sin(camA) * C.CAM_DIST;
    cdT = 3; lastCd = 4; goT = 0; surpriseT = 0;
    showMapBanner(mapId, false);
    if (musicCur === mapId) musicCur = null;
    musicPlay(mapId);
    return r;
  }
  // what js/net.js needs from the engine (no other access to main.js internals)
  G.ext = {
    startOnlineRace, goTitle,
    showOnly: (w) => showOnly(w),
    playable: () => playable(),
    kart: () => selIdx,
    setKart: (i) => { if (playable().indexOf(i) >= 0) { selIdx = i; lsSet(LS_KART, String(i)); } },
    maps: () => selectableMaps(),
    mapName: (id) => mapInfo(id).nameKo,
    attract: (mapId) => { G.attract = true; if (raceMap !== mapId || !G.karts.length || G.online || G.karts.some((k) => k.remote)) { G.online = false; setupRace(randomKart(), true, mapId); } },
    beep: (k) => uiBeep(k), audio: () => ensureAudio(), sfx: (n) => sfx(n), fmt: (t) => fmt(t),
    finT: () => finT, raceTime: () => G.raceTime,
    clearKeys: () => { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; },
  };
})(window.PK);
