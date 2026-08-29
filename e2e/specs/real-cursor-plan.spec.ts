import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chooseNativeMenu, E2E_SESSION_ID, launchVav } from '../launch'

/**
 * MANUAL gold-standard run against the real cursor-agent binary (uses the
 * developer's Cursor login and real model calls). Not for CI.
 */
test('real cursor-agent: accepting the plan continues into implementation', async () => {
  test.setTimeout(420_000)
  const harness = await launchVav({
    liveAcp: true,
    acpBinary: '/Users/oboo/.local/bin/cursor-agent'
  })
  try {
    const { page, workspace } = harness

    // Boot a session, then switch it to Plan mode like a user would.
    await page.locator('[data-testid="composer-input"]').fill('hi, reply with one word')
    await page.locator('[data-testid="composer-send"]').click()
    const mode = page.locator('[data-testid="session-run-controls"]')
    await expect(mode).toHaveAttribute('data-session-mode', 'agent', { timeout: 90_000 })
    await expect(page.locator('[data-testid="message-assistant"]')).toBeVisible({
      timeout: 120_000
    })
    await page.locator('[data-testid="session-run-mode"]').click()
    await chooseNativeMenu(page, 'Plan')
    await expect(mode).toHaveAttribute('data-session-mode', 'plan')

    await page
      .locator('[data-testid="composer-input"]')
      .fill('Make a very short plan (1 todo) to create a file named hello.txt containing "hi". Keep it minimal.')
    await page.locator('[data-testid="composer-send"]').click()

    const planCard = page.locator('[data-testid="plan-doc"]')
    await expect(planCard).toBeVisible({ timeout: 180_000 })
    await planCard.getByRole('button', { name: 'Accept plan' }).click()
    await expect(planCard).toHaveAttribute('data-status', 'completed', { timeout: 30_000 })

    // Conclusive: the accepted plan is actually implemented — the file
    // appears in the workspace without any further user input.
    await expect
      .poll(() => existsSync(join(workspace, 'hello.txt')), { timeout: 180_000 })
      .toBe(true)
    expect(readFileSync(join(workspace, 'hello.txt'), 'utf8')).toContain('hi')

    // And it stayed one continuous assistant turn (no error, not cancelled).
    await expect
      .poll(
        async () => {
          const conversation = await page.evaluate(
            (id) => window.vav.conversations.get(id),
            E2E_SESSION_ID
          )
          const messages = (conversation?.messages ?? []) as Array<{
            role: string
            errorText?: string | null
            cancelled?: boolean
          }>
          const last = messages.at(-1)
          return {
            users: messages.filter((m) => m.role === 'user').length,
            error: last?.errorText ?? null,
            cancelled: last?.cancelled ?? false
          }
        },
        { timeout: 120_000 }
      )
      .toEqual({ users: 2, error: null, cancelled: false })
  } finally {
    await harness.dispose()
  }
})
