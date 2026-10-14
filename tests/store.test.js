import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore } from '../src/store.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('LocalStore: 로그인 전엔 사용자 없음, 이름으로 들어가면 사용자 생김', async () => {
  const s = new LocalStore(mem());
  assert.equal(await s.user(), null);
  await s.signIn({ name: '영철' });
  assert.deepEqual(await s.user(), { id: 'local', name: '영철' });
  await s.signOut(); assert.equal(await s.user(), null);
});

test('LocalStore: 여행 만들기·목록·갱신·삭제가 사용자별로 남는다', async () => {
  const s = new LocalStore(mem()); await s.signIn({ name: '영철' });
  const p = await s.createProject({ name: '런던 3일', city: 'london', hash: 'c=london&d=3' });
  assert.ok(p.id && p.createdAt);
  assert.equal((await s.listProjects()).length, 1);
  await s.updateProject(p.id, { shopping: [{ text: '홍차', done: false }] });
  assert.equal((await s.getProject(p.id)).shopping[0].text, '홍차');
  await s.deleteProject(p.id);
  assert.equal((await s.listProjects()).length, 0);
});

test('LocalStore: 사진은 여행에 붙고, 좌표·장소·메모를 가진다', async () => {
  const s = new LocalStore(mem()); await s.signIn({ name: '영철' });
  const p = await s.createProject({ name: '파리', city: 'paris', hash: '' });
  const ph = await s.addPhoto(p.id, { dataUrl: 'data:image/jpeg;base64,xx', lat: 48.86, lng: 2.35, placeId: 'louvre', note: '피라미드' });
  assert.ok(ph.id);
  assert.equal((await s.getProject(p.id)).photos.length, 1);
  await s.updatePhoto(p.id, ph.id, { note: '밤' });
  assert.equal((await s.getProject(p.id)).photos[0].note, '밤');
  await s.deletePhoto(p.id, ph.id);
  assert.equal((await s.getProject(p.id)).photos.length, 0);
});

test('LocalStore: updateUser로 이름·기본 설정을 바꾸고 user()에 반영된다', async () => {
  const s = new LocalStore(mem()); await s.signIn({ name: '영철' });
  await s.updateUser({ name: '신영철', prefs: { c: 'paris', v: 'taxi' } });
  const u = await s.user();
  assert.equal(u.name, '신영철'); assert.deepEqual(u.prefs, { c: 'paris', v: 'taxi' });
});
