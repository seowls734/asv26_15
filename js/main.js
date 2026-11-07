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
  const AI_SPEED = 1.5;                                           // AI rivals run 1.5× the player's speed
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
  const playable = () => {
    const r = NORMAL_KARTS.slice();
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
  // easy controls ('쉬운 조작', on by default): auto gas, steering help toward the racing line, auto drift
  const LS_EASY = 'pk_easy';
  let easy = true;
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

  // best times per map: map 0 keeps the old key, the others 'pk_best_v1_m<id>'
  const bestKey = (id) => (id === 0 ? LS_BEST : LS_BEST + '_m' + id);
  function loadBest(id) {
    try { const b = JSON.parse(lsGet(bestKey(id)) || 'null'); if (b) return { total: +b.total || 0, lap: +b.lap || 0 }; } catch (e) { /* ignore */ }
    return { total: 0, lap: 0 };
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
      coins: document.getElementById('coins'), btnItem: document.getElementById('btnItem'), tbItem: document.getElementById('tbItem'),
      btnCalm: document.getElementById('btnCalm'), btnEasy: document.getElementById('btnEasy'),
      ctest: document.getElementById('ctest'), ctList: document.getElementById('ctList'), ctMaps: document.getElementById('ctMaps'),
      ctInfo: document.getElementById('ctInfo'), ctGhost: document.getElementById('ctGhost'), ctGlitch: document.getElementById('ctGlitch'),
      btnTest: document.getElementById('btnTest'), btnMapTest: document.getElementById('btnMapTest'),
      mtest: document.getElementById('mtest'), mtList: document.getElementById('mtList'),
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
    resize();
    window.addEventListener('resize', resize);
    goTitle();
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
  function showOnly(which) {
    show(el.title, which === 'title'); show(el.select, which === 'select'); show(el.maps, which === 'maps');
    show(el.pause, which === 'pause'); show(el.shop, which === 'shop');
    show(el.ctest, which === 'ctest'); show(el.mtest, which === 'mtest');
    if (which === 'pause') musicStop();
    else if (which !== 'race') musicPlay(-1);   // menus: calm title loop
    const racing = which === 'race' || which === 'pause';
    show(el.touch, coarse && which === 'race');
    if (el.tbItem) el.tbItem.style.display = raceItem && !ITEMS()[raceItem].auto ? '' : 'none';
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
    G.state = 'title'; G.attract = true;
    showOnly('title');
    updateBestText();
    setupRace(randomKart(), true, baseMap);
  }

  function randomKart() { return NORMAL_KARTS[(Math.random() * NORMAL_KARTS.length) | 0]; }

  // '게임 시작': kart select for the next map of the rotation
  function startGame() { pendingMap = baseMap; selectFrom = 'title'; goSelect(); }

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
    G.state = 'maps'; G.attract = true;
    showOnly('maps');
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
  let shopSel = 0, shopCards = [], shopMsg = '';
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
    list.innerHTML = '';
    shopCards = [];
    const eq = equipped();
    ids.forEach((id, i) => {
      const it = I[id], n = owned(id), can = wallet() >= it.price;
      const c = mk('div', 'icard' + (id === eq ? ' eq' : ''));
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
    shopSel = U.clamp(shopSel, 0, Math.max(0, shopCards.length - 1));
    refreshShopSel();
  }
  function refreshShopSel() {
    for (let i = 0; i < shopCards.length; i++) shopCards[i].classList.toggle('sel', i === shopSel);
    const c = shopCards[shopSel];
    if (c && c.scrollIntoView && G.state === 'shop') { try { c.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }
  function shopBuy(id) {
    const it = ITEMS()[id];
    if (!it) return;
    if (buyItem(id)) { uiBeep(1); shopMsg = it.nameKo + ' 구매!'; }
    else { uiBeep(0); shopMsg = '코인이 부족해요'; }
    buildShop();
  }
  function shopEquip(id) {
    if (owned(id) <= 0) { uiBeep(0); shopMsg = '먼저 구매하세요'; }
    else if (equipped() === id) { setEquip(''); uiBeep(0); shopMsg = '장착 해제'; }
    else { setEquip(id); uiBeep(1); shopMsg = ITEMS()[id].nameKo + ' 장착'; }
    buildShop();
  }
  const shopId = () => (PK.Skills.ITEM_IDS || [])[shopSel];

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
    if (roll && SECRET_MAPS.indexOf(mapId) < 0) {
      // 1% glitch world first (only once map.js has it), then the 10% ghost map
      if (hasGlitchMap() && Math.random() < GLITCH_CHANCE) { mapId = GLITCH_MAP; surprise = true; }
      else if (Math.random() < GHOST_CHANCE) { mapId = GHOST_MAP; surprise = true; }
    }
    // this race's item: the equipped one, if any are left (spent only when used)
    raceItem = equipped(); itemUsed = false; itemPrev = true;
    if (el.tbItem) el.tbItem.classList.remove('used');
    foodRace = 0; coinsBanked = false; saleAt = -1; saleDone = false;
    G.state = 'countdown';
    showOnly('race');
    setupRace(defIdx, false, mapId);
    cdT = surprise ? 4.4 : 3; lastCd = 4; goT = 0;
    surpriseT = surprise ? 1.4 : 0;
    showMapBanner(mapId, surprise);
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
  const ITEM_EN = { rocket: 'ROCKET START!', turbo: 'TURBO!', magnet: 'FOOD MAGNET!', banana: 'BANANA BOMB!', shield: 'SHIELD!', cloak: 'CLOAK!' };
  // player ate a food: +1 coin up to FOOD_CAP per race
  function onFood(k) {
    if (G.attract || !k.isPlayer || G.state !== 'race') return;
    if (foodRace < FOOD_CAP) {
      foodRace++;
      toast(foodRace >= FOOD_CAP ? 'FOOD ' + FOOD_CAP + '/' + FOOD_CAP + ' MAX!' : '+1 FOOD ' + foodRace + '/' + FOOD_CAP);
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
  function retryRace() { startRace(playerDef, raceMap, false, testMode); }
  function nextRace() {
    if (testMode) { testBack(); return; }
    startRace(playerDef, REGULAR[(REGULAR.indexOf(baseMap) + 1) % REGULAR.length], true);
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
    attractT = 0; finT = 0; newRecord = false; newLapRecord = false;
    toastT = 0; bannerT = 0; shakeT = 0;
    const p = G.player;
    camA = p.a;
    camX = p.x - Math.cos(camA) * C.CAM_DIST; camY = p.y - Math.sin(camA) * C.CAM_DIST;
  }

  // ---------------------------------------------------------------------------
  // pause menu
  // ---------------------------------------------------------------------------
  function openPause() {
    if (!RACE_STATES[G.state]) return;
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
    banner('FINISH!', '#ffffff');
    const bl = k.lapTimes.length ? Math.min.apply(null, k.lapTimes) : 0;
    if (!(best.total > 0) || k.finishTime < best.total) { best.total = k.finishTime; newRecord = true; }
    if (bl > 0 && (!(best.lap > 0) || bl < best.lap)) { best.lap = bl; newLapRecord = true; }
    if (testMode) { newRecord = false; newLapRecord = false; }
    if (newRecord || newLapRecord) lsSet(bestKey(raceMap), JSON.stringify(best));
    bankCoins();
    if (!testMode) rollGhostReward(k);
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
    return PIN;
  }

  // easy controls: borrow the AI's racing-line steer/drift for the player and blend it with the input.
  // No steer held -> the kart follows the road by itself; steering still wins when the player turns.
  function easyAssist(inp) {
    const p = G.player;
    if (!p || !PK.Karts.aiInput) return;
    let ai;
    try { ai = PK.Karts.aiInput(p, G); } catch (e) { return; }
    if (!ai) return;
    const user = +inp.steer || 0, aiS = U.clamp(+ai.steer || 0, -1, 1);
    inp.steer = Math.abs(user) < 0.05 ? aiS * 0.9 : U.clamp(user * 0.7 + aiS * 0.35, -1, 1);
    inp.left = inp.steer < -0.3; inp.right = inp.steer > 0.3;
    if (!inp.brake) inp.gas = true;                      // auto accelerate (brake still stops)
    if (ai.drift && Math.abs(inp.steer) > 0.35) inp.drift = true;   // corners drift by themselves
  }

  const isEnter = (c) => c === 'Enter' || c === 'Space' || c === 'NumpadEnter';
  const PREVENT = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1 };
  function onKeyDown(e) {
    ensureAudio();
    const c = e.code || e.key;
    if (PREVENT[c]) e.preventDefault();
    const rep = e.repeat;
    keys[c] = true;
    if (rep) return;
    if (c === 'KeyM') { toggleMute(); return; }
    const st = G.state;
    if (st === 'title') {
      if (isEnter(c)) { uiBeep(1); startGame(); }
      else if (c === 'KeyL') { uiBeep(0); goMaps(); }
      else if (c === 'KeyS') { uiBeep(0); goShop(); }
      else if (c === 'KeyV') toggleCalm();
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
      if (d) { shopSel = ((shopSel + d) % n + n) % n; refreshShopSel(); uiBeep(0); }
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
    on(el.btnMaps, () => { ensureAudio(); uiBeep(1); goMaps(); });
    on(el.btnMapsBack, () => { uiBeep(0); goTitle(); });
    on(el.btnShop, () => { ensureAudio(); uiBeep(1); goShop(); });
    on(el.btnShopBack, () => { uiBeep(0); goTitle(); });
    on(el.btnItem, () => { ensureAudio(); cycleItem(); });
    on(el.btnCalm, () => { ensureAudio(); toggleCalm(); });
    on(el.btnEasy, () => { ensureAudio(); toggleEasy(); });
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
    // the 6 normal karts, plus the ghost once won on the ghost map (the vampire stays a rival)
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
    if (race && ib && !itemPrev) useRaceItem();
    itemPrev = ib;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      const inp = (k.isPlayer && race) ? playerInput() : K.aiInput(k, G);
      // skill rising edge must be checked BEFORE update (update overwrites k.prev)
      if (inp && inp.skill && !(k.prev && k.prev.skill)) PK.Skills.tryUse(k, G);
      K.update(k, inp, dt, G);
    }
    K.collide(ks);
    PK.Skills.update(dt, G);
  }

  function step(dt) {
    G.time += dt;
    if (toastT > 0) toastT -= dt;
    if (bannerT > 0) bannerT -= dt;
    if (shakeT > 0) shakeT -= dt;
    const st = G.state;
    if (st === 'paused') return;     // frozen: no simulation, race timer stopped
    if (goT > 0) goT -= dt;
    if (surpriseT > 0) surpriseT -= dt;
    if (mapBannerT > 0) { mapBannerT -= dt; if (mapBannerT <= 0) hideMapBanner(); }
    if (st === 'title' || st === 'select' || st === 'maps' || st === 'shop' || st === 'ctest' || st === 'mtest') {
      simulate(dt);
      attractT += dt;
      if (attractT > ATTRACT_RESET) setupRace(randomKart(), true, raceMap);
    } else if (st === 'countdown') {
      cdT -= dt;
      const n = Math.ceil(cdT);
      if (n < lastCd && n >= 1) { lastCd = n; sfx('beep'); }
      if (cdT <= 0) {
        G.state = 'race'; goT = 0.9; sfx('go');
        if (raceItem && ITEMS()[raceItem].auto) useRaceItem();   // 로켓 스타트 fires at GO
      }
    } else if (st === 'race' || st === 'finished') {
      G.raceTime += dt;
      if (st === 'finished') finT += dt;
      simulate(dt);
      if (st === 'race') updateSale(dt);
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
  let pfx = 1, pfy = 0, prx = 0, pry = 1;

  // project one world object; returns true if added
  function addBill(n, x, y, h, spr, w, kart) {
    const dx = x - camX, dy = y - camY;
    const z = dx * pfx + dy * pfy;
    if (z < 3 || z > FOG_FAR) return n;
    const s = FOCAL / z;
    const sx = CX + (dx * prx + dy * pry) * s;
    const sw = w * s;
    if (sx + sw < 0 || sx - sw > W) return n;
    const r = getRec(n);
    r.z = z; r.sx = sx; r.gy = HOR + CAM_H * s; r.s = s; r.spr = spr; r.w = w; r.h = h || 0; r.kart = kart;
    vis[n] = r;
    return n + 1;
  }

  function drawBillboards() {
    const T = PK.Track;
    pfx = Math.cos(camA); pfy = Math.sin(camA); prx = -pfy; pry = pfx;
    let n = 0;
    const props = T.props || [];
    for (let i = 0; i < props.length; i++) { const p = props[i]; if (p.spr) n = addBill(n, p.x, p.y, 0, p.spr, p.w, null); }
    const ks = G.karts;
    for (let i = 0; i < ks.length; i++) { const k = ks[i]; n = addBill(n, k.x, k.y, 0, null, KART_W, k); }
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
      ctx.drawImage(spr, Math.round(r.sx - sw / 2), Math.round(bottom - sh), Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
    }
    PK.Karts.drawFx(ctx, k, r.sx, r.gy, sw);
  }

  function drawSpeedLines() {
    const p = G.player;
    if (calm || !p || !(p.boostT > 0) || G.state === 'countdown') return;
    // a few short, faint streaks at the screen edges (boost only)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 4; i++) {
      const left = i & 1;
      const y = HOR + 20 + ((Math.random() * (H - HOR - 30)) | 0);
      const len = 6 + ((Math.random() * 12) | 0);
      const x = left ? ((Math.random() * 18) | 0) : W - len - ((Math.random() * 18) | 0);
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
    ctx.restore();
    const fx = PK.Track.fx;
    if (fx === 'haunted') drawNightFx();
    else if (fx === 'dusk') drawDuskFx();
    else if (fx === 'frost') drawFrostFx();
    if (fx === 'glitch' || glitchT > 0) drawGlitchFx(fx === 'glitch' && G.state !== 'paused');
    if (surpriseT > 0 && !calm) drawSurprise();
    drawSpeedLines();
    const st = G.state === 'paused' ? pauseFrom : G.state;
    if (st === 'countdown' || st === 'race' || st === 'finished') drawHUD(st);
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
    if (coarse) textC(mapTag, CX, 16, 1, ghost ? '#c8a0ff' : '#a898c8');
    else text(mapTag, 4, 23, 1, ghost ? '#c8a0ff' : '#a898c8');
    // position (top-right)
    if (pos >= 0) {
      const ps = ORD[pos] || (pos + 1) + 'TH';
      const pr = W - 28;   // leaves the top-right corner to the ⏸ button
      textR(ps.slice(0, 1), pr - textW(ps.slice(1), 2) - 2, 4, 4, POSCOL[pos] || '#fff');
      textR(ps.slice(1), pr, 4, 2, POSCOL[pos] || '#fff');
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

    // banner + toast
    if (bannerT > 0 && st !== 'countdown') textC(bannerText, CX, 34, 3, bannerCol);
    if (toastT > 0) textC(toastText, CX, bannerT > 0 ? 50 : 36, 2, '#9fe8ff');

    // results
    if (st === 'finished' && finT > 1.2) drawResults(stand, blink);
  }

  function drawResults(stand, blink) {
    const px = 46, py = 22, pw = 228, ph = 136;
    ctx.fillStyle = '#000'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    ctx.fillStyle = 'rgba(30,20,48,0.94)'; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#ff8800'; ctx.fillRect(px, py, pw, 2); ctx.fillRect(px, py + ph - 2, pw, 2);
    textC('RESULTS', CX, py + 6, 2, '#ffcc00');
    // coins earned this race (left) / wallet (right)
    const fi = PK.Skills.foodIcon && PK.Skills.foodIcon(0);
    if (fi) ctx.drawImage(fi, px + 6, py + 5, 9, 9);
    text('+' + foodRace + (testMode ? ' TEST' : ''), px + 17, py + 7, 1, '#ffe14d', false);
    textR('COIN ' + wallet(), px + pw - 6, py + 7, 1, '#ffe14d', false);
    textC((raceMap === GHOST_MAP ? '??? ' : 'MAP ' + (raceMap + 1) + ' ') + (PK.Track.nameEn || ''), CX, py + 15, 1, raceMap === GHOST_MAP ? '#c8a0ff' : '#a898c8', false);
    const c0 = px + 8, cChip = px + 20, cName = px + 32, cTime = px + 64, cLap = px + 120, cTag = px + 176;
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
      textC(newRecord ? 'NEW RECORD!' : 'NEW LAP RECORD!', CX, y, 2, blink ? '#ff8800' : '#ffe14d');
    }
    if (ghostReward === 'got') textC('GHOST KART UNLOCKED!', CX, y + 12, 1, blink ? '#c8a0ff' : '#ffffff');
    else if (ghostReward === 'miss') textC('THE GHOST GOT AWAY...', CX, y + 12, 1, '#a898c8');
    else if (ghostReward === 'glitch') textC('GLITCH KART UNLOCKED!', CX, y + 12, 1, blink ? '#00e8b8' : '#ff40d0');
    if (((G.time * 2) | 0) & 1) textC(testMode ? 'ENTER: CHAR TEST  R: RETRY  ESC: MENU' : 'ENTER: NEXT MAP  R: RETRY  ESC: MENU', CX, py + ph - 10, 1, '#fff');
  }

  // ---------------------------------------------------------------------------
  // audio
  // ---------------------------------------------------------------------------
  let ac = null, master = null, sfxBus = null, engO = null, engO2 = null, engF = null, engG = null, noiseBuf = null;
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
    if (!G.attract && name === 'glitch') glitchT = 0.35;   // teleport / glitch world: brief screen glitch
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
        case 'lap': [660, 880, 1100].forEach((f, i) => tone('square', f, f, 0.1, 0.14, i * 0.09)); break;
        case 'finish': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, i === 5 ? 0.5 : 0.12, 0.15, i * 0.12)); break;
        case 'spooky': tone('sine', 620, 140, 1.3, 0.22); tone('triangle', 930, 210, 1.1, 0.1, 0.12); tone('square', 92, 60, 1.2, 0.06); noise(0.9, 0.12, 700); break;
        case 'gauge': tone('square', 1200, 1200, 0.05, 0.1); tone('square', 1600, 1600, 0.08, 0.1, 0.06); break;
        case 'glitch': for (let i = 0; i < 7; i++) { const f = 200 + Math.random() * 1800; tone(i & 1 ? 'square' : 'sawtooth', f, f * (0.5 + Math.random()), 0.05, 0.1, i * 0.045); } noise(0.3, 0.12, 4000, 0.05); break;
        case 'sale': [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => tone('square', f, f, i === 5 ? 0.3 : 0.08, 0.13, i * 0.09)); break;
        default: tone('square', 700, 700, 0.05, 0.08);
      }
    } catch (e) { /* ignore */ }
  }

  function updateEngine() {
    if (!ac || !engG) return;
    const p = G.player, st = G.state, t = ac.currentTime;
    let vol = 0, f = 45;
    if (p && !G.attract && (st === 'countdown' || st === 'race' || st === 'finished')) {
      const r = Math.min(1.5, Math.abs(p.v || 0) / ((p.def && p.def.maxV) || 140));
      const b = p.boostT > 0;
      f = 42 + r * 95 + (b ? 30 : 0) + (st === 'countdown' && (keys.ArrowUp || keys.KeyW || touch.gas) ? 25 : 0);
      vol = 0.05 + r * 0.04 + (b ? 0.05 : 0);
    }
    try {
      engO.frequency.setTargetAtTime(f, t, 0.06);
      engO2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      engF.frequency.setTargetAtTime(250 + f * 7, t, 0.06);
      engG.gain.setTargetAtTime(vol, t, 0.1);
    } catch (e) { /* ignore */ }
  }
})(window.PK);
