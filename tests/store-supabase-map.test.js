import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowToProject, rowToPhoto } from '../src/store-map.js';

test('rowToProject: snake_case 행 → 화면 객체, 빈 값 기본화', () => {
  const p = rowToProject({ id: 'a', name: '런던', city: 'london', hash: null, shopping: null, created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T01:00:00Z' });
  assert.equal(p.hash, ''); assert.deepEqual(p.shopping, []); assert.deepEqual(p.photos, []); assert.ok(p.updatedAt > p.createdAt);
});
test('rowToPhoto: place_id·taken_at 변환, url은 따로 받는다', () => {
  const x = rowToPhoto({ id: 'p', path: 'u/a/p.jpg', lat: 1, lng: 2, place_id: 'louvre', note: null, taken_at: null, created_at: '2026-10-15T00:00:00Z' }, 'https://x/signed');
  assert.equal(x.placeId, 'louvre'); assert.equal(x.note, ''); assert.equal(x.takenAt, null); assert.equal(x.url, 'https://x/signed');
});
