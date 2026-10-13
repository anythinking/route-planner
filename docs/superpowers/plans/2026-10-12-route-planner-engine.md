# 여행 루트 플래너 — 1번 조각(경로 엔진) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 런던·파리 큐레이션 장소 중 고른 것 N곳을 M일로 나누고, 하루 순서·체류·이동 시각을 계산해 Leaflet 지도와 날짜 패널로 보여주는 정적 사이트.

**Architecture:** 순수 함수 엔진(`travel.js` → `engine.js`)이 DOM 없이 `plan(places, opts)`를 돌리고, `state.js`가 URL 해시를 상태로 왕복하며, `ui.js`가 그 둘을 Leaflet 지도와 3단계 화면에 묶는다. 데이터는 도시당 JSON 하나.

**Tech Stack:** 바닐라 ES 모듈 · Leaflet 1.9.4 (CDN, 유일한 외부 의존) · OpenStreetMap 타일 · Node 22 내장 테스트 러너(`node --test`) · GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-12-route-planner-design.md`

## Global Constraints

- 빌드 없음. 브라우저가 `src/*.js`를 ES 모듈로 직접 읽는다. 번들러·트랜스파일러 금지.
- 외부 의존은 Leaflet 1.9.4 하나. CDN 주소에 버전을 고정한다. npm 런타임 의존 0.
- `engine.js` · `travel.js` · `state.js`는 DOM·window·fetch를 건드리지 않는다 (node에서 그대로 돈다).
- 결정성: 모든 동률은 `id` 사전순으로 깬다. 같은 입력이면 항상 같은 출력.
- 이동시간 추정식은 스펙 그대로 — `d ≤ 2.0km`: `d × 1.3 / 4.5 × 60`분 도보, `d > 2.0km`: `15 + d × 1.0`분 지하철. 정수 반올림.
- 하루 예산 기본값 `dayStart=570`(9:30) `dayEnd=1140`(19:00). 묶기 단계의 소프트 한도는 `(dayEnd−dayStart) × 1.2`.
- 중요도 `weight`는 1·2·3 정수. 1이 가장 중요. 자르기 우선순위: weight 큰 수 → 체류 긴 것 → id.
- 사용자 장소는 `weight=1`, `opts` 1개, `must=true`, `id`는 `u0, u1, …`.
- UI 문구·`note`·커밋 메시지·주석은 한국어. 식별자는 영어.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **도시 밖 사용자 장소** (예: 50km 떨어진 핀) — 묶음 중심을 끌어당겨 나머지가 엉킨다. 기대: 계산은 끝나고(NaN 없음) 그 장소가 포함되며 다른 날이 깨지지 않는다. → Task 4 `plan() 이상치` 테스트.
2. **일수 > 장소 수** — 빈 날이 생긴다. 기대: `days.length === 장소 수`, 빈 날 없음. → Task 4 `M > n` 테스트.
3. **전부 꼭 가기인데 용량 초과** — 뺄 게 없다. 기대: `dropped` 비어 있고 그날 `over === true`, 화면에 경고. → Task 4 `전부 must` 테스트, Task 9 경고 표시.
4. **해시의 모르는 id·범위 밖 opt** (`p=없는곳:0,stpaul:9`) — 기대: 모르는 id는 버리고 opt는 마지막 선택지로 클램프. → Task 5 `resolvePlaces` 테스트.
5. **`e ≤ t`인 해시** (끝이 시작보다 이름) — 기대: 둘 다 기본값으로 복귀. → Task 5 `decode` 테스트.

---

## 파일 구조

| 파일 | 책임 | 의존 |
|---|---|---|
| `package.json` | `"type":"module"`, `npm test` | — |
| `src/travel.js` | 두 점 사이 거리(km)와 이동 분·수단 | — |
| `src/engine.js` | `seed → cluster → order → schedule → trim → plan` | travel |
| `src/state.js` | URL 해시 ↔ 상태, 해시+도시 데이터 → 엔진 입력 | — |
| `src/ui.js` | 3단계 화면, Leaflet 지도, 날짜 패널, 링크 복사 | engine · state · travel · window.L |
| `index.html` | 셸 + CSS + Leaflet CDN + `<script type="module">` | ui |
| `data/london.json` `data/paris.json` | 큐레이션 장소 | — |
| `scripts/extract-from-reference.js` | `reference/trip-plan.html`에서 장소를 뽑아 JSON 생성(1회성) | — |
| `scripts/validate-data.js` | JSON 스키마·좌표·고유성 검사 | — |
| `tests/travel.test.js` `tests/engine.test.js` `tests/state.test.js` | 위 셋의 테스트 | — |
| `reference/trip-plan.html` | 여행 때 쓴 도구. 데이터·패널 코드 출처. 서빙 안 함 | — |

---

### Task 1: 프로젝트 뼈대 + `travel.js`

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`, `src/travel.js`, `tests/travel.test.js`
- Move: `trip-plan.html` → `reference/trip-plan.html`; Delete: `london-plan.html`, `paris-plan.html`

**Interfaces:**
- Produces: `distanceKm(a, b) → number` (a·b는 `{lat, lng}`), `travelMin(a, b) → {min:number, mode:'walk'|'metro', km:number}`

- [ ] **Step 1: 뼈대 파일**

`package.json`:
```json
{
  "name": "route-planner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "validate": "node scripts/validate-data.js",
    "serve": "python3 -m http.server 8080"
  }
}
```

`.gitignore`:
```
.DS_Store
node_modules/
```

`README.md`:
```markdown
# 여행 루트 플래너

가고 싶은 곳을 고르면 며칠에 어떻게 나누고 하루에 어떤 순서로 돌지 계산해준다. 정적 사이트, 빌드 없음.

- 실행: `npm run serve` 후 http://localhost:8080
- 테스트: `npm test`
- 데이터 검사: `npm run validate`

설계: `docs/superpowers/specs/2026-10-12-route-planner-design.md`
```

```bash
mkdir -p reference src tests data scripts
git mv trip-plan.html reference/trip-plan.html
git rm -q london-plan.html paris-plan.html
```

- [ ] **Step 2: 실패하는 테스트**

`tests/travel.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, travelMin } from '../src/travel.js';

const STPAUL = { lat: 51.5138, lng: -0.0984 };
const BOROUGH = { lat: 51.5055, lng: -0.0910 };
const VAUXHALL = { lat: 51.4861, lng: -0.1253 };

test('같은 점은 0', () => {
  assert.equal(distanceKm(STPAUL, STPAUL), 0);
  assert.deepEqual(travelMin(STPAUL, STPAUL), { min: 0, mode: 'walk', km: 0 });
});

test('세인트폴→버러는 약 1km, 도보', () => {
  const d = distanceKm(STPAUL, BOROUGH);
  assert.ok(d > 0.9 && d < 1.2, `d=${d}`);
  const t = travelMin(STPAUL, BOROUGH);
  assert.equal(t.mode, 'walk');
  assert.ok(t.min >= 15 && t.min <= 25, `min=${t.min}`);   // 여행 때 실측 25±8
});

test('복셀→세인트폴은 2km 넘어 지하철', () => {
  const t = travelMin(VAUXHALL, STPAUL);
  assert.equal(t.mode, 'metro');
  assert.ok(t.min >= 17 && t.min <= 30, `min=${t.min}`);   // 실측 25~30
});

test('2.0km 경계: 이하 도보, 초과 지하철', () => {
  // 위도 1도 ≈ 111.2km → 2.0km ≈ 0.01799도
  const a = { lat: 50, lng: 0 };
  assert.equal(travelMin(a, { lat: 50 + 1.99 / 111.2, lng: 0 }).mode, 'walk');
  assert.equal(travelMin(a, { lat: 50 + 2.01 / 111.2, lng: 0 }).mode, 'metro');
});

test('분은 정수', () => {
  const t = travelMin(STPAUL, BOROUGH);
  assert.equal(t.min, Math.round(t.min));
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/travel.js'`

- [ ] **Step 4: 구현**

`src/travel.js`:
```js
// 두 점 사이 거리와 이동시간 추정. 라우팅 API 없이 결정적으로.
const R = 6371; // km
const toRad = d => d * Math.PI / 180;

export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 스펙: d ≤ 2.0km 도보(우회 1.3, 4.5km/h) · 초과는 지하철(접근 15분 + km당 1분)
export function travelMin(a, b) {
  const km = distanceKm(a, b);
  if (km <= 2.0) return { min: Math.round(km * 1.3 / 4.5 * 60), mode: 'walk', km };
  return { min: Math.round(15 + km * 1.0), mode: 'metro', km };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 6: 커밋**

```bash
git add package.json .gitignore README.md src/travel.js tests/travel.test.js reference/
git commit -m "feat: 프로젝트 뼈대와 이동시간 추정(travel.js)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — `seed`와 `cluster`

**Files:**
- Create: `src/engine.js`, `tests/engine.test.js`

**Interfaces:**
- Consumes: `distanceKm`, `travelMin` (Task 1)
- Produces: `dwell(p) → number`, `seed(places, M) → Place[]`, `cluster(places, seeds, budget) → Place[][]`
- `Place` = `{id, name, lat, lng, weight:1|2|3, opts:[{label,min}], opt:number, must:boolean}`

- [ ] **Step 1: 실패하는 테스트**

`tests/engine.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dwell, seed, cluster } from '../src/engine.js';

// 런던 축소 픽스처. 동쪽(시티·버러) 5곳, 서쪽(웨스트엔드) 5곳.
const P = (id, name, lat, lng, weight, min, extra = {}) =>
  ({ id, name, lat, lng, weight, opts: [{ label: '보기', min }], opt: 0, must: false, ...extra });
export const LONDON = [
  P('stpaul',   '세인트폴',     51.5138, -0.0984, 1, 30),
  P('borough',  '버러 마켓',    51.5055, -0.0910, 1, 120),
  P('tower',    '런던탑',       51.5081, -0.0759, 1, 35),
  P('towerbr',  '타워브릿지',   51.5055, -0.0754, 1, 20),
  P('shard',    '더 샤드',      51.5045, -0.0865, 2, 90),
  P('buck',     '버킹엄',       51.5014, -0.1419, 1, 105),
  P('garnier',  '카페 로열',    51.5095, -0.1366, 3, 60),
  P('soho',     '소호',         51.5130, -0.1388, 2, 60),
  P('bm',       '영국박물관',   51.5194, -0.1270, 1, 90),
  P('traf',     '트라팔가',     51.5080, -0.1281, 2, 30),
];
export const HOTEL = { lat: 51.4861, lng: -0.1253 }; // 복셀
const withMust = (list, ids) => list.map(p => ({ ...p, must: ids.includes(p.id) }));

test('dwell은 고른 선택지의 분', () => {
  const p = { ...LONDON[0], opts: [{ label: 'a', min: 30 }, { label: 'b', min: 105 }], opt: 1 };
  assert.equal(dwell(p), 105);
});

test('seed: 꼭 가기가 M개 이상이면 그중 서로 먼 M개', () => {
  const s = seed(withMust(LONDON, ['borough', 'buck', 'tower']), 2);
  assert.equal(s.length, 2);
  const ids = s.map(p => p.id).sort();
  assert.deepEqual(ids, ['borough', 'buck']);   // 동·서로 가장 먼 쌍
});

test('seed: 꼭 가기가 모자라면 weight 1부터 채운다', () => {
  const s = seed(withMust(LONDON, ['borough']), 2);
  assert.equal(s[0].id, 'borough');
  assert.equal(s[1].weight, 1);
  assert.notEqual(s[1].id, 'borough');
});

test('seed: 장소가 M보다 적으면 M을 줄인다', () => {
  assert.equal(seed(LONDON.slice(0, 2), 5).length, 2);
});

test('seed: 결정적', () => {
  const a = seed(LONDON, 3).map(p => p.id), b = seed(LONDON, 3).map(p => p.id);
  assert.deepEqual(a, b);
});

test('cluster: 동서로 갈린다', () => {
  const s = seed(withMust(LONDON, ['borough', 'buck']), 2);
  const g = cluster(LONDON, s, 570);
  assert.equal(g.length, 2);
  const east = g.find(x => x.some(p => p.id === 'borough')).map(p => p.id).sort();
  assert.deepEqual(east, ['borough', 'shard', 'stpaul', 'tower', 'towerbr']);
  assert.equal(g.flat().length, LONDON.length);   // 빠진 장소 없음
});

test('cluster: 한 묶음이 예산×1.2를 넘치면 낮은 중요도를 옆으로 넘긴다', () => {
  // 동쪽에 체류 600분짜리를 하나 더 → 동쪽 합이 한도를 넘는다
  const fat = [...LONDON, P('fat', '뚱뚱한 곳', 51.5060, -0.0900, 3, 600)];
  const s = seed(withMust(fat, ['borough', 'buck']), 2);
  const g = cluster(fat, s, 570);                 // 한도 684
  const sum = grp => grp.reduce((t, p) => t + dwell(p), 0);
  // 넘길 수 있는 건 넘겼거나(서쪽이 받았거나), 받을 곳이 없어 그대로다 — 어느 쪽이든 전체 장소 수는 보존
  assert.equal(g.flat().length, fat.length);
  assert.ok(g.every(grp => grp.length > 0));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/engine.js'`

- [ ] **Step 3: 구현**

`src/engine.js`:
```js
// 경로 엔진. 순수 함수. DOM 없음.
import { distanceKm, travelMin } from './travel.js';

export const dwell = p => p.opts[p.opt].min;
export const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// 자르기·넘기기 우선순위: weight 큰 수(=낮은 순위) → 체류 긴 것 → id
const dropOrder = (a, b) => (b.weight - a.weight) || (dwell(b) - dwell(a)) || byId(a, b);
// 평면 근사 거리² (묶기용 — 도시 규모에선 충분)
const planar = (a, b) => {
  const k = Math.cos(a.lat * Math.PI / 180);
  return (a.lat - b.lat) ** 2 + ((a.lng - b.lng) * k) ** 2;
};

// 이미 고른 것들에서 가장 먼 후보. 동률이면 앞 것(= id 순).
function farthest(cands, chosen) {
  let best = null, bestD = -1;
  for (const c of cands) {
    const d = chosen.length ? Math.min(...chosen.map(s => distanceKm(s, c))) : 0;
    if (d > bestD) { bestD = d; best = c; }
  }
  return best;
}

// 묶음 M개의 씨앗. 꼭 가기 중 서로 먼 순 → 모자라면 weight 1→2→3 순.
export function seed(places, M) {
  M = Math.min(M, places.length);
  const seeds = [];
  const take = pool => {
    while (seeds.length < M && pool.length) {
      const pick = seeds.length ? farthest(pool, seeds) : pool[0];
      seeds.push(pick); pool.splice(pool.indexOf(pick), 1);
    }
  };
  take(places.filter(p => p.must).sort(byId));
  for (const w of [1, 2, 3]) take(places.filter(p => !p.must && p.weight === w).sort(byId));
  return seeds;
}

// k-means 10바퀴 + 균형 3바퀴. 빈 묶음은 버린다.
export function cluster(places, seeds, budget) {
  const M = seeds.length;
  let cents = seeds.map(s => ({ lat: s.lat, lng: s.lng }));
  let groups = [];
  for (let round = 0; round < 10; round++) {
    groups = Array.from({ length: M }, () => []);
    for (const p of [...places].sort(byId)) {
      let bi = 0, bd = Infinity;
      cents.forEach((c, i) => { const d = planar(p, c); if (d < bd) { bd = d; bi = i; } });
      groups[bi].push(p);
    }
    cents = groups.map((g, i) => g.length
      ? { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lng, 0) / g.length }
      : cents[i]);
  }
  const sum = g => g.reduce((s, p) => s + dwell(p), 0);
  const cap = budget * 1.2;
  for (let round = 0; round < 3; round++) {
    groups.forEach((g, gi) => {
      if (sum(g) <= cap) return;
      const cand = g.filter(p => !p.must).sort(dropOrder)[0];
      if (!cand) return;
      let best = -1, bd = Infinity;
      groups.forEach((h, hi) => {
        if (hi === gi || sum(h) + dwell(cand) > cap) return;
        const d = planar(cand, cents[hi]);
        if (d < bd) { bd = d; best = hi; }
      });
      if (best >= 0) { g.splice(g.indexOf(cand), 1); groups[best].push(cand); }
    });
  }
  return groups.filter(g => g.length);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `# fail 0` (travel 5 + engine 7)

- [ ] **Step 5: 커밋**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "feat: 엔진 씨앗·묶기(seed, cluster)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 엔진 — `order`와 `schedule`

**Files:**
- Modify: `src/engine.js` (끝에 추가), `tests/engine.test.js` (끝에 추가)

**Interfaces:**
- Consumes: `travelMin` (Task 1), `dwell` (Task 2)
- Produces: `order(group, start) → Place[]`, `schedule(ordered, start, dayStart) → Day`
- `Day` = `{stops:[{place, arrive, depart, travelMin, travelMode}], walkKm, moveMin, end, over:boolean, why:string}`

- [ ] **Step 1: 실패하는 테스트** (`tests/engine.test.js` 끝에 추가; import 줄에 `order, schedule` 추가)

```js
import { order, schedule } from '../src/engine.js';
import { travelMin } from '../src/travel.js';

const pathCost = (seq, start) => { let c = 0, prev = start; for (const p of seq) { c += travelMin(prev, p).min; prev = p; } return c; };
const perms = arr => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r]));

test('order(≤7): 완전탐색 최소와 같다', () => {
  const east = LONDON.filter(p => ['stpaul', 'borough', 'tower', 'towerbr', 'shard'].includes(p.id));
  const got = order(east, HOTEL);
  const best = Math.min(...perms(east).map(s => pathCost(s, HOTEL)));
  assert.equal(pathCost(got, HOTEL), best);
  assert.equal(got.length, 5);
});

test('order(>7): 최근접+2-opt, 전부 포함', () => {
  const got = order(LONDON, HOTEL);          // 10곳
  assert.equal(got.length, 10);
  assert.deepEqual(got.map(p => p.id).sort(), LONDON.map(p => p.id).sort());
});

test('order: 결정적', () => {
  const a = order(LONDON, HOTEL).map(p => p.id), b = order(LONDON, HOTEL).map(p => p.id);
  assert.deepEqual(a, b);
});

test('schedule: 도착·출발이 체류·이동으로 쌓인다', () => {
  const seq = [LONDON[0], LONDON[1]];          // 세인트폴(30) → 버러(120)
  const d = schedule(seq, HOTEL, 570);
  const t0 = travelMin(HOTEL, seq[0]).min, t1 = travelMin(seq[0], seq[1]).min;
  assert.equal(d.stops[0].arrive, 570 + t0);
  assert.equal(d.stops[0].depart, 570 + t0 + 30);
  assert.equal(d.stops[1].arrive, 570 + t0 + 30 + t1);
  assert.equal(d.stops[1].depart, 570 + t0 + 30 + t1 + 120);
  assert.equal(d.end, d.stops[1].depart);
  assert.equal(d.moveMin, t0 + t1);
  assert.equal(d.over, false);
});

test('schedule: 빈 입력은 빈 날', () => {
  const d = schedule([], HOTEL, 570);
  assert.deepEqual(d.stops, []); assert.equal(d.end, 570);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `order is not a function` (또는 export 없음)

- [ ] **Step 3: 구현** (`src/engine.js` 끝에 추가)

```js
function pathCost(seq, start) {
  let c = 0, prev = start;
  for (const p of seq) { c += travelMin(prev, p).min; prev = p; }
  return c;
}
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r]));
}

// 하루 안 방문 순서. 7곳 이하 완전탐색, 그 위는 최근접 + 2-opt.
export function order(group, start) {
  const g = [...group].sort(byId);
  if (g.length === 0) return [];
  if (g.length <= 7) {
    let best = null, bc = Infinity;
    for (const seq of permutations(g)) {           // id 사전순 생성 → 동률은 첫 것
      const c = pathCost(seq, start);
      if (c < bc) { bc = c; best = seq; }
    }
    return best;
  }
  const left = [...g], seq = []; let prev = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = travelMin(prev, p).min; if (d < bd) { bd = d; bi = i; } });
    prev = left[bi]; seq.push(prev); left.splice(bi, 1);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) for (let k = i + 1; k < seq.length; k++) {
      const cand = [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)];
      if (pathCost(cand, start) < pathCost(seq, start)) { seq.splice(0, seq.length, ...cand); improved = true; }
    }
  }
  return seq;
}

// 순서대로 시각을 쌓는다.
export function schedule(ordered, start, dayStart) {
  const stops = []; let cur = dayStart, prev = start, walkKm = 0, moveMin = 0;
  for (const p of ordered) {
    const t = travelMin(prev, p);
    const arrive = cur + t.min, depart = arrive + dwell(p);
    stops.push({ place: p, arrive, depart, travelMin: t.min, travelMode: t.mode });
    if (t.mode === 'walk') walkKm += t.km;
    moveMin += t.min; cur = depart; prev = p;
  }
  return { stops, walkKm: Math.round(walkKm * 10) / 10, moveMin, end: cur, over: false, why: '' };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "feat: 엔진 순서·시간(order, schedule)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 엔진 — `trim`, `why`, `plan()`

**Files:**
- Modify: `src/engine.js` (끝에 추가), `tests/engine.test.js` (끝에 추가)

**Interfaces:**
- Consumes: Task 2·3의 전부
- Produces: `trim(day, ctx) → {day, dropped}` (`ctx = {start, dayStart, dayEnd, dayIndex}`), `plan(places, {days, start, dayStart, dayEnd}) → {days: Day[], dropped: {place, reason}[]}`

- [ ] **Step 1: 실패하는 테스트** (끝에 추가; import에 `trim, plan, hm` 추가)

```js
import { trim, plan, hm } from '../src/engine.js';

test('hm', () => { assert.equal(hm(570), '9:30'); assert.equal(hm(1140), '19:00'); });

test('trim: 넘치면 꼭 가기 아닌 최하 중요도부터 뺀다', () => {
  const east = withMust(LONDON.filter(p => ['stpaul', 'borough', 'tower', 'towerbr', 'shard'].includes(p.id)), ['borough']);
  const day0 = schedule(order(east, HOTEL), HOTEL, 570);
  // 예산을 아주 짧게 줘서 반드시 넘치게
  const { day, dropped } = trim(day0, { start: HOTEL, dayStart: 570, dayEnd: 570 + 150, dayIndex: 0 });
  assert.ok(dropped.length > 0);
  assert.equal(dropped[0].place.id, 'shard');            // weight 2 · 체류 90 → 가장 먼저
  assert.ok(dropped.every(d => d.place.id !== 'borough')); // 꼭 가기는 안 뺀다
  assert.ok(day.stops.some(s => s.place.id === 'borough'));
  assert.match(dropped[0].reason, /1일차가 12:00을 \d+분 넘겨서/);
});

test('trim: 전부 꼭 가기면 못 빼고 over=true', () => {
  const all = withMust(LONDON.slice(0, 3), ['stpaul', 'borough', 'tower']);
  const day0 = schedule(order(all, HOTEL), HOTEL, 570);
  const { day, dropped } = trim(day0, { start: HOTEL, dayStart: 570, dayEnd: 600, dayIndex: 2 });
  assert.equal(dropped.length, 0);
  assert.equal(day.over, true);
  assert.equal(day.stops.length, 3);
});

test('plan: 기본 — 전부 배정, 어느 날도 dayEnd 초과 없음, 꼭 가기 전부 포함', () => {
  const places = withMust(LONDON, ['borough', 'buck']);
  const r = plan(places, { days: 3, start: HOTEL, dayStart: 570, dayEnd: 1140 });
  const placed = r.days.flatMap(d => d.stops.map(s => s.place.id));
  assert.equal(placed.length + r.dropped.length, places.length);
  assert.ok(placed.includes('borough') && placed.includes('buck'));
  for (const d of r.days) { assert.ok(d.end <= 1140 || d.over, `end=${d.end}`); assert.ok(d.stops.length > 0); assert.ok(d.why.length > 0); }
});

test('plan: 결정적', () => {
  const a = JSON.stringify(plan(LONDON, { days: 3, start: HOTEL }));
  const b = JSON.stringify(plan(LONDON, { days: 3, start: HOTEL }));
  assert.equal(a, b);
});

test('plan: M > n 이면 빈 날 없이 n일', () => {
  const r = plan(LONDON.slice(0, 2), { days: 5, start: HOTEL });
  assert.equal(r.days.length, 2);
});

test('plan: 빈 입력', () => {
  assert.deepEqual(plan([], { days: 3, start: HOTEL }), { days: [], dropped: [] });
});

test('plan: 도시 밖 이상치가 있어도 NaN 없이 전부 배정된다', () => {
  const far = { ...P('far', '먼 곳', 51.9, -0.6, 1, 60), must: true };   // ~50km
  const r = plan([...LONDON, far], { days: 3, start: HOTEL });
  const placed = r.days.flatMap(d => d.stops.map(s => s.place.id));
  assert.ok(placed.includes('far'));
  assert.equal(placed.length + r.dropped.length, LONDON.length + 1);
  for (const d of r.days) for (const s of d.stops) assert.ok(Number.isFinite(s.arrive) && Number.isFinite(s.depart));
});

test('plan: 뺀 것은 그날의 최하 중요도', () => {
  // 하루 예산을 짧게 → 자르기 발생. 뺀 것들의 weight가 남은 것들보다 작지 않아야 한다(날 단위로)
  const r = plan(LONDON, { days: 1, start: HOTEL, dayStart: 570, dayEnd: 800 });
  assert.ok(r.dropped.length > 0);
  const keptMinW = Math.min(...r.days[0].stops.map(s => s.place.weight));
  for (const d of r.dropped) assert.ok(d.place.weight >= keptMinW);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `trim is not a function`

- [ ] **Step 3: 구현** (`src/engine.js` 끝에 추가)

```js
// 예산 초과 해소. 꼭 가기 아닌 것 중 최하 중요도를 빼고 순서·시간을 다시 돈다.
export function trim(day, ctx) {
  const dropped = [];
  let stops = day.stops.map(s => s.place);
  let d = day;
  while (d.end > ctx.dayEnd) {
    const cand = stops.filter(p => !p.must).sort(dropOrder)[0];
    if (!cand) { d.over = true; break; }
    dropped.push({ place: cand, reason: `${ctx.dayIndex + 1}일차가 ${hm(ctx.dayEnd)}을 ${d.end - ctx.dayEnd}분 넘겨서` });
    stops = stops.filter(p => p !== cand);
    d = schedule(order(stops, ctx.start), ctx.start, ctx.dayStart);
  }
  return { day: d, dropped };
}

function why(day) {
  const ps = day.stops.map(s => s.place);
  const must = ps.filter(p => p.must).sort(byId)[0];
  if (must) return `꼭 가기 ${must.name} 중심`;
  if (ps.length < 2) return '하루에 하나';
  let maxD = 0;
  for (const a of ps) for (const b of ps) maxD = Math.max(maxD, distanceKm(a, b));
  return `서로 ${maxD.toFixed(1)}km 안`;
}

// 전체: 씨앗 → 묶기 → (순서 → 시간 → 자르기) × 날
export function plan(places, { days, start, dayStart = 570, dayEnd = 1140 }) {
  if (!places.length) return { days: [], dropped: [] };
  const M = Math.min(days, places.length);
  const groups = cluster(places, seed(places, M), dayEnd - dayStart);
  const out = [], dropped = [];
  groups.forEach((g, i) => {
    const d0 = schedule(order(g, start), start, dayStart);
    const { day, dropped: dr } = trim(d0, { start, dayStart, dayEnd, dayIndex: i });
    dropped.push(...dr);
    if (day.stops.length) { day.why = why(day); out.push(day); }
  });
  return { days: out, dropped };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "feat: 엔진 자르기·설명·plan()

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `state.js` — URL 해시 ↔ 상태

**Files:**
- Create: `src/state.js`, `tests/state.test.js`

**Interfaces:**
- Produces: `DEFAULTS`, `encode(state) → string`, `decode(hash) → state`, `resolvePlaces(state, cityData) → Place[]`
- `state` = `{c:string, d:int, t:int, e:int, s:{lat,lng}|null, p:{[id]:optIdx}, m:string[], u:[{name,lat,lng,min}]}`
- `cityData` = `data/<city>.json` 내용

- [ ] **Step 1: 실패하는 테스트**

`tests/state.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, encode, decode, resolvePlaces } from '../src/state.js';

const CITY = { city: 'london', name: '런던', center: [51.507, -0.128], places: [
  { id: 'stpaul', name: '세인트폴', lat: 51.5138, lng: -0.0984, weight: 1,
    opts: [{ label: '밖에서만', min: 30 }, { label: '돔까지', min: 105 }], default: 0, note: '' },
  { id: 'borough', name: '버러', lat: 51.5055, lng: -0.0910, weight: 1,
    opts: [{ label: '안까지', min: 120 }], default: 0, note: '' },
] };

test('encode→decode 왕복', () => {
  const st = { c: 'paris', d: 4, t: 600, e: 1200, s: { lat: 48.8506, lng: 2.2866 },
    p: { stpaul: 1, borough: 0 }, m: ['borough'], u: [{ name: '이코이', lat: 51.512, lng: -0.113, min: 180 }] };
  const back = decode('#' + encode(st));
  assert.deepEqual(back, st);
});

test('빈 해시·깨진 해시는 기본값', () => {
  assert.deepEqual(decode(''), DEFAULTS);
  assert.deepEqual(decode('#%%%'), DEFAULTS);
  assert.deepEqual(decode('#d=abc&t=-5&e=9999'), DEFAULTS);
});

test('e ≤ t 이면 둘 다 기본값', () => {
  const st = decode('#t=900&e=600');
  assert.equal(st.t, DEFAULTS.t); assert.equal(st.e, DEFAULTS.e);
});

test('m은 p의 부분집합만', () => {
  const st = decode('#p=stpaul:0&m=stpaul,ghost');
  assert.deepEqual(st.m, ['stpaul']);
});

test('resolvePlaces: 모르는 id는 버리고 opt는 클램프', () => {
  const st = decode('#p=stpaul:9,ghost:0,borough:0&m=borough');
  const r = resolvePlaces(st, CITY);
  assert.deepEqual(r.map(p => p.id), ['borough', 'stpaul']);
  assert.equal(r.find(p => p.id === 'stpaul').opt, 1);      // 9 → 마지막(1)
  assert.equal(r.find(p => p.id === 'borough').must, true);
  assert.equal(r.find(p => p.id === 'stpaul').must, false);
});

test('resolvePlaces: 사용자 장소는 u0.. weight1 must', () => {
  const st = decode('#u=이코이~51.512~-0.113~180');
  const r = resolvePlaces(st, CITY);
  assert.equal(r.length, 1);
  assert.deepEqual({ id: r[0].id, weight: r[0].weight, must: r[0].must, min: r[0].opts[0].min }, { id: 'u0', weight: 1, must: true, min: 180 });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/state.js'`

- [ ] **Step 3: 구현**

`src/state.js`:
```js
// URL 해시 ↔ 상태. 저장소 없음: 링크가 곧 저장.
export const DEFAULTS = { c: 'london', d: 3, t: 570, e: 1140, s: null, p: {}, m: [], u: [] };

export function encode(st) {
  const q = new URLSearchParams();
  q.set('c', st.c); q.set('d', st.d); q.set('t', st.t); q.set('e', st.e);
  if (st.s) q.set('s', `${st.s.lat.toFixed(5)},${st.s.lng.toFixed(5)}`);
  const ids = Object.keys(st.p).sort();
  if (ids.length) q.set('p', ids.map(id => `${id}:${st.p[id]}`).join(','));
  if (st.m.length) q.set('m', [...st.m].sort().join(','));
  if (st.u.length) q.set('u', st.u.map(x => [x.name, x.lat.toFixed(5), x.lng.toFixed(5), x.min].join('~')).join('|'));
  return q.toString();
}

export function decode(hash) {
  const st = structuredClone(DEFAULTS);
  let q;
  try { q = new URLSearchParams((hash || '').replace(/^#/, '')); } catch { return st; }
  const int = (k, lo, hi, def) => {
    if (!q.has(k)) return def;
    const v = Number(q.get(k));
    return Number.isInteger(v) && v >= lo && v <= hi ? v : NaN;
  };
  const d = int('d', 1, 10, st.d), t = int('t', 0, 1439, st.t), e = int('e', 1, 1440, st.e);
  if ([d, t, e].some(Number.isNaN)) return structuredClone(DEFAULTS);
  st.d = d; st.t = t; st.e = e;
  if (st.e <= st.t) { st.t = DEFAULTS.t; st.e = DEFAULTS.e; }
  if (q.get('c')) st.c = q.get('c');
  const s = (q.get('s') || '').split(',');
  if (s.length === 2 && s.every(x => x !== '' && Number.isFinite(+x))) st.s = { lat: +s[0], lng: +s[1] };
  for (const tok of (q.get('p') || '').split(',').filter(Boolean)) {
    const [id, o] = tok.split(':');
    if (id) st.p[id] = Math.max(0, parseInt(o) || 0);
  }
  st.m = (q.get('m') || '').split(',').filter(id => id in st.p);
  for (const tok of (q.get('u') || '').split('|').filter(Boolean)) {
    const [name, lat, lng, min] = tok.split('~');
    if (name && Number.isFinite(+lat) && Number.isFinite(+lng) && parseInt(min) > 0)
      st.u.push({ name, lat: +lat, lng: +lng, min: parseInt(min) });
  }
  return st;
}

// 해시 상태 + 도시 데이터 → 엔진 입력. 모르는 id 버림, opt 클램프, 사용자 장소는 must.
export function resolvePlaces(st, city) {
  const out = [];
  for (const place of [...city.places].sort((a, b) => a.id < b.id ? -1 : 1)) {
    if (!(place.id in st.p)) continue;
    const opt = Math.min(st.p[place.id], place.opts.length - 1);
    out.push({ ...place, opt, must: st.m.includes(place.id) });
  }
  st.u.forEach((u, i) => out.push({
    id: `u${i}`, name: u.name, lat: u.lat, lng: u.lng, weight: 1,
    opts: [{ label: '머물기', min: u.min }], opt: 0, must: true, user: true,
  }));
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: URL 해시 상태(state.js)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 데이터 추출 + 검사

**Files:**
- Create: `scripts/extract-from-reference.js`, `scripts/validate-data.js`, `data/london.json`, `data/paris.json`

**Interfaces:**
- Produces: `data/<city>.json` (스펙 1절 스키마). `npm run validate`가 0으로 끝난다.

- [ ] **Step 1: 검사 스크립트 먼저 (실패하는 상태)**

`scripts/validate-data.js`:
```js
// data/*.json 스키마·좌표·고유성 검사. 실패하면 exit 1.
import { readdirSync, readFileSync } from 'node:fs';
const BBOX = { london: [51.40, 51.60, -0.30, 0.05], paris: [48.80, 48.95, 2.20, 2.45] }; // latMin,latMax,lngMin,lngMax
let bad = 0;
const fail = (f, m) => { console.error(`✗ ${f}: ${m}`); bad++; };
const files = readdirSync('data').filter(f => f.endsWith('.json'));
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
  }
  console.log(`${f}: ${(c.places || []).length}곳`);
}
if (bad) { console.error(`${bad}건 실패`); process.exit(1); }
console.log('데이터 OK');
```

Run: `npm run validate`
Expected: `✗ data/: 파일 없음` → exit 1

- [ ] **Step 2: 추출 스크립트**

`scripts/extract-from-reference.js` — `reference/trip-plan.html`의 `LONDON_DAYS`·`PARIS_DAYS` 배열을 읽어 장소로 바꾼다. 어느 정류장을 장소로 쓸지, 중요도는 뭔지, 참고 도구에 없던 장소는 뭔지를 여기 표로 박는다.

```js
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
  themall: [51.5050, -0.1330], greenpark: [51.5067, -0.1428], coaldrops: [51.5355, -0.1255],
  eiffel: [48.8584, 2.2945], louvre: [48.8606, 2.3376], orsay: [48.8600, 2.3266], notredame: [48.8530, 2.3499],
  saintechapelle: [48.8554, 2.3450], orangerie: [48.8638, 2.3226], garnier: [48.8720, 2.3316], petitpalais: [48.8661, 2.3148],
  grandpalais: [48.8661, 2.3125], bourse: [48.8625, 2.3428], trocadero: [48.8620, 2.2877], tuileries: [48.8635, 2.3270],
  marais: [48.8554, 2.3655], saintgermain: [48.8540, 2.3339], laroche: [48.8477, 2.2690], samaritaine: [48.8590, 2.3420],
  pontneuf: [48.8570, 2.3414], lafayette: [48.8738, 2.3320], saintdenis: [48.9358, 2.3597], champdemars: [48.8556, 2.2986],
};
const fill = c => { for (const p of c.places) if (p.lat == null) [p.lat, p.lng] = COORDS[p.id]; return c; };

mkdirSync('data', { recursive: true });
writeFileSync('data/london.json', JSON.stringify(fill(build('london', '런던', [51.507, -0.128], LONDON, flatten(grab('LONDON_DAYS')))), null, 1));
writeFileSync('data/paris.json',  JSON.stringify(fill(build('paris',  '파리', [48.857, 2.352],  PARIS,  flatten(grab('PARIS_DAYS')))),  null, 1));
console.log('data/london.json, data/paris.json 생성');
```

주의 — `saintdenis`의 위도 48.9358은 파리 bbox(48.80–48.95) 안이다. 검사가 통과한다.

Run: `node scripts/extract-from-reference.js && npm run validate`
Expected: `london.json: 24곳`, `paris.json: 25곳`, `데이터 OK`. (곳 수는 ±2 허용 — 참고 도구의 id가 하나라도 빠지면 그만큼 준다. **0이면 `grab`의 문자열 경계를 확인.**)

- [ ] **Step 3: 눈으로 확인**

```bash
node -e 'const c=JSON.parse(require("fs").readFileSync("data/london.json"));for(const p of c.places)console.log(p.weight,p.id,p.name,p.opts.map(o=>o.label+o.min).join("/"))'
```
Expected: 24줄 안팎. `note`가 비어 있는 장소가 있으면 참고 도구의 그 정류장 `note`를 보고 손으로 채운다(스펙: `note` 필수).

- [ ] **Step 4: 커밋**

```bash
git add scripts/ data/
git commit -m "feat: 런던·파리 장소 데이터와 검사 스크립트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `index.html` + 지도 + 1단계(설정)

**Files:**
- Create: `index.html`, `src/ui.js`

**Interfaces:**
- Consumes: `decode`, `encode`, `DEFAULTS` (Task 5); `window.L` (Leaflet)
- Produces: 전역 `app` 객체는 만들지 않는다. `ui.js`가 모듈 스코프에 `state`·`map`·`city`를 두고, 이후 Task가 같은 파일의 함수를 추가한다: `setState(patch)`, `goStep(n)`, `loadCity(id) → Promise<cityData>`.

- [ ] **Step 1: `index.html`**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>여행 루트 플래너</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
:root{--bg:#faf8f4;--surface:#fff;--sunk:#f2eee7;--fg:#22201c;--muted:#6f6a62;--faint:#9b958b;--line:#e2ddd4;
  --d1:#15696c;--d2:#a0372b;--d3:#9a6a10;--d4:#5b4a9e;--d5:#3f6b3a;--d6:#8a3a6e;--d7:#2f6a9a;--d8:#6b5a2a;--d9:#3a7a7a;--d10:#7a3a3a;
  --warn:#b3321f;--warn-soft:#fae6e2;--gold:#c99a18;--gold-soft:#f7ecc9}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;overflow:hidden}
.app{height:100%;max-width:1560px;margin-inline:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px}
h1{font-size:20px;margin:0;font-weight:700}
.steps{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}
.steps button{font:inherit;font-size:13px;font-weight:600;padding:6px 16px;border:0;border-right:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}
.steps button:last-child{border-right:0}.steps button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
.layout{flex:1;min-height:0;display:grid;grid-template-columns:2fr 1fr;gap:16px}
#map{min-height:340px;border:1px solid var(--line);border-radius:4px}
.side{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding-right:4px}
.panel{border:1px solid var(--line);border-radius:4px;background:var(--surface);padding:16px}
.panel h2{font-size:17px;margin:0 0 8px}.panel p{margin:0 0 8px;color:var(--muted)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:8px 0}
.stepper{display:inline-flex;border:1px solid var(--line);border-radius:3px;overflow:hidden;background:var(--bg)}
.stepper button{border:0;background:transparent;font:inherit;font-weight:700;padding:3px 10px;cursor:pointer}
.stepper .val{padding:3px 10px;border-inline:1px solid var(--line);font-variant-numeric:tabular-nums;font-weight:600}
.btn{font:inherit;font-weight:600;padding:7px 14px;border-radius:3px;border:1px solid var(--line);background:var(--bg);cursor:pointer}
.btn.primary{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.muted{color:var(--muted);font-size:12.5px}
@media (max-width:1000px){html,body{height:auto}body{overflow:visible}.app{height:auto}.layout{display:flex;flex-direction:column}#map{height:60vh}.side{overflow:visible}}
</style>
</head>
<body>
<div class="app">
  <header>
    <h1>여행 루트 플래너</h1>
    <div class="steps" id="steps"></div>
  </header>
  <div class="layout">
    <div id="map"></div>
    <aside class="side" id="side"></aside>
  </div>
</div>
<script type="module" src="src/ui.js"></script>
</body>
</html>
```

(버전은 주소에 고정. SRI integrity는 unpkg 페이지에서 값을 확인한 뒤 붙이는 걸로 미룬다 — 틀린 값을 넣으면 조용히 안 뜬다.)

- [ ] **Step 2: `src/ui.js` — 상태·지도·단계 뼈대 + 1단계**

```js
import { plan, hm } from './engine.js';
import { decode, encode, DEFAULTS, resolvePlaces } from './state.js';

const CITIES = { london: '런던', paris: '파리' };
const DAY_COLORS = ['--d1','--d2','--d3','--d4','--d5','--d6','--d7','--d8','--d9','--d10'];
const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

let state = decode(location.hash);
let step = 1;
let city = null;                 // data/<c>.json 내용
const cache = {};
const map = L.map('map', { zoomControl: true });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
const layers = { places: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), start: L.layerGroup().addTo(map) };

export function setState(patch) {
  state = { ...state, ...patch };
  history.replaceState(null, '', '#' + encode(state));
  render();
}
export function goStep(n) { step = n; render(); }
export async function loadCity(id) {
  if (!cache[id]) cache[id] = await fetch(`data/${id}.json`).then(r => r.json());
  return cache[id];
}

function stepper(val, onDelta, fmt = v => v) {
  const w = $('span', 'stepper');
  const a = $('button', null, '−'); a.type = 'button'; a.onclick = () => onDelta(-1);
  const v = $('span', 'val', fmt(val));
  const b = $('button', null, '+'); b.type = 'button'; b.onclick = () => onDelta(1);
  w.append(a, v, b); return w;
}

function renderSteps() {
  const host = document.getElementById('steps'); host.innerHTML = '';
  [['1 설정'], ['2 장소'], ['3 결과']].forEach(([label], i) => {
    const b = $('button', null, label); b.type = 'button';
    b.setAttribute('aria-pressed', step === i + 1); b.onclick = () => goStep(i + 1);
    host.appendChild(b);
  });
}

function drawStart() {
  layers.start.clearLayers();
  const s = state.s || { lat: city.center[0], lng: city.center[1] };
  L.circleMarker(s, { radius: 8, color: '#22201c', fillColor: '#fff', fillOpacity: 1, weight: 2 })
    .bindTooltip(state.s ? '출발점(숙소)' : '출발점(도심 기본값)').addTo(layers.start);
}

function renderStep1(side) {
  const p = $('div', 'panel');
  p.appendChild($('h2', null, '어디를, 며칠, 어디서 출발'));
  const row1 = $('div', 'row');
  for (const [id, name] of Object.entries(CITIES)) {
    const b = $('button', 'btn' + (state.c === id ? ' primary' : ''), name); b.type = 'button';
    b.onclick = () => setState({ c: id, p: {}, m: [], u: [], s: null });
    row1.appendChild(b);
  }
  p.appendChild(row1);
  const row2 = $('div', 'row');
  row2.append($('span', 'muted', '일수'), stepper(state.d, d => setState({ d: Math.max(1, Math.min(10, state.d + d)) })));
  row2.append($('span', 'muted', '하루 시작'), stepper(state.t, d => setState({ t: Math.max(0, Math.min(state.e - 60, state.t + d * 30)) }), hm));
  row2.append($('span', 'muted', '하루 끝'), stepper(state.e, d => setState({ e: Math.max(state.t + 60, Math.min(1440, state.e + d * 30)) }), hm));
  p.appendChild(row2);
  p.appendChild($('p', null, state.s
    ? `출발점: ${state.s.lat.toFixed(4)}, ${state.s.lng.toFixed(4)} — 지도를 다시 클릭하면 옮겨진다.`
    : '지도를 클릭하면 그 자리가 출발점(숙소)이 된다. 안 찍으면 도심에서 출발한다.'));
  const next = $('button', 'btn primary', '장소 고르기 →'); next.type = 'button'; next.onclick = () => goStep(2);
  p.appendChild(next);
  side.appendChild(p);
  map.off('click'); map.on('click', e => setState({ s: { lat: e.latlng.lat, lng: e.latlng.lng } }));
}

async function render() {
  renderSteps();
  if (!CITIES[state.c]) { state = { ...state, c: DEFAULTS.c, p: {}, m: [], u: [], s: null }; history.replaceState(null, '', '#' + encode(state)); }
  city = await loadCity(state.c);
  const side = document.getElementById('side'); side.innerHTML = '';
  layers.places.clearLayers(); layers.route.clearLayers();
  drawStart();
  if (step === 1) { map.setView(city.center, 12); renderStep1(side); }
  if (step === 2) renderStep2(side);
  if (step === 3) renderStep3(side);
}

// Task 8·9에서 채운다
function renderStep2(side) { side.appendChild($('div', 'panel', '<h2>장소</h2><p>다음 단계에서.</p>')); }
function renderStep3(side) { side.appendChild($('div', 'panel', '<h2>결과</h2><p>다음 단계에서.</p>')); }

window.addEventListener('hashchange', () => { state = decode(location.hash); render(); });
render();
```

- [ ] **Step 3: 손으로 확인**

Run: `npm run serve` → http://localhost:8080
Expected: 지도가 런던에 뜨고, 도시 버튼으로 파리로 바뀌며 지도가 이동. 일수·시작·끝 스테퍼가 움직이고 주소창 해시가 따라 바뀐다. 지도 클릭 → 출발점 마커 이동. 새로고침해도 상태 유지.

- [ ] **Step 4: 커밋**

```bash
git add index.html src/ui.js
git commit -m "feat: 화면 뼈대, Leaflet 지도, 1단계 설정

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 2단계 — 장소 고르기

**Files:**
- Modify: `src/ui.js` (`renderStep2` 교체)

**Interfaces:**
- Consumes: `state.p / m / u`, `city.places`, `setState`
- Produces: `renderStep2(side)` — 목록·마커·내 장소 추가

- [ ] **Step 1: 구현** (`renderStep2` 자리 교체)

```js
const WEIGHT_LABEL = { 1: '1순위 — 이 도시를 대표', 2: '2순위', 3: '3순위' };

function placeMarker(pl, chosen, must) {
  const m = L.circleMarker([pl.lat, pl.lng], {
    radius: chosen ? 9 : 6, weight: must ? 3 : 1.5,
    color: must ? '#22201c' : (chosen ? '#15696c' : '#9b958b'),
    fillColor: chosen ? '#15696c' : '#fff', fillOpacity: chosen ? 1 : 0.9,
  }).bindTooltip(pl.name);
  m.on('click', () => togglePlace(pl.id));
  return m;
}
function togglePlace(id) {
  const p = { ...state.p }, m = state.m.filter(x => x !== id);
  if (id in p) delete p[id]; else p[id] = city.places.find(x => x.id === id).default;
  setState({ p, m });
}

function renderStep2(side) {
  const head = $('div', 'panel');
  const n = Object.keys(state.p).length + state.u.length;
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
      const lab = $('label', null, pl.name); lab.htmlFor = cb.id; lab.style.fontWeight = '600';
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
      const row = $('div', 'row', `<b>${u.name}</b> <span class="muted">${u.min}분</span>`);
      const del = $('button', 'btn', '삭제'); del.type = 'button'; del.onclick = () => setState({ u: state.u.filter((_, j) => j !== i) });
      row.appendChild(del); panel.appendChild(row);
      layers.places.addLayer(L.circleMarker([u.lat, u.lng], { radius: 9, color: '#22201c', weight: 3, fillColor: '#c99a18', fillOpacity: 1 }).bindTooltip(u.name + ' (내 장소)'));
    });
    side.appendChild(panel);
  }

  const pts = [...city.places.map(p => [p.lat, p.lng]), ...state.u.map(u => [u.lat, u.lng])];
  map.fitBounds(pts, { padding: [20, 20] });
  map.off('click'); map.on('click', e => {
    const name = prompt('장소 이름'); if (!name) return;
    const min = parseInt(prompt('머무는 시간(분)', '60')); if (!(min > 0)) return;
    setState({ u: [...state.u, { name: name.replace(/[~|]/g, ' '), lat: e.latlng.lat, lng: e.latlng.lng, min }] });
  });
}
```

(`prompt`는 단순성을 위해 쓴다. 이름의 `~`·`|`는 해시 구분자라 공백으로 바꾼다.)

- [ ] **Step 2: 손으로 확인**

Run: `npm run serve`
Expected: 1·2·3순위 묶음이 보이고, 체크하면 「꼭」 버튼과 선택지 셀렉트가 나타나며 마커가 커진다. 지도 빈 곳 클릭 → 프롬프트 두 번 → 「내 장소」에 금색 마커. 해시에 `p=`, `m=`, `u=`가 생기고 새로고침해도 유지. 고른 게 0이면 「경로 짜기」가 비활성.

- [ ] **Step 3: 커밋**

```bash
git add src/ui.js
git commit -m "feat: 2단계 장소 고르기(목록·꼭·선택지·내 장소)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 3단계 — 결과

**Files:**
- Modify: `src/ui.js` (`renderStep3` 교체)

**Interfaces:**
- Consumes: `plan`, `hm` (Task 4), `resolvePlaces` (Task 5), `state`, `city`
- Produces: `renderStep3(side)` — 날짜별 선·마커·패널, 뺀 것, 링크 복사, 레이어 토글

- [ ] **Step 1: 구현** (`renderStep3` 자리 교체)

```js
const hidden = new Set();   // 숨긴 날 인덱스 (화면 상태, 해시에 안 넣는다)

function renderStep3(side) {
  const places = resolvePlaces(state, city);
  const start = state.s || { lat: city.center[0], lng: city.center[1] };
  const result = plan(places, { days: state.d, start, dayStart: state.t, dayEnd: state.e });

  const head = $('div', 'panel');
  head.appendChild($('h2', null, `${city.name} ${result.days.length}일 — ${places.length}곳 중 ${places.length - result.dropped.length}곳`));
  head.appendChild($('p', 'muted', '이동시간은 직선거리 추정(±10분). 선택지를 바꾸면 바로 다시 계산된다.'));
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
      L.polyline(pts, { color: col, weight: 3, opacity: 0.85 }).addTo(layers.route);
      day.stops.forEach((s, k) => {
        L.marker([s.place.lat, s.place.lng], { icon: L.divIcon({ className: '', html:
          `<div style="width:22px;height:22px;border-radius:50%;background:${col};color:#fff;font:700 11px/22px sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 0 0 1px ${col}">${k + 1}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11] }) }).bindTooltip(`${hm(s.arrive)} ${s.place.name}`).addTo(layers.route);
        bounds.push([s.place.lat, s.place.lng]);
      });
    }
    const panel = $('div', 'panel'); panel.style.borderLeft = `3px solid ${col}`;
    panel.appendChild($('h2', null, `${i + 1}일차 <span class="muted" style="font-weight:500">· ${day.why} · 끝 ${hm(day.end)} · 이동 ${day.moveMin}분 · 도보 ${day.walkKm}km</span>`));
    if (day.over) panel.appendChild($('p', null, `<b style="color:var(--warn)">⚠ 꼭 가기만 남았는데도 ${hm(state.e)}을 넘긴다. 일수를 늘리거나 체류를 줄여라.</b>`));
    day.stops.forEach(s => {
      const r = $('div', 'row');
      r.appendChild($('span', null, `<b style="font-variant-numeric:tabular-nums">${hm(s.arrive)}</b> ${s.place.name}${s.place.must ? ' <span class="muted">꼭</span>' : ''}`));
      if (!s.place.user) {
        const sel = $('select');
        s.place.opts.forEach((o, k) => { const op = $('option', null, `${o.label} · ${o.min}분`); op.value = k; op.selected = s.place.opt === k; sel.appendChild(op); });
        sel.onchange = () => setState({ p: { ...state.p, [s.place.id]: Number(sel.value) } });
        r.appendChild(sel);
      }
      r.appendChild($('span', 'muted', s.travelMin ? `↑ ${s.travelMode === 'walk' ? '도보' : '지하철'} ${s.travelMin}분` : '출발'));
      panel.appendChild(r);
    });
    side.appendChild(panel);
  });

  if (result.dropped.length) {
    const panel = $('div', 'panel'); panel.style.background = 'var(--warn-soft)';
    panel.appendChild($('h2', null, '뺀 것'));
    for (const d of result.dropped) panel.appendChild($('p', null, `<b>${d.place.name}</b> <span class="muted">— ${d.reason}. 꼭 가려면 2단계에서 「꼭」을 켜라.</span>`));
    side.appendChild(panel);
  }
  map.fitBounds(bounds, { padding: [24, 24] });
  map.off('click');
}
```

- [ ] **Step 2: 손으로 확인**

Run: `npm run serve`
Expected: 런던에서 10곳쯤 고르고 3일 → 날짜별 색 선과 번호 마커, 오른쪽에 날짜 패널. 셀렉트를 바꾸면 시각이 즉시 바뀐다. 1일차 버튼으로 그날 선이 숨겨진다. 하루 끝을 12:00으로 줄이면 「뺀 것」이 뜬다. 전부 「꼭」으로 켜고 끝을 짧게 하면 ⚠ 경고. 「링크 복사」 → 새 탭에 붙여넣기 → 같은 결과.

- [ ] **Step 3: 커밋**

```bash
git add src/ui.js
git commit -m "feat: 3단계 결과(날짜별 지도·패널·뺀 것·링크 복사)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 전체 검증 + 배포 준비

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 자동 검사 전부**

Run: `npm test && npm run validate`
Expected: 모든 테스트 통과, `데이터 OK`

- [ ] **Step 2: 수동 체크리스트** (스펙 4절 「화면」)

- [ ] 데스크탑: 1→2→3 흐름, 지도 선·마커, 패널 셀렉트 즉시 반영
- [ ] 폰 폭(브라우저 400px): 한 단으로 접히고 가로 스크롤 없음, 지도 60vh
- [ ] 링크 복사 후 **새 시크릿 창**에서 열기 → 같은 도시·일수·장소·결과
- [ ] 파리로 바꾸고 같은 흐름 한 번
- [ ] 해시를 손으로 망가뜨려(`#d=99&p=없음:5`) 열기 → 기본값으로 1단계

- [ ] **Step 3: README에 배포 절차**

`README.md` 끝에 추가:
```markdown
## 배포 (GitHub Pages)

1. GitHub에 저장소 만들고 `main` 푸시
2. Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)`
3. 1~2분 뒤 `https://<계정>.github.io/route-planner/`

빌드 없음 — `index.html`과 `src/`, `data/`를 그대로 서빙한다. `reference/`·`docs/`·`tests/`·`scripts/`도 올라가지만 링크되지 않는다.
```

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: 배포 절차

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(원격 푸시와 Pages 설정은 영철이 한다 — 외부 공개는 게이트.)
