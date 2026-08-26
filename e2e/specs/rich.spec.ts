import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

/**
 * Extra agent chrome that does not fit the core sealed-turn seed:
 * branches, quote chip, subtask tree, cancelled, approval, request.
 */
test('rich seed paints branch, quote, subtask, cancelled, approval, and request', async () => {
  const harness = await launchVav({ seedConversation: 'rich' })
  try {
    const { page } = harness
    const pager = page.locator('[data-testid="branch-pager"]')
    await expect(pager).toBeVisible()
    await expect(pager.locator('.variant-count')).toHaveText('2/2')
    await expect(page.locator('[data-testid="message-assistant"]').first()).toContainText(
      'branch B conclusion'
    )
    await expect(page.locator('[data-testid="message-quote-ref"]')).toHaveText(
      'branch B conclusion'
    )

    await expect(page.locator('[data-testid="tool-card"][data-tool="task"]')).toBeVisible()
    await expect(page.locator('[data-testid="task-children"]')).toBeVisible()
    await expect(page.locator('[data-testid="tool-card"][data-tool="web_search"]')).toBeVisible()
    await expect(page.locator('[data-testid="tool-card"][data-tool="load_skill"]')).toBeVisible()

    await expect(page.locator('[data-testid="message-cancelled"]')).toHaveText(
      'This turn was cancelled'
    )

    const approval = page.locator('[data-testid="approval-card"]')
    await expect(approval).toBeVisible()
    await expect(approval.getByText('Awaiting approval')).toBeVisible()
    await expect(approval.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(approval.getByRole('button', { name: 'Deny' })).toBeVisible()

    const request = page.locator('[data-testid="ask-card"]')
    await expect(request).toBeVisible()
    await expect(request.getByText('Allow network for this search?')).toBeVisible()
    await expect(request.getByRole('button', { name: 'Allow' })).toBeVisible()

    await pager.getByTitle('Previous branch').click()
    await expect(pager.locator('.variant-count')).toHaveText('1/2')
    await expect(page.getByText('branch A conclusion')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
