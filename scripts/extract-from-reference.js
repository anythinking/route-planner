// 1회성. reference/trip-plan.html → data/london.json, data/paris.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync('reference/trip-plan.html', 'utf8');
const grab = name => {
  const a = html.indexOf(`const ${name}=[`);
  const b = html.indexOf('\n];', a) + 3;
  return new Function(html.slice(a, b) + `; return ${name};`)();
};
const flatten = days => days.flatMap(d => d.variants ? Object.values(d.variants).flatMap(v => v.stops) : d.stops);
const clean = s => (s || '').replace(/<br\s*\/?>/g, ' ').replace(/<(?!\/?b>)[^>]+>/g, '').trim();

// 참고 도구 id → 새 id · weight. 여기 없는 정류장(식사·환복·역·투어)은 버린다.
const LONDON = {
  spx: ['stpaul', 1], bor: ['borough', 1], tower: ['tower', 1], tb: ['towerbridge', 1], buck: ['buckingham', 1],
  bm: ['britishmuseum', 1], shard: ['shard', 1],
  mb: ['millennium', 2], tate: ['tate', 2], city: ['cityarch', 2], g120: ['garden120', 2], quad: ['carnaby', 2],
  traf: ['trafalgar', 2], stp: ['stpancras', 2], som: ['somerset', 2],
  fort: ['fortnum', 3], nash: ['themall', 3], gp: ['greenpark', 3],
};
const PARIS = {
  eiffel: ['eiffel', 1], louvre: ['louvre', 1], orsay: ['orsay', 1], sainte: ['saintechapelle', 1],
  orange: ['orangerie', 2], garnier: ['garnier', 2], petit: ['petitpalais', 2], grand: ['grandpalais', 2], bourse: ['bourse', 2],
  troca: ['trocadero', 2], marais: ['marais', 2], germain: ['saintgermain', 2], laroche: ['laroche', 2],
  samar: ['samaritaine', 2], seine: ['pontneuf', 2],
  laf: ['lafayette', 3], stdenis: ['saintdenis', 3], champ: ['champdemars', 3],
};
// 참고 도구에 정류장이 없던 대표 장소
const EXTRA = {
  london: [
    { id: 'bigben', name: '빅벤 · 웨스트민스터', lat: 51.5007, lng: -0.1246, weight: 1, opts: [{ label: '밖에서 보기', min: 30 }], default: 0, note: '국회의사당 시계탑. 강 건너 남쪽 둑이나 웨스트민스터 다리에서 정면이 잡힌다. 밤에 조명이 들어오면 그때가 본체다.', q: 'Big Ben Westminster London' },
    { id: 'londoneye', name: '런던아이', lat: 51.5033, lng: -0.1196, weight: 1, opts: [{ label: '밖에서 보기', min: 20 }, { label: '타기', min: 60 }], default: 0, note: '2000년 밀레니엄 관람차. 한 바퀴 30분. 빅벤 건너편이라 둘을 한 자리에서 본다.', q: 'London Eye' },
    { id: 'covent', name: '코벤트 가든', lat: 51.5117, lng: -0.1240, weight: 2, opts: [{ label: '광장만', min: 30 }, { label: '시장 안까지', min: 70 }], default: 0, note: '이니고 존스가 1630년대에 만든 영국 최초의 계획 광장. 시장 건물은 1830년, 거리 공연이 상설이다.', q: 'Covent Garden London' },
    { id: 'hydepark', name: '하이드 파크', lat: 51.5073, lng: -0.1657, weight: 3, opts: [{ label: '걷기', min: 60 }], default: 0, note: '런던에서 가장 큰 왕립공원. 서펜타인 호수 둘레를 걷는다.', q: 'Hyde Park London' },
    { id: 'kensington', name: '켄싱턴 궁전', lat: 51.5050, lng: -0.1877, weight: 3, opts: [{ label: '밖에서만', min: 30 }, { label: '안까지', min: 90 }], default: 0, note: '하이드파크 서쪽 끝. 다이애나가 살던 궁.', q: 'Kensington Palace' },
    { id: 'portobello', name: '포토벨로 마켓', lat: 51.5173, lng: -0.2050, weight: 3, opts: [{ label: '둘러보기', min: 90 }], default: 0, note: '노팅힐의 골동품·빈티지 거리 시장. 토요일이 본장이다.', q: 'Portobello Road Market' },
  ],
  paris: [
    { id: 'arc', name: '개선문', lat: 48.8738, lng: 2.2950, weight: 1, opts: [{ label: '밖에서만', min: 30 }, { label: '옥상까지', min: 90 }], default: 0, note: '옥상(284계단)에 올라야 값을 한다 — 12개 대로가 별처럼 뻗는 평면은 위에서만 보인다. 로터리는 지하도로 건넌다.', q: 'Arc de Triomphe Paris' },
    { id: 'montmartre', name: '몽마르트 · 사크레쾨르', lat: 48.8867, lng: 2.3431, weight: 1, opts: [{ label: '성당과 광장', min: 90 }, { label: '언덕 전체', min: 150 }], default: 0, note: '파리에서 가장 높은 언덕. 사크레쾨르 앞 계단에서 도시 전체가 내려다보이고, 테르트르 광장에 화가들이 있다.', q: 'Sacre-Coeur Montmartre Paris' },
    { id: 'pantheon', name: '판테온 · 소르본', lat: 48.8462, lng: 2.3464, weight: 2, opts: [{ label: '밖에서만', min: 30 }, { label: '안까지', min: 75 }], default: 0, note: '수플로, 1790. 신고전주의 돔. 라탱 지구 한가운데고 소르본이 바로 옆이다.', q: 'Pantheon Paris' },
    { id: 'luxembourg', name: '뤽상부르 공원', lat: 48.8462, lng: 2.3372, weight: 2, opts: [{ label: '걷기', min: 45 }, { label: '앉아서 쉬기', min: 75 }], default: 0, note: '파리 시민이 가장 사랑하는 공원. 의자를 끌어다 분수 앞에 앉는 게 정석이다.', q: 'Jardin du Luxembourg Paris' },
    { id: 'hoteldeville', name: '파리 시청', lat: 48.8566, lng: 2.3522, weight: 3, opts: [{ label: '광장에서', min: 20 }], default: 0, note: '19세기 신르네상스 양식의 시청사. 광장이 넓어 사진이 잘 나온다.', q: 'Hotel de Ville Paris' },
    { id: 'notredame', name: '노트르담 대성당', lat: 48.8530, lng: 2.3499, weight: 1, opts: [{ label: '외관 한 바퀴', min: 40 }, { label: '안까지', min: 90 }], default: 0, note: '2019년 화재 뒤 2024년 12월 재개관. 공중 부벽은 동쪽 뒤편에서 가장 잘 보인다 — 벽이 하중을 못 받으니 밖에서 받쳐 미는 구조다.', q: 'Notre-Dame de Paris' },
    { id: 'tuileries', name: '튈르리 정원', lat: 48.8635, lng: 2.3270, weight: 2, opts: [{ label: '걷기', min: 40 }, { label: '앉아서 쉬기', min: 60 }], default: 0, note: '르 노트르, 1664. 프랑스식 정형 정원의 원형이고, 이 축이 루브르에서 콩코르드·샹젤리제·개선문·라데팡스까지 8km를 직선으로 관통한다.', q: 'Jardin des Tuileries Paris' },
  ],
};

function build(city, name, center, map, stops) {
  const seen = new Set(); const places = [];
  for (const s of stops) {
    if (!(s.id in map) || seen.has(s.id)) continue; seen.add(s.id);
    const [id, weight] = map[s.id];
    const opts = s.opts.filter(o => o.m > 0).map(o => ({ label: o.l, min: o.m }));   // 「안 감」(0분)은 체크박스가 대신하므로 뺀다
    const picked = s.opts[s.pick];
    const def = Math.max(0, opts.findIndex(o => o.label === picked.l && o.min === picked.m));
    places.push({ id, name: s.n.replace(/ — .*$/, '').replace(/ \(.*\)$/, ''), lat: null, lng: null, weight, opts, default: def, note: clean(s.note), q: s.q || s.n });
  }
  return { city, name, center, places: [...places, ...EXTRA[city]] };
}
// 참고 도구의 정류장에는 lat/lng가 없고 지도 좌표(x,y)만 있다 → 아래 표에서 채운다.
const COORDS = {
  stpaul: [51.5138, -0.0984], borough: [51.5055, -0.0910], tower: [51.5081, -0.0759], towerbridge: [51.5055, -0.0754],
  buckingham: [51.5014, -0.1419], britishmuseum: [51.5194, -0.1270], shard: [51.5045, -0.0865], millennium: [51.5095, -0.0984],
  tate: [51.5076, -0.0994], cityarch: [51.5128, -0.0834], garden120: [51.5118, -0.0805], carnaby: [51.5115, -0.1400],
  trafalgar: [51.5080, -0.1281], stpancras: [51.5308, -0.1238], somerset: [51.5110, -0.1170], fortnum: [51.5080, -0.1383],
  themall: [51.5050, -0.1330], greenpark: [51.5067, -0.1428],
  eiffel: [48.8584, 2.2945], louvre: [48.8606, 2.3376], orsay: [48.8600, 2.3266],
  saintechapelle: [48.8554, 2.3450], orangerie: [48.8638, 2.3226], garnier: [48.8720, 2.3316], petitpalais: [48.8661, 2.3148],
  grandpalais: [48.8661, 2.3125], bourse: [48.8625, 2.3428], trocadero: [48.8620, 2.2877],
  marais: [48.8554, 2.3655], saintgermain: [48.8540, 2.3339], laroche: [48.8477, 2.2690], samaritaine: [48.8590, 2.3420],
  pontneuf: [48.8570, 2.3414], lafayette: [48.8738, 2.3320], saintdenis: [48.9358, 2.3597], champdemars: [48.8556, 2.2986],
};
const fill = c => { for (const p of c.places) if (p.lat == null) [p.lat, p.lng] = COORDS[p.id]; return c; };

mkdirSync('data', { recursive: true });
writeFileSync('data/london.json', JSON.stringify(fill(build('london', '런던', [51.507, -0.128], LONDON, flatten(grab('LONDON_DAYS')))), null, 1));
writeFileSync('data/paris.json',  JSON.stringify(fill(build('paris',  '파리', [48.857, 2.352],  PARIS,  flatten(grab('PARIS_DAYS')))),  null, 1));
console.log('data/london.json, data/paris.json 생성');
