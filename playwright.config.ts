import { defineConfig, devices } from '@playwright/test'

/**
 * Run against local dev server by default.
 * Override with TEST_BASE_URL env var to test production:
 *   TEST_BASE_URL=https://distill-peach.vercel.app npx playwright test
 */
const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Uncomment to auto-start dev server during `npx playwright test`:
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: true,
  //   timeout: 60_000,
  // },
})
