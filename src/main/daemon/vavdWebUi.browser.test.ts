import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { chromium, type Browser } from '@playwright/test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { startVavWebBridge } from './VavWebBridge.ts'

const SECRET = '0123456789abcdef01234567'

function chromePath(): string | undefined {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : process.platform === 'win32'
        ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  return candidates.find((path) => existsSync(path))
}

/**
 * Real Chrome against the bundled web page. Skips when this machine has no
 * system Chrome so macOS/Windows CI without a browser still pass.
 */
describe('vavd web UI in Chrome', () => {
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

  it('pairs, configures a model, and shows a vavd stub reply', async (t) => {
    if (!exe) {
      t.skip('system Chrome is not installed')
      return
    }

    const dir = await mkdtemp(join(tmpdir(), 'vav-webui-'))
    const host = createLocalWorkspaceHost({ name: 'webui' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const web = await startVavWebBridge({
      listen: '127.0.0.1',
      port: 0,
      hub: plane.hub,
      secret: () => SECRET,
      name: 'webui',
      version: 'test'
    })
    let browser: Browser | undefined
    try {
      browser = await chromium.launch({
        executablePath: exe,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      })
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${web.port}/`)
      await page.getByText(/Connected/).waitFor({ timeout: 8_000 })
      await page.locator('#create').click()
      await page.locator('#sessions li').first().waitFor({ timeout: 8_000 })
      await page.locator('#model').fill('webui-model')
      await page.locator('#approval').selectOption('bypass')
      await page.locator('#apply').click()
      await page.waitForFunction(
        () => (document.getElementById('model') as HTMLInputElement | null)?.value === 'webui-model',
        undefined,
        { timeout: 8_000 }
      )
      await page.locator('#text').fill('hello from the web page')
      await page.locator('#sendForm button[type="submit"]').click()
      await page.locator('#log').getByText('e2e stub reply').waitFor({ timeout: 8_000 })
      if (existsSync('/opt/cursor/artifacts')) {
        await page.screenshot({
          path: '/opt/cursor/artifacts/vavd_web_ui_stub_turn.png',
          fullPage: true
        })
      }
      const stored = [...plane.conversations.all()].at(-1)
      assert.ok(stored)
      assert.equal(stored.model, 'webui-model')
      assert.equal(stored.approvalMode, 'bypass')
      assert.ok(stored.messages.some((m) => m.role === 'user'))
      assert.ok(stored.messages.some((m) => m.role === 'assistant'))
    } finally {
      await browser?.close()
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
