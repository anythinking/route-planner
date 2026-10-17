// 누가 어디를 만졌나 — 저장 전·후 플랜(해시)을 비교해 바뀐 장소에 이름표를 붙인다 (순수 함수)
import { decode } from './state.js';

// prevHash·nextHash: 플랜 해시 문자열, edits: {id: {by, at}}, by: 사람 이름, at: ms
export function tagEdits(prevHash, nextHash, edits, by, at = Date.now()) {
  const a = decode('#' + (prevHash || '')), b = decode('#' + (nextHash || ''));
  const out = { ...(edits || {}) };
  const ids = new Set([...Object.keys(a.p), ...Object.keys(b.p)]);
  for (const id of ids) {
    const was = Object.hasOwn(a.p, id), now = Object.hasOwn(b.p, id);
    if (!now) { delete out[id]; continue; }                                              // 빠진 곳은 표도 뗀다
    if (!was || a.p[id] !== b.p[id] || a.m.includes(id) !== b.m.includes(id)) out[id] = { by, at };   // 새로 넣었거나 체류·꼭이 바뀜
  }
  // 내 장소: 이름 기준
  const an = new Set(a.u.map(u => u.name)); b.u.forEach((u, i) => { if (!an.has(u.name)) out[`u${i}`] = { by, at }; });
  // 날짜 배정·순서가 바뀌면 그날의 장소 전부에
  const key = o => (o || []).map(d => d.join(',')).join('|');
  if (key(a.o) !== key(b.o) && b.o) b.o.forEach((day, i) => { if ((a.o?.[i] || []).join(',') !== day.join(',')) day.forEach(id => { if (!out[id]) out[id] = { by, at }; }); });
  return out;
}
