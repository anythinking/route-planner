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

export function renderMine(ctx) {
  const { state, setState, city, $, side, store, user, project, CITIES, render, layers, map, L } = ctx;
  if (!user) return renderLogin(ctx);
  if (ctx.accountOpen && !state.pr) return renderAccount(ctx);
  if (!state.pr || !project) return renderList(ctx);
  return renderProject(ctx);
}

// 내 계정 — 누구로 들어와 있나, 무엇이 쌓였나, 나가기
function renderAccount({ $, side, store, user, projects, setState, render, closeAccount }) {
  const p = $('div', 'panel');
  p.appendChild($('h2', null, '내 계정'));
  const photos = projects.reduce((n, x) => n + x.photos.length, 0);
  p.appendChild($('div', 'item', `<b>${esc(user.name)}</b><span class="muted">${esc(user.email || '이 브라우저에만 저장되는 계정')}</span>`));
  p.appendChild($('div', 'item', `<b>여행 ${projects.length}개 · 사진 ${photos}장</b><span>${store.kind === 'supabase' ? '계정 서버에 저장 — 어느 기기에서든 같은 걸 본다.' : '이 브라우저에만 저장 — 기기를 바꾸면 안 보인다.'}</span>`));
  const row = $('div', 'row');
  const list = $('button', 'btn primary', '내 여행 목록'); list.type = 'button'; list.onclick = () => { closeAccount(); render(); };
  const out = $('button', 'btn', '로그아웃'); out.type = 'button';
  out.onclick = async () => { await store.signOut(); closeAccount(); setState({ pr: null }); };
  row.append(list, out); p.appendChild(row);
  side.appendChild(p);
}

let mailSent = '';
function renderLogin({ $, side, store, render }) {
  const p = $('div', 'panel');
  p.appendChild($('h2', null, '내 여행'));
  if (store.kind === 'supabase') {
    p.appendChild($('p', null, '여행별로 플랜·살 것·사진을 모아 둔다. 로그인하면 어느 기기에서든 같은 여행이 열린다.'));
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
  for (const p of projects) {
    const c = $('div', 'panel');
    c.appendChild($('h2', null, esc(p.name)));
    c.appendChild($('p', 'meta', `${esc(CITIES[p.city] || p.city)} · 사진 ${p.photos.length} · 살 것 ${p.shopping.filter(x => !x.done).length} · ${fmtDate(p.updatedAt)}`));
    const r = $('div', 'row');
    const open = $('button', 'btn primary', '열기'); open.type = 'button'; open.onclick = () => setState({ pr: p.id });
    r.appendChild(open); c.appendChild(r); side.appendChild(c);
  }
}

// 플랜만 담은 해시 (탭·여행 id 제외)
const planHash = st => encode({ ...st, tab: 'plan', pr: null });

function renderProject(ctx) {
  const { state, setState, city, $, side, store, project: p, CITIES, render, layers, L } = ctx;
  const head = $('div', 'panel');
  const back = $('button', 'btn sm', '← 목록'); back.type = 'button'; back.onclick = () => setState({ pr: null });
  head.appendChild(back);
  head.appendChild($('h2', null, esc(p.name)));
  head.appendChild($('p', 'meta', `${esc(CITIES[p.city] || p.city)} · 만든 날 ${fmtDate(p.createdAt)} · 고친 날 ${fmtDate(p.updatedAt)}`));
  const row = $('div', 'row');
  const load = $('button', 'btn primary', '이 플랜 열기'); load.type = 'button';
  load.onclick = () => { const st = decode('#' + p.hash); setState({ ...st, tab: 'plan', pr: p.id }); };
  const save = $('button', 'btn', '지금 플랜을 여기 저장'); save.type = 'button';
  save.onclick = async () => { await store.updateProject(p.id, { city: state.c, hash: planHash(state) }); save.textContent = '저장됨'; setTimeout(render, 600); };
  const del = $('button', 'btn sm', '삭제'); del.type = 'button';
  del.onclick = async () => { if (!confirm(`「${p.name}」을 지울까? 사진도 같이 지워진다.`)) return; await store.deleteProject(p.id); setState({ pr: null }); };
  row.append(load, save, del); head.appendChild(row);
  side.appendChild(head);

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
        await store.addPhoto(p.id, { dataUrl, lat: gps?.lat ?? null, lng: gps?.lng ?? null, placeId: nearest(city, gps), note: '', takenAt: f.lastModified });
      } catch (e) { alert(`「${f.name}」을 못 담았다 — 브라우저 저장 한도(약 5MB)를 넘었을 수 있다. 계정 서버가 붙으면 한도가 사라진다.`); break; }
    }
    render();
  };
  ph.appendChild(file);
  const placeName = id => city.places.find(x => x.id === id)?.name;
  for (const x of [...p.photos].sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))) {
    const r = $('div', 'photo');
    const img = $('img'); img.src = x.url || x.dataUrl; img.loading = 'lazy'; r.appendChild(img);
    const body = $('div', 'body');
    const sel = $('select', 'quiet'); sel.title = '어디서 찍었나';
    [['', x.lat != null ? 'GPS 자리' : '장소 없음'], ...city.places.map(pl => [pl.id, pl.name])].forEach(([v, l]) => { const o = $('option', null, esc(l)); o.value = v; o.selected = (x.placeId || '') === v; sel.appendChild(o); });
    sel.onchange = async () => { await store.updatePhoto(p.id, x.id, { placeId: sel.value || null }); render(); };
    const note = $('input', 'text'); note.type = 'text'; note.placeholder = '메모'; note.value = x.note || ''; note.maxLength = 120;
    note.onchange = async () => { await store.updatePhoto(p.id, x.id, { note: note.value }); };
    const meta = $('div', 'muted', `${x.takenAt ? fmtDate(x.takenAt) : ''}${x.lat != null ? ` · ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}` : ' · GPS 없음'}`);
    const del = $('button', 'btn sm', '삭제'); del.type = 'button'; del.onclick = async () => { await store.deletePhoto(p.id, x.id); render(); };
    body.append(sel, note, meta, del); r.appendChild(body); ph.appendChild(r);
    // 지도: 좌표가 있으면 그 자리, 없으면 고른 장소 자리
    const at = x.lat != null ? [x.lat, x.lng] : (placeName(x.placeId) ? (pl => [pl.lat, pl.lng])(city.places.find(q => q.id === x.placeId)) : null);
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
