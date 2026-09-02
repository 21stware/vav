import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

test('Grok goal banner shows the session objective and controls', async () => {
  const harness = await launchVav({ seedConversation: 'acp-goal' })
  try {
    const { page } = harness
    const banner = page.locator('[data-testid="goal-banner"]')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Migrate the auth module to the new API')
    await expect(banner).toContainText('writing tests')
    await expect(page.locator('[data-testid="goal-pause"]')).toBeVisible()
    await expect(page.locator('[data-testid="goal-clear"]')).toBeVisible()
    await expect(page.locator('[data-testid="goal-resume"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
