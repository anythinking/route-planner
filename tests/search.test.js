import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchUrl, toCandidate, toCandidateWd, inBox } from '../src/search.js';

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

test('toCandidateWd: 한국어 라벨·설명과 P625 좌표, 좌표 없으면 null, 해시 금지 문자 제거', () => {
  const e = { labels: { ko: { value: '몽마르트~르' }, en: { value: 'Montmartre' } }, descriptions: { ko: { value: '파리의 언덕' } }, claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 48.8867, longitude: 2.3431 } } } }] } };
  assert.deepEqual(toCandidateWd(e), { name: '몽마르트 르', detail: '파리의 언덕', lat: 48.8867, lng: 2.3431, type: 'wikidata' });
  assert.equal(toCandidateWd({ labels: { ko: { value: '좌표 없음' } } }), null);
  assert.equal(toCandidateWd({ labels: { en: { value: 'OnlyEn' } }, claims: e.claims }).name, 'OnlyEn');
});
test('inBox: 상자 안팎, 상자 없으면 전부 통과', () => {
  assert.ok(inBox(48.88, 2.34, [48.8, 48.95, 2.2, 2.45])); assert.ok(!inBox(49.5, 2.34, [48.8, 48.95, 2.2, 2.45])); assert.ok(inBox(0, 0, null));
});
