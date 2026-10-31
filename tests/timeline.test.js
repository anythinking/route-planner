import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVisits, buildTrips } from '../src/timeline.js';

const V = (start, end, lat, lng) => ({ startTime: start, endTime: end, visit: { topCandidate: { placeLocation: `geo:${lat},${lng}` } } });
const index = { cities: { paris: { bbox: [48.80, 48.95, 2.20, 2.45] } } };
const cityData = { paris: { places: [
  { id: 'louvre', lat: 48.8606, lng: 2.3376, opts: [{ label: '핵심', min: 60 }, { label: '한 바퀴', min: 240 }] },
  { id: 'eiffel', lat: 48.8584, lng: 2.2945, opts: [{ label: '밖', min: 30 }] },
] } };
const json = { semanticSegments: [
  V('2026-10-06T14:00:00.000+02:00', '2026-10-06T14:40:00.000+02:00', 49.0097, 2.5479),   // 공항 — 첫 방문이라 뺀다
  V('2026-10-06T17:40:00.000+02:00', '2026-10-06T18:00:00.000+02:00', 48.8584, 2.2945),   // 에펠탑
  V('2026-10-06T22:00:00.000+02:00', '2026-10-07T08:30:00.000+02:00', 48.8499, 2.2834),   // 숙소
  V('2026-10-07T13:00:00.000+02:00', '2026-10-07T17:00:00.000+02:00', 48.8606, 2.3376),   // 루브르 4시간
  V('2026-10-07T17:10:00.000+02:00', '2026-10-07T17:55:00.000+02:00', 48.8530, 2.3700),   // 이름 없는 곳 45분
  V('2026-10-07T22:00:00.000+02:00', '2026-10-08T08:00:00.000+02:00', 48.8500, 2.2836),   // 숙소
  V('2026-10-08T10:00:00.000+02:00', '2026-10-08T10:20:00.000+02:00', 49.0097, 2.5479),   // 공항 — 마지막이라 뺀다
] };

test('parseVisits: 현지 날짜·분, 정렬', () => {
  const v = parseVisits(json);
  assert.equal(v.length, 7);
  assert.deepEqual([v[1].date, v[1].start, v[1].mins], ['2026-10-06', 17 * 60 + 40, 20]);
});
test('buildTrips: 숙소는 출발점, 랜드마크는 맞추고 체류 선택지는 실제 시간에 가깝게, 나머지는 내 장소, 공항은 뺀다', () => {
  const [tr] = buildTrips(parseVisits(json), index, cityData);
  assert.equal(tr.city, 'paris'); assert.equal(tr.d, 2);   // 공항만 있던 날은 여행 날이 아니다 assert.equal(tr.dt, '2026-10-06');
  assert.ok(tr.s && Math.abs(tr.s.lat - 48.8499) < 0.001);          // 숙소
  assert.deepEqual(tr.o[0], ['eiffel']);
  assert.deepEqual(tr.o[1], ['louvre', 'u0']);
  assert.equal(tr.p.louvre, 1);                                       // 240분 선택지
  assert.equal(tr.u[0].min, 45);
  assert.equal(tr.ds[1].t, 12 * 60 + 40);                             // 루브르 13:00 도착 → 12:40 출발
});
