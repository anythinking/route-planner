// 「내 여행」 탭 — 로그인 · 여행 목록 · 여행 하나(플랜 저장, 살 것, 사진). 저장은 ctx.store 인터페이스만 쓴다.
import { esc } from './html.js';
import { decode, encode } from './state.js';

const guard = (fn, render) => async (...a) => { try { await fn(...a); } catch (e) { alert(`저장 실패 — ${e.message || e}`); render(); } };
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

export async function renderMine(ctx) {
  const { state, user, project } = ctx;
  if (!user) return renderLogin(ctx);
  if (ctx.accountOpen && !state.pr) return renderAccount(ctx);
  if (!state.pr || !project) return renderList(ctx);
  return renderProject(ctx);
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
function renderLogin({ $, side, store, render, state: ctxState }) {
  const p = $('div', 'panel');
  p.appendChild($('h2', null, '내 여행'));
  if (store.kind === 'supabase') {
    p.appendChild($('p', null, '여행별로 플랜·살 것·사진을 모아 둔다. 로그인하면 어느 기기에서든 같은 여행이 열린다.'));
    if (Object.keys(ctxState.p).length) p.appendChild($('p', null, '<b>지금 만든 플랜은 그대로 있다</b> — 로그인한 뒤 플랜 탭의 「저장」을 누르면 내 여행에 남는다.'));
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
  row.append(nw); head.appendChild(row);
  head.appendChild($('p', 'muted', '플랜 탭에서 장소를 고른 뒤 여기서 「새 여행」을 누르면 그 플랜이 담긴다.'));
  side.appendChild(head);

  if (!projects.length) { side.appendChild($('div', 'panel', '<p class="muted">아직 여행이 없다.</p>')); return; }
  const grid = $('div', 'cards');
  for (const p of projects) {
    const ci = ctx.INDEX?.cities?.[p.city] || {};
    const card = $('a', 'card trip'); card.href = '#';
    card.innerHTML = `<img src="${esc(ci.image || '')}" alt="" loading="lazy"><div class="cap"><b>${esc(p.name)}${p.id === user.prefs?.lastPr ? ' · 최근' : ''}</b><span>${esc(CITIES[p.city] || p.city)} · 사진 ${p.photos.length} · 살 것 ${p.shopping.filter(x => !x.done).length} · ${fmtDate(p.updatedAt)}</span></div>`;
    card.onclick = e => { e.preventDefault(); setState({ pr: p.id }); };
    grid.appendChild(card);
  }
  side.appendChild(grid);
}

// 플랜만 담은 해시 (탭·여행 id 제외)
const planHash = st => encode({ ...st, tab: 'plan', pr: null });

async function renderProject(ctx) {
  const { state, setState, $, side, store, project: p, CITIES, render, layers, L, INDEX, loadCity, plan, resolvePlaces, hm, setStep } = ctx;
  const ci = INDEX?.cities?.[p.city] || {};
  const head = $('div', 'panel'); head.style.padding = '0'; head.style.overflow = 'hidden';
  if (ci.image) { const cover = $('div', 'cover'); cover.innerHTML = `<img src="${esc(ci.image)}" alt=""><div class="cap"><b>${esc(p.name)}</b><span>${esc(CITIES[p.city] || p.city)} · 만든 날 ${fmtDate(p.createdAt)} · 고친 날 ${fmtDate(p.updatedAt)}</span></div>`; head.appendChild(cover); }
  const inner = $('div', null); inner.style.padding = '12px 16px 16px'; head.appendChild(inner);
  const back = $('button', 'btn sm', '← 목록'); back.type = 'button'; back.onclick = () => setState({ pr: null });
  const ren = $('button', 'btn sm', '이름 바꾸기'); ren.type = 'button'; ren.onclick = async () => { const n = prompt('여행 이름', p.name); if (!n || n === p.name) return; await store.updateProject(p.id, { name: n }); render(); };
  inner.append(back, ren);
  const row = $('div', 'row');
  const load = $('button', 'btn primary', '이 플랜 열기'); load.type = 'button';
  load.onclick = () => { const st = decode('#' + p.hash); setStep?.(3); setState({ ...st, tab: 'plan', pr: p.id }); };
  const save = $('button', 'btn', '지금 플랜을 여기 저장'); save.type = 'button';
  save.onclick = async () => { await store.updateProject(p.id, { city: state.c, hash: planHash(state) }); save.textContent = '저장됨'; setTimeout(render, 600); };
  const del = $('button', 'btn sm', '삭제'); del.type = 'button';
  del.onclick = async () => { if (!confirm(`「${p.name}」을 지울까? 사진도 같이 지워진다.`)) return; await store.deleteProject(p.id); setState({ pr: null }); };
  row.append(load, save, del); inner.appendChild(row);
  side.appendChild(head);

  // 플랜 요약 — 저장된 해시를 그 도시 데이터로 다시 계산해 읽기 전용으로 보여준다
  try {
    const st = decode('#' + p.hash); const cd = await loadCity(p.city);
    const places = resolvePlaces(st, cd);
    const sum = $('div', 'panel'); sum.appendChild($('h2', null, `플랜 <span class="muted" style="font-weight:500">· ${st.d}일 · ${places.length}곳</span>`));
    if (!places.length) sum.appendChild($('p', 'muted', '아직 고른 장소가 없다. 「이 플랜 열기」로 가서 고르면 여기 요약이 뜬다.'));
    else {
      const start = st.s || { lat: cd.center[0], lng: cd.center[1] };
      const res = plan(places, { days: st.d, start, dayStart: st.t, dayEnd: st.e, pref: st.v, legs: st.l, manual: st.o });
      res.days.forEach((day, i) => {
        if (!day.stops.length) return;
        const d = $('div', 'item'); d.innerHTML = `<b>${i + 1}일차 <span class="muted" style="font-weight:500">${hm(day.stops[0].arrive)}–${hm(day.end)} · 이동 ${day.moveMin}분</span></b><span>${day.stops.map(s => esc(s.place.name)).join(' → ')}</span>`;
        sum.appendChild(d);
      });
      if (res.dropped.length) sum.appendChild($('p', 'muted', `뺀 것 ${res.dropped.length}: ${res.dropped.map(x => esc(x.place.name)).join(', ')}`));
    }
    side.appendChild(sum);
  } catch (e) { side.appendChild($('div', 'panel', `<p class="muted">플랜 요약을 못 만들었다 — ${esc(e.message || e)}</p>`)); }

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
  const file = $('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true;
  file.onchange = async () => {
    for (const f of file.files) {
      try {
        const [dataUrl, gps] = await Promise.all([shrink(f), gpsOf(f)]);
        await store.addPhoto(p.id, { dataUrl, lat: gps?.lat ?? null, lng: gps?.lng ?? null, placeId: nearest(cityData, gps), note: '', takenAt: f.lastModified });
      } catch (e) { alert(`「${f.name}」을 못 담았다 — 브라우저 저장 한도(약 5MB)를 넘었을 수 있다. 계정 서버가 붙으면 한도가 사라진다.`); break; }
    }
    render();
  };
  ph.appendChild(file);
  const cityData = await loadCity(p.city).catch(() => ({ places: [] }));
  const placeName = id => cityData.places.find(x => x.id === id)?.name;
  for (const x of [...p.photos].sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))) {
    const r = $('div', 'photo');
    const img = $('img'); img.src = x.url || x.dataUrl; img.loading = 'lazy'; r.appendChild(img);
    const body = $('div', 'body');
    const sel = $('select', 'quiet'); sel.title = '어디서 찍었나';
    [['', x.lat != null ? 'GPS 자리' : '장소 없음'], ...cityData.places.map(pl => [pl.id, pl.name])].forEach(([v, l]) => { const o = $('option', null, esc(l)); o.value = v; o.selected = (x.placeId || '') === v; sel.appendChild(o); });
    sel.onchange = async () => { await store.updatePhoto(p.id, x.id, { placeId: sel.value || null }); render(); };
    const note = $('input', 'text'); note.type = 'text'; note.placeholder = '메모'; note.value = x.note || ''; note.maxLength = 120;
    note.onchange = async () => { await store.updatePhoto(p.id, x.id, { note: note.value }); };
    const meta = $('div', 'muted', `${x.takenAt ? fmtDate(x.takenAt) : ''}${x.lat != null ? ` · ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}` : ' · GPS 없음'}`);
    const del = $('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = async () => { await store.deletePhoto(p.id, x.id); render(); };
    body.append(sel, note, meta, del); r.appendChild(body); ph.appendChild(r);
    // 지도: 좌표가 있으면 그 자리, 없으면 고른 장소 자리
    const at = x.lat != null ? [x.lat, x.lng] : (placeName(x.placeId) ? (pl => [pl.lat, pl.lng])(cityData.places.find(q => q.id === x.placeId)) : null);
    if (at) L.marker(at, { icon: L.divIcon({ className: '', html: `<img src="${x.url || x.dataUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">`, iconSize: [36, 36], iconAnchor: [18, 18] }) })
      .bindTooltip(esc(x.note || placeName(x.placeId) || '사진')).addTo(layers.route);
  }
  side.appendChild(ph);
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
