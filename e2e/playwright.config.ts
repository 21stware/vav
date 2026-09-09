import { defineConfig } from '@playwright/test'

/**
 * Electron e2e. Does not install browsers.
 *
 *   npm run test:e2e
 *   npm run test:e2e:vav-server   # remote + phone-remote + vav-board + product-matrix + desktop-over-vav-server + first-run empty + phone-ui + chrome-extension (CI on macos)
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
