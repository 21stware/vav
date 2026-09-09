import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test, expect } from '@playwright/test'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import {
  launchWorkbench,
  openSettingsWindow,
  readUserSetting,
  readVavServerSetting,
  seedVavKeyAccount,
  waitForDaemonPairing
} from '../launch'

const execFileAsync = promisify(execFile)
const root = join(__dirname, '../..')
const aliasHook = pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href

function vav-board(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ['--import', aliasHook, '--experimental-strip-types', join(root, 'packages/vav-board/src/vav-board.ts'), ...args],
    { cwd: root, timeout: 20_000 }
  )
}

/**
 * README.rpml §1.4 / §2.6 — Settings is its own window, save-on-change,
 * Escape / chrome closes, no Done footer.
 */
test('settings is a separate window with category nav and no Done footer', async () => {
  const harness = await launchWorkbench()
  try {
    const settings = await openSettingsWindow(harness, 'appearance')
    const categories = [
      ['agents', 'Providers'],
      ['analysis', 'Usage'],
      ['workspace', 'Workspace'],
      ['appearance', 'Appearance'],
      ['keybindings', 'Key Bindings'],
      ['notifications', 'Notifications'],
      ['connect', 'Remote Tunnel'],
      ['connectors', 'Connectors'],
      ['cli', 'Command Line'],
      ['file-associations', 'File Associations'],
      ['logs', 'Logs'],
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

test('screenshot keep-front toggle persists on change', async () => {
  const harness = await launchWorkbench()
  try {
    const settings = await openSettingsWindow(harness, 'appearance')
    const toggle = settings.locator('[data-testid="settings-screenshot-keep-front"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect
      .poll(() => readUserSetting(harness.userData, 'screenshotKeepWindowFront'))
      .toBe(false)
  } finally {
    await harness.dispose()
  }
})

test('appearance zoom persists on change', async () => {
  const harness = await launchWorkbench()
  try {
    const settings = await openSettingsWindow(harness, 'appearance')
    const slider = settings.locator('[data-testid="settings-ui-zoom"]')
    await expect(slider).toHaveValue('100')
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement
      input.value = '125'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(() => readUserSetting(harness.userData, 'uiZoom')).toBe(1.25)
  } finally {
    await harness.dispose()
  }
})

test('appearance toggle persists on change', async () => {
  const harness = await launchWorkbench()
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
  const harness = await launchWorkbench()
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

test('accounts catalog drafts and lists a VAV key through the same IPC Settings uses', async () => {
  const harness = await launchWorkbench()
  try {
    const drafted = await harness.page.evaluate(async () => {
      const { id } = await window.vav.accounts.createDraft({ agentId: 'vav', kind: 'vav_key' })
      const page = await window.vav.accounts.getPage()
      return { id, listed: page.accounts.some((row) => row.id === id) }
    })
    expect(drafted.id).toBeTruthy()
    expect(drafted.listed).toBe(true)
    await harness.page.evaluate((id) => window.vav.accounts.remove(id), drafted.id)
  } finally {
    await harness.dispose()
  }
})

test('Providers VAV editor shows the API key form after a profile is saved', async () => {
  const harness = await launchWorkbench()
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
  const harness = await launchWorkbench()
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
  const harness = await launchWorkbench()
  try {
    const settings = await openSettingsWindow(harness, 'workspace')
    await expect(settings.locator('[data-testid="settings-default-dir"]')).toHaveValue(
      harness.workspace
    )
    await settings.locator('[data-testid="settings-nav-connectors"]').click()
    await expect(settings.locator('[data-testid="settings-connectors"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-connector-login-github"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-connector-login-vercel"]')).toBeVisible()
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
    await expect(settings.locator('[data-testid="settings-vercel-tray"]')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await settings.locator('[data-testid="settings-github-tray"]').click()
    await expect.poll(() => readVavServerSetting(harness.userData, 'githubTrayEnabled')).toBe(false)
    expect(readUserSetting(harness.userData, 'githubTrayEnabled')).not.toBe(false)
    await settings.locator('[data-testid="settings-nav-workspace"]').click()

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

test('About update policy persists and Check for Updates shows a loading indicator', async () => {
  const harness = await launchWorkbench()
  try {
    const settings = await openSettingsWindow(harness, 'about')
    const updatePolicy = settings.locator('[data-testid="settings-auto-update-policy"]')
    await expect(updatePolicy).toHaveValue('off')
    await expect(updatePolicy.locator('option')).toHaveCount(4)
    await settings.getByRole('button', { name: 'Check for Updates' }).click()
    await expect(settings.locator('[data-testid="settings-about-update-checking"]')).toBeVisible()
    await updatePolicy.selectOption('download')
    await expect.poll(() => readUserSetting(harness.userData, 'autoUpdatePolicy')).toBe(
      'download'
    )
  } finally {
    await harness.dispose()
  }
})

test('Logs shows retention policy and empty-or-boot records', async () => {
  const harness = await launchWorkbench()
  try {
    const settings = await openSettingsWindow(harness, 'logs')
    await expect(settings.locator('.settings-head')).toHaveText('Logs')
    await expect(settings.locator('[data-testid="settings-log-retention"]')).toHaveValue('7')
    await expect(settings.locator('[data-testid="settings-log-list"]')).toBeVisible()
    await settings.locator('[data-testid="settings-log-retention"]').selectOption('3')
    await expect.poll(() => readVavServerSetting(harness.userData, 'logRetentionDays')).toBe(3)
    expect(readUserSetting(harness.userData, 'logRetentionDays')).not.toBe(3)
  } finally {
    await harness.dispose()
  }
})

test('spawned vav-server host settings match desktop Settings and vav-board', async () => {
  test.setTimeout(90_000)
  const harness = await launchWorkbench()
  try {
    await expect
      .poll(async () => {
        const hosts = await harness.page.evaluate(() => window.vav.hosts.list())
        return hosts.some((host) => host.localShell && host.controlPlane === true && host.online)
      })
      .toBe(true)

    const settings = await openSettingsWindow(harness, 'connectors')
    await settings.locator('[data-testid="settings-github-tray"]').click()
    await expect
      .poll(async () => {
        const page = await harness.page.evaluate(() => window.vav.settings.get())
        return page.githubTrayEnabled
      })
      .toBe(false)
    await expect.poll(() => readVavServerSetting(harness.userData, 'githubTrayEnabled')).toBe(false)
    expect(readUserSetting(harness.userData, 'githubTrayEnabled')).not.toBe(false)

    const pairing = parseDaemonPairing(await waitForDaemonPairing(harness.page))
    expect(pairing?.secret).toBeTruthy()
    const auth = ['--host', '127.0.0.1', '--port', String(pairing!.port), '--secret', pairing!.secret]
    const updated = JSON.parse(
      (await vav-board(['settings', 'set', '--approval', 'edit', ...auth])).stdout
    ) as { defaultApprovalMode?: string }
    expect(updated.defaultApprovalMode).toBe('edit')
    await expect
      .poll(async () => {
        const page = await harness.page.evaluate(() => window.vav.settings.get())
        return page.defaultApprovalMode
      })
      .toBe('edit')
    await expect.poll(() => readVavServerSetting(harness.userData, 'defaultApprovalMode')).toBe('edit')
    expect(readUserSetting(harness.userData, 'defaultApprovalMode')).not.toBe('edit')

    await harness.page.evaluate(() => window.vav.settings.setApiKey('sk-e2e-vav-server-key'))
    await expect
      .poll(() => {
        try {
          return readFileSync(join(harness.userData, 'vav-server', 'apikey'), 'utf8').trim()
        } catch {
          return ''
        }
      })
      .toBe('sk-e2e-vav-server-key')
  } finally {
    await harness.dispose()
  }
})

test('Escape hides the settings window', async () => {
  const harness = await launchWorkbench()
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
