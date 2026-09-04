import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { chromium, type BrowserContext } from '@playwright/test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { startVavWebBridge } from './VavWebBridge.ts'

const SECRET = '0123456789abcdef01234567'
const EXT = join(import.meta.dirname, '../../../extension')

function playwrightChromium(): string | undefined {
  try {
    const path = chromium.executablePath()
    return existsSync(path) ? path : undefined
  } catch {
    return undefined
  }
}

/**
 * Load the unpacked MV3 side panel in Chrome and drive it as a vavd client.
 * Headed (needs DISPLAY) because headless Chrome often refuses extensions.
 */
describe('vavd Chrome extension', () => {
  const exe = playwrightChromium()
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

  it('loads the side panel, pairs, and shows a vavd stub reply', async (t) => {
    if (!exe) {
      t.skip('Playwright Chromium is not installed')
      return
    }

    const dir = await mkdtemp(join(tmpdir(), 'vav-ext-'))
    const profile = await mkdtemp(join(tmpdir(), 'vav-ext-profile-'))
    const host = createLocalWorkspaceHost({ name: 'ext' })
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
      name: 'ext-host',
      version: 'test'
    })
    let context: BrowserContext | undefined
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: exe,
        headless: true,
        args: [
          `--disable-extensions-except=${EXT}`,
          `--load-extension=${EXT}`,
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      })
      const page = context.pages()[0] ?? (await context.newPage())
      const cdp = await context.newCDPSession(page)
      const started = Date.now()
      let extensionId = ''
      while (Date.now() - started < 15_000) {
        const { targetInfos } = (await cdp.send('Target.getTargets')) as {
          targetInfos: Array<{ url?: string; type?: string }>
        }
        const target = targetInfos.find((row) =>
          String(row.url ?? '').startsWith('chrome-extension://')
        )
        if (target?.url) {
          extensionId = new URL(target.url).host
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (!extensionId) {
        throw new Error('Playwright Chromium did not register the unpacked MV3 extension')
      }
      const panel = await context.newPage()
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
      await panel.evaluate(async (port) => {
        await chrome.storage.local.set({
          vavDiscoverHint: { ports: [port], hosts: ['127.0.0.1'] }
        })
        await chrome.runtime.sendMessage({ type: 'rediscover' })
      }, web.port)
      await panel.getByText(/Connected/).waitFor({ timeout: 12_000 })
      await panel.locator('#create').click()
      await panel.locator('#sessions li').first().waitFor({ timeout: 8_000 })
      await panel.locator('#model').fill('extension-model')
      await panel.locator('#apply').click()
      await panel.locator('#text').fill('hello from the chrome extension')
      await panel.locator('#sendForm button[type="submit"]').click()
      await panel.locator('#transcript').getByText('e2e stub reply').waitFor({ timeout: 8_000 })
      if (existsSync('/opt/cursor/artifacts')) {
        await panel.screenshot({
          path: '/opt/cursor/artifacts/vavd_chrome_extension_stub_turn.png',
          fullPage: true
        })
      }
      const stored = [...plane.conversations.all()].at(-1)
      assert.ok(stored)
      assert.equal(stored.model, 'extension-model')
      assert.ok(stored.messages.some((m) => m.role === 'assistant'))
    } finally {
      await context?.close()
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
      await rm(profile, { recursive: true, force: true })
    }
  })
})
