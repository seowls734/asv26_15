// PK.Rank — ranking board. With window.PK_RANK_DB (js/rank-config.js) set to a Firebase
// Realtime Database URL, finish times go to a worldwide board through the plain REST API (no SDK);
// otherwise (or when offline) a top list kept on this device is used.
// Boards show the 10 fastest people (each name once, with its fastest record) plus where I stand.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const TOP = 10, FETCH = 50, LS_LOCAL = 'pk_rank_local', LS_NICK = 'pk_nick';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const db = () => String(window.PK_RANK_DB || '').trim().replace(/\/+$/, '');
  const clean = (s) => String(s || '').replace(/[<>"'`\\]/g, '').trim().slice(0, 12);

  function nick() {
    let n = clean(lsGet(LS_NICK));
    if (!n) { n = '플레이어' + (1000 + ((Math.random() * 9000) | 0)); lsSet(LS_NICK, n); }
    return n;
  }
  function setNick(n) { n = clean(n); if (n) lsSet(LS_NICK, n); return nick(); }

  // ---- this device's board: { m<id>: [{ name, time, kart, at }] } sorted by time
  function local() { try { const o = JSON.parse(lsGet(LS_LOCAL) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function addLocal(mapId, e) {
    const o = local(), k = 'm' + mapId, a = Array.isArray(o[k]) ? o[k] : [];
    a.push(e); a.sort((x, y) => x.time - y.time); a.length = Math.min(a.length, FETCH);
    o[k] = a; lsSet(LS_LOCAL, JSON.stringify(o));
  }

  // ---- online (Firebase Realtime Database REST). Rules the database needs are in the setup guide.
  async function submit(mapId, time, kart) {
    if (!(time > 5 && time < 900)) return false;
    const e = { name: nick(), time: Math.round(time * 100) / 100, kart: kart | 0, at: Date.now() };
    addLocal(mapId, e);
    const url = db();
    if (!url) return false;
    try {
      const r = await fetch(url + '/scores/m' + (mapId | 0) + '.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
      return r.ok;
    } catch (err) { return false; }
  }
  // raw records of one map, fastest first: -> { online, list: [{ name, time, kart, at, map }] }
  async function raw(mapId) {
    const url = db(), id = mapId | 0;
    const tag = (a) => a.map((e) => ({ name: clean(e.name) || '???', time: e.time, kart: e.kart | 0, at: e.at | 0, map: id }));
    if (url) {
      try {
        const r = await fetch(url + '/scores/m' + id + '.json?orderBy=%22time%22&limitToFirst=' + FETCH);
        if (r.ok) {
          const o = (await r.json()) || {};
          const a = tag(Object.keys(o).map((k) => o[k]).filter((e) => e && typeof e.time === 'number'));
          a.sort((x, y) => x.time - y.time);
          return { online: true, list: a };
        }
      } catch (err) { /* fall back to the local board */ }
    }
    return { online: false, list: tag(local()['m' + id] || []) };
  }
  // sorted records -> the 10 fastest people (each name once) + my place
  //   -> { list: [{ ...entry, rank, me }], mine: { ...entry, rank, me } | null (my best, also when below 10th) }
  function board(all) {
    const me = nick(), seen = new Set(), people = [];
    for (const e of all) { if (seen.has(e.name)) continue; seen.add(e.name); people.push(Object.assign({}, e, { rank: people.length + 1, me: e.name === me })); }
    return { list: people.slice(0, TOP), mine: people.find((e) => e.me) || null };
  }
  // one map's board
  async function top(mapId) {
    const r = await raw(mapId);
    return Object.assign({ online: r.online }, board(r.list));
  }
  // every map merged into one board
  async function topAll(mapIds) {
    const res = await Promise.all(mapIds.map((id) => raw(id)));
    const all = [];
    res.forEach((r) => r.list.forEach((e) => all.push(e)));
    all.sort((a, b) => a.time - b.time);
    return Object.assign({ online: res.some((r) => r.online) }, board(all));
  }

  PK.Rank = { get configured() { return !!db(); }, nick, setNick, submit, top, topAll };
})(window.PK);
