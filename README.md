# AlgoTrip — 여행 동선 플래너

가고 싶은 곳을 고르면 며칠에 어떻게 나누고 하루에 어떤 순서로 돌지 계산해 준다. 정적 사이트, 빌드 없음, 로그인 없이 바로 쓰고 링크 하나가 곧 저장·공유다.

- 사이트: https://anythinking.github.io/route-planner/
- 도시 8곳: 런던 · 파리 · 로마 · 바르셀로나 · 도쿄 · 오사카 · 교토 · 세부 (도시마다 장소 25~35곳, 설명·체류 선택지·사진 팁·준비물·기념품). 세부는 시티·막탄에 남부 당일 여행지(오슬롭·카와산·모알보알)까지 넣었고 30km 넘는 구간은 국도 속도로 추정한다

## 뭐가 있나

| 탭 | 하는 일 |
|---|---|
| 홈 | 도시 고르기, (로그인 시) 내 여행·다른 사람의 공개 플랜 |
| 플랜 | 노선도 한 화면 — 날 = 노선, 장소 = 역. **나누는 방법 4가지**(지역별 · 한붓그리기 · 균등 · 순위 우선, 해시 `a=`) ↔ 직접 배정. 수정 모드가 기본: 역마다 ⋮⋮ 손잡이를 **끌어** 같은 날 안에서 순서를 바꾸거나(놓을 자리에 선이 뜬다) 다른 날로 옮기고, 끌기 대신 「옮기기」 메뉴(↑↓·N일차로)도 있다. 🕓 **「이 시각부터」**(해시 `at=`)로 노을·야경·예약처럼 시간대가 있는 곳을 고정하면 일찍 닿을 땐 기다리고(대기 n분), 자동 나누기도 그 시각 직전 자리에 끼운다. 체류 선택·★·빼기·구간 이동수단·날 설정·날 빼기·「+ 하루 추가」, 날마다 다른 시간·출발점, 해와 그림자, 지도 검색(OSM·위키데이터), 내 장소 찍기, ⌘Z 되돌리기 |
| 가이드 | 준비물 체크(여행에 저장), 사진 팁(장소별), 기념품(「살 것」에 담기) |
| 내 여행 | 이메일 계정(비밀번호·메일 링크), 여행 저장, 여러 도시 구간, 살 것, 사진(GPS로 지도에), 공유(비공개·링크 초대·공개), 구글 타임라인 가져오기, 데이터 내보내기, 탈퇴 |

로그인 없이는 브라우저 안에만 저장되고(`?local=1`로 강제 가능), 계정은 Supabase(Postgres + Auth + Storage, RLS로 보호)다.

## 실행 · 테스트

```bash
python3 scripts/serve.py   # http://localhost:8080 — 사이트 + 「📝 고칠 것」·클로드 (바탕화면 「알고트립 열기」가 이걸 켠다)
npm run serve              # 같은 주소, API 없이 정적만
npm test             # 단위 테스트 (엔진·상태·저장소 매핑·타임라인 …)
npm run test:e2e     # Playwright — 이동·뒤로 가기·휴대폰 지도 스크롤
npm run validate     # 도시 데이터 검사 (필수 필드·bbox·사진 팁 누락)
```

## 고칠 것 · 화면 속 클로드 (로컬 전용)

`scripts/serve.py`로 연 화면엔 왼쪽 아래 「📝 고칠 것」 단추와 클로드 단추가 붙는다(`src/memo.js` — 광 연산 지도·통합 관리 프로그램과 같은 것). 화면에서 이상한 곳을 찍고 한 줄 적으면 `docs/고칠것.md`에 `- [ ] 시각 · 화면 · 자리 — 내용`으로 쌓이고(같은 와이파이의 다른 기기가 적으면 그 주소가 붙는다), 클로드 단추는 이 맥의 Claude Code로 그 자리에서 고친다(이 맥에서 연 화면만). 공개 사이트엔 `/api`가 없어 단추가 안 그려진다. 고친 줄은 `[x]`로 바꾼다.

## 배포 (GitHub Pages)

1. `npm run bump` — `index.html`의 모듈 버전(`?v=`)을 올린다. **이걸 빼먹으면 브라우저가 옛 모듈을 섞어 쓴다.**
2. `npm test && npm run test:e2e && npm run validate`
3. `main`에 푸시 → 1~2분 뒤 사이트 반영. (Settings → Pages → `main` / `(root)`)

`index.html`·`src/`·`data/`·`assets/`·`manifest.webmanifest`·`robots.txt`·`404.html`이 사이트의 전부다. `docs/`·`tests/`·`scripts/`·`e2e/`·`specs/`도 올라가지만 링크되지 않고 `robots.txt`에서 뺐다. `reference/`는 개인 자료라 올리지 않는다(.gitignore).

### 서버 쪽 — 한 번만 하면 되는 것 (상태는 `docs/supabase.md`)

| 항목 | 상태 | 안 하면 |
|---|---|---|
| 표·RLS·공유(`docs/supabase.sql`, `docs/sharing.sql`) | 됨 | — |
| 회원 탈퇴 함수 `docs/account.sql` | **아직** | 「탈퇴하기」가 "준비 중" 안내만 하고 아무것도 안 지운다 |
| AI 플랜 대화 Edge Function `plan-chat` + `ANTHROPIC_API_KEY` | **아직** | 화면에서 숨겨 둠 — 배포 뒤 `src/config.js`의 `FEATURES.ai = true` |

## 구조

```
index.html            한 페이지 (스타일 포함) · 해시가 상태
src/ui.js             화면 — 탭·플랜·가이드·홈
src/mine.js           내 여행 — 로그인·목록·여행 하나·계정
src/pages.js          개인정보처리방침 · 이용약관 · 404
src/engine.js         나누기 4종(지역별·한붓그리기·균등·순위 우선)·순서·시간·자르기 (순수 함수)
src/travel.js         거리 → 이동 분 (도보·지하철·택시, 결정적)
src/state.js          URL 해시 ↔ 상태
src/map.js            MapLibre + OpenFreeMap 래퍼 (3D 건물·해 위치·그림자)
src/shadow.js         건물 발자국 → 그림자 다각형
src/store.js          브라우저 저장소 · src/store-supabase.js  계정 서버
src/timeline.js       구글 타임라인 JSON → 도시별 여행
src/search.js         OSM Nominatim 검색 · src/ai.js  AI 대화 호출 · src/edits.js  누가 만졌나
data/cities.json      도시 색인 · data/<city>.json  장소 · data/packing.json  준비물 공통
assets/               도시 사진(출처 credits.json) · 아이콘 · OG 이미지
supabase/functions/   plan-chat Edge Function
docs/                 Supabase 안내·SQL · 설계 문서 (docs/superpowers/)
research/<city>/      조사 원자료(출처 URL 포함) — 장소의 src·도시의 sources가 여기를 가리킨다 (research/README.md)
```

설계: `docs/superpowers/specs/2026-10-12-route-planner-design.md`

## 도시 추가

1. `data/cities.json`에 도시(id·이름·나라·center·bbox·tz·image)를 넣고 지역 목록에 id를 추가한다.
2. `scripts/seeds/<id>.json`에 장소 25곳 안팎 — `id`·`en`·`name`·`weight`(1~3)·`cat`. 위키데이터가 못 찾으면 `q` 또는 `lat`/`lng`를 직접.
3. 나라가 처음이면 `scripts/country/<country>.json`에 준비물·기념품·사진 공통 팁.
4. `node scripts/build-city.js <id>` → `data/<id>.json` 초안. 설명(`note`)·사진 팁(`photo.places`)이 빈 곳은 손으로 채우고 `npm run validate`. 이미 있는 파일의 note·opts·photo는 다시 돌려도 지켜진다.
5. 도시 사진은 Wikimedia Commons에서 CC BY/BY-SA로 골라 `assets/cities/<id>.jpg`(560×420 안팎)에 두고 `credits.json`에 출처를 적는다.
6. 장소가 여러 구역(도심·섬·근교)에 흩어진 도시는 도시 파일에 `areas: [{id, name, blurb}]`를 두고 장소마다 `area`를 적는다 — 빈 플랜이 구역별 목록과 지도 테두리로 열린다(세부). 없으면 1순위 칩만 보인다.
7. 웹 조사로 만든 도시는 조사 JSON을 `research/<id>/`에 두고, 장소마다 `src`(좌표 출처·참고 URL), 파일 아래 `sources`(조사일·뺀 곳)를 적는다. 조사하기 전에 `research/`부터 본다 — 같은 걸 두 번 찾지 않게.
