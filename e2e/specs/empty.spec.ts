import { test, expect } from '@playwright/test'
import { dismissNativeMenu, launchVav, peekNativeMenu } from '../launch'

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
    const name = page.locator('.empty-state-session [data-testid="empty-workspace-name"]')
    await expect(name).toHaveText('TEMP DIR')
    await name.evaluate((el) => (el as HTMLElement).click())
    await expect
      .poll(async () => {
        const items = await peekNativeMenu(page)
        return items?.some((item) => item.label === 'A new temp folder') ?? false
      })
      .toBe(true)
    await dismissNativeMenu(page)
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

test('empty session hero plays logo and name empty-in on a new visit', async () => {
  const harness = await launchVav({ reduceMotion: false })
  try {
    const { page } = harness
    await expect(page.locator('.empty-state-session')).toBeVisible()

    await page.locator('[data-testid="new-session"]').click()
    await expect(page.locator('.empty-state-session')).toBeVisible()

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const root = document.querySelector('.empty-state-session')
            if (!root?.classList.contains('is-entering')) return 'no-entering'
            if (document.documentElement.dataset.reduceMotion === 'true') return 'reduce-motion'
            const logo = root.querySelector('.empty-logo-mark')
            const unit = root.querySelector('.empty-stagger-unit')
            if (!logo || !unit) return 'missing-nodes'
            const logoAnim = getComputedStyle(logo).animationName
            const unitAnim = getComputedStyle(unit).animationName
            if (!logoAnim.includes('empty-in')) return `logo:${logoAnim}`
            if (!unitAnim.includes('empty-in')) return `name:${unitAnim}`
            return 'ok'
          }),
        { timeout: 2_000 }
      )
      .toBe('ok')

    await expect(page.locator('.empty-state-session [data-testid="empty-workspace-name"]')).toHaveText(
      'TEMP DIR'
    )
  } finally {
    await harness.dispose()
  }
})
