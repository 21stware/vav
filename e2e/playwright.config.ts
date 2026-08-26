import { defineConfig } from '@playwright/test'

/**
 * Local-only Electron e2e. Does not install browsers and is not wired into CI.
 *
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../test-results/e2e',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
