import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

/**
 * Sealed agent output: thinking process, tool cards, plan overlay, plan doc,
 * turn error, and an ask card. No live provider.
 */
test('seeded assistant turn paints tools, plan, error, and ask', async () => {
  const harness = await launchVav({ seedConversation: 'agent' })
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="message-user"]').first()).toContainText(
      'Inspect hello.md'
    )
    await expect(page.locator('[data-testid="message-assistant"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="thinking-process"]')).toBeVisible()
    await expect(page.getByText('e2e agent conclusion')).toBeVisible()

    const process = page.locator('[data-testid="thinking-process"]')
    if (!(await process.getAttribute('class'))?.includes('expanded')) {
      await process.locator(':scope > .tool-row').click()
    }
    await expect(page.locator('[data-testid="tool-card"][data-tool="fs_read"]')).toBeVisible()
    await expect(page.locator('[data-testid="tool-card"][data-tool="fs_write"]')).toBeVisible()
    await expect(page.locator('[data-testid="plan-doc"]')).toBeVisible()
    await expect(page.locator('[data-testid="plan-doc"]')).toContainText('E2E plan doc')
    await expect(page.locator('[data-testid="plan-doc"]')).toContainText('Accepted')

    await expect(page.locator('[data-testid="plan-overlay"]')).toBeVisible()
    await expect(page.locator('[data-testid="plan-overlay"]')).toContainText('Ship e2e')
    await page.locator('[data-testid="plan-overlay-toggle"]').click()
    await expect(page.locator('[data-testid="plan-overlay"]')).toContainText('Write note')

    await page.locator('[data-testid="tool-card"][data-tool="fs_write"] .tool-row').click()
    await expect(page.locator('[data-testid="tool-card"][data-tool="fs_write"]')).toContainText(
      'wrote note.md'
    )

    await expect(page.locator('.message.system.is-error')).toHaveText('e2e turn failed')

    const ask = page.locator('[data-testid="ask-card"]')
    await expect(ask).toBeVisible()
    await expect(ask.getByText('Pick a next step')).toBeVisible()
    await expect(ask.getByText('Keep writing')).toBeVisible()
    await expect(ask.getByText('Open review')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
