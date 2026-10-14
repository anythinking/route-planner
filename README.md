# AlgoTrip — 여행 동선 플래너

가고 싶은 곳을 고르면 며칠에 어떻게 나누고 하루에 어떤 순서로 돌지 계산해준다. 정적 사이트, 빌드 없음.

- 실행: `npm run serve` 후 http://localhost:8080
- 테스트: `npm test`
- 데이터 검사: `npm run validate`

설계: `docs/superpowers/specs/2026-10-12-route-planner-design.md`

## 배포 (GitHub Pages)

1. GitHub에 저장소 만들고 `main` 푸시
2. Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)`
3. 1~2분 뒤 `https://<계정>.github.io/route-planner/`

빌드 없음 — `index.html`과 `src/`, `data/`를 그대로 서빙한다. `docs/`·`tests/`·`scripts/`도 올라가지만 링크되지 않는다. `reference/`는 개인 자료라 올리지 않는다(.gitignore).

## 도시 추가

1. `data/cities.json`에 도시(id·이름·나라·center·bbox)를 넣고 지역 목록에 id를 추가한다.
2. `scripts/seeds/<id>.json`에 장소 25곳 안팎을 적는다 — `id`·`en`(영어 이름)·`name`(한국어)·`weight`(1~3)·`cat`(museum/temple/market/…; 종류별 체류 기본표는 `scripts/build-city.js`). 위키데이터가 못 찾으면 `q` 또는 `lat`/`lng`를 직접.
3. 나라가 처음이면 `scripts/country/<country>.json`에 준비물·기념품·사진 공통 팁.
4. `node scripts/build-city.js <id>` → `data/<id>.json` 초안(좌표·한국어 이름·설명은 위키데이터·한국어 위키백과). 설명이 빈 곳은 손으로 채우고 `npm run validate`.
   이미 있는 파일의 note·opts·photo는 다시 돌려도 지켜진다.
