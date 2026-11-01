// 「내 여행」 탭 — 로그인 · 여행 목록 · 여행 하나(플랜 저장, 살 것, 사진). 저장은 ctx.store 인터페이스만 쓴다.
import { esc } from './html.js';
import { decode, encode, DEFAULTS, legsOf } from './state.js';
import { parseVisits, buildTrips } from './timeline.js';

// 크게 보기 — 화면 덮는 한 장
function lightbox(src, caption) {
  const o = document.createElement('div'); o.className = 'lightbox';
  o.innerHTML = `<img src="${src}" alt=""><p>${caption.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>`;
  o.onclick = () => o.remove(); document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { o.remove(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(o);
}
// 좌표 → 장소 이름 (OpenStreetMap). 못 찾으면 빈 값
async function reverseName({ lat, lng }) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ko&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
    const j = await r.json(); const a = j.address || {};
    return (j.name || a.tourism || a.amenity || a.shop || a.attraction || a.building || a.road || a.suburb || a.village || a.town || a.city || '').trim();
  } catch { return ''; }
}
const fmtDate = t => new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });

// 파일 → 작은 JPEG data URL (긴 변 1200px). 브라우저 저장소 한도(≈5MB) 안에서 여러 장을 담으려고 줄인다.
async function shrink(file, max = 1200) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}
async function gpsOf(file) {
  try { const g = await window.exifr?.gps?.(file); return g && Number.isFinite(g.latitude) ? { lat: g.latitude, lng: g.longitude } : null; }
  catch { return null; }
}

const tripLeg = new Map();   // 여행 페이지에서 보고 있는 구간 (여행 id → 번호)
const tlImport = { busy: false, text: '', el: null };   // 타임라인 가져오기 진행 — render를 넘어 산다

export async function renderMine(ctx) {
  const { state, user, project } = ctx;
  if (!user && state.pr && project) return renderProject(ctx);   // 공개·링크 플랜은 로그인 없이 읽는다
  if (!user) return renderLogin(ctx);
  if (ctx.accountOpen && !state.pr) return renderAccount(ctx);
  if (!state.pr || !project) return renderList(ctx);
  return renderProject(ctx);
}

// 공유 패널 — 주인: 범위·초대·멤버 / 멤버: 나가기
async function renderShare(ctx) {
  const { $, store, project: p, isOwner, user, render, setState } = ctx;
  const box = $('div', 'panel'); box.appendChild($('h2', null, '공유'));
  const note = (el, msg, warn) => { el.innerHTML = msg ? `<b style="color:${warn ? 'var(--warn)' : 'var(--d1)'}">${esc(msg)}</b>` : ''; };
  if (store.kind !== 'supabase') { box.appendChild($('p', 'muted', '브라우저 저장에선 공유가 안 된다 — 로그인하면 된다.')); return box; }
  const vis = p.visibility || 'private';
  if (isOwner) {
    const r = $('div', 'row regions'); r.appendChild($('span', 'muted', '범위'));
    for (const [v, label, hint] of [['private', '비공개', '나만'], ['link', '링크 초대', '초대 링크를 받은 사람만'], ['public', '공개', '누구나 보고 복사']]) {
      const b = $('button', 'btn sm' + (vis === v ? ' primary' : ''), label); b.type = 'button'; b.title = hint;
      b.onclick = async () => { try { await store.updateProject(p.id, { visibility: v }); render(); } catch (e) { alert(`서버 준비 전 — docs/sharing.sql 을 돌려야 한다 (${e.message || e})`); } };
      r.appendChild(b);
    }
    box.appendChild(r);
    box.appendChild($('p', 'muted', vis === 'private' ? '지금은 나만 본다.' : vis === 'link' ? '초대 링크를 받은 사람만 본다. 편집 링크면 같이 고친다.' : '누구나 보고 「내 걸로 복사」할 수 있다. 홈 「다른 사람의 플랜」에 뜬다.'));
    if (vis !== 'private') {
      const ir = $('div', 'row'); const msg = $('span', null, '');
      for (const [role, label] of [['editor', '편집 링크 만들기'], ['viewer', '보기 링크 만들기']]) {
        const b = $('button', 'btn sm', label); b.type = 'button';
        b.onclick = async () => { try { const t = await store.createInvite(p.id, role); const url = location.href.split('#')[0] + `#join=${t}`; try { await navigator.clipboard.writeText(url); note(msg, '링크를 복사했다 — 같이 갈 사람에게 보내라'); } catch { prompt('이 링크를 보내라', url); } } catch (e) { note(msg, e.message || e, true); } };
        ir.appendChild(b);
      }
      ir.appendChild(msg); box.appendChild(ir);
      if (vis === 'public') { const pr = $('div', 'row'); const pb = $('button', 'btn sm', '공개 링크 복사'); pb.type = 'button'; const pm = $('span', null, ''); pb.onclick = async () => { const url = location.href.split('#')[0] + `#pr=${p.id}&tab=mine`; try { await navigator.clipboard.writeText(url); note(pm, '복사했다'); } catch { prompt('공개 링크', url); } }; pr.append(pb, pm); box.appendChild(pr); }
    }
    let members = []; try { members = await store.listMembers(p.id); } catch {}
    if (members.length) {
      box.appendChild($('p', null, `<b>같이 보는 사람</b> <span class="muted">${members.length}</span>`));
      for (const m of members) {
        const r2 = $('div', 'row'); r2.appendChild($('span', null, `${esc(m.name)} <span class="muted">· ${m.role === 'editor' ? '편집' : '보기'}</span>`));
        const x = $('button', 'btn sm', '내보내기'); x.type = 'button'; x.onclick = async () => { if (!confirm(`${m.name}을 빼면 더는 못 본다. 뺄까?`)) return; await store.removeMember(p.id, m.userId); render(); };
        r2.appendChild(x); box.appendChild(r2);
      }
    }
  } else if (user) {
    box.appendChild($('p', null, p.shared ? `<b>${esc(p.lastEditedBy || '주인')}</b>이 공유한 여행 · 나는 <b>${p.role === 'editor' ? '편집' : '보기'}</b> 권한` : '공개 플랜 — 복사해서 내 걸로 만들 수 있다.'));
    const r = $('div', 'row');
    const copy = $('button', 'btn primary', '내 걸로 복사'); copy.type = 'button';
    copy.onclick = async () => { const n = await store.createProject({ name: `${p.name} (복사)`, city: p.city, hash: p.hash }); setState({ pr: n.id }); };
    r.appendChild(copy);
    if (p.shared) { const lv = $('button', 'btn sm', '나가기'); lv.type = 'button'; lv.onclick = async () => { if (!confirm('이 여행에서 나갈까?')) return; await store.removeMember(p.id, user.id); setState({ pr: null }); }; r.appendChild(lv); }
    box.appendChild(r);
  } else {
    box.appendChild($('p', null, '공개 플랜이다. 로그인하면 「내 걸로 복사」할 수 있다.'));
    const b = $('button', 'btn', '로그인'); b.type = 'button'; b.onclick = () => setState({ pr: null }); box.appendChild(b);
  }
  return box;
}

// 내 계정 — 프로필 · 비밀번호 · 기본 설정 · 내 데이터 · 로그아웃
function renderAccount({ $, side, store, user, projects, setState, render, closeAccount, CITIES, state }) {
  const photos = projects.reduce((n, x) => n + x.photos.length, 0);
  const note = (el, msg, warn) => { el.innerHTML = msg ? `<b style="color:${warn ? 'var(--warn)' : 'var(--d1)'}">${esc(msg)}</b>` : ''; };

  // 1. 요약
  const head = $('div', 'panel');
  head.appendChild($('h2', null, '내 계정'));
  head.appendChild($('p', 'meta', `${esc(user.email || '이 브라우저에만 저장되는 계정')} · 여행 ${projects.length}개 · 사진 ${photos}장`));
  head.appendChild($('p', null, store.kind === 'supabase' ? '계정 서버에 저장 — 어느 기기에서든 같은 걸 본다.' : '이 브라우저에만 저장 — 기기를 바꾸면 안 보인다.'));
  const last = projects.find(x => x.id === user.prefs?.lastPr);
  if (last) { const lr = $('div', 'row'); lr.appendChild($('span', null, `최근 여행 <b>${esc(last.name)}</b>`)); const lb = $('button', 'btn sm', '열기'); lb.type = 'button'; lb.onclick = () => { closeAccount(); setState({ pr: last.id }); }; lr.appendChild(lb); head.appendChild(lr); }
  const r0 = $('div', 'row');
  const list = $('button', 'btn primary', '내 여행 목록'); list.type = 'button'; list.onclick = () => { closeAccount(); render(); };
  const out = $('button', 'btn', '로그아웃'); out.type = 'button';
  out.onclick = async () => { if (!confirm('로그아웃할까? 다시 들어오려면 비밀번호나 메일 링크가 필요하다.')) return; await store.signOut(); closeAccount(); setState({ pr: null }); };
  r0.append(list, out); head.appendChild(r0); side.appendChild(head);

  // 2. 프로필 — 표시 이름
  const prof = $('div', 'panel'); prof.appendChild($('h2', null, '이름'));
  prof.appendChild($('p', null, '머리글과 여행 목록에 보이는 이름.'));
  const r1 = $('div', 'row');
  const nm = $('input', 'text'); nm.type = 'text'; nm.value = user.name; nm.maxLength = 40;
  const nmGo = $('button', 'btn sm', '바꾸기'); nmGo.type = 'button'; const nmMsg = $('span', null, '');
  nmGo.onclick = async () => { try { await store.updateUser({ name: nm.value }); note(nmMsg, '바꿨다'); setTimeout(render, 500); } catch (e) { note(nmMsg, e.message || e, true); } };
  r1.append(nm, nmGo, nmMsg); prof.appendChild(r1); side.appendChild(prof);

  // 3. 비밀번호 (계정 서버일 때만)
  if (user.canPassword) {
    const pwp = $('div', 'panel'); pwp.appendChild($('h2', null, '비밀번호'));
    pwp.appendChild($('p', null, '8자 이상. 바꿔도 지금 로그인은 유지된다.'));
    const p1 = $('input', 'text'); p1.type = 'password'; p1.placeholder = '새 비밀번호'; p1.autocomplete = 'new-password'; p1.style.width = '100%';
    const p2 = $('input', 'text'); p2.type = 'password'; p2.placeholder = '한 번 더'; p2.autocomplete = 'new-password'; p2.style.width = '100%';
    const r2 = $('div', 'row'); const pwGo = $('button', 'btn sm', '바꾸기'); pwGo.type = 'button'; const pwMsg = $('span', null, '');
    pwGo.onclick = async () => {
      if (p1.value.length < 8) return note(pwMsg, '8자 이상', true); if (p1.value !== p2.value) return note(pwMsg, '두 칸이 다르다', true);
      try { await store.updateUser({ password: p1.value }); p1.value = p2.value = ''; note(pwMsg, '바꿨다'); } catch (e) { note(pwMsg, e.message || e, true); }
    };
    r2.append(pwGo, pwMsg); pwp.append(p1, p2, r2); side.appendChild(pwp);
  }

  // 4. 기본 설정 — 언어·새 플랜 기본값
  const prefs = user.prefs || {};
  const pp = $('div', 'panel'); pp.appendChild($('h2', null, '기본 설정'));
  const rl = $('div', 'row'); rl.appendChild($('span', 'muted', '언어'));
  for (const [v, label, ready] of [['ko', '한국어', true], ['en', 'English', false], ['ja', '日本語', false]]) {
    const b = $('button', 'btn' + ((prefs.lang || 'ko') === v ? ' primary' : ''), label + (ready ? '' : ' · 준비 중')); b.type = 'button'; b.disabled = !ready;
    b.onclick = async () => { await store.updateUser({ prefs: { lang: v } }); render(); }; rl.appendChild(b);
  }
  pp.appendChild(rl);
  pp.appendChild($('p', 'muted', '장소 설명·팁은 한국어로 쓰여 있어 화면 글자만 바꿔서는 반쪽이 된다 — 영어는 데이터 번역과 같이 연다.'));
  pp.appendChild($('p', null, '아래 값으로 「기본값으로 새 플랜」이 시작한다.'));
  const r3 = $('div', 'row'); r3.appendChild($('span', 'muted', '도시'));
  const csel = $('select'); for (const [id, name] of Object.entries(CITIES)) { const o = $('option', null, esc(name)); o.value = id; o.selected = (prefs.c || 'london') === id; csel.appendChild(o); }
  csel.onchange = async () => { await store.updateUser({ prefs: { c: csel.value } }); render(); }; r3.appendChild(csel);
  const r4 = $('div', 'row'); r4.appendChild($('span', 'muted', '기본 이동'));
  for (const [v, label] of [['transit', '걷기 + 지하철'], ['taxi', '택시 위주']]) { const b = $('button', 'btn' + ((prefs.v || 'transit') === v ? ' primary' : ''), label); b.type = 'button'; b.onclick = async () => { await store.updateUser({ prefs: { v } }); render(); }; r4.appendChild(b); }
  const r5 = $('div', 'row'); r5.appendChild($('span', 'muted', '하루'));
  const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const t = prefs.t ?? 570, e = prefs.e ?? 1140;
  const mk = (val, lo, hi, key, other) => { const w = $('span', 'stepper'); const a = $('button', null, '−'); a.type = 'button'; const v = $('span', 'val', hm(val)); const b = $('button', null, '+'); b.type = 'button';
    const set = async d => { const n = Math.max(lo, Math.min(hi, val + d * 30)); if (key === 't' && n >= other - 60) return; if (key === 'e' && n <= other + 60) return; await store.updateUser({ prefs: { [key]: n } }); render(); };
    a.onclick = () => set(-1); b.onclick = () => set(1); w.append(a, v, b); return w; };
  r5.append(mk(t, 0, 1380, 't', e), $('span', 'muted', '부터'), mk(e, 60, 1440, 'e', t), $('span', 'muted', '까지'));
  pp.append(r3, r4, r5);
  const r6 = $('div', 'row'); const useBtn = $('button', 'btn', '기본값으로 새 플랜'); useBtn.type = 'button';
  useBtn.onclick = () => { closeAccount(); setState({ c: prefs.c || 'london', v: prefs.v || 'transit', t, e, d: 3, p: {}, m: [], u: [], s: null, l: {}, o: null, pr: null, tab: 'plan' }); };
  r6.appendChild(useBtn); pp.appendChild(r6); side.appendChild(pp);

  // 5. 내 데이터 — 내보내기 (사진은 메타데이터만)
  const dp = $('div', 'panel'); dp.appendChild($('h2', null, '내 데이터'));
  dp.appendChild($('p', null, '여행·플랜·살 것·사진 정보(좌표·장소·메모)를 JSON 한 파일로 받는다. 사진 원본은 들어가지 않는다.'));
  const r7 = $('div', 'row'); const ex = $('button', 'btn', 'JSON으로 내보내기'); ex.type = 'button'; const exMsg = $('span', null, '');
  ex.onclick = async () => {
    try {
      const full = []; for (const p of projects) { const d = await store.getProject(p.id); full.push({ ...d, photos: d.photos.map(({ dataUrl, url, ...m }) => m) }); }
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), user: { name: user.name, email: user.email || null }, projects: full }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `algotrip-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      note(exMsg, `${full.length}개 여행`);
    } catch (e) { note(exMsg, e.message || e, true); }
  };
  r7.append(ex, exMsg); dp.appendChild(r7);
  dp.appendChild($('p', 'muted', '계정 삭제는 아직 없다 — 필요하면 말해라(서버 쪽 함수가 하나 필요하다).'));
  side.appendChild(dp);
}

let mailSent = '';
function renderLogin({ $, side, store, render, state: ctxState, joinPending }) {
  const p = $('div', 'panel');
  p.appendChild($('h2', null, '내 여행'));
  if (store.kind === 'supabase') {
    p.appendChild($('p', null, '여행별로 플랜·살 것·사진을 모아 둔다. 로그인하면 어느 기기에서든 같은 여행이 열린다.'));
    if (Object.keys(ctxState.p).length) p.appendChild($('p', null, '<b>지금 만든 플랜은 그대로 있다</b> — 로그인한 뒤 플랜 탭의 「저장」을 누르면 내 여행에 남는다.'));
    if (joinPending) p.appendChild($('p', null, '<b>초대받은 여행이 있다</b> — 로그인하면 바로 열린다.'));
    if (mailSent) { p.appendChild($('p', null, `<b>${esc(mailSent)}</b> 로 로그인 링크를 보냈다. 메일의 링크를 누르면 여기로 돌아온다(스팸함도 확인).`)); side.appendChild(p); return; }
    const inp = $('input', 'text'); inp.type = 'email'; inp.placeholder = '이메일'; inp.autocomplete = 'email'; inp.style.width = '100%';
    const pw = $('input', 'text'); pw.type = 'password'; pw.placeholder = '비밀번호 (있으면)'; pw.autocomplete = 'current-password'; pw.style.width = '100%';
    const row = $('div', 'row');
    const go = $('button', 'btn primary', '로그인'); go.type = 'button';
    const link = $('button', 'btn', '메일로 링크 받기'); link.type = 'button';
    const err = $('p', null, '');
    const fail = (m, b, label) => { err.innerHTML = `<b style="color:var(--warn)">${esc(m)}</b>`; b.disabled = false; b.textContent = label; };
    const email = () => { const v = inp.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { inp.focus(); return null; } return v; };
    go.onclick = async () => {
      const e = email(); if (!e) return; if (!pw.value) { pw.focus(); return; }
      go.disabled = true; go.textContent = '확인 중…';
      try { await store.signIn({ email: e, password: pw.value }); render(); }
      catch (x) { fail(`로그인 실패 — ${x.message || x}`, go, '로그인'); }
    };
    link.onclick = async () => {
      const e = email(); if (!e) return;
      link.disabled = true; link.textContent = '보내는 중…';
      try { await store.signIn({ email: e }); mailSent = e; render(); }
      catch (x) { fail(`못 보냈다 — ${x.message || x}`, link, '메일로 링크 받기'); }
    };
    pw.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    row.append(go, link); p.append(inp, pw, row, err);
    p.appendChild($('p', 'muted', '비밀번호가 없으면 「메일로 링크 받기」 — 메일의 링크 한 번이 로그인이다(시간당 2통 한도).'));
  } else {
    p.appendChild($('p', null, '여행별로 플랜·살 것·사진을 모아 둔다. 지금은 <b>이 브라우저 안에만</b> 저장된다(기기를 바꾸면 안 보인다).'));
    const row = $('div', 'row');
    const inp = $('input', 'text'); inp.type = 'text'; inp.placeholder = '이름'; inp.maxLength = 40;
    const go = $('button', 'btn primary', '시작'); go.type = 'button';
    const run = async () => { if (!inp.value.trim()) { inp.focus(); return; } await store.signIn({ name: inp.value }); render(); };
    go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') run(); };
    row.append(inp, go); p.appendChild(row);
  }
  side.appendChild(p);
}

function renderList(ctx) {
  const { state, setState, $, side, store, user, projects, CITIES, render } = ctx;
  const head = $('div', 'panel');
  head.appendChild($('h2', null, `${esc(user.name)}의 여행`));
  const row = $('div', 'row');
  const nw = $('button', 'btn primary', '지금 플랜으로 새 여행'); nw.type = 'button';
  nw.onclick = async () => {
    const name = prompt('여행 이름', `${CITIES[state.c]} ${state.d}일`); if (!name) return;
    const p = await store.createProject({ name, city: state.c, hash: planHash(state) });
    setState({ pr: p.id });
  };
  // 구글 지도 타임라인 → 실제로 다닌 여행. 파일은 이 브라우저 안에서만 읽는다
  const tl = $('button', 'btn', '구글 타임라인 가져오기'); tl.type = 'button';
  const file = $('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.id = 'timeline-file';
  // 진행 글자는 화면 밖에 둔다 — 파일 창에서 돌아오면 로그인 확인이 화면을 다시 그려, 옛 글자 칸에 쓰면 안 보였다
  const msg = $('p', 'muted', esc(tlImport.text)); tlImport.el = msg; tl.disabled = tlImport.busy;
  const say = t => { tlImport.text = t; if (tlImport.el) tlImport.el.textContent = t; };
  tl.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f || tlImport.busy) return;
    try {
      tlImport.busy = tl.disabled = true; say('타임라인을 읽고 있어요…');
      const visits = parseVisits(JSON.parse(await f.text()));
      const idx = ctx.INDEX; const cityData = {};
      for (const id of Object.keys(idx.cities)) { try { cityData[id] = await ctx.loadCity(id); } catch {} }
      const trips = buildTrips(visits, idx, cityData);
      if (!trips.length) { tlImport.busy = false; say('지원하는 도시(런던·파리·도쿄·오사카·교토·로마·바르셀로나)에 머문 기록을 못 찾았어요.'); render(); return; }
      // 랜드마크에 안 맞은 곳은 지도 서비스로 이름을 붙인다 (1초에 하나)
      const named = trips.flatMap(t => t.u);
      for (const [k, u] of named.entries()) {
        say(`이름 없는 곳에 이름 붙이는 중 ${k + 1}/${named.length} — 이 탭을 닫지 마세요`);
        u.name = await reverseName(u) || `${u.at.slice(11)} 머문 곳`;
        if (k < named.length - 1) await new Promise(r => setTimeout(r, 1100));
      }
      const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
      const legHashes = trips.sort((x, y) => x.dt.localeCompare(y.dt)).map(t => encode({ ...DEFAULTS, c: t.city, d: t.d, t: t.t, e: t.e, s: t.s, p: t.p, m: t.m, u: t.u.map(({ name, lat, lng, min }) => ({ name: name.replace(/[~|,]/g, ' ').slice(0, 40), lat, lng, min })), o: t.o, ds: t.ds, dt: t.dt, tab: 'plan' }));
      const first = trips[0], last = trips[trips.length - 1];
      say('계정에 저장하는 중…');
      const pr = await store.createProject({ name: `${trips.map(t => CITIES[t.city]).join('·')} ${md(first.dates[0])}–${md(last.dates[last.dates.length - 1])} (실제 동선)`, city: first.city, hash: legHashes.join('\n') });
      const lastId = pr.id;
      tlImport.busy = false; say('');
      setState({ pr: lastId });
    } catch (e) { console.error(e); tlImport.busy = false; say(`가져오지 못했어요 — ${e.message || e}`); render(); }
  };
  row.append(nw, tl, file); head.appendChild(row); head.appendChild(msg);
  // 플랜 링크 여러 개 → 여행 하나 (도시마다 구간). 링크의 # 뒤만 읽는다
  const lk = $('details'); lk.appendChild($('summary', null, '플랜 링크로 여행 만들기'));
  const ta = $('textarea', 'text'); ta.rows = 3; ta.placeholder = '플랜 링크를 붙여 넣어요 — 여러 도시면 줄마다 하나씩';
  const lkGo = $('button', 'btn primary', '여행 만들기'); lkGo.type = 'button'; const lkMsg = $('span', 'muted', '');
  lkGo.onclick = async () => {
    const legs = (ta.value.match(/#[^\s]+/g) || []).map(h => decode(h)).filter(st => CITIES[st.c] && Object.keys(st.p).length + st.u.length)
      .sort((x, y) => (x.dt || '').localeCompare(y.dt || ''));
    if (!legs.length) { lkMsg.textContent = '장소가 담긴 플랜 링크를 못 찾았어요.'; return; }
    const md = st => st.dt ? `${Number(st.dt.slice(5, 7))}/${Number(st.dt.slice(8, 10))}` : '';
    const end = legs.at(-1), endDt = end.dt && new Date(Date.parse(end.dt) + (end.d - 1) * 864e5).toISOString().slice(0, 10);
    const range = legs[0].dt ? ` ${md(legs[0])}–${md({ dt: endDt })}` : '';
    try {
      lkGo.disabled = true;
      const pr = await store.createProject({ name: `${legs.map(st => CITIES[st.c]).join('·')}${range}`, city: legs[0].c, hash: legs.map(st => encode({ ...st, tab: 'plan', pr: null, lg: 0 })).join('\n') });
      setState({ pr: pr.id });
    } catch (e) { lkGo.disabled = false; lkMsg.textContent = `만들지 못했어요 — ${e.message || e}`; }
  };
  const lkRow = $('div', 'row'); lkRow.append(ta, lkGo, lkMsg); lk.appendChild(lkRow); head.appendChild(lk);
  head.appendChild($('p', 'muted', '타임라인 파일은 구글 지도 앱 → 설정 → 위치 및 개인정보 → 타임라인 내보내기에서 받아요. 파일은 이 브라우저 안에서만 읽고, 만들어진 플랜만 저장돼요.'));
  side.appendChild(head);

  if (!projects.length) { side.appendChild($('div', 'panel', '<p class="muted">아직 여행이 없다.</p>')); return; }
  const grid = $('div', 'cards');
  for (const p of projects) {
    const ci = ctx.INDEX?.cities?.[p.city] || {};
    const card = $('a', 'card trip'); card.href = '#';
    card.innerHTML = `<img src="${esc(ci.image || '')}" alt="" loading="lazy"><div class="cap"><b>${esc(p.name)}${p.id === user.prefs?.lastPr ? ' · 최근' : ''}</b><span>${legsOf(p.hash).map(h => esc(CITIES[decode('#' + h).c] || '')).join(' → ')} · 사진 ${p.photos.length} · 살 것 ${p.shopping.filter(x => !x.done).length} · ${fmtDate(p.updatedAt)}</span></div>`;
    card.onclick = e => { e.preventDefault(); setState({ pr: p.id }); };
    grid.appendChild(card);
  }
  side.appendChild(grid);
}

// 플랜만 담은 해시 (탭·여행 id 제외)
const planHash = st => encode({ ...st, tab: 'plan', pr: null });

async function renderProject(ctx) {
  const { state, setState, $, side, store, project: p, CITIES, render, map, INDEX, loadCity, plan, resolvePlaces, hm, setStep, canEdit = true, isOwner = true, saveToProject } = ctx;
  const ci = INDEX?.cities?.[p.city] || {};
  const legs = legsOf(p.hash).map(h => decode('#' + h));
  const crumb = $('nav', 'crumb');
  const cb = $('a', null, ctx.user ? '← 내 여행' : '← 홈'); cb.href = '#'; cb.onclick = e => { e.preventDefault(); setState({ pr: null, tab: ctx.user ? 'mine' : 'home' }); };
  crumb.append(cb, $('span', null, esc(p.name)));
  side.appendChild(crumb);
  const head = $('div', 'panel'); head.style.padding = '0'; head.style.overflow = 'hidden';
  if (ci.image) { const cover = $('div', 'cover'); cover.innerHTML = `<img src="${esc(ci.image)}" alt=""><div class="cap"><b>${esc(p.name)}</b><span>${legs.map(l => esc(CITIES[l.c] || l.c)).join(' → ')} · 만든 날 ${fmtDate(p.createdAt)} · 고친 날 ${fmtDate(p.updatedAt)}</span></div>`; head.appendChild(cover); }
  const inner = $('div', null); inner.style.padding = '12px 16px 16px'; head.appendChild(inner);
  if (isOwner) { const ren = $('button', 'btn sm', '이름 바꾸기'); ren.type = 'button'; ren.onclick = async () => { const n = prompt('여행 이름', p.name); if (!n || n === p.name) return; await store.updateProject(p.id, { name: n }); render(); }; inner.appendChild(ren); }
  if (p.lastEditedBy) inner.appendChild($('span', 'muted', ` 마지막 수정 ${esc(p.lastEditedBy)}`));
  const row = $('div', 'row');
  const load = $('button', 'btn primary', '이 플랜 열기'); load.type = 'button';
  load.onclick = () => setState({ ...legs[0], tab: 'plan', pr: p.id, lg: 0 });
  row.appendChild(load);
  if (canEdit && legs.length === 1) { const save = $('button', 'btn', '지금 플랜을 여기 저장'); save.type = 'button'; save.onclick = async () => { try { await (saveToProject ? saveToProject(p.id) : store.updateProject(p.id, { city: state.c, hash: planHash(state) })); save.textContent = '저장됨'; setTimeout(render, 600); } catch (e) { alert(`저장 실패 — ${e.message || e}`); } }; row.appendChild(save); }
  if (isOwner) { const del = $('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = async () => { if (!confirm(`「${p.name}」을 지울까? 사진도 같이 지워진다.`)) return; await store.deleteProject(p.id); setState({ pr: null }); }; row.appendChild(del); }
  inner.appendChild(row);
  side.appendChild(head);

  // 플랜 요약 — 노선도 모양 그대로, 구간 하나씩 (지도도 그 구간만)
  const li = Math.min(tripLeg.get(p.id) || 0, legs.length - 1), st = legs[li];
  if (legs.length > 1) {
    const pills = $('div', 'legpills');
    legs.forEach((l, k) => { const b = $('button', 'btn sm' + (k === li ? ' primary' : ''), esc(CITIES[l.c] || l.c)); b.type = 'button'; b.onclick = () => { tripLeg.set(p.id, k); render(); }; pills.appendChild(b); });
    side.appendChild(pills);
  }
  try {
    const cd = await loadCity(st.c);
    const places = resolvePlaces(st, cd);
    const sum = $('div', 'panel'); const sh = $('div', 'row');
    sh.appendChild($('h2', null, `${esc(CITIES[st.c] || st.c)} <span class="muted" style="font-weight:500">· ${st.d}일 · ${places.length}곳${st.dt ? ` · ${Number(st.dt.slice(5, 7))}/${Number(st.dt.slice(8, 10))}부터` : ''}</span>`));
    const op = $('button', 'btn sm', '플랜 열기'); op.type = 'button'; op.style.marginLeft = 'auto'; op.onclick = () => setState({ ...st, tab: 'plan', pr: p.id, lg: li }); sh.appendChild(op); sum.appendChild(sh);
    if (!places.length) sum.appendChild($('p', 'muted', '아직 고른 장소가 없어요. 「플랜 열기」로 가서 고르면 여기 노선이 떠요.'));
    else {
      const start = st.s || { lat: cd.center[0], lng: cd.center[1] };
      const perDay = Object.fromEntries(Object.entries(st.ds || {}).map(([k, d]) => [k, { dayStart: d.t, dayEnd: d.e, pref: d.v, start: d.s }]));
      const res = plan(places, { days: st.d, start, dayStart: st.t, dayEnd: st.e, pref: st.v, legs: st.l, manual: st.o, perDay });
      const lines = $('div', 'v2lines'), bounds = [[start.lat, start.lng]], css = getComputedStyle(document.body);
      res.days.forEach((day, i) => {
        if (!day.stops.length) return;
        const cv = `--d${i % 10 + 1}`, col = css.getPropertyValue(cv).trim() || '#1F4FA8';
        const ln = $('section', 'line ro'); ln.style.setProperty('--c', `var(${cv})`);
        ln.innerHTML = `<header><b>${i + 1}일차</b><span>${hm(day.stops[0].arrive)}–${hm(day.end)} · 이동 ${day.moveMin}분</span></header>`;
        const ol = $('ol');
        for (const x of day.stops) {
          const who = p.edits?.[x.place.id]?.by, o = x.place.opts[x.place.opt];
          ol.appendChild($('li', 'stn', `<time>${hm(x.arrive)}</time><i class="dot"></i><div><div class="nm">${esc(x.place.name)}${who ? ` <span class="who">${esc(who)}</span>` : ''}</div><div class="meta">${esc(o?.label && o.label !== '머물기' ? o.label + ' · ' : '')}${o?.min || ''}분</div></div>`));
        }
        ln.appendChild(ol); lines.appendChild(ln);
        const s0 = perDay[i]?.start || start;
        map.line('route', [[s0.lat, s0.lng], ...day.stops.map(x => [x.place.lat, x.place.lng])], { color: col, weight: 4, opacity: 0.85 });
        day.stops.forEach((x, k) => { map.html('route', x.place, `<div class="st" style="--c:${col}"><i>${k + 1}</i><span>${esc(x.place.name)}</span></div>`, { title: `${hm(x.arrive)} ${x.place.name}` }); bounds.push([x.place.lat, x.place.lng]); });
      });
      sum.appendChild(lines);
      if (res.dropped.length) sum.appendChild($('p', 'muted', `시간이 모자라 뺀 곳 ${res.dropped.length}: ${res.dropped.map(x => esc(x.place.name)).join(', ')}`));
      map.fitBounds(bounds, 40);
    }
    side.appendChild(sum);
  } catch (e) { side.appendChild($('div', 'panel', `<p class="muted">노선을 못 그렸어요 — ${esc(e.message || e)}</p>`)); }
  side.appendChild(await renderShare(ctx));
  if (!canEdit) return;   // 보기만: 살 것·사진은 아래 읽기 전용으로 — 지금은 생략

  // 살 것
  const shop = $('div', 'panel'); shop.appendChild($('h2', null, `살 것 <span class="muted" style="font-weight:500">${p.shopping.filter(x => x.done).length}/${p.shopping.length}</span>`));
  const add = $('div', 'row');
  const inp = $('input', 'text'); inp.type = 'text'; inp.placeholder = '살 것 — 기념품 탭에서 「담기」로도 들어온다'; inp.maxLength = 80;
  const ab = $('button', 'btn sm', '추가'); ab.type = 'button';
  const addRun = async () => { const t = inp.value.trim(); if (!t) return; await store.updateProject(p.id, { shopping: [...p.shopping, { text: t, done: false }] }); render(); };
  ab.onclick = addRun; inp.onkeydown = e => { if (e.key === 'Enter') addRun(); };
  add.append(inp, ab); shop.appendChild(add);
  p.shopping.forEach((it, i) => {
    const r = $('div', 'row');
    const cb = $('input'); cb.type = 'checkbox'; cb.checked = it.done; cb.id = 'sh-' + i;
    cb.onchange = async () => { const s = p.shopping.map((x, j) => j === i ? { ...x, done: cb.checked } : x); await store.updateProject(p.id, { shopping: s }); render(); };
    const lab = $('label', null, esc(it.text)); lab.htmlFor = cb.id; if (it.done) lab.style.cssText = 'text-decoration:line-through;color:var(--faint)';
    const x = $('button', 'btn sm', '×'); x.type = 'button'; x.onclick = async () => { await store.updateProject(p.id, { shopping: p.shopping.filter((_, j) => j !== i) }); render(); };
    r.append(cb, lab, x); shop.appendChild(r);
  });
  side.appendChild(shop);

  // 사진
  const ph = $('div', 'panel'); ph.appendChild($('h2', null, `사진 <span class="muted" style="font-weight:500">${p.photos.length}장</span>`));
  ph.appendChild($('p', null, '올리면 사진 안의 GPS로 지도에 찍힌다. GPS가 없으면 아래에서 장소를 골라 붙여라.'));
  const cityData = await loadCity(p.city).catch(() => ({ places: [] }));
  const placeName = id => cityData.places.find(x => x.id === id)?.name;
  // 올리기: 파일 고르기 + 끌어다 놓기. 한 장씩 진행을 보여준다
  const drop = $('div', 'drop'); drop.innerHTML = '<b>사진을 여기 끌어다 놓거나</b> <span class="muted">눌러서 고른다 · 여러 장 가능 · 올릴 때 긴 변 1200px로 줄인다</span>';
  const file = $('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.hidden = true;
  const prog = $('p', 'muted', '');
  const ingest = async files => {
    const list = [...files].filter(f => f.type.startsWith('image/')); if (!list.length) return;
    let n = 0;
    for (const f of list) {
      prog.textContent = `올리는 중 ${++n}/${list.length} — ${f.name}`;
      try {
        const [dataUrl, gps] = await Promise.all([shrink(f), gpsOf(f)]);
        await store.addPhoto(p.id, { dataUrl, lat: gps?.lat ?? null, lng: gps?.lng ?? null, placeId: nearest(cityData, gps), note: '', takenAt: f.lastModified });
      } catch (e) { alert(`「${f.name}」을 못 담았다 — ${e.message || '브라우저 저장 한도(약 5MB)를 넘었을 수 있다'}`); break; }
    }
    render();
  };
  drop.onclick = () => file.click(); file.onchange = () => ingest(file.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); ingest(e.dataTransfer.files); };
  ph.append(drop, file, prog);
  // 장소별로 묶어 보여준다 — GPS로 붙은 장소, 손으로 고른 장소, 장소 없음
  const groups = new Map();
  for (const x of [...p.photos].sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))) { const k = x.placeId || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const order = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || (placeName(a) || '').localeCompare(placeName(b) || ''));
  for (const k of order) {
    ph.appendChild($('h3', 'photogroup', `${esc(placeName(k) || '장소 없음')} <span class="muted" style="font-weight:500">${groups.get(k).length}장</span>`));
    for (const x of groups.get(k)) ph.appendChild(photoRow(x));
  }
  function photoRow(x) {
    const r = $('div', 'photo');
    const img = $('img'); img.src = x.url || x.dataUrl; img.loading = 'lazy'; img.title = '크게 보기'; img.onclick = () => lightbox(x.url || x.dataUrl, x.note || placeName(x.placeId) || ''); r.appendChild(img);
    const body = $('div', 'body');
    const sel = $('select', 'quiet'); sel.title = '어디서 찍었나';
    [['', x.lat != null ? 'GPS 자리' : '장소 없음'], ...cityData.places.map(pl => [pl.id, pl.name])].forEach(([v, l]) => { const o = $('option', null, esc(l)); o.value = v; o.selected = (x.placeId || '') === v; sel.appendChild(o); });
    sel.onchange = async () => { await store.updatePhoto(p.id, x.id, { placeId: sel.value || null }); render(); };
    const note = $('input', 'text'); note.type = 'text'; note.placeholder = '메모'; note.value = x.note || ''; note.maxLength = 120;
    note.onchange = async () => { await store.updatePhoto(p.id, x.id, { note: note.value }); };
    const meta = $('div', 'muted', `${x.takenAt ? fmtDate(x.takenAt) : ''}${x.lat != null ? ` · ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}` : ' · GPS 없음'}`);
    const tools = $('div', 'row');
    const pick = $('button', 'btn sm', x.lat != null ? '지도에서 위치 옮기기' : '지도에서 위치 찍기'); pick.type = 'button';
    pick.onclick = () => { ctx.pickPhoto?.(async ll => { await store.updatePhoto(p.id, x.id, { lat: ll.lat, lng: ll.lng, placeId: nearest(cityData, ll) || x.placeId || null }); render(); }); pick.textContent = '지도를 클릭해라…'; };
    const del = $('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = async () => { if (!confirm('이 사진을 지울까?')) return; await store.deletePhoto(p.id, x.id); render(); };
    tools.append(pick, del);
    body.append(sel, note, meta, tools); r.appendChild(body);
    // 지도: 좌표가 있으면 그 자리, 없으면 고른 장소 자리
    const at = x.lat != null ? [x.lat, x.lng] : (placeName(x.placeId) ? (pl => [pl.lat, pl.lng])(cityData.places.find(q => q.id === x.placeId)) : null);
    if (at && map) map.html('route', { lat: at[0], lng: at[1] }, `<img src="${x.url || x.dataUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">`, { title: x.note || placeName(x.placeId) || '사진', onClick: () => lightbox(x.url || x.dataUrl, x.note || placeName(x.placeId) || '') });
    return r;
  }
  side.appendChild(ph);
  if (p.photos.length && ctx.fitPhotos) ctx.fitPhotos(p.photos.filter(x => x.lat != null).map(x => ({ lat: x.lat, lng: x.lng })));
}

// GPS에서 1km 안의 가장 가까운 랜드마크 id (없으면 null)
function nearest(city, gps) {
  if (!gps) return null;
  let best = null, bd = 1;
  for (const pl of city.places) {
    const d = Math.hypot((pl.lat - gps.lat) * 111, (pl.lng - gps.lng) * 111 * Math.cos(gps.lat * Math.PI / 180));
    if (d < bd) { bd = d; best = pl.id; }
  }
  return best;
}
