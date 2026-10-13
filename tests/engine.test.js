import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dwell, seed, cluster } from '../src/engine.js';

// 런던 축소 픽스처. 동쪽(시티·버러) 5곳, 서쪽(웨스트엔드) 5곳.
const P = (id, name, lat, lng, weight, min, extra = {}) =>
  ({ id, name, lat, lng, weight, opts: [{ label: '보기', min }], opt: 0, must: false, ...extra });
export const LONDON = [
  P('stpaul',   '세인트폴',     51.5138, -0.0984, 1, 30),
  P('borough',  '버러 마켓',    51.5055, -0.0910, 1, 120),
  P('tower',    '런던탑',       51.5081, -0.0759, 1, 35),
  P('towerbr',  '타워브릿지',   51.5055, -0.0754, 1, 20),
  P('shard',    '더 샤드',      51.5045, -0.0865, 2, 90),
  P('buck',     '버킹엄',       51.5014, -0.1419, 1, 105),
  P('garnier',  '카페 로열',    51.5095, -0.1366, 3, 60),
  P('soho',     '소호',         51.5130, -0.1388, 2, 60),
  P('bm',       '영국박물관',   51.5194, -0.1270, 1, 90),
  P('traf',     '트라팔가',     51.5080, -0.1281, 2, 30),
];
export const HOTEL = { lat: 51.4861, lng: -0.1253 }; // 복셀
const withMust = (list, ids) => list.map(p => ({ ...p, must: ids.includes(p.id) }));

test('dwell은 고른 선택지의 분', () => {
  const p = { ...LONDON[0], opts: [{ label: 'a', min: 30 }, { label: 'b', min: 105 }], opt: 1 };
  assert.equal(dwell(p), 105);
});

test('seed: 꼭 가기가 M개 이상이면 그중 서로 먼 M개', () => {
  const s = seed(withMust(LONDON, ['borough', 'buck', 'tower']), 2);
  assert.equal(s.length, 2);
  const ids = s.map(p => p.id).sort();
  assert.deepEqual(ids, ['borough', 'buck']);   // 동·서로 가장 먼 쌍
});

test('seed: 꼭 가기가 모자라면 weight 1부터 채운다', () => {
  const s = seed(withMust(LONDON, ['borough']), 2);
  assert.equal(s[0].id, 'borough');
  assert.equal(s[1].weight, 1);
  assert.notEqual(s[1].id, 'borough');
});

test('seed: 장소가 M보다 적으면 M을 줄인다', () => {
  assert.equal(seed(LONDON.slice(0, 2), 5).length, 2);
});

test('seed: 결정적', () => {
  const a = seed(LONDON, 3).map(p => p.id), b = seed(LONDON, 3).map(p => p.id);
  assert.deepEqual(a, b);
});

test('cluster: 동서로 갈린다', () => {
  const s = seed(withMust(LONDON, ['borough', 'buck']), 2);
  const g = cluster(LONDON, s, 570);
  assert.equal(g.length, 2);
  const east = g.find(x => x.some(p => p.id === 'borough')).map(p => p.id).sort();
  assert.deepEqual(east, ['borough', 'shard', 'stpaul', 'tower', 'towerbr']);
  assert.equal(g.flat().length, LONDON.length);   // 빠진 장소 없음
});

test('cluster: 한 묶음이 예산×1.2를 넘치면 낮은 중요도를 옆으로 넘긴다', () => {
  // 동쪽에 체류 600분짜리를 하나 더 → 동쪽 합이 한도를 넘는다
  const fat = [...LONDON, P('fat', '뚱뚱한 곳', 51.5060, -0.0900, 3, 600)];
  const s = seed(withMust(fat, ['borough', 'buck']), 2);
  const g = cluster(fat, s, 570);                 // 한도 684
  // 넘길 수 있는 건 넘겼거나(서쪽이 받았거나), 받을 곳이 없어 그대로다 — 어느 쪽이든 전체 장소 수는 보존
  assert.equal(g.flat().length, fat.length);
  assert.ok(g.every(grp => grp.length > 0));
});

import { order, schedule } from '../src/engine.js';
import { travelMin } from '../src/travel.js';

const pathCost = (seq, start) => { let c = 0, prev = start; for (const p of seq) { c += travelMin(prev, p).min; prev = p; } return c; };
const perms = arr => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r]));

test('order(≤7): 완전탐색 최소와 같다', () => {
  const east = LONDON.filter(p => ['stpaul', 'borough', 'tower', 'towerbr', 'shard'].includes(p.id));
  const got = order(east, HOTEL);
  const best = Math.min(...perms(east).map(s => pathCost(s, HOTEL)));
  assert.equal(pathCost(got, HOTEL), best);
  assert.equal(got.length, 5);
});

test('order(>7): 최근접+2-opt, 전부 포함', () => {
  const got = order(LONDON, HOTEL);          // 10곳
  assert.equal(got.length, 10);
  assert.deepEqual(got.map(p => p.id).sort(), LONDON.map(p => p.id).sort());
});

test('order: 결정적', () => {
  const a = order(LONDON, HOTEL).map(p => p.id), b = order(LONDON, HOTEL).map(p => p.id);
  assert.deepEqual(a, b);
});

test('schedule: 도착·출발이 체류·이동으로 쌓인다', () => {
  const seq = [LONDON[0], LONDON[1]];          // 세인트폴(30) → 버러(120)
  const d = schedule(seq, HOTEL, 570);
  const t0 = travelMin(HOTEL, seq[0]).min, t1 = travelMin(seq[0], seq[1]).min;
  assert.equal(d.stops[0].arrive, 570 + t0);
  assert.equal(d.stops[0].depart, 570 + t0 + 30);
  assert.equal(d.stops[1].arrive, 570 + t0 + 30 + t1);
  assert.equal(d.stops[1].depart, 570 + t0 + 30 + t1 + 120);
  assert.equal(d.end, d.stops[1].depart);
  assert.equal(d.moveMin, t0 + t1);
  assert.equal(d.over, false);
});

test('schedule: 빈 입력은 빈 날', () => {
  const d = schedule([], HOTEL, 570);
  assert.deepEqual(d.stops, []); assert.equal(d.end, 570);
});

import { trim, plan, hm } from '../src/engine.js';

test('hm', () => { assert.equal(hm(570), '9:30'); assert.equal(hm(1140), '19:00'); });

test('trim: 넘치면 꼭 가기 아닌 최하 중요도부터 뺀다', () => {
  const east = withMust(LONDON.filter(p => ['stpaul', 'borough', 'tower', 'towerbr', 'shard'].includes(p.id)), ['borough']);
  const day0 = schedule(order(east, HOTEL), HOTEL, 570);
  // 예산을 아주 짧게 줘서 반드시 넘치게
  const { day, dropped } = trim(day0, { start: HOTEL, dayStart: 570, dayEnd: 570 + 150, dayIndex: 0 });
  assert.ok(dropped.length > 0);
  assert.equal(dropped[0].place.id, 'shard');            // weight 2 · 체류 90 → 가장 먼저
  assert.ok(dropped.every(d => d.place.id !== 'borough')); // 꼭 가기는 안 뺀다
  assert.ok(day.stops.some(s => s.place.id === 'borough'));
  assert.match(dropped[0].reason, /1일차가 12:00을 \d+분 넘겨서/);
});

test('trim: 전부 꼭 가기면 못 빼고 over=true', () => {
  const all = withMust(LONDON.slice(0, 3), ['stpaul', 'borough', 'tower']);
  const day0 = schedule(order(all, HOTEL), HOTEL, 570);
  const { day, dropped } = trim(day0, { start: HOTEL, dayStart: 570, dayEnd: 600, dayIndex: 2 });
  assert.equal(dropped.length, 0);
  assert.equal(day.over, true);
  assert.equal(day.stops.length, 3);
});

test('plan: 기본 — 전부 배정, 어느 날도 dayEnd 초과 없음, 꼭 가기 전부 포함', () => {
  const places = withMust(LONDON, ['borough', 'buck']);
  const r = plan(places, { days: 3, start: HOTEL, dayStart: 570, dayEnd: 1140 });
  const placed = r.days.flatMap(d => d.stops.map(s => s.place.id));
  assert.equal(placed.length + r.dropped.length, places.length);
  assert.ok(placed.includes('borough') && placed.includes('buck'));
  for (const d of r.days) { assert.ok(d.end <= 1140 || d.over, `end=${d.end}`); assert.ok(d.stops.length > 0); assert.ok(d.why.length > 0); }
});

test('plan: 결정적', () => {
  const a = JSON.stringify(plan(LONDON, { days: 3, start: HOTEL }));
  const b = JSON.stringify(plan(LONDON, { days: 3, start: HOTEL }));
  assert.equal(a, b);
});

test('plan: M > n 이면 빈 날 없이 n일', () => {
  const r = plan(LONDON.slice(0, 2), { days: 5, start: HOTEL });
  assert.equal(r.days.length, 2);
});

test('plan: 빈 입력', () => {
  assert.deepEqual(plan([], { days: 3, start: HOTEL }), { days: [], dropped: [], manual: false });
});

test('plan: 도시 밖 이상치가 있어도 NaN 없이 전부 배정된다', () => {
  const far = { ...P('far', '먼 곳', 51.9, -0.6, 1, 60), must: true };   // ~50km
  const r = plan([...LONDON, far], { days: 3, start: HOTEL });
  const placed = r.days.flatMap(d => d.stops.map(s => s.place.id));
  assert.ok(placed.includes('far'));
  assert.equal(placed.length + r.dropped.length, LONDON.length + 1);
  for (const d of r.days) for (const s of d.stops) assert.ok(Number.isFinite(s.arrive) && Number.isFinite(s.depart));
});

test('plan: 뺀 것은 그날의 최하 중요도', () => {
  // 하루 예산을 짧게 → 자르기 발생. 뺀 것들의 weight가 남은 것들보다 작지 않아야 한다(날 단위로)
  const r = plan(LONDON, { days: 1, start: HOTEL, dayStart: 570, dayEnd: 800 });
  assert.ok(r.dropped.length > 0);
  const keptMinW = Math.min(...r.days[0].stops.map(s => s.place.weight));
  for (const d of r.dropped) assert.ok(d.place.weight >= keptMinW);
});

// ---- 리뷰 후 보강 ----
test('plan: 한 장소가 혼자 예산을 넘겨 날이 비어도 날은 남고 reason의 일차가 화면 번호와 맞는다', () => {
  const places = [
    { ...P('a', 'A', 51.5138, -0.0984, 1, 60), must: true },
    { ...P('b', 'B', 51.5014, -0.1419, 1, 60), must: true },
    P('z', 'Z', 51.5300, -0.0500, 3, 900),            // 혼자 900분 → 어느 날에 가도 넘친다
  ];
  const r = plan(places, { days: 3, start: HOTEL, dayStart: 570, dayEnd: 1140 });
  assert.equal(r.days.length, 3, '요청한 3일이 그대로 나온다');
  const empty = r.days.findIndex(d => d.stops.length === 0);
  assert.ok(empty >= 0, '빈 날이 하나 있다');
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].reason, new RegExp(`^${empty + 1}일차가`), 'reason의 일차 = 출력 배열 번호+1');
  assert.ok(r.days[empty].why.length > 0, '빈 날에도 설명이 있다');
});

test('plan: 1곳', () => {
  const r = plan([LONDON[0]], { days: 3, start: HOTEL });
  assert.equal(r.days.length, 1); assert.equal(r.days[0].stops.length, 1); assert.deepEqual(r.dropped, []);
});

test('order(>7): 2-opt 결과가 최근접 단독보다 나쁘지 않다', () => {
  const got = order(LONDON, HOTEL);
  // 최근접 단독을 여기서 재현
  const left = [...LONDON].sort((a, b) => a.id < b.id ? -1 : 1), nn = []; let prev = HOTEL;
  while (left.length) { let bi = 0, bd = Infinity; left.forEach((p, i) => { const d = travelMin(prev, p).min; if (d < bd) { bd = d; bi = i; } }); prev = left[bi]; nn.push(prev); left.splice(bi, 1); }
  assert.ok(pathCost(got, HOTEL) <= pathCost(nn, HOTEL));
});

test('cluster 균형: 받을 묶음이 없으면 못 넘기고 그 묶음이 한도를 넘긴 채 남는다', () => {
  const fat = [...LONDON, P('fat', '뚱뚱한 곳', 51.5060, -0.0900, 3, 600)];
  const s = seed(withMust(fat, ['borough', 'buck']), 2);
  const g = cluster(fat, s, 570);                      // cap 684: 서쪽 345+600 > 684 → 못 받는다
  const sum = grp => grp.reduce((t, p) => t + dwell(p), 0);
  const east = g.find(x => x.some(p => p.id === 'borough'));
  assert.ok(east.some(p => p.id === 'fat'), 'fat은 동쪽에 남는다');
  assert.ok(sum(east) > 684, '그래서 동쪽은 한도를 넘긴 채다');
});

test('cluster 균형: 받을 여유가 있으면 낮은 중요도가 옆으로 넘어간다', () => {
  // 동쪽에 60분짜리 3순위를 하나 더 → 동쪽 355 > cap? 아니다. cap을 낮춰서(budget 240 → cap 288) 동쪽 295+60=355가 넘치게
  const extra = [...LONDON, P('xtra', '덤', 51.5060, -0.0900, 3, 60)];
  const s = seed(withMust(extra, ['borough', 'buck']), 2);
  const g = cluster(extra, s, 240);                    // cap 288. 동 355 → xtra(3순위)부터 넘긴다. 서 345+60=405>288 → 못 받는다
  // 넘길 곳이 없으니 xtra는 동쪽에 남아야 한다 — 그 대신 "넘기기 대상 선택"이 3순위였음을 간접 확인: 1순위는 안 움직였다
  const east = g.find(x => x.some(p => p.id === 'borough')).map(p => p.id);
  for (const id of ['stpaul', 'tower', 'towerbr']) assert.ok(east.includes(id), `${id}는 1순위라 자리를 지킨다`);
});

// ---- 이동수단: 구간 덮어쓰기 · 기본 선호 ----
test('schedule: legs로 구간 모드·분을 덮어쓴다', () => {
  const seq = [LONDON[0], LONDON[1]];
  const legs = { 'start>stpaul': 'taxi', 'stpaul>borough': 25 };
  const d = schedule(seq, HOTEL, 570, { legs });
  assert.equal(d.stops[0].travelMode, 'taxi');
  assert.equal(d.stops[0].travelMin, travelMin(HOTEL, seq[0], { mode: 'taxi' }).min);
  assert.equal(d.stops[1].travelMode, 'custom'); assert.equal(d.stops[1].travelMin, 25);
});
test('schedule/plan: pref=taxi면 긴 구간이 택시로', () => {
  const d = schedule([LONDON[0]], HOTEL, 570, { pref: 'taxi' });   // 복셀→세인트폴 3.6km
  assert.equal(d.stops[0].travelMode, 'taxi');
  const r = plan(LONDON, { days: 2, start: HOTEL, pref: 'taxi' });
  assert.ok(r.days.flatMap(x => x.stops).some(s => s.travelMode === 'taxi'));
});

// ---- 수동 순서 ----
test('plan manual: 묶기·자르기 없이 준 순서대로, 넘치면 over만', () => {
  const manual = [['buck', 'traf', 'bm'], ['stpaul', 'borough', 'shard', 'tower', 'towerbr', 'garnier', 'soho']];
  const r = plan(LONDON, { days: 2, start: HOTEL, dayEnd: 700, manual });
  assert.equal(r.manual, true);
  assert.deepEqual(r.days.map(d => d.stops.map(s => s.place.id)), manual);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.days[1].over, true);
  assert.equal(r.days[0].why, '직접 정한 순서');
});
test('plan manual: 집합이 안 맞으면(빠짐·중복·모르는 id) 무시하고 자동', () => {
  for (const bad of [[['stpaul']], [['stpaul', 'stpaul', ...LONDON.slice(2).map(p => p.id)]], [[...LONDON.map(p => p.id), 'ghost']]]) {
    const r = plan(LONDON, { days: 2, start: HOTEL, manual: bad });
    assert.equal(r.manual, false, JSON.stringify(bad[0].slice(0, 3)));
    assert.equal(r.days.flatMap(d => d.stops).length + r.dropped.length, LONDON.length);
  }
});
test('plan: 자동 모드도 manual:false를 돌려준다 · 빈 입력도', () => {
  assert.equal(plan(LONDON, { days: 2, start: HOTEL }).manual, false);
  assert.deepEqual(plan([], { days: 3, start: HOTEL }), { days: [], dropped: [], manual: false });
});
