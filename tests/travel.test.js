import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, travelMin } from '../src/travel.js';

const STPAUL = { lat: 51.5138, lng: -0.0984 };
const BOROUGH = { lat: 51.5055, lng: -0.0910 };
const VAUXHALL = { lat: 51.4861, lng: -0.1253 };

test('같은 점은 0', () => {
  assert.equal(distanceKm(STPAUL, STPAUL), 0);
  assert.deepEqual(travelMin(STPAUL, STPAUL), { min: 0, mode: 'walk', km: 0 });
});

test('세인트폴→버러는 약 1km, 도보', () => {
  const d = distanceKm(STPAUL, BOROUGH);
  assert.ok(d > 0.9 && d < 1.2, `d=${d}`);
  const t = travelMin(STPAUL, BOROUGH);
  assert.equal(t.mode, 'walk');
  assert.ok(t.min >= 15 && t.min <= 25, `min=${t.min}`);   // 여행 때 실측 25±8
});

test('복셀→세인트폴은 2km 넘어 지하철', () => {
  const t = travelMin(VAUXHALL, STPAUL);
  assert.equal(t.mode, 'metro');
  assert.ok(t.min >= 17 && t.min <= 30, `min=${t.min}`);   // 실측 25~30
});

test('2.0km 경계: 이하 도보, 초과 지하철', () => {
  // 위도 1도 ≈ 111.2km → 2.0km ≈ 0.01799도
  const a = { lat: 50, lng: 0 };
  assert.equal(travelMin(a, { lat: 50 + 1.99 / 111.2, lng: 0 }).mode, 'walk');
  assert.equal(travelMin(a, { lat: 50 + 2.01 / 111.2, lng: 0 }).mode, 'metro');
});

test('분은 정수', () => {
  const t = travelMin(STPAUL, BOROUGH);
  assert.equal(t.min, Math.round(t.min));
});

// ---- 리뷰 후 보강: 여행 때 실측한 쌍 ----
test('버러→런던탑 도보 약 15분', () => {
  const t = travelMin({ lat: 51.5055, lng: -0.0910 }, { lat: 51.5081, lng: -0.0759 });
  assert.equal(t.mode, 'walk'); assert.ok(t.min >= 12 && t.min <= 22, `min=${t.min}`);
});
test('버킹엄→카페 로열(리젠트가) 도보 약 20분', () => {
  const t = travelMin({ lat: 51.5014, lng: -0.1419 }, { lat: 51.5095, lng: -0.1366 });
  assert.equal(t.mode, 'walk'); assert.ok(t.min >= 12 && t.min <= 25, `min=${t.min}`);
});
test('복셀→세인트판크라스 지하철 약 12~20분', () => {
  const t = travelMin({ lat: 51.4861, lng: -0.1253 }, { lat: 51.5308, lng: -0.1238 });
  assert.equal(t.mode, 'metro'); assert.ok(t.min >= 15 && t.min <= 25, `min=${t.min}`);
});

// ---- 이동수단: 택시 · 강제 모드 · 기본 선호 ----
test('taxi: 대기 5분 + 1.5×직선/25km/h', () => {
  const t = travelMin(STPAUL, VAUXHALL, { mode: 'taxi' });
  const km = distanceKm(STPAUL, VAUXHALL);
  assert.equal(t.mode, 'taxi');
  assert.equal(t.min, Math.round(5 + km * 1.5 / 25 * 60));
});
test('강제 모드: 2km 넘어도 walk, 2km 아래도 metro', () => {
  assert.equal(travelMin(STPAUL, VAUXHALL, { mode: 'walk' }).mode, 'walk');
  assert.equal(travelMin(STPAUL, BOROUGH, { mode: 'metro' }).mode, 'metro');
});
test('pref=taxi: 2km 넘으면 지하철 대신 택시, 아래는 도보', () => {
  assert.equal(travelMin(STPAUL, VAUXHALL, { pref: 'taxi' }).mode, 'taxi');
  assert.equal(travelMin(STPAUL, BOROUGH, { pref: 'taxi' }).mode, 'walk');
});
test('옵션 없으면 기존 규칙 그대로', () => {
  assert.deepEqual(travelMin(STPAUL, BOROUGH), travelMin(STPAUL, BOROUGH, {}));
});
