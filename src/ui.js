import { plan, hm } from './engine.js';
import { decode, encode, DEFAULTS, TABS, resolvePlaces } from './state.js';
import { esc } from './html.js';
import { search } from './search.js';
import { LocalStore } from './store.js';
import { renderMine } from './mine.js';
import { SUPABASE } from './config.js';

// 도시 색인 (data/cities.json): 지역 → 도시. CITIES는 {id: 이름} 평면 지도.
const INDEX = await fetch('data/cities.json').then(r => r.json()).catch(() => ({ regions: [], cities: {} }));
const CITIES = Object.fromEntries(Object.entries(INDEX.cities).map(([id, c]) => [id, c.name]));
const REGIONS = INDEX.regions;
const MODE = { walk: '도보', metro: '지하철', taxi: '택시', custom: '직접' };
const TAB_LABEL = { home: '홈', plan: '플랜', pack: '준비물', photo: '사진', gift: '기념품', mine: '내 여행' };
// 계정 서버가 설정돼 있으면 Supabase, 아니면(또는 못 불러오면) 브라우저 저장
let store = new LocalStore();
const storeReady = (async () => {
  if (!SUPABASE.url || new URLSearchParams(location.search).has('local')) return;   // ?local=1 이면 브라우저 저장으로 (개발·시험용)
  try { const { SupabaseStore } = await import('./store-supabase.js'); store = new SupabaseStore(); store.onChange = () => render(); }
  catch (e) { console.warn('계정 서버 연결 실패 — 브라우저 저장으로 간다', e); }
})();
const DAY_COLORS = ['--d1','--d2','--d3','--d4','--d5','--d6','--d7','--d8','--d9','--d10'];
const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

let state = decode(location.hash);
let step = 2;                // 2 장소 고르기 · 3 결과 (설정은 항상 위에 떠 있다)
let lastStep = 0;            // 0 = 첫 렌더. 단계가 바뀔 때만 지도 뷰를 맞춘다
let pickStart = false;       // 켜지면 다음 지도 클릭이 출발점이 된다
let city = null;                 // data/<c>.json 내용
let curUser = null;              // 로그인한 사람 (store.user())
export let accountOpen = false;  // 「내 계정」 창을 열어 둔 상태 (화면 상태)
const cache = {};
const map = L.map('map', { zoomControl: true });
// 배경은 Esri 연회색 캔버스 — 키 없이 쓸 수 있고 글자·도로가 적어 마커가 산다. (OSM 기본 타일은 필터를 걸어도 글자가 너무 많았다)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ' }).addTo(map);
const layers = { places: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), start: L.layerGroup().addTo(map) };

export function setState(patch) {
  if ('c' in patch && patch.c !== state.c) regionOpen = null;
  if ('pr' in patch && patch.pr && patch.pr !== state.pr && curUser) store.updateUser({ prefs: { lastPr: patch.pr } }).catch(() => {});   // 마지막 여행 기억
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
  const who = document.getElementById('who'); who.innerHTML = '';
  if (curUser) { const b = $('button', 'btn sm user', `<span class="dot"></span>${esc(curUser.name)}`); b.type = 'button'; b.title = '내 계정'; b.onclick = () => { accountOpen = true; setState({ tab: 'mine', pr: null }); }; who.appendChild(b); }
  else { const b = $('button', 'btn sm', '로그인'); b.type = 'button'; b.onclick = () => setState({ tab: 'mine', pr: null }); who.appendChild(b); }
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
  // 지역(아시아·유럽) → 도시. 지역 선택은 화면 상태만, 도시 선택은 플랜을 비운다
  const curRegion = REGIONS.find(r => r.cities.includes(state.c))?.id;
  if (regionOpen == null) regionOpen = curRegion;
  const rrow = $('div', 'row regions');
  for (const r of REGIONS) {
    const b = $('button', 'btn sm' + (regionOpen === r.id ? ' primary' : ''), r.name); b.type = 'button';
    b.onclick = () => { regionOpen = r.id; render(); }; rrow.appendChild(b);
  }
  p.appendChild(rrow);
  const row1 = $('div', 'row');
  for (const id of (REGIONS.find(r => r.id === regionOpen)?.cities || [])) {
    const b = $('button', 'btn' + (state.c === id ? ' primary' : ''), CITIES[id]); b.type = 'button';
    b.onclick = () => { if (id === state.c) return; if (Object.keys(state.p).length && !confirm(`${CITIES[id]}(으)로 바꾸면 고른 장소가 비워진다. 바꿀까?`)) return; setState({ c: id, p: {}, m: [], u: [], s: null, l: {}, o: null }); };
    row1.appendChild(b);
  }
  p.appendChild(row1);
  const row2 = $('div', 'grid');
  row2.append($('span', 'muted', '일수'), stepper(state.d, d => setState({ d: Math.max(1, Math.min(10, state.d + d)) })));
  row2.append($('span', 'muted', '하루 시작'), stepper(state.t, d => setState({ t: Math.max(0, Math.min(state.e - 60, state.t + d * 30)) }), hm));
  row2.append($('span', 'muted', '하루 끝'), stepper(state.e, d => setState({ e: Math.max(state.t + 60, Math.min(1440, state.e + d * 30)) }), hm));
  p.appendChild(row2);
  const row3 = $('div', 'row'); row3.appendChild($('span', 'muted', '기본 이동'));
  for (const [v, label] of [['transit', '걷기 + 지하철'], ['taxi', '택시 위주']]) {
    const b = $('button', 'btn' + (state.v === v ? ' primary' : ''), label); b.type = 'button';
    b.onclick = () => setState({ v }); row3.appendChild(b);
  }
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
let settingsOpen = !Object.keys(state.p).length && !state.u.length;   // 공유 링크로 결과에 바로 오면 접어 둔다
let regionOpen = null;   // 설정에서 펼친 지역 (화면 상태)
let resumeDismissed = false;
let homeQuery = '';

// 홈 — 어디로 가세요? + 도시 카드 + (로그인) 내 여행
function renderHome(side, projects) {
  const hero = $('div', 'hero');
  hero.appendChild($('h2', null, '어디로 가세요?'));
  hero.appendChild($('p', null, '도시를 고르고 가고 싶은 곳에 표시하면, 며칠에 어떤 순서로 돌지 AlgoTrip이 짜 준다.'));
  const sr = $('div', 'row');
  const inp = $('input', 'text big'); inp.type = 'search'; inp.placeholder = '도시 이름'; inp.value = homeQuery;
  inp.oninput = () => { homeQuery = inp.value; applyHomeFilter(side); };
  sr.appendChild(inp); hero.appendChild(sr);
  side.appendChild(hero);

  const openCity = id => { regionOpen = null; step = 2; setState({ c: id, p: {}, m: [], u: [], s: null, l: {}, o: null, pr: null, tab: 'plan' }); };
  for (const r of REGIONS) {
    const sec = $('section', 'region'); sec.dataset.region = r.id;
    sec.appendChild($('h3', null, esc(r.name)));
    const grid = $('div', 'cards');
    for (const id of r.cities) {
      const c = INDEX.cities[id]; if (!c) continue;
      const card = $('a', 'card'); card.href = '#'; card.dataset.name = `${c.name} ${c.countryName} ${id}`.toLowerCase();
      card.innerHTML = `<img src="${esc(c.image || '')}" alt="" loading="lazy"><div class="cap"><b>${esc(c.name)}</b><span>${esc(c.countryName)}</span></div>`;
      card.onclick = e => { e.preventDefault(); openCity(id); };
      grid.appendChild(card);
    }
    sec.appendChild(grid); side.appendChild(sec);
  }

  if (curUser) {
    const sec = $('section', 'region');
    sec.appendChild($('h3', null, `${esc(curUser.name)}의 여행`));
    if (!projects.length) sec.appendChild($('p', 'muted', '아직 저장한 여행이 없다. 도시를 골라 플랜을 짜고 「저장」을 눌러라.'));
    const grid = $('div', 'cards');
    for (const p of projects.slice(0, 6)) {
      const c = INDEX.cities[p.city] || {};
      const card = $('a', 'card trip'); card.href = '#';
      card.innerHTML = `<img src="${esc(c.image || '')}" alt="" loading="lazy"><div class="cap"><b>${esc(p.name)}</b><span>${esc(c.name || p.city)} · 사진 ${p.photos.length}${p.id === curUser.prefs?.lastPr ? ' · 최근' : ''}</span></div>`;
      card.onclick = e => { e.preventDefault(); const st = decode('#' + p.hash); step = 3; setState({ ...st, tab: 'plan', pr: p.id }); };
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    if (projects.length > 6) { const more = $('button', 'btn', `전체 ${projects.length}개 보기`); more.type = 'button'; more.onclick = () => setState({ tab: 'mine', pr: null }); sec.appendChild(more); }
    side.appendChild(sec);
  } else {
    const sec = $('div', 'panel');
    sec.appendChild($('p', null, '<b>로그인하면</b> 짠 플랜을 여행으로 저장하고, 살 것과 사진을 같이 둘 수 있다. 플랜을 짜는 데는 로그인이 필요 없다.'));
    const b = $('button', 'btn', '로그인'); b.type = 'button'; b.onclick = () => setState({ tab: 'mine' }); sec.appendChild(b);
    side.appendChild(sec);
  }
  side.appendChild($('p', 'muted credits', '도시 사진: Wikimedia Commons (CC BY / CC BY-SA, <a href="assets/cities/credits.json">저작자</a>)'));
  applyHomeFilter(side);
}
function applyHomeFilter(side) {
  const q = homeQuery.trim().toLowerCase();
  side.querySelectorAll('.card[data-name]').forEach(c => { c.hidden = !!q && !c.dataset.name.includes(q); });
  side.querySelectorAll('section[data-region]').forEach(sec => { sec.hidden = !!q && ![...sec.querySelectorAll('.card')].some(c => !c.hidden); });
}

// 돌아온 사람에게 마지막 여행을 이어서 열어 준다 — 플랜이 비어 있고 여행을 안 열었을 때만
async function renderResume(side) {
  if (resumeDismissed || !curUser || state.pr || Object.keys(state.p).length || state.u.length) return;
  const lastPr = curUser.prefs?.lastPr; if (!lastPr) return;
  let p = null; try { p = await store.getProject(lastPr); } catch {}
  if (!p) return;
  const box = $('div', 'panel'); box.style.background = 'var(--gold-soft)';
  box.appendChild($('p', null, `<b>최근 여행 「${esc(p.name)}」</b> <span class="muted">· ${esc(CITIES[p.city] || p.city)} · 사진 ${p.photos.length}</span>`));
  const row = $('div', 'row');
  const go = $('button', 'btn primary', '이어서 하기'); go.type = 'button';
  go.onclick = () => { const st = decode('#' + p.hash); step = 3; setState({ ...st, tab: 'plan', pr: p.id }); };
  const no = $('button', 'btn sm', '새로 시작'); no.type = 'button'; no.onclick = () => { resumeDismissed = true; render(); };
  row.append(go, no); box.appendChild(row); side.appendChild(box);
}

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
    const p = $('div', 'panel'); p.appendChild($('h2', null, `${esc(city.name)} 준비물 <span class="muted" style="font-weight:500">· ${esc(INDEX.cities[state.c]?.countryName || '')}</span>`));
    p.appendChild($('p', null, '동선과 무관하게 챙길 것. 짐은 가볍게, 겹옷으로.'));
    for (const x of city.pack) p.appendChild($('div', 'item', `<b>${esc(x.item)}</b><span>${esc(x.why)}</span>`));
    side.appendChild(p);
  }
  if (state.tab === 'photo') {
    const g = $('div', 'panel'); g.appendChild($('h2', null, `${esc(city.name)} 사진 — 공통`));
    for (const t of city.photo.general) g.appendChild($('div', 'item', `<span>${esc(t)}</span>`));
    side.appendChild(g);
    const mine = city.places.filter(pl => chosen.has(pl.id)), rest = city.places.filter(pl => !chosen.has(pl.id));
    for (const [title, list, hint] of [['내가 고른 곳', mine, '플랜에서 고른 장소만.'], ['나머지 장소', rest, '고르지 않은 곳도 참고용으로.']]) {
      if (!list.length) continue;
      const p = $('div', 'panel'); p.appendChild($('h2', null, title)); p.appendChild($('p', null, hint));
      for (const pl of list) p.appendChild($('div', 'item', `<b>${esc(pl.name)}</b><span>${esc(city.photo.places[pl.id] || '')}</span>`));
      side.appendChild(p);
    }
  }
  if (state.tab === 'gift') {
    const p = $('div', 'panel'); p.appendChild($('h2', null, `${esc(city.name)} 기념품`));
    p.appendChild($('p', null, '가볍고 안 깨지고 다른 데서 못 사는 것 순서.'));
    for (const x of city.gift) {
      const it = $('div', 'item', `<b>${esc(x.item)}</b><span class="muted">${esc(x.where)}</span><span>${esc(x.note)}</span>`);
      if (state.pr && curUser) {
        const b = $('button', 'btn sm', '살 것에 담기'); b.type = 'button';
        b.onclick = async () => { const pr = await store.getProject(state.pr); if (!pr) return; await store.updateProject(pr.id, { shopping: [...pr.shopping, { text: x.item, done: false }] }); b.textContent = '담김'; b.disabled = true; };
        it.appendChild(b);
      }
      p.appendChild(it);
    }
    if (!state.pr) p.appendChild($('p', 'muted', '「내 여행」에서 여행을 열어 두면 항목마다 「살 것에 담기」가 생긴다.'));
    side.appendChild(p);
  }
}

let renderSeq = 0;              // 겹쳐 시작된 렌더 중 마지막 것만 그린다 (await 사이에 새 렌더가 오면 옛것은 접는다)
async function render() {
  const seq = ++renderSeq;
  if (!Object.hasOwn(CITIES, state.c)) { state = { ...state, c: DEFAULTS.c, p: {}, m: [], u: [], s: null }; history.replaceState(null, '', '#' + encode(state)); }
  const side = document.getElementById('side');
  if (lastStep === 0 && !/[#&]tab=/.test(location.hash) && !state.pr && !Object.keys(state.p).length && !state.u.length) {   // 빈손으로 오면 홈
    state = { ...state, tab: 'home' }; history.replaceState(null, '', '#' + encode(state));
  }
  renderTabs();                                     // 계정 확인을 기다리지 않고 틀부터 그린다
  document.querySelector('.layout').classList.toggle('nomap', state.tab !== 'plan');   // 지도는 플랜에서만
  await storeReady;
  // 계정 확인이 3초 넘게 안 끝나면(다른 탭의 잠금 등) 일단 로그아웃 상태로 그리고, 세션이 오면 onChange가 다시 그린다
  try { curUser = await Promise.race([store.user(), new Promise(r => setTimeout(() => r(null), 3000))]); } catch { curUser = null; }
  if (seq !== renderSeq) return;
  try { city = await loadCity(state.c); if (seq !== renderSeq) return; }
  catch (e) { renderTabs(); side.innerHTML = ''; side.appendChild($('div', 'panel', `<h2>데이터를 못 불러왔다</h2><p>${esc(CITIES[state.c])} 장소 파일(data/${esc(state.c)}.json)을 읽지 못했다. 네트워크를 확인하고 새로고침해라.</p>`)); return; }
  if (lastStep === 0 && resolvePlaces(state, city).length) step = 3;   // 공유 링크는 결과로 바로 연다 (도시 가드 뒤에 판단)
  renderTabs();
  const sy = window.scrollY, st = side.scrollTop;        // 다시 그리는 동안 스크롤 자리를 지킨다
  side.style.minHeight = side.offsetHeight + 'px';
  side.innerHTML = '';
  layers.places.clearLayers(); layers.route.clearLayers();
  drawStart();
  if (state.tab === 'plan') map.invalidateSize();   // 첫 렌더 때 컨테이너 크기를 0으로 잰 채 fitBounds 하면 골목까지 확대된다 (지도가 숨겨진 탭에선 재지 않는다)
  const first = lastStep === 0;
  if (state.tab === 'home') {
    lastStep = -1;
    const projects = curUser ? await store.listProjects().catch(() => []) : [];
    if (seq !== renderSeq) return;
    renderHome(side, projects);
    restoreScroll(side, sy, st); return;
  }
  if (state.tab === 'mine') {
    lastStep = -1;
    const projects = curUser ? await store.listProjects() : [];
    if (seq !== renderSeq) return;
    const project = state.pr ? projects.find(p => p.id === state.pr) || null : null;
    if (state.pr && !project) { state = { ...state, pr: null }; history.replaceState(null, '', '#' + encode(state)); }
    await renderMine({ state, setState, city, $, side, store, user: curUser, projects, project, CITIES, INDEX, loadCity, plan, resolvePlaces, hm, render, layers, map, L, accountOpen, closeAccount: () => { accountOpen = false; }, setStep: n => { step = n; } });
    if (seq !== renderSeq) return;
    if (state.pr) accountOpen = false;
    restoreScroll(side, sy, st); return;
  }
  if (state.tab !== 'plan') { lastStep = -1; renderInfo(side); restoreScroll(side, sy, st); return; }
  const entering = step !== lastStep; lastStep = step;
  if (entering) requestAnimationFrame(() => map.invalidateSize());   // 숨겼다 다시 보일 때 타일 빈칸 방지
  await renderResume(side); if (seq !== renderSeq) return;
  renderSettings(side);
  if (step === 2) renderStep2(side, entering);
  if (step === 3) renderStep3(side, entering);
  restoreScroll(side, sy, st);
}
function restoreScroll(side, sy, st) {
  side.scrollTop = st; window.scrollTo(0, sy);
  requestAnimationFrame(() => { side.style.minHeight = ''; side.scrollTop = st; window.scrollTo(0, sy); });
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
  side.appendChild(renderSearch());

  for (const w of [1, 2, 3]) {
    const group = city.places.filter(p => p.weight === w);
    if (!group.length) continue;
    const panel = $('details', 'panel'); panel.open = openGroups.has(w); panel.ontoggle = () => { panel.open ? openGroups.add(w) : openGroups.delete(w); };
    const chosenN = group.filter(p => p.id in state.p).length;
    panel.appendChild($('summary', null, `<b>${WEIGHT_LABEL[w]}</b> <span class="muted">${group.length}곳${chosenN ? ` · 고른 ${chosenN}` : ''}</span>`));
    for (const pl of group) {
      const chosen = pl.id in state.p, must = state.m.includes(pl.id);
      const row = $('div', 'row place'); row.dataset.name = pl.name.toLowerCase();
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
      if (chosen) { const note = $('p', 'muted', pl.note); note.dataset.name = row.dataset.name; panel.appendChild(note); }
      layers.places.addLayer(placeMarker(pl, chosen, must));
    }
    panel.classList.add('group'); side.appendChild(panel);
  }
  applyFilter(side);

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
let query = '', results = null, searching = false, searchErr = '';   // 검색 상자 상태 (화면 상태)
const openGroups = new Set([1]);   // 펼쳐 둔 추천 묶음 — 처음엔 1순위만

// 입력한 글자로 목록을 거른다 — 다시 그리지 않고 숨기기만 (입력 포커스를 지키려고)
function applyFilter(side) {
  const q = query.trim().toLowerCase();
  side.querySelectorAll('[data-name]').forEach(el => { el.hidden = !!q && !el.dataset.name.includes(q); });
  side.querySelectorAll('.panel.group').forEach(g => { g.hidden = !!q && ![...g.querySelectorAll('.place')].some(r => !r.hidden); if (q && !g.hidden) g.open = true; });
}

function renderSearch() {
  const p = $('div', 'panel search');
  const row = $('div', 'row');
  const inp = $('input', 'text'); inp.type = 'search'; inp.placeholder = '장소 이름 — 목록을 거르고, Enter로 지도에서 찾는다'; inp.value = query;
  inp.oninput = () => { query = inp.value; applyFilter(document.getElementById('side')); };
  const go = $('button', 'btn', '지도에서 찾기'); go.type = 'button';
  const run = async () => {
    const q = inp.value.trim(); if (!q) return;
    query = q; searching = true; searchErr = ''; results = null; render();
    try { results = await search(q, city.center, INDEX.cities[state.c]?.bbox); } catch (e) { searchErr = '검색 서버에 닿지 못했다. 잠시 뒤 다시.'; }
    searching = false; render();
  };
  go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
  row.append(inp, go); p.appendChild(row);
  if (searching) p.appendChild($('p', 'muted', '찾는 중…'));
  if (searchErr) p.appendChild($('p', null, `<b style="color:var(--warn)">${esc(searchErr)}</b>`));
  if (results) {
    if (!results.length) p.appendChild($('p', 'muted', `「${esc(query)}」 — 이 도시 안에서 못 찾았다. 철자를 바꾸거나 지도의 빈 곳을 직접 클릭해라.`));
    for (const c of results) {
      const r = $('div', 'row');
      r.appendChild($('span', null, `<b>${esc(c.name)}</b> <span class="muted">${esc(c.detail)}</span>`));
      const add = $('button', 'btn sm', '추가 · 60분'); add.type = 'button';
      add.onclick = () => { results = null; query = ''; setState({ u: [...state.u, { name: c.name.slice(0, 40), lat: c.lat, lng: c.lng, min: 60 }], o: null }); };
      r.appendChild(add); p.appendChild(r);
      layers.places.addLayer(L.circleMarker([c.lat, c.lng], { radius: 7, color: '#22201c', weight: 2, fillColor: '#fff', fillOpacity: 1, dashArray: '2 2', bubblingMouseEvents: false }).bindTooltip(esc(c.name) + ' (검색 결과)'));
    }
    if (results.length) p.appendChild($('p', 'muted', '검색: OpenStreetMap Nominatim. 추가한 장소는 「내 장소」로 들어가고 머무는 시간은 60분으로 잡힌다 — 필요하면 지도의 빈 곳을 클릭해 다른 시간으로 다시 넣어라.'));
  }
  return p;
}
const hidden = new Set();   // 숨긴 날 인덱스 (화면 상태, 해시에 안 넣는다)
let editing = false;        // 순서·이동수단 조정 도구를 보일지 — 기본은 읽기만

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
  const ed = $('button', 'btn' + (editing ? ' primary' : ''), editing ? '조정 끝' : '순서·이동 조정'); ed.type = 'button'; ed.onclick = () => { editing = !editing; render(); };
  // 저장: 로그인 전엔 로그인으로 보내고, 로그인 후엔 열어 둔 여행에 덮어쓰거나 새 여행을 만든다
  const sv = $('button', 'btn', state.pr && curUser ? '이 여행에 저장' : '저장'); sv.type = 'button';
  sv.title = curUser ? '' : '저장하려면 로그인이 필요하다 — 플랜은 그대로 남는다';
  sv.onclick = async () => {
    if (!curUser) { setState({ tab: 'mine' }); return; }
    const hash = encode({ ...state, tab: 'plan', pr: null });
    try {
      if (state.pr) { await store.updateProject(state.pr, { city: state.c, hash }); sv.textContent = '저장됨'; }
      else { const name = prompt('여행 이름', `${CITIES[state.c]} ${state.d}일`); if (!name) return; const p = await store.createProject({ name, city: state.c, hash }); setState({ pr: p.id }); }
    } catch (e) { alert(`저장 실패 — ${e.message || e}`); }
  };
  row.append(copy, sv, back, ed);
  if (!curUser) head.appendChild($('p', 'muted', '로그인 없이도 플랜은 만들고 링크로 나눌 수 있다. 「저장」은 로그인해야 내 여행에 남는다.'));
  else if (state.pr) head.appendChild($('p', 'muted', '열어 둔 여행에 저장된다. 다른 여행으로 저장하려면 「내 여행」에서 그 여행을 열어라.'));
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
    panel.appendChild($('h2', null, `${i + 1}일차`));
    panel.appendChild($('p', 'meta', `${esc(day.why)}${day.stops.length ? ` · ${hm(day.stops[0].arrive)}–${hm(day.end)} · 이동 ${day.moveMin}분 · 도보 ${day.walkKm}km` : ''}`));
    if (!day.stops.length) panel.appendChild($('p', null, '이 날에 묶인 곳이 전부 예산을 넘겨 빠졌다. 아래 「뺀 것」을 보고 일수를 늘리거나 체류를 줄여라.'));
    if (day.over) panel.appendChild($('p', null, `<b style="color:var(--warn)">⚠ 꼭 가기만 남았는데도 ${hm(state.e)}을 넘긴다. 일수를 늘리거나 체류를 줄여라.</b>`));
    const layout = () => result.days.map(d => d.stops.map(s => s.place.id));   // 현재 배정을 o로
    const commit = o => setState({ o: o.filter(d => d.length) });
    let prevId = 'start';
    day.stops.forEach((s, k) => {
      // 이동 구간 (이 정류장으로 오는 길) — 읽기 모드에선 글자, 편집 모드에선 셀렉트
      const key = `${prevId}>${s.place.id}`; prevId = s.place.id;
      const legRow = $('div', 'leg');
      if (editing) {
        const leg = $('select', 'quiet'); leg.title = '이 구간 이동수단';
        for (const [v, label] of [['', `자동 — ${MODE[s.travelMode]} ${s.travelMin}분`], ['walk', '도보'], ['metro', '지하철'], ['taxi', '택시'], ['custom', '직접 입력']]) {
          const op = $('option', null, label); op.value = v;
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
        legRow.append(leg, $('span', null, Object.hasOwn(state.l, key) ? ` → ${MODE[s.travelMode]} ${s.travelMin}분` : ''));
      } else legRow.textContent = `${MODE[s.travelMode]} ${s.travelMin}분`;
      panel.appendChild(legRow);

      const r = $('div', 'stop');
      r.appendChild($('div', 't', hm(s.arrive)));
      const body = $('div', 'body');
      body.appendChild($('div', 'name', `${esc(s.place.name)}${s.place.must ? ' <span class="tag">꼭</span>' : ''}`));
      if (!s.place.user) {
        const sel = $('select', 'quiet'); sel.title = '머무는 방식';
        s.place.opts.forEach((o, k2) => { const op = $('option', null, `${o.label} · ${o.min}분`); op.value = k2; op.selected = s.place.opt === k2; sel.appendChild(op); });
        sel.onchange = () => setState({ p: { ...state.p, [s.place.id]: Number(sel.value) } });
        body.appendChild(sel);
      } else body.appendChild($('div', 'muted', `머물기 · ${esc(s.place.opts[0].min)}분`));
      if (editing) {
        const tools = $('div', 'tools');
        const up = $('button', 'btn sm', '↑'); up.type = 'button'; up.disabled = k === 0;
        up.onclick = () => { const o = layout(); [o[i][k - 1], o[i][k]] = [o[i][k], o[i][k - 1]]; commit(o); };
        const dn = $('button', 'btn sm', '↓'); dn.type = 'button'; dn.disabled = k === day.stops.length - 1;
        dn.onclick = () => { const o = layout(); [o[i][k], o[i][k + 1]] = [o[i][k + 1], o[i][k]]; commit(o); };
        const mv = $('select'); mv.title = '다른 날로';
        result.days.forEach((_, j) => { const op = $('option', null, `${j + 1}일차`); op.value = j; op.selected = j === i; mv.appendChild(op); });
        const nw = $('option', null, '새 날'); nw.value = result.days.length; mv.appendChild(nw);
        mv.onchange = () => { const o = layout(); const id = o[i].splice(k, 1)[0]; const j = Number(mv.value); (o[j] ||= []).push(id); commit(o); };
        tools.append(up, dn, mv); body.appendChild(tools);
      }
      r.appendChild(body);
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

// 제목 클릭 = 홈(플랜 탭). 고른 장소·열어 둔 여행은 그대로 둔다
document.getElementById('home')?.addEventListener('click', e => { e.preventDefault(); accountOpen = false; setState({ tab: 'home' }); });
window.addEventListener('hashchange', () => { state = decode(location.hash); render(); });
window.addEventListener('load', () => { lastStep = 0; render(); });   // 스타일·폰트까지 다 잡힌 뒤 한 번 더 뷰를 맞춘다
render();
