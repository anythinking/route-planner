import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, encode, decode, resolvePlaces } from '../src/state.js';

const CITY = { city: 'london', name: '런던', center: [51.507, -0.128], places: [
  { id: 'stpaul', name: '세인트폴', lat: 51.5138, lng: -0.0984, weight: 1,
    opts: [{ label: '밖에서만', min: 30 }, { label: '돔까지', min: 105 }], default: 0, note: '' },
  { id: 'borough', name: '버러', lat: 51.5055, lng: -0.0910, weight: 1,
    opts: [{ label: '안까지', min: 120 }], default: 0, note: '' },
] };

test('encode→decode 왕복', () => {
  const st = { ...DEFAULTS, c: 'paris', d: 4, t: 600, e: 1200, s: { lat: 48.8506, lng: 2.2866 },
    p: { stpaul: 1, borough: 0 }, m: ['borough'], u: [{ name: '이코이', lat: 51.512, lng: -0.113, min: 180 }] };
  const back = decode('#' + encode(st));
  assert.deepEqual(back, st);
});

test('빈 해시·깨진 해시는 기본값', () => {
  assert.deepEqual(decode(''), DEFAULTS);
  assert.deepEqual(decode('#%%%'), DEFAULTS);
  assert.deepEqual(decode('#d=abc&t=-5&e=9999'), DEFAULTS);
});

test('e ≤ t 이면 둘 다 기본값', () => {
  const st = decode('#t=900&e=600');
  assert.equal(st.t, DEFAULTS.t); assert.equal(st.e, DEFAULTS.e);
});

test('m은 p의 부분집합만', () => {
  const st = decode('#p=stpaul:0&m=stpaul,ghost');
  assert.deepEqual(st.m, ['stpaul']);
});

test('resolvePlaces: 모르는 id는 버리고 opt는 클램프', () => {
  const st = decode('#p=stpaul:9,ghost:0,borough:0&m=borough');
  const r = resolvePlaces(st, CITY);
  assert.deepEqual(r.map(p => p.id), ['borough', 'stpaul']);
  assert.equal(r.find(p => p.id === 'stpaul').opt, 1);      // 9 → 마지막(1)
  assert.equal(r.find(p => p.id === 'borough').must, true);
  assert.equal(r.find(p => p.id === 'stpaul').must, false);
});

test('resolvePlaces: 사용자 장소는 u0.. weight1 must', () => {
  const st = decode('#u=이코이~51.512~-0.113~180');
  const r = resolvePlaces(st, CITY);
  assert.equal(r.length, 1);
  assert.deepEqual({ id: r[0].id, weight: r[0].weight, must: r[0].must, min: r[0].opts[0].min }, { id: 'u0', weight: 1, must: true, min: 180 });
});

// ---- 리뷰 후 보강 ----
test('decode: 프로토타입 키(constructor)는 p·m에 못 들어온다', () => {
  const st = decode('#p=constructor:0,stpaul:0&m=constructor,stpaul');
  assert.deepEqual(Object.keys(st.p), ['stpaul']);
  assert.deepEqual(st.m, ['stpaul']);
});
test('resolvePlaces: 프로토타입 키는 장소로 안 나온다', () => {
  const st = decode('#p=constructor:0&m=constructor');
  assert.deepEqual(resolvePlaces(st, CITY), []);
});

// ---- 이동수단·수동 순서 키 ----
test('v·l·o 왕복', () => {
  const st = { ...DEFAULTS, c: 'london', p: { stpaul: 0, borough: 0 }, v: 'taxi',
    l: { 'start>stpaul': 'taxi', 'stpaul>borough': 25 }, o: [['stpaul'], ['borough']] };
  assert.deepEqual(decode('#' + encode(st)), st);
});
test('기본값에 v·l·o가 있다', () => {
  assert.equal(DEFAULTS.v, 'transit'); assert.deepEqual(DEFAULTS.l, {}); assert.equal(DEFAULTS.o, null);
});
test('l: 모르는 모드·0 이하 분은 버린다', () => {
  const st = decode('#l=a>b:bus,c>d:0,e>f:taxi,g>h:40');
  assert.deepEqual(st.l, { 'e>f': 'taxi', 'g>h': 40 });
});
test('o: 빈 날·잘못된 id는 버리고, 비면 null', () => {
  assert.deepEqual(decode('#o=stpaul,borough|buck').o, [['stpaul', 'borough'], ['buck']]);
  assert.equal(decode('#o=|').o, null);
  assert.equal(decode('#o=bad id,!').o, null);
});

test('tab: 기본은 plan이고 해시에 안 쓴다, 모르는 값은 notfound(404)', () => {
  assert.equal(decode('').tab, 'plan');
  assert.equal(decode('#tab=guide').tab, 'guide');
  assert.equal(decode('#tab=gift').tab, 'guide');   // 옛 링크(준비물·사진·기념품)는 가이드로
  assert.equal(decode('#tab=nope').tab, 'notfound');
  assert.equal(decode('#tab=privacy').tab, 'privacy');
  assert.equal(decode('#tab=terms').tab, 'terms');
  assert.equal(decode('#tab=account').tab, 'account');   // 내 계정 — 자기 주소가 있어야 새로고침·뒤로가 맞다
  assert.ok(!encode({ ...DEFAULTS }).includes('tab='));
  assert.ok(encode({ ...DEFAULTS, tab: 'guide' }).includes('tab=guide'));
});

test('pr: 열어 둔 여행 id — 영숫자만, 기본은 없음', () => {
  assert.equal(decode('').pr, null);
  assert.equal(decode('#pr=abc123').pr, 'abc123');
  assert.equal(decode('#pr=../x').pr, null);
  assert.ok(encode({ ...DEFAULTS, pr: 'abc123' }).includes('pr=abc123'));
  assert.ok(!encode({ ...DEFAULTS }).includes('pr='));
});

test('tab: home도 허용된다', () => { assert.equal(decode('#tab=home').tab, 'home'); });

test('dt: 첫날 날짜 — YYYY-MM-DD만, 엉터리는 버린다', () => {
  assert.equal(decode('#dt=2026-11-03').dt, '2026-11-03');
  assert.equal(decode('#dt=2026-13-99').dt, null);
  assert.equal(decode('#dt=abc').dt, null);
  assert.ok(encode({ ...DEFAULTS, dt: '2026-11-03' }).includes('dt=2026-11-03'));
});

test('ds: 날짜별 설정 — 시작·끝·이동·출발점, 엉터리는 버린다', () => {
  const st = decode('#ds=0:t600,e1200,vtaxi,s48.85|2.34;2:t540');
  assert.deepEqual(st.ds, { 0: { t: 600, e: 1200, v: 'taxi', s: { lat: 48.85, lng: 2.34 } }, 2: { t: 540 } });
  assert.equal(decode('#ds=x:t600').ds, null);
  assert.equal(decode('#ds=0:t9999').ds, null);
  const enc = encode({ ...DEFAULTS, ds: { 1: { v: 'taxi', s: { lat: 1, lng: 2 } } } });
  assert.ok(enc.includes('ds=1%3Avtaxi%2Cs1.00000%7C2.00000') || decodeURIComponent(enc).includes('ds=1:vtaxi,s1.00000|2.00000'));
  assert.ok(!encode({ ...DEFAULTS }).includes('ds='));
});

test('lg: 여러 도시 여행에서 몇 번째 구간을 열었나 — 0은 쓰지 않는다', () => {
  assert.equal(decode('').lg, 0);
  assert.equal(decode('#lg=2').lg, 2);
  assert.equal(decode('#lg=x').lg, 0);
  assert.ok(encode({ ...DEFAULTS, lg: 1 }).includes('lg=1'));
  assert.ok(!encode({ ...DEFAULTS }).includes('lg='));
});
test('legsOf / withLeg: 여행 하나에 도시 구간 여러 개 (줄바꿈으로 구분)', async () => {
  const { legsOf, withLeg } = await import('../src/state.js');
  assert.deepEqual(legsOf('c=london&d=3\nc=paris&d=5'), ['c=london&d=3', 'c=paris&d=5']);
  assert.deepEqual(legsOf(''), ['']);
  assert.equal(withLeg('c=london\nc=paris', 1, 'c=paris&d=2'), 'c=london\nc=paris&d=2');
});

test('decode: 로그인 메일이 붙인 두 번째 #(토큰)은 무시한다', () => {
  assert.equal(decode('#tab=mine#access_token=abc&type=recovery').tab, 'mine');
  assert.equal(decode('#access_token=abc&refresh_token=x&type=recovery').tab, 'plan');
});

test('a(나누는 방법): 기본 area는 해시에 안 쓰고, 다른 값은 왕복하고, 모르는 값은 기본으로', () => {
  assert.doesNotMatch(encode({ ...DEFAULTS }), /(^|&)a=/);
  for (const a of ['route', 'even', 'priority']) { const h = encode({ ...DEFAULTS, a }); assert.match(h, new RegExp(`(^|&)a=${a}(&|$)`)); assert.equal(decode('#' + h).a, a); }
  assert.equal(decode('#a=zzz').a, 'area');
});

import { encode as enc2, decode as dec2 } from '../src/state.js';
test('at: 해시 at=id:분 이 왕복하고, 범위 밖·모르는 형식은 버린다', () => {
  const st = dec2('#c=london&d=1&p=tower:0,stpaul:0&at=tower:1050,stpaul:9999,bad');
  assert.deepEqual(st.at, { tower: 1050 });
  assert.match(enc2(st), /at=tower%3A1050|at=tower:1050/);
});
