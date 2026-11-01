import { test, expect, Page } from '@playwright/test';

// 이동·뒤로 가기 막힘 — specs/navigation-dead-ends*.md 에서 찾은 여섯 곳이 다시 깨지지 않게
// 브라우저 저장 모드(?local=1)라 로그인 없이 「이름 → 시작」으로 들어간다

const tab = (page: Page, name: string) => page.locator('#tabs').getByRole('button', { name, exact: true });
const hash = (page: Page) => page.evaluate(() => location.hash);

// 내 여행에 들어가 여행 하나를 만들고 그 상세에 서 있는 상태
async function startWithTrip(page: Page) {
  await page.goto('/?local=1#tab=home');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?local=1#tab=mine');
  await page.getByPlaceholder('이름').fill('테스터');
  await page.getByRole('button', { name: '시작' }).click();
  page.once('dialog', d => d.accept('테스트 여행'));
  await page.getByRole('button', { name: '지금 플랜으로 새 여행' }).click();
  await expect(page.locator('.crumb')).toContainText('테스트 여행');
}
const onList = async (page: Page) => {
  await expect(page.getByRole('button', { name: '지금 플랜으로 새 여행' })).toBeVisible();
  expect(await hash(page)).not.toContain('pr=');
};

test.describe('이동·뒤로 가기', () => {
  test('① 「← 여행」 다음 브라우저 뒤로는 목록으로 간다 (상세↔플랜 핑퐁 없음)', async ({ page }) => {
    await startWithTrip(page);
    await page.getByRole('button', { name: '플랜 열기', exact: true }).first().click();
    await expect(page.locator('.v2head')).toBeVisible();
    await page.locator('.v2head').getByRole('button', { name: '← 여행' }).click();
    await expect(page.locator('.crumb')).toContainText('테스트 여행');
    await page.goBack();
    await onList(page);
  });

  test('② 계정 화면은 자기 주소가 있다 — 새로고침해도 계정, 뒤로는 목록', async ({ page }) => {
    await startWithTrip(page);
    await page.locator('.crumb a').click();
    await onList(page);
    await page.locator('#who button').click();
    await expect(page.getByRole('heading', { name: '내 계정' })).toBeVisible();
    expect(await hash(page)).toContain('tab=account');
    await page.reload();
    await expect(page.getByRole('heading', { name: '내 계정' })).toBeVisible();
    await page.goBack();
    await onList(page);
  });

  test('③ 계정을 벗어난 뒤 「내 여행」 탭은 목록을 연다', async ({ page }) => {
    await startWithTrip(page);
    await page.locator('#who button').click();
    await expect(page.getByRole('heading', { name: '내 계정' })).toBeVisible();
    await tab(page, '홈').click();
    await tab(page, '내 여행').click();
    await onList(page);
    await expect(page.getByRole('heading', { name: '내 계정' })).toHaveCount(0);
  });

  test('④ 상단 탭은 열린 여행을 놓는다', async ({ page }) => {
    await startWithTrip(page);
    await tab(page, '내 여행').click();          // 상세에서 누르면 목록으로
    await onList(page);
    await page.getByText('테스트 여행').first().click();
    await expect(page.locator('.crumb')).toContainText('테스트 여행');
    await tab(page, '홈').click();
    expect(await hash(page)).not.toContain('pr=');
    await tab(page, '내 여행').click();
    await onList(page);
  });
});

test.describe('휴대폰 폭', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('⑤ 없는 여행 404의 「홈으로」가 첫 화면에 보인다', async ({ page }) => {
    await startWithTrip(page);
    await page.goto('/?local=1#tab=mine&pr=nonexist');
    const home = page.getByRole('button', { name: '홈으로' });
    await expect(home).toBeInViewport();
    await expect(page.locator('#mapwrap')).toBeHidden();
  });

  test('⑥ 구간 플랜과 여행 상세의 돌아가기가 지도 위 첫 화면에 있다', async ({ page }) => {
    await startWithTrip(page);
    await expect(page.locator('#mapback')).toHaveText('← 내 여행');
    await expect(page.locator('#mapback')).toBeInViewport();
    await page.getByRole('button', { name: '플랜 열기', exact: true }).first().click();
    await expect(page.locator('#mapback')).toHaveText('← 여행');
    await expect(page.locator('#mapback')).toBeInViewport();
    await page.locator('#mapback').click();
    await expect(page.locator('.crumb')).toContainText('테스트 여행');
  });
});
