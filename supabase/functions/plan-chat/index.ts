// AlgoTrip — 플랜 대화 (Supabase Edge Function, Deno)
// 브라우저가 로그인 토큰과 함께 { city, places, state, messages } 를 보내면 Claude에게 넘겨
// { reply, apply } 를 돌려준다. apply 는 화면이 그대로 적용할 수 있는 상태 조각이다.
// 비밀: ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets). 브라우저엔 절대 안 간다.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // 1. 로그인한 사람만 — 토큰을 Supabase에 확인한다 (익명 남용 방지)
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uerr } = await sb.auth.getUser();
    if (uerr || !user) return json({ error: "로그인이 필요하다" }, 401);

    const { city, places, state, messages } = await req.json();
    if (!Array.isArray(messages) || !messages.length || !Array.isArray(places)) return json({ error: "요청이 비었다" }, 400);
    const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return json({ error: "서버에 ANTHROPIC_API_KEY가 없다" }, 500);

    // 2. 장소 목록은 짧게 — id·이름·순위·종류·선택지만
    const catalog = places.slice(0, 60).map((p: any) => `${p.id} | ${p.name} | ${p.weight}순위 | ${p.cat ?? ""} | ${(p.opts ?? []).map((o: any, i: number) => `${i}:${o.label} ${o.min}분`).join(", ")}`).join("\n");
    const system = `너는 AlgoTrip의 여행 플래너다. 도시: ${city?.name ?? ""}. 사용자가 어떤 여행을 원하는지 듣고, 아래 장소 카탈로그에서 골라 플랜 상태를 제안한다.
카탈로그 (id | 이름 | 순위 | 종류 | 체류 선택지 index:라벨 분):
${catalog}

지금 상태: 일수 ${state?.d ?? 3}, 하루 ${state?.t ?? 570}분~${state?.e ?? 1140}분(자정 기준 분), 이동 ${state?.v ?? "transit"}, 고른 곳 ${JSON.stringify(state?.p ?? {})}, 꼭 ${JSON.stringify(state?.m ?? [])}.

답은 반드시 JSON 하나로만: {"reply": "<한국어 2~5문장, 왜 이렇게 골랐나>", "apply": {"d": <일수|생략>, "p": {"<id>": <opt index>, ...}, "m": ["<id>", ...], "v": "transit"|"taxi"|생략, "t": <분|생략>, "e": <분|생략>, "o": [["<id>",...],...]|생략}}
규칙: p의 id는 카탈로그에 있는 것만. 하루에 4~6곳을 넘기지 마라. 사용자가 일수·시간을 말하면 d/t/e에 반영. 날짜별로 나눠 달라고 하면 o를 채워라(각 id는 한 번만). 카탈로그에 없는 곳은 reply에서 "검색 탭에서 직접 넣어라"고 안내. 사용자 말이 플랜과 무관하면 apply를 {}로.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: messages.slice(-10).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) })) }),
    });
    if (!r.ok) return json({ error: `모델 호출 실패 ${r.status}: ${(await r.text()).slice(0, 200)}` }, 502);
    const data = await r.json();
    const text = (data.content ?? []).map((c: any) => c.text ?? "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    let out: any = { reply: text, apply: {} };
    if (m) { try { out = JSON.parse(m[0]); } catch { /* 본문 그대로 */ } }
    // 3. apply 소독 — 카탈로그 밖 id·이상한 값은 버린다
    const ids = new Set(places.map((p: any) => p.id)); const a = out.apply ?? {}; const clean: any = {};
    if (Number.isInteger(a.d) && a.d >= 1 && a.d <= 10) clean.d = a.d;
    if (a.p && typeof a.p === "object") { clean.p = {}; for (const [id, v] of Object.entries(a.p)) if (ids.has(id) && Number.isInteger(v) && (v as number) >= 0) clean.p[id] = v; }
    if (Array.isArray(a.m)) clean.m = a.m.filter((id: string) => ids.has(id));
    if (a.v === "transit" || a.v === "taxi") clean.v = a.v;
    for (const k of ["t", "e"]) if (Number.isInteger(a[k]) && a[k] >= 0 && a[k] <= 1440) clean[k] = a[k];
    if (Array.isArray(a.o)) { const seen = new Set<string>(); clean.o = a.o.map((day: any) => (Array.isArray(day) ? day : []).filter((id: string) => ids.has(id) && !seen.has(id) && seen.add(id))); }
    return json({ reply: String(out.reply ?? "").slice(0, 2000), apply: clean });
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
