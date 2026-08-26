import { test, expect } from '@playwright/test'
import { launchVav, seedApiKey } from '../launch'

/**
 * first-run-no-api-key.rpml (send unblocked) + session/main-chat.rpml
 *
 * Provider HTTP is stubbed (VAV_E2E_STUB_TURN). This is the first real
 * composer → transcript round trip without a live model.
 */
test('saving a key clears the no-key empty state and a stub turn lands in the transcript', async () => {
  const harness = await launchVav({ stubTurn: true })
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="empty-open-settings"]')).toBeVisible()

    await seedApiKey(page)
    await expect(page.locator('[data-testid="empty-open-settings"]')).toHaveCount(0)
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
