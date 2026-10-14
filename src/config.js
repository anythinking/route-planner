// 계정 서버 설정. anon 키는 설계상 공개용(브라우저에 들어가는 키) — 데이터 보호는 DB의 RLS가 한다. service_role 키는 절대 여기 두지 않는다.
export const SUPABASE = {
  url: 'https://cmuwxferuawquipjighm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdXd4ZmVydWF3cXVpcGppZ2htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODU1NDIsImV4cCI6MjEwNzU2MTU0Mn0.-h5i1LM51o_4l2zskFTYVJCb7ASIYvunS-RJRkf-JMU',
};
