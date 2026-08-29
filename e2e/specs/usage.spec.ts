import { test, expect } from '@playwright/test'
import { E2E_SESSION_ID, launchVav } from '../launch'

/**
 * Provider usage integration: an ACP host reporting usage_update /
 * turn_completed must surface the conversation's context-window fill
 * (ring on the composer model picker + persisted tokensUsed/tokenLimit).
 */
test('live ACP usage reaches the composer context ring and persists', async () => {
  const harness = await launchVav({ liveAcp: true, acpUsage: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('usage probe')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 20_000 })

    // Persisted conversation: context fill + window size from the host.
    await expect
      .poll(
        async () => {
          const conversation = await page.evaluate(
            (id) => window.vav.conversations.get(id),
            E2E_SESSION_ID
          )
          return {
            tokensUsed: conversation?.tokensUsed ?? 0,
            tokenLimit: conversation?.tokenLimit ?? 0,
            turns: conversation?.tokenHistory?.length ?? 0
          }
        },
        { timeout: 15_000 }
      )
      // turn_completed input (9000) includes cache reads (3000); the snapshot
      // splits them and the context fill lands on the inclusive prompt size.
      .toEqual({ tokensUsed: 9_000, tokenLimit: 240_000, turns: 1 })

    // Composer ring is visible and the hover title carries the percent.
    const ring = page.locator('.agent-model-picker-progress')
    await expect(ring).toBeVisible()
    const title = await page
      .locator('.agent-model-picker-host')
      .getAttribute('title')
    expect(title ?? '').toMatch(/9\.0k\s*\/\s*240\.0k/i)
  } finally {
    await harness.dispose()
  }
})

/**
 * cursor-agent shape: the host never reports usage over ACP and only
 * advertises the window inline on the model id (`context=123k`). The turn
 * must still surface a context fill — estimated from the transcript — and
 * the token limit parsed from the model id.
 */
test('silent ACP host still shows estimated context fill and parsed window', async () => {
  const harness = await launchVav({ liveAcp: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('estimate probe')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 20_000 })

    await expect
      .poll(
        async () => {
          const conversation = await page.evaluate(
            (id) => window.vav.conversations.get(id),
            E2E_SESSION_ID
          )
          return {
            hasFill: (conversation?.tokensUsed ?? 0) > 0,
            tokenLimit: conversation?.tokenLimit ?? 0,
            // Estimates never fabricate per-turn history rows.
            turns: conversation?.tokenHistory?.length ?? 0
          }
        },
        { timeout: 15_000 }
      )
      .toEqual({ hasFill: true, tokenLimit: 123_000, turns: 0 })

    await expect(page.locator('.agent-model-picker-progress')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
