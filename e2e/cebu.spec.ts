import { test, expect } from '@playwright/test';

// 세부 — 시티·막탄·남부 당일 여행지가 한 도시에 들어 있다. 30km 넘는 구간은 「차」로 추정된다
test('세부: 홈 카드가 있고, 플랜이 그려지며, 오슬롭 같은 시외 구간은 차로 잡힌다', async ({ page }, testInfo) => {
  await page.goto('/?local=1#tab=home');
  await expect(page.locator('.card[data-name*="세부"]')).toBeVisible();
  await page.goto('/?local=1#c=cebu&d=3&v=taxi&p=magellan:0,santonino:1,fortsanpedro:0,templeofleah:0,tops:1,mactanshrine:0,hopping:0,oslob:1,tumalog:0,kawasan:1');
  await expect(page.locator('.v2title h2')).toHaveText('세부');
  await expect(page.locator('.v2title span')).toContainText('10곳');
  // 하루 예산(9:30~19:00)에 남부 당일 코스가 다 안 들어가 한둘은 「시간이 모자라 뺀 곳」으로 갈 수 있다 — 전부 없어지지만 않으면 된다
  const n = await page.locator('.line li.stn').count(); expect(n).toBeGreaterThanOrEqual(8); expect(n).toBeLessThanOrEqual(10);
  if (n < 10) await expect(page.locator('.warnline')).toContainText('시간이 모자라 뺀 곳');
  // 수정 모드가 기본이라 구간은 select — 첫 선택지가 지금 이동수단·분
  const legs = await page.locator('.line li.leg select').evaluateAll(els => els.map(s => s.options[0].text));
  expect(legs.some(t => t.startsWith('차 '))).toBeTruthy();          // 시외 구간
  expect(legs.some(t => t.startsWith('택시 ') || t.startsWith('도보 '))).toBeTruthy();   // 시내 구간
  await page.screenshot({ path: testInfo.outputPath('cebu-plan.png'), fullPage: false });
  await page.goto('/?local=1#c=cebu&d=3&p=magellan:0,oslob:1&tab=guide');
  await expect(page.getByText('세부에서는 특히')).toBeVisible();
  await expect(page.getByText('내가 고른 곳')).toBeVisible();
});

test('세부: 빈 플랜을 열면 지도가 섬 전체가 아니라 세부시티·막탄에 맞는다', async ({ page }, testInfo) => {
  await page.goto('/?local=1#c=cebu&d=3&tab=plan');
  await expect(page.locator('.v2title h2')).toHaveText('세부');
  await page.locator('#map canvas').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('cebu-empty.png') });
  // 지도 안에 보이는 역 이름표: 도심(마젤란·톱스·슈라인)은 보이고 오슬롭은 화면 밖
  // 빈 상태 — 구역 4개가 목록과 지도 이름표에 같이 나오고, 「전체 목록」은 숨는다
  await expect(page.locator('.v2zone')).toHaveCount(4);
  await expect(page.locator('#map .zone')).toHaveCount(4);
  await expect(page.locator('.v2rec')).toHaveCount(0);   // 전체 목록의 상세 행은 담기 안으로
  // 체크하면 담기 상자는 남고, 고른 행엔 꼭·체류 선택이 붙고, 노선엔 역이 선다
  await page.locator('.v2zone .place', { hasText: '마젤란 십자가' }).locator('input').check();
  await expect(page.locator('.v2zone')).toHaveCount(4);
  await expect(page.locator('.v2zone .place input:checked')).toHaveCount(1);
  await expect(page.locator('.v2zone .place', { hasText: '마젤란 십자가' }).locator('select')).toBeVisible();
  await expect(page.locator('.v2lines .addday')).toHaveText('+ 하루 추가');
  await expect(page.locator('.line .addhere').first()).toBeVisible();   // 수정 모드가 기본
  await expect(page.locator('.startrow')).toContainText('출발점(숙소)');
  const labels = await page.locator('#map .mk span').allTextContents();
  expect(labels.some(t => t.includes('톱스') || t.includes('마젤란') || t.includes('슈라인'))).toBeTruthy();
  const oslob = page.locator('#map .mk span', { hasText: '오슬롭' });
  if (await oslob.count()) await expect(oslob.first()).not.toBeInViewport();
});
