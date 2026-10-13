import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../src/html.js';

test('esc: HTML 특수문자 5종을 엔티티로', () => {
  assert.equal(esc(`<img src=x onerror="alert(1)">&'`), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
});
test('esc: 평문은 그대로, 비문자열은 문자열로', () => {
  assert.equal(esc('이코이 180'), '이코이 180');
  assert.equal(esc(42), '42'); assert.equal(esc(null), '');
});
