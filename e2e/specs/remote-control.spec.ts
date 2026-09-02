import { test, expect } from '@playwright/test'
import { createConnection } from 'node:net'
import { encodeLine, parseServerMessage } from '../../src/shared/remoteControl.ts'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import {
  E2E_SESSION_ID,
  launchVav,
  seedApiKey,
  waitForDaemonPairing,
  waitForNewWindow
} from '../launch'

const HOST_SESSION_ID = 'e2e-host-session'
const HOST_SESSION_TITLE = 'Host desktop session'

/**
 * Desktop-to-desktop chat must run on the host (controlled UI), not as a
 * copied transcript + local agent on the controller.
 */
test('remote desktop send drives the controlled host transcript', async () => {
  test.setTimeout(90_000)
  const host = await launchVav({
    remoteControlEnabled: true,
    stubTurn: true,
    extraWorkspace: true,
    sessionInExtraWorkspace: true,
    sessionId: HOST_SESSION_ID,
    sessionTitle: HOST_SESSION_TITLE,
    sessionMessage: 'note from the other computer',
    hostName: 'E2E Host Desktop'
  })
  const client = await launchVav()
  try {
    await seedApiKey(host.page)
    const pairing = await waitForDaemonPairing(host.page)
    let paired: { ok: true; host: { id: string } } | { ok: false; error: string } | null = null
    const remote = await waitForNewWindow(client, async () => {
      paired = await client.page.evaluate((payload) => window.vav.hosts.pair(payload), pairing)
    })
    expect(paired?.ok).toBe(true)
    if (!paired || !paired.ok) return

    await remote.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })
    await expect(
      remote.locator(`[data-testid="session-row"][data-conversation-id="${HOST_SESSION_ID}"]`)
    ).toBeVisible()

    await expect
      .poll(async () => {
        const hosts = await remote.evaluate(() => window.vav.hosts.list())
        return hosts.find((h) => h.id === paired.host.id)?.controlPlane === true
      })
      .toBe(true)

    await remote
      .locator(`[data-testid="session-row"][data-conversation-id="${HOST_SESSION_ID}"]`)
      .click()
    await expect(remote.locator('[data-testid="empty-open-settings"]')).toHaveCount(0)
    await remote.locator('[data-testid="composer-input"]').fill('ping from controller')
    await remote.locator('[data-testid="composer-send"]').click()

    await host.page
      .locator(`[data-testid="session-row"][data-conversation-id="${HOST_SESSION_ID}"]`)
      .click()
    await expect(host.page.locator('[data-testid="message-user"]').last()).toContainText(
      'ping from controller'
    )
    await expect(host.page.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e stub reply'
    )

    await expect
      .poll(async () =>
        remote.evaluate(async (id) => {
          const conversation = await window.vav.conversations.get(id)
          return conversation?.messages?.some(
            (message: { role?: string; content?: string }) =>
              message.role === 'user' && String(message.content ?? '').includes('ping from controller')
          )
        }, HOST_SESSION_ID)
      )
      .toBe(true)

    await host.page.screenshot({ path: 'test-results/e2e/remote-host-transcript.png' })
    await remote.screenshot({ path: 'test-results/e2e/remote-controller-window.png' })
  } finally {
    await client.dispose()
    await host.dispose()
  }
})

/**
 * Phone control plane over the same LAN port: send must land on the host UI.
 */
test('phone-role hello on the daemon port drives the host transcript', async () => {
  test.setTimeout(90_000)
  const host = await launchVav({
    remoteControlEnabled: true,
    stubTurn: true,
    sessionId: E2E_SESSION_ID,
    sessionTitle: 'E2E session',
    hostName: 'E2E Phone Host'
  })
  try {
    await seedApiKey(host.page)
    const pairing = await waitForDaemonPairing(host.page)
    const parsed = parseDaemonPairing(pairing)
    expect(parsed).toBeTruthy()
    const port = parsed?.port ?? 0
    const secret = parsed?.secret ?? ''
    expect(port).toBeGreaterThan(0)
    expect(secret.length).toBeGreaterThan(10)

    const phone = createConnection({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      phone.once('connect', resolve)
      phone.once('error', reject)
    })
    phone.write(
      encodeLine({
        type: 'hello',
        proto: 1,
        auth: secret,
        device: 'E2E Phone',
        role: 'phone'
      })
    )
    await new Promise<void>((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('phone welcome timed out')), 5_000)
      phone.setEncoding('utf8')
      phone.on('data', (chunk: string) => {
        buf += chunk
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue
          try {
            const frame = parseServerMessage(JSON.parse(line) as unknown)
            if (frame?.type === 'welcome') {
              clearTimeout(timer)
              resolve()
            }
          } catch {
            /* partial */
          }
        }
      })
      phone.on('error', reject)
    })
    phone.write(
      encodeLine({
        type: 'configure',
        conversationId: E2E_SESSION_ID,
        approvalMode: 'bypass'
      })
    )
    await expect
      .poll(async () =>
        host.page.evaluate(async (id) => {
          const conversation = await window.vav.conversations.get(id)
          return conversation?.approvalMode ?? null
        }, E2E_SESSION_ID)
      )
      .toBe('bypass')

    phone.write(encodeLine({ type: 'send', conversationId: E2E_SESSION_ID, text: 'ping from phone' }))

    await host.page
      .locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
      .click()
    await expect(host.page.locator('[data-testid="message-user"]').last()).toContainText(
      'ping from phone'
    )
    await expect(host.page.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e stub reply'
    )
    phone.destroy()
  } finally {
    await host.dispose()
  }
})
