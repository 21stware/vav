import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  chooseNativeMenu,
  E2E_SESSION_ID,
  launchVav,
  openFilesTray,
  openSettingsWindow
} from '../launch'
import { startVavd } from '../startVavd'

/**
 * Desktop VAV pairs with a real headless vavd, then a session's files list
 * must come from the daemon disk — not this machine's workspace.
 */
test('pair vavd, open its folder, list a file that only exists there', async () => {
  const daemon = await startVavd()
  const harness = await launchVav()
  try {
    const { page } = harness

    const paired = await page.evaluate((payload) => window.vav.hosts.pair(payload), daemon.pairing)
    expect(paired.ok).toBe(true)
    if (!paired.ok) return

    await expect
      .poll(async () => {
        const hosts = await page.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)
      })
      .toMatchObject({ id: paired.host.id, online: true, name: 'E2E Daemon' })

    // Sidebar Connect button surfaces the linked machine's name.
    await expect(page.locator('[data-testid="sidebar-connect"]')).toContainText(
      'Connected to E2E Daemon'
    )

    const stored = JSON.parse(
      readFileSync(join(harness.userData, 'paired-hosts.json'), 'utf8')
    ) as { hosts: { machineId: string }[] }
    expect(stored.hosts[0]?.machineId).toBe(paired.host.id)

    const created = await page.evaluate(
      async ({ path, machineId }) =>
        window.vav.conversations.create({ workingDirectory: path, machineId }),
      { path: daemon.workspace, machineId: paired.host.id }
    )
    expect(created.machineId).toBe(paired.host.id)
    expect(created.workingDirectory).toBe(daemon.workspace)

    const listing = await page.evaluate(
      async ({ path, id }) => window.vav.files.list(path, 'name', true, id),
      { path: daemon.workspace, id: created.id }
    )
    expect(listing.error).toBeUndefined()
    expect(listing.entries.map((e) => e.name)).toContain('remote-only.md')

    const dirs = await page.evaluate(
      async ({ machineId, path }) => window.vav.hosts.listDir(machineId, path),
      { machineId: paired.host.id, path: daemon.workspace }
    )
    expect(dirs.entries.map((e) => e.name)).toContain('remote-pkg')
    expect(dirs.entries.map((e) => e.name)).not.toContain('remote-only.md')

    await page.locator(`[data-testid="session-row"][data-conversation-id="${created.id}"]`).click()
    await openFilesTray(page)
    await expect(page.locator('[data-file-path$="remote-only.md"]')).toBeVisible()
    await expect(page.locator('[data-file-path$="hello.md"]')).toHaveCount(0)

    const text = await page.evaluate(
      (path) => window.vav.files.read(path),
      join(daemon.workspace, 'remote-only.md')
    )
    expect(text.error).toBeUndefined()
    expect(text.content).toContain('planted by vavd e2e')

    await page.evaluate((id) => window.vav.hosts.forget(id), paired.host.id)
    const after = await page.evaluate(() => window.vav.hosts.list())
    expect(after.some((h) => h.id === paired.host.id)).toBe(false)
    await expect(page.locator('[data-testid="sidebar-connect"]')).not.toContainText('E2E Daemon')
  } finally {
    await harness.dispose()
    daemon.stop()
  }
})

test('Settings → Machines rejects garbage, then pairs and forgets a vavd', async () => {
  const daemon = await startVavd()
  const harness = await launchVav()
  try {
    const settings = await openSettingsWindow(harness, 'connect')
    await expect(settings.locator('[data-testid="settings-machines"]')).toBeVisible()

    await settings.locator('[data-testid="settings-machines-pair-input"]').fill('not-a-pairing')
    await settings.locator('[data-testid="settings-machines-pair"]').click()
    await expect(settings.getByText('Pairing failed')).toBeVisible()
    await expect(settings.locator('.machines-list [data-testid^="settings-machine-"]')).toHaveCount(
      0
    )

    await settings.locator('[data-testid="settings-machines-pair-input"]').fill(daemon.pairing)
    await settings.locator('[data-testid="settings-machines-pair"]').click()

    const row = settings.locator('.machines-list [data-testid^="settings-machine-"]').first()
    await expect(row).toBeVisible()
    await expect(row).toContainText('E2E Daemon')
    await expect(row).toContainText('Online')

    const testId = await row.getAttribute('data-testid')
    const hostId = testId?.slice('settings-machine-'.length)
    expect(hostId).toBeTruthy()

    await settings.locator(`[data-testid="settings-machine-forget-${hostId}"]`).click()
    await expect(settings.locator(`[data-testid="settings-machine-${hostId}"]`)).toHaveCount(0)
  } finally {
    await harness.dispose()
    daemon.stop()
  }
})

test('workdir menu opens the remote folder picker and binds the session', async () => {
  const daemon = await startVavd()
  const harness = await launchVav()
  try {
    const { page } = harness
    const paired = await page.evaluate((payload) => window.vav.hosts.pair(payload), daemon.pairing)
    expect(paired.ok).toBe(true)
    if (!paired.ok) return

    await expect
      .poll(async () => {
        const hosts = await page.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)?.online ?? false
      })
      .toBe(true)

    await page.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(page, 'Choose folder on E2E Daemon…')

    const picker = page.locator('[data-testid="remote-folder-picker"]')
    await expect(picker).toBeVisible()
    await page.locator('[data-testid="remote-folder-path"]').fill(daemon.workspace)
    await expect(page.locator('[data-testid="remote-folder-entry-remote-pkg"]')).toBeVisible()
    await page.locator('[data-testid="remote-folder-entry-remote-pkg"]').click()
    await page.locator('[data-testid="remote-folder-select"]').click()

    const nested = join(daemon.workspace, 'remote-pkg')
    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return {
          machineId: conversation?.machineId ?? null,
          path: conversation?.workingDirectory ?? null
        }
      })
      .toEqual({ machineId: paired.host.id, path: nested })

    await openFilesTray(page)
    await expect(page.locator('[data-file-path$="inside.md"]')).toBeVisible()
    await expect(page.locator('[data-file-path$="remote-only.md"]')).toHaveCount(0)
    await expect(page.locator('[data-file-path$="hello.md"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
    daemon.stop()
  }
})
