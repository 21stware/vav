import { test, expect } from '@playwright/test'
import { chooseNativeMenu, E2E_SESSION_ID, launchVav } from '../launch'

/**
 * Live ACP stdio fixture (cursor transport). No vendor CLI.
 */
test('live ACP turn streams a reply and publishes session modes', async () => {
  const harness = await launchVav({ liveAcp: true })
  try {
    const { page } = harness
    await expect(page.getByText('E2E ACP live')).toBeVisible()
    await page.locator('[data-testid="composer-input"]').fill('hello acp')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 20_000 })
    await expect(page.locator('[data-testid="acp-session-mode"]')).toContainText('Agent')

    await page.locator('[data-testid="composer-input"]').fill('/')
    await expect(page.locator('[data-testid="acp-slash-compact"]')).toBeVisible()
    await expect(page.locator('[data-testid="acp-slash-cost"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('live ACP session mode native menu reaches session/set_mode', async () => {
  const harness = await launchVav({ liveAcp: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('boot')
    await page.locator('[data-testid="composer-send"]').click()
    const mode = page.locator('[data-testid="acp-session-mode"]')
    await expect(mode).toContainText('Agent', { timeout: 20_000 })

    await mode.click()
    await chooseNativeMenu(page, 'Plan')
    await expect(mode).toContainText('Plan')

    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return conversation?.acpSession?.currentModeId ?? null
      })
      .toBe('plan')
  } finally {
    await harness.dispose()
  }
})
