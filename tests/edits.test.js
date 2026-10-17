import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagEdits } from '../src/edits.js';

test('tagEdits: 새로 넣은 곳·체류 바뀐 곳에 이름표, 빠진 곳은 표 제거', () => {
  const e = tagEdits('c=paris&p=eiffel:0,louvre:1', 'c=paris&p=eiffel:1,orsay:0', { louvre: { by: '형', at: 1 }, eiffel: { by: '형', at: 1 } }, '영철', 5);
  assert.deepEqual(e.orsay, { by: '영철', at: 5 });     // 새로
  assert.deepEqual(e.eiffel, { by: '영철', at: 5 });    // 체류 바뀜
  assert.equal(e.louvre, undefined);                     // 빠짐
});
test('tagEdits: 순서만 바뀐 날의 장소에도 이름표', () => {
  const e = tagEdits('c=paris&p=a:0,b:0&o=a,b', 'c=paris&p=a:0,b:0&o=b,a', {}, '형', 9);
  assert.deepEqual(e.a, { by: '형', at: 9 }); assert.deepEqual(e.b, { by: '형', at: 9 });
});
