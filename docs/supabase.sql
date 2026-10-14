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
