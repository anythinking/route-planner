import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadowPolygons, shadowLength } from '../src/shadow.js';

const sq = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]];   // 약 111m 정사각형

test('shadowLength: 고도 45°면 높이만큼, 낮을수록 길어진다', () => {
  assert.ok(Math.abs(shadowLength(10, 45) - 10) < 1e-9);
  assert.ok(shadowLength(10, 20) > shadowLength(10, 45));
  assert.equal(shadowLength(10, 0), Infinity);
});
test('shadowPolygons: 해가 남쪽(180°)에 있으면 그림자는 북쪽(위도 +)으로 간다', () => {
  const polys = shadowPolygons(sq, 100, { altitude: 45, azimuth: 180 }, 0);
  assert.equal(polys.length, 1 + 4);                     // 옮긴 발자국 + 변 4개
  const moved = polys[0][0];
  assert.ok(moved[0][1] > 0 && Math.abs(moved[0][0]) < 1e-9);   // 북으로만
  assert.ok(Math.abs(moved[0][1] * 111320 - 100) < 1);          // 100m
});
test('shadowPolygons: 해가 지면 그림자 없음, 길이는 상한에 걸린다', () => {
  assert.deepEqual(shadowPolygons(sq, 100, { altitude: -3, azimuth: 90 }, 0), []);
  const polys = shadowPolygons(sq, 100, { altitude: 3, azimuth: 90 }, 0, 400);
  assert.ok(Math.abs(polys[0][0][0][0] * 111320) <= 400.5);   // 서쪽(해 동쪽)으로 최대 400m
});
