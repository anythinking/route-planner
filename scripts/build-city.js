// 도시 초안 생성 — scripts/seeds/<city>.json(장소 이름·가중치·종류)을 받아 위키데이터에서 좌표·한국어 이름·설명을 채우고
// scripts/country/<country>.json(준비물·기념품·사진 공통)과 합쳐 data/<city>.json을 쓴다. 이미 있는 파일의 손질(note·opts·photo)은 지킨다.
//   node scripts/build-city.js tokyo
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const UA = 'AlgoTrip/0.1 (https://anythinking.github.io/route-planner/)';
const get = async (url) => { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 종류별 체류 선택지 기본표 (분)
const OPTS = {
  museum:   [['핵심만', 60], ['한 바퀴', 120]],
  gallery:  [['핵심만', 60], ['한 바퀴', 120]],
  temple:   [['경내만', 30], ['경내 + 정원', 60]],
  shrine:   [['참배길까지', 30], ['경내 한 바퀴', 50]],
  church:   [['밖에서만', 15], ['내부까지', 45]],
  palace:   [['밖과 정원', 45], ['내부까지', 120]],
  castle:   [['밖과 정원', 45], ['내부까지', 90]],
  ruin:     [['밖에서만', 30], ['내부 한 바퀴', 90]],
  tower:    [['밖에서만', 15], ['전망대', 60]],
  view:     [['전망만', 30], ['천천히', 60]],
  park:     [['지나며', 30], ['한 바퀴', 60]],
  garden:   [['한 바퀴', 45], ['천천히', 75]],
  market:   [['훑기', 45], ['먹으며', 90]],
  street:   [['걸어 지나기', 30], ['구경하며', 60]],
  district: [['한 바퀴', 60], ['골목까지', 120]],
  square:   [['지나며', 15], ['앉았다 가기', 30]],
  bridge:   [['건너기', 15], ['사진까지', 30]],
  landmark: [['밖에서만', 20], ['가까이', 45]],
  shop:     [['훑기', 30], ['쇼핑', 90]],
  theme:    [['반나절', 240], ['하루', 480]],
  food:     [['한 끼', 60], ['천천히', 90]],
  beach:    [['산책', 45], ['머물기', 120]],
};

const cityId = process.argv[2]; if (!cityId) { console.error('도시 id를 달라'); process.exit(1); }
const cities = JSON.parse(readFileSync('data/cities.json', 'utf8')).cities;
const meta = cities[cityId]; if (!meta) { console.error(`data/cities.json에 ${cityId} 없음`); process.exit(1); }
const seed = JSON.parse(readFileSync(`scripts/seeds/${cityId}.json`, 'utf8'));
const country = JSON.parse(readFileSync(`scripts/country/${meta.country}.json`, 'utf8'));
const prevPath = `data/${cityId}.json`;
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
const prevPlace = id => prev?.places?.find(p => p.id === id);

async function entities(ids) {
  if (!ids.length) return {};
  return (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels|sitelinks|claims&languages=ko|en|ja|it|es&format=json`)).entities || {};
}
const inBox = (lat, lng, b) => lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3];
const coordOf = e => e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;

async function resolve(p) {
  // 후보: seed의 q → 한국어 이름 검색 → 영어 이름 검색. 좌표가 도시 상자 안에 드는 첫 후보를 쓴다 (동명이인 방지)
  let ids = [];
  if (p.q) ids.push(p.q);
  for (const [text, lang] of [[p.name, 'ko'], [p.en, 'en']]) {
    if (!text) continue;
    const s = await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(text)}&language=${lang}&limit=6&format=json`);
    ids.push(...(s.search || []).map(x => x.id)); await sleep(150);
  }
  ids = [...new Set(ids)];
  const ents = await entities(ids);
  let e = null;
  for (const id of ids) { const c = coordOf(ents[id]); if (c && inBox(c.latitude, c.longitude, meta.bbox)) { e = ents[id]; break; } }
  if (!e) { console.error(`⚠ 상자 안 후보 없음: ${p.id} (후보 ${ids.length}개)`); e = ents[ids[0]] || {}; }
  const coord = coordOf(e);
  const ko = e.labels?.ko?.value, en = e.labels?.en?.value;
  const koTitle = e.sitelinks?.kowiki?.title;
  let extract = '';
  if (koTitle) {
    try { const sum = await get(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(koTitle)}`); extract = (sum.extract || '').split(/(?<=[.다])\s/).slice(0, 2).join(' ').trim(); } catch {}
  }
  return { q: e.id, ko, en, lat: coord?.latitude, lng: coord?.longitude, extract, sitelinks: Object.keys(e.sitelinks || {}).length };
}

const out = { city: cityId, name: meta.name, center: meta.center, places: [] };
for (const p of seed.places) {
  const r = await resolve(p); await sleep(300);
  const old = prevPlace(p.id);
  const optsTable = OPTS[p.cat] || OPTS.landmark;
  const place = {
    id: p.id, name: p.name || r.ko || r.en, lat: p.lat ?? r.lat, lng: p.lng ?? r.lng, weight: p.weight,
    opts: old?.opts || optsTable.map(([label, min]) => ({ label, min })),
    default: old?.default ?? (p.default ?? 0),
    note: old?.note || p.note || r.extract || '',
    q: r.q, cat: p.cat,
  };
  if (!(place.lat && place.lng)) console.error(`⚠ 좌표 없음: ${p.id} (${r.q})`);
  const box = meta.bbox; if (place.lat && !(place.lat >= box[0] && place.lat <= box[1] && place.lng >= box[2] && place.lng <= box[3])) console.error(`⚠ 도시 밖: ${p.id} ${place.lat},${place.lng}`);
  out.places.push(place);
  console.log(`${p.id.padEnd(14)} ${String(place.weight)} ${place.name} · 위키 ${r.sitelinks}개 언어 · ${place.note ? '설명 있음' : '설명 없음'}`);
}
out.pack = prev?.pack || country.pack;
out.photo = { general: prev?.photo?.general || country.photoGeneral, places: prev?.photo?.places || seed.photo || {} };
out.gift = prev?.gift || country.gift;
writeFileSync(prevPath, JSON.stringify(out, null, 1));
console.log(`→ ${prevPath}: ${out.places.length}곳`);
