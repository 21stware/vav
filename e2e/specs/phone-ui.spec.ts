import { test, expect, chromium } from '@playwright/test'
import { assertDesktopSessionLayout, readPhoneSessionLayout } from '../../src/main/daemon/phoneSessionLayout.ts'
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
  seedChangeReview
} from '../chromeUi'
import { startVavd } from '../startVavd'

/**
 * Loopback web UI — same React App as desktop / Chrome side panel.
 * Required (not skippable): build the bundle (must include xterm-helper-textarea),
 * open Chrome, paint the desktop Settings overlay, send a stub turn, create a
 * file, open Git / Plugins, and open New bash on the daemon PTY plane.
 */
test('vavd web UI matches the desktop session shell', async () => {
  test.setTimeout(180_000)
  await ensurePhoneUiBundle()
  const exe = chromePath()
  const daemon = await startVavd({
    stubTurn: true,
    web: true,
    extraEnv: { VAV_API_KEY: 'sk-e2e-phone-ui' }
  })
  const origin = daemon.webOrigin
  if (!origin) {
    daemon.stop()
    throw new Error('vavd did not print a web origin')
  }

  const probe = await fetch(origin)
  const html = await probe.text()
  expect(probe.ok).toBe(true)
  expect(html).toContain('phone.js')
  const script = await fetch(new URL('/phone.js', origin))
  expect(script.ok).toBe(true)

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
    await assertDesktopSettingsOverlay(page)
    await assertChromeWanPairRejected(page)

    await page.locator('#sendForm').evaluate((el) => {
      ;(el as HTMLElement).style.display = 'none'
    })
    await page.getByPlaceholder(/Message/).fill('hello from phone-ui e2e')
    await page.getByTestId('composer-send').click()
    await expect(page.getByText('e2e stub reply')).toBeVisible({ timeout: 12_000 })
    assertDesktopSessionLayout(await page.evaluate(readPhoneSessionLayout), 280)

    const reviewSessionId = await page
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(reviewSessionId).toBeTruthy()
    await seedChangeReview(daemon.pairing, reviewSessionId!)
    await page.locator('[data-testid="inline-review"]').waitFor({ timeout: 12_000 })
    await expect(page.locator('[data-testid="inline-review-file"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="inline-review-file"][data-name$="existing.ts"]')).toBeVisible()
    await page.locator('[data-testid="inline-review-accept-all"]').click()
    await expect(page.locator('[data-testid="inline-review"]')).toHaveClass(/is-resolved/)

    await createFilesTrayFile(page, 'phone-ui-note.md')
    await assertFilePreview(page, 'phone-ui-note.md')
    await createFilesTrayFile(page, 'phone-ui-io.md')
    await assertFilesRenameAndTrash(page, 'phone-ui-io.md')
    await assertGitAndPluginsTray(page, daemon.pairing, reviewSessionId!)
    await assertSessionListActions(page, reviewSessionId!)

    await page.locator('[data-testid="session-row"]').first().click()
    await page.locator('[data-testid="new-bash"]').click()
    const term = page.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]')
    await term.waitFor({ timeout: 12_000 })
    await expect(term).toHaveAttribute('data-empty', 'false', { timeout: 12_000 })
    await page.locator('[data-terminal-slot]').waitFor({ timeout: 8_000 })
    const sessionId = await page
      .locator('[data-testid="session-row"].selected')
      .getAttribute('data-conversation-id')
    expect(sessionId).toBeTruthy()
    await page.waitForFunction(
      async (id) => {
        const listed = await window.vav.pty.list(id)
        return listed.sessions.length > 0
      },
      sessionId,
      { timeout: 12_000 }
    )
    const echoed = await page.evaluate(async (id) => {
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
    await expect(page.locator('.xterm-host, .xterm').first()).toBeVisible({ timeout: 8_000 })
    await assertNewSessionRow(page)
    await assertHostRotateOffer(page)
  } finally {
    try {
      await browser.close()
    } catch {
      // Chromium can throw EIO when its stdio is already gone.
    }
    daemon.stop()
  }
})
