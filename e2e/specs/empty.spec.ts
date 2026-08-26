import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

/**
 * first-run/first-run-no-api-key.rpml + session/main-chat-empty.rpml
 *
 * Keychain is already open. Empty VAV session: files/terminal usable,
 * send blocked until a key exists, tools tray starts collapsed.
 */
test('empty VAV session shows the no-key empty state and keeps local tools', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    const empty = page.locator('.empty-state-session')
    await expect(empty).toBeVisible()
    await expect(empty.getByText('Configure an API Key')).toBeVisible()
    await expect(page.locator('[data-testid="empty-open-settings"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-send"]')).toBeDisabled()
    await page.locator('[data-testid="composer-input"]').fill('hello')
    await expect(page.locator('[data-testid="composer-send"]')).toBeEnabled()
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'true'
    )
    await expect(page.locator('[data-testid="workdir-chip"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Open Settings from the no-key empty state opens Providers', async () => {
  const harness = await launchVav()
  try {
    const opened = harness.app.waitForEvent('window')
    await harness.page.locator('[data-testid="empty-open-settings"]').click()
    const settings = await opened
    await expect(settings.locator('[data-testid="settings-window"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-nav-agents"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
