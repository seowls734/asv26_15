// PK.Net — online 2-player races with a 6-digit room code (PeerJS: WebRTC DataChannel + the free
// PeerJS cloud signalling server). The host registers the peer id 'pixelkart-<code>', the guest
// connects to it. Each side drives its own kart and streams its state ~20×/s; the friend's kart is
// a normal kart object in G.karts (k.remote = true) moved only by these states (main.js simulate()
// calls PK.Net.drive / PK.Net.pin instead of physics + AI), so standings, minimap, 3D view and HUD
// treat it like any other kart. Foods / items / skills stay local to each screen.
//
// Messages (JSON over one reliable DataChannel):
//   hello {v, def}            my kart (sent on connect and whenever I change it in the lobby)
//   lobby {}                  I am in the room lobby, ready for a race
//   map   {map}               host's chosen map (shown to the guest)
//   start {map, seed, delay, hostDef, guestDef}   both start the countdown `delay` s after receipt
//   s     {x,y,a,ma,v,lap,prog,fin,ft,hop,dr,dd,bt,sp,ph}   kart state ~20 Hz during a race
//   fin   {time}              I crossed the line (race time in s)
//   ping {ts} / pong {ts}     heartbeat (1/s) + round-trip time for the start sync
//   bye   {}                  I left the room
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const PREFIX = 'pixelkart-', VER = 1;
  const SEND_DT = 1 / 20;          // state send interval
  const INTERP = 0.1;              // the friend's kart is shown 100 ms in the past (smooth)
  const START_DELAY = 1.2;         // s between the host's 출발! and both countdowns
  const JOIN_TIMEOUT = 12000, GONE_TIMEOUT = 10000;

  const N = PK.Net = {
    active: false,                 // a peer exists (lobby or online race)
    key, tick, drive, pin, menu, toLobby, leave, open: openLobby,
    _now: null,                    // test hook: clock override (seconds)
  };
  const now = () => (N._now ? N._now() : (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000);
  const G = () => PK.Game, X = () => (PK.Game && PK.Game.ext) || null;

  // ---------------------------------------------------------------- state
  let peer = null, conn = null, role = '', code = '', view = 'menu', connected = false;
  let friendDef = -1, friendIn = false, mapId = -1, seed = 0;
  let inRace = false, startAt = -1, startMsg = null;
  let snaps = [], sendAcc = 0, rtt = 0.15, lastRx = 0, hbTimer = null, joinTimer = null, idTries = 0;
  let myFinSent = false, friendFin = 0, friendLeftToast = false, menuOpen = false, resShown = '';
  let el = null;

  // ---------------------------------------------------------------- DOM
  const $ = (id) => document.getElementById(id);
  function mk(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function btn(text, cls, parent, fn) {
    const b = mk('button', 'btn' + (cls ? ' ' + cls : ''), text, parent);
    b.addEventListener('click', (e) => { if (e && e.stopPropagation) e.stopPropagation(); const x = X(); if (x) x.audio(); fn(); });
    return b;
  }
  const show = (e, on) => { if (e && e.classList) e.classList.toggle('on', !!on); };
  const disp = (e, on) => { if (e) e.style.display = on ? '' : 'none'; };
  const CSS = '#online .panel,#onRes .panel,#onPause .panel{text-align:center;max-width:30em}' +
    '#online h2,#onRes h2{margin:.1em 0 .4em;color:#ffcc00;font-size:1.5em;text-shadow:.08em .08em 0 #000}' +
    '#online .btn,#onRes .btn,#onPause .btn{min-height:2.6em;min-width:7em}' +
    '#onCodeBig{font-size:2.6em;letter-spacing:.15em;color:#ffe14d;text-shadow:.06em .06em 0 #000;margin:.1em 0}' +
    '#onCode{font:inherit;font-size:1.8em;width:7em;text-align:center;letter-spacing:.15em;padding:.2em;border:.15em solid #000;background:#fff8d8}' +
    '#onStatus{margin:.4em 0;color:#9fe8ff;min-height:1.2em}' +
    '.onPl{display:flex;justify-content:center;gap:1.2em;margin:.3em 0;flex-wrap:wrap}.onPl div{min-width:8em}' +
    '.onPl b{display:block;color:#ffcc00}.onPl canvas{width:3.2em;image-rendering:pixelated;display:block;margin:.1em auto}' +
    '#onMaps .btn{font-size:.85em;min-width:0;min-height:2.3em;padding:.2em .6em}#onMaps .btn.sel{background:#ffe14d;outline:.15em solid #fff}' +
    '#onRes{background:rgba(5,3,10,.45)}#onResWin{font-size:2.4em;margin:.1em 0}#onResWin.win{color:#ffe14d}#onResWin.lose{color:#b8a8d8}' +
    '#onResTimes{margin:.3em 0 .6em;line-height:1.6}' +
    '#onToast{position:absolute;left:50%;top:12%;transform:translateX(-50%);display:none;z-index:50;pointer-events:none;' +
    'background:#2a1f3d;border:.2em solid #000;color:#fff;padding:.4em 1em;box-shadow:.2em .2em 0 #000;white-space:nowrap}#onToast.on{display:block}';
  function build() {
    if (el) return el;
    const wrap = $('wrap') || document.body;
    try { const st = mk('style', null, CSS); (document.head || wrap).appendChild(st); } catch (e) { /* ignore */ }
    el = {};
    // lobby overlay
    el.ov = mk('div', 'ov', null, wrap); el.ov.id = 'online';
    const p = mk('div', 'panel', null, el.ov);
    mk('h2', null, '🎮 2인용 (온라인)', p);
    el.vMenu = mk('div', null, null, p);
    mk('div', null, '친구와 같은 방 번호로 만나서 달려요!', el.vMenu);
    btn('🏠 방 만들기', '', el.vMenu, host);
    btn('🚪 방 들어가기', 'alt', el.vMenu, () => setView('join'));
    el.vJoin = mk('div', null, null, p);
    mk('div', null, '친구에게 받은 방 번호 6자리', el.vJoin);
    el.code = mk('input', null, null, el.vJoin); el.code.id = 'onCode';
    el.code.type = 'tel'; el.code.setAttribute('inputmode', 'numeric'); el.code.setAttribute('pattern', '[0-9]*');
    el.code.setAttribute('maxlength', '6'); el.code.setAttribute('autocomplete', 'off'); el.code.placeholder = '000000';
    el.code.addEventListener('input', () => { const v = String(el.code.value || '').replace(/\D/g, '').slice(0, 6); if (v !== el.code.value) el.code.value = v; });
    el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); join(el.code.value); } });
    mk('br', null, null, el.vJoin);
    el.joinBtn = btn('입장', '', el.vJoin, () => join(el.code.value));
    el.vRoom = mk('div', null, null, p);
    el.codeLab = mk('div', null, '방 번호', el.vRoom);
    el.codeBig = mk('div', null, '------', el.vRoom); el.codeBig.id = 'onCodeBig';
    const pl = mk('div', 'onPl', null, el.vRoom);
    el.me = mk('div', null, null, pl); el.fr = mk('div', null, null, pl);
    el.kartRow = mk('div', null, null, el.vRoom);
    btn('◀', 'alt', el.kartRow, () => cycleKart(-1));
    mk('span', null, ' 내 카트 ', el.kartRow);
    btn('▶', 'alt', el.kartRow, () => cycleKart(1));
    el.mapLab = mk('div', null, '', el.vRoom);
    el.maps = mk('div', null, null, el.vRoom); el.maps.id = 'onMaps';
    el.go = btn('출발!', 'blink', el.vRoom, hostStart);
    el.status = mk('div', null, '', p); el.status.id = 'onStatus';
    btn('← 뒤로', 'alt', p, back);
    // results overlay
    el.res = mk('div', 'ov', null, wrap); el.res.id = 'onRes';
    const rp = mk('div', 'panel', null, el.res);
    mk('h2', null, '결과', rp);
    el.resWin = mk('div', null, '', rp); el.resWin.id = 'onResWin';
    el.resTimes = mk('div', null, '', rp); el.resTimes.id = 'onResTimes';
    btn('🔁 방으로 (Enter)', '', rp, toLobby);
    btn('🚪 방 나가기 (Esc)', 'alt', rp, () => leave(''));
    // race menu (no real pause online: the race keeps going)
    el.pause = mk('div', 'ov', null, wrap); el.pause.id = 'onPause';
    const pp = mk('div', 'panel', null, el.pause);
    mk('div', null, '온라인 레이스는 멈출 수 없어요', pp);
    btn('▶ 계속하기 (Esc)', '', pp, () => menu(false));
    btn('🚪 방 나가기', 'alt', pp, () => leave(''));
    el.toast = mk('div', null, '', wrap); el.toast.id = 'onToast';
    return el;
  }
  let toastTimer = null;
  function toast(t, ms) {
    build();
    el.toast.textContent = t; show(el.toast, true);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(el.toast, false), ms || 2500);
  }
  function status(t) { if (el) el.status.textContent = t || ''; }
  function setView(v) {
    view = v;
    build();
    disp(el.vMenu, v === 'menu'); disp(el.vJoin, v === 'join'); disp(el.vRoom, v === 'room');
    if (v === 'join') {
      status('');
      el.code.value = '';
      try { el.code.focus(); } catch (e) { /* ignore */ }
    }
    if (v === 'menu') status(window.Peer ? '' : '');
    refreshRoom();
  }
  function kartCanvas(def) {
    const c = document.createElement('canvas');
    let spr = null;
    try { spr = PK.Karts.sprite(def, false); } catch (e) { spr = null; }
    c.width = (spr && spr.width) || 16; c.height = (spr && spr.height) || 12;
    const g = c.getContext && c.getContext('2d');
    if (g) { g.imageSmoothingEnabled = false; if (spr) g.drawImage(spr, 0, 0); else { g.fillStyle = '#888'; g.fillRect(0, 0, c.width, c.height); } }
    return c;
  }
  function who(box, label, def, wait) {
    box.innerHTML = '';
    mk('b', null, label, box);
    const D = PK.Karts.DEFS[def];
    if (D && !wait) { box.appendChild(kartCanvas(def)); const n = mk('span', null, D.nameKo, box); n.style.color = D.color; }
    else mk('span', null, wait || '-', box);
  }
  function refreshRoom() {
    if (!el || view !== 'room') return;
    const x = X();
    el.codeBig.textContent = code || '------';
    who(el.me, '나', x ? x.kart() : 0);
    who(el.fr, '친구', friendDef, connected ? (friendDef < 0 ? '연결 중…' : '') : '기다리는 중…');
    const isHost = role === 'host';
    if (x) {
      const ms = x.maps();
      if (mapId < 0 || !ms.some((m) => m.id === mapId)) mapId = ms.length ? ms[0].id : 0;
      el.mapLab.textContent = '맵: ' + x.mapName(mapId) + (isHost ? '' : ' (방장이 골라요)');
      el.maps.innerHTML = '';
      disp(el.maps, isHost);
      if (isHost) ms.forEach((m, i) => {
        const b = btn((i + 1) + '. ' + m.nameKo, 'alt' + (m.id === mapId ? ' sel' : ''), el.maps, () => pickMap(m.id));
        b.setAttribute('data-map', m.id);
      });
    }
    disp(el.go, isHost);
    const can = isHost && connected && friendIn && !inRace && startAt < 0;
    el.go.classList.toggle('off', !can);
    if (connected && !inRace && startAt < 0) status(isHost ? (friendIn ? '연결됨! 맵을 고르고 출발! 을 누르세요' : '친구가 결과 화면에 있어요…') : '연결됨! 방장이 출발을 누르면 시작해요');
  }

  // ---------------------------------------------------------------- lobby flow
  function openLobby() {
    const x = X();
    if (!x) return;
    build();
    G().state = 'online';
    x.showOnly('online');
    x.attract(mapId >= 0 ? mapId : (x.maps()[0] || { id: 0 }).id);
    show(el.ov, true); show(el.res, false); show(el.pause, false);
    setView(connected ? 'room' : 'menu');
    if (!window.Peer && !connected) status('온라인 연결을 할 수 없어요');
  }
  function closeOverlays() { if (el) { show(el.ov, false); show(el.res, false); show(el.pause, false); } menuOpen = false; resShown = ''; }
  function back() {
    const x = X();
    if (x) x.beep(0);
    if (view === 'menu') { destroy(); closeOverlays(); if (x) x.goTitle(); return; }
    if (connected) send({ t: 'bye' });
    destroy();
    setView('menu');
  }
  function noPeer() {
    if (window.Peer) return false;
    status('온라인 연결을 할 수 없어요');
    return true;
  }
  const newCode = () => String(100000 + Math.floor(Math.random() * 900000));
  function host() {
    if (noPeer()) return;
    destroy();
    role = 'host'; idTries = 0;
    hostTry();
  }
  function hostTry() {
    code = newCode();
    setView('room');
    status('방을 만드는 중…');
    let p;
    try { p = new window.Peer(PREFIX + code, { debug: 0 }); } catch (e) { status('온라인 연결을 할 수 없어요'); return; }
    peer = p; N.active = true;
    p.on('open', () => { if (peer !== p) return; status('친구를 기다리는 중… 방 번호를 알려주세요'); refreshRoom(); });
    p.on('connection', (c) => {
      if (peer !== p) return;
      if (conn) { try { c.on('open', () => { try { c.send({ t: 'bye', full: 1 }); } catch (e) { /* ignore */ } setTimeout(() => c.close(), 300); }); } catch (e) { /* ignore */ } return; }
      useConn(c);
    });
    p.on('error', (err) => {
      if (peer !== p) return;
      const t = err && err.type;
      if (t === 'unavailable-id' && idTries++ < 4) { try { p.destroy(); } catch (e) { /* ignore */ } peer = null; hostTry(); return; }
      if (conn && connected && t !== 'network' && t !== 'server-error' && t !== 'socket-error' && t !== 'socket-closed') return;   // P2P link still fine
      if (!connected) { status('온라인 연결을 할 수 없어요'); }
    });
    p.on('disconnected', () => { if (peer === p && !connected) status('온라인 연결을 할 수 없어요'); });
  }
  function join(raw) {
    const c6 = String(raw || '').replace(/\D/g, '');
    if (c6.length !== 6) { status('방 번호 6자리를 입력하세요'); return; }
    if (noPeer()) return;
    destroy();
    role = 'guest'; code = c6;
    status('연결 중…');
    let p;
    try { p = new window.Peer({ debug: 0 }); } catch (e) { status('온라인 연결을 할 수 없어요'); return; }
    peer = p; N.active = true;
    joinTimer = setTimeout(() => { if (peer === p && !connected) { destroy(); setView('join'); el.code.value = c6; status('방을 찾을 수 없어요'); } }, JOIN_TIMEOUT);
    p.on('open', () => {
      if (peer !== p) return;
      let c;
      try { c = p.connect(PREFIX + c6, { reliable: true, serialization: 'json' }); } catch (e) { status('온라인 연결을 할 수 없어요'); return; }
      useConn(c);
    });
    p.on('error', (err) => {
      if (peer !== p) return;
      const t = err && err.type;
      if (connected && t !== 'network' && t !== 'socket-error') return;
      if (connected) return;
      destroy(); setView('join'); el.code.value = c6;
      status(t === 'peer-unavailable' ? '방을 찾을 수 없어요' : '온라인 연결을 할 수 없어요');
    });
  }
  function useConn(c) {
    conn = c;
    c.on('open', () => {
      if (conn !== c) return;
      connected = true; lastRx = Date.now(); friendIn = false; friendDef = -1;
      if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
      setView('room');
      status('연결됨!');
      const x = X();
      send({ t: 'hello', v: VER, def: x ? x.kart() : 0 });
      send({ t: 'lobby' });
      if (role === 'host') send({ t: 'map', map: mapId });
      startHeartbeat();
      if (x) x.sfx('gauge');
      refreshRoom();
    });
    c.on('data', (d) => { if (conn === c) onData(d); });
    c.on('close', () => { if (conn === c) gone(); });
    c.on('error', () => { if (conn === c && !connected) status('온라인 연결을 할 수 없어요'); });
  }
  function send(m) {
    if (!conn || !connected) return;
    try { conn.send(m); } catch (e) { /* ignore */ }
  }
  function startHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(() => {
      if (!connected) return;
      send({ t: 'ping', ts: Date.now() });
      if (Date.now() - lastRx > GONE_TIMEOUT) gone();
    }, 1000);
  }
  function destroy() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    const c = conn, p = peer;
    conn = null; peer = null;
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    connected = false; friendIn = false; friendDef = -1; role = role || ''; inRace = false; startAt = -1; startMsg = null;
    snaps = []; N.active = false;
  }
  // the friend left (bye / channel closed / silent): banner + back to the title
  function gone() {
    if (!connected && !conn) return;
    destroy();
    role = ''; code = '';
    toast('상대가 나갔어요', 3000);
    const g = G(), x = X();
    if (g) g.online = false;
    closeOverlays();
    if (x) x.goTitle();
  }
  // I leave the room (menu / results Esc): tell the friend, back to the title
  function leave() {
    if (connected) send({ t: 'bye' });
    const c = conn;
    // give the bye a moment to go out before closing
    conn = null;
    setTimeout(() => { try { if (c) c.close(); } catch (e) { /* ignore */ } }, 200);
    destroy();
    role = ''; code = '';
    const g = G(), x = X();
    if (g) g.online = false;
    closeOverlays();
    if (x) { x.beep(0); x.goTitle(); }
  }
  function cycleKart(d) {
    const x = X();
    if (!x || inRace) return;
    const r = x.playable(), n = r.length;
    const pos = Math.max(0, r.indexOf(x.kart()));
    x.setKart(r[((pos + d) % n + n) % n]);
    x.beep(0);
    send({ t: 'hello', v: VER, def: x.kart() });
    refreshRoom();
  }
  function pickMap(id) {
    if (role !== 'host' || inRace) return;
    mapId = id;
    const x = X();
    if (x) { x.beep(0); x.attract(id); }
    send({ t: 'map', map: id });
    refreshRoom();
  }
  function hostStart() {
    const x = X();
    if (role !== 'host' || !connected || !friendIn || inRace || startAt >= 0 || !x) { if (x) x.beep(0); return; }
    x.beep(1);
    seed = (Math.random() * 1e9) | 0;
    const m = { t: 'start', map: mapId, seed, delay: Math.max(0.2, START_DELAY - rtt / 2), hostDef: x.kart(), guestDef: friendDef };
    send(m);
    friendIn = false;
    schedule(m, START_DELAY);
  }
  function schedule(m, delay) {
    startMsg = m; startAt = now() + delay;
    status('곧 출발해요!');
    refreshRoom();
  }
  function beginRace() {
    const m = startMsg, x = X();
    startAt = -1; startMsg = null;
    if (!m || !x || !connected) return;
    const me = role === 'host' ? m.hostDef : m.guestDef, fr = role === 'host' ? m.guestDef : m.hostDef;
    closeOverlays();
    snaps = []; sendAcc = 0; myFinSent = false; friendFin = 0; friendLeftToast = false;
    inRace = true;
    x.clearKeys();
    x.startOnlineRace(me, m.map, role === 'host' ? 0 : 1, fr >= 0 ? fr : 0);
  }

  // ---------------------------------------------------------------- messages
  function onData(d) {
    lastRx = Date.now();
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 's':
        if (!inRace) return;
        d.rx = now();
        snaps.push(d);
        if (snaps.length > 30) snaps.splice(0, snaps.length - 30);
        if (d.fin && d.ft > 0 && !friendFin) friendFinished(d.ft);
        break;
      case 'fin': if (inRace && d.time > 0 && !friendFin) friendFinished(+d.time); break;
      case 'hello': friendDef = (d.def | 0); refreshRoom(); break;
      case 'lobby': friendIn = true; refreshRoom(); break;
      case 'map': if (role === 'guest') { mapId = d.map | 0; const x = X(); if (x && G().state === 'online') x.attract(mapId); refreshRoom(); } break;
      case 'start':
        if (role !== 'guest' || inRace) return;
        mapId = d.map | 0; seed = d.seed | 0;
        schedule(d, Math.max(0, +d.delay || 0));
        break;
      case 'ping': send({ t: 'pong', ts: d.ts }); break;
      case 'pong': { const r = (Date.now() - (+d.ts || 0)) / 1000; if (r >= 0 && r < 5) rtt = rtt * 0.7 + r * 0.3; break; }
      case 'bye':
        if (d.full) { destroy(); setView('join'); status('방이 꽉 찼어요'); return; }
        gone();
        break;
      default: break;
    }
  }
  function friendFinished(t) {
    friendFin = t;
    const p = G().player;
    if (p && !p.finished && !friendLeftToast) { friendLeftToast = true; toast('친구가 먼저 들어왔어요!'); }
  }

  // ---------------------------------------------------------------- per-step (main.js step())
  function tick(dt) {
    if (startAt >= 0 && now() >= startAt) beginRace();
    const g = G();
    if (!inRace || !g) return;
    if (!g.online) { inRace = false; return; }   // left the race some other way
    const p = g.player;
    sendAcc += dt;
    if (p && sendAcc >= SEND_DT) {
      sendAcc = 0;
      const r2 = (v) => Math.round(v * 100) / 100;
      send({ t: 's', x: r2(p.x), y: r2(p.y), a: r2(p.a), ma: r2(typeof p.ma === 'number' ? p.ma : p.a), v: r2(p.v || 0),
        lap: p.lap | 0, prog: r2(p.prog || 0), fin: p.finished ? 1 : 0, ft: p.finishTime || 0,
        hop: r2(p.hop || 0), dr: p.drift ? 1 : 0, dd: p.driftDir || 0, bt: r2(p.boostT || 0),
        sp: p.fx && p.fx.spin > 0 ? 1 : 0, ph: r2((p.fx && p.fx.phase) || 0) });
    }
    if (p && p.finished && !myFinSent) { myFinSent = true; send({ t: 'fin', time: p.finishTime }); }
    // online results panel (DOM, Korean), shown like the canvas one after 1.2 s
    const x = X();
    if (g.state === 'finished' && x && x.finT() > 1.2) showResult();
  }
  function showResult() {
    build();
    const p = G().player, me = p.finishTime, fr = friendFin;
    const win = !(fr > 0) || me <= fr;
    const key = (win ? 'w' : 'l') + me + '|' + fr;
    if (!menuOpen) show(el.res, true);
    if (resShown === key) return;
    resShown = key;
    const x = X();
    el.resWin.textContent = win ? '🏆 승리!' : '패배…';
    el.resWin.className = win ? 'win' : 'lose';
    el.resTimes.innerHTML = '';
    mk('div', null, '나  ' + x.fmt(me), el.resTimes);
    mk('div', null, '친구  ' + (fr > 0 ? x.fmt(fr) : '주행 중…'), el.resTimes);
  }
  // results → room lobby (connection kept)
  function toLobby() {
    const g = G();
    if (!g || !g.online) return;
    inRace = false; snaps = [];
    g.online = false;
    if (!connected) { gone(); return; }
    openLobby();
    send({ t: 'lobby' });
    refreshRoom();
  }
  // race menu (main.js openPause in online races): never freezes the race
  function menu(on) {
    build();
    menuOpen = on === undefined ? !menuOpen : !!on;
    show(el.pause, menuOpen);
    if (menuOpen) show(el.res, false);
  }

  // ---------------------------------------------------------------- remote kart (main.js simulate())
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const lerpA = (a, b, t) => wrapA(a + wrapA(b - a) * t);
  function drive(k, dt) {
    const n = snaps.length;
    if (n) {
      const rt = now() - INTERP;
      let s0 = snaps[0], s1 = null, t = 0;
      if (rt <= s0.rx) { s1 = s0; }
      else {
        for (let i = n - 1; i >= 0; i--) { if (snaps[i].rx <= rt) { s0 = snaps[i]; s1 = snaps[i + 1] || null; break; } }
        if (s1) t = (rt - s0.rx) / Math.max(1e-3, s1.rx - s0.rx);
      }
      if (s1) {
        k.x = s0.x + (s1.x - s0.x) * t; k.y = s0.y + (s1.y - s0.y) * t;
        k.a = lerpA(s0.a, s1.a, t); k.ma = lerpA(s0.ma, s1.ma, t); k.v = s0.v + (s1.v - s0.v) * t;
      } else {   // no newer state yet: extrapolate a little along the movement direction
        const ex = Math.min(0.25, rt - s0.rx);
        k.x = s0.x + Math.cos(s0.ma) * s0.v * ex; k.y = s0.y + Math.sin(s0.ma) * s0.v * ex;
        k.a = s0.a; k.ma = s0.ma; k.v = s0.v;
      }
      const L = snaps[n - 1];
      k.lap = L.lap; k.prog = L.prog; k.maxLap = Math.max(k.maxLap || 0, L.lap);
      const TN = PK.Track && PK.Track.N;
      if (TN) k.idx = ((Math.floor(L.prog) % TN) + TN) % TN;
      k.hop = s0.hop || 0; k.drift = !!s0.dr; k.driftDir = s0.dd || 0; k.boostT = s0.bt || 0;
      k.steerIn = k.drift ? k.driftDir : 0;
      k.fx.spin = L.sp ? 0.5 : 0;
      if (k.fx.spin > 0) k.spinA = (k.spinA || 0) + dt * 14;
      k.fx.phase = L.ph || 0;
    }
    // local skills may have touched the friend's kart: they have no effect here
    k.fx.slow = 0; k.fx.ghost = 0; k.fx.buff = 0;
    k.wrongT = 0;
    if (friendFin > 0) { k.finished = true; k.finishTime = friendFin; }
    k._nx = k.x; k._ny = k.y;
  }
  // after karts.js collide(): the friend's kart is kinematic (the local kart bumps off it)
  function pin(ks) {
    for (let i = 0; i < ks.length; i++) { const k = ks[i]; if (k.remote && k._nx !== undefined) { k.x = k._nx; k.y = k._ny; } }
  }

  // ---------------------------------------------------------------- keys (main.js onKeyDown)
  const isEnter = (c) => c === 'Enter' || c === 'NumpadEnter' || c === 'Space';
  function key(c) {
    const g = G();
    if (!g) return false;
    const st = g.state;
    if (st === 'online') {
      if (c === 'Escape' || c === 'Backspace') { if (!(view === 'join' && c === 'Backspace')) back(); }
      else if (isEnter(c) && view === 'room' && role === 'host') hostStart();
      else if (isEnter(c) && view === 'join') join(el.code.value);
      return true;
    }
    if (!g.online) return false;
    if (st === 'countdown' || st === 'race' || st === 'finished') {
      if (menuOpen) {
        if (c === 'Escape' || c === 'KeyP' || isEnter(c)) menu(false);
        return c !== 'KeyM';
      }
      if (st === 'finished') {
        const x = X();
        if (isEnter(c) && x && x.finT() > 1.2) { x.beep(1); toLobby(); return true; }
        if (c === 'Escape') { leave(); return true; }
      }
      if (c === 'Escape' || c === 'KeyP') { menu(true); return true; }
      if (c === 'KeyR' || c === 'KeyF') return true;   // no retry / debug finish online
    }
    return false;
  }

  // ---------------------------------------------------------------- title button
  function bindTitle() {
    const b = $('btnOnline');
    if (b && !b._pkNet) {
      b._pkNet = true;
      b.addEventListener('click', () => { const x = X(); if (x) { x.audio(); x.beep(1); } openLobby(); });
    }
  }
  bindTitle();
  if (document.addEventListener) document.addEventListener('DOMContentLoaded', bindTitle);
  // leaving the page: tell the friend right away
  if (window.addEventListener) window.addEventListener('pagehide', () => { if (connected) send({ t: 'bye' }); });
})(window.PK);
