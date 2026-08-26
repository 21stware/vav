import { test, expect } from '@playwright/test'
import { E2E_SESSION_B_ID, E2E_SESSION_ID, launchVav } from '../launch'

/**
 * Sidebar session selection — click switches the open transcript.
 */
test('clicking a sidebar row selects that conversation', async () => {
  const harness = await launchVav({ seedConversation: 'agent', extraSession: true })
  try {
    const { page } = harness
    const first = page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    const second = page.locator(
      `[data-testid="session-row"][data-conversation-id="${E2E_SESSION_B_ID}"]`
    )
    await expect(first).toHaveClass(/selected/)
    await expect(page.locator('[data-testid="message-user"]').first()).toContainText(
      'Inspect hello.md'
    )

    await second.click()
    await expect(second).toHaveClass(/selected/)
    await expect(first).not.toHaveClass(/selected/)
    await expect(page.locator('.empty-state-session')).toBeVisible()
    await expect(page.locator('[data-testid="message-user"]')).toHaveCount(0)

    await first.click()
    await expect(first).toHaveClass(/selected/)
    await expect(page.locator('[data-testid="message-user"]').first()).toContainText(
      'Inspect hello.md'
    )
  } finally {
    await harness.dispose()
  }
})

test('new session is selected and the previous row stays listed', async () => {
  const harness = await launchVav({ extraSession: true })
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(2)
    await page.locator('[data-testid="new-session"]').click()
    await expect(page.getByText('New session')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(3)
    await expect(page.locator('.empty-state-session')).toBeVisible()
    await expect(
      page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
