// URL 해시 ↔ 상태. 저장소 없음: 링크가 곧 저장.
// v: 기본 이동수단(transit|taxi) · l: 구간 덮어쓰기 {'from>to': 'walk'|'metro'|'taxi'|분} · o: 직접 정한 날짜·순서 [[id,...],...] | null
export const DEFAULTS = { c: 'london', d: 3, t: 570, e: 1140, s: null, p: {}, m: [], u: [], v: 'transit', l: {}, o: null, tab: 'plan', pr: null, dt: null, ds: null };
export const TABS = ['home', 'plan', 'pack', 'photo', 'gift', 'mine'];   // 홈 · 플랜 · 준비물 · 사진 · 기념품 · 내 여행
const ID = /^[a-z0-9_]+$/, MODES = ['walk', 'metro', 'taxi'];

export function encode(st) {
  const q = new URLSearchParams();
  q.set('c', st.c); q.set('d', st.d); q.set('t', st.t); q.set('e', st.e);
  if (st.s) q.set('s', `${st.s.lat.toFixed(5)},${st.s.lng.toFixed(5)}`);
  const ids = Object.keys(st.p).sort();
  if (ids.length) q.set('p', ids.map(id => `${id}:${st.p[id]}`).join(','));
  if (st.m.length) q.set('m', [...st.m].sort().join(','));
  if (st.u.length) q.set('u', st.u.map(x => [x.name, x.lat.toFixed(5), x.lng.toFixed(5), x.min].join('~')).join('|'));
  if (st.v === 'taxi') q.set('v', 'taxi');
  const lk = Object.keys(st.l || {}).sort();
  if (lk.length) q.set('l', lk.map(k => `${k}:${st.l[k]}`).join(','));
  if (st.o && st.o.length) q.set('o', st.o.map(ids => ids.join(',')).join('|'));
  if (st.tab && st.tab !== 'plan') q.set('tab', st.tab);
  if (st.pr) q.set('pr', st.pr);
  if (st.dt) q.set('dt', st.dt);
  // 날짜별 설정: ds=0:t600,e1200,vtaxi,s48.85|2.34;2:t540
  const dsk = Object.keys(st.ds || {}).filter(k => st.ds[k] && Object.keys(st.ds[k]).length).sort((a, b) => a - b);
  if (dsk.length) q.set('ds', dsk.map(k => { const d = st.ds[k]; const parts = []; if (d.t != null) parts.push('t' + d.t); if (d.e != null) parts.push('e' + d.e); if (d.v) parts.push('v' + d.v); if (d.s) parts.push(`s${d.s.lat.toFixed(5)}|${d.s.lng.toFixed(5)}`); return `${k}:${parts.join(',')}`; }).join(';'));
  return q.toString();
}

export function decode(hash) {
  const st = structuredClone(DEFAULTS);
  let q;
  try { q = new URLSearchParams((hash || '').replace(/^#/, '')); } catch { return st; }
  const int = (k, lo, hi, def) => {
    if (!q.has(k)) return def;
    const v = Number(q.get(k));
    return Number.isInteger(v) && v >= lo && v <= hi ? v : NaN;
  };
  const d = int('d', 1, 10, st.d), t = int('t', 0, 1439, st.t), e = int('e', 1, 1440, st.e);
  if ([d, t, e].some(Number.isNaN)) return structuredClone(DEFAULTS);
  st.d = d; st.t = t; st.e = e;
  if (st.e <= st.t) { st.t = DEFAULTS.t; st.e = DEFAULTS.e; }
  if (q.get('c')) st.c = q.get('c');
  const s = (q.get('s') || '').split(',');
  if (s.length === 2 && s.every(x => x !== '' && Number.isFinite(+x))) st.s = { lat: +s[0], lng: +s[1] };
  for (const tok of (q.get('p') || '').split(',').filter(Boolean)) {
    const [id, o] = tok.split(':');
    if (/^[a-z0-9_]+$/.test(id) && !Object.hasOwn(Object.prototype, id) && !(id in Object.prototype))
      st.p[id] = Math.max(0, parseInt(o) || 0);
  }
  st.m = (q.get('m') || '').split(',').filter(id => Object.hasOwn(st.p, id));
  for (const tok of (q.get('u') || '').split('|').filter(Boolean)) {
    const [name, lat, lng, min] = tok.split('~');
    if (name && Number.isFinite(+lat) && Number.isFinite(+lng) && parseInt(min) > 0)
      st.u.push({ name, lat: +lat, lng: +lng, min: parseInt(min) });
  }
  if (q.get('v') === 'taxi') st.v = 'taxi';
  for (const tok of (q.get('l') || '').split(',').filter(Boolean)) {
    const i = tok.lastIndexOf(':'); if (i < 0) continue;
    const key = tok.slice(0, i), val = tok.slice(i + 1);
    const [from, to] = key.split('>');
    if (!ID.test(from) || !ID.test(to)) continue;
    if (MODES.includes(val)) st.l[key] = val;
    else if (/^\d+$/.test(val) && parseInt(val) > 0) st.l[key] = parseInt(val);
  }
  if (q.get('o')) {
    const days = q.get('o').split('|').map(d => d.split(',').filter(id => ID.test(id)));   // 빈 날도 자리로 남긴다
    st.o = days.some(d => d.length) ? days : null;
  }
  if (TABS.includes(q.get('tab'))) st.tab = q.get('tab');
  if (/^[A-Za-z0-9_-]{1,40}$/.test(q.get('pr') || '')) st.pr = q.get('pr');
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('dt') || '') && !Number.isNaN(Date.parse(q.get('dt')))) st.dt = q.get('dt');
  if (q.get('ds')) {
    const ds = {}; let ok = true;
    for (const tok of q.get('ds').split(';').filter(Boolean)) {
      const [k, rest] = tok.split(':'); if (!/^\d$/.test(k) || rest == null) { ok = false; break; }
      const d = {};
      for (const part of rest.split(',').filter(Boolean)) {
        const key = part[0], val = part.slice(1);
        if (key === 't' || key === 'e') { const n = Number(val); if (!Number.isInteger(n) || n < 0 || n > 1440) { ok = false; break; } d[key] = n; }
        else if (key === 'v') { if (!['transit', 'taxi'].includes(val)) { ok = false; break; } d.v = val; }
        else if (key === 's') { const [la, ln] = val.split('|').map(Number); if (!Number.isFinite(la) || !Number.isFinite(ln)) { ok = false; break; } d.s = { lat: la, lng: ln }; }
        else { ok = false; break; }
      }
      if (!ok) break; if (Object.keys(d).length) ds[k] = d;
    }
    st.ds = ok && Object.keys(ds).length ? ds : null;
  }
  return st;
}

// 해시 상태 + 도시 데이터 → 엔진 입력. 모르는 id 버림, opt 클램프, 사용자 장소는 must.
export function resolvePlaces(st, city) {
  const out = [];
  for (const place of [...city.places].sort((a, b) => a.id < b.id ? -1 : 1)) {
    if (!Object.hasOwn(st.p, place.id)) continue;
    const opt = Math.min(st.p[place.id], place.opts.length - 1);
    out.push({ ...place, opt, must: st.m.includes(place.id) });
  }
  st.u.forEach((u, i) => out.push({
    id: `u${i}`, name: u.name, lat: u.lat, lng: u.lng, weight: 1,
    opts: [{ label: '머물기', min: u.min }], opt: 0, must: true, user: true,
  }));
  return out;
}
