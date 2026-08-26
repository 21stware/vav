import { test, expect } from '@playwright/test'
import { launchVav, seedApiKey } from '../launch'

/**
 * Live stub stream / ask — AgentRuntime emits the same TurnEvents as a real
 * VAV turn, without provider HTTP.
 */
test('stub stream shows live output then seals tools and Done', async () => {
  const harness = await launchVav({ stubStream: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await page.locator('[data-testid="composer-input"]').fill('stream please')
    await page.locator('[data-testid="composer-send"]').click()

    const streaming = page.locator('[data-testid="streaming-message"]')
    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(streaming.or(assistant)).toBeVisible()
    if (await streaming.isVisible()) {
      await expect(page.locator('[data-testid="stream-status"][data-state="outputting"]')).toBeVisible()
      await expect(page.locator('[data-testid="tool-card"][data-tool="fs_read"]')).toBeVisible({
        timeout: 8_000
      })
    }

    await expect(assistant).toContainText('e2e stub reply')
    await expect(streaming).toHaveCount(0)
    await expect(page.locator('[data-testid="stream-status"][data-state="done"]')).toBeVisible()
    await expect(page.locator('[data-testid="thinking-process"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('stub ask parks the turn and resumes after a choice', async () => {
  const harness = await launchVav({ stubAsk: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await page.locator('[data-testid="composer-input"]').fill('what next?')
    await page.locator('[data-testid="composer-send"]').click()

    const ask = page.locator('[data-testid="ask-card"]')
    await expect(ask).toBeVisible()
    await expect(page.getByText('Waiting for your answer to continue…')).toBeVisible()
    await ask.getByText('Keep writing').click()
    await ask.getByRole('button', { name: 'Submit' }).click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e stub reply')
    await expect(page.locator('[data-testid="ask-card-sealed"]')).toBeVisible()
    await expect(page.locator('[data-testid="stream-status"][data-state="done"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('stub approve parks the write gate and resumes after Approve', async () => {
  const harness = await launchVav({ stubApprove: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await page.locator('[data-testid="composer-input"]').fill('patch hello')
    await page.locator('[data-testid="composer-send"]').click()

    const card = page.locator('[data-testid="approval-card"]')
    await expect(card).toBeVisible()
    await expect(card.getByText('Awaiting approval')).toBeVisible()
    await card.getByRole('button', { name: 'Approve' }).click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e stub reply · approved')
    await expect(page.locator('[data-testid="tool-card"][data-tool="fs_write"]')).toBeVisible()
    await expect(page.locator('[data-testid="stream-status"][data-state="done"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('stub approve parks the write gate and resumes after Deny', async () => {
  const harness = await launchVav({ stubApprove: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await page.locator('[data-testid="composer-input"]').fill('patch hello')
    await page.locator('[data-testid="composer-send"]').click()

    const card = page.locator('[data-testid="approval-card"]')
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Deny' }).click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e stub reply · denied')
    await expect(page.locator('[data-testid="stream-status"][data-state="done"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
