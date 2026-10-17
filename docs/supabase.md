# 계정 서버 붙이기 — Supabase

화면(`src/mine.js`)은 `src/store.js`의 인터페이스만 쓴다. 지금은 `LocalStore`(브라우저 안 저장)이고,
아래 순서대로 Supabase를 만들면 `SupabaseStore` 하나를 추가해 `ui.js`의 `new LocalStore()` 한 줄만 바꾼다.

## Supabase가 뭔가
호스팅된 Postgres 데이터베이스 + 로그인(Auth) + 파일 저장소(Storage)를 한 프로젝트로 주고,
브라우저에서 자바스크립트 SDK로 바로 붙는다. 서버 코드가 필요 없어서 GitHub Pages 정적 사이트를 그대로 둔다.
사이트에 들어가는 **anon key는 공개용**이다 — 누가 봐도 되도록 설계된 키고, 데이터 보호는 아래 RLS(행 단위 권한)가 한다.

## 영철이 할 일 (10분)
1. https://supabase.com → 구글로 가입 → New project (이름 `route-planner`, 지역 `Northeast Asia (Seoul)`).
2. Project Settings → API 에서 **Project URL** 과 **anon public key** 복사 → 나한테 주면 `src/store-supabase.js`에 넣는다. (service_role 키는 절대 안 쓴다.)
3. (나중에) Authentication → Providers → Google 켜기 — 구글 클라우드 콘솔에서 OAuth 클라이언트를 만들어 ID/Secret 붙여넣기. 처음엔 기본으로 켜진 **이메일 매직 링크**로 로그인한다.
4. SQL Editor 에 아래를 붙여 넣고 Run.
5. Storage → New bucket `photos` (Private).
6. Authentication → URL Configuration — **Site URL** `https://anythinking.github.io/route-planner/`, **Redirect URLs**에 `https://anythinking.github.io/route-planner/**`·`http://127.0.0.1:8080/**`·`http://localhost:8080/**` 추가. (로그인 메일의 링크가 이 목록 밖 주소로는 못 돌아온다.)

## 표
```sql
-- 여행(프로젝트)
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  city text not null,
  hash text not null default '',          -- 플랜 상태 (URL 해시 그대로)
  shopping jsonb not null default '[]',   -- [{text, done}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 사진
create table photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,                     -- storage 경로 photos/<user_id>/<project_id>/<id>.jpg
  lat double precision, lng double precision,
  place_id text, note text default '',
  taken_at timestamptz,
  created_at timestamptz not null default now()
);

-- 「Automatically expose new tables」를 껐으므로 로그인 사용자 역할에 표 권한을 직접 준다
grant select, insert, update, delete on projects, photos to authenticated;

-- 행 단위 권한: 내 것만 보고 고친다
alter table projects enable row level security;
alter table photos enable row level security;
create policy "own projects" on projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own photos"   on photos   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 사진 파일도 내 폴더만
create policy "own photo files" on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
```

## 화면 ↔ Supabase 대응
| 화면이 부르는 것 | LocalStore | SupabaseStore |
|---|---|---|
| `user()` | localStorage `rp.user` | `supabase.auth.getUser()` |
| `signIn()` | 이름만 저장 | `signInWithOAuth({provider:'google'})` / 이메일 |
| `listProjects()` | localStorage 배열 | `from('projects').select().order('updated_at')` — RLS가 내 것만 돌려준다 |
| `addPhoto()` | data URL을 같이 저장 | 파일을 `storage.from('photos').upload()` → 행은 `photos`에 `path`만 |
| 사진 보기 | `dataUrl` | `createSignedUrl(path, 3600)` → `url` |

무료 구간: DB 500 MB · 파일 1 GB · 월 활성 사용자 5만. 사진은 올릴 때 긴 변 1600px로 줄이면 한 장 ≈ 300 KB, 1 GB에 3천 장.

## 할 일 — SQL Editor에서 실행 (영철)

### ⓪ 준비물 체크 저장 (2026-10-15 추가, 미실행 — 이게 없으면 체크가 브라우저에만 남는다)
```sql
alter table projects add column if not exists packing jsonb not null default '{}';
```

### ③ 공개 플랜 (2026-10-15 추가, 미실행)
```sql
alter table projects add column if not exists is_public boolean not null default false;
create policy "public projects readable" on projects for select using (is_public);
```
실행한 뒤 "됐어" → 여행마다 「공개」 스위치, 공개 링크 `#pub=<id>`, 홈에 「다른 사람의 플랜」 카드, 「내 걸로 복사」.

### ④ 플랜 댓글 (메시지의 첫 형태 — ③ 다음)
```sql
create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);
grant select, insert, delete on comments to authenticated;
alter table comments enable row level security;
create policy "comments on public projects readable" on comments for select using (exists (select 1 from projects p where p.id = project_id and (p.is_public or p.user_id = auth.uid())));
create policy "own comments" on comments for insert with check (auth.uid() = user_id);
create policy "delete own comments" on comments for delete using (auth.uid() = user_id);
```

### ⑤ AI 플랜 대화 — Edge Function 배포 (영철, 10분)
코드는 `supabase/functions/plan-chat/index.ts`. 브라우저에서 Anthropic 키를 못 쓰니 이 함수가 대신 부른다(로그인 토큰 확인 → Claude → JSON).
1. https://console.anthropic.com 에서 API 키 하나 만들기 (소액 결제 수단 필요. 대화 한 번 ≈ 1~2원).
2. Supabase → 왼쪽 **Edge Functions** → **Deploy a new function** → 「Via Editor」 → 이름 `plan-chat` → 편집기에 `index.ts` 내용 전체 붙여 넣기 → Deploy.
3. Edge Functions → **Secrets** → `ANTHROPIC_API_KEY` = 만든 키 → Save. (키는 여기만. 코드·메일·채팅에 두지 않는다.)
4. 사이트 플랜 탭 → 「✦ AI에게 말하기」 → "미술관 위주로 2일" → 제안 → 「이 제안 적용」.
함수 설정에서 「Verify JWT」가 켜져 있으면 그대로 둔다(로그인 사용자만 통과).

### ⑥ 같이 가는 사람과 공유·공동 편집 (설계 메모 — 나중에)
- `project_members (project_id, user_id, role: owner|editor|viewer, invited_by, created_at)` + 초대 링크 토큰 `project_invites (token, project_id, role, expires_at)`.
- RLS: projects/photos/comments의 select·update를 "내 것 or 멤버"로 넓힌다.
- 편집 표시: `projects.hash`를 바꾸는 저장마다 `project_edits (project_id, user_id, at, summary)`에 한 줄 → 결과 화면 각 정류장·살 것 항목 옆에 「영철」「형」 태그(마지막으로 만진 사람).
- 동시 편집 충돌: 저장 시 `updated_at`이 내가 읽은 것과 다르면 "○○가 먼저 고쳤다 — 다시 불러오기".
- 실시간은 Supabase Realtime(채널 구독)으로 나중에.

### ⑦ 공유 한 체계 (2026-10-17, 미실행) — ③·⑥을 합쳤다
`docs/sharing.sql` 을 새 탭에 통째로 붙여 Run. 들어가는 것: 공유 범위(비공개·링크 초대·공개), 멤버·초대 표, 멤버도 읽고(편집자는 고치고) 사진도 보는 RLS, 초대 수락 함수, 공개 플랜은 로그인 없이 읽기.
실행 전엔 사이트의 「공유」 패널이 "서버 준비 전"이라고 뜬다.
