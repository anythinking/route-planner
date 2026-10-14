// data/*.json 스키마·좌표·고유성 검사. 실패하면 exit 1.
import { readdirSync, readFileSync } from 'node:fs';
const INDEX = JSON.parse(readFileSync('data/cities.json', 'utf8'));
const BBOX = Object.fromEntries(Object.entries(INDEX.cities).map(([id, c]) => [id, c.bbox])); // latMin,latMax,lngMin,lngMax
let bad = 0;
const fail = (f, m) => { console.error(`✗ ${f}: ${m}`); bad++; };
const files = readdirSync('data').filter(f => f.endsWith('.json') && f !== 'cities.json');
// 색인 ↔ 파일 대조: 색인의 도시마다 파일이 있고, 지역 목록의 도시가 색인에 있어야 한다
for (const id of Object.keys(INDEX.cities)) if (!files.includes(`${id}.json`)) fail('cities.json', `${id} 파일 없음`);
for (const r of INDEX.regions) for (const id of r.cities) if (!INDEX.cities[id]) fail('cities.json', `지역 ${r.id}의 ${id}가 cities에 없음`);
if (!files.length) fail('data/', '파일 없음');
for (const f of files) {
  const c = JSON.parse(readFileSync(`data/${f}`, 'utf8'));
  for (const k of ['city', 'name', 'center', 'places']) if (!(k in c)) fail(f, `${k} 없음`);
  if (c.city !== f.replace('.json', '')) fail(f, `city(${c.city})와 파일명 불일치`);
  const box = BBOX[c.city]; if (!box) fail(f, `bbox 미정의 도시 ${c.city}`);
  const ids = new Set();
  for (const p of c.places || []) {
    const tag = `${f}#${p.id}`;
    for (const k of ['id', 'name', 'lat', 'lng', 'weight', 'opts', 'default', 'note']) if (!(k in p)) fail(tag, `${k} 없음`);
    if (!/^[a-z0-9_]+$/.test(p.id || '')) fail(tag, 'id는 영문 소문자·숫자·_');
    if (ids.has(p.id)) fail(tag, 'id 중복'); ids.add(p.id);
    if (![1, 2, 3].includes(p.weight)) fail(tag, `weight ${p.weight}`);
    if (!Array.isArray(p.opts) || !p.opts.length) fail(tag, 'opts 비어 있음');
    else for (const o of p.opts) if (!o.label || !(o.min > 0)) fail(tag, `opts 항목 이상 ${JSON.stringify(o)}`);
    if (!(p.default >= 0 && p.default < (p.opts || []).length)) fail(tag, `default ${p.default}`);
    if (box && !(p.lat >= box[0] && p.lat <= box[1] && p.lng >= box[2] && p.lng <= box[3])) fail(tag, `좌표 ${p.lat},${p.lng} 도시 밖`);
    if (/<(?!\/?b>)/.test(p.note || '')) fail(tag, 'note에 <b> 외 태그');
    // 공개 데이터에 특정 여행의 맥락(동행·숙소·일정·개인 메모)이 새면 안 된다
    const LEAK = /네 노트|형이 쉐프|형한테|(?<!할)아버지|이코이|복셀|호텔에서|식당 문 앞|어제|오늘|내일|이번 여행|이번엔|옮겼다|켜라|켜보면|꺼뒀다|투어|저녁 약속|끝나면/;
    const m = (p.note || '').match(LEAK); if (m) fail(tag, `note에 여행 맥락 누출: "${m[0]}"`);
  }
  for (const k of ['pack', 'photo', 'gift']) if (!(k in c)) fail(f, `${k} 없음`);
  for (const x of c.pack || []) if (!x.item || !x.why) fail(f, `pack 항목 이상 ${JSON.stringify(x)}`);
  for (const x of c.gift || []) if (!x.item || !x.where || !x.note) fail(f, `gift 항목 이상 ${JSON.stringify(x)}`);
  if (!Array.isArray(c.photo?.general) || !c.photo.general.length) fail(f, 'photo.general 비어 있음');
  for (const id of Object.keys(c.photo?.places || {})) if (!ids.has(id)) fail(f, `photo.places에 모르는 id ${id}`);
  const missing = [...ids].filter(id => !c.photo?.places?.[id]); if (missing.length) console.log(`  (${f}: 사진 팁 없는 장소 ${missing.length}곳)`);   // 있으면 좋지만 필수는 아니다
  console.log(`${f}: ${(c.places || []).length}곳`);
}
if (bad) { console.error(`${bad}건 실패`); process.exit(1); }
console.log('데이터 OK');
