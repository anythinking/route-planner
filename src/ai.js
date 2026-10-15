// AI 플랜 대화 — Supabase Edge Function `plan-chat`을 부른다. 로그인 토큰이 같이 간다.
import { SUPABASE } from './config.js';

export async function chat({ session, city, places, state, messages }) {
  const r = await fetch(`${SUPABASE.url}/functions/v1/plan-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE.anonKey, Authorization: `Bearer ${session?.access_token || SUPABASE.anonKey}` },
    body: JSON.stringify({ city: { id: city.city, name: city.name }, places: places.map(p => ({ id: p.id, name: p.name, weight: p.weight, cat: p.cat, opts: p.opts })), state, messages }),
  });
  let body = null; try { body = await r.json(); } catch {}
  if (!r.ok) throw new Error(body?.error || (r.status === 404 ? '서버 함수(plan-chat)가 아직 없다' : `오류 ${r.status}`));
  return body;
}
