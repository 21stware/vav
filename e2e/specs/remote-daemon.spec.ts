import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  chooseNativeMenu,
  E2E_SESSION_ID,
  extraWorkspaceLabel,
  launchVav,
  openFilesTray,
  openSettingsWindow,
  waitForDaemonPairing,
  waitForNewWindow
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

    let paired: { ok: true; host: { id: string } } | { ok: false; error: string } | null = null
    const remote = await waitForNewWindow(harness, async () => {
      paired = await page.evaluate((payload) => window.vav.hosts.pair(payload), daemon.pairing)
    })
    expect(paired?.ok).toBe(true)
    if (!paired || !paired.ok) return

    await expect
      .poll(async () => {
        const hosts = await page.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)
      })
      .toMatchObject({ id: paired.host.id, online: true, name: 'E2E Daemon' })

    // Local window stays this computer. The daemon opens its own main shell.
    await expect(page.locator('[data-testid="sidebar-connect"]')).toHaveAttribute(
      'data-machine-id',
      'local'
    )
    await expect(
      page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toBeVisible()

    await expect(remote.locator('[data-testid="sidebar-connect"]')).toContainText('E2E Daemon')
    await expect(remote.locator('[data-testid="sidebar-connect"]')).toHaveAttribute(
      'data-machine-id',
      paired.host.id
    )
    await expect(
      remote.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toHaveCount(0)
    await expect(remote.locator('[data-testid="session-row"].selected')).toBeVisible()
    await expect
      .poll(async () =>
        remote.evaluate(async () => (await window.vav.bootstrap()).activeConversationId)
      )
      .not.toBe(E2E_SESSION_ID)
    await expect
      .poll(async () =>
        remote.evaluate(() => {
          const selected = document.querySelector('[data-testid="session-row"].selected')
          return selected?.getAttribute('data-conversation-id') ?? ''
        })
      )
      .not.toBe(E2E_SESSION_ID)

    await openFilesTray(remote)
    await expect(remote.locator('[data-file-path$="hello.md"]')).toHaveCount(0)

    await expect
      .poll(async () => {
        const snapshot = await remote.evaluate(async (machineId) => {
          const hosts = await window.vav.hosts.list()
          const host = hosts.find((h) => h.id === machineId)
          const conversations = await window.vav.conversations.list()
          const active = conversations.find(
            (c) => c.machineId === machineId && !c.archived && !c.fileId
          )
          return {
            home: host?.home ?? (await window.vav.hosts.home(machineId)),
            machineId: active?.machineId ?? null,
            workingDirectory: active?.workingDirectory ?? null
          }
        }, paired.host.id)
        return snapshot
      })
      .toMatchObject({ machineId: paired.host.id })

    const defaultSession = await remote.evaluate(async (machineId) => {
      const hosts = await window.vav.hosts.list()
      const host = hosts.find((h) => h.id === machineId)
      const conversations = await window.vav.conversations.list()
      const active = conversations.find((c) => c.machineId === machineId && !c.archived && !c.fileId)
      return {
        home: host?.home ?? (await window.vav.hosts.home(machineId)),
        machineId: active?.machineId ?? null,
        workingDirectory: active?.workingDirectory ?? null
      }
    }, paired.host.id)
    expect(defaultSession.workingDirectory).toBe(defaultSession.home)
    expect(defaultSession.workingDirectory).not.toBe(harness.workspace)

    const recents = await remote.evaluate(
      async () => (await window.vav.settings.get()).recentWorkspaceDirectories
    )
    const hostId = paired.host.id
    const remoteRecents = (Array.isArray(recents) ? recents : []).filter((entry) => {
      if (!entry || typeof entry !== 'object') return false
      return 'machineId' in entry && entry.machineId === hostId
    })
    expect(
      remoteRecents.every((entry) => typeof entry === 'object' && entry.path !== harness.workspace)
    ).toBe(true)

    const stored = JSON.parse(
      readFileSync(join(harness.userData, 'paired-hosts.json'), 'utf8')
    ) as { hosts: { machineId: string }[] }
    expect(stored.hosts[0]?.machineId).toBe(paired.host.id)

    const created = await remote.evaluate(
      async ({ path, machineId }) =>
        window.vav.conversations.create({ workingDirectory: path, machineId }),
      { path: daemon.workspace, machineId: paired.host.id }
    )
    expect(created.machineId).toBe(paired.host.id)
    expect(created.workingDirectory).toBe(daemon.workspace)

    const listing = await remote.evaluate(
      async ({ path, id }) => window.vav.files.list(path, 'name', true, id),
      { path: daemon.workspace, id: created.id }
    )
    expect(listing.error).toBeUndefined()
    expect(listing.entries.map((e) => e.name)).toContain('remote-only.md')

    const dirs = await remote.evaluate(
      async ({ machineId, path }) => window.vav.hosts.listDir(machineId, path),
      { machineId: paired.host.id, path: daemon.workspace }
    )
    expect(dirs.entries.map((e) => e.name)).toContain('remote-pkg')
    expect(dirs.entries.map((e) => e.name)).not.toContain('remote-only.md')

    await remote.locator(`[data-testid="session-row"][data-conversation-id="${created.id}"]`).click()
    await openFilesTray(remote)
    await expect(remote.locator('[data-file-path$="remote-only.md"]')).toBeVisible()
    await expect(remote.locator('[data-file-path$="hello.md"]')).toHaveCount(0)

    const text = await remote.evaluate(
      ({ path, id }) => window.vav.files.read(path, id),
      { path: join(daemon.workspace, 'remote-only.md'), id: created.id }
    )
    expect(text.error).toBeUndefined()
    expect(text.content).toContain('planted by vavd e2e')

    await page.evaluate((id) => window.vav.hosts.forget(id), paired.host.id)
    const after = await page.evaluate(() => window.vav.hosts.list())
    expect(after.some((h) => h.id === paired.host.id)).toBe(false)
    await expect(page.locator('[data-testid="sidebar-connect"]')).toHaveAttribute(
      'data-machine-id',
      'local'
    )
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
    await expect(row.locator('[data-testid^="settings-machine-providers-"]')).toBeVisible()
    await expect(row).toContainText('CLI agents on this machine')

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
    let paired: { ok: true; host: { id: string } } | { ok: false; error: string } | null = null
    const remote = await waitForNewWindow(harness, async () => {
      paired = await page.evaluate((payload) => window.vav.hosts.pair(payload), daemon.pairing)
    })
    expect(paired?.ok).toBe(true)
    if (!paired || !paired.ok) return

    await expect
      .poll(async () => {
        const hosts = await page.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)?.online ?? false
      })
      .toBe(true)

    await expect(remote.locator('[data-testid="sidebar-connect"]')).toContainText('E2E Daemon')
    await remote.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(remote, 'Choose another folder…')

    const picker = remote.locator('[data-testid="remote-folder-picker"]')
    await expect(picker).toBeVisible()
    await remote.locator('[data-testid="remote-folder-path"]').fill(daemon.workspace)
    await expect(remote.locator('[data-testid="remote-folder-entry-remote-pkg"]')).toBeVisible()
    await remote.locator('[data-testid="remote-folder-entry-remote-pkg"]').click()
    await remote.locator('[data-testid="remote-folder-select"]').click()

    const nested = join(daemon.workspace, 'remote-pkg')
    const activeId = await remote
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(activeId).toBeTruthy()
    await expect
      .poll(async () => {
        const conversation = await remote.evaluate(
          (id) => window.vav.conversations.get(id),
          activeId
        )
        return {
          machineId: conversation?.machineId ?? null,
          path: conversation?.workingDirectory ?? null
        }
      })
      .toEqual({ machineId: paired.host.id, path: nested })

    await openFilesTray(remote)
    await expect(remote.locator('[data-file-path$="inside.md"]')).toBeVisible()
    await expect(remote.locator('[data-file-path$="remote-only.md"]')).toHaveCount(0)
    await expect(remote.locator('[data-file-path$="hello.md"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
    daemon.stop()
  }
})

const HOST_SESSION_ID = 'e2e-host-session'
const HOST_SESSION_TITLE = 'Host desktop session'

/**
 * Pair two desktop VAV instances. The client remote window must show the
 * host's existing session and folder recents — not a blank chat minted here.
 */
test('pair another VAV, pull its sessions and folder recents', async () => {
  test.setTimeout(90_000)
  const host = await launchVav({
    remoteControlEnabled: true,
    extraWorkspace: true,
    sessionInExtraWorkspace: true,
    sessionId: HOST_SESSION_ID,
    sessionTitle: HOST_SESSION_TITLE,
    sessionMessage: 'note from the other computer',
    extraWorkspaceFiles: { 'host-only.md': 'planted on host desktop\n' },
    hostName: 'E2E Host Desktop',
    recentAlsoWorkspace: true
  })
  const client = await launchVav()
  try {
    const pairing = await waitForDaemonPairing(host.page)
    let paired: { ok: true; host: { id: string } } | { ok: false; error: string } | null = null
    const remote = await waitForNewWindow(client, async () => {
      paired = await client.page.evaluate((payload) => window.vav.hosts.pair(payload), pairing)
    })
    expect(paired?.ok).toBe(true)
    if (!paired || !paired.ok) return
    const hostId = paired.host.id

    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })
    await expect(remote.locator('[data-testid="sidebar-connect"]')).toContainText(
      'E2E Host Desktop'
    )
    await expect(
      remote.locator(`[data-testid="session-row"][data-conversation-id="${HOST_SESSION_ID}"]`)
    ).toBeVisible()
    await expect(remote.getByText(HOST_SESSION_TITLE).first()).toBeVisible()
    await expect(
      remote.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toHaveCount(0)

    const pulled = await remote.evaluate(async (sessionId) => {
      const conversation = await window.vav.conversations.get(sessionId)
      const recents = (await window.vav.settings.get()).recentWorkspaceDirectories
      return {
        title: conversation?.title ?? null,
        machineId: conversation?.machineId ?? null,
        workingDirectory: conversation?.workingDirectory ?? null,
        recents: Array.isArray(recents) ? recents : []
      }
    }, HOST_SESSION_ID)
    expect(pulled.title).toBe(HOST_SESSION_TITLE)
    expect(pulled.machineId).toBe(hostId)
    expect(pulled.workingDirectory).toBe(host.extraWorkspace)

    const hostRecents = pulled.recents.filter((entry): entry is { path: string; machineId: string } => {
      if (!entry || typeof entry !== 'object') return false
      return 'machineId' in entry && (entry as { machineId?: unknown }).machineId === hostId
    })
    expect(hostRecents.some((entry) => entry.path === host.extraWorkspace)).toBe(true)

    await remote
      .locator(`[data-testid="session-row"][data-conversation-id="${HOST_SESSION_ID}"]`)
      .click()
    await openFilesTray(remote)
    await expect(remote.locator('[data-file-path$="host-only.md"]')).toBeVisible()
    await expect(remote.locator('[data-file-path$="hello.md"]')).toHaveCount(0)

    expect(hostRecents.some((entry) => entry.path === host.workspace)).toBe(true)

    await remote.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(remote, extraWorkspaceLabel(host.workspace))
    await expect(remote.locator('[data-file-path$="hello.md"]')).toBeVisible()
    await expect(remote.locator('[data-file-path$="host-only.md"]')).toHaveCount(0)

    await remote.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(remote, extraWorkspaceLabel(host.extraWorkspace!))
    await expect(remote.locator('[data-file-path$="host-only.md"]')).toBeVisible()

    const created = await remote.evaluate(
      async ({ machineId, path }) =>
        window.vav.conversations.create({ workingDirectory: path, machineId }),
      { machineId: hostId, path: host.extraWorkspace }
    )
    expect(created.machineId).toBe(hostId)
    expect(created.workingDirectory).toBe(host.extraWorkspace)

    await remote.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(remote, 'A new temp folder')
    await expect
      .poll(async () => {
        const conversation = await remote.evaluate(
          (id) => window.vav.conversations.get(id),
          HOST_SESSION_ID
        )
        return conversation?.workingDirectory ?? ''
      })
      .not.toBe(host.extraWorkspace)
    const afterTemp = await remote.evaluate(async (sessionId) => {
      const conversation = await window.vav.conversations.get(sessionId)
      const hosts = await window.vav.hosts.list()
      const host = hosts.find((h) => h.id === conversation?.machineId)
      return {
        machineId: conversation?.machineId ?? null,
        workingDirectory: conversation?.workingDirectory ?? null,
        tmp: host?.tmp ?? ''
      }
    }, HOST_SESSION_ID)
    expect(afterTemp.machineId).toBe(hostId)
    expect(afterTemp.workingDirectory).toBeTruthy()
    expect(afterTemp.tmp).toBeTruthy()
    expect(afterTemp.workingDirectory?.startsWith(afterTemp.tmp)).toBe(true)
    await expect(remote.locator('[data-file-path$="host-only.md"]')).toHaveCount(0)

    await remote.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(remote, 'Choose another folder…')
    const picker = remote.locator('[data-testid="remote-folder-picker"]')
    await expect(picker).toBeVisible()
    await remote.locator('[data-testid="remote-folder-path"]').fill(host.extraWorkspace!)
    await remote.locator('[data-testid="remote-folder-select"]').click()
    await expect(remote.locator('[data-file-path$="host-only.md"]')).toBeVisible()

    await remote.evaluate((path) => window.vav.conversations.revealInFinder(path), host.extraWorkspace)

    await expect(
      client.page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toBeVisible()
    await expect(
      client.page.locator(`[data-testid="session-row"][data-conversation-id="${HOST_SESSION_ID}"]`)
    ).toHaveCount(0)
  } finally {
    await client.dispose()
    await host.dispose()
  }
})
