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
