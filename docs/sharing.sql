-- ⑦ 공유 — 한 체계: 비공개(private) · 링크 초대(link) · 공개(public). 새 탭에서 통째로 Run.
alter table projects add column if not exists visibility text not null default 'private' check (visibility in ('private','link','public'));
update projects set visibility = 'public' where is_public;
alter table projects add column if not exists edits jsonb not null default '{}';          -- {placeId: {by, at}} 마지막으로 만진 사람
alter table projects add column if not exists last_edited_by text;

create table if not exists project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor','viewer')),
  name text, added_at timestamptz default now(),
  primary key (project_id, user_id));
create table if not exists project_invites (
  token text primary key,
  project_id uuid references projects(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor','viewer')),
  created_by uuid references auth.users(id), created_at timestamptz default now(), expires_at timestamptz);
grant select, insert, update, delete on project_members, project_invites to authenticated;
grant select on projects, photos, comments to anon;     -- 공개 플랜은 로그인 없이도 읽는다 (RLS가 public만 통과)
alter table project_members enable row level security;
alter table project_invites enable row level security;

create or replace function is_member(p uuid) returns boolean language sql security definer stable as
  $$ select exists(select 1 from project_members m where m.project_id = p and m.user_id = auth.uid()) $$;
create or replace function is_editor(p uuid) returns boolean language sql security definer stable as
  $$ select exists(select 1 from project_members m where m.project_id = p and m.user_id = auth.uid() and m.role = 'editor') $$;

drop policy if exists "own projects" on projects;
drop policy if exists "public projects readable" on projects;
create policy "projects read"   on projects for select using (auth.uid() = user_id or visibility = 'public' or is_member(id));
create policy "projects insert" on projects for insert with check (auth.uid() = user_id);
create policy "projects update" on projects for update using (auth.uid() = user_id or is_editor(id)) with check (auth.uid() = user_id or is_editor(id));
create policy "projects delete" on projects for delete using (auth.uid() = user_id);

drop policy if exists "own photos" on photos;
create policy "photos read"   on photos for select using (exists (select 1 from projects p where p.id = project_id and (p.visibility = 'public' or p.user_id = auth.uid() or is_member(p.id))));
create policy "photos insert" on photos for insert with check (auth.uid() = user_id and exists (select 1 from projects p where p.id = project_id and (p.user_id = auth.uid() or is_editor(p.id))));
create policy "photos update" on photos for update using (auth.uid() = user_id or exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "photos delete" on photos for delete using (auth.uid() = user_id or exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists "own photo files" on storage.objects;
create policy "photo files read" on storage.objects for select
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from projects p where p.id::text = (storage.foldername(name))[2] and (p.visibility = 'public' or p.user_id = auth.uid() or is_member(p.id)))));
create policy "photo files insert" on storage.objects for insert with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photo files delete" on storage.objects for delete using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members read"   on project_members for select using (user_id = auth.uid() or is_member(project_id) or exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "members manage" on project_members for all using (exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())) with check (exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "members leave"  on project_members for delete using (user_id = auth.uid());
create policy "invites owner"  on project_invites for all using (exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())) with check (exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()));

-- 초대 수락: 토큰을 아는 로그인 사용자가 자기를 멤버로 넣는다 (초대 표는 못 읽어도 되게 definer)
create or replace function accept_invite(t text, display_name text) returns uuid language plpgsql security definer as $$
declare inv project_invites%rowtype;
begin
  select * into inv from project_invites where token = t and (expires_at is null or expires_at > now());
  if not found then raise exception '초대가 없거나 만료됐다'; end if;
  insert into project_members (project_id, user_id, role, name) values (inv.project_id, auth.uid(), inv.role, display_name)
    on conflict (project_id, user_id) do update set role = excluded.role, name = excluded.name;
  return inv.project_id;
end $$;
grant execute on function accept_invite(text, text) to authenticated;

drop policy if exists "comments on public projects readable" on comments;
create policy "comments read" on comments for select using (exists (select 1 from projects p where p.id = project_id and (p.visibility = 'public' or p.user_id = auth.uid() or is_member(p.id))));
