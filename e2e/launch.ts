import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync
} from 'node:fs'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createConnection } from 'node:net'
import {
  encodeDaemonPairing,
  parseDaemonPairing
} from '../src/shared/daemonProtocol.ts'
import {
  buildNamedSession,
  buildSeededConversation,
  E2E_SESSION_B_ID,
  E2E_SESSION_ID,
  type SeedConversationKind
} from './seedConversation'

export { E2E_SESSION_B_ID, E2E_SESSION_ID }

const ACP_AGENT_SH = join(__dirname, 'fixtures', 'acp-agent.sh')

/**
 * Isolated Electron harness for Origin P0 journeys:
 * first-run-no-api-key, main-chat-empty, sidebar-conversation-list,
 * files-panel, README §1.4 / §2.6 Settings, inline change review.
 */
const require = createRequire(__filename)
const root = join(__dirname, '..')

export type LaunchVavOptions = {
  seedReview?: boolean
  /** Finish VAV turns locally — no provider HTTP (VAV_E2E_STUB_TURN). */
  stubTurn?: boolean
  /** Stream reasoning + a tool card before the stub reply (VAV_E2E_STUB_STREAM). */
  stubStream?: boolean
  /** Park the stub on an ask card until the UI answers (VAV_E2E_STUB_ASK). */
  stubAsk?: boolean
  /** Park the stub on Approve/Deny until the UI answers (VAV_E2E_STUB_APPROVE). */
  stubApprove?: boolean
  /** Persist a sealed agent / ACP transcript instead of an empty session. */
  seedConversation?: SeedConversationKind
  /** Second sidebar session titled "Second session". */
  extraSession?: boolean
  /**
   * Second folder on Settings recents (not under os.tmpdir, so the chip
   * treats it as a project path). Contains `other.md`.
   */
  extraWorkspace?: boolean
  /** `git init` the default workspace, commit, then dirty `hello.md`. */
  seedGit?: boolean
  /** Settings → Providers → Swarm mode. */
  swarmMode?: boolean
  /**
   * Spawn the local ACP fixture as the Cursor host (real initialize /
   * session/new / session/prompt). Implies seedConversation `acp-live`.
   */
  liveAcp?: boolean
  /** Live ACP fixture as Grok (`grok agent stdio`) instead of Cursor. */
  liveAcpHost?: 'cursor' | 'grok'
  /** Second sidebar session that is also a live Cursor ACP host. */
  extraAcpSession?: boolean
  /** Fixture emits usage_update / turn_completed usage (E2E_ACP_USAGE). */
  acpUsage?: boolean
  /** Fixture replays the cursor createPlan blocking contract (E2E_ACP_PLAN). */
  acpPlan?: boolean
  /** Override the ACP binary for liveAcp (manual real-agent verification). */
  acpBinary?: string
  /** Fixture fails the first n prompts with a network error (E2E_ACP_FAIL_PROMPTS). */
  acpFailPrompts?: number
  /** Fixture streams ONLY the leaked RetriableError for the first n prompts. */
  acpLeakPrompts?: number
  /** Fixture trails every reply with the leaked RetriableError chunk. */
  acpLeakTail?: boolean
  /**
   * First prompt streams a partial reply then a TLS-disconnect leak (end_turn);
   * the next prompt is the continue follow-up and replies "e2e continued".
   */
  acpLeakPartialTransport?: boolean
  /**
   * Default true so existing specs stay deterministic. Set false to assert
   * empty-state `empty-in` (logo + name stagger).
   */
  reduceMotion?: boolean
  /** Settings → Connect: listen so another VAV can pair with this instance. */
  remoteControlEnabled?: boolean
  /** Seed `userData/daemon/identity.json` name (pairing / remote-window label). */
  hostName?: string
  /** Override the seeded primary session id (default `e2e-session`). */
  sessionId?: string
  sessionTitle?: string
  /** First user message on the seeded primary session. */
  sessionMessage?: string
  /** Bind the primary session to `extraWorkspace` instead of the default folder. */
  sessionInExtraWorkspace?: boolean
  /** Extra files written into `extraWorkspace` (requires `extraWorkspace: true`). */
  extraWorkspaceFiles?: Record<string, string>
  /** Also put the default workspace on Settings recents (with extraWorkspace). */
  recentAlsoWorkspace?: boolean
}

export type VavHarness = {
  app: ElectronApplication
  page: Page
  userData: string
  workspace: string
  extraWorkspace?: string
  acpModelLog?: string
  dispose: () => Promise<void>
}

function electronExecutable(): string {
  const path = require('electron') as string
  if (!path || !existsSync(path)) {
    throw new Error('Electron binary not found. Run npm install.')
  }
  return path
}

function extraWorkspaceRoot(): string {
  // os.tmpdir() is labeled "TEMP DIR"; keep the extra folder off that prefix
  // so the workdir chip shows a real path.
  return process.platform === 'darwin' ? '/tmp' : tmpdir()
}

function seedGitRepo(workspace: string): void {
  execSync('git init -b main', { cwd: workspace })
  execSync('git add hello.md notes.md', { cwd: workspace })
  execSync('git -c user.email=e2e@vav.test -c user.name=e2e commit -m seed', {
    cwd: workspace
  })
  appendFileSync(join(workspace, 'hello.md'), 'changed from e2e\n')
}

function seedUserData(
  userData: string,
  workspace: string,
  options: LaunchVavOptions,
  extraWorkspace?: string
): void {
  const kind = options.liveAcp
    ? options.liveAcpHost === 'grok'
      ? 'acp-live-grok'
      : 'acp-live'
    : (options.seedConversation ?? 'empty')
  const settings: Record<string, unknown> = {
    locale: 'en',
    theme: 'light',
    reduceMotion: options.reduceMotion ?? true,
    windowVibrancyEnabled: false,
    autoCheckUpdates: false,
    globalHotkey: '',
    notificationsEnabled: false,
    notificationSound: false,
    trayEnabled: false,
    defaultWorkingDirectory: workspace,
    sidebarGroupingMode: 'workspace'
  }
  if (extraWorkspace) {
    settings.recentWorkspaceDirectories = options.recentAlsoWorkspace
      ? [extraWorkspace, workspace]
      : [extraWorkspace]
  }
  if (options.swarmMode) settings.swarmModeEnabled = true
  if (options.remoteControlEnabled) settings.remoteControlEnabled = true
  if (options.liveAcp) {
    chmodSync(ACP_AGENT_SH, 0o755)
    const binary = options.acpBinary ?? ACP_AGENT_SH
    const host = options.liveAcpHost === 'grok' ? 'grok' : 'cursor'
    settings.cliAgents = [
      {
        id: host,
        name: host === 'grok' ? 'Grok build' : 'Cursor',
        binaryPath: binary,
        binaryCandidates: [binary],
        defaultArgs:
          host === 'grok' ? ['--always-approve', '--permission-mode', 'bypassPermissions'] : [],
        envVars: {},
        enabled: true,
        builtin: true
      }
    ]
  }
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings, null, 2))
  writeFileSync(join(userData, 'keychain-onboarding-done'), `${Date.now()}\n`)
  if (options.hostName) {
    mkdirSync(join(userData, 'daemon'), { recursive: true })
    writeFileSync(
      join(userData, 'daemon', 'identity.json'),
      JSON.stringify({ machineId: randomUUID(), name: options.hostName }, null, 2)
    )
  }

  const conversationsDir = join(userData, 'conversations')
  mkdirSync(conversationsDir, { recursive: true })
  const primaryDir =
    options.sessionInExtraWorkspace && extraWorkspace ? extraWorkspace : workspace
  const primary = buildSeededConversation(kind, primaryDir)
  if (options.sessionId) primary.id = options.sessionId
  if (options.sessionTitle) primary.title = options.sessionTitle
  if (options.sessionMessage) {
    const now = Date.now()
    primary.messages = [
      {
        id: 'e2e-host-user-1',
        parentId: null,
        role: 'user',
        content: options.sessionMessage,
        blocks: [{ kind: 'text', text: options.sessionMessage }],
        createdAt: now
      }
    ]
    primary.activeLeafId = 'e2e-host-user-1'
    primary.updatedAt = now
  }
  writeFileSync(join(conversationsDir, `${primary.id}.json`), JSON.stringify(primary))
  const ids = [primary.id]
  if (options.extraAcpSession) {
    const extra = buildSeededConversation('acp-live', workspace, Date.now() - 5_000)
    extra.id = E2E_SESSION_B_ID
    extra.title = 'E2E ACP live B'
    extra.model = 'claude-fable-5'
    extra.fast = false
    writeFileSync(join(conversationsDir, `${extra.id}.json`), JSON.stringify(extra))
    ids.push(extra.id)
  } else if (options.extraSession) {
    const extra = buildNamedSession(workspace, E2E_SESSION_B_ID, 'Second session', Date.now() - 5_000)
    writeFileSync(join(conversationsDir, `${extra.id}.json`), JSON.stringify(extra))
    ids.push(extra.id)
  }
  writeFileSync(join(conversationsDir, 'index.json'), JSON.stringify({ version: 2, ids }))
}

export async function launchVav(options: LaunchVavOptions = {}): Promise<VavHarness> {
  const main = join(root, 'out/main/index.js')
  if (!existsSync(main)) {
    throw new Error('out/main/index.js missing. Run `npm run build` or `npm run test:e2e`.')
  }

  const userData = mkdtempSync(join(tmpdir(), 'vav-e2e-'))
  const acpModelLog = join(userData, 'acp-model.jsonl')
  const workspace = mkdtempSync(join(tmpdir(), 'vav-e2e-ws-'))
  writeFileSync(join(workspace, 'hello.md'), '# hello from e2e\n')
  writeFileSync(join(workspace, 'notes.md'), '# notes from e2e\n')
  if (options.seedGit) seedGitRepo(workspace)
  const extraWorkspace = options.extraWorkspace
    ? mkdtempSync(join(extraWorkspaceRoot(), 'vav-e2e-other-'))
    : undefined
  if (extraWorkspace) {
    writeFileSync(join(extraWorkspace, 'other.md'), '# other from e2e\n')
    for (const [name, contents] of Object.entries(options.extraWorkspaceFiles ?? {})) {
      writeFileSync(join(extraWorkspace, name), contents)
    }
  }
  seedUserData(userData, workspace, options, extraWorkspace)

  const app = await electron.launch({
    executablePath: electronExecutable(),
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      VAV_E2E: '1',
      VAV_USER_DATA: userData,
      ELECTRON_ENABLE_LOGGING: '1',
      ...(options.seedReview ? { VAV_E2E_SEED_REVIEW: '1' } : {}),
      ...(options.stubTurn || options.stubStream || options.stubAsk || options.stubApprove
        ? { VAV_E2E_STUB_TURN: '1' }
        : {}),
      ...(options.stubStream ? { VAV_E2E_STUB_STREAM: '1' } : {}),
      ...(options.stubAsk ? { VAV_E2E_STUB_ASK: '1' } : {}),
      ...(options.stubApprove ? { VAV_E2E_STUB_APPROVE: '1' } : {}),
      ...(options.acpUsage ? { E2E_ACP_USAGE: '1' } : {}),
      ...(options.acpPlan ? { E2E_ACP_PLAN: '1' } : {}),
      ...(options.liveAcp ? { E2E_ACP_MODEL_LOG: acpModelLog } : {}),
      ...(options.liveAcpHost === 'grok' ? { E2E_ACP_FLAVOR: 'grok' } : {}),
      ...(options.acpFailPrompts
        ? {
            E2E_ACP_FAIL_PROMPTS: String(options.acpFailPrompts),
            E2E_ACP_FAIL_STATE: join(userData, 'acp-fail-count')
          }
        : {}),
      ...(options.acpLeakPrompts ? { E2E_ACP_LEAK_PROMPTS: String(options.acpLeakPrompts) } : {}),
      ...(options.acpLeakTail ? { E2E_ACP_LEAK_TAIL: '1' } : {}),
      ...(options.acpLeakPartialTransport ? { E2E_ACP_LEAK_PARTIAL_TRANSPORT: '1' } : {})
    }
  })

  const page = await app.firstWindow()
  await page.locator('[data-testid="app-shell"]').waitFor({ state: 'visible', timeout: 25_000 })

  const dispose = async (): Promise<void> => {
    try {
      for (const win of app.windows()) {
        try {
          await win.close()
        } catch {
          // already gone
        }
      }
      await app.close()
    } catch {
      // already gone
    }
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
    if (extraWorkspace) rmSync(extraWorkspace, { recursive: true, force: true })
  }

  return { app, page, userData, workspace, extraWorkspace, acpModelLog, dispose }
}

export async function waitForDaemonPairing(page: Page): Promise<string> {
  let pairing = ''
  await expect
    .poll(async () => {
      pairing = (await page.evaluate(() => window.vav.hosts.pairing())) ?? ''
      if (!pairing) return false
      const parsed = parseDaemonPairing(pairing)
      const port = parsed?.port
      if (!port) return false
      return await new Promise<boolean>((resolve) => {
        const socket = createConnection({ host: '127.0.0.1', port })
        const done = (ok: boolean): void => {
          socket.removeAllListeners()
          socket.destroy()
          resolve(ok)
        }
        socket.setTimeout(400)
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
        socket.once('timeout', () => done(false))
      })
    })
    .toBe(true)
  const parsed = parseDaemonPairing(pairing)
  if (!parsed) throw new Error(`unrecognized pairing: ${pairing}`)
  return encodeDaemonPairing({
    ...parsed,
    host: '127.0.0.1',
    addresses: ['127.0.0.1']
  })
}

export function sessionRow(page: Page, id: string) {
  return page.locator(`[data-testid="session-row"][data-conversation-id="${id}"]`)
}

export function extraWorkspaceLabel(path: string): string {
  return basename(path)
}

/** Files tray: path chip → Files segment (files/files-panel.rpml). */
export async function openFilesTray(page: Page): Promise<void> {
  const tools = page.locator('[data-testid="tools-panel"]')
  if ((await tools.getAttribute('data-tools-collapsed')) === 'true') {
    await page.locator('[data-testid="workdir-chip"]').click()
  }
  await page.locator('[data-testid="files-panel"]').waitFor({ state: 'visible' })
}

/** Persist a workspace API key so VAV send is allowed (settings-api.rpml). */
export async function seedApiKey(page: Page, key = 'sk-e2e-test-key'): Promise<void> {
  await page.evaluate((value) => window.vav.settings.setApiKey(value), key)
}

/** Create a DeepSeek VAV profile so Providers shows the API form. */
export async function seedVavKeyAccount(page: Page, key = 'sk-e2e-test-key'): Promise<void> {
  await page.evaluate(async (value) => {
    const { id } = await window.vav.accounts.createDraft({
      agentId: 'vav',
      kind: 'vav_key',
      endpoint: 'https://api.deepseek.com'
    })
    await window.vav.accounts.updateVav(id, { apiKey: value, alias: 'DeepSeek' })
    await window.vav.accounts.setCurrent(id)
  }, key)
}

export function readUserSetting(userData: string, key: string): unknown {
  try {
    const raw = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >
    return raw[key]
  } catch {
    return undefined
  }
}

/** Wait for a new BrowserWindow after `action` — no hanging `waitForEvent`. */
export async function waitForNewWindow(
  harness: VavHarness,
  action: () => Promise<void>
): Promise<Page> {
  const before = new Set(harness.app.windows())
  await action()
  let found: Page | undefined
  await expect
    .poll(() => {
      found = harness.app.windows().find((win) => !before.has(win))
      return Boolean(found)
    })
    .toBe(true)
  if (!found) throw new Error('expected a new BrowserWindow')
  return found
}

/** Independent Settings window (README.rpml §1.4 / §2.6). */
export async function openSettingsWindow(
  harness: VavHarness,
  view = 'appearance'
): Promise<Page> {
  const settings = await waitForNewWindow(harness, async () => {
    await harness.page.evaluate((next) => window.vav.window.openSettings(next), view)
  })
  await settings.locator('[data-testid="settings-window"]').waitFor({ state: 'visible' })
  return settings
}

export type NativeMenuPeekItem = { id?: string; label?: string; checked?: boolean }

/** AppKit is skipped under VAV_E2E; this reads the same payload showMenu sent. */
export async function peekNativeMenu(page: Page): Promise<NativeMenuPeekItem[] | null> {
  return page.evaluate(() => window.vav.window.peekPopupMenu())
}

/** Wait for a native popup row, then choose it by id or label. */
export async function chooseNativeMenu(page: Page, idOrLabel: string): Promise<void> {
  await expect
    .poll(async () => {
      const items = await peekNativeMenu(page)
      return items?.some((item) => item.label === idOrLabel || item.id === idOrLabel) ?? false
    })
    .toBe(true)
  const ok = await page.evaluate(
    (label) => window.vav.window.choosePopupMenu(label),
    idOrLabel
  )
  expect(ok).toBe(true)
}

export async function dismissNativeMenu(page: Page): Promise<void> {
  await page.evaluate(() => window.vav.window.dismissPopupMenu())
}

type AcceleratorInput = {
  type: 'keyDown'
  key: string
  code: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

/** Product chords (`Meta+f`, `Meta+Shift+e`) via the same matcher as `before-input-event`. */
export function chordToAcceleratorInput(chord: string): AcceleratorInput {
  const parts = chord.split('+')
  const raw = parts.at(-1) ?? ''
  const mods = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()))
  const letter = raw.length === 1 && /[a-z]/i.test(raw) ? raw.toUpperCase() : raw
  return {
    type: 'keyDown',
    key: raw,
    code: raw === ',' ? 'Comma' : raw.length === 1 && /[a-z]/i.test(raw) ? `Key${letter}` : raw,
    meta: mods.has('meta') || mods.has('cmd') || mods.has('command'),
    control: mods.has('control') || mods.has('ctrl'),
    alt: mods.has('alt'),
    shift: mods.has('shift')
  }
}

export async function pressAccelerator(harness: VavHarness, chord: string): Promise<void> {
  const input = chordToAcceleratorInput(chord)
  const command = await harness.app.evaluate((_electron, next) => {
    const dispatch = (
      globalThis as {
        __e2eDispatchAccelerator?: (event: typeof next) => string | null
      }
    ).__e2eDispatchAccelerator
    if (!dispatch) throw new Error('e2e accelerator hook missing — rebuild with VAV_E2E=1')
    return dispatch(next)
  }, input)
  expect(command, `no MenuCommand for ${chord}`).toBeTruthy()
  // Same-command debounce in main is 80ms (before-input + menu twin-fire).
  await new Promise((resolve) => setTimeout(resolve, 100))
}
