#!/usr/bin/env python3
"""알고트립 로컬 서버 — 사이트를 그대로 내주고, 「📝 고칠 것」과 화면 속 클로드를 받는다.

  python3 scripts/serve.py              → http://localhost:8080/  (같은 와이파이에서도 http://<이 맥 IP>:8080/)
  python3 scripts/serve.py --auto-stop  → 열린 화면이 하나도 없으면(연결이 전부 끊긴 지 STOP_AFTER 초) 스스로 꺼진다 — 바탕화면 「알고트립 열기」가 쓴다

· 고칠 것은 docs/고칠것.md 에 「- [ ] 시각 · 화면 · 자리 — 내용」 한 줄씩 쌓인다. 고친 줄은 [x] 로 바꾼다.
  같은 와이파이의 다른 기기가 적은 줄엔 그 기기 주소가 붙는다.
· 클로드(/api/claude)는 이 맥에서 연 화면만 부른다 — 다른 기기·다른 웹사이트는 403. Claude Code(claude -p)를 저장소 안·샌드박스로 돌린다.
· 공개 사이트(GitHub Pages)엔 이 서버가 없어 memo.js 가 아무것도 그리지 않는다.
"""
import json
import os
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES = ROOT / 'docs' / '고칠것.md'
NOTES_HEAD = '# 고칠 것\n\n화면 왼쪽 아래 📝 단추로 쌓인다. 고친 줄은 `[x]` 로 바꾸고 뒤에 「→ 무엇을 고쳤나 (날짜)」를 붙인다.\n\n'
HOST, PORT = os.environ.get('HOST', '0.0.0.0'), int(os.environ.get('PORT', 8080))
LOOPBACK = ('127.0.0.1', '::1', '::ffff:127.0.0.1')

CLAUDE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit(./**)', 'Write(./**)', 'Bash']
CLAUDE_SETTINGS = json.dumps({'sandbox': {'enabled': True, 'autoAllowBashIfSandboxed': True, 'allowUnsandboxedCommands': False,
                                          'network': {'allowLocalBinding': True, 'allowedDomains': ['localhost', '127.0.0.1']}}})
CLAUDE_PROMPT = (
    '이 대화는 「AlgoTrip(알고트립)」 로컬 화면 구석의 작은 채팅창이다. 사용자는 이 앱을 만드는 영철이다. '
    '응답 틀(5절)과 기록 마커는 쓰지 말고, 한국어로 짧게 답한다. 창은 줄글만 보여 주므로 표·제목 없이 쓴다. 메시지 앞 [지금 화면: …]은 사용자가 보는 화면(주소 해시)이다. '
    '구조는 README.md 에 있다: 한 페이지 index.html(스타일 포함), 화면 src/ui.js·src/mine.js, 엔진 src/engine.js, 도시 데이터 data/<city>.json, 조사 원자료 research/. '
    '빌드가 없어 파일을 고치면 새로고침으로 바로 보인다(이 서버는 캐시를 끈다). 「고칠 것」 목록은 docs/고칠것.md. '
    '고치기와 명령은 이 저장소 안에서만 된다(셸은 샌드박스). 고친 뒤 npm test 와 npm run validate 로 확인한다. '
    '사용자에게 시키지 말고 고치기·확인까지 직접 한다. 커밋·push·배포(npm run bump 뒤 push)는 시킬 때만.'
)
BUSY = threading.Lock()
# 자동 종료: 화면(memo.js)이 /api/open 에 연결 하나를 열어 둔다(EventSource). 창을 닫으면 연결이 끊긴다
STOP_AFTER = 20
OPEN = {'n': 0, 'seen': False, 'since': None}
OPEN_LOCK = threading.Lock()


def claude_exe():
    for d in os.environ.get('PATH', '').split(':') + [str(Path.home() / '.local' / 'bin')]:
        p = Path(d) / 'claude'
        if p.is_file():
            return str(p)
    return None


def open_notes():
    if not NOTES.exists():
        return []
    return [l[6:] for l in NOTES.read_text('utf-8').splitlines() if l.startswith('- [ ] ')]


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, fmt, *args):
        if '/api/' in (self.path or '') and not self.path.startswith(('/api/open', '/api/notes')):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # 고치면 새로고침으로 바로
        super().end_headers()

    # 이 서버가 내준 화면이 보낸 요청인가 (다른 웹사이트가 몰래 보내는 것을 막는다)
    def same(self):
        origin = self.headers.get('Origin')
        return origin is None or origin == f"http://{self.headers.get('Host', '')}"

    def loopback(self):
        return self.client_address[0] in LOOPBACK

    def trusted(self):   # 클로드: 이 맥에서 연 화면 + X-FIX 머리글(다른 사이트가 붙이면 브라우저가 먼저 묻고, 이 서버는 답하지 않는다)
        return self.same() and self.loopback() and self.headers.get('X-FIX') == '1' and self.headers.get('Origin') is not None

    def send(self, code, body, kind='application/json'):
        data = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', kind + ('; charset=utf-8' if 'json' in kind or 'text' in kind else ''))
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith('/api/'):
            if not self.same():
                return self.send(403, '{"error":"이 서버가 연 화면에서만 쓸 수 있어요"}')
            if self.path == '/api/notes':
                return self.send(200, json.dumps({'open': open_notes()}, ensure_ascii=False))
            if self.path == '/api/open':
                return self.hold()
            if self.path == '/api/claude/status':
                return self.send(200, json.dumps({'ok': bool(claude_exe()) and self.loopback()}))
            return self.send(404, '{"error":"없는 주소"}')
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace') if n else ''
        if self.path == '/api/note':
            if not self.same():
                return self.send(403, '{"error":"이 서버가 연 화면에서만 쓸 수 있어요"}')
            return self.note(body)
        if self.path == '/api/claude':
            return self.claude(body)
        return self.send(404, '{"error":"없는 주소"}')

    def hold(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Connection', 'close')
        self.end_headers()
        with OPEN_LOCK:
            OPEN['n'] += 1
            OPEN['seen'] = True
            OPEN['since'] = None
        try:
            while True:
                self.wfile.write(b': open\n\n')
                self.wfile.flush()
                time.sleep(5)
        except OSError:
            pass
        finally:
            with OPEN_LOCK:
                OPEN['n'] -= 1
                if OPEN['n'] == 0:
                    OPEN['since'] = time.time()

    # 본문 네 줄: 시각 / 화면 / 자리 / 내용
    def note(self, body):
        parts = [' '.join(s.split()) for s in (body.split('\n', 3) + ['', '', '', ''])[:4]]
        when, page, at, text = parts
        if not text:
            return self.send(200, '{"error":"무엇을 고칠지 한 줄 적어 주세요"}')
        where = ' · '.join(x for x in (page, at) if x)
        who = '' if self.loopback() else f' ({self.client_address[0]})'
        NOTES.parent.mkdir(exist_ok=True)
        new = not NOTES.exists()
        with NOTES.open('a', encoding='utf-8') as f:
            f.write((NOTES_HEAD if new else '') + f'- [ ] {when} · {where} — {text}{who}\n')
        return self.send(200, json.dumps({'open': open_notes()}, ensure_ascii=False))

    # 본문: 첫 줄 세션 id(없으면 빈 줄), 둘째 줄 지금 화면, 나머지가 질문. 답은 claude 의 stream-json 줄을 그대로 흘린다
    def claude(self, body):
        plain = 'text/plain'
        if not self.trusted():
            return self.send(403, '이 컴퓨터에서 연 화면에서만 쓸 수 있어요', plain)
        session, page, text = (body.split('\n', 2) + ['', '', ''])[:3]
        session, page, text = session.strip(), page.strip()[:200], text.strip()
        if not text:
            return self.send(400, '물어볼 말을 적어 주세요', plain)
        if session and not (len(session) == 36 and all(c in '0123456789abcdef-' for c in session.lower())):
            return self.send(400, '대화 번호가 이상해요 — 새 대화를 시작하세요', plain)
        exe = claude_exe()
        if not exe:
            return self.send(400, '이 컴퓨터에 Claude Code(claude)가 없어요', plain)
        if not BUSY.acquire(blocking=False):
            return self.send(409, '다른 질문에 답하는 중 — 끝나면 보내 주세요', plain)
        try:
            cmd = [exe, '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
                   '--settings', CLAUDE_SETTINGS, '--append-system-prompt', CLAUDE_PROMPT, '--allowedTools', *CLAUDE_TOOLS]
            if session:
                cmd += ['--resume', session]
            env = {k: v for k, v in os.environ.items() if k not in ('CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT')}
            p = subprocess.Popen(cmd, cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            p.stdin.write(f'[지금 화면: {page}]\n{text}'.encode('utf-8'))
            p.stdin.close()
            err = []
            t = threading.Thread(target=lambda: err.append(p.stderr.read().decode('utf-8', 'replace')))
            t.start()
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
            self.send_header('Connection', 'close')
            self.end_headers()
            alive = True
            for line in p.stdout:
                try:
                    self.wfile.write(line)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    alive = False
                    break
            if not alive:
                p.kill()
            ok = p.wait() == 0
            t.join()
            if alive and not ok and err and err[0].strip():
                self.wfile.write((json.dumps({'type': 'fix_error', 'text': err[0][-500:]}, ensure_ascii=False) + '\n').encode('utf-8'))
        finally:
            BUSY.release()


if __name__ == '__main__':
    lan = subprocess.run(['ipconfig', 'getifaddr', 'en0'], capture_output=True, text=True).stdout.strip()
    print(f'알고트립: http://localhost:{PORT}/' + (f'  ·  같은 와이파이: http://{lan}:{PORT}/' if lan and HOST == '0.0.0.0' else '')
          + f'  ·  고칠 것: {NOTES.relative_to(ROOT)}  ·  클로드: {"있음" if claude_exe() else "없음"}')
    srv = ThreadingHTTPServer((HOST, PORT), H)
    if '--auto-stop' in sys.argv:
        def watch():
            while True:
                time.sleep(2)
                with OPEN_LOCK:
                    gone = OPEN['seen'] and OPEN['n'] == 0 and OPEN['since'] is not None and time.time() - OPEN['since'] > STOP_AFTER
                if gone and not BUSY.locked():
                    print(time.strftime('%F %T'), '열린 화면이 없어 서버를 끕니다')
                    srv.shutdown()
                    return
        threading.Thread(target=watch, daemon=True).start()
    srv.serve_forever()
