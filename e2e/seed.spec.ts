import { test, expect } from '@playwright/test';

// 테스트 에이전트들의 출발점: 알고트립 홈 화면을 연 상태
test.describe('AlgoTrip', () => {
  test('seed', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });
});
