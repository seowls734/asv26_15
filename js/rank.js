// PK.Rank — ranking board. With window.PK_RANK_DB (js/rank-config.js) set to a Firebase
// Realtime Database URL, finish times go to a worldwide board through the plain REST API (no SDK);
// otherwise (or when offline) a top list kept on this device is used.
// Boards show the 10 fastest people (each name once, with its fastest record) plus my own place,
// counted exactly on the server even when I'm far below 10th.
// Nicknames are unique: /owners/<name> = { uid, free, at } (not readable) ties a name to this device.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const TOP = 10, FETCH = 50, LS_LOCAL = 'pk_rank_local', LS_NICK = 'pk_nick', LS_UID = 'pk_uid', LS_OWN = 'pk_nick_ok';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const db = () => String(window.PK_RANK_DB || '').trim().replace(/\/+$/, '');
  const clean = (s) => String(s || '').replace(/[<>"'`\\.#$\[\]\/]/g, '').trim().slice(0, 12);
  const q = (s) => encodeURIComponent('"' + s + '"');
  const MAP_IDS = () => (PK.Track && PK.Track.MAPS ? PK.Track.MAPS.map((m) => m.id) : [0, 1, 2, 3]);

  // this device's secret id (only ever sent inside an owner record, which nobody can read back)
  function uid() {
    let u = lsGet(LS_UID);
    if (!u || u.length < 12) { u = ''; for (let i = 0; i < 24; i++) u += 'abcdefghijklmnopqrstuvwxyz0123456789'[(Math.random() * 36) | 0]; lsSet(LS_UID, u); }
    return u;
  }
  function nick() {
    let n = clean(lsGet(LS_NICK));
    if (!n) { n = '플레이어' + (1000 + ((Math.random() * 9000) | 0)); lsSet(LS_NICK, n); }
    return n;
  }

  // ---- this device's board: { m<id>: [{ name, time, kart, at }] } sorted by time
  function local() { try { const o = JSON.parse(lsGet(LS_LOCAL) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function addLocal(mapId, e) {
    const o = local(), k = 'm' + mapId, a = Array.isArray(o[k]) ? o[k] : [];
    a.push(e); a.sort((x, y) => x.time - y.time); a.length = Math.min(a.length, FETCH);
    o[k] = a; lsSet(LS_LOCAL, JSON.stringify(o));
  }
  const usedHere = (name) => { const o = local(); return Object.keys(o).some((k) => (o[k] || []).some((e) => e && e.name === name)); };

  // ---- nickname ownership --------------------------------------------------------------------
  // are the database rules new enough (name index + /owners)? Until they are, names work the old way.
  let rulesOk = null;
  async function newRules() {
    const url = db();
    if (!url) return false;
    if (rulesOk !== null) return rulesOk;
    try { const r = await fetch(url + '/scores/m0.json?orderBy=%22name%22&equalTo=%22%22&limitToFirst=1'); rulesOk = r.ok; }
    catch (e) { return false; }   // offline: ask again next time
    return rulesOk;
  }
  // claim a name for this device: true = mine now, false = someone else has it, null = can't tell (offline / old rules)
  async function claim(name) {
    const url = db();
    if (!url) return null;
    try {
      const r = await fetch(url + '/owners/' + encodeURIComponent(name) + '.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: uid(), free: false, at: Date.now() }) });
      if (r.ok) return true;
      return r.status === 401 || r.status === 403 ? false : null;
    } catch (e) { return null; }
  }
  async function release(name) {
    const url = db();
    if (!url || !name) return;
    try { await fetch(url + '/owners/' + encodeURIComponent(name) + '.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: uid(), free: true, at: Date.now() }) }); } catch (e) { /* ignore */ }
  }
  // is the name on the board already (records from before names were registered)? -> true / false / null (unknown)
  async function onBoard(name) {
    const url = db();
    if (!url) return null;
    try {
      const rs = await Promise.all(MAP_IDS().map((id) => fetch(url + '/scores/m' + id + '.json?orderBy=%22name%22&equalTo=' + q(name) + '&limitToFirst=1')));
      if (rs.some((r) => !r.ok)) return null;
      const js = await Promise.all(rs.map((r) => r.json()));
      return js.some((o) => o && Object.keys(o).length > 0);
    } catch (e) { return null; }
  }
  // -> { ok, name, msg }
  async function setNick(n) {
    n = clean(n);
    const cur = nick();
    if (!n) return { ok: false, name: cur, msg: '이름을 입력해 주세요' };
    if (n === cur && lsGet(LS_OWN) === cur) return { ok: true, name: cur, msg: '' };
    if (await newRules()) {
      // names that already have someone else's records count as taken
      if (n !== cur && !usedHere(n) && (await onBoard(n)) === true) return { ok: false, name: cur, msg: '이미 다른 사람이 쓰는 이름이에요' };
      const c = await claim(n);
      if (c === false) return { ok: false, name: cur, msg: '이미 다른 사람이 쓰는 이름이에요' };
      if (c === true) { const had = lsGet(LS_OWN) === cur; lsSet(LS_OWN, n); if (cur !== n && had) release(cur); }   // free my old name
    }
    lsSet(LS_NICK, n);
    return { ok: true, name: n, msg: '' };
  }
  // before the first upload: make sure the (maybe auto-made) name is mine; pick another random one if taken
  async function ensureNick() {
    if (lsGet(LS_OWN) === nick() || !(await newRules())) return;
    for (let i = 0; i < 5; i++) {
      const n = nick(), c = await claim(n);
      if (c === true) { lsSet(LS_OWN, n); return; }
      if (c === null) return;   // offline / old rules: carry on
      if (/^플레이어\d{4}$/.test(n)) lsSet(LS_NICK, '플레이어' + (1000 + ((Math.random() * 9000) | 0)));
      else return;   // a hand-picked name someone else owns: keep it, the ranking screen will ask for a new one
    }
  }

  // ---- online (Firebase Realtime Database REST). Rules the database needs are in the setup guide.
  async function submit(mapId, time, kart) {
    if (!(time > 5 && time < 900)) return false;
    await ensureNick();
    const e = { name: nick(), time: Math.round(time * 100) / 100, kart: kart | 0, at: Date.now() };
    addLocal(mapId, e);
    const url = db();
    if (!url) return false;
    try {
      const r = await fetch(url + '/scores/m' + (mapId | 0) + '.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
      return r.ok;
    } catch (err) { return false; }
  }
  const tag = (a, id) => a.filter((e) => e && typeof e.time === 'number')
    .map((e) => ({ name: clean(e.name) || '???', time: e.time, kart: e.kart | 0, at: e.at | 0, map: id }));
  async function getJson(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return (await r.json()) || {}; }
  const vals = (o) => Object.keys(o).map((k) => o[k]);
  // raw records of one map, fastest first: -> { online, list: [{ name, time, kart, at, map }] }
  async function raw(mapId) {
    const url = db(), id = mapId | 0;
    if (url) {
      try {
        const a = tag(vals(await getJson(url + '/scores/m' + id + '.json?orderBy=%22time%22&limitToFirst=' + FETCH)), id);
        a.sort((x, y) => x.time - y.time);
        return { online: true, list: a };
      } catch (err) { /* fall back to the local board */ }
    }
    return { online: false, list: tag(local()['m' + id] || [], id) };
  }
  // my exact place on the given maps (merged): my best record + how many other people are faster
  async function myPlace(ids) {
    const url = db(), me = nick();
    if (!url) return null;
    try {
      const mine = [];
      for (const id of ids) tag(vals(await getJson(url + '/scores/m' + id + '.json?orderBy=%22name%22&equalTo=' + q(me))), id).forEach((e) => mine.push(e));
      if (!mine.length) return null;
      mine.sort((a, b) => a.time - b.time);
      const best = mine[0], faster = new Set();
      for (const id of ids) {
        tag(vals(await getJson(url + '/scores/m' + id + '.json?orderBy=%22time%22&endAt=' + best.time)), id)
          .forEach((e) => { if (e.name !== me && e.time < best.time) faster.add(e.name); });
      }
      return Object.assign({}, best, { rank: faster.size + 1, me: true });
    } catch (e) { return null; }   // old rules (no name index) / offline
  }
  // sorted records -> the 10 fastest people (each name once) + my place
  //   -> { list: [{ ...entry, rank, me }], mine: { ...entry, rank, me } | null }
  function board(all) {
    const me = nick(), seen = new Set(), people = [];
    for (const e of all) { if (seen.has(e.name)) continue; seen.add(e.name); people.push(Object.assign({}, e, { rank: people.length + 1, me: e.name === me })); }
    return { list: people.slice(0, TOP), mine: people.find((e) => e.me) || null };
  }
  async function boardOf(ids) {
    const res = await Promise.all(ids.map((id) => raw(id)));
    const all = [];
    res.forEach((r) => r.list.forEach((e) => all.push(e)));
    all.sort((a, b) => a.time - b.time);
    const out = Object.assign({ online: res.some((r) => r.online) }, board(all));
    // not among the records fetched (far down the list): ask the server for my exact place
    if (out.online && !out.mine) out.mine = await myPlace(ids);
    return out;
  }
  const top = (mapId) => boardOf([mapId | 0]);        // one map's board
  const topAll = (mapIds) => boardOf(mapIds);          // every map merged into one board

  PK.Rank = { get configured() { return !!db(); }, nick, setNick, submit, top, topAll };
})(window.PK);
