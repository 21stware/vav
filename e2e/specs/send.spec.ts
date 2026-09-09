import { test, expect } from '@playwright/test'
import { launchWorkbench, seedVavKeyAccount } from '../launch'

/**
 * Composer → transcript on the spawned local vav-server (production local = remote).
 * First-run no-key empty state stays on empty.spec (in-process Electron).
 * Provider HTTP is stubbed (VAV_E2E_STUB_TURN).
 */
test('saving a key clears the no-key empty state and a stub turn lands in the transcript', async () => {
  const harness = await launchWorkbench({ stubTurn: true })
  try {
    const { page } = harness
    await seedVavKeyAccount(page)
    await expect(page.locator('.empty-state-session')).toContainText('Harnessed by VAV')

    await page.locator('[data-testid="composer-input"]').fill('ping e2e')
    await page.locator('[data-testid="composer-send"]').click()

    const user = page.locator('[data-testid="message-user"]')
    await expect(user).toBeVisible()
    await expect(user).toContainText('ping e2e')

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toBeVisible()
    await expect(assistant).toContainText('e2e stub reply')
    await expect(page.locator('.empty-state-session')).toHaveCount(0)

    await page.locator('[data-testid="session-search"]').click()
    await page.locator('[data-testid="search-input"]').fill('stub')
    await expect(page.getByText('1 / 1')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
