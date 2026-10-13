import { plan, hm } from './engine.js';
import { decode, encode, DEFAULTS, TABS, resolvePlaces } from './state.js';
import { esc } from './html.js';

const CITIES = { london: '런던', paris: '파리' };
const MODE = { walk: '도보', metro: '지하철', taxi: '택시', custom: '직접' };
const TAB_LABEL = { plan: '플랜', pack: '준비물', photo: '사진', gift: '기념품' };
const DAY_COLORS = ['--d1','--d2','--d3','--d4','--d5','--d6','--d7','--d8','--d9','--d10'];
const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

let state = decode(location.hash);
let step = 2;                // 2 장소 고르기 · 3 결과 (설정은 항상 위에 떠 있다)
let lastStep = 0;            // 0 = 첫 렌더. 단계가 바뀔 때만 지도 뷰를 맞춘다
let pickStart = false;       // 켜지면 다음 지도 클릭이 출발점이 된다
let city = null;                 // data/<c>.json 내용
const cache = {};
const map = L.map('map', { zoomControl: true });
// 배경은 Esri 연회색 캔버스 — 키 없이 쓸 수 있고 글자·도로가 적어 마커가 산다. (OSM 기본 타일은 필터를 걸어도 글자가 너무 많았다)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ' }).addTo(map);
const layers = { places: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), start: L.layerGroup().addTo(map) };

export function setState(patch) {
  state = { ...state, ...patch };
  history.replaceState(null, '', '#' + encode(state));
  render();
}
export function goStep(n) { step = n; render(); }
export function loadCity(id) {
  if (!cache[id]) cache[id] = fetch(`data/${id}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(e => { delete cache[id]; throw e; });
  return cache[id];
}

function stepper(val, onDelta, fmt = v => v) {
  const w = $('span', 'stepper');
  const a = $('button', null, '−'); a.type = 'button'; a.onclick = () => onDelta(-1);
  const v = $('span', 'val', fmt(val));
  const b = $('button', null, '+'); b.type = 'button'; b.onclick = () => onDelta(1);
  w.append(a, v, b); return w;
}

function renderTabs() {
  const host = document.getElementById('tabs'); host.innerHTML = '';
  for (const t of TABS) {
    const b = $('button', null, TAB_LABEL[t]); b.type = 'button';
    b.setAttribute('aria-pressed', state.tab === t); b.onclick = () => setState({ tab: t });
    host.appendChild(b);
  }
  const sub = document.getElementById('steps'); sub.innerHTML = '';
  if (state.tab !== 'plan') return;
  [[2, '장소 고르기'], [3, '결과']].forEach(([n, label]) => {
    const b = $('button', null, label); b.type = 'button';
    b.setAttribute('aria-pressed', step === n); b.onclick = () => goStep(n);
    sub.appendChild(b);
  });
}

function drawStart() {
  layers.start.clearLayers();
  const s = state.s || { lat: city.center[0], lng: city.center[1] };
  L.circleMarker(s, { radius: 8, color: '#22201c', fillColor: '#fff', fillOpacity: 1, weight: 2, bubblingMouseEvents: false })
    .bindTooltip(state.s ? '출발점(숙소)' : '출발점(도심 기본값)').addTo(layers.start);
}

function renderSettings(side) {
  const d = $('details', 'panel settings'); d.open = settingsOpen; d.ontoggle = () => { settingsOpen = d.open; };
  d.appendChild($('summary', null, `<b>설정</b> <span class="muted">${esc(CITIES[state.c])} · ${state.d}일 · ${hm(state.t)}–${hm(state.e)} · ${state.v === 'taxi' ? '택시 위주' : '걷기+지하철'}</span>`));
  const p = d;
  const row1 = $('div', 'row');
  for (const [id, name] of Object.entries(CITIES)) {
    const b = $('button', 'btn' + (state.c === id ? ' primary' : ''), name); b.type = 'button';
    b.onclick = () => setState({ c: id, p: {}, m: [], u: [], s: null, l: {}, o: null });
    row1.appendChild(b);
  }
  p.appendChild(row1);
  const row2 = $('div', 'row');
  row2.append($('span', 'muted', '일수'), stepper(state.d, d => setState({ d: Math.max(1, Math.min(10, state.d + d)) })));
  row2.append($('span', 'muted', '하루 시작'), stepper(state.t, d => setState({ t: Math.max(0, Math.min(state.e - 60, state.t + d * 30)) }), hm));
  row2.append($('span', 'muted', '하루 끝'), stepper(state.e, d => setState({ e: Math.max(state.t + 60, Math.min(1440, state.e + d * 30)) }), hm));
  p.appendChild(row2);
  const row3 = $('div', 'row'); row3.appendChild($('span', 'muted', '기본 이동'));
  for (const [v, label] of [['transit', '걷기 + 지하철'], ['taxi', '택시 위주']]) {
    const b = $('button', 'btn' + (state.v === v ? ' primary' : ''), label); b.type = 'button';
    b.onclick = () => setState({ v }); row3.appendChild(b);
  }
  row3.appendChild($('span', 'muted', '2km 넘는 구간. 구간마다 결과에서 따로 바꿀 수 있다.'));
  p.appendChild(row3);
  const row4 = $('div', 'row'); row4.appendChild($('span', 'muted', '출발점'));
  const pick = $('button', 'btn' + (pickStart ? ' primary' : ''), pickStart ? '지도를 클릭해라…' : (state.s ? '출발점 옮기기' : '지도에서 출발점(숙소) 찍기'));
  pick.type = 'button'; pick.onclick = () => { pickStart = !pickStart; render(); };
  row4.appendChild(pick);
  row4.appendChild($('span', 'muted', state.s ? `${state.s.lat.toFixed(4)}, ${state.s.lng.toFixed(4)}` : '안 찍으면 도심에서 출발'));
  if (state.s) { const clr = $('button', 'btn sm', '지우기'); clr.type = 'button'; clr.onclick = () => setState({ s: null }); row4.appendChild(clr); }
  p.appendChild(row4);
  side.appendChild(d);
}
let settingsOpen = true;

// 지도 클릭: 출발점 찍기가 켜져 있으면 그게 우선, 아니면 단계별 동작
function bindMapClick(fallback) {
  map.off('click');
  map.on('click', e => {
    if (pickStart) { pickStart = false; setState({ s: { lat: e.latlng.lat, lng: e.latlng.lng } }); return; }
    if (fallback) fallback(e);
  });
}

function renderInfo(side) {
  const chosen = new Set(Object.keys(state.p));
  if (state.tab === 'pack') {
    const p = $('div', 'panel'); p.appendChild($('h2', null, `${esc(city.name)} 준비물`));
    p.appendChild($('p', null, '동선과 무관하게 챙길 것. 짐은 가볍게, 겹옷으로.'));
    for (const x of city.pack) p.appendChild($('p', null, `<b>${esc(x.item)}</b> <span class="muted">— ${esc(x.why)}</span>`));
    side.appendChild(p);
  }
  if (state.tab === 'photo') {
    const g = $('div', 'panel'); g.appendChild($('h2', null, `${esc(city.name)} 사진 — 공통`));
    for (const t of city.photo.general) g.appendChild($('p', null, esc(t)));
    side.appendChild(g);
    const mine = city.places.filter(pl => chosen.has(pl.id)), rest = city.places.filter(pl => !chosen.has(pl.id));
    for (const [title, list, hint] of [['내가 고른 곳', mine, '플랜에서 고른 장소만. 지도의 진한 점이 이 곳들이다.'], ['나머지 장소', rest, '고르지 않은 곳도 참고용으로.']]) {
      if (!list.length) continue;
      const p = $('div', 'panel'); p.appendChild($('h2', null, title)); p.appendChild($('p', null, hint));
      for (const pl of list) p.appendChild($('p', null, `<b>${esc(pl.name)}</b> <span class="muted">— ${esc(city.photo.places[pl.id] || '')}</span>`));
      side.appendChild(p);
    }
  }
  if (state.tab === 'gift') {
    const p = $('div', 'panel'); p.appendChild($('h2', null, `${esc(city.name)} 기념품`));
    p.appendChild($('p', null, '가볍고 안 깨지고 다른 데서 못 사는 것 순서.'));
    for (const x of city.gift) p.appendChild($('p', null, `<b>${esc(x.item)}</b> <span class="muted">· ${esc(x.where)}</span><br><span class="muted">${esc(x.note)}</span>`));
    side.appendChild(p);
  }
  // 지도엔 고른 곳만 진하게 표시해 둔다
  for (const pl of city.places) layers.places.addLayer(placeMarker(pl, chosen.has(pl.id), state.m.includes(pl.id)));
  bindMapClick(null);
}

async function render() {
  if (!Object.hasOwn(CITIES, state.c)) { state = { ...state, c: DEFAULTS.c, p: {}, m: [], u: [], s: null }; history.replaceState(null, '', '#' + encode(state)); }
  const side = document.getElementById('side');
  try { city = await loadCity(state.c); }
  catch (e) { renderTabs(); side.innerHTML = ''; side.appendChild($('div', 'panel', `<h2>데이터를 못 불러왔다</h2><p>${esc(CITIES[state.c])} 장소 파일(data/${esc(state.c)}.json)을 읽지 못했다. 네트워크를 확인하고 새로고침해라.</p>`)); return; }
  if (lastStep === 0 && resolvePlaces(state, city).length) step = 3;   // 공유 링크는 결과로 바로 연다 (도시 가드 뒤에 판단)
  renderTabs();
  side.innerHTML = '';
  layers.places.clearLayers(); layers.route.clearLayers();
  drawStart();
  map.invalidateSize();   // 첫 렌더 때 컨테이너 크기를 0으로 잰 채 fitBounds 하면 골목까지 확대된다
  const first = lastStep === 0;
  if (state.tab !== 'plan') { lastStep = -1; renderInfo(side); if (first) map.fitBounds(city.places.map(p => [p.lat, p.lng]), { padding: [20, 20] }); return; }
  const entering = step !== lastStep; lastStep = step;
  renderSettings(side);
  if (step === 2) renderStep2(side, entering);
  if (step === 3) renderStep3(side, entering);
}

// Task 8·9에서 채운다
const WEIGHT_LABEL = { 1: '1순위 — 이 도시를 대표', 2: '2순위', 3: '3순위' };

function placeMarker(pl, chosen, must) {
  // 안 고른 곳은 작고 흐리게, 고른 곳만 진하게. 1순위는 흐린 상태에서도 조금 크다.
  const m = L.circleMarker([pl.lat, pl.lng], chosen
    ? { radius: 8, weight: must ? 3 : 1.5, color: must ? '#22201c' : '#15696c', fillColor: '#15696c', fillOpacity: 1, bubblingMouseEvents: false }
    : { radius: pl.weight === 1 ? 5 : 3.5, weight: 1, color: '#b5b0a6', fillColor: '#fff', fillOpacity: 0.9, bubblingMouseEvents: false }
  ).bindTooltip(esc(pl.name));
  m.on('click', () => togglePlace(pl.id));
  return m;
}
function togglePlace(id) {
  const p = { ...state.p }, m = state.m.filter(x => x !== id);
  if (id in p) delete p[id]; else p[id] = city.places.find(x => x.id === id).default;
  setState({ p, m, o: null });
}

function renderStep2(side, entering) {
  const head = $('div', 'panel');
  const n = resolvePlaces(state, city).length;   // 해시의 모르는 id는 세지 않는다
  head.appendChild($('h2', null, `${city.name} — 가고 싶은 곳 고르기`));
  head.appendChild($('p', null, `고른 곳 ${n}개 · ${state.d}일. 「꼭」을 켜면 자르기에서 안 빠진다. 지도의 빈 곳을 클릭하면 내 장소를 추가한다.`));
  const go = $('button', 'btn primary', '경로 짜기 →'); go.type = 'button'; go.disabled = n === 0; go.onclick = () => goStep(3);
  head.appendChild(go); side.appendChild(head);

  for (const w of [1, 2, 3]) {
    const group = city.places.filter(p => p.weight === w);
    if (!group.length) continue;
    const panel = $('div', 'panel'); panel.appendChild($('h2', null, WEIGHT_LABEL[w]));
    for (const pl of group) {
      const chosen = pl.id in state.p, must = state.m.includes(pl.id);
      const row = $('div', 'row');
      const cb = $('input'); cb.type = 'checkbox'; cb.checked = chosen; cb.id = 'cb-' + pl.id; cb.onchange = () => togglePlace(pl.id);
      const lab = $('label', null, esc(pl.name)); lab.htmlFor = cb.id; lab.style.fontWeight = '600';
      row.append(cb, lab);
      if (chosen) {
        const mustBtn = $('button', 'btn' + (must ? ' primary' : ''), '꼭'); mustBtn.type = 'button';
        mustBtn.onclick = () => setState({ m: must ? state.m.filter(x => x !== pl.id) : [...state.m, pl.id] });
        const sel = $('select');
        pl.opts.forEach((o, i) => { const op = $('option', null, `${o.label} · ${o.min}분`); op.value = i; op.selected = state.p[pl.id] === i; sel.appendChild(op); });
        sel.onchange = () => setState({ p: { ...state.p, [pl.id]: Number(sel.value) } });
        row.append(mustBtn, sel);
      }
      panel.appendChild(row);
      if (chosen) panel.appendChild($('p', 'muted', pl.note));
      layers.places.addLayer(placeMarker(pl, chosen, must));
    }
    side.appendChild(panel);
  }

  if (state.u.length) {
    const panel = $('div', 'panel'); panel.appendChild($('h2', null, '내 장소'));
    state.u.forEach((u, i) => {
      const row = $('div', 'row', `<b>${esc(u.name)}</b> <span class="muted">${esc(u.min)}분</span>`);
      const del = $('button', 'btn', '삭제'); del.type = 'button'; del.onclick = () => setState({ u: state.u.filter((_, j) => j !== i), o: null });
      row.appendChild(del); panel.appendChild(row);
      layers.places.addLayer(L.circleMarker([u.lat, u.lng], { radius: 9, color: '#22201c', weight: 3, fillColor: '#c99a18', fillOpacity: 1, bubblingMouseEvents: false }).bindTooltip(esc(u.name) + ' (내 장소)'));
    });
    side.appendChild(panel);
  }

  if (entering) {
    const pts = [...city.places.map(p => [p.lat, p.lng]), ...state.u.map(u => [u.lat, u.lng])];
    map.fitBounds(pts, { padding: [20, 20] });
  }
  bindMapClick(e => {
    const name = prompt('장소 이름'); if (!name) return;
    const min = parseInt(prompt('머무는 시간(분)', '60')); if (!(min > 0)) return;
    setState({ u: [...state.u, { name: name.replace(/[~|]/g, ' '), lat: e.latlng.lat, lng: e.latlng.lng, min }], o: null });
  });
}
const hidden = new Set();   // 숨긴 날 인덱스 (화면 상태, 해시에 안 넣는다)

function renderStep3(side, entering) {
  const places = resolvePlaces(state, city);
  const start = state.s || { lat: city.center[0], lng: city.center[1] };
  const result = plan(places, { days: state.d, start, dayStart: state.t, dayEnd: state.e, pref: state.v, legs: state.l, manual: state.o });

  const head = $('div', 'panel');
  head.appendChild($('h2', null, `${city.name} ${result.days.length}일 — ${places.length}곳 중 ${places.length - result.dropped.length}곳`));
  head.appendChild($('p', 'muted', '이동시간은 직선거리 추정(±10분). 선택지를 바꾸면 바로 다시 계산된다.'));
  if (result.manual) {
    const r0 = $('div', 'row');
    r0.appendChild($('span', null, '<b>직접 정한 순서</b> <span class="muted">— 묶기·자르기를 안 하고 시간만 계산한다.</span>'));
    const auto = $('button', 'btn', '자동으로 되돌리기'); auto.type = 'button'; auto.onclick = () => setState({ o: null });
    r0.appendChild(auto); head.appendChild(r0);
  } else if (state.o) {
    state = { ...state, o: null }; history.replaceState(null, '', '#' + encode(state));
    head.appendChild($('p', null, '<b style="color:var(--warn)">장소가 바뀌어 직접 정한 순서를 풀고 자동으로 다시 짰다.</b>'));
  }
  const row = $('div', 'row');
  const copy = $('button', 'btn primary', '링크 복사'); copy.type = 'button';
  copy.onclick = async () => { try { await navigator.clipboard.writeText(location.href); copy.textContent = '복사됨'; } catch { prompt('이 주소를 복사하세요', location.href); } };
  const back = $('button', 'btn', '← 장소 고치기'); back.type = 'button'; back.onclick = () => goStep(2);
  row.append(copy, back);
  result.days.forEach((_, i) => {
    const b = $('button', 'btn', `${i + 1}일차`); b.type = 'button';
    b.style.borderColor = `var(${DAY_COLORS[i]})`; b.style.color = hidden.has(i) ? '' : `var(${DAY_COLORS[i]})`;
    b.onclick = () => { hidden.has(i) ? hidden.delete(i) : hidden.add(i); render(); };
    row.appendChild(b);
  });
  head.appendChild(row); side.appendChild(head);

  const bounds = [[start.lat, start.lng]];
  result.days.forEach((day, i) => {
    const col = getComputedStyle(document.documentElement).getPropertyValue(DAY_COLORS[i]).trim() || '#15696c';
    if (!hidden.has(i)) {
      const pts = [[start.lat, start.lng], ...day.stops.map(s => [s.place.lat, s.place.lng])];
      L.polyline(pts, { color: col, weight: 2, opacity: 0.6, dashArray: '6 5' }).addTo(layers.route);   // 직선 = 길이 아니라 순서
      day.stops.forEach((s, k) => {
        L.marker([s.place.lat, s.place.lng], { icon: L.divIcon({ className: '', html:
          `<div style="width:22px;height:22px;border-radius:50%;background:${col};color:#fff;font:700 11px/22px sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 0 0 1px ${col}">${k + 1}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11] }) }).bindTooltip(`${hm(s.arrive)} ${esc(s.place.name)}`).addTo(layers.route);
        bounds.push([s.place.lat, s.place.lng]);
      });
    }
    const panel = $('div', 'panel'); panel.style.borderLeft = `3px solid ${col}`;
    panel.appendChild($('h2', null, `${i + 1}일차 <span class="muted" style="font-weight:500">· ${esc(day.why)}${day.stops.length ? ` · 끝 ${hm(day.end)} · 이동 ${day.moveMin}분 · 도보 ${day.walkKm}km` : ''}</span>`));
    if (!day.stops.length) panel.appendChild($('p', null, '이 날에 묶인 곳이 전부 예산을 넘겨 빠졌다. 아래 「뺀 것」을 보고 일수를 늘리거나 체류를 줄여라.'));
    if (day.over) panel.appendChild($('p', null, `<b style="color:var(--warn)">⚠ 꼭 가기만 남았는데도 ${hm(state.e)}을 넘긴다. 일수를 늘리거나 체류를 줄여라.</b>`));
    const layout = () => result.days.map(d => d.stops.map(s => s.place.id));   // 현재 배정을 o로
    const commit = o => setState({ o: o.filter(d => d.length) });
    let prevId = 'start';
    day.stops.forEach((s, k) => {
      const r = $('div', 'row');
      // 이동 구간 (이 정류장으로 오는 길)
      const key = `${prevId}>${s.place.id}`; prevId = s.place.id;
      const leg = $('select'); leg.title = '이 구간 이동수단';
      for (const [v, label] of [['', `자동`], ['walk', '도보'], ['metro', '지하철'], ['taxi', '택시'], ['custom', '직접 입력']]) {
        const op = $('option', null, v === '' ? `↑ ${MODE[s.travelMode]} ${s.travelMin}분` : label); op.value = v;
        const cur = state.l[key]; op.selected = v === '' ? cur == null : (typeof cur === 'number' ? v === 'custom' : cur === v);
        leg.appendChild(op);
      }
      leg.onchange = () => {
        const l = { ...state.l };
        if (leg.value === '') delete l[key];
        else if (leg.value === 'custom') { const n = parseInt(prompt('이 구간 이동시간(분)', String(s.travelMin))); if (!(n > 0)) { render(); return; } l[key] = n; }
        else l[key] = leg.value;
        setState({ l });
      };
      r.appendChild(leg);
      r.appendChild($('span', null, `<b style="font-variant-numeric:tabular-nums">${hm(s.arrive)}</b> ${esc(s.place.name)}${s.place.must ? ' <span class="muted">꼭</span>' : ''}`));
      if (!s.place.user) {
        const sel = $('select');
        s.place.opts.forEach((o, k2) => { const op = $('option', null, `${o.label} · ${o.min}분`); op.value = k2; op.selected = s.place.opt === k2; sel.appendChild(op); });
        sel.onchange = () => setState({ p: { ...state.p, [s.place.id]: Number(sel.value) } });
        r.appendChild(sel);
      }
      // 순서 조정
      const up = $('button', 'btn sm', '↑'); up.type = 'button'; up.disabled = k === 0;
      up.onclick = () => { const o = layout(); [o[i][k - 1], o[i][k]] = [o[i][k], o[i][k - 1]]; commit(o); };
      const dn = $('button', 'btn sm', '↓'); dn.type = 'button'; dn.disabled = k === day.stops.length - 1;
      dn.onclick = () => { const o = layout(); [o[i][k], o[i][k + 1]] = [o[i][k + 1], o[i][k]]; commit(o); };
      const mv = $('select'); mv.title = '다른 날로';
      result.days.forEach((_, j) => { const op = $('option', null, `${j + 1}일차`); op.value = j; op.selected = j === i; mv.appendChild(op); });
      const nw = $('option', null, '새 날'); nw.value = result.days.length; mv.appendChild(nw);
      mv.onchange = () => { const o = layout(); const id = o[i].splice(k, 1)[0]; const j = Number(mv.value); (o[j] ||= []).push(id); commit(o); };
      r.append(up, dn, mv);
      panel.appendChild(r);
    });
    side.appendChild(panel);
  });

  if (result.dropped.length) {
    const panel = $('div', 'panel'); panel.style.background = 'var(--warn-soft)';
    panel.appendChild($('h2', null, '뺀 것'));
    for (const d of result.dropped) panel.appendChild($('p', null, `<b>${esc(d.place.name)}</b> <span class="muted">— ${esc(d.reason)}. 꼭 가려면 2단계에서 「꼭」을 켜라.</span>`));
    side.appendChild(panel);
  }
  if (entering && bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24] });
  bindMapClick(null);
}

window.addEventListener('hashchange', () => { state = decode(location.hash); render(); });
window.addEventListener('load', () => { lastStep = 0; render(); });   // 스타일·폰트까지 다 잡힌 뒤 한 번 더 뷰를 맞춘다
render();
