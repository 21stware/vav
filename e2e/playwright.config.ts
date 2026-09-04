import { defineConfig } from '@playwright/test'

/**
 * Electron e2e. Does not install browsers.
 *
 *   npm run test:e2e
 *   npm run test:e2e:vavd   # remote-daemon + remote-control (also CI on macos)
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
