import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchUrl, toCandidate } from '../src/search.js';

test('searchUrl: 도시 중심 주변 상자로 묶고 한국어 이름을 요청한다', () => {
  const u = new URL(searchUrl('오르세', [48.86, 2.35]));
  assert.equal(u.hostname, 'nominatim.openstreetmap.org');
  assert.equal(u.searchParams.get('q'), '오르세');
  assert.equal(u.searchParams.get('bounded'), '1');
  assert.equal(u.searchParams.get('accept-language'), 'ko');
  const [w, n, e, s] = u.searchParams.get('viewbox').split(',').map(Number);
  assert.ok(w < 2.35 && e > 2.35 && n > 48.86 && s < 48.86);
});

test('toCandidate: 이름은 앞 토막, 좌표는 숫자, 해시에 못 쓰는 문자 제거', () => {
  const c = toCandidate({ display_name: 'Musée d~Orsay|, Rue de la Légion, Paris', lat: '48.86', lon: '2.3266', type: 'museum' });
  assert.deepEqual(c, { name: 'Musée d Orsay', detail: 'Rue de la Légion, Paris', lat: 48.86, lng: 2.3266, type: 'museum' });
});
