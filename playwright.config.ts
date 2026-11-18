import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/api/test/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 18000 },
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3029',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: 'node scripts/test-server.mjs',
    cwd: 'apps/web',
    url: 'http://127.0.0.1:3029/health',
    timeout: 180000,
    reuseExistingServer: false,
  },
});
