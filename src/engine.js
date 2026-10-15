// 경로 엔진. 순수 함수. DOM 없음.
import { distanceKm, travelMin } from './travel.js';

export const dwell = p => p.opts[p.opt].min;
export const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// 자르기·넘기기 우선순위: weight 큰 수(=낮은 순위) → 체류 긴 것 → id
const dropOrder = (a, b) => (b.weight - a.weight) || (dwell(b) - dwell(a)) || byId(a, b);
// 평면 근사 거리² (묶기용 — 도시 규모에선 충분)
const planar = (a, b) => {
  const k = Math.cos(a.lat * Math.PI / 180);
  return (a.lat - b.lat) ** 2 + ((a.lng - b.lng) * k) ** 2;
};

// 이미 고른 것들에서 가장 먼 후보. 동률이면 앞 것(= id 순).
function farthest(cands, chosen) {
  let best = null, bestD = -1;
  for (const c of cands) {
    const d = chosen.length ? Math.min(...chosen.map(s => distanceKm(s, c))) : 0;
    if (d > bestD) { bestD = d; best = c; }
  }
  return best;
}

// 묶음 M개의 씨앗. 꼭 가기 중 서로 먼 순 → 모자라면 weight 1→2→3 순.
export function seed(places, M) {
  M = Math.min(M, places.length);
  const seeds = [];
  const take = pool => {
    while (seeds.length < M && pool.length) {
      const pick = seeds.length ? farthest(pool, seeds) : pool[0];
      seeds.push(pick); pool.splice(pool.indexOf(pick), 1);
    }
  };
  take(places.filter(p => p.must).sort(byId));
  for (const w of [1, 2, 3]) take(places.filter(p => !p.must && p.weight === w).sort(byId));
  return seeds;
}

// k-means 10바퀴 + 균형 3바퀴. 빈 묶음은 버린다.
export function cluster(places, seeds, budget) {
  const M = seeds.length;
  let cents = seeds.map(s => ({ lat: s.lat, lng: s.lng }));
  let groups = [];
  for (let round = 0; round < 10; round++) {
    groups = Array.from({ length: M }, () => []);
    for (const p of [...places].sort(byId)) {
      let bi = 0, bd = Infinity;
      cents.forEach((c, i) => { const d = planar(p, c); if (d < bd) { bd = d; bi = i; } });
      groups[bi].push(p);
    }
    cents = groups.map((g, i) => g.length
      ? { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lng, 0) / g.length }
      : cents[i]);
  }
  const sum = g => g.reduce((s, p) => s + dwell(p), 0);
  const cap = budget * 1.2;
  for (let round = 0; round < 3; round++) {
    groups.forEach((g, gi) => {
      if (sum(g) <= cap) return;
      const cand = g.filter(p => !p.must).sort(dropOrder)[0];
      if (!cand) return;
      let best = -1, bd = Infinity;
      groups.forEach((h, hi) => {
        if (hi === gi || sum(h) + dwell(cand) > cap) return;
        const d = planar(cand, cents[hi]);
        if (d < bd) { bd = d; best = hi; }
      });
      if (best >= 0) { g.splice(g.indexOf(cand), 1); groups[best].push(cand); }
    });
  }
  return groups.filter(g => g.length);
}

function pathCost(seq, start, pref) {
  let c = 0, prev = start;
  for (const p of seq) { c += travelMin(prev, p, { pref }).min; prev = p; }
  return c;
}
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r]));
}

// 하루 안 방문 순서. 7곳 이하 완전탐색, 그 위는 최근접 + 2-opt.
export function order(group, start, pref = 'transit') {
  const g = [...group].sort(byId);
  if (g.length === 0) return [];
  if (g.length <= 7) {
    let best = null, bc = Infinity;
    for (const seq of permutations(g)) {           // id 사전순 생성 → 동률은 첫 것
      const c = pathCost(seq, start, pref);
      if (c < bc) { bc = c; best = seq; }
    }
    return best;
  }
  const left = [...g], seq = []; let prev = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = travelMin(prev, p, { pref }).min; if (d < bd) { bd = d; bi = i; } });
    prev = left[bi]; seq.push(prev); left.splice(bi, 1);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) for (let k = i + 1; k < seq.length; k++) {
      const cand = [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)];
      if (pathCost(cand, start, pref) < pathCost(seq, start, pref)) { seq.splice(0, seq.length, ...cand); improved = true; }
    }
  }
  return seq;
}

// 순서대로 시각을 쌓는다. legs['from>to']로 구간을 덮어쓴다: 'walk'|'metro'|'taxi' 또는 분(정수).
export function schedule(ordered, start, dayStart, { legs = {}, pref = 'transit' } = {}) {
  const stops = []; let cur = dayStart, prev = start, walkKm = 0, moveMin = 0;
  for (const p of ordered) {
    const ov = legs[`${prev.id ?? 'start'}>${p.id}`];
    const t = typeof ov === 'number' ? { min: ov, mode: 'custom', km: distanceKm(prev, p) }
            : ov ? travelMin(prev, p, { mode: ov }) : travelMin(prev, p, { pref });
    const arrive = cur + t.min, depart = arrive + dwell(p);
    stops.push({ place: p, arrive, depart, travelMin: t.min, travelMode: t.mode });
    if (t.mode === 'walk') walkKm += t.km;
    moveMin += t.min; cur = depart; prev = p;
  }
  return { stops, walkKm: Math.round(walkKm * 10) / 10, moveMin, end: cur, over: false, why: '' };
}

// 예산 초과 해소. 꼭 가기 아닌 것 중 최하 중요도를 빼고 순서·시간을 다시 돈다.
export function trim(day, ctx) {
  const dropped = [];
  let stops = day.stops.map(s => s.place);
  let d = day;
  while (d.end > ctx.dayEnd) {
    const cand = stops.filter(p => !p.must).sort(dropOrder)[0];
    if (!cand) { d.over = true; break; }
    dropped.push({ place: cand, reason: `${ctx.dayIndex + 1}일차가 ${hm(ctx.dayEnd)}을 ${d.end - ctx.dayEnd}분 넘겨서` });
    stops = stops.filter(p => p !== cand);
    d = schedule(order(stops, ctx.start, ctx.pref), ctx.start, ctx.dayStart, ctx);
  }
  return { day: d, dropped };
}

function why(day) {
  const ps = day.stops.map(s => s.place);
  const must = ps.filter(p => p.must).sort(byId)[0];
  if (must) return `꼭 가기 ${must.name} 중심`;
  if (ps.length < 2) return '하루에 하나';
  let maxD = 0;
  for (const a of ps) for (const b of ps) maxD = Math.max(maxD, distanceKm(a, b));
  return `서로 ${maxD.toFixed(1)}km 안`;
}

// manual = [[id,...],...] 이 지금 고른 장소 집합과 정확히 맞으면 그 배정·순서를 그대로 쓴다.
function manualValid(manual, places) {
  if (!Array.isArray(manual) || !manual.length) return false;
  const ids = manual.flat();
  const have = new Set(places.map(p => p.id));
  return ids.length === have.size && ids.every(id => have.has(id)) && new Set(ids).size === ids.length;
}

// 전체: 씨앗 → 묶기 → (순서 → 시간 → 자르기) × 날. manual이 맞으면 묶기·순서·자르기를 건너뛰고 시간만 쌓는다.
// perDay = { [i]: { dayStart?, dayEnd?, pref?, start? } } — 그날만 다르게. 없는 칸은 전체 값.
export function plan(places, { days, start, dayStart = 570, dayEnd = 1140, pref = 'transit', legs = {}, manual = null, perDay = {} }) {
  if (!places.length) return { days: [], dropped: [], manual: false };
  const forDay = i => { const o = perDay?.[i] || {}; return { start: o.start || start, dayStart: o.dayStart ?? dayStart, dayEnd: o.dayEnd ?? dayEnd, pref: o.pref || pref }; };
  if (manualValid(manual, places)) {
    const byIdMap = new Map(places.map(p => [p.id, p]));
    const out = manual.map((ids, i) => {
      const d = forDay(i);
      const day = schedule(ids.map(id => byIdMap.get(id)), d.start, d.dayStart, { legs, pref: d.pref });
      day.over = day.end > d.dayEnd;
      day.why = ids.length ? '직접 정한 순서' : '비어 있음';
      return day;
    });
    return { days: out, dropped: [], manual: true };
  }
  const M = Math.min(days, places.length);
  const groups = cluster(places, seed(places, M), dayEnd - dayStart);
  const out = [], dropped = [];
  groups.forEach((g, i) => {
    const d = forDay(i);
    const d0 = schedule(order(g, d.start, d.pref), d.start, d.dayStart, { legs, pref: d.pref });
    const { day, dropped: dr } = trim(d0, { start: d.start, dayStart: d.dayStart, dayEnd: d.dayEnd, dayIndex: i, legs, pref: d.pref });
    dropped.push(...dr);
    day.why = day.stops.length ? why(day) : '전부 예산을 넘겨 뺐다';   // 빈 날도 남겨 번호를 지킨다
    out.push(day);
  });
  return { days: out, dropped, manual: false };
}
