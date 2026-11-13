import { plan, hm, ALGOS } from './engine.js';
import { distanceKm } from './travel.js';
import { decode, encode, DEFAULTS, TABS, PAGES, resolvePlaces, legsOf, withLeg } from './state.js';
import { renderPage } from './pages.js';
import { esc } from './html.js';
import { search } from './search.js';
import { LocalStore } from './store.js';
import { renderMine } from './mine.js';
import { SUPABASE, FEATURES } from './config.js';
import { createMap } from './map.js';
import { chat } from './ai.js';
import { tagEdits } from './edits.js';

// 도시 색인 (data/cities.json): 지역 → 도시. CITIES는 {id: 이름} 평면 지도.
const INDEX = await fetch('data/cities.json' + (new URL(import.meta.url).search || ''), { credentials: 'same-origin', mode: 'cors' }).then(r => r.json()).catch(() => ({ regions: [], cities: {} }));   // 홈을 그리는 데 꼭 필요한 유일한 선행 로드
const CITIES = Object.fromEntries(Object.entries(INDEX.cities).map(([id, c]) => [id, c.name]));
const REGIONS = INDEX.regions;
const MODE = { walk: '도보', metro: '지하철', taxi: '택시', car: '차', custom: '직접' };
const TAB_LABEL = { home: '홈', plan: '플랜', guide: '가이드', mine: '내 여행' };
// 계정 서버가 설정돼 있으면 Supabase, 아니면(또는 못 불러오면) 브라우저 저장
let store = new LocalStore();
let storeIsFinal = !SUPABASE.url || new URLSearchParams(location.search).has('local');   // ?local=1 이면 브라우저 저장으로 (개발·시험용)
const storeReady = (async () => {
  if (storeIsFinal) return;
  try { const { SupabaseStore } = await import('./store-supabase.js'); store = new SupabaseStore(); store.onChange = () => { projectsCache = null; render(); }; }
  catch (e) { console.warn('계정 서버 연결 실패 — 브라우저 저장으로 간다', e); }
  storeIsFinal = true; projectsCache = null; render();   // 준비되면 로그인 상태로 다시 그린다
})();
// 여행 목록은 한 번 받아 두고, 뭔가 바꿀 때만 다시 받는다 — 클릭마다 서버에 묻지 않으려고
let projectsCache = null, publicCache = null, homeFetching = false;
async function listPublicCached() { if (publicCache && Date.now() - publicCache.at < 120000) return publicCache.data; const data = await store.listPublic(12).catch(() => []); publicCache = { at: Date.now(), data }; return data; }
async function listProjectsCached() {
  if (projectsCache && Date.now() - projectsCache.at < 60000) return projectsCache.data;
  const data = curUser ? await store.listProjects().catch(() => []) : [];
  projectsCache = { at: Date.now(), data }; return data;
}
const MUTATING = /^(create|update|delete|add|remove|accept|signIn|signOut)/;
function withInvalidation(s) {   // 바꾸는 메서드가 끝나면 캐시를 비운다
  return new Proxy(s, { get(t, k) { const v = t[k]; if (typeof v !== 'function' || !MUTATING.test(String(k))) return typeof v === 'function' ? v.bind(t) : v; return async (...a) => { const r = await v.apply(t, a); projectsCache = null; curProject = null; return r; }; } });
}
let sunOpen = false;   // 지도 귀퉁이 ☀로 여닫는다
const DAY_COLORS = ['--d1','--d2','--d3','--d4','--d5','--d6','--d7','--d8','--d9','--d10'];
const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

let state = decode(location.hash);
// 메일 링크(로그인·가입 확인·비밀번호 재설정)로 막 돌아왔다 — #토큰은 Supabase가 읽고 지우니 건드리지 않고, 화면만 내 여행으로
const authLanding = /(^|[#&])(access_token|error_description)=/.test(location.hash);
let authNote = decodeURIComponent((location.hash.match(/error_description=([^&]+)/) || [])[1] || '').replace(/\+/g, ' ');
if (authLanding) state = { ...state, tab: 'mine' };
let step = 2;                // 2 장소 고르기 · 3 결과 (설정은 항상 위에 떠 있다)
let lastStep = 0;            // 0 = 첫 렌더. 단계가 바뀔 때만 지도 뷰를 맞춘다
let pickStart = false;       // 켜지면 다음 지도 클릭이 출발점이 된다
let pickPhotoFn = null;      // 켜지면 다음 지도 클릭이 사진 위치가 된다
let city = null;                 // data/<c>.json 내용
let curUser = null;              // 로그인한 사람 (store.user())
let curProject = null;           // 플랜 탭에서 열어 둔 여행(이름표용) — pr이 있을 때만
// 지금 플랜을 여행에 저장 — 바뀐 장소에 내 이름표를 붙인다
async function saveToProject(pid) {
  const prev = await store.getProject(pid); if (!prev) throw new Error('여행이 없어요');
  const i = state.lg || 0, leg = encode({ ...state, tab: 'plan', pr: null, lg: 0 });
  const edits = tagEdits(legsOf(prev.hash)[i], leg, prev.edits, curUser?.name || '나');
  const p = await store.updateProject(pid, { city: i === 0 ? state.c : prev.city, hash: withLeg(prev.hash, i, leg), edits, lastEditedBy: curUser?.name || null });
  curProject = p; return p;
}
// 초대 링크(#join=토큰)로 들어온 경우
function pendingJoin() { const m = location.hash.match(/[#&]join=([A-Za-z0-9]+)/); if (m) { try { sessionStorage.setItem('rp.join', m[1]); } catch {} history.replaceState(null, '', location.hash.replace(/[#&]join=[A-Za-z0-9]+/, '')); } try { return sessionStorage.getItem('rp.join'); } catch { return null; } }
const cache = {};
// 지도: MapLibre + OpenFreeMap 컬러 벡터 타일(키 없음) — 건물 높이(3D)와 해 위치(빛)를 쓴다. src/map.js 참고
const map = createMap('map');
let sunTime = null;   // 결과 화면의 해 시각(분) — null이면 하루 시작
let shadowsOn = true; // 건물 그림자 (화면 상태)
let playTimer = null;  // 하루 재생
let PACKING = { groups: [] }; let packingLoaded = null;   // 준비물 목록은 탭에 들어갈 때 받는다
const loadPackingList = () => packingLoaded || (packingLoaded = fetch('data/packing.json').then(r => r.json()).then(j => { PACKING = j; }).catch(() => {}));
let packingCache = null;   // 현재 체크 상태 {id:true}
// 체크 상태의 집: 여행을 열어 뒀고 로그인했으면 그 여행(서버), 아니면 이 브라우저
function packKey() { return 'rp.pack.' + (state.pr || 'anon'); }
async function loadPacking() {
  if (state.pr && curUser) { try { const p = await store.getProject(state.pr); if (p) return p.packing || {}; } catch {} }
  try { return JSON.parse(localStorage.getItem(packKey()) || '{}'); } catch { return {}; }
}
async function savePacking(v) {
  try { localStorage.setItem(packKey(), JSON.stringify(v)); } catch {}
  if (state.pr && curUser) { try { await store.updateProject(state.pr, { packing: v }); return 'server'; } catch (e) { return 'local'; } }
  return 'local';
}
function renderPacking(side) {
  const done = packingCache || {};
  const total = PACKING.groups.reduce((n, g) => n + g.items.length, 0), n = PACKING.groups.reduce((k, g) => k + g.items.filter(([id]) => done[id]).length, 0);
  const head = $('div', 'panel');
  head.appendChild($('h2', null, `준비물 <span class="muted" style="font-weight:500">· ${n}/${total} 챙김</span>`));
  const bar = $('div', 'bar'); bar.innerHTML = `<i style="width:${total ? Math.round(n / total * 100) : 0}%"></i>`; head.appendChild(bar);
  head.appendChild($('p', 'muted', state.pr && curUser ? '체크는 이 여행에 저장돼요.' : '체크는 이 브라우저에 남아요 — 「내 여행」에서 여행을 열어 두면 여행에 저장돼요.'));
  const r = $('div', 'row'); const reset = $('button', 'btn sm', '전부 해제'); reset.type = 'button'; reset.onclick = async () => { packingCache = {}; await savePacking({}); render(); }; r.appendChild(reset); head.appendChild(r);
  side.appendChild(head);
  for (const g of PACKING.groups) {
    const d = $('details', 'panel group'); d.open = true;
    const gn = g.items.filter(([id]) => done[id]).length;
    d.appendChild($('summary', null, `<b>${esc(g.name)}</b> <span class="muted">${gn}/${g.items.length}</span>`));
    for (const [id, label] of g.items) {
      const row = $('div', 'row check');
      const cb = $('input'); cb.type = 'checkbox'; cb.id = 'pk-' + id; cb.checked = !!done[id];
      const lab = $('label', null, esc(label)); lab.htmlFor = cb.id; if (done[id]) lab.classList.add('done');
      cb.onchange = async () => { packingCache = { ...(packingCache || {}), [id]: cb.checked }; if (!cb.checked) delete packingCache[id]; lab.classList.toggle('done', cb.checked); await savePacking(packingCache); updatePackCounts(side); };
      row.append(cb, lab); d.appendChild(row);
    }
    side.appendChild(d);
  }
}
function updatePackCounts(side) {
  const done = packingCache || {};
  const total = PACKING.groups.reduce((n, g) => n + g.items.length, 0), n = PACKING.groups.reduce((k, g) => k + g.items.filter(([id]) => done[id]).length, 0);
  const h = side.querySelector('h2 .muted'); if (h) h.textContent = `· ${n}/${total} 챙김`;
  const bar = side.querySelector('.bar i'); if (bar) bar.style.width = `${total ? Math.round(n / total * 100) : 0}%`;
  side.querySelectorAll('details.group').forEach((d, i) => { const g = PACKING.groups[i]; const m = d.querySelector('summary .muted'); if (g && m) m.textContent = `${g.items.filter(([id]) => done[id]).length}/${g.items.length}`; });
}
document.getElementById('btnsun').onclick = () => { sunOpen = !sunOpen; document.getElementById('btnsun').setAttribute('aria-pressed', sunOpen); render(); };
document.getElementById('btn3d').onclick = () => { const on = !map.is3D(); map.set3D(on); document.getElementById('btn3d').setAttribute('aria-pressed', on); };

// 화면 이동(탭·여행·도시)은 브라우저 기록에 쌓아 뒤로가기가 되게 하고, 플랜 고치기는 되돌리기 스택에 쌓는다
const undoStack = [];
let navTop = false;   // 화면을 옮겼으면 옛 스크롤 자리를 지키지 않는다 — 휴대폰에서 새 화면이 아래로 내려간 채 열렸다
const NAV_KEYS = ['tab', 'pr', 'c'];
export function setState(patch) {
  if ('pr' in patch && patch.pr && patch.pr !== state.pr && curUser) store.updateUser({ prefs: { lastPr: patch.pr } }).catch(() => {});   // 마지막 여행 기억
  const nav = NAV_KEYS.some(k => k in patch && patch[k] !== state[k]);
  if (('c' in patch && patch.c !== state.c) || ('lg' in patch && patch.lg !== state.lg)) { hidden.clear(); pin = null; askSave = false; legCustom = null; atEdit = null; results = null; query = ''; searchErr = ''; }   // 다른 도시의 검색 결과·고치기 상태가 남지 않게
  const before = encode(state);
  state = { ...state, ...patch };
  const after = encode(state);
  if (after === before) { render(); return; }
  if (nav) { history.pushState({ from: before }, '', '#' + after); navTop = true; }   // 들어온 곳을 남겨 backTo가 되짚게, 새 화면은 맨 위부터
  else { undoStack.push(before); if (undoStack.length > 50) undoStack.shift(); history.replaceState(history.state, '', '#' + after); }
  render();
}
// 「← 여행」·「← 내 여행」 — 바로 앞 기록이 그 화면이면 뒤로 가고, 아니면 새로 쌓는다 (안 그러면 뒤로가 상세↔플랜을 핑퐁한다)
function backTo(patch) {
  const from = history.state?.from, f = from != null ? decode('#' + from) : null;
  if (f && Object.keys(patch).every(k => (f[k] ?? null) === (patch[k] ?? null))) history.back();
  else setState(patch);
}
function undo() { const h = undoStack.pop(); if (h == null) return; state = decode('#' + h); history.replaceState(history.state, '', '#' + h); render(); }
window.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) { e.preventDefault(); undo(); } });
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
    b.setAttribute('aria-pressed', state.tab === t || (t === 'mine' && state.tab === 'account')); b.onclick = () => { if (t !== state.tab || (state.pr && t !== 'plan')) setState({ tab: t, pr: null }); };   // 탭은 열린 여행을 놓는다 — 안 그러면 홈에 다녀와도 옛 여행이 다시 열렸다
    host.appendChild(b);
  }
  const who = document.getElementById('who'); who.innerHTML = '';
  if (curUser) { const b = $('button', 'btn sm user', `<span class="dot"></span>${esc(curUser.name)}`); b.type = 'button'; b.title = '내 계정'; b.onclick = () => setState({ tab: 'account', pr: null }); who.appendChild(b); }
  else { const b = $('button', 'btn sm', '로그인'); b.type = 'button'; b.onclick = () => setState({ tab: 'mine', pr: null }); who.appendChild(b); }
  // 단계 토글은 없다 — 플랜은 한 화면
}

function drawStart() {
  map.clear('start');
  const s = state.s || { lat: city.center[0], lng: city.center[1] };
  map.circle('start', s, { radius: 8, color: '#22201c', fillColor: '#fff', weight: 2, title: state.s ? '출발점(숙소)' : '출발점(도심 기본값)' });
}

function renderSettings(side) {   // 기본값(시간·이동·출발점) + 해와 그림자
  const d = $('details', 'panel settings'); d.open = settingsOpen; d.ontoggle = () => { settingsOpen = d.open; };
  d.appendChild($('summary', null, `<b>설정</b> <span class="muted">${esc(CITIES[state.c])} · ${state.d}일 · ${hm(state.t)}–${hm(state.e)} · ${state.v === 'taxi' ? '택시 위주' : '걷기+지하철'}</span>`));
  const p = d;
  const row0 = $('div', 'row regions');
  row0.appendChild($('span', null, `<b>${esc(CITIES[state.c])}</b> <span class="muted">${esc(INDEX.cities[state.c]?.countryName || '')}</span>`));
  const chg = $('button', 'btn sm', '도시 바꾸기'); chg.type = 'button'; chg.onclick = () => setState({ tab: 'home' }); row0.appendChild(chg);
  p.appendChild(row0);
  p.appendChild($('p', 'muted', '아래는 모든 날의 기본값이에요. 날짜 블록의 「설정」에서 날마다 다르게 둘 수 있어요.'));
  const row2 = $('div', 'row');
  row2.append($('span', 'muted', `하루`), stepper(state.t, d => setState({ t: Math.max(0, Math.min(state.e - 60, state.t + d * 30)) }), hm), $('span', 'muted', '~'), stepper(state.e, d => setState({ e: Math.max(state.t + 60, Math.min(1440, state.e + d * 30)) }), hm));
  p.appendChild(row2);
  const row3 = $('div', 'row regions'); row3.appendChild($('span', 'muted', '이동'));
  for (const [v, label] of [['transit', '걷기 + 지하철'], ['taxi', '택시 위주']]) {
    const b = $('button', 'btn sm' + (state.v === v ? ' primary' : ''), label); b.type = 'button';
    b.onclick = () => setState({ v }); row3.appendChild(b);
  }
  p.appendChild(row3);
  const row4 = $('div', 'row regions'); row4.appendChild($('span', 'muted', '출발점'));
  const pick = $('button', 'btn sm' + (pickStart ? ' primary' : ''), pickStart ? '지도를 눌러 주세요…' : (state.s ? '출발점 옮기기' : '지도에서 찍기'));
  pick.type = 'button'; pick.onclick = () => { pickStart = !pickStart; render(); };
  row4.appendChild(pick);
  row4.appendChild($('span', 'muted', state.s ? `${state.s.lat.toFixed(4)}, ${state.s.lng.toFixed(4)}` : '안 찍으면 도심에서 출발'));
  if (state.s) { const clr = $('button', 'btn sm', '지우기'); clr.type = 'button'; clr.onclick = () => setState({ s: null }); row4.appendChild(clr); }
  p.appendChild(row4);
  side.appendChild(d);
}
let settingsOpen = !Object.keys(state.p).length && !state.u.length;   // 공유 링크로 결과에 바로 오면 접어 둔다
let resumeDismissed = false;

// 해 — 첫날 날짜(dt)와 시각 슬라이더로 지도 빛을 맞추고 고도·방위·일출·일몰을 보여준다. 날짜가 없으면 오늘.
// 지도 위 「해와 그림자」 상자 — 플랜 탭에서만 보인다
function mountSun(result, start) {
  const host = document.getElementById('sunbox'); const was = host.hidden; host.innerHTML = ''; host.hidden = false;
  host.appendChild(renderSun(result, start));
  if (was) requestAnimationFrame(() => map.resize());
}
function renderSun(result, start) {
  const p = $('div', 'sun');
  const firstVisible = result.days.findIndex((_, i) => !hidden.has(i)); const dayIdx = firstVisible < 0 ? 0 : firstVisible;
  const tz = INDEX.cities[state.c]?.tz || 'UTC';
  // 날짜 문자열(YYYY-MM-DD) + 분 → 그 도시 시간대의 실제 시각. 브라우저가 어디에 있든 파리 9:30은 파리 9:30이다.
  const ymd = state.dt || new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const [y, mo, da] = ymd.split('-').map(Number);
  const zoned = (dayOffset, minutes) => {
    const guess = new Date(Date.UTC(y, mo - 1, da + dayOffset, Math.floor(minutes / 60), minutes % 60));
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
    return new Date(guess.getTime() - (shown - guess.getTime()));   // 표시가 어긋난 만큼 되돌린다
  };
  const t = sunTime ?? state.t;
  const sun = map.setSun(zoned(dayIdx, t), start);
  const dir = a => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(a / 45) % 8];
  const fmt = d => d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: false }).format(d) : '—';
  const r1 = $('div', 'row');
  r1.appendChild($('span', null, `<b>☀ 해와 그림자</b> <span class="muted">${esc(tz.split('/')[1] || tz)} 시간</span>`));
  if (result.days.length > 1) { const dsel = $('select', 'quiet'); result.days.forEach((_, i) => { const o = $('option', null, `${i + 1}일차`); o.value = i; o.selected = i === dayIdx; dsel.appendChild(o); }); dsel.onchange = () => { hidden.clear(); result.days.forEach((_, i) => { if (i !== Number(dsel.value)) hidden.add(i); }); render(); }; r1.appendChild(dsel); }
  const di = $('input', 'text'); di.type = 'date'; di.value = state.dt || ''; di.title = '1일차 날짜'; di.style.width = 'auto';
  di.onchange = () => setState({ dt: di.value || null });
  r1.appendChild(di);
  if (!state.dt) r1.appendChild($('span', 'muted', '(없으면 오늘)'));
  p.appendChild(r1);
  const r2 = $('div', 'row');
  p.title = '해와 그림자에 따른 뷰와 사진을 고려해보세요';
  const sl = $('input'); sl.type = 'range'; sl.min = 0; sl.max = 1439; sl.step = 10; sl.value = t; sl.style.flex = '1';
  const out = $('span', null, '');
  const show = v => { const s2 = map.setSun(zoned(dayIdx, v), start); out.innerHTML = s2 ? `<b style="font-variant-numeric:tabular-nums">${hm(v)}</b> <span class="muted">${s2.up ? `고도 ${Math.round(s2.altitude)}° · ${dir(s2.azimuth)}쪽` : '해 진 뒤'}</span>` : hm(v); };
  sl.oninput = () => { sunTime = Number(sl.value); show(sunTime); };
  // ▶ 하루 재생 — 일출부터 일몰까지 12초에 훑으며 빛·그림자가 도는 걸 보여준다
  const play = $('button', 'btn sm', '▶ 하루'); play.type = 'button';
  play.onclick = () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; play.textContent = '▶ 하루'; return; }
    const toMin = d => d && !Number.isNaN(d.getTime()) ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).split(':').reduce((h, m) => h * 60 + Number(m), 0)) : null;
    const from = (sun && toMin(sun.sunrise)) ?? 360, to = (sun && toMin(sun.sunset)) ?? 1140;
    let v = from; play.textContent = '■ 멈춤';
    playTimer = setInterval(() => { v += (to - from) / 120; if (v >= to) { v = to; clearInterval(playTimer); playTimer = null; play.textContent = '▶ 하루'; } sl.value = Math.round(v); sunTime = Math.round(v); show(sunTime); }, 100);
  };
  r2.append(sl, out, play); p.appendChild(r2); show(t);
  if (sun) p.appendChild($('p', 'muted', `일출 ${fmt(sun.sunrise)} · 골든 ~${fmt(sun.goldenHourEnd)} / ${fmt(sun.goldenHour)}~ · 일몰 ${fmt(sun.sunset)}`));
  const r3 = $('div', 'row');
  const cb = $('input'); cb.type = 'checkbox'; cb.id = 'cb-shadow'; cb.checked = shadowsOn; cb.onchange = () => { shadowsOn = cb.checked; map.setShadows(shadowsOn); };
  const lab = $('label', null, '건물 그림자'); lab.htmlFor = cb.id;
  r3.append(cb, lab, $('span', 'muted', '줌 15.5+'));
  p.appendChild(r3);
  return p;
}
let homeQuery = '';

// 홈 — 어디로 가세요? + 도시 카드 + (로그인) 내 여행
function renderHome(side, projects, pub = []) {
  const hero = $('div', 'hero');
  hero.appendChild($('h2', null, '어디로 가세요?'));
  hero.appendChild($('p', null, '도시를 고르고 가고 싶은 곳에 표시하면, 며칠에 어떤 순서로 돌지 AlgoTrip이 짜 드려요.'));
  const sr = $('div', 'row');
  const inp = $('input', 'text big'); inp.type = 'search'; inp.placeholder = '도시 이름'; inp.value = homeQuery;
  inp.oninput = () => { homeQuery = inp.value; applyHomeFilter(side); };
  sr.appendChild(inp); hero.appendChild(sr);
  side.appendChild(hero);

  const openCity = id => { step = 2; setState({ c: id, p: {}, m: [], u: [], s: null, l: {}, o: null, pr: null, tab: 'plan', v: INDEX.cities[id]?.pref || 'transit' }); };   // 지하철이 없는 도시(세부)는 택시 위주가 기본
  for (const r of REGIONS) {
    const sec = $('section', 'region'); sec.dataset.region = r.id;
    sec.appendChild($('h3', null, esc(r.name)));
    const grid = $('div', 'cards');
    for (const id of r.cities) {
      const c = INDEX.cities[id]; if (!c) continue;
      const card = $('a', 'card'); card.href = '#'; card.dataset.name = `${c.name} ${c.countryName} ${id}`.toLowerCase();
      card.innerHTML = `<img src="${esc(c.image || '')}" alt="" width="560" height="420" decoding="async"><div class="cap"><b>${esc(c.name)}</b><span>${esc(c.countryName)}</span></div>`;
      card.onclick = e => { e.preventDefault(); openCity(id); };
      grid.appendChild(card);
    }
    sec.appendChild(grid); side.appendChild(sec);
  }

  if (curUser) {
    const sec = $('section', 'region');
    sec.appendChild($('h3', null, `${esc(curUser.name)}의 여행`));
    if (!projects.length) sec.appendChild($('p', 'muted', '아직 저장한 여행이 없어요. 도시를 골라 플랜을 짜고 「저장」을 눌러 보세요.'));
    const grid = $('div', 'cards');
    for (const p of projects.slice(0, 6)) {
      const c = INDEX.cities[p.city] || {};
      const card = $('a', 'card trip'); card.href = '#';
      card.innerHTML = `<img src="${esc(c.image || '')}" alt="" loading="lazy"><div class="cap"><b>${esc(p.name)}</b><span>${esc(c.name || p.city)} · 사진 ${p.photos.length}${p.id === curUser.prefs?.lastPr ? ' · 최근' : ''}</span></div>`;
      card.onclick = e => { e.preventDefault(); setState({ pr: p.id, tab: 'mine' }); };
      if (editing) cardTools(card, p);
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    if (projects.length > 6) { const more = $('button', 'btn', `전체 ${projects.length}개 보기`); more.type = 'button'; more.onclick = () => setState({ tab: 'mine', pr: null }); sec.appendChild(more); }
    side.appendChild(sec);
  } else {
    const sec = $('div', 'panel');
    sec.appendChild($('p', null, '<b>로그인하면</b> 짠 플랜을 여행으로 저장하고, 살 것과 사진을 같이 둘 수 있어요. 플랜을 짜는 데는 로그인이 필요 없어요.'));
    const b = $('button', 'btn', '로그인 · 회원가입'); b.type = 'button'; b.onclick = () => setState({ tab: 'mine' }); sec.appendChild(b);
    side.appendChild(sec);
  }
  const others = pub.filter(p => !curUser || p.ownerId !== curUser.id);
  if (others.length) {
    const sec = $('section', 'region'); sec.appendChild($('h3', null, '다른 사람의 플랜'));
    sec.appendChild($('p', 'muted', '공개로 둔 여행이에요. 열어서 보고 「내 걸로 복사」하면 내 출발점이 돼요.'));
    const grid = $('div', 'cards');
    for (const p of others) {
      const c = INDEX.cities[p.city] || {};
      const card = $('a', 'card trip'); card.href = '#';
      card.innerHTML = `<img src="${esc(c.image || '')}" alt="" loading="lazy"><div class="cap"><b>${esc(p.name)}</b><span>${esc(c.name || p.city)}${p.lastEditedBy ? ` · ${esc(p.lastEditedBy)}` : ''} · 사진 ${p.photos.length}</span></div>`;
      card.onclick = e => { e.preventDefault(); setState({ pr: p.id, tab: 'mine' }); };
      grid.appendChild(card);
    }
    sec.appendChild(grid); side.appendChild(sec);
  }
  side.appendChild($('p', 'muted credits', '도시 사진: Wikimedia Commons (CC BY / CC BY-SA, <a href="assets/cities/credits.json">저작자</a>) · <a href="#tab=terms">이용약관</a> · <a href="#tab=privacy">개인정보처리방침</a>'));
  applyHomeFilter(side);
}
// 여행 카드 위 고치기 단추 — 이름 · 삭제 (홈과 내 여행 목록이 같이 쓴다)
export function cardTools(card, p, st = store, after = () => { projectsCache = null; render(); }) {
  const t = $('span', 'cardtools');
  const nm = $('button', 'btn sm', '이름'); nm.type = 'button'; nm.onclick = async e => { e.preventDefault(); e.stopPropagation(); const n = prompt('여행 이름', p.name); if (!n || n === p.name) return; await st.updateProject(p.id, { name: n }); after(); };
  const del = $('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = async e => { e.preventDefault(); e.stopPropagation(); if (!confirm(`「${p.name}」을 지울까요? 사진도 같이 지워져요.`)) return; await st.deleteProject(p.id); after(); };
  t.append(nm, del); card.appendChild(t);
}
function applyHomeFilter(side) {
  const q = homeQuery.trim().toLowerCase();
  side.querySelectorAll('.card[data-name]').forEach(c => { c.hidden = !!q && !c.dataset.name.includes(q); });
  side.querySelectorAll('section[data-region]').forEach(sec => { sec.hidden = !!q && ![...sec.querySelectorAll('.card')].some(c => !c.hidden); });
}


// 지도 클릭: 출발점 찍기가 켜져 있으면 그게 우선, 아니면 단계별 동작
function bindMapClick(fallback) {
  map.onClick(e => {
    if (pickPhotoFn) { const fn = pickPhotoFn; pickPhotoFn = null; fn(e.latlng); return; }
    if (pickDayStart != null) { const i = pickDayStart; pickDayStart = null; setDay(i, { s: { lat: e.latlng.lat, lng: e.latlng.lng } }); return; }
    if (pickStart) { pickStart = false; setState({ s: { lat: e.latlng.lat, lng: e.latlng.lng } }); return; }
    if (fallback) fallback(e);
  });
}

// 가이드 — 그 도시의 준비물 · 사진 · 기념품을 한 장에
function renderInfo(side) {
  const chosen = new Set(Object.keys(state.p));
  const nav = $('nav', 'guidenav');
  for (const [id, label] of [['g-pack', '준비물'], ['g-photo', '사진'], ['g-gift', '기념품']]) { const l = $('a', null, label); l.href = '#'; l.onclick = e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; nav.appendChild(l); }
  side.appendChild(nav);
  const sec = (id, title) => { const h = $('h2', 'guidesec', title); h.id = id; side.appendChild(h); };

  sec('g-pack', '준비물');
  renderPacking(side);
  const local = $('div', 'panel'); local.appendChild($('h2', null, `${esc(city.name)}에서는 특히`));
  for (const x of city.pack) local.appendChild($('div', 'item', `<b>${esc(x.item)}</b><span>${esc(x.why)}</span>`));
  side.appendChild(local);

  sec('g-photo', '사진');
  const g = $('div', 'panel');
  for (const t of city.photo.general) g.appendChild($('div', 'item', `<span>${esc(t)}</span>`));
  side.appendChild(g);
  const mine = city.places.filter(pl => chosen.has(pl.id)), rest = city.places.filter(pl => !chosen.has(pl.id));
  for (const [title, list] of [['내가 고른 곳', mine], ['다른 장소', rest]]) {
    const tips = list.filter(pl => city.photo.places[pl.id]); if (!tips.length) continue;
    const p = $('details', 'panel'); p.open = title === '내가 고른 곳'; p.appendChild($('summary', null, `<b>${title}</b> <span class="muted">${tips.length}곳</span>`));
    for (const pl of tips) p.appendChild($('div', 'item', `<b>${esc(pl.name)}</b><span>${esc(city.photo.places[pl.id])}</span>`));
    side.appendChild(p);
  }

  sec('g-gift', '기념품');
  const gp = $('div', 'panel');
  for (const x of city.gift) {
    const it = $('div', 'item', `<b>${esc(x.item)}</b><span class="muted">${esc(x.where)}</span><span>${esc(x.note)}</span>`);
    if (state.pr && curUser) {
      const b = $('button', 'btn sm', '살 것에 담기'); b.type = 'button';
      b.onclick = async () => { const pr = await store.getProject(state.pr); if (!pr) return; await store.updateProject(pr.id, { shopping: [...pr.shopping, { text: x.item, done: false }] }); b.textContent = '담았어요'; b.disabled = true; };
      it.appendChild(b);
    }
    gp.appendChild(it);
  }
  if (!state.pr) gp.appendChild($('p', 'muted', '여행을 저장해 두면 항목마다 「살 것에 담기」가 생겨요.'));
  side.appendChild(gp);
}

const LOADING = '<div class="loading" role="status"><span class="ride" aria-hidden="true"><i></i></span>불러오는 중이에요</div>';   // 선 위를 달리는 점
let renderSeq = 0;              // 겹쳐 시작된 렌더 중 마지막 것만 그린다 (await 사이에 새 렌더가 오면 옛것은 접는다)
async function render() {
  const seq = ++renderSeq;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  if (!Object.hasOwn(CITIES, state.c)) { state = { ...state, c: DEFAULTS.c, p: {}, m: [], u: [], s: null }; history.replaceState(null, '', '#' + encode(state)); }
  const side = document.getElementById('side');
  if (lastStep === 0 && !authLanding && !/[#&]tab=/.test(location.hash) && !state.pr && !Object.keys(state.p).length && !state.u.length) {   // 빈손으로 오면 홈
    state = { ...state, tab: 'home' }; history.replaceState(null, '', '#' + encode(state));
  }
  renderTabs();                                     // 계정 확인을 기다리지 않고 틀부터 그린다
  document.querySelector('.layout').classList.toggle('nomap', !(state.tab === 'plan' || (state.tab === 'mine' && state.pr)));   // 지도는 플랜, 그리고 여행을 열어 둔 내 여행에서
  document.getElementById('sunbox').hidden = state.tab !== 'plan' || !sunOpen;
  document.getElementById('btnsun').hidden = state.tab !== 'plan';
  // 계정 서버가 아직이면 기다리지 않고 그린다(storeReady가 끝나면 다시 그린다). 확인이 3초 넘게 안 끝나면 일단 로그아웃 상태로
  try { curUser = storeIsFinal ? await Promise.race([store.user(), new Promise(r => setTimeout(() => r(null), 3000))]) : null; } catch { curUser = null; }
  if (seq !== renderSeq) return;
  // 휴대폰은 지도가 위 68%를 차지해 「← 여행」「← 내 여행」이 첫 화면 밖으로 밀린다 — 지도 위에 하나 띄운다 (데스크톱은 CSS로 숨김)
  const mb = document.getElementById('mapback'), back = state.pr && (state.tab === 'plan' ? ['← 여행', { tab: 'mine', pr: state.pr }] : state.tab === 'mine' ? [curUser ? '← 내 여행' : '← 홈', { tab: curUser ? 'mine' : 'home', pr: null }] : null);
  mb.hidden = !back; if (back) { mb.textContent = back[0]; mb.onclick = () => backTo(back[1]); }
  if (PAGES.includes(state.tab)) { lastStep = -1; side.innerHTML = ''; map.clear('places'); map.clear('route'); renderPage(side, state.tab, { $, setState }); window.scrollTo(0, 0); return; }
  if (state.tab === 'home') {
    lastStep = -1;
    const sy = window.scrollY, st = side.scrollTop; side.style.minHeight = side.offsetHeight + 'px'; side.innerHTML = ''; map.clear('places'); map.clear('route');
    const cached = projectsCache && Date.now() - projectsCache.at < 60000, pcached = publicCache && Date.now() - publicCache.at < 120000;
    renderHome(side, cached ? projectsCache.data : [], pcached ? publicCache.data : []);
    restoreScroll(side, sy, st);
    // 목록이 없으면 받아서 한 번 더 — 계정 서버가 아직이면 storeReady가 어차피 다시 그리니 여기선 안 건다 (무한 루프 방지)
    if (storeIsFinal && (!cached || !pcached) && !homeFetching) {
      homeFetching = true;
      Promise.all([listProjectsCached(), listPublicCached()]).finally(() => { homeFetching = false; if (seq === renderSeq && state.tab === 'home') render(); });
    }
    return;
  }
  if (!side.children.length) side.innerHTML = LOADING;            // 첫 화면 — 도시 파일을 받는 동안
  try { city = await loadCity(state.c); if (seq !== renderSeq) return; }
  catch (e) { renderTabs(); side.innerHTML = ''; side.appendChild($('div', 'panel', `<h2>데이터를 못 불러왔어요</h2><p>${esc(CITIES[state.c])} 장소 정보를 읽지 못했어요. 네트워크를 확인하고 새로고침해 주세요.</p>`)); return; }
  if (lastStep === 0 && resolvePlaces(state, city).length) step = 3;   // 공유 링크는 결과로 바로 연다 (도시 가드 뒤에 판단)
  renderTabs();
  const sy = window.scrollY, st = side.scrollTop;        // 다시 그리는 동안 스크롤 자리를 지킨다
  side.style.minHeight = side.offsetHeight + 'px';
  side.innerHTML = '';
  map.clear('places'); map.clear('route');
  drawStart();
  if (state.tab === 'plan' || (state.tab === 'mine' && state.pr)) map.resize();   // 숨겼다 보일 때 크기를 다시 잰다
  const first = lastStep === 0;
  // 초대 링크로 왔고 로그인돼 있으면 멤버로 들어가 그 여행을 연다
  const join = pendingJoin();
  if (join && curUser) {
    try { const pid = await store.acceptInvite(join, curUser.name); sessionStorage.removeItem('rp.join'); setState({ pr: pid, tab: 'mine' }); return; }
    catch (e) { sessionStorage.removeItem('rp.join'); alert(`초대를 받지 못했어요 — ${e.message || e}`); }
  }
  if (join && !curUser && state.tab !== 'mine') { setState({ tab: 'mine' }); return; }

  if (state.tab === 'mine' || state.tab === 'account') {
    lastStep = -1;
    side.innerHTML = LOADING;                                        // 아래 상자를 바꿔 끼울 때 사라진다
    const projects = await listProjectsCached();
    if (seq !== renderSeq) return;
    let project = state.pr ? projects.find(p => p.id === state.pr) || null : null;
    let canEdit = false, isOwner = false;
    if (state.pr && !project) { try { project = await store.getProject(state.pr); } catch {} }      // 공개 플랜·링크 보기
    if (state.pr && !project && storeIsFinal) { side.innerHTML = ''; document.querySelector('.layout').classList.add('nomap'); renderPage(side, 'notfound', { $, setState, missingTrip: true }); return; }   // 지도를 숨겨야 휴대폰에서 버튼이 첫 화면에 온다   // 지워졌거나 권한이 없는 여행
    if (project && curUser) { isOwner = project.ownerId === curUser.id; canEdit = isOwner || project.role === 'editor'; }
    curProject = project;
    // 떼어 둔 상자에 그렸다가 마지막에 한 번에 바꿔 끼운다 — 그리는 도중 render가 또 불리면 두 벌이 섞여 붙었다
    const out = document.createElement('div');
    await renderMine({ state, setState, city, $, side: out, store: withInvalidation(store), user: curUser, projects, project, canEdit, isOwner, CITIES, INDEX, loadCity, plan, resolvePlaces, hm, render, map, accountOpen: state.tab === 'account', backTo, setStep: n => { step = n; }, pickPhoto: fn => { pickPhotoFn = fn; }, fitPhotos: pts => { if (pts.length) map.fitBounds(pts, 40); }, saveToProject, joinPending: !!join, authNote, editing, cardTools });
    if (seq !== renderSeq) return;
    side.replaceChildren(...out.childNodes);
    bindMapClick(null); drawStart();
    restoreScroll(side, sy, st); return;
  }
  if (state.tab !== 'plan') { lastStep = -1; if (state.tab === 'guide') { side.innerHTML = LOADING; [packingCache] = await Promise.all([loadPacking(), loadPackingList()]); if (seq !== renderSeq) return; side.innerHTML = ''; } renderInfo(side); restoreScroll(side, sy, st); return; }
  const entering = step !== lastStep; lastStep = step;
  if (entering) requestAnimationFrame(() => map.resize());   // 숨겼다 다시 보일 때 타일 빈칸 방지
  if (state.pr && (!curProject || curProject.id !== state.pr)) { try { curProject = await store.getProject(state.pr); } catch { curProject = null; } if (seq !== renderSeq) return; }
  if (!state.pr) curProject = null;
  renderPlan(side, entering);
  restoreScroll(side, sy, st);
}
function restoreScroll(side, sy, st) {
  if (navTop) { navTop = false; sy = st = 0; }
  side.scrollTop = st; window.scrollTo(0, sy);
  requestAnimationFrame(() => { side.style.minHeight = ''; side.scrollTop = st; window.scrollTo(0, sy); });
}

// Task 8·9에서 채운다
const WEIGHT_LABEL = { 1: '1순위 — 이 도시를 대표', 2: '2순위', 3: '3순위' };

let activeDay = 0;   // 장소 고르기에서 「여기에 추가」로 찍어 둔 날 (화면 상태)
// 날짜별 설정(ds) → 엔진의 perDay 꼴
function perDay() { const out = {}; for (const [k, d] of Object.entries(state.ds || {})) out[k] = { dayStart: d.t, dayEnd: d.e, pref: d.v, start: d.s }; return out; }
function setDay(i, patch) { const ds = { ...(state.ds || {}) }; const cur = { ...(ds[i] || {}), ...patch }; for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k]; if (Object.keys(cur).length) ds[i] = cur; else delete ds[i]; setState({ ds: Object.keys(ds).length ? ds : null }); }
let pickDayStart = null;   // 「이 날 출발점 찍기」 중인 날

// 지금 배정: 직접 정한 o가 있으면 그것(새로 고른 곳은 활성 날에 붙임), 없으면 자동 계획의 결과
function assignment() {
  const places = resolvePlaces(state, city); const ids = places.map(p => p.id);
  if (state.o) {
    const days = state.o.map(d => d.filter(id => ids.includes(id)));
    while (days.length < state.d) days.push([]);
    const seen = new Set(days.flat()); const left = ids.filter(id => !seen.has(id));
    if (left.length) days[Math.min(activeDay, days.length - 1)].push(...left);
    return { days, auto: false, dropped: [] };
  }
  if (!places.length) return { days: Array.from({ length: state.d }, () => []), auto: true, dropped: [] };
  const start = state.s || { lat: city.center[0], lng: city.center[1] };
  const res = plan(places, { days: state.d, start, dayStart: state.t, dayEnd: state.e, pref: state.v, legs: state.l, perDay: perDay(), algo: state.a });
  const days = res.days.map(d => d.stops.map(s => s.place.id)); while (days.length < state.d) days.push([]);
  return { days, auto: true, dropped: res.dropped.map(x => x.place.id) };
}
// 직접 모드로 전환 — 지금 자동 배정을 o로 굳힌다
function makeManual() { if (state.o) return state.o; const a = assignment(); const days = a.days.map(d => [...d]); if (a.dropped.length) days[days.length - 1].push(...a.dropped); return days; }

function togglePlace(id) {
  const p = { ...state.p }, m = state.m.filter(x => x !== id);
  let o = state.o ? state.o.map(d => d.filter(x => x !== id)) : null;
  const at = { ...state.at }; delete at[id];
  if (id in p) delete p[id];
  else { p[id] = city.places.find(x => x.id === id).default; if (o) { while (o.length <= activeDay) o.push([]); o[activeDay].push(id); } }
  setState({ p, m, o, at });
}
// 내 장소 추가 — day가 숫자면 그날로(직접 배정으로 굳음), null이면 직접 모드일 때 활성 날, 자동 모드면 자동
function addUserPlace(u, day = null) {
  const idx = state.u.length, id = `u${idx}`;
  let o = state.o ? state.o.map(d => [...d]) : null;
  if (day != null) { o = o || makeManual(); while (o.length <= day) o.push([]); o[day].push(id); activeDay = day; }
  else if (o) { while (o.length <= activeDay) o.push([]); o[activeDay].push(id); }
  setState({ u: [...state.u, u], o });
}
// 날 고르기 — 4일 이하면 알약 버튼, 5일 이상이면 드롭박스. value는 ''(첫 선택지) 또는 날 번호 문자열
function dayPicker(nDays, value, onChange, first = null) {
  const opts = [...(first ? [['', first]] : []), ...Array.from({ length: nDays }, (_, i) => [String(i), `${i + 1}일차`])];
  if (nDays <= 4) {
    const w = $('span', 'row regions'); w.style.margin = '0';
    for (const [v, l] of opts) { const b = $('button', 'btn sm' + (v === value ? ' primary' : ''), l); b.type = 'button'; b.onclick = () => { w.querySelectorAll('.btn').forEach(x => x.classList.remove('primary')); b.classList.add('primary'); w.dataset.value = v; onChange(v); }; w.appendChild(b); }
    w.dataset.value = value; return w;
  }
  const sel = $('select', 'quiet'); for (const [v, l] of opts) { const o = $('option', null, l); o.value = v; o.selected = v === value; sel.appendChild(o); }
  sel.onchange = () => onChange(sel.value); return sel;
}
// 검색으로 찾은 곳의 용도 — 머무는 시간이 달라진다. 역·정류장은 「경유」가 맞다
const USES = [['see', '구경', 60], ['quick', '잠깐 들르기', 20], ['meal', '식사', 60], ['long', '오래 머물기', 120], ['via', '경유 (머물지 않음)', 5]];

// 날짜 블록 — [1일차 ▾ · 3곳] 안에 그날 갈 곳, 「+ 여기에 추가」, 「+ 하루 추가」
function renderDayCfg(i) {
  // 이 날만 다르게 — 시간·이동·출발점
  const ov = state.ds?.[i] || {}; const on = Object.keys(ov).length > 0;
  const cfg = $('div', 'row regions daycfg');
  const sw = $('input'); sw.type = 'checkbox'; sw.id = `dcfg-${i}`; sw.checked = on; sw.onchange = () => { if (sw.checked) setDay(i, { t: state.t, e: state.e }); else setDay(i, { t: null, e: null, v: null, s: null }); };
  const swl = $('label', 'muted', '이 날만 다르게'); swl.htmlFor = sw.id; cfg.append(sw, swl);
  if (on) {
    const t0 = ov.t ?? state.t, e0 = ov.e ?? state.e;
    cfg.append(stepper(t0, dd => setDay(i, { t: Math.max(0, Math.min(e0 - 60, t0 + dd * 30)) }), hm), $('span', 'muted', '~'), stepper(e0, dd => setDay(i, { e: Math.max(t0 + 60, Math.min(1440, e0 + dd * 30)) }), hm));
    for (const [v, label] of [['transit', '걷기+지하철'], ['taxi', '택시']]) { const b = $('button', 'btn sm' + ((ov.v || state.v) === v ? ' primary' : ''), label); b.type = 'button'; b.onclick = () => setDay(i, { v }); cfg.appendChild(b); }
    const ps = $('button', 'btn sm' + (pickDayStart === i ? ' primary' : ''), pickDayStart === i ? '지도를 눌러 주세요…' : (ov.s ? '출발점 옮기기' : '이 날 출발점')); ps.type = 'button'; ps.onclick = () => { pickDayStart = pickDayStart === i ? null : i; render(); }; cfg.appendChild(ps);
    if (ov.s) { const c = $('button', 'btn sm', '출발점 지우기'); c.type = 'button'; c.onclick = () => setDay(i, { s: null }); cfg.appendChild(c); }
  }
  return cfg;
}
// id를 i번째 날로 — 고른 적 없는 장소면 고르면서, 이미 다른 날에 있으면 옮기면서. 직접 배정으로 굳는다
// id 를 i일차의 역 refId 앞(before=true)이나 뒤에 끼운다 — 끌어 놓기와 「옮기기」가 같이 쓴다
function moveTo(id, i, refId, before) {
  const o = makeManual().map(d => d.filter(x => x !== id)); while (o.length <= i) o.push([]);
  const p = { ...state.p }; if (!id.startsWith('u') && !(id in p)) { const q = city.places.find(x => x.id === id); if (!q) return; p[id] = q.default; }
  const at = o[i].indexOf(refId); o[i].splice(at < 0 ? o[i].length : at + (before ? 0 : 1), 0, id); activeDay = i; setState({ p, o });
}
function dropToDay(id, i) {
  const o = makeManual().map(d => d.filter(x => x !== id)); while (o.length <= i) o.push([]);
  const p = { ...state.p };
  if (!id.startsWith('u') && !(id in p)) { const pl = city.places.find(x => x.id === id); if (!pl) return; p[id] = pl.default; }
  o[i].push(id); activeDay = i; setState({ p, o });
}

let query = '', results = null, searching = false, searchErr = '';   // 검색 상자 상태 (화면 상태)

// 입력한 글자로 목록을 거른다 — 다시 그리지 않고 숨기기만 (입력 포커스를 지키려고)
function applyFilter(side) {
  const q = query.trim().toLowerCase();
  side.querySelectorAll('[data-name]').forEach(el => { el.hidden = !!q && !el.dataset.name.includes(q); });
  side.querySelectorAll('.v2zone').forEach(z => { z.hidden = !!q && ![...z.querySelectorAll('.place')].some(c => !c.hidden); const g = z.querySelector('details.group'); if (q && !z.hidden && g) g.open = true; });
  const pk = side.querySelector('.v2pickbox'); if (pk && q) pk.open = true;
}

let aiMsgs = [], aiBusy = false, aiOpen = false, aiPending = null;   // AI 대화 (화면 상태)

// AI에게 말하기 — "미술관 위주로 느긋하게 3일" 같은 말을 플랜 상태로 바꿔 준다. 로그인 필요(서버 함수가 토큰을 본다)
function renderAiBox(host) {
  const box = $('div', 'ai');
  const hd = $('div', 'row');
  const tg = $('button', 'btn sm' + (aiOpen ? ' primary' : ''), '✦ AI에게 말하기'); tg.type = 'button'; tg.onclick = () => { aiOpen = !aiOpen; render(); };
  hd.appendChild(tg); hd.appendChild($('span', 'muted', '어떤 여행을 하고 싶은지 말하면 장소와 일정을 골라 줘요'));
  box.appendChild(hd);
  if (!aiOpen) { host.appendChild(box); return; }
  if (!curUser) { box.appendChild($('p', null, '로그인하면 쓸 수 있어요 — <b>내 여행</b> 탭에서.')); host.appendChild(box); return; }
  const log = $('div', 'ailog');
  for (const m of aiMsgs) log.appendChild($('div', 'msg ' + m.role, esc(m.content)));
  if (aiBusy) log.appendChild($('div', 'msg assistant muted', '생각 중…'));
  box.appendChild(log);
  if (aiPending && Object.keys(aiPending).length) {
    const pr = $('div', 'row');
    const n = Object.keys(aiPending.p || {}).length;
    pr.appendChild($('span', null, `<b>제안</b> <span class="muted">${n ? `장소 ${n}곳` : ''}${aiPending.d ? ` · ${aiPending.d}일` : ''}${aiPending.o ? ' · 날짜별 배정' : ''}</span>`));
    const ap = $('button', 'btn sm primary', '이 제안 적용'); ap.type = 'button';
    ap.onclick = () => { const a = aiPending; aiPending = null; const patch = {}; if (a.p) { patch.p = a.p; patch.m = a.m || []; patch.o = a.o || null; } else if (a.m) patch.m = a.m; for (const k of ['d', 'v', 't', 'e']) if (a[k] != null) patch[k] = a[k]; if (!a.p && a.o) patch.o = a.o; setState(patch); };
    const no = $('button', 'btn sm', '무시'); no.type = 'button'; no.onclick = () => { aiPending = null; render(); };
    pr.append(ap, no); box.appendChild(pr);
  }
  const row = $('div', 'row');
  const ta = $('textarea', 'text'); ta.rows = 2; ta.placeholder = aiMsgs.length ? '이어서…' : '예: 건축 좋아하는 아버지랑 3일, 미술관은 하나만, 저녁엔 야경';
  const send = $('button', 'btn primary', '보내기'); send.type = 'button'; send.disabled = aiBusy;
  const run = async () => {
    const text = ta.value.trim(); if (!text || aiBusy) return;
    aiMsgs.push({ role: 'user', content: text }); aiBusy = true; ta.value = ''; render();
    try {
      const session = store.sb ? (await store.sb.auth.getSession()).data.session : null;
      const res = await chat({ session, city, places: city.places, state: { d: state.d, t: state.t, e: state.e, v: state.v, p: state.p, m: state.m }, messages: aiMsgs });
      aiMsgs.push({ role: 'assistant', content: res.reply || '(빈 답)' }); aiPending = res.apply && Object.keys(res.apply).length ? res.apply : null;
    } catch (e) { aiMsgs.push({ role: 'assistant', content: /Failed to fetch|아직 없/.test(e.message) ? 'AI 기능이 아직 준비되지 않았어요.' : `답을 받지 못했어요 — ${e.message || e}` }); }
    aiBusy = false; render();
  };
  send.onclick = run; ta.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); };
  row.append(ta, send); box.appendChild(row);
  if (aiMsgs.length) { const clr = $('button', 'btn sm', '대화 지우기'); clr.type = 'button'; clr.onclick = () => { aiMsgs = []; aiPending = null; render(); }; box.appendChild(clr); }
  host.appendChild(box);
}

// ───── 플랜: 노선도 한 화면 — 날 = 노선, 장소 = 역. 고르기와 결과가 같은 자리에 있다 ─────
let dragId = null;
let atEdit = null;   // 「이 시각부터」를 적는 중인 역 (화면 상태)
let pickOpen = true;   // 담기 상자 접힘 (화면 상태)
const openGroups = new Map();   // 담기 묶음 펼침 — 「도시:묶음」 → 열림 (화면 상태)
let lastFit = null;                     // 마지막으로 지도를 맞춘 점들 — 창 크기가 바뀌면 다시 맞춘다
let pin = null;        // 지도에서 찍은 자리 {lat,lng} — 이름·시간을 적는 칸이 뜬다 (옛 prompt 둘 대신)
let askSave = false;   // 「여행으로 저장」 이름 칸
let legCustom = null;  // 분을 직접 적는 중인 구간 키
const editing = true;   // 수정 모드가 기본 — 역·구간·날의 단추가 늘 붙는다 (고칠 것 11-08: 토글은 필요 없다)
const ALGO_HINT = { area: '가까운 곳끼리 하루', route: '전체를 한 줄로 이어 날과 날 사이 되돌아가기가 적게', even: '날마다 체류·이동이 비슷하게 — 빈 날·짧은 날이 안 생겨요', priority: '꼭 가기·1순위부터 채우고, 자리가 없으면 낮은 순위가 빠져요' };
let mapFitAsked = false;   // 날을 켜고 끈 뒤 지도를 보이는 날에 맞춘다
function renderPlan(side, entering) {
  const places = resolvePlaces(state, city);
  const byId = new Map(places.map(p => [p.id, p]));
  const a = assignment();
  const start = state.s || { lat: city.center[0], lng: city.center[1] };
  const result = places.length ? plan(places, { days: state.d, start, dayStart: state.t, dayEnd: state.e, pref: state.v, legs: state.l, manual: a.auto ? null : a.days, perDay: perDay(), algo: state.a }) : { days: [], dropped: [] };
  const days = Array.from({ length: Math.max(state.d, result.days.length) }, (_, i) => result.days[i] || { stops: [], end: 0, moveMin: 0 });

  // 머리 — 도시 · 일수 · 저장 · 더보기
  const head = $('div', 'v2head');
  if (state.pr) { const bk = $('button', 'btn sm', '← 여행'); bk.type = 'button'; bk.title = '여행 페이지로'; bk.onclick = () => backTo({ tab: 'mine', pr: state.pr }); head.appendChild(bk); }
  const legs = curProject?.id === state.pr ? legsOf(curProject.hash) : [];
  if (legs.length > 1) {
    const lp = $('div', 'row regions legpills'); lp.style.margin = '0';
    legs.forEach((h, j) => { const c = decode('#' + h).c; const b = $('button', 'btn sm' + (j === (state.lg || 0) ? ' primary' : ''), esc(CITIES[c] || c)); b.type = 'button'; b.onclick = () => { if (j !== (state.lg || 0)) setState({ ...decode('#' + h), tab: 'plan', pr: state.pr, lg: j }); }; lp.appendChild(b); });
    side.appendChild(lp);
  }
  const ttl = $('div', 'v2title');
  ttl.innerHTML = `<h2>${esc(city.name)}</h2><span>${state.d}일 · ${places.length}곳</span>`;
  head.appendChild(ttl);
  const un = $('button', 'btn sm', '↶ 되돌리기'); un.type = 'button'; un.title = '방금 한 것 되돌리기 (⌘Z)'; un.disabled = !undoStack.length; un.onclick = undo;
  head.appendChild(un);
  const sv = $('button', 'btn primary', state.pr && curUser ? '저장' : '여행으로 저장'); sv.type = 'button';
  sv.onclick = async () => {
    if (!curUser) { setState({ tab: 'mine' }); return; }
    try {
      if (state.pr) { await saveToProject(state.pr); sv.textContent = '저장했어요'; setTimeout(render, 600); }
      else { askSave = !askSave; render(); }
    } catch (e) { alert(`저장하지 못했어요 — ${e.message || e}`); }
  };
  const more = $('details', 'v2more'); more.appendChild($('summary', null, '⋯'));
  const menu = $('div', 'v2menu');
  const mi = (label, fn) => { const b = $('button', null, label); b.type = 'button'; b.onclick = () => { more.open = false; fn(); }; menu.appendChild(b); };
  mi('링크 복사', async () => { try { await navigator.clipboard.writeText(location.href); } catch { prompt('이 주소를 복사하세요', location.href); } });
  mi('하루 추가', () => setState({ d: Math.min(10, state.d + 1), o: state.o ? [...state.o.map(d => [...d]), []] : null }));
  if (!a.auto) mi('자동으로 다시 나누기', () => setState({ o: null }));
  mi('도시 바꾸기', () => setState({ tab: 'home' }));
  mi('플랜 비우기', () => { if (places.length && !confirm('고른 장소와 날짜 배정을 모두 지울까요? 「↶ 되돌리기」로 다시 살릴 수 있어요.')) return; setState({ p: {}, m: [], u: [], o: null, l: {}, ds: null, at: {} }); });
  const set = $('div', 'v2set'); renderSettings(set); menu.appendChild(set);
  more.appendChild(menu);
  head.append(sv, more);
  side.appendChild(head);
  // 도시 소개 — 무엇으로 유명하고 크게 어디로 나뉘나 (11-08 영철: 「세부는 자연 관광이 유명하다, 크게 4군데」 같은 칸)
  if (city.intro) side.appendChild($('p', 'v2intro', esc(city.intro)));
  if (askSave && curUser && !state.pr) {   // 「여행으로 저장」 — 이름을 적는 칸 (브라우저 창 대신)
    const box = $('div', 'result ask'); box.appendChild($('div', null, '<b>여행 이름</b> <span class="muted">내 여행 목록에 이렇게 보여요</span>'));
    const r = $('div', 'row'); const inp = $('input', 'text'); inp.type = 'text'; inp.value = `${CITIES[state.c]} ${state.d}일`; inp.maxLength = 60;
    const ok = $('button', 'btn sm primary', '저장'); ok.type = 'button'; const no = $('button', 'btn sm', '취소'); no.type = 'button'; const msg = $('span', 'muted', '');
    const go = async () => { const name = inp.value.trim(); if (!name) { inp.focus(); return; } ok.disabled = true; try { const p = await store.createProject({ name, city: state.c, hash: encode({ ...state, tab: 'plan', pr: null }) }); askSave = false; setState({ pr: p.id }); } catch (e) { ok.disabled = false; msg.textContent = `저장하지 못했어요 — ${e.message || e}`; } };
    ok.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { askSave = false; render(); } }; no.onclick = () => { askSave = false; render(); };
    r.append(inp, ok, no, msg); box.appendChild(r); side.appendChild(box);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  }
  // 나누는 방법 — 자동일 때 넷 중 하나, 직접 배정이면 자동으로 돌아가는 단추
  if (places.length) {
    const ar = $('div', 'row regions algos');
    if (a.auto) {
      ar.appendChild($('span', 'muted', '나누기'));
      for (const [k, label] of Object.entries(ALGOS)) { const b = $('button', 'chip', label); b.type = 'button'; b.title = ALGO_HINT[k]; b.setAttribute('aria-pressed', (state.a || 'area') === k); b.onclick = () => setState({ a: k }); ar.appendChild(b); }
    } else {
      ar.appendChild($('span', 'muted', '직접 정한 배정이에요'));
      const b = $('button', 'chip', '자동으로 다시 나누기'); b.type = 'button'; b.onclick = () => setState({ o: null }); ar.appendChild(b);
    }
    side.appendChild(ar);
  }
  // 출발점(숙소) — 날마다 여기서 시작한다. 전엔 ⋯ 메뉴 안에만 있어 못 찾았다
  const sr = $('div', 'row regions startrow'); sr.appendChild($('span', 'muted', '출발점(숙소)'));
  sr.appendChild($('span', null, state.s ? `<b>${state.s.lat.toFixed(4)}, ${state.s.lng.toFixed(4)}</b>` : '<b>도심</b> <span class="muted">— 숙소를 찍으면 동선이 거기서 시작해요</span>'));
  const sp = $('button', 'chip' + (pickStart ? ' on' : ''), pickStart ? '지도를 눌러 주세요…' : (state.s ? '지도에서 옮기기' : '지도에서 찍기')); sp.type = 'button'; sp.onclick = () => { pickStart = !pickStart; pin = null; render(); }; sr.appendChild(sp);
  if (state.s) { const sc = $('button', 'chip', '지우기'); sc.type = 'button'; sc.onclick = () => setState({ s: null }); sr.appendChild(sc); }
  sr.appendChild($('span', 'muted', '검색 결과의 「출발점으로」로도 정해요'));
  side.appendChild(sr);

  // 넣기 — 검색 + AI
  const add = $('div', 'v2add');
  add.appendChild(renderSearch());
  if (pin) add.appendChild(renderPin());
  if (FEATURES.ai) renderAiBox(add);   // 서버 함수(plan-chat)를 배포한 뒤 config.js에서 켠다
  side.appendChild(add);

  // 담기 — 구역별(areas, 지도 테두리와 같은 색) 또는 1·2·3순위별 묶음. 행마다 체크, 고르면 꼭·체류·설명이 붙고, 끌어서 날에 놓는다 (11-02의 전체 목록 그대로)
  const pk = $('details', 'v2pickbox'); pk.open = pickOpen; pk.ontoggle = () => { pickOpen = pk.open; };
  pk.appendChild($('summary', null, `담기 <span class="muted">${city.places.length}곳 중 ${places.length} 골랐어요 · 체크하고 체류를 골라요</span>`));
  const e = $('div', 'v2empty');
  if (!places.length) e.appendChild($('p', null, `<b>가고 싶은 곳을 골라 보세요.</b> 고른 순서대로 며칠에 어떻게 돌지 바로 짜 드려요.`));
  const rowOf = (pl, into) => {
    const chosen = pl.id in state.p, must = state.m.includes(pl.id);
    const row = $('div', 'row place drag' + (pl.weight === 1 ? ' w1' : '')); row.dataset.name = pl.name.toLowerCase(); row.draggable = true;
    row.ondragstart = ev => { ev.dataTransfer.setData('text/place', pl.id); ev.dataTransfer.effectAllowed = 'copyMove'; };
    const cb = $('input'); cb.type = 'checkbox'; cb.checked = chosen; cb.id = 'cb-' + pl.id; cb.onchange = () => togglePlace(pl.id);
    const lab = $('label', null, esc(pl.name)); lab.htmlFor = cb.id;
    row.append(cb, lab);
    if (chosen) {
      const mustBtn = $('button', 'btn sm' + (must ? ' primary' : ''), '꼭'); mustBtn.type = 'button'; mustBtn.title = must ? '꼭 가기 해제' : '꼭 가기 — 시간이 모자라도 안 빠져요';
      mustBtn.onclick = () => setState({ m: must ? state.m.filter(x => x !== pl.id) : [...state.m, pl.id] });
      const sel = $('select', 'quiet');
      pl.opts.forEach((o, i) => { const op = $('option', null, `${o.label} · ${o.min}분`); op.value = i; op.selected = state.p[pl.id] === i; sel.appendChild(op); });
      sel.onchange = () => setState({ p: { ...state.p, [pl.id]: Number(sel.value) } });
      row.append(mustBtn, sel);
    } else { const d = pl.opts[pl.default]; if (d) row.appendChild($('span', 'muted dw', `${esc(d.label)} · ${d.min}분`)); }
    into.appendChild(row);
    if (chosen && pl.note) { const note = $('p', 'muted note', pl.note); note.dataset.name = row.dataset.name; into.appendChild(note); }
  };
  // 묶음 — 구역(areas)이 있으면 구역별(처음엔 다 펼침), 없으면 1·2·3순위별(처음엔 1순위만). 펼침은 묶음 이름으로 기억
  const groups = city.areas ? city.areas.map((ar, i) => ({ key: ar.id, name: ar.name, blurb: ar.blurb || '', color: `var(${DAY_COLORS[i] || '--d1'})`, open: true, list: [...city.places.filter(p => p.area === ar.id)].sort((a, b) => a.weight - b.weight) }))
    : [1, 2, 3].map(w => ({ key: 'w' + w, name: WEIGHT_LABEL[w], blurb: '', color: ['', 'var(--gold)', 'var(--d1)', 'var(--line)'][w], open: w === 1, list: city.places.filter(p => p.weight === w) })).filter(g => g.list.length);
  // 구역은 보편적인 말이 아니라서 묶음 위에 한 줄 풀어 둔다 (11-08)
  if (city.areas) e.appendChild($('p', 'muted zonehint', `<b>구역</b>은 서로 가까운 곳끼리 묶은 동네예요. 지도에도 같은 색 점선 테두리로 그려 두었어요 — 한 구역 안은 걷거나 짧게 타고, 구역 사이는 차나 전철로 옮겨 가요.`));
  for (const g of groups) {
    const z = $('div', 'v2zone'); z.style.setProperty('--c', g.color);
    const panel = $('details', 'group'); const k = `${state.c}:${g.key}`;
    panel.open = openGroups.has(k) ? openGroups.get(k) : g.open; panel.ontoggle = () => openGroups.set(k, panel.open);
    const chosenN = g.list.filter(p => p.id in state.p).length;
    panel.appendChild($('summary', null, `<b>${esc(g.name)}</b> <span class="muted">${g.list.length}곳${chosenN ? ` · 고른 ${chosenN}` : ''}${g.blurb ? ` — ${esc(g.blurb)}` : ''}</span>`));
    for (const pl of g.list) rowOf(pl, panel);
    z.appendChild(panel); e.appendChild(z);
  }
  if (state.u.length) {   // 지도에서 찍은 내 장소
    const panel = $('details', 'group'); panel.open = true; panel.appendChild($('summary', null, `<b>내 장소</b> <span class="muted">${state.u.length}곳</span>`));
    state.u.forEach((u, i) => {
      const row = $('div', 'row place', `<b>${esc(u.name)}</b> <span class="muted">${esc(u.min)}분</span>`); row.dataset.name = u.name.toLowerCase();
      const del = $('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = () => setState({ u: state.u.filter((_, j) => j !== i), o: null });
      row.appendChild(del); panel.appendChild(row);
    });
    e.appendChild(panel);
  }
  pk.appendChild(e); side.appendChild(pk);
  applyFilter(pk);

  // 노선 — 날마다 하나
  const lines = $('div', 'v2lines');
  // 지도에 보일 날 — 여행 페이지와 같은 알약: 전체 또는 하루
  const shown = days.map((_, i) => i).filter(i => !hidden.has(i)), sel = shown.length === 1 && days.length > 1 ? shown[0] : null;
  if (days.length > 1) {
    const pick = d => { hidden.clear(); if (d !== null) activeDay = d; if (d !== null) days.forEach((_, i) => { if (i !== d) hidden.add(i); }); mapFitAsked = true; render(); };
    const chips = $('div', 'legpills');
    [null, ...days.keys()].forEach(d => { const b = $('button', 'btn sm' + (d === sel ? ' primary' : ''), d === null ? '전체' : `${d + 1}일차`); b.type = 'button'; b.onclick = () => pick(d); chips.appendChild(b); });
    side.appendChild(chips);
  }
  days.forEach((day, i) => {
    const col = `var(${DAY_COLORS[i] || '--d1'})`;
    const ln = $('section', 'line' + (i === activeDay && !a.auto ? ' active' : '') + (editing ? ' edit' : '')); ln.style.setProperty('--c', col);
    const hd = $('header');
    const span = day.stops.length ? `${hm(day.stops[0].arrive)}–${hm(day.end)} · 이동 ${day.moveMin}분${day.over ? ' · <b class="warn">시간 초과</b>' : ''}` : '비어 있어요';
    hd.innerHTML = `<b>${i + 1}일차</b><span>${span}</span>`;
    if (sel !== null && i !== sel) ln.style.opacity = '.45';
    if (editing) { const dc = $('details', 'daycfgbox'); dc.appendChild($('summary', null, '설정')); dc.appendChild(renderDayCfg(i)); hd.appendChild(dc); }
    if (editing && days.length > 1) { const x = $('button', 'x', '×'); x.type = 'button'; x.title = '이 날 빼기 — 장소는 앞날로 옮겨요'; x.onclick = () => { const o = makeManual(); while (o.length < days.length) o.push([]); const j = Math.max(0, i - 1); if (i === 0) o[1] = [...o[0], ...(o[1] || [])]; else o[j].push(...o[i]); o.splice(i, 1); activeDay = Math.min(activeDay, o.length - 1); setState({ d: Math.max(1, state.d - 1), o }); }; hd.appendChild(x); }
    ln.appendChild(hd);
    if (editing) {
      ln.ondragover = ev => { ev.preventDefault(); ln.classList.add('over'); }; ln.ondragleave = () => ln.classList.remove('over');
      ln.ondrop = ev => { ev.preventDefault(); ln.classList.remove('over'); const id = ev.dataTransfer.getData('text/place') || dragId; if (id) dropToDay(id, i); };
    }
    const ol = $('ol');
    let prevId = 'start';
    day.stops.forEach((st2, k) => {
      const pl = st2.place, key = `${prevId}>${pl.id}`; prevId = pl.id;
      const leg = $('li', 'leg');
      if (!editing) { leg.appendChild($('span', 'legtxt', `${MODE[st2.travelMode] || ''} ${st2.travelMin}분`)); ol.appendChild(leg); }
      else if (legCustom === key) {   // 분을 직접 적는 중
        const ni = $('input', 'text'); ni.type = 'number'; ni.min = 1; ni.max = 600; ni.value = typeof state.l[key] === 'number' ? state.l[key] : st2.travelMin; ni.style.cssText = 'width:72px;min-width:0;padding:2px 6px;font-size:13.5px';
        const ok = $('button', 'btn sm', '확인'); ok.type = 'button'; const no = $('button', 'btn sm', '취소'); no.type = 'button';
        const commit = () => { const n = parseInt(ni.value); if (!(n > 0)) { ni.focus(); return; } legCustom = null; setState({ l: { ...state.l, [key]: n } }); };
        ok.onclick = commit; no.onclick = () => { legCustom = null; render(); }; ni.onkeydown = e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { legCustom = null; render(); } };
        const w = $('span', 'legedit'); w.append(ni, $('span', 'muted', '분'), ok, no); leg.appendChild(w); ol.appendChild(leg);
        setTimeout(() => { ni.focus(); ni.select(); }, 30);
      }
      else {
      const ls = $('select', 'quiet'); ls.title = '이 구간 이동';
      for (const [v, label] of [['', `${MODE[st2.travelMode] || ''} ${st2.travelMin}분`], ['walk', '도보로'], ['metro', '지하철로'], ['taxi', '택시로'], ['custom', typeof state.l[key] === 'number' ? `직접 ${state.l[key]}분 · 바꾸기` : '분 직접 입력']]) { const o = $('option', null, label); o.value = v; o.selected = v === '' ? state.l[key] == null : (typeof state.l[key] === 'number' ? v === 'custom' : state.l[key] === v); ls.appendChild(o); }
      ls.onchange = () => { if (ls.value === 'custom') { legCustom = key; render(); return; } const l = { ...state.l }; if (ls.value) l[key] = ls.value; else delete l[key]; setState({ l }); };
      leg.appendChild(ls); ol.appendChild(leg);
      }
      const li = $('li', 'stn' + (st2.late ? ' late' : '')); li.draggable = editing;
      if (editing) {
        li.ondragstart = ev => { dragId = pl.id; ev.dataTransfer.setData('text/place', pl.id); ev.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); };
        li.ondragend = () => { li.classList.remove('dragging'); document.querySelectorAll('.line li.stn.before,.line li.stn.after,.line.over').forEach(x => x.classList.remove('before', 'after', 'over')); };
        // 끌고 지나갈 때 — 위 절반이면 앞에, 아래 절반이면 뒤에 들어간다는 표시
        const half = ev => ev.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2;
        li.ondragover = ev => { ev.preventDefault(); ev.stopPropagation(); ln.classList.remove('over'); const b = half(ev); li.classList.toggle('before', b); li.classList.toggle('after', !b); };
        li.ondragleave = () => li.classList.remove('before', 'after');
        li.ondrop = ev => {
          ev.preventDefault(); ev.stopPropagation(); const b = half(ev); li.classList.remove('before', 'after'); ln.classList.remove('over');
          const id = ev.dataTransfer.getData('text/place') || dragId; if (!id || id === pl.id) return;
          moveTo(id, i, pl.id, b);
        };
      }
      const who = curProject?.edits?.[pl.id]?.by;
      li.innerHTML = `<time>${hm(st2.arrive)}${st2.wait ? `<small title="${hm(st2.arrive - st2.wait)}에 닿아 기다려요">대기 ${st2.wait >= 60 ? `${Math.floor(st2.wait / 60)}시간${st2.wait % 60 ? ' ' + st2.wait % 60 + '분' : ''}` : st2.wait + '분'}</small>` : ''}${st2.late ? `<small class="warn" title="그 시각보다 ${st2.late}분 늦게 닿아요">${st2.late}분 늦음</small>` : ''}</time><i class="dot"></i>`;
      if (editing) { const g = $('span', 'grip', '⋮⋮'); g.title = '잡아 끌어 순서나 날을 바꿔요'; li.appendChild(g); }
      const body = $('div', 'body');
      body.appendChild($('div', 'nm', `${esc(pl.name)}${pl.must ? ' <span class="star" title="꼭 가기">★</span>' : ''}${who ? ` <span class="who">${esc(who)}</span>` : ''}`));
      const meta = $('div', 'meta');
      if (!editing) { const o = pl.opts[pl.opt]; meta.appendChild($('span', 'txt', `${esc(o?.label && o.label !== '머물기' ? o.label + ' · ' : '')}${o?.min ?? ''}분`)); body.appendChild(meta); li.appendChild(body); ol.appendChild(li); return; }
      if (!pl.user) { const sel = $('select', 'quiet'); pl.opts.forEach((o, j) => { const op = $('option', null, `${o.label} · ${o.min}분`); op.value = j; op.selected = pl.opt === j; sel.appendChild(op); }); sel.onchange = () => setState({ p: { ...state.p, [pl.id]: Number(sel.value) } }); meta.appendChild(sel); }
      else meta.appendChild($('span', null, `${esc(pl.opts[0].min)}분`));
      const star = $('button', 'ic', pl.must ? '★' : '☆'); star.type = 'button'; star.title = pl.must ? '꼭 가기 해제' : '꼭 가기 — 시간이 모자라도 안 빠져요'; if (!pl.user) star.onclick = () => setState({ m: pl.must ? state.m.filter(x => x !== pl.id) : [...state.m, pl.id] });
      const rm = $('button', 'ic', '×'); rm.type = 'button'; rm.title = '빼기'; rm.onclick = () => pl.user ? setState({ u: state.u.filter((_, j) => `u${j}` !== pl.id), o: null }) : togglePlace(pl.id);
      // 이 시각부터 — 노을·야경처럼 시간대가 있는 곳. 정하면 자동 순서도 그 시각에 맞춰 끼운다
      const atv = state.at?.[pl.id];
      if (atEdit === pl.id) {
        const ti = $('input', 'text'); ti.type = 'time'; ti.step = 900; ti.value = hm(atv ?? Math.max(st2.arrive, 0)).padStart(5, '0'); ti.style.cssText = 'width:auto;min-width:0;padding:1px 6px;font-size:13.5px';
        const ok = $('button', 'btn sm', '확인'); ok.type = 'button'; const no = $('button', 'btn sm', '취소'); no.type = 'button';
        const commit = () => { const [h, m] = ti.value.split(':').map(Number); if (!Number.isInteger(h)) return; atEdit = null; setState({ at: { ...state.at, [pl.id]: h * 60 + (m || 0) } }); };
        ok.onclick = commit; no.onclick = () => { atEdit = null; render(); }; ti.onkeydown = e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { atEdit = null; render(); } };
        const w = $('span', 'atedit'); w.append($('span', 'muted', '부터'), ti, ok, no);
        if (atv != null) { const cl = $('button', 'btn sm', '지우기'); cl.type = 'button'; cl.onclick = () => { const a2 = { ...state.at }; delete a2[pl.id]; atEdit = null; setState({ at: a2 }); }; w.appendChild(cl); }
        meta.appendChild(w);
        setTimeout(() => ti.focus(), 30);
      } else {
        const at = $('button', 'ic at' + (atv != null ? ' on' : ''), atv != null ? `🕓 ${hm(atv)}부터` : '🕓'); at.type = 'button'; at.title = atv != null ? '이 시각부터 — 누르면 바꿔요' : '이 시각부터 가기 (노을·야경·예약)'; at.onclick = () => { atEdit = pl.id; render(); };
        meta.appendChild(at);
      }
      // 옮기기 — 끌기 대신(휴대폰·키보드). 위로·아래로·다른 날로
      const mv = $('select', 'quiet mv'); mv.title = '옮기기';
      const opts = [['', '옮기기']]; if (k > 0) opts.push(['up', '↑ 위로']); if (k < day.stops.length - 1) opts.push(['down', '↓ 아래로']);
      days.forEach((_, j) => { if (j !== i) opts.push([`d${j}`, `${j + 1}일차로`]); });
      for (const [v, label] of opts) { const o = $('option', null, label); o.value = v; mv.appendChild(o); }
      mv.onchange = () => {
        const v = mv.value; if (!v) return;
        if (v === 'up') moveTo(pl.id, i, day.stops[k - 1].place.id, true);
        else if (v === 'down') moveTo(pl.id, i, day.stops[k + 1].place.id, false);
        else dropToDay(pl.id, Number(v.slice(1)));
      };
      meta.append(star, rm, mv); body.appendChild(meta); li.appendChild(body); ol.appendChild(li);
    });
    ln.appendChild(ol);
    if (editing) {
      const ad = $('button', 'addhere', i === activeDay && !a.auto ? '+ 여기에 추가 중 — 검색하거나 아래에서 고르세요' : '+ 이 날에 추가'); ad.type = 'button';
      ad.onclick = () => { activeDay = i; setState({ o: makeManual() }); setTimeout(() => document.querySelector('.v2add .search input')?.focus(), 50); };
      ln.appendChild(ad);
    }
    lines.appendChild(ln);
  });
  if (state.d < 10) { const ad = $('button', 'addday', '+ 하루 추가'); ad.type = 'button'; ad.onclick = () => setState({ d: state.d + 1, o: state.o ? [...state.o.map(d => [...d]), []] : null }); lines.appendChild(ad); }
  if (a.auto && places.length && editing) lines.appendChild($('p', 'muted', '지금은 자동으로 나눴어요. ⋮⋮를 잡아 끌면 같은 날 안에서 순서를 바꾸거나 다른 날로 옮길 수 있고, 🕓로 「이 시각부터」(노을·야경)를 정하면 그 시각에 맞춰 끼워요.'));
  // 비거나 두 시간이 안 되는 날이 있으면 — 장소가 일수에 비해 적다는 뜻
  if (places.length && days.length > 1 && days.some(d => !d.stops.length || d.end - d.stops[0].arrive < 120)) lines.appendChild($('p', 'muted', '비거나 짧은 날이 있어요. 장소를 더 담거나 「균등」으로 나누거나, 날 머리의 ×로 하루를 빼면 알차져요.'));
  if (result.dropped?.length) lines.appendChild($('p', 'warnline', `시간이 모자라 뺀 곳: ${result.dropped.map(x => esc(x.place.name)).join(', ')} — ☆를 ★로 바꾸면 꼭 넣어요.`));
  side.appendChild(lines);

  // 추천 — 접어 둔다 (비었을 땐 펼침)

  // 지도 — 노선색 선 + 역 번호·이름표, 안 고른 곳은 흐린 점(누르면 추가)
  const chosen = new Set(places.map(p => p.id));
  if (city.areas) drawAreas(places.length ? 0.3 : 0.55);   // 어디가 어디인지 — 구역 테두리와 이름, 고른 뒤엔 흐리게 (고칠 것 11-08)
  for (const pl of city.places) if (!chosen.has(pl.id)) map.html('places', pl, `<div class="mk${pl.weight === 1 ? ' w1' : ''}"><i></i>${pl.weight === 1 ? `<span>${esc(pl.name)}</span>` : ''}</div>`, { title: pl.name + ' — 눌러서 추가', onClick: () => togglePlace(pl.id) });
  const bounds = [[start.lat, start.lng]];
  days.forEach((day, i) => {
    if (!day.stops.length || hidden.has(i)) return;
    const col = getComputedStyle(document.body).getPropertyValue(DAY_COLORS[i]).trim() || '#1F4FA8';
    const s0 = perDay()[i]?.start || start;
    map.line('route', [[s0.lat, s0.lng], ...day.stops.map(x => [x.place.lat, x.place.lng])], { color: col, weight: 4, opacity: 0.85 });
    day.stops.forEach((x, k) => { map.html('route', x.place, `<div class="st" style="--c:${col}"><i>${k + 1}</i><span>${esc(x.place.name)}</span></div>`, { title: `${hm(x.arrive)} ${x.place.name}` }); bounds.push([x.place.lat, x.place.lng]); });
  });
  // 처음 열 때 — 고른 곳이 없으면 도심 20km 안의 장소에 맞춘다. 세부처럼 당일 여행지가 100km 밖에 있는 도시는 전부 넣으면 섬 전체가 잡혀 도심이 점이 된다
  if (entering || mapFitAsked) {
    mapFitAsked = false;
    const c = { lat: city.center[0], lng: city.center[1] }, core = city.places.filter(p => distanceKm(c, p) <= 20);
    lastFit = bounds.length > 1 ? bounds : (core.length >= 3 ? core : city.places).map(p => [p.lat, p.lng]);
    map.fitBounds(lastFit, 40);
  }
  if (sunOpen) mountSun(result.days.length ? result : { days }, start);
  if (pin) map.circle('places', pin, { radius: 9, color: '#1f4fa8', weight: 2.5, fillColor: '#fff', dashed: true, title: '찍은 자리' });
  bindMapClick(e => { pin = { lat: e.latlng.lat, lng: e.latlng.lng }; render(); setTimeout(() => document.querySelector('.pincard input.text')?.focus(), 50); });
}

// 지도에서 찍은 자리 — 이름 · 용도(머무는 시간) · 어느 날 → 담기. 옛날엔 브라우저 창 두 개로 물었다
function renderPin() {
  const a = assignment();
  const card = $('div', 'result pincard');
  card.appendChild($('div', null, `<b>지도에서 찍은 자리</b> <span class="muted">${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}</span>`));
  const r = $('div', 'row');
  const nm = $('input', 'text'); nm.type = 'text'; nm.placeholder = '이 자리 이름 (예: 숙소 근처 카페)'; nm.maxLength = 40;
  let dayVal = String(Math.min(activeDay, a.days.length - 1));
  const daySel = dayPicker(a.days.length, dayVal, v => { dayVal = v; });
  const useSel = $('select', 'quiet'); useSel.title = '용도'; for (const [v, l, m] of USES) { const o = $('option', null, `${l} · ${m}분`); o.value = v; useSel.appendChild(o); }
  const add = $('button', 'btn sm primary', '담기'); add.type = 'button'; const no = $('button', 'btn sm', '취소'); no.type = 'button';
  const go = () => { const name = nm.value.trim().replace(/[~|]/g, ' '); if (!name) { nm.focus(); return; } const min = USES.find(x => x[0] === useSel.value)[2]; const at = pin; pin = null; addUserPlace({ name, lat: at.lat, lng: at.lng, min }, Number(dayVal)); };
  add.onclick = go; no.onclick = () => { pin = null; render(); }; nm.onkeydown = e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { pin = null; render(); } };
  r.append(nm, daySel, useSel, add, no); card.appendChild(r);
  card.appendChild($('p', 'muted', '다른 자리를 찍으면 핀이 옮겨 가요.'));
  return card;
}

// 구역 테두리 — 그 구역 장소들의 볼록 껍질을 점선으로, 가운데 이름표. 장소가 둘 이하면 이름표만
function hull(pts) {
  const P = [...pts].sort((a, b) => a[1] - b[1] || a[0] - b[0]);   // [lat,lng] → lng 기준 정렬
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower = []; for (const p of P) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  const upper = []; for (const p of [...P].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function drawAreas(opacity = 0.55) {
  const css = getComputedStyle(document.body);
  city.areas.forEach((ar, i) => {
    const pts = city.places.filter(p => p.area === ar.id).map(p => [p.lat, p.lng]); if (!pts.length) return;
    const col = css.getPropertyValue(DAY_COLORS[i] || '--d1').trim() || '#1F4FA8';
    const h = hull(pts);
    if (h.length >= 3) {   // 살짝 부풀린 테두리 — 점이 선 위에 딱 붙지 않게
      const c = [h.reduce((s, p) => s + p[0], 0) / h.length, h.reduce((s, p) => s + p[1], 0) / h.length];
      const ring = h.map(p => [c[0] + (p[0] - c[0]) * 1.25, c[1] + (p[1] - c[1]) * 1.25]);
      map.line('places', [...ring, ring[0]], { color: col, weight: 2, opacity });
    }
    const top = pts.reduce((m, p) => p[0] > m[0] ? p : m, pts[0]);
    map.html('places', { lat: top[0] + 0.006, lng: pts.reduce((s, p) => s + p[1], 0) / pts.length }, `<div class="zone" style="--c:${col}">${esc(ar.name)} <span>${pts.length}곳</span></div>`);
  });
}

function renderSearch() {
  const p = $('div', 'search');
  const row = $('div', 'row');
  const inp = $('input', 'text'); inp.type = 'search'; inp.placeholder = '장소 검색 (예: 마젤란, Ayala)'; inp.value = query;
  inp.oninput = () => { query = inp.value; applyFilter(document.getElementById('side')); };
  const go = $('button', 'btn', '지도에서 찾기'); go.type = 'button';
  const run = async () => {
    const q = inp.value.trim(); if (!q) return;
    query = q; searching = true; searchErr = ''; results = null; render();
    try { results = await search(q, city.center, INDEX.cities[state.c]?.bbox); } catch (e) { searchErr = '검색 서버에 닿지 못했어요. 잠시 뒤 다시 해 주세요.'; }
    searching = false; render();
  };
  go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
  row.append(inp, go); p.appendChild(row);
  // 검색 범위 — 자리표시에 길게 넣었더니 칸 폭에서 잘렸다(11-08). 칸 아래 한 줄로
  if (!results && !searching && !searchErr) p.appendChild($('p', 'muted hint', '글자를 치면 아래 담기 목록을 거르고, Enter는 지도(OpenStreetMap·위키데이터)에서 찾아요. 가게·카페는 잘 안 나올 수 있어요.'));
  if (searching) p.appendChild($('p', 'muted', '찾는 중…'));
  if (searchErr) p.appendChild($('p', null, `<b style="color:var(--warn)">${esc(searchErr)}</b>`));
  if (results) {
    if (!results.length) p.appendChild($('p', 'muted', `「${esc(query)}」 — 이 도시 안에서 못 찾았어요. 철자를 바꾸거나 지도의 빈 곳을 직접 눌러 보세요.`));
    const a = assignment();
    for (const c of results) {
      const card = $('div', 'result');
      card.appendChild($('div', null, `<b>${esc(c.name)}</b> <span class="muted">${esc(c.detail)}</span>`));
      const r = $('div', 'row');
      let dayVal = String(Math.min(activeDay, a.days.length - 1));   // 항상 어느 날인가를 고른다
      const daySel = dayPicker(a.days.length, dayVal, v => { dayVal = v; });
      const useSel = $('select', 'quiet'); useSel.title = '용도';
      const isStation = /역|station|駅|정류장|bus stop|terminal|공항|airport/i.test(c.name + ' ' + c.type);
      for (const [v, l, m] of USES) { const o = $('option', null, `${l} · ${m}분`); o.value = v; o.selected = isStation ? v === 'via' : v === 'see'; useSel.appendChild(o); }
      const add = $('button', 'btn sm primary', '담기'); add.type = 'button';
      add.onclick = () => { const min = USES.find(x => x[0] === useSel.value)[2]; results = null; query = ''; addUserPlace({ name: c.name.slice(0, 40), lat: c.lat, lng: c.lng, min }, Number(dayVal)); };
      const asStart = $('button', 'btn sm', '출발점으로'); asStart.type = 'button'; asStart.title = '숙소·역처럼 하루를 시작하는 곳이면';
      asStart.onclick = () => { results = null; query = ''; setDay(Number(dayVal), { s: { lat: c.lat, lng: c.lng } }); };
      r.append(daySel, useSel, add, asStart); card.appendChild(r); p.appendChild(card);
      map.circle('places', c, { radius: 7, color: '#22201c', weight: 2, fillColor: '#fff', dashed: true, title: c.name + ' (검색 결과)' });
    }
  }
  return p;
}
const hidden = new Set();   // 숨긴 날 인덱스 (화면 상태, 해시에 안 넣는다)


// 제목 클릭 = 홈(플랜 탭). 고른 장소·열어 둔 여행은 그대로 둔다
document.getElementById('home')?.addEventListener('click', e => { e.preventDefault(); setState({ tab: 'home', pr: null }); });
window.addEventListener('hashchange', () => { state = decode(location.hash); render(); });
// 창 크기가 바뀌면 — 캔버스만 늘지 않고 지금 노선에 다시 맞춘다 (플랜 화면만)
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { map.resize(); if (state.tab === 'plan' && lastFit?.length) map.fitBounds(lastFit, 40); }, 250); });
window.addEventListener('popstate', () => { const h = decode(location.hash); if (encode(h) !== encode(state)) { state = h; render(); } });   // 뒤로·앞으로
// 스타일·폰트까지 다 잡힌 뒤 지도 뷰를 한 번 더 맞춘다 — 지도가 있는 화면에서만. 다른 화면까지 통째로 다시 그리면 그 순간 누른 단추(예: 내 여행의 「시작」)가 갈아끼워진 옛 DOM이라 클릭이 허공으로 갔다
window.addEventListener('load', () => { if (state.tab === 'plan' || (state.tab === 'mine' && state.pr)) { lastStep = 0; render(); } else map.resize(); });
render();

// 어디서든 처리 못 한 오류 — 조용히 멈추지 않고 아래에 알린다
function oops(e) {
  const m = e?.reason?.message || e?.message || String(e?.reason || e || ''); if (!m || /ResizeObserver/.test(m)) return;
  let bar = document.getElementById('oops');
  if (!bar) { bar = $('div', 'oops'); bar.id = 'oops'; bar.setAttribute('role', 'alert'); document.body.appendChild(bar); }
  bar.innerHTML = `<span>문제가 생겼어요 — ${esc(m.slice(0, 140))}</span><button class="btn sm" type="button">새로고침</button><button class="btn sm" type="button" aria-label="닫기">×</button>`;
  const [re, x] = bar.querySelectorAll('button'); re.onclick = () => location.reload(); x.onclick = () => bar.remove();
}
window.addEventListener('error', oops);
window.addEventListener('unhandledrejection', oops);
