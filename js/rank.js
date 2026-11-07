// PK.Rank — ranking board. With window.PK_RANK_DB (js/rank-config.js) set to a Firebase
// Realtime Database URL, finish times go to a worldwide board through the plain REST API (no SDK);
// otherwise (or when offline) a top list kept on this device is used.
// Boards show the 10 fastest people (each person once, with their fastest record) plus my own
// place, counted exactly on the server even when I'm far below 10th.
//
// Names (rules: firebase-rules.json):
//   /pkey/<pid>   = uid                     this device's public player id -> its secret (unreadable, write-once)
//   /owners/<nm>  = { uid, pid, free, at }  a name belongs to one device (unreadable)
//   /alias/<old>  = { to, pid }             readable: "old name is now <to>" — only the owner of both names
//                                           can write it, so after a rename all my old records show my new name.
// Renamed-away names stay reserved for me (they still point at my records).
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const TOP = 10, FETCH = 50;
  const LS_LOCAL = 'pk_rank_local', LS_NICK = 'pk_nick', LS_UID = 'pk_uid', LS_PID = 'pk_pid', LS_KEY = 'pk_pkey_ok', LS_OWN = 'pk_nick_ok', LS_NAMES = 'pk_my_names', LS_LINKS = 'pk_links_ok';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const db = () => String(window.PK_RANK_DB || '').trim().replace(/\/+$/, '');
  const clean = (s) => String(s || '').replace(/[<>"'`\\.#$\[\]\/]/g, '').trim().slice(0, 12);
  const q = (s) => encodeURIComponent('"' + s + '"');
  const enc = (s) => encodeURIComponent(s);
  const MAP_IDS = () => (PK.Track && PK.Track.MAPS ? PK.Track.MAPS.map((m) => m.id) : [0, 1, 2, 3]);
  const rnd = (n) => { let u = ''; for (let i = 0; i < n; i++) u += 'abcdefghijklmnopqrstuvwxyz0123456789'[(Math.random() * 36) | 0]; return u; };

  // this device's secret id (never readable on the server) and its public player id
  function uid() { let u = lsGet(LS_UID); if (!u || u.length < 12) { u = rnd(24); lsSet(LS_UID, u); } return u; }
  function pid() { let p = lsGet(LS_PID); if (!p || p.length < 8) { p = rnd(12); lsSet(LS_PID, p); } return p; }
  function nick() {
    let n = clean(lsGet(LS_NICK));
    if (!n) { n = '플레이어' + (1000 + ((Math.random() * 9000) | 0)); lsSet(LS_NICK, n); }
    return n;
  }
  // every name this device has raced under (old records keep them)
  function myNames() {
    let a = [];
    try { a = JSON.parse(lsGet(LS_NAMES) || '[]'); } catch (e) { a = []; }
    if (!Array.isArray(a)) a = [];
    const n = nick(); if (a.indexOf(n) < 0) a.push(n);
    const o = local(); Object.keys(o).forEach((k) => (o[k] || []).forEach((e) => { if (e && e.name && a.indexOf(e.name) < 0) a.push(e.name); }));
    return a;
  }
  const rememberName = (n) => { const a = myNames(); if (a.indexOf(n) < 0) a.push(n); lsSet(LS_NAMES, JSON.stringify(a.slice(-20))); };

  // ---- this device's board: { m<id>: [{ name, time, kart, at }] } sorted by time
  function local() { try { const o = JSON.parse(lsGet(LS_LOCAL) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function addLocal(mapId, e) {
    const o = local(), k = 'm' + mapId, a = Array.isArray(o[k]) ? o[k] : [];
    a.push(e); a.sort((x, y) => x.time - y.time); a.length = Math.min(a.length, FETCH);
    o[k] = a; lsSet(LS_LOCAL, JSON.stringify(o));
  }
  const usedHere = (name) => { const o = local(); return Object.keys(o).some((k) => (o[k] || []).some((e) => e && e.name === name)); };

  // ---- server helpers ------------------------------------------------------------------------
  async function put(path, body) {
    try { const r = await fetch(db() + path + '.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.status; }
    catch (e) { return 0; }
  }
  async function getJson(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return (await r.json()) || {}; }
  const vals = (o) => Object.keys(o).map((k) => o[k]);

  // are the database rules new enough (name index + /owners + /alias)? Until they are, names work the old way.
  let rulesOk = null;
  async function newRules() {
    if (!db()) return false;
    if (rulesOk !== null) return rulesOk;
    try {
      const a = await fetch(db() + '/scores/m0.json?orderBy=%22name%22&equalTo=%22%22&limitToFirst=1');
      const b = await fetch(db() + '/alias.json?shallow=true');
      rulesOk = a.ok && b.ok;
    } catch (e) { return false; }   // offline: ask again next time
    return rulesOk;
  }
  // register this device's player id once (write-once on the server)
  async function ensureKey() {
    if (lsGet(LS_KEY) === pid()) return true;
    const s = await put('/pkey/' + pid(), uid());
    if (s === 200) { lsSet(LS_KEY, pid()); return true; }
    if (s === 401 || s === 403) { lsSet(LS_PID, rnd(12)); const s2 = await put('/pkey/' + pid(), uid()); if (s2 === 200) { lsSet(LS_KEY, pid()); return true; } }
    return false;
  }
  // claim a name for this device: true = mine now, false = someone else has it, null = can't tell
  async function claim(name) {
    if (!(await ensureKey())) return null;
    const s = await put('/owners/' + enc(name), { uid: uid(), pid: pid(), free: false, at: Date.now() });
    if (s === 200) return true;
    return s === 401 || s === 403 ? false : null;
  }
  // is the name on the board already (records from before names were registered)? -> true / false / null
  async function onBoard(name) {
    try {
      const js = await Promise.all(MAP_IDS().map((id) => getJson(db() + '/scores/m' + id + '.json?orderBy=%22name%22&equalTo=' + q(name) + '&limitToFirst=1')));
      return js.some((o) => o && Object.keys(o).length > 0);
    } catch (e) { return null; }
  }
  // point my old names at the current one, so their records show it (and break loops on the new one)
  async function linkNames(cur) {
    const p = pid();
    await put('/alias/' + enc(cur), { to: cur, pid: p });
    for (const old of myNames()) {
      if (old === cur) continue;
      if ((await claim(old)) !== true) continue;   // an old auto name someone else took meanwhile: leave it
      await put('/alias/' + enc(old), { to: cur, pid: p });
    }
  }
  // once per name: own my current name and link every old name of mine to it (also fixes renames
  // made with older versions of the game, which let the old name go instead of linking it)
  async function syncLinks() {
    const cur = nick();
    if (lsGet(LS_LINKS) === cur || !(await newRules())) return;
    if ((await claim(cur)) !== true) return;
    lsSet(LS_OWN, cur); rememberName(cur);
    await linkNames(cur);
    lsSet(LS_LINKS, cur); aliasCache = null;
  }
  // -> { ok, name, msg }
  async function setNick(n) {
    n = clean(n);
    const cur = nick();
    if (!n) return { ok: false, name: cur, msg: '이름을 입력해 주세요' };
    if (await newRules()) {
      if (n !== cur && !usedHere(n) && myNames().indexOf(n) < 0 && (await onBoard(n)) === true) return { ok: false, name: cur, msg: '이미 다른 사람이 쓰는 이름이에요' };
      const c = await claim(n);
      if (c === false) return { ok: false, name: cur, msg: '이미 다른 사람이 쓰는 이름이에요' };
      if (c === true) {
        rememberName(cur); lsSet(LS_NICK, n); rememberName(n); lsSet(LS_OWN, n);
        await linkNames(n);
        lsSet(LS_LINKS, n); aliasCache = null;
        return { ok: true, name: n, msg: '' };
      }
    }
    rememberName(cur); lsSet(LS_NICK, n); rememberName(n);
    return { ok: true, name: n, msg: '' };
  }
  // before the first upload: make sure the (maybe auto-made) name is mine; pick another random one if taken
  async function ensureNick() {
    if (lsGet(LS_OWN) === nick() || !(await newRules())) return;
    for (let i = 0; i < 5; i++) {
      const n = nick(), c = await claim(n);
      if (c === true) { lsSet(LS_OWN, n); rememberName(n); return; }
      if (c === null) return;   // offline: carry on
      if (/^플레이어\d{4}$/.test(n)) lsSet(LS_NICK, '플레이어' + (1000 + ((Math.random() * 9000) | 0)));
      else return;   // a hand-picked name someone else owns: keep it, the ranking screen will ask for a new one
    }
  }

  // ---- online (Firebase Realtime Database REST)
  async function submit(mapId, time, kart) {
    if (!(time > 5 && time < 900)) return false;
    await ensureNick();
    syncLinks().catch(() => {});
    const e = { name: nick(), time: Math.round(time * 100) / 100, kart: kart | 0, at: Date.now() };
    addLocal(mapId, e);
    if (!db()) return false;
    try {
      const r = await fetch(db() + '/scores/m' + (mapId | 0) + '.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
      return r.ok;
    } catch (err) { return false; }
  }
  const tag = (a, id) => a.filter((e) => e && typeof e.time === 'number')
    .map((e) => ({ name: clean(e.name) || '???', time: e.time, kart: e.kart | 0, at: Number(e.at) || 0, map: id }));

  // old name -> current name (follows a chain of renames, stops on loops)
  let aliasCache = null, aliasAt = 0;
  async function aliases() {
    if (aliasCache && Date.now() - aliasAt < 15000) return aliasCache;
    let a = {};
    if (db()) { try { a = await getJson(db() + '/alias.json'); } catch (e) { a = {}; } }
    // this device's own old names always resolve to its current name
    const me = nick(); myNames().forEach((n) => { if (n !== me) a[n] = { to: me }; });
    aliasCache = a; aliasAt = Date.now();
    return a;
  }
  function resolve(al, name) {
    let n = name;
    for (let i = 0; i < 6; i++) { const x = al[n]; if (!x || !x.to || x.to === n) break; n = x.to; }
    return n;
  }

  // raw records of one map, fastest first: -> { online, list }
  async function raw(mapId) {
    const id = mapId | 0;
    if (db()) {
      try {
        const a = tag(vals(await getJson(db() + '/scores/m' + id + '.json?orderBy=%22time%22&limitToFirst=' + FETCH)), id);
        a.sort((x, y) => x.time - y.time);
        return { online: true, list: a };
      } catch (err) { /* fall back to the local board */ }
    }
    return { online: false, list: tag(local()['m' + id] || [], id) };
  }
  // my exact place on the given maps (merged): my best record (under any of my names) + how many people are faster
  async function myPlace(ids, al) {
    const me = nick();
    try {
      const mine = [];
      for (const nm of myNames()) for (const id of ids) {
        tag(vals(await getJson(db() + '/scores/m' + id + '.json?orderBy=%22name%22&equalTo=' + q(nm))), id).forEach((e) => mine.push(e));
      }
      if (!mine.length) return null;
      mine.sort((a, b) => a.time - b.time);
      const best = mine[0], faster = new Set();
      for (const id of ids) {
        tag(vals(await getJson(db() + '/scores/m' + id + '.json?orderBy=%22time%22&endAt=' + best.time)), id)
          .forEach((e) => { const who = resolve(al, e.name); if (who !== me && e.time < best.time) faster.add(who); });
      }
      return Object.assign({}, best, { name: me, rank: faster.size + 1, me: true });
    } catch (e) { return null; }   // old rules (no name index) / offline
  }
  // sorted records -> the 10 fastest people (each once, shown by their current name) + my place
  function board(all, al) {
    const me = nick(), seen = new Set(), people = [];
    for (const e of all) {
      const who = resolve(al, e.name);
      if (seen.has(who)) continue;
      seen.add(who);
      people.push(Object.assign({}, e, { name: who, rank: people.length + 1, me: who === me }));
    }
    return { list: people.slice(0, TOP), mine: people.find((e) => e.me) || null };
  }
  async function boardOf(ids) {
    try { await syncLinks(); } catch (e) { /* offline: next time */ }
    const [res, al] = await Promise.all([Promise.all(ids.map((id) => raw(id))), aliases()]);
    const all = [];
    res.forEach((r) => r.list.forEach((e) => all.push(e)));
    all.sort((a, b) => a.time - b.time);
    const out = Object.assign({ online: res.some((r) => r.online) }, board(all, al));
    // not among the records fetched (far down the list): ask the server for my exact place
    if (out.online && !out.mine && (await newRules())) out.mine = await myPlace(ids, al);
    return out;
  }
  const top = (mapId) => boardOf([mapId | 0]);        // one map's board
  const topAll = (mapIds) => boardOf(mapIds);          // every map merged into one board

  PK.Rank = { get configured() { return !!db(); }, nick, setNick, submit, top, topAll };
})(window.PK);
