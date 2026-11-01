-- ⑦ 회원 탈퇴 — Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run (한 번만)
-- 본인 계정만 지운다. 여행·사진 기록·멤버·댓글은 auth.users 를 따라 연쇄로 지워진다(on delete cascade).
-- 사진 파일(저장소)은 화면이 먼저 지운다. 남이 만든 초대 링크는 그대로 둔다.
create or replace function delete_my_account(dry boolean default false) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if dry then return; end if;                                   -- 화면이 사진을 지우기 전에 함수가 있는지만 본다
  delete from project_invites where created_by = auth.uid();   -- 이 칸만 연쇄 삭제가 안 걸려 있다
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function delete_my_account(boolean) from public, anon;
grant execute on function delete_my_account(boolean) to authenticated;
