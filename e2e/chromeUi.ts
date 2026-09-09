import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, expect, type Page } from '@playwright/test'
import { DaemonClient } from '../src/main/daemon/DaemonClient.ts'
import { parseDaemonPairing } from '../src/shared/daemonProtocol.ts'

const execFileAsync = promisify(execFile)
const root = join(__dirname, '..')

export function chromePath(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  try {
    const bundled = chromium.executablePath()
    if (existsSync(bundled)) return bundled
  } catch {
    // Playwright Chromium is optional until we look at system Chrome.
  }
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : process.platform === 'win32'
        ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      'Chrome / web e2e requires Chrome or Playwright Chromium (set CHROME_PATH or run npx playwright install chromium)'
    )
  }
  return found
}

export function usesPlaywrightChromium(exe: string): boolean {
  return /chrome-mac|chromium-|chrome-win|chrome-linux|Google Chrome for Testing/i.test(exe)
}

function phoneUiHasLiveXterm(): boolean {
  const dir = join(root, 'out/phone-ui')
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((name) => {
    if (!name.endsWith('.js')) return false
    return readFileSync(join(dir, name), 'utf8').includes('xterm-helper-textarea')
  })
}

export async function ensurePhoneUiBundle(): Promise<void> {
  const js = join(root, 'out/phone-ui/phone.js')
  const extJs = join(root, 'packages/vav-chrome-extension/extension/phone/phone.js')
  const sources = [
    join(root, 'packages/vav-desktop/src/renderer/src/state/workspaceStore.ts'),
    join(root, 'packages/vav-chrome-extension/phone-ui/phoneVav.ts'),
    join(root, 'packages/vav-chrome-extension/phone-ui/PhoneApp.tsx'),
    join(root, 'packages/vav-desktop/src/renderer/src/SettingsWindow.tsx'),
    join(root, 'packages/vav-desktop/src/renderer/src/components/WorkspaceView.tsx')
  ]
  const stale =
    existsSync(js) &&
    sources.some((path) => existsSync(path) && statSync(path).mtimeMs > statSync(js).mtimeMs)
  if (existsSync(js) && existsSync(extJs) && phoneUiHasLiveXterm() && !stale) return
  await execFileAsync(process.execPath, [join(root, 'scripts/build-phone-ui.mjs')], {
    cwd: root,
    timeout: 180_000
  })
  if (!existsSync(js) || !existsSync(extJs) || !phoneUiHasLiveXterm()) {
    throw new Error('phone-ui bundle missing — run npm run build:phone-ui')
  }
}

/** Plant the same 2-file review desktop e2e seeds, on the live vav-server store. */
export async function seedChangeReview(pairing: string, conversationId: string): Promise<string> {
  const parsed = parseDaemonPairing(pairing)
  if (!parsed?.secret) throw new Error('pairing missing secret')
  const rpc = new DaemonClient()
  await rpc.connect({
    host: '127.0.0.1',
    port: parsed.port,
    secret: parsed.secret,
    device: 'e2e-review'
  })
  try {
    const seeded = (await rpc.request('changeSets.seedReview', { conversationId })) as {
      set?: { id?: string }
    }
    if (!seeded.set?.id) throw new Error('changeSets.seedReview returned no set')
    return seeded.set.id
  } finally {
    rpc.close()
  }
}

/** Same Settings categories as desktop `e2e/specs/settings.spec.ts`. */
export const DESKTOP_SETTINGS_NAV = [
  'appearance',
  'agents',
  'analysis',
  'notifications',
  'connect',
  'connectors',
  'workspace',
  'keybindings',
  'file-associations',
  'cli',
  'logs',
  'about'
] as const

/** Chrome / web overlay must paint the desktop Settings window, not a phone stub. */
export async function assertDesktopSettingsOverlay(page: Page): Promise<void> {
  await page.evaluate(() => window.vav.window.openSettings('appearance'))
  const sheet = page.locator('[data-testid="phone-settings"]')
  await sheet.waitFor({ timeout: 12_000 })
  await sheet.locator('[data-testid="settings-nav-appearance"]').waitFor({ timeout: 12_000 })
  for (const id of DESKTOP_SETTINGS_NAV) {
    const nav = sheet.locator(`[data-testid="settings-nav-${id}"]`)
    await nav.scrollIntoViewIfNeeded()
    await expect(nav).toBeVisible()
  }
  await expect(sheet.getByRole('button', { name: /^done$/i })).toHaveCount(0)

  const fonts = await page.evaluate(() => window.vav.settings.availableFonts())
  expect(
    fonts.some((font) => font === 'SF Mono' || font === 'Courier New' || font === 'JetBrains Mono')
  ).toBeTruthy()

  await sheet.locator('[data-testid="settings-nav-agents"]').click()
  await expect(sheet.locator('[data-testid="providers-list"]')).toBeVisible()
  const catalog = await page.evaluate(async () => {
    const { id } = await window.vav.accounts.createDraft({ agentId: 'vav', kind: 'vav_key' })
    const listed = await window.vav.accounts.getPage()
    await window.vav.accounts.remove(id)
    return {
      id,
      listed: Array.isArray(listed.accounts) && listed.accounts.some((row) => row.id === id)
    }
  })
  expect(catalog.id).toBeTruthy()
  expect(catalog.listed).toBe(true)

  await sheet.locator('[data-testid="settings-nav-connect"]').click()
  await expect(sheet.locator('[data-testid="connect-panel-incoming"]')).toBeVisible()
  await expect(sheet.locator('[data-testid="connect-pairing-line"]')).toBeVisible()
  await expect(sheet.locator('[data-testid="connect-pairing-line"]')).toContainText('vavrtp://')
  await expect(sheet.locator('[data-testid="settings-rotate-offer"]')).toBeVisible()

  await sheet.locator('[data-testid="settings-nav-logs"]').click()
  const retention = sheet.locator('[data-testid="settings-log-retention"]')
  await expect(retention).toBeVisible()
  await retention.selectOption('3')
  await expect
    .poll(async () => {
      const settings = await page.evaluate(() => window.vav.settings.get())
      return settings.logRetentionDays
    }, { timeout: 8_000 })
    .toBe(3)

  await page.evaluate(() => window.vav.window.closeSettings())
  await expect(sheet).toHaveCount(0)
}

/** WAN / Tailcat stay on desktop. Do not pair a LAN URI here — that retargets the socket. */
export async function assertChromeWanPairRejected(page: Page): Promise<void> {
  const wan = await page.evaluate(() => window.vav.hosts.pair('vavrtp://bbbbbbbbbbbbbbbb@8.8.8.8:18746'))
  expect(wan.ok).toBe(false)
  expect(String('error' in wan ? wan.error : '')).toMatch(/WAN|private LAN|desktop/i)
}

/** Mint a new incoming offer. Call after every DaemonClient that used the start pairing. */
export async function assertHostRotateOffer(page: Page): Promise<void> {
  const rotated = await page.evaluate(async () => {
    const before = await window.vav.hosts.pairing()
    await window.vav.hosts.rotateOffer()
    const after = await window.vav.hosts.pairing()
    return { before, after }
  })
  expect(rotated.before).toMatch(/^vavrtp:\/\//)
  expect(rotated.after).toMatch(/^vavrtp:\/\//)
  expect(rotated.after).not.toBe(rotated.before)
}

export async function sessionWorkdir(pairing: string, conversationId: string): Promise<string> {
  const parsed = parseDaemonPairing(pairing)
  if (!parsed?.secret) throw new Error('pairing missing secret')
  const rpc = new DaemonClient()
  await rpc.connect({
    host: '127.0.0.1',
    port: parsed.port,
    secret: parsed.secret,
    device: 'e2e-workdir'
  })
  try {
    const row = (await rpc.request('sessions.get', { id: conversationId })) as {
      conversation?: { workingDirectory?: string | null }
    }
    return String(row.conversation?.workingDirectory ?? '').trim()
  } finally {
    rpc.close()
  }
}

/** Git / Plugins tray on the same daemon plane as desktop-vav-server-matrix. */
export async function assertGitAndPluginsTray(
  page: Page,
  pairing: string,
  conversationId: string
): Promise<void> {
  let cwd = await page.evaluate(async (id) => {
    const list = await window.vav.conversations.list()
    const row = list.find((item) => item.id === id)
    return String(row?.workingDirectory ?? '').trim()
  }, conversationId)
  if (!cwd) cwd = await sessionWorkdir(pairing, conversationId)
  if (!cwd) throw new Error('session has no workingDirectory')
  const inited = await page.evaluate(
    async ({ dir, id }) => window.vav.git.init(dir, id),
    { dir: cwd, id: conversationId }
  )
  if (inited && typeof inited === 'object' && 'ok' in inited && inited.ok === false) {
    throw new Error(`git.init failed: ${'error' in inited ? String(inited.error) : 'unknown'}`)
  }
  const files = page.locator('[data-testid="files-panel"]')
  if (!(await files.isVisible())) {
    await page.locator('[data-testid="workdir-chip"]').click()
    await files.waitFor({ timeout: 8_000 })
  }
  await page.locator('[data-testid="segment-git"]').click()
  await expect(page.locator('[data-testid="git-panel"]')).toBeVisible()
  await page.locator('[data-testid="segment-plugins"]').click()
  await expect(page.locator('[data-testid="plugins-tray"]')).toBeVisible()
  await page.locator('[data-testid="segment-files"]').click()
  await expect(files).toBeVisible()
}

/** Same Files drawer preview desktop-vav-server-matrix asserts after a dblclick. */
export async function assertFilePreview(page: Page, fileName: string): Promise<void> {
  const row = page.locator(`[data-file-path$="${fileName}"]`)
  const path = await row.getAttribute('data-file-path')
  if (!path) throw new Error(`no data-file-path for ${fileName}`)
  const body = 'vav-phone-preview-body'
  const written = await page.evaluate(async ({ filePath, text }) => {
    return window.vav.files.write(filePath, `${text}\n`)
  }, { filePath: path, text: body })
  if (!written.ok) throw new Error(`files.write failed: ${'error' in written ? written.error : 'unknown'}`)
  const before = await page.evaluate(() => ({
    workspace: Boolean(document.querySelector('.workspace-view')),
    preview: Boolean(document.querySelector('[data-testid="file-preview"]')),
    ready: document.querySelector('[data-testid="app-shell"]')?.childElementCount ?? 0
  }))
  await row.dblclick()
  await page.evaluate((filePath) => window.vav.window.openFilePreview(filePath), path)
  const preview = page.locator('[data-testid="file-preview"]')
  await expect
    .poll(async () => {
      return page.evaluate((prior) => ({
        prior,
        preview: Boolean(document.querySelector('[data-testid="file-preview"]')),
        workspace: Boolean(document.querySelector('.workspace-view')),
        rows: document.querySelectorAll('[data-testid="session-row"]').length,
        selected: document
          .querySelector('[data-testid="session-row"].selected')
          ?.getAttribute('data-conversation-id')
      }), before)
    }, { timeout: 12_000 })
    .toMatchObject({ preview: true, workspace: true })
  await expect(preview).not.toHaveClass(/is-collapsed/, { timeout: 12_000 })
  await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText(fileName)
  await expect(preview.getByText(body)).toBeVisible({ timeout: 12_000 })
}

/** Same Files tray rename / trash desktop workspace I/O uses on the daemon plane. */
export async function assertFilesRenameAndTrash(page: Page, fileName: string): Promise<void> {
  const row = page.locator(`[data-file-path$="${fileName}"]`)
  const path = await row.getAttribute('data-file-path')
  if (!path) throw new Error(`no data-file-path for ${fileName}`)
  const renamed = fileName.replace(/(\.[^./]+)$/, '-renamed$1')
  const result = await page.evaluate(
    async ({ filePath, name }) => window.vav.files.rename(filePath, name),
    { filePath: path, name: renamed }
  )
  if (!result.ok) throw new Error(`files.rename failed: ${'error' in result ? result.error : 'unknown'}`)
  const renamedPath = result.ok && 'path' in result ? String(result.path) : ''
  if (!renamedPath) throw new Error(`files.rename returned no path`)
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ filePath, name }) => {
            const parent = filePath.replace(/[/\\][^/\\]+$/, '') || '/'
            const listing = await window.vav.files.list(parent, 'name', true)
            return listing.entries.some((entry) => entry.path === filePath || entry.name === name)
          },
          { filePath: renamedPath, name: renamed }
        ),
      { timeout: 8_000 }
    )
    .toBe(true)
  const trashed = await page.evaluate((filePath) => window.vav.files.trash([filePath]), renamedPath)
  if (!trashed.ok) throw new Error(`files.trash failed: ${'error' in trashed ? trashed.error : 'unknown'}`)
  await expect
    .poll(async () => page.evaluate(async (filePath) => {
      const parent = filePath.replace(/[/\\][^/\\]+$/, '') || '/'
      const listing = await window.vav.files.list(parent, 'name', true)
      return listing.entries.some((entry) => entry.path === filePath)
    }, renamedPath), { timeout: 8_000 })
    .toBe(false)
}

export async function createFilesTrayFile(page: Page, fileName: string): Promise<void> {
  const tools = page.locator('[data-testid="tools-panel"]')
  const files = page.locator('[data-testid="files-panel"]')
  if ((await tools.getAttribute('data-tools-collapsed')) === 'true' || !(await files.isVisible())) {
    await page.locator('[data-testid="workdir-chip"]').click({ timeout: 8_000 })
    await expect(tools).not.toHaveAttribute('data-tools-collapsed', 'true', { timeout: 8_000 })
    await files.waitFor({ timeout: 8_000 })
  }
  await page.locator('[data-testid="files-new-file"]').click({ timeout: 8_000 })
  const createName = page.locator('[data-testid="files-create-name"]')
  await createName.waitFor({ timeout: 8_000 })
  await createName.fill(fileName, { timeout: 8_000 })
  await createName.press('Enter')
  await page.locator(`[data-file-path$="${fileName}"]`).waitFor({ timeout: 8_000 })
}

/** Same sidebar Pin / Rename chrome desktop sidebar-menu e2e covers. */
export async function assertSessionListActions(page: Page, conversationId: string): Promise<void> {
  const row = page.locator(`[data-testid="session-row"][data-conversation-id="${conversationId}"]`)
  await row.click({ button: 'right' })
  const menu = page.locator('#vav-dom-menu')
  await menu.waitFor({ timeout: 8_000 })
  await expect(menu.getByRole('menuitem', { name: /^(Pin|置顶)$/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^(Archive|归档)$/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^(Rename|重命名)$/ })).toBeVisible()
  await menu.getByRole('menuitem', { name: /^(Pin|置顶)$/ }).click()
  await expect(page.locator('.conv-pinned-section')).toBeVisible({ timeout: 8_000 })
  await row.click({ button: 'right' })
  await menu.waitFor({ timeout: 8_000 })
  await menu.getByRole('menuitem', { name: /^(Rename|重命名)$/ }).click()
  const field = row.locator('.rename-field')
  await expect(field).toBeVisible()
  await field.fill('Chrome renamed')
  await field.press('Enter')
  await expect(row).toContainText('Chrome renamed')
}

/** List / resource: New Session mint another row on the same vav-server catalog. */
export async function assertNewSessionRow(page: Page): Promise<void> {
  const before = await page.locator('[data-testid="session-row"]').count()
  await page.locator('[data-testid="new-session"]').click()
  await expect(page.locator('[data-testid="session-row"]')).toHaveCount(before + 1)
}
