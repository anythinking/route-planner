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
3. Authentication → Providers → Google 켜기. 구글 클라우드 콘솔에서 OAuth 클라이언트를 하나 만들어 ID/Secret 붙여넣기 (이메일+비밀번호는 기본으로 켜져 있다).
4. SQL Editor 에 아래를 붙여 넣고 Run.
5. Storage → New bucket `photos` (Private).

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
