// 탭 줄에 없는 문서 쪽 — 개인정보처리방침 · 이용약관 · 404. 글만 있고 상태는 없다.
const UPDATED = '2026년 11월 2일';
const CONTACT = '<a href="https://github.com/anythinking/route-planner/issues" target="_blank" rel="noopener">GitHub 이슈</a>';

const PRIVACY = `
<h2>개인정보처리방침</h2>
<p class="muted">시행일 ${UPDATED}</p>
<p>AlgoTrip(이하 「서비스」)은 개인이 운영하는 무료 여행 동선 도구예요. 서비스를 쓰는 데 꼭 필요한 정보만 받고, 광고나 판매에는 쓰지 않아요.</p>
<h3>받는 정보</h3>
<ul>
<li><b>로그인 없이 쓸 때</b> — 아무것도 서버로 보내지 않아요. 플랜은 주소(링크) 안에만 담겨요.</li>
<li><b>회원가입·로그인</b> — 이메일, 이름(화면에 보일 별명), 비밀번호. 비밀번호는 암호화돼 저장되고 운영자도 볼 수 없어요.</li>
<li><b>여행에 저장한 것</b> — 플랜(장소·날짜·시간), 살 것·준비물 체크, 올린 사진과 그 사진의 위치(사진 안 GPS 또는 직접 고른 장소), 같이 보는 사람과 초대 기록.</li>
<li><b>구글 타임라인 가져오기</b> — 파일은 브라우저 안에서만 읽고 서버로 보내지 않아요. 거기서 만든 플랜만 저장돼요.</li>
<li><b>AI에게 말하기</b> — 적은 문장과 지금 플랜의 도시·장소 목록이 답을 만들기 위해 AI 회사(Anthropic)로 전달돼요. 서비스는 그 대화를 따로 보관하지 않아요.</li>
</ul>
<h3>쓰는 곳</h3>
<p>로그인, 여행 저장과 불러오기, 같이 보는 사람에게 보여 주기, 그리고 문제가 생겼을 때 고치는 데에만 써요.</p>
<h3>맡기는 곳</h3>
<ul>
<li><b>Supabase</b> — 계정, 여행, 사진 파일 저장</li>
<li><b>GitHub Pages</b> — 웹사이트 전달(접속 기록이 남을 수 있어요)</li>
<li><b>OpenFreeMap · jsDelivr</b> — 지도 그림과 프로그램 파일 전달(접속 주소가 전달돼요)</li>
<li><b>Anthropic</b> — 「AI에게 말하기」를 쓸 때만</li>
</ul>
<h3>보관 기간</h3>
<p>탈퇴하거나 직접 지울 때까지 보관해요. 탈퇴하면 계정과 여행, 사진이 바로 지워져요. 서버 백업에 남은 사본도 백업 주기가 지나면 사라져요.</p>
<h3>공개 범위</h3>
<p>여행은 기본이 「비공개」예요. 「링크 초대」로 바꾸면 링크를 받은 사람이, 「공개」로 바꾸면 누구나 볼 수 있어요. 공개한 여행은 홈의 「다른 사람의 플랜」에 이름과 함께 보여요.</p>
<h3>내 권리</h3>
<p>계정 화면에서 언제든 내 정보를 보고, 고치고, 「내 데이터」로 내려받고, 「회원 탈퇴」로 모두 지울 수 있어요.</p>
<h3>브라우저 저장소</h3>
<p>로그인 상태와 화면 설정(고른 탭, 접어 둔 칸 등)을 브라우저 저장소에 남겨요. 광고·분석용 쿠키는 쓰지 않아요.</p>
<h3>만 14세 미만</h3>
<p>만 14세 미만은 회원가입을 하지 말아 주세요.</p>
<h3>문의</h3>
<p>개인정보 관련 문의나 삭제 요청은 ${CONTACT}로 남겨 주세요. 이 방침이 바뀌면 이 쪽에 시행일과 함께 알려요.</p>`;

const TERMS = `
<h2>이용약관</h2>
<p class="muted">시행일 ${UPDATED}</p>
<h3>서비스</h3>
<p>AlgoTrip은 도시의 장소를 골라 하루 동선과 시간을 계산해 주는 무료 도구예요. 개인이 운영하며, 미리 알리고 기능을 바꾸거나 서비스를 멈출 수 있어요.</p>
<h3>정보의 정확성</h3>
<p>이동 시간, 머무는 시간, 해와 그림자, 장소 설명은 계산과 공개 자료로 만든 <b>참고값</b>이에요. 영업시간·요금·교통 상황은 바뀔 수 있으니 떠나기 전에 꼭 공식 정보를 확인해 주세요. 이 값 때문에 생긴 손해는 책임지지 않아요.</p>
<h3>계정</h3>
<p>본인 이메일로 가입하고 비밀번호는 직접 관리해 주세요. 계정은 언제든 탈퇴할 수 있어요.</p>
<h3>내가 올린 것</h3>
<p>플랜, 사진, 메모의 권리는 올린 사람에게 있어요. 서비스는 저장하고 보여 주는 데에만 써요. 남의 권리를 침해하거나 불법인 내용은 올리지 말아 주세요. 그런 내용은 알리지 않고 지울 수 있어요.</p>
<h3>공유</h3>
<p>공개하거나 링크로 초대한 여행은 받은 사람이 보고 복사할 수 있어요. 편집 권한을 준 사람은 내용을 고칠 수 있어요. 누구에게 열지는 여행 주인이 정해요.</p>
<h3>금지</h3>
<p>자동으로 대량 접속하기, 다른 사람 계정 쓰기, 서비스를 방해하는 행동은 하지 말아 주세요.</p>
<h3>문의와 분쟁</h3>
<p>문의는 ${CONTACT}로 남겨 주세요. 이 약관은 대한민국 법을 따라요.</p>`;

// 문서의 각 절을 노선 위 역으로 — 절 번호가 역 동그라미 안에 들어간다
const asLine = html => { let n = 0; return html.replace(/<h3>/g, () => `<h3><i>${++n}</i>`); };

export function renderPage(side, kind, { $, setState, missingTrip }) {
  const p = $('div', 'panel' + (kind === 'notfound' ? ' lost' : ' doc'));
  if (kind === 'privacy') p.innerHTML = asLine(PRIVACY);
  else if (kind === 'terms') p.innerHTML = asLine(TERMS);
  else {
    // 끊긴 노선 — 출발역에서 나온 선이 점선으로 흐려지다 ✕ 역에서 끝난다
    p.innerHTML = `<div class="broken" aria-hidden="true"><span class="stn"><i></i>홈</span><span class="track"></span><span class="gap"></span><span class="stn end"><i>✕</i>${missingTrip ? '여행' : '여기'}</span></div>`
      + (missingTrip
        ? '<h2>이 여행은 노선에 없어요</h2><p>지워졌거나, 주인이 공개 범위를 바꿨거나, 다른 계정으로 로그인해 있을 수 있어요.</p>'
        : '<h2>이 역은 없어요</h2><p>주소가 잘못됐거나 옮겨진 페이지예요. 홈에서 다시 출발해 주세요.</p>');
    const r = $('div', 'row');
    const home = $('button', 'btn primary', '홈으로'); home.type = 'button'; home.onclick = () => setState({ tab: 'home', pr: null });
    const mine = $('button', 'btn ghost', '내 여행'); mine.type = 'button'; mine.onclick = () => setState({ tab: 'mine', pr: null });
    r.append(home, mine); p.appendChild(r);
  }
  side.appendChild(p);
  side.appendChild($('p', 'muted legal', '<a href="#tab=home">홈</a> · <a href="#tab=terms">이용약관</a> · <a href="#tab=privacy">개인정보처리방침</a>'));
}
