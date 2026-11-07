// PK.Rank — ranking board per map. With window.PK_RANK_DB (js/rank-config.js) set to a Firebase
// Realtime Database URL, finish times go to a worldwide board through the plain REST API (no SDK);
// otherwise (or when offline) a top-10 kept on this device is used.
window.PK = window.PK || {};
(function (PK) {
  'use strict';
  const TOP = 10, LS_LOCAL = 'pk_rank_local', LS_NICK = 'pk_nick';
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
    a.push(e); a.sort((x, y) => x.time - y.time); a.length = Math.min(a.length, TOP);
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
  // -> { online: bool, list: [{ name, time, kart, at, me }] }
  async function top(mapId) {
    const url = db(), me = nick();
    const mark = (a) => a.map((e) => Object.assign({}, e, { me: e.name === me }));
    if (url) {
      try {
        const q = url + '/scores/m' + (mapId | 0) + '.json?orderBy=%22time%22&limitToFirst=' + (TOP * 3);
        const r = await fetch(q);
        if (r.ok) {
          const o = (await r.json()) || {};
          const a = Object.keys(o).map((k) => o[k]).filter((e) => e && typeof e.time === 'number')
            .map((e) => ({ name: clean(e.name) || '???', time: e.time, kart: e.kart | 0, at: e.at | 0 }));
          a.sort((x, y) => x.time - y.time);
          return { online: true, list: mark(a.slice(0, TOP)) };
        }
      } catch (err) { /* fall back to the local board */ }
    }
    return { online: false, list: mark((local()['m' + (mapId | 0)] || []).slice(0, TOP)) };
  }

  // every map's board merged into one list: -> { online, list: [{ ...entry, map }] } sorted by time
  async function topAll(mapIds) {
    const res = await Promise.all(mapIds.map((id) => top(id).then((r) => ({ id, r }))));
    const list = [];
    res.forEach(({ id, r }) => r.list.forEach((e) => list.push(Object.assign({ map: id }, e))));
    list.sort((a, b) => a.time - b.time);
    return { online: res.some((x) => x.r.online), list };
  }

  PK.Rank = { get configured() { return !!db(); }, nick, setNick, submit, top, topAll };
})(window.PK);
