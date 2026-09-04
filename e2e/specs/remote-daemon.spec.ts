import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { connectPhone } from '../../src/main/cli/vavPhoneClient.ts'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import {
  chooseNativeMenu,
  E2E_SESSION_ID,
  extraWorkspaceLabel,
  launchVav,
  openFilesTray,
  openSettingsWindow,
  waitForDaemonPairing,
  waitForHostWindow,
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
      .toMatchObject({
        id: paired.host.id,
        online: true,
        name: 'E2E Daemon',
        controlPlane: true
      })

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
    // First session on a VAV host is a minted temp Workspace, not $HOME.
    expect(defaultSession.workingDirectory).toMatch(/[/\\]vav[/\\][a-f0-9]+[/\\]Workspace$/)
    expect(defaultSession.workingDirectory).not.toBe(harness.workspace)
    expect(defaultSession.home).toBeTruthy()

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

/**
 * Desktop Connect is a shell. Electron is launched without VAV_E2E_STUB_TURN
 * so a local agent cannot mint "e2e stub reply" — the turn must run in vavd.
 */
test('desktop Connect send streams a vavd stub turn, not an Electron one', async () => {
  test.setTimeout(90_000)
  const daemon = await startVavd({ stubStream: true })
  const harness = await launchVav()
  try {
    const { page } = harness
    let paired: { ok: true; host: { id: string } } | { ok: false; error: string } | null = null
    const remote = await waitForNewWindow(harness, async () => {
      paired = await page.evaluate((payload) => window.vav.hosts.pair(payload), daemon.pairing)
    })
    expect(paired?.ok).toBe(true)
    if (!paired || !paired.ok) return

    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })
    await expect(remote.locator('[data-testid="sidebar-connect"]')).toContainText('E2E Daemon')
    await expect
      .poll(async () => {
        const hosts = await remote.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)?.controlPlane === true
      })
      .toBe(true)

    await expect(remote.locator('[data-testid="session-row"].selected')).toBeVisible()
    await expect(remote.locator('[data-testid="empty-open-settings"]')).toHaveCount(0)
    await expect(remote.locator('[data-testid="composer-input"]')).toBeVisible({ timeout: 20_000 })

    const sessionId = await remote
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(sessionId).toBeTruthy()

    await remote.evaluate(
      (id) => window.vav.conversations.setApprovalMode(id, 'bypass'),
      sessionId
    )
    await expect
      .poll(async () => {
        const conversation = await remote.evaluate((id) => window.vav.conversations.get(id), sessionId)
        return conversation?.approvalMode ?? null
      })
      .toBe('bypass')

    await remote.locator('[data-testid="composer-input"]').fill('ping from desktop connect')
    await remote.locator('[data-testid="composer-send"]').click()

    await expect(remote.locator('[data-testid="message-user"]').last()).toContainText(
      'ping from desktop connect'
    )
    await expect(remote.locator('[data-testid="tool-card"][data-tool="fs_read"]')).toBeVisible({
      timeout: 15_000
    })
    await expect(remote.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e stub reply'
    )
    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)
    await expect
      .poll(async () =>
        remote.evaluate(async (id) => {
          const status = await window.vav.agent.status(id)
          return status?.isRunning === false
        }, sessionId)
      )
      .toBe(true)

    await remote.screenshot({ path: 'test-results/e2e/vavd-desktop-connect-turn.png' })
  } finally {
    await harness.dispose()
    daemon.stop()
  }
})

/**
 * Desktop app launched with VAVD_URI is a vavd UI — no Connect paste.
 * Electron is launched without VAV_E2E_STUB_TURN so the reply must come
 * from the daemon, not an in-process agent.
 */
test('desktop launches as a vavd client via VAVD_URI', async () => {
  test.setTimeout(90_000)
  const daemon = await startVavd({ stubStream: true })
  const harness = await launchVav({ vavdUri: daemon.pairing })
  try {
    const { page } = harness
    const remote = await waitForHostWindow(harness, 'E2E Daemon')
    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })
    await expect(remote.locator('[data-testid="sidebar-connect"]')).toHaveAttribute(
      'data-machine-id',
      /^(?!local$).+/
    )
    await expect
      .poll(async () => {
        const hosts = await remote.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.name === 'E2E Daemon')?.controlPlane === true
      })
      .toBe(true)

    await expect(remote.locator('[data-testid="session-row"].selected')).toBeVisible()
    await expect(remote.locator('[data-testid="empty-open-settings"]')).toHaveCount(0)
    await expect(remote.locator('[data-testid="composer-input"]')).toBeVisible({ timeout: 20_000 })

    const sessionId = await remote
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(sessionId).toBeTruthy()

    await remote.evaluate(
      (id) => window.vav.conversations.setApprovalMode(id, 'bypass'),
      sessionId
    )
    await remote.evaluate(
      (id) => window.vav.conversations.setModel(id, 'e2e-desktop-model'),
      sessionId
    )
    await expect
      .poll(async () => {
        const conversation = await remote.evaluate((id) => window.vav.conversations.get(id), sessionId)
        return {
          approval: conversation?.approvalMode ?? null,
          model: conversation?.model ?? null
        }
      })
      .toEqual({ approval: 'bypass', model: 'e2e-desktop-model' })

    await remote.locator('[data-testid="composer-input"]').fill('ping from auto-paired desktop')
    await remote.locator('[data-testid="composer-send"]').click()

    await expect(remote.locator('[data-testid="message-user"]').last()).toContainText(
      'ping from auto-paired desktop'
    )
    await expect(remote.locator('[data-testid="tool-card"][data-tool="fs_read"]')).toBeVisible({
      timeout: 15_000
    })
    await expect(remote.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e stub reply'
    )
    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)

    await remote.screenshot({ path: 'test-results/e2e/vavd-desktop-autopair-turn.png' })
  } finally {
    await harness.dispose()
    daemon.stop()
  }
})

/**
 * Desktop `--with-vavd` / `VAVD_SPAWN` starts the daemon itself.
 * Electron has no stub turn; the reply must come from the child vavd.
 */
test('desktop spawns vavd and sends through the child process', async () => {
  test.setTimeout(90_000)
  const harness = await launchVav({ spawnVavd: true })
  try {
    const { page } = harness
    const remote = await waitForHostWindow(harness, 'E2E Daemon', 40_000)
    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })
    await expect
      .poll(async () => {
        const hosts = await remote.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.name === 'E2E Daemon')?.controlPlane === true
      })
      .toBe(true)

    await expect(remote.locator('[data-testid="composer-input"]')).toBeVisible({ timeout: 20_000 })
    const sessionId = await remote
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(sessionId).toBeTruthy()

    await remote.evaluate(
      (id) => window.vav.conversations.setApprovalMode(id, 'bypass'),
      sessionId
    )
    await remote.locator('[data-testid="composer-input"]').fill('ping from spawned vavd')
    await remote.locator('[data-testid="composer-send"]').click()

    await expect(remote.locator('[data-testid="tool-card"][data-tool="fs_read"]')).toBeVisible({
      timeout: 20_000
    })
    await expect(remote.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e stub reply'
    )
    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)

    await remote.screenshot({ path: 'test-results/e2e/vavd-desktop-spawn-turn.png' })
  } finally {
    await harness.dispose()
  }
})

/**
 * Connect's pairing line on a spawned-vavd desktop is the child daemon.
 * A phone-protocol client that pastes that URI must turn on vavd, not Electron.
 */
test('spawned desktop advertises vavd pairing for an incoming phone client', async () => {
  test.setTimeout(90_000)
  const harness = await launchVav({ spawnVavd: true })
  try {
    const { page } = harness
    const remote = await waitForHostWindow(harness, 'E2E Daemon', 40_000)
    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })

    const pairing = await waitForDaemonPairing(page)
    const parsed = parseDaemonPairing(pairing)
    expect(parsed?.secret).toBeTruthy()
    expect(parsed?.port).toBeGreaterThan(0)
    expect(parsed?.name).toBe('E2E Daemon')

    const phone = await connectPhone({
      host: '127.0.0.1',
      port: parsed!.port!,
      secret: parsed!.secret,
      device: 'E2E Incoming Phone',
      omitRole: true
    })
    try {
      phone.send({ type: 'create' })
      const createdFrames = await phone.waitNew((msg) => msg.type === 'created')
      const created = createdFrames.findLast((msg) => msg.type === 'created')
      expect(created?.type).toBe('created')
      if (!created || created.type !== 'created') return
      const conversationId = created.session.id
      phone.send({
        type: 'configure',
        conversationId,
        model: 'e2e-incoming-model',
        approvalMode: 'bypass'
      })
      const controls = await phone.waitNew((msg) => msg.type === 'controls')
      const row = controls.findLast((msg) => msg.type === 'controls')
      expect(row && row.type === 'controls' ? row.model : null).toBe('e2e-incoming-model')
      phone.send({ type: 'send', conversationId, text: 'ping from advertised pairing' })
      const turns = await phone.waitNew(
        (msg) => msg.type === 'turn' && (msg.phase === 'done' || msg.phase === 'error')
      )
      expect(turns.some((msg) => msg.type === 'turn' && msg.phase === 'done')).toBe(true)
    } finally {
      phone.close()
    }

    await expect(page.locator('[data-testid="message-assistant"]')).toHaveCount(0)
    await remote.screenshot({ path: 'test-results/e2e/vavd-advertised-pairing-phone.png' })
  } finally {
    await harness.dispose()
  }
})

/**
 * Approve a write on the remote window; the file must land on the vavd disk.
 */
test('desktop Connect approve writes a file on the vavd disk', async () => {
  test.setTimeout(90_000)
  const daemon = await startVavd({ stubApprove: true })
  const harness = await launchVav()
  try {
    const { page } = harness
    let paired: { ok: true; host: { id: string } } | { ok: false; error: string } | null = null
    const remote = await waitForNewWindow(harness, async () => {
      paired = await page.evaluate((payload) => window.vav.hosts.pair(payload), daemon.pairing)
    })
    expect(paired?.ok).toBe(true)
    if (!paired || !paired.ok) return

    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })
    await expect
      .poll(async () => {
        const hosts = await remote.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)?.controlPlane === true
      })
      .toBe(true)

    const created = await remote.evaluate(
      async ({ path, machineId }) =>
        window.vav.conversations.create({ workingDirectory: path, machineId }),
      { path: daemon.workspace, machineId: paired.host.id }
    )
    expect(created.machineId).toBe(paired.host.id)
    await remote.locator(`[data-testid="session-row"][data-conversation-id="${created.id}"]`).click()
    await expect(remote.locator('[data-testid="empty-open-settings"]')).toHaveCount(0)
    await remote.locator('[data-testid="composer-input"]').fill('patch hello')
    await remote.locator('[data-testid="composer-send"]').click()

    const approve = remote.getByRole('button', { name: 'Approve' }).last()
    await expect(approve).toBeVisible({ timeout: 15_000 })
    await approve.click()

    await expect(remote.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e stub reply · approved'
    )
    await expect
      .poll(() => readFileSync(join(daemon.workspace, 'hello.md'), 'utf8'))
      .toBe('patched\n')
    expect(harness.workspace).not.toBe(daemon.workspace)
    expect(readFileSync(join(harness.workspace, 'hello.md'), 'utf8')).toContain('hello from e2e')
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
