import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { chromium } from '@playwright/test'
import { spawnLocalVavServer } from './vavServerSpawn.ts'
import { DaemonClient } from './DaemonClient.ts'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import { assertDesktopSessionLayout, readPhoneSessionLayout } from './phoneSessionLayout.ts'

function chromePath(): string | undefined {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  try {
    const bundled = chromium.executablePath()
    if (existsSync(bundled)) return bundled
  } catch {
    // Playwright Chromium is optional on a developer machine.
  }
  if (process.env.CI) return undefined
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : process.platform === 'win32'
        ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  return candidates.find((path) => existsSync(path))
}

/**
 * Loopback web UI (same React `App` as desktop / Chrome side panel).
 * Proves Chrome ≈ desktop: docked composer, tools tray, a stub turn.
 */
describe('vav-server web UI', () => {
  const exe = chromePath()
  const prevE2e = process.env.VAV_E2E
  const prevStub = process.env.VAV_E2E_STUB_TURN

  before(() => {
    process.env.VAV_E2E = '1'
    process.env.VAV_E2E_STUB_TURN = '1'
  })

  after(() => {
    if (prevE2e === undefined) delete process.env.VAV_E2E
    else process.env.VAV_E2E = prevE2e
    if (prevStub === undefined) delete process.env.VAV_E2E_STUB_TURN
    else process.env.VAV_E2E_STUB_TURN = prevStub
  })

  it('auto-pairs, mounts the desktop session shell, and completes a stub turn', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const prevKey = process.env.VAV_API_KEY
    process.env.VAV_API_KEY = 'sk-test-web-ui'
    const spawned = await spawnLocalVavServer({
      name: 'Web UI Host',
      stubTurn: true,
      noWeb: false,
      webListen: '127.0.0.1'
    })
    const origin = spawned.webOrigin
    if (!origin) {
      spawned.stop()
      throw new Error('vav-server did not print a web origin')
    }

    const probe = await fetch(origin)
    const html = await probe.text()
    if (!probe.ok || !html.includes('phone.js')) {
      spawned.stop()
      t.skip('phone-ui bundle missing — run npm run build:phone-ui')
      return
    }
    const script = await fetch(new URL('/phone.js', origin))
    if (!script.ok) {
      spawned.stop()
      t.skip('phone-ui bundle missing — run npm run build:phone-ui')
      return
    }

    const browser = await chromium.launch({
      executablePath: exe,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
      await page.goto(origin, { waitUntil: 'domcontentloaded' })
      await page.locator('#status').getByText(/Connected/).waitFor({ timeout: 15_000 })
      await page.locator('[data-testid="app-shell"]').waitFor({ timeout: 12_000 })
      await page.locator('[data-testid="composer"]').waitFor({ timeout: 8_000 })
      assertDesktopSessionLayout(await page.evaluate(readPhoneSessionLayout), 280)

      await page.locator('#sendForm').evaluate((el) => {
        ;(el as HTMLElement).style.display = 'none'
      })
      await page.getByPlaceholder(/Message/).fill('hello from vav-server web UI')
      await page.getByTestId('composer-send').click()
      await page.getByText('e2e stub reply').waitFor({ timeout: 12_000 })
      assertDesktopSessionLayout(await page.evaluate(readPhoneSessionLayout), 280)

      await page.locator('[data-testid="workdir-chip"]').click()
      await page.locator('[data-testid="files-panel"]').waitFor({ timeout: 8_000 })
      await page.locator('.files-toolbar-tabs').getByText('Git', { exact: true }).click()
      await page.locator('[data-testid="git-panel"]').waitFor({ timeout: 8_000 })
      await page.locator('.files-toolbar-tabs').getByText(/Plugins|插件/).click()
      await page.locator('[data-testid="plugins-tray"]').waitFor({ timeout: 8_000 })
      await page.locator('.files-toolbar-tabs').getByText(/Files|文件/).click()
      await page.locator('[data-testid="files-panel"]').waitFor({ timeout: 8_000 })
      await page.locator('[data-testid="files-new-file"]').click()
      const createName = page.locator('[data-testid="files-create-name"]')
      await createName.waitFor({ timeout: 8_000 })
      await createName.fill('web-note.md')
      await createName.press('Enter')
      await page.locator('[data-file-path$="web-note.md"]').waitFor({ timeout: 8_000 })
      await page.locator('[data-testid="new-session"]').click()
      await page.locator('[data-testid="session-row"]').nth(1).waitFor({ timeout: 8_000 })

      await page.evaluate(() => window.vav.window.openSettings('agents'))
      await page.locator('[data-testid="phone-settings"]').waitFor({ timeout: 8_000 })
      await page.locator('[data-testid="settings-window"]').waitFor({ timeout: 8_000 })
      await page.locator('[data-testid="providers-list"]').waitFor({ timeout: 8_000 })
      const catalog = await page.evaluate(async () => {
        const { id } = await window.vav.accounts.createDraft({ agentId: 'vav', kind: 'vav_key' })
        const listed = await window.vav.accounts.getPage()
        await window.vav.accounts.remove(id)
        return {
          id,
          listed: Array.isArray(listed.accounts) && listed.accounts.some((row) => row.id === id)
        }
      })
      assert.ok(catalog.id)
      assert.equal(catalog.listed, true)
      const oauth = await page.evaluate(async () => {
        try {
          await window.vav.accounts.beginOAuth('vav')
          return { ok: true, error: '' }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      })
      assert.equal(oauth.ok, false)
      assert.match(oauth.error, /找不到这个账户|That account is gone/)

      await page.evaluate(() => window.vav.window.openSettings('connect'))
      await page.locator('[data-testid="connect-pairing-line"]').waitFor({ timeout: 8_000 })
      await page.locator('[data-testid="settings-rotate-offer"]').waitFor({ timeout: 8_000 })
      const pairingLine = await page.locator('[data-testid="connect-pairing-line"]').innerText()
      assert.match(pairingLine, /vavrtp:\/\//)
      const incoming = await page.evaluate(() => window.vav.hosts.incoming())
      assert.ok(incoming.length >= 1)
      const rotated = await page.evaluate(async () => {
        const before = await window.vav.hosts.pairing()
        await window.vav.hosts.rotateOffer()
        const after = await window.vav.hosts.pairing()
        return { before, after }
      })
      assert.match(rotated.before ?? '', /vavrtp:\/\//)
      assert.match(rotated.after ?? '', /vavrtp:\/\//)
      assert.notEqual(rotated.after, rotated.before)
      const paired = await page.evaluate(async (uri) => window.vav.hosts.pair(uri), rotated.after ?? '')
      assert.equal(paired.ok, true)

      await page.evaluate(() => window.vav.window.openSettings('appearance'))
      await page.locator('[data-testid="settings-reduce-motion"]').waitFor({ timeout: 8_000 })
      const fonts = await page.evaluate(() => window.vav.settings.availableFonts())
      assert.ok(
        fonts.some((font) => font === 'SF Mono' || font === 'Courier New' || font === 'JetBrains Mono'),
        `appearance fonts missing desktop candidates: ${fonts.join(',')}`
      )

      await page.evaluate(() => window.vav.window.closeSettings())
      await page.locator('[data-testid="session-row"]').first().click()
      await page.locator('[data-testid="new-bash"]').click()
      await page.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]').waitFor({
        timeout: 12_000
      })
      const sessionId = await page
        .locator('[data-testid="session-row"].selected')
        .getAttribute('data-conversation-id')
      assert.ok(sessionId)
      await page.waitForFunction(
        async (id) => {
          const listed = await window.vav.pty.list(id)
          return listed.sessions.length > 0
        },
        sessionId,
        { timeout: 12_000 }
      )
    } finally {
      if (prevKey === undefined) delete process.env.VAV_API_KEY
      else process.env.VAV_API_KEY = prevKey
      try {
        await browser.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      spawned.stop()
    }
  })

  it('paints the same inline change-review card desktop Accepts', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const spawned = await spawnLocalVavServer({
      name: 'Web UI Review',
      stubTurn: true,
      noWeb: false,
      webListen: '127.0.0.1'
    })
    const origin = spawned.webOrigin
    const parsed = parseDaemonPairing(spawned.pairing)
    if (!origin || !parsed) {
      spawned.stop()
      throw new Error('vav-server did not print a web origin / pairing')
    }

    const probe = await fetch(origin)
    if (!probe.ok || !(await probe.text()).includes('phone.js')) {
      spawned.stop()
      t.skip('phone-ui bundle missing — run npm run build:phone-ui')
      return
    }

    const browser = await chromium.launch({
      executablePath: exe,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })
    const client = new DaemonClient()
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
      await page.goto(origin, { waitUntil: 'domcontentloaded' })
      await page.locator('#status').getByText(/Connected/).waitFor({ timeout: 15_000 })
      await page.locator('[data-testid="app-shell"]').waitFor({ timeout: 12_000 })
      await page.locator('[data-testid="composer"]').waitFor({ timeout: 8_000 })
      await page.locator('#sendForm').evaluate((el) => {
        ;(el as HTMLElement).style.display = 'none'
      })
      if ((await page.locator('[data-testid="session-row"]').count()) === 0) {
        await page.locator('[data-testid="new-session"]').click()
      }
      const row = page.locator('[data-testid="session-row"]').first()
      await row.waitFor({ timeout: 12_000 })
      await row.click()
      const sessionId = await row.getAttribute('data-conversation-id')
      assert.ok(sessionId)
      await client.connect({
        host: '127.0.0.1',
        port: parsed.port,
        secret: parsed.secret,
        device: 'web-review'
      })
      const seeded = (await client.request('changeSets.seedReview', {
        conversationId: sessionId
      })) as { set?: { id?: string; files?: unknown[] } }
      assert.ok(seeded.set?.id)
      await page.locator('[data-testid="inline-review"]').waitFor({ timeout: 12_000 })
      assert.equal(await page.locator('[data-testid="inline-review-file"]').count(), 2)
      await page.locator('[data-testid="inline-review-accept-all"]').click()
      await page.locator('[data-testid="inline-review"].is-resolved').waitFor({ timeout: 8_000 })
    } finally {
      client.close()
      try {
        await browser.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      spawned.stop()
    }
  })
})
