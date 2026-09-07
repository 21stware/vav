import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import { assertDesktopSessionLayout, readPhoneSessionLayout } from '../../src/main/daemon/phoneSessionLayout.ts'
import { parseDaemonPairing } from '../../src/shared/daemonProtocol.ts'
import {
  assertChromeWanPairRejected,
  assertDesktopSettingsOverlay,
  assertFilePreview,
  assertFilesRenameAndTrash,
  assertGitAndPluginsTray,
  assertHostRotateOffer,
  assertNewSessionRow,
  assertSessionListActions,
  createFilesTrayFile,
  chromePath,
  ensurePhoneUiBundle,
  seedChangeReview,
  usesPlaywrightChromium
} from '../chromeUi'
import { startVavd } from '../startVavd'

const EXT = join(__dirname, '../../packages/vav-chrome-extension/extension')

async function openSidePanel(context: BrowserContext): Promise<import('@playwright/test').Page> {
  const page = context.pages()[0] ?? (await context.newPage())
  const cdp = await context.newCDPSession(page)
  const started = Date.now()
  let extensionId = ''
  while (Date.now() - started < 15_000) {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: Array<{ url?: string }>
    }
    const target = targetInfos.find((row) => String(row.url ?? '').startsWith('chrome-extension://'))
    if (target?.url) {
      extensionId = new URL(target.url).host
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!extensionId) {
    throw new Error('Chromium did not register the unpacked MV3 extension')
  }
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  return panel
}

/**
 * Real Chrome extension origin — same React App as desktop / loopback web.
 * Required: pair via loopback /discover, paint the desktop Settings overlay,
 * send a stub turn, create a file, open Git / Plugins, and open New bash
 * on the daemon PTY plane.
 */
test('Chrome side panel matches the desktop session shell', async () => {
  test.setTimeout(180_000)
  await ensurePhoneUiBundle()
  const exe = chromePath()
  const daemon = await startVavd({
    stubTurn: true,
    web: true,
    extraEnv: { VAV_API_KEY: 'sk-e2e-chrome-ext' }
  })
  const origin = daemon.webOrigin
  if (!origin) {
    daemon.stop()
    throw new Error('vavd did not print a web origin')
  }
  const webPort = Number(new URL(origin).port)
  const parsed = parseDaemonPairing(daemon.pairing)
  const profile = mkdtempSync(join(tmpdir(), 'vav-ext-e2e-'))
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: exe,
    headless: usesPlaywrightChromium(exe),
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  })
  try {
    const panel = await openSidePanel(context)
    await panel.evaluate(
      async ({ port, secret }) => {
        await chrome.storage.local.set({
          vavDiscoverHint: { ports: [port], hosts: ['127.0.0.1'], secret }
        })
        await chrome.runtime.sendMessage({ type: 'rediscover' })
      },
      { port: webPort, secret: parsed?.secret }
    )
    await panel.locator('#status').getByText(/Connected/).waitFor({ timeout: 20_000 })
    await panel.locator('[data-testid="app-shell"]').waitFor({ timeout: 12_000 })
    await panel.locator('[data-testid="composer"]').waitFor({ timeout: 8_000 })
    await panel.waitForFunction(
      async () => {
        const settings = await window.vav.settings.get()
        return settings.apiKeyPresent === true
      },
      null,
      { timeout: 12_000 }
    )
    assertDesktopSessionLayout(await panel.evaluate(readPhoneSessionLayout), 280)
    await assertDesktopSettingsOverlay(panel)
    await assertChromeWanPairRejected(panel)

    await panel.locator('#sendForm').evaluate((el) => {
      ;(el as HTMLElement).style.display = 'none'
    })
    await panel.getByPlaceholder(/Message/).fill('hello from chrome extension')
    await panel.getByTestId('composer-send').click()
    await panel.locator('[data-testid="session-row"]').first().click()
    await expect(panel.getByText('e2e stub reply')).toBeVisible({ timeout: 12_000 })

    const reviewSessionId = await panel
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(reviewSessionId).toBeTruthy()
    await seedChangeReview(daemon.pairing, reviewSessionId!)
    await panel.locator('[data-testid="inline-review"]').waitFor({ timeout: 12_000 })
    await expect(panel.locator('[data-testid="inline-review-file"]')).toHaveCount(2)
    await expect(panel.locator('[data-testid="inline-review-file"][data-name$="existing.ts"]')).toBeVisible()
    await panel.locator('[data-testid="inline-review-accept-all"]').click()
    await expect(panel.locator('[data-testid="inline-review"]')).toHaveClass(/is-resolved/)

    await createFilesTrayFile(panel, 'ext-note.md')
    await assertFilePreview(panel, 'ext-note.md')
    await createFilesTrayFile(panel, 'ext-io.md')
    await assertFilesRenameAndTrash(panel, 'ext-io.md')
    await assertGitAndPluginsTray(panel, daemon.pairing, reviewSessionId!)
    await assertSessionListActions(panel, reviewSessionId!)

    await panel.locator('[data-testid="session-row"]').first().click()
    await panel.locator('[data-testid="new-bash"]').click()
    const term = panel.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]')
    await term.waitFor({ timeout: 12_000 })
    await expect(term).toHaveAttribute('data-empty', 'false', { timeout: 12_000 })
    const sessionId = await panel
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(sessionId).toBeTruthy()
    await panel.waitForFunction(
      async (id) => {
        const listed = await window.vav.pty.list(id)
        return listed.sessions.length > 0
      },
      sessionId,
      { timeout: 12_000 }
    )
    const echoed = await panel.evaluate(async (id) => {
      const listed = await window.vav.pty.list(id)
      const tabId = listed.sessions[0]?.id
      if (!tabId) throw new Error('no pty tab')
      return await new Promise<string>((resolve, reject) => {
        let buf = ''
        const timer = setTimeout(() => reject(new Error(`no pty echo; saw ${JSON.stringify(buf)}`)), 12_000)
        const off = window.vav.pty.onData((event) => {
          if (event.tabId !== tabId) return
          buf += event.data
          if (buf.includes('vav-phone-term')) {
            clearTimeout(timer)
            off()
            resolve(buf)
          }
        })
        window.vav.pty.write(tabId, 'echo vav-phone-term\r')
      })
    }, sessionId)
    expect(echoed).toContain('vav-phone-term')
    await expect(panel.locator('.xterm-host, .xterm').first()).toBeVisible({ timeout: 8_000 })
    await assertNewSessionRow(panel)
    await assertHostRotateOffer(panel)
  } finally {
    try {
      await context.close()
    } catch {
      // Chromium can throw EIO when its stdio is already gone.
    }
    rmSync(profile, { recursive: true, force: true })
    daemon.stop()
  }
})
