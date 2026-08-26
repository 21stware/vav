import { test, expect } from '@playwright/test'
import { launchVav, seedApiKey } from '../launch'

/**
 * Hover actions on a sealed stub turn: quote into the composer, regenerate
 * into a sibling branch.
 */
test('quote pins a composer chip and regenerate opens a second branch', async () => {
  const harness = await launchVav({ stubTurn: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await page.locator('[data-testid="composer-input"]').fill('ping e2e')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e stub reply')

    await assistant.locator('.message.assistant').hover()
    await assistant.locator('[data-testid="message-quote"]').click()
    await expect(page.locator('[data-testid="composer-quote"]')).toContainText('e2e stub reply')

    await assistant.locator('.message.assistant').hover()
    await assistant.locator('[data-testid="message-regenerate"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="branch-pager"] .variant-count')).toHaveText('2/2')
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e stub reply')

    await page.locator('[data-testid="composer-input"]').press('Escape')
    await expect(page.locator('[data-testid="composer-quote"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
