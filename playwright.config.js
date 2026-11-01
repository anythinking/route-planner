// @ts-check
import { defineConfig, devices } from '@playwright/test';

// 기존 단위 테스트(tests/*.test.js, node --test)와 섞이지 않게 E2E는 e2e/ 폴더만 씀
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // npm run serve 와 같은 정적 서버를 테스트 때 자동으로 띄움
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
  },
});
