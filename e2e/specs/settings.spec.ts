import { test, expect } from '@playwright/test'
import { launchVav, openSettingsWindow, readUserSetting, seedVavKeyAccount } from '../launch'

/**
 * README.rpml §1.4 / §2.6 — Settings is its own window, save-on-change,
 * Escape / chrome closes, no Done footer.
 */
test('settings is a separate window with category nav and no Done footer', async () => {
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'appearance')
    const categories = [
      ['agents', 'Providers'],
      ['analysis', 'Usage'],
      ['workspace', 'Workspace'],
      ['appearance', 'Appearance'],
      ['keybindings', 'Key Bindings'],
      ['notifications', 'Notifications'],
      ['cli', 'Command Line'],
      ['file-associations', 'File Associations'],
      ['about', 'About']
    ] as const
    for (const [id] of categories) {
      await expect(settings.locator(`[data-testid="settings-nav-${id}"]`)).toBeVisible()
    }
    await expect(settings.getByRole('button', { name: /^done$/i })).toHaveCount(0)

    for (const [id, title] of categories) {
      await settings.locator(`[data-testid="settings-nav-${id}"]`).click()
      await expect(settings.locator('.settings-head')).toHaveText(title)
    }
  } finally {
    await harness.dispose()
  }
})

test('appearance toggle persists on change', async () => {
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'appearance')
    const toggle = settings.locator('[data-testid="settings-reduce-motion"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await expect.poll(() => readUserSetting(harness.userData, 'reduceMotion')).toBe(false)

    await settings.locator('[data-testid="segment-dark"]').first().click()
    await expect.poll(() => readUserSetting(harness.userData, 'theme')).toBe('dark')
  } finally {
    await harness.dispose()
  }
})

test('Providers lists CLI hosts and keeps Swarm off', async () => {
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'agents')
    await expect(settings.locator('.settings-head')).toHaveText('Providers')
    await expect(settings.locator('[data-testid="providers-list"]')).toBeVisible()
    await expect(settings.locator('[data-testid="provider-row-claude"]')).toBeVisible()
    await expect(settings.locator('[data-testid="provider-row-codex"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-swarm-mode"]')).toHaveAttribute(
      'aria-checked',
      'false'
    )

    await settings.locator('[data-testid="provider-row-claude"]').click()
    await expect(settings.locator('[data-testid="provider-editor-name"]')).toHaveText('Claude Code')
  } finally {
    await harness.dispose()
  }
})

test('Providers VAV editor shows the API key form after a profile is saved', async () => {
  const harness = await launchVav()
  try {
    await seedVavKeyAccount(harness.page)
    const settings = await openSettingsWindow(harness, 'agents')
    await settings.locator('[data-testid="provider-row-deepseek"]').click()
    await expect(settings.locator('[data-testid="provider-editor-name"]')).toHaveText('DeepSeek')
    await expect(settings.locator('[data-testid="settings-api-key"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-api-key-reveal"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-api-key-validate"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-api-key-hint"]')).toContainText(
      'Configured:'
    )
  } finally {
    await harness.dispose()
  }
})

test('Key Bindings shows send-key and accelerator groups', async () => {
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'keybindings')
    await expect(settings.locator('[data-testid="settings-keybindings"]')).toBeVisible()
    await expect(settings.getByText('Send & global')).toBeVisible()
    await expect(settings.getByText('Session', { exact: true })).toBeVisible()
    await expect(settings.locator('[data-testid="segment-enter"]')).toBeVisible()
    await settings.locator('[data-testid="segment-mod-enter"]').click()
    await expect.poll(() => readUserSetting(harness.userData, 'sendKey')).toBe('mod-enter')
  } finally {
    await harness.dispose()
  }
})

test('Workspace, Notifications, About, Usage, Command Line, and File Associations paint', async () => {
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'workspace')
    await expect(settings.locator('[data-testid="settings-default-dir"]')).toHaveValue(
      harness.workspace
    )
    await expect(settings.locator('[data-testid="settings-github-tray"]')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(settings.locator('[data-testid="settings-cloudflare-tray"]')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await expect(settings.locator('[data-testid="settings-supabase-tray"]')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await settings.locator('[data-testid="settings-github-tray"]').click()
    await expect.poll(() => readUserSetting(harness.userData, 'githubTrayEnabled')).toBe(false)

    await settings.locator('[data-testid="settings-nav-notifications"]').click()
    const notify = settings.locator('[data-testid="settings-notifications-enabled"]')
    await expect(notify).toHaveAttribute('aria-checked', 'false')
    await notify.click()
    await expect.poll(() => readUserSetting(harness.userData, 'notificationsEnabled')).toBe(true)

    await settings.locator('[data-testid="settings-nav-about"]').click()
    await expect(settings.locator('[data-testid="settings-about-version"]')).not.toHaveText('—')
    await expect(settings.locator('[data-testid="settings-about-license"]')).toHaveText(
      'PolyForm Noncommercial'
    )

    await settings.locator('[data-testid="settings-nav-analysis"]').click()
    await expect(settings.locator('[data-testid="settings-analysis"]')).toBeVisible()
    await expect(settings.getByText('No usage recorded yet')).toBeVisible()

    await settings.locator('[data-testid="settings-nav-cli"]').click()
    await expect(settings.locator('[data-testid="settings-cli"]')).toBeVisible()
    await expect(settings.getByText('VAV command')).toBeVisible()

    await settings.locator('[data-testid="settings-nav-file-associations"]').click()
    await expect(settings.locator('[data-testid="settings-assoc"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Escape hides the settings window', async () => {
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'appearance')
    await settings.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await expect
      .poll(() =>
        harness.app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find((w) => {
            try {
              return new URL(w.webContents.getURL()).searchParams.get('view') === 'settings'
            } catch {
              return false
            }
          })
          return win?.isVisible() ?? false
        })
      )
      .toBe(false)
  } finally {
    await harness.dispose()
  }
})
