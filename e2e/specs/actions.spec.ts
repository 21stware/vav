import { test, expect } from '@playwright/test'
import { launchWorkbench, seedVavKeyAccount } from '../launch'

/**
 * Hover actions on a sealed stub turn: regenerate into a sibling branch.
 */
test('regenerate opens a second branch', async () => {
  const harness = await launchWorkbench({ stubTurn: true })
  try {
    const { page } = harness
    await seedVavKeyAccount(page)
    await page.locator('[data-testid="composer-input"]').fill('ping e2e')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e stub reply')

    await assistant.locator('.message.assistant').hover()
    await assistant.locator('[data-testid="message-regenerate"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="branch-pager"] .variant-count')).toHaveText('2/2')
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e stub reply')
  } finally {
    await harness.dispose()
  }
})
