// 계정 서버 설정. anon 키는 설계상 공개용(브라우저에 들어가는 키) — 데이터 보호는 DB의 RLS가 한다. service_role 키는 절대 여기 두지 않는다.
export const SUPABASE = {
  url: 'https://cmuwxferuawquipjighm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdXd4ZmVydWF3cXVpcGppZ2htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODU1NDIsImV4cCI6MjEwNzU2MTU0Mn0.-h5i1LM51o_4l2zskFTYVJCb7ASIYvunS-RJRkf-JMU',
};
// 기능 스위치 — 서버 준비가 안 된 기능은 화면에서 숨긴다.
//   ai: Supabase Edge Function `plan-chat`을 배포하고 ANTHROPIC_API_KEY 시크릿을 넣은 뒤 true (docs/supabase.md ⑤)
export const FEATURES = { ai: false };
