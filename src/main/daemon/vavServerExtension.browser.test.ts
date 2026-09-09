import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { startVavWebBridge } from './VavWebBridge.ts'
import { spawnLocalVavServer } from './vavServerSpawn.ts'
import { assertDesktopSessionLayout, readPhoneSessionLayout } from './phoneSessionLayout.ts'

const SECRET = '0123456789abcdef01234567'
const EXT = join(import.meta.dirname, '../../../packages/vav-chrome-extension/extension')

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

function usesPlaywrightChromium(exe: string): boolean {
  return /chrome-mac|chromium-|chrome-win|chrome-linux|Google Chrome for Testing/i.test(exe)
}

async function openSidePanel(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage())
  const cdp = await context.newCDPSession(page)
  const started = Date.now()
  let extensionId = ''
  while (Date.now() - started < 15_000) {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: Array<{ url?: string; type?: string }>
    }
    const target = targetInfos.find((row) => String(row.url ?? '').startsWith('chrome-extension://'))
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
  return panel
}

async function launchExtension(profile: string, exe: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    executablePath: exe,
    // Playwright Chromium can load MV3 in headless. System Chrome often cannot.
    headless: usesPlaywrightChromium(exe),
    viewport: { width: 420, height: 800 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      // Chrome 137+ ignores --load-extension unless this feature is off.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  })
}

async function chatStubTurn(panel: Page, text: string): Promise<void> {
  await panel.locator('#create').click()
  await panel.locator('#sessionBar').waitFor({ timeout: 8_000 })
  await panel.locator('#text').fill(text)
  await panel.locator('#sendForm button[type="submit"]').click()
  await panel.locator('#transcript').getByText('e2e stub reply').waitFor({ timeout: 8_000 })
  assertDesktopSessionLayout(await panel.evaluate(readPhoneSessionLayout), 280)
}

/** Desktop and the extension share 4752–4762. A leftover steals /discover. */
function pidsOnPort(port: number): number[] {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      return [...new Set(out.split(/\s+/).map(Number).filter((pid) => pid > 0))]
    }
    const out = execFileSync('lsof', ['-ti', `TCP:${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return [...new Set(out.split(/\s+/).map(Number).filter((pid) => pid > 0))]
  } catch {
    return []
  }
}

async function freeDesktopWebPorts(): Promise<void> {
  for (let port = 4752; port <= 4762; port++) {
    for (const pid of pidsOnPort(port)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
}

/**
 * Load the unpacked MV3 side panel in Chrome and drive it as a vav-server client.
 * Headed (needs DISPLAY) because headless Chrome often refuses extensions.
 */
describe('vav-server Chrome extension', () => {
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

  it('opens the real side panel, picks a model, and sends without a missing-key error', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const prevKey = process.env.VAV_API_KEY
    process.env.VAV_API_KEY = 'sk-test-extension-picker'
    const dir = await mkdtemp(join(tmpdir(), 'vav-ext-pick-'))
    const profile = await mkdtemp(join(tmpdir(), 'vav-ext-pick-profile-'))
    const host = createLocalWorkspaceHost({ name: 'picker-host' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    assert.equal(plane.hasApiKey(), true)
    const web = await startVavWebBridge({
      listen: '127.0.0.1',
      port: 0,
      hub: plane.hub,
      secret: () => SECRET,
      name: 'picker-host',
      version: 'test',
      hasKey: () => plane.hasApiKey()
    })
    let context: BrowserContext | undefined
    try {
      context = await launchExtension(profile, exe)
      await new Promise((resolve) => setTimeout(resolve, 800))
      const panel = await openSidePanel(context)
      await panel.evaluate(
        async ({ port, secret }) => {
          await chrome.storage.local.set({
            vavDiscoverHint: { ports: [port], hosts: ['127.0.0.1'], secret }
          })
          await chrome.runtime.sendMessage({ type: 'rediscover' })
        },
        { port: web.port, secret: SECRET }
      )
      await panel.locator('#status').getByText(/Connected/).waitFor({ timeout: 12_000 })
      await panel.waitForFunction(async () => {
        const settings = await window.vav.settings.get()
        return settings.apiKeyPresent === true
      }, null, { timeout: 12_000 })
      await panel.getByRole('button', { name: /Choose agent/ }).first().click()
      const menu = panel.locator('.vav-dom-menu')
      await menu.waitFor({ timeout: 8_000 })
      const menuText = await menu.innerText()
      assert.match(menuText, /Claude|Cursor|Codex|Agents/)
      const modelRow = menu.locator('.vav-dom-menu-item:not([disabled])').first()
      const modelLabel = (await modelRow.innerText()).trim()
      assert.notEqual(modelLabel, '')
      assert.doesNotMatch(modelLabel, /loading/i)
      await modelRow.click()
      await panel.getByPlaceholder(/Message/).fill('hello from extension picker')
      await panel.getByTestId('composer-send').click()
      await panel.getByText('e2e stub reply').waitFor({ timeout: 8_000 })
      const body = await panel.locator('body').innerText()
      assert.doesNotMatch(body, /No API key configured/)
      t.diagnostic(`picked ${modelLabel}`)
    } finally {
      if (prevKey === undefined) delete process.env.VAV_API_KEY
      else process.env.VAV_API_KEY = prevKey
      try {
        await context?.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('opens the real side panel and connects despite a stale LAN websocket hint', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const dir = await mkdtemp(join(tmpdir(), 'vav-ext-lan-'))
    const profile = await mkdtemp(join(tmpdir(), 'vav-ext-lan-profile-'))
    const host = createLocalWorkspaceHost({ name: 'lan-hint' })
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
      name: 'lan-rewrite-host',
      version: 'test'
    })
    let context: BrowserContext | undefined
    try {
      context = await launchExtension(profile, exe)
      const panel = await openSidePanel(context)
      const attempted: string[] = []
      context.on('websocket', (socket) => attempted.push(socket.url()))
      await panel.evaluate(
        async ({ port, secret }) => {
          await chrome.storage.local.set({
            vavDiscoverHint: {
              origin: `http://192.168.1.5:${port}`,
              wsUrl: `ws://192.168.1.5:${port}/vav`,
              ports: [port],
              hosts: ['192.168.1.5'],
              secret
            }
          })
          await chrome.runtime.sendMessage({ type: 'rediscover' })
        },
        { port: web.port, secret: SECRET }
      )
      await panel.locator('#status').getByText(/Connected/).waitFor({ timeout: 12_000 })
      const chip = await panel.locator('.phone-link-chip').innerText()
      t.diagnostic(`side panel chip: ${chip.replaceAll('\n', ' · ')}`)
      const saved = await panel.evaluate(async () => {
        const { vavDiscoverHint } = await chrome.storage.local.get('vavDiscoverHint')
        return vavDiscoverHint
      })
      assert.match(chip, /Connected/)
      assert.equal(saved.origin, `http://127.0.0.1:${web.port}`)
      assert.equal(saved.wsUrl, `ws://127.0.0.1:${web.port}/vav`)
      assert.ok(
        attempted.every((url) => !url.includes('192.168.1.5')),
        `websocket attempts: ${JSON.stringify(attempted)}`
      )
    } finally {
      try {
        await context?.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('loads the side panel, pairs, and shows a vav-server stub reply', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
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
      context = await launchExtension(profile, exe)
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
      await panel.locator('#sessionBar').waitFor({ timeout: 8_000 })
      await panel.locator('#sessionsBtn').click()
      await panel.locator('#sessions [data-testid="session-row"]').first().waitFor({ timeout: 8_000 })
      await panel.locator('#closeDrawer').click({ position: { x: 400, y: 16 } })
      await panel.locator('#model').fill('extension-model')
      await panel.locator('#model').dispatchEvent('change')
      await panel.locator('#text').fill('hello from the chrome extension')
      await panel.locator('#sendForm button[type="submit"]').click()
      await panel.locator('#transcript').getByText('e2e stub reply').waitFor({ timeout: 8_000 })
      assertDesktopSessionLayout(await panel.evaluate(readPhoneSessionLayout), 280)
      const first = [...plane.conversations.all()].find((row) =>
        row.messages.some((m) => m.role === 'user')
      )
      assert.ok(first)
      assert.equal(first.model, 'extension-model')
      assert.ok(first.messages.some((m) => m.role === 'assistant'))
      const firstUser = first.messages.find((m) => m.role === 'user') as
        | { content?: string }
        | undefined
      assert.ok(firstUser)
      assert.equal(String(firstUser.content || '').includes('[Current page]'), false)

      const site = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><html><head><title>Install guide</title></head><body><h1>Prereqs</h1><p>Need Node 22</p></body></html>'
        )
      })
      await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
      const sitePort = (site.address() as { port: number }).port
      try {
        const tab = await context.newPage()
        await tab.goto(`http://127.0.0.1:${sitePort}/`)
        await tab.bringToFront()
        await panel.evaluate(async () => {
          await chrome.runtime.sendMessage({ type: 'refresh-page' })
        })
        await panel.bringToFront()
        await panel.locator('#pageTitle').getByText('Install guide').waitFor({ timeout: 8_000 })
        await panel.locator('#includePage').check()
        await panel.locator('#text').fill('summarize this page')
        await panel.locator('#sendForm button[type="submit"]').click()
        await panel.locator('#transcript').getByText('summarize this page').waitFor({ timeout: 8_000 })
        await panel.locator('#transcript').getByText('e2e stub reply').nth(1).waitFor({ timeout: 8_000 })
        if (existsSync('/opt/cursor/artifacts')) {
          await panel.screenshot({
            path: '/opt/cursor/artifacts/vav-server_chrome_extension_stub_turn.png',
            fullPage: true
          })
        }
        const stored =
          [...plane.conversations.all()].find((row) =>
            row.messages.some((m) => {
              const text =
                typeof (m as { content?: unknown }).content === 'string'
                  ? String((m as { content?: string }).content)
                  : ''
              return text.includes('[Current page]')
            })
          ) ?? first
        assert.ok(stored)
        const userTexts = stored.messages
          .filter((m) => m.role === 'user')
          .map((m) => {
            const row = m as { text?: string; content?: unknown; blocks?: Array<{ text?: string }> }
            if (typeof row.content === 'string') return row.content
            return row.text || row.blocks?.map((b) => b.text || '').join('') || ''
          })
        assert.ok(
          userTexts.some((text) => text.includes('Install guide') && text.includes('[Current page]')),
          `user texts: ${JSON.stringify(userTexts)}`
        )
      } finally {
        site.close()
      }
    } finally {
      try {
        await context?.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('pairs to a desktop-spawned vav-server from a pasted local URL', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const profile = await mkdtemp(join(tmpdir(), 'vav-ext-desk-'))
    const spawned = await spawnLocalVavServer({
      name: 'Desktop URL Paste',
      stubTurn: true,
      noWeb: false,
      webPort: 0
    })
    let context: BrowserContext | undefined
    try {
      assert.ok(spawned.webOrigin)
      context = await launchExtension(profile, exe)
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
      await panel.evaluate(async (url) => {
        await chrome.runtime.sendMessage({ type: 'pair', text: url })
      }, spawned.webOrigin)
      await panel.getByText(/Connected/).waitFor({ timeout: 12_000 })
      await panel.locator('#hostName').getByText('Desktop URL Paste').waitFor({ timeout: 8_000 })
      await panel.locator('#create').click()
      await panel.locator('#sessionBar').waitFor({ timeout: 8_000 })
      await panel.locator('#text').fill('hello from desktop vav-server')
      await panel.locator('#sendForm button[type="submit"]').click()
      await panel.locator('#transcript').getByText('e2e stub reply').waitFor({ timeout: 8_000 })
      if (existsSync('/opt/cursor/artifacts')) {
        await panel.screenshot({
          path: '/opt/cursor/artifacts/vav-server_chrome_extension_desktop_url.png',
          fullPage: true
        })
      }
    } finally {
      try {
        await context?.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      spawned.stop()
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('auto-discovers a desktop-spawned vav-server without a pasted URL', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const profile = await mkdtemp(join(tmpdir(), 'vav-ext-autodisc-'))
    await freeDesktopWebPorts()
    const spawned = await spawnLocalVavServer({
      name: 'Desktop Auto Discover',
      stubTurn: true,
      noWeb: false,
      webPort: 4752,
      webListen: '127.0.0.1'
    })
    let context: BrowserContext | undefined
    try {
      assert.ok(spawned.webOrigin)
      context = await launchExtension(profile, exe)
      const panel = await openSidePanel(context)
      await panel.evaluate(async () => {
        await chrome.runtime.sendMessage({ type: 'rediscover' })
      })
      await panel.getByText(/Connected/).waitFor({ timeout: 12_000 })
      await panel.locator('#hostName').getByText('Desktop Auto Discover').waitFor({ timeout: 8_000 })
      await chatStubTurn(panel, 'hello from desktop auto-discover')
      if (existsSync('/opt/cursor/artifacts')) {
        await panel.screenshot({
          path: '/opt/cursor/artifacts/vav-server_chrome_extension_desktop_autodiscover.png',
          fullPage: true
        })
      }
    } finally {
      try {
        await context?.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      spawned.stop()
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('pairs from a pasted desktop Connect vav-daemon URI', async (t) => {
    if (!exe) {
      t.skip('Chrome is not installed')
      return
    }

    const profile = await mkdtemp(join(tmpdir(), 'vav-ext-daemon-uri-'))
    await freeDesktopWebPorts()
    const spawned = await spawnLocalVavServer({
      name: 'Desktop Connect URI',
      stubTurn: true,
      noWeb: false,
      webPort: 4752,
      webListen: '127.0.0.1'
    })
    let context: BrowserContext | undefined
    try {
      assert.match(spawned.pairing, /^vavrtp:\/\//)
      context = await launchExtension(profile, exe)
      const panel = await openSidePanel(context)
      await panel.evaluate(async (uri) => {
        await chrome.runtime.sendMessage({ type: 'pair', text: uri })
      }, spawned.pairing)
      await panel.getByText(/Connected/).waitFor({ timeout: 12_000 })
      await panel.locator('#hostName').getByText('Desktop Connect URI').waitFor({ timeout: 8_000 })
      await chatStubTurn(panel, 'hello from vav-daemon URI')
      if (existsSync('/opt/cursor/artifacts')) {
        await panel.screenshot({
          path: '/opt/cursor/artifacts/vav-server_chrome_extension_daemon_uri.png',
          fullPage: true
        })
      }
    } finally {
      try {
        await context?.close()
      } catch {
        // Chromium can throw EIO when its stdio is already gone.
      }
      spawned.stop()
      await rm(profile, { recursive: true, force: true })
    }
  })
})
