// 📝 고칠 것 + 클로드 (그 옆 둥근 단추) — 화면에서 이상한 곳을 클릭하고 한 줄 적으면 docs/고칠것.md 에 쌓인다(scripts/serve.py /api/note).
//   scripts/serve.py(바탕화면 「알고트립 열기」)로 연 화면에서만 그려진다 — 공개 사이트(GitHub Pages)엔 /api 가 없어 아무것도 안 그린다.
//   단추 → 「＋ 화면에서 찍기」 → 클릭 → 적고 Enter. 아직 안 고친 것은 단추를 누르면 목록으로 보인다.
//   지도(캔버스) 위를 찍으면 「지도」로 적힌다. 광 연산 지도·통합 관리 프로그램의 memo.js 와 같은 것.
(async function () {
  const API = 'api/';   // 상대 주소 — 이 서버 루트가 저장소 루트
  let first; try { first = await fetch(API + 'notes'); if (!first.ok) return; first = await first.json(); } catch { return; }   // 서버가 없으면 끝
  const e = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  document.head.insertAdjacentHTML("beforeend", `<style>
  #fx{position:fixed;left:10px;bottom:10px;z-index:9999;font:12px/1.4 -apple-system,'Apple SD Gothic Neo',sans-serif;color:#1d2229;display:flex;gap:6px;align-items:center}
  #fx>button{background:#fffbea;border:1px solid #e3c55a;color:#7a5b00;border-radius:7px;padding:4px 11px;cursor:pointer;font:inherit;box-shadow:0 2px 8px rgba(0,0,0,.12)}
  #fx>button b{background:#e8c547;color:#14171a;border-radius:7px;padding:0 6px;margin-left:5px;font-size:11px}
  #fx .pn{position:absolute;left:0;bottom:34px;width:360px;max-height:50vh;overflow:auto;background:#fff;border:1px solid #d5d9df;border-radius:8px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.15);display:none}
  #fx.open .pn{display:block}
  #fx .pn button{background:#e8c547;color:#14171a;border:0;border-radius:6px;padding:5px 10px;font:inherit;font-weight:600;cursor:pointer;width:100%}
  #fx ol{margin:10px 0 0;padding-left:20px;color:#374151}#fx li{margin:3px 0}#fx .em{color:#6b7280;margin-top:8px}
  body.fx-pick,body.fx-pick *{cursor:crosshair!important}
  #fx-tip{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:10000;background:#e8c547;color:#14171a;padding:5px 14px;border-radius:7px;font:600 12px -apple-system,sans-serif;display:none}
  body.fx-pick #fx-tip{display:block}
  #fx-pin{position:fixed;z-index:10000;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#e8c547;border:2px solid #7a5b00;display:none}
  #fx-box{position:fixed;z-index:10000;width:320px;background:#fff;border:1px solid #e8c547;border-radius:8px;padding:9px;display:none;box-shadow:0 6px 24px rgba(0,0,0,.15);font:12px -apple-system,'Apple SD Gothic Neo',sans-serif;color:#374151}
  #fx-box textarea{width:100%;box-sizing:border-box;height:58px;background:#fff;color:#1d2229;border:1px solid #d5d9df;border-radius:6px;padding:6px;font:inherit;resize:vertical}
  #fx-box .at{margin-bottom:6px;color:#6b7280;font-size:11px;display:flex;gap:6px}#fx-box .at span{flex:1}#fx-box .er{color:#dc2626}
  #fx-x{background:none;border:0;color:#6b7280;cursor:pointer;font:inherit;padding:0 2px;line-height:1}#fx-x:hover{color:#1d2229}
  </style>`);
  document.body.insertAdjacentHTML("beforeend", `<div id="fx"><div class="pn"><button type="button" id="fx-go">＋ 화면에서 찍기</button><div id="fx-l"></div></div><button type="button" id="fx-b" title="고칠 것 적어 두기">📝 고칠 것<b id="fx-n" hidden></b></button></div>
  <div id="fx-tip">고칠 곳을 클릭하세요 · Esc 취소</div><div id="fx-pin"></div>
  <div id="fx-box"><div class="at"><span id="fx-at"></span><button type="button" id="fx-x" title="닫기 (Esc)">✕</button></div><textarea id="fx-t" placeholder="무엇이 이상한가요? (Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소)"></textarea><div class="er" id="fx-er"></div></div>`);
  const $ = id => document.getElementById(id), fx = $("fx");
  let at = "";
  function show(d) {
    const L = d.open || []; $("fx-n").hidden = !L.length; $("fx-n").textContent = L.length;
    $("fx-l").innerHTML = L.length ? `<ol>${L.map(l => `<li>${e(l)}</li>`).join("")}</ol>` : '<div class="em">아직 적은 게 없습니다.</div>';
  }
  const load = () => fetch(API + "notes").then(r => r.json()).then(show).catch(() => {});
  // 클릭한 곳을 사람이 알아볼 이름으로: 그림이면 페이지가 주는 이름 → 그 요소의 짧은 글자 → 가까운 제목
  function name(el, ev) {
    const short = x => { const t = (x.alt || x.title || x.getAttribute?.("aria-label") || x.innerText || x.value || "").trim().split("\n")[0]; return t.length && t.length <= 40 ? t : ""; };
    if (el.tagName === "CANVAS") return (window.fxName && window.fxName(ev)) || "지도";
    for (let x = el, i = 0; x && x !== document.body && i < 4; x = x.parentElement, i++) { const t = short(x); if (t) return t; }
    for (let x = el; x && x !== document.body; x = x.parentElement) { const h = x.querySelector?.("h1,h2,h3"); if (h) { const t = (h.innerText || "").trim().split("\n")[0].slice(0, 40); if (t) return t + " 안"; } }
    return el.tagName.toLowerCase();
  }
  function pick(ev) {
    if (fx.contains(ev.target) || $("fx-box").contains(ev.target)) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation?.();
    document.body.classList.remove("fx-pick"); off();
    const W = innerWidth, H = innerHeight, x = ev.clientX, y = ev.clientY;
    at = `「${name(ev.target, ev)}」 (가로 ${Math.round(x / W * 100)}% · 세로 ${Math.round(y / H * 100)}%)`;
    const pin = $("fx-pin"); pin.style.left = x + "px"; pin.style.top = y + "px"; pin.style.display = "block";
    const b = $("fx-box"); b.style.left = Math.min(x + 12, W - 330) + "px"; b.style.top = Math.min(y + 12, H - 130) + "px"; b.style.display = "block";
    $("fx-at").textContent = at; $("fx-er").textContent = ""; $("fx-t").value = ""; $("fx-t").focus();
  }
  const swallow = ev => { if (!fx.contains(ev.target) && !$("fx-box").contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); } };
  function on() { ["pointerdown", "mousedown", "mouseup"].forEach(t => addEventListener(t, swallow, true)); addEventListener("click", pick, true); }
  function off() { ["pointerdown", "mousedown", "mouseup"].forEach(t => removeEventListener(t, swallow, true)); removeEventListener("click", pick, true); }
  function close() { $("fx-box").style.display = "none"; $("fx-pin").style.display = "none"; document.body.classList.remove("fx-pick"); off(); }
  function save() {
    const d = new Date(), p2 = n => String(n).padStart(2, "0");
    const when = `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const page = `${document.title.replace(/ — .*$/, "")} ${location.hash || "#"}`;   // 한 페이지 앱이라 해시가 화면이다
    // 본문: 시각 / 화면 / 자리 / 내용 — 한 줄씩
    const body = [when, page, at, $("fx-t").value].map(s => s.replace(/\n/g, " ")).join("\n");
    fetch(API + "note", { method: "POST", body })
      .then(r => r.json()).then(d => { if (d.error) { $("fx-er").textContent = d.error; return; } show(d); close(); })
      .catch(() => { $("fx-er").textContent = "저장하지 못했어요 — 「알고트립 열기」로 연 화면인지 보세요"; });
  }
  $("fx-b").onclick = () => { fx.classList.toggle("open"); if (fx.classList.contains("open")) load(); };
  $("fx-go").onclick = ev => { ev.stopPropagation(); fx.classList.remove("open"); document.body.classList.add("fx-pick"); setTimeout(on, 0); };
  $("fx-t").addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); save(); } if (ev.key === "Escape") close(); });
  // Esc 는 어디서든 상자·목록·찍기를 닫는다. 바깥 클릭은 목록과, 아무것도 안 적은 상자만 닫는다(적던 글은 안 버린다)
  const boxOn = () => $("fx-box").style.display === "block";
  $("fx-x").onclick = close;
  addEventListener("keydown", ev => {
    if (ev.key !== "Escape") return;
    if (boxOn() || document.body.classList.contains("fx-pick")) close(); else if (fx.classList.contains("open")) fx.classList.remove("open"); else return;
    ev.preventDefault(); ev.stopPropagation();
  }, true);
  addEventListener("pointerdown", ev => {
    if (fx.contains(ev.target) || $("fx-box").contains(ev.target)) return;
    fx.classList.remove("open"); if (boxOn() && !$("fx-t").value.trim()) close();
  }, true);
  show(first);
  // 「아직 보고 있음」 — 연결 하나를 열어 둔다. 창을 닫으면 끊기고, 바탕화면 앱으로 켠 서버는 열린 연결이 0이 된 지 20초면 스스로 꺼진다.
  // 타이머가 아니라 연결인 이유: 크롬은 가려진 탭의 타이머를 늦추지만 열린 연결은 그대로 둔다 — 다른 창 뒤에 있어도 「보고 있음」으로 친다
  const open = new EventSource(API + "open"); open.onerror = () => {};

  // 🤖 클로드 — 이 컴퓨터의 Claude Code 와 대화(서버 /api/claude). 세션 id 로 이어 가고, 대화는 이 브라우저에 남는다(설계 창·회로 창 공용)
  fetch(API + "claude/status").then(r => r.ok ? r.json() : null).then(d => { if (d && d.ok) chat(); }).catch(() => {});
  function chat() {
    const KEY = "algotrip-claude", get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
    let S = get(); S.msgs = S.msgs || []; let ctl = null, edited = false;
    const keep = () => { S.msgs = S.msgs.slice(-60); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} };
    document.head.insertAdjacentHTML("beforeend", `<style>
    #fx>#cl-b{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;background:#D97757;border:0;border-radius:50%;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15)}
    #fx>#cl-b:hover{background:#C96442}#fx>#cl-b:focus-visible{outline:2px solid #0e6f7c;outline-offset:2px}#cl-b svg{width:64%;height:64%;display:block}
    #cl{position:absolute;left:0;bottom:36px;width:min(480px,calc(100vw - 20px));height:min(64vh,660px);background:#fff;border:1px solid #d5d9df;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.15);display:none;flex-direction:column}
    #cl.on{display:flex}
    #cl .h{display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid #eceff2}#cl .h b{flex:1}
    #cl button{font:inherit;background:#fff;color:#1d2229;border:1px solid #d5d9df;border-radius:6px;padding:3px 9px;cursor:pointer}
    #cl .m{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
    #cl .u,#cl .a{white-space:pre-wrap;word-break:break-word;padding:6px 9px;border-radius:6px;max-width:92%}
    #cl .u{align-self:flex-end;background:#e3f1f2}#cl .a{align-self:flex-start;background:#f4f5f7}
    #cl .t{color:#6b7280;font-size:11px;word-break:break-all}#cl .er{color:#c0262d;white-space:pre-wrap}#cl .em{color:#6b7280;margin:auto;text-align:center;line-height:1.6}
    #cl form{display:flex;gap:6px;padding:8px;border-top:1px solid #eceff2;align-items:end}
    #cl textarea{flex:1;height:44px;resize:none;box-sizing:border-box;background:#fbfbfb;color:#1d2229;border:1px solid #d5d9df;border-radius:6px;padding:6px;font:inherit}
    </style>`);
    const ray = [[56.4, 4.4, 9], [73.4, 20.1, 7], [90.8, 33.5, 8], [85.6, 55, 7], [87, 78.9, 9], [64.6, 86.2, 7], [44, 92.6, 8], [27.2, 79.2, 7], [7.3, 67.2, 9], [10.4, 44.4, 7], [15.3, 22.9, 8], [36.5, 16.6, 7]];
    fx.insertAdjacentHTML("beforeend", `<button type="button" id="cl-b" title="클로드 — 이 프로그램에 대해 묻거나 고쳐 달라고 하기" aria-label="클로드"><svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-linecap="round" aria-hidden="true">${ray.map(([x, y, w]) => `<line x1="50" y1="50" x2="${x}" y2="${y}" stroke-width="${w}"/>`).join("")}</svg></button>
    <div id="cl"><div class="h"><b>클로드</b><button type="button" id="cl-new" title="지금 대화를 지우고 새로 시작">새 대화</button><button type="button" id="cl-x" title="닫기">✕</button></div>
    <div class="m" id="cl-m"></div><form id="cl-f"><textarea id="cl-t" placeholder="묻거나 고쳐 달라고 적으세요 (Enter 보내기 · Shift+Enter 줄바꿈)"></textarea><button id="cl-go">보내기</button></form></div>`);
    const box = $("cl"), M = $("cl-m");
    const row = m => m.k === "u" ? `<div class="u">${e(m.v)}</div>` : m.k === "a" ? `<div class="a">${e(m.v).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</div>` : m.k === "t" ? `<div class="t">${e(m.v)}</div>` : `<div class="er">${e(m.v)}</div>`;
    const draw = () => { M.innerHTML = S.msgs.length ? S.msgs.map(row).join("") : '<div class="em">알고트립에 대해 묻거나, 화면·데이터를 고쳐 달라고 할 수 있어요.<br>클로드가 이 저장소의 파일을 고쳐요.<br>고친 뒤엔 화면이 저절로 새로 읽혀요.</div>'; M.scrollTop = M.scrollHeight; };
    const page = () => `${document.title.replace(/ — .*$/, "")} ${location.hash || "#"}`.trim();
    // claude stream-json 한 줄 → 화면에 보일 것들
    function events(d) {
      const out = [];
      if (d.session_id) out.push({ t: "sid", v: d.session_id });
      if (d.type === "stream_event") { const ev = d.event || {}; if (ev.type === "content_block_delta" && (ev.delta || {}).type === "text_delta") out.push({ t: "text", v: ev.delta.text || "" }); }
      else if (d.type === "assistant") for (const c of (d.message || {}).content || []) { if (c.type === "tool_use") { const i = c.input || {}; out.push({ t: "tool", name: c.name, v: i.file_path || i.pattern || i.command || "" }); } }
      else if (d.type === "result") {
        for (const x of d.permission_denials || []) out.push({ t: "deny", name: x.tool_name, v: JSON.stringify(x.tool_input || {}).slice(0, 160) });
        if (d.is_error) out.push({ t: "err", v: String(d.result || d.subtype || "실패") });
      } else if (d.type === "fix_error") out.push({ t: "err", v: d.text });
      return out;
    }
    async function send() {
      const text = $("cl-t").value.trim(); if (!text || ctl) return;
      $("cl-t").value = ""; S.msgs.push({ k: "u", v: text }); keep(); draw();
      ctl = new AbortController(); $("cl-go").textContent = "중지"; edited = false;
      let cur = null;
      const add = m => { S.msgs.push(m); return m; }, tail = () => { keep(); draw(); };
      const on = ev => {
        if (ev.t === "sid") S.session = ev.v;
        else if (ev.t === "text") { if (!cur) cur = add({ k: "a", v: "" }); cur.v += ev.v; tail(); }
        else if (ev.t === "tool") { cur = null; if (/^(Edit|Write)$/.test(ev.name)) edited = true; add({ k: "t", v: `· ${ev.name} ${ev.v}` }); tail(); }
        else if (ev.t === "deny") { add({ k: "t", v: `· 허용 안 된 일이라 막힘: ${ev.name} ${ev.v}` }); tail(); }
        else if (ev.t === "err") { add({ k: "e", v: ev.v }); tail(); }
      };
      try {
        const r = await fetch(API + "claude", { method: "POST", headers: { "X-FIX": "1" }, body: `${S.session || ""}\n${page()}\n${text}`, signal: ctl.signal });
        if (!r.ok) throw new Error(await r.text() || "서버 " + r.status);
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { done, value } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); const L = buf.split("\n"); buf = L.pop();
          L.forEach(l => { if (!l.trim()) return; try { events(JSON.parse(l)).forEach(on); } catch (_) {} });
        }
        if (edited) { add({ k: "t", v: "· 파일이 바뀌어서 화면을 새로 읽어요" }); S.reopen = true; keep(); setTimeout(() => location.reload(), 600); }
      } catch (err) { add(err.name === "AbortError" ? { k: "t", v: "· 중지했어요" } : { k: "e", v: err.message }); }
      ctl = null; $("cl-go").textContent = "보내기"; tail();
    }
    $("cl-b").onclick = () => { box.classList.toggle("on"); fx.classList.remove("open"); if (box.classList.contains("on")) { draw(); $("cl-t").focus(); } };
    $("cl-x").onclick = () => box.classList.remove("on");
    $("cl-new").onclick = () => { if (ctl) ctl.abort(); S = { msgs: [] }; keep(); draw(); $("cl-t").focus(); };
    if (S.reopen) { S.reopen = false; keep(); box.classList.add("on"); draw(); } // 새로 읽기 전에 열려 있었으면 다시 연다
    $("cl-f").onsubmit = ev => { ev.preventDefault(); if (ctl) ctl.abort(); else send(); };
    $("cl-t").addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(); } if (ev.key === "Escape") box.classList.remove("on"); });
  }
})();
