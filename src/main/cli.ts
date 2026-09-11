import { app } from 'electron'
import { execFile } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import { APP_CLI_NAME } from './brand'
import { packagedMacCliLauncher } from './macAppOpen.ts'
import { CLI_BIN_NAMES, DAEMON_BIN_NAMES, nodeBinLauncherScript, resolveNodeBinSpec } from './cli/cliBins'
import { t } from './i18n'

const execFileAsync = promisify(execFile)

export type CliInstallLocation = '/usr/local/bin' | '~/.local/bin'

export interface CliStatus {
  installed: boolean
  path: string | null
  preferredLocation: CliInstallLocation
  pathInPath: boolean
  version: string | null
  installedAt: number | null
  error?: string
  /** Soft note after e.g. falling back from /usr/local/bin → ~/.local/bin. */
  notice?: string
  /** All shims this install writes (`vav` plus vav-server / vav-board / vav-tui). */
  commands: string[]
}

const LOCATION_KEY = 'cliInstallLocation'
const PATH_KEY = 'cliInstallPath'
const INSTALLED_AT_KEY = 'cliInstalledAt'

/** User-writable default — /usr/local/bin usually needs admin on modern macOS. */
const DEFAULT_LOCATION: CliInstallLocation = '~/.local/bin'

let cachedLoginPathDirs: string[] | null = null

function expandLocation(location: CliInstallLocation): string {
  if (location === '~/.local/bin') return join(homedir(), '.local', 'bin')
  return '/usr/local/bin'
}

function binaryPath(location: CliInstallLocation, name = APP_CLI_NAME): string {
  return join(expandLocation(location), name)
}

function daemonStateDir(): string {
  try {
    return join(app.getPath('userData'), 'vav-server')
  } catch {
    return join(homedir(), '.vav-server')
  }
}

/**
 * GUI apps inherit a stripped PATH from launchd, so `process.env.PATH` often
 * omits `/usr/local/bin` even when every terminal has it. Ask the login shell.
 *
 * Must stay **async** — `execFileSync` blocked the Electron main process for
 * up to 5s and froze Settings when opening Command Line.
 */
async function loginPathDirs(): Promise<string[]> {
  if (cachedLoginPathDirs) return cachedLoginPathDirs
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  try {
    const { stdout } = await execFileAsync(shell, ['-ilc', 'printenv PATH'], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        HOME: homedir(),
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        SHELL: shell,
        TERM: 'dumb',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
      }
    })
    const lastLine = stdout.trim().split('\n').at(-1)
    cachedLoginPathDirs = (lastLine ?? '')
      .split(':')
      .map((part) => part.trim())
      .filter(Boolean)
  } catch {
    cachedLoginPathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  }
  return cachedLoginPathDirs
}

async function pathEnvHas(dir: string): Promise<boolean> {
  const dirs = await loginPathDirs()
  return dirs.includes(dir)
}

function isAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM'
}

/** Printed for `vav -h` / `vav --help` (settings-cli.rpml points users here). */
const CLI_HELP = [
  'Usage: vav [path]',
  '',
  '  vav                 Open a new session in the default workspace',
  '  vav .               Open a new session in the current directory',
  '  vav /path/to/dir    Open a new session for that workspace',
  '',
  'If VAV is already running, the session is added and focused.',
  'The command returns immediately — VAV opens in the background.',
  '',
  'This install also writes:',
  '  vav-server     Headless daemon (same process the app can spawn)',
  '  vav-board     Control client — sessions, files, panes (herdr-style)',
  '  vav-tui   Agent CLI — interactive / print / JSON / RPC (Claude Code-style)',
  '',
  'Those three talk to vav-server over the same protocols as the app.',
  'Run vav-board -h or vav-tui -h for usage.',
  ''
].join('\n')

/** Packaged macOS: …/vav.app/Contents/MacOS/vav → …/vav.app */
export function packagedAppBundlePath(): string {
  return resolvePath(dirname(process.execPath), '..', '..')
}

/**
 * Resolve a user path to an absolute, existing directory (or null).
 * Used by CLI / Dock open so we don’t toast “missing” on symlink or relative forms.
 */
export function resolveExistingDirectory(input: string | null | undefined): string | null {
  if (!input || !input.trim()) return null
  const raw = input.trim()
  const candidates = [raw]
  if (!isAbsolute(raw)) candidates.push(resolvePath(process.cwd(), raw))
  for (const candidate of candidates) {
    try {
      const full = existsSync(candidate) ? realpathSync(candidate) : candidate
      if (existsSync(full) && statSync(full).isDirectory()) return full
    } catch {
      // try next
    }
  }
  return null
}

const CLI_LAUNCHER_HELP = [
  'case "$1" in',
  '  -h|--help)',
  '    cat <<\'EOF\'',
  CLI_HELP + 'EOF',
  '    exit 0',
  '    ;;',
  'esac'
]

// Resolve "." / relative paths in the *shell* cwd before handing off to the GUI app.
const CLI_LAUNCHER_RESOLVE_TARGET = [
  'TARGET="$1"',
  'case "$TARGET" in',
  '  .) TARGET="$(pwd -P)" ;;',
  '  /*) TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P || echo "$TARGET")" ;;',
  '  *) TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P || echo "$TARGET")" ;;',
  'esac'
]

function launcherScript(): string {
  if (app.isPackaged && process.platform === 'darwin') {
    return packagedMacCliLauncher(packagedAppBundlePath(), CLI_HELP)
  }

  if (app.isPackaged) {
    const bin = process.execPath
    return [
      '#!/bin/sh',
      'set -e',
      `BIN=${JSON.stringify(bin)}`,
      ...CLI_LAUNCHER_HELP,
      'if [ "$#" -eq 0 ]; then',
      '  nohup "$BIN" >/dev/null 2>&1 &',
      '  exit 0',
      'fi',
      ...CLI_LAUNCHER_RESOLVE_TARGET,
      'nohup "$BIN" --vav-workdir="$TARGET" >/dev/null 2>&1 &',
      ''
    ].join('\n')
  }

  const electron = process.execPath
  const appPath = app.getAppPath()
  return [
    '#!/bin/sh',
    'set -e',
    `ELECTRON=${JSON.stringify(electron)}`,
    `APP=${JSON.stringify(appPath)}`,
    ...CLI_LAUNCHER_HELP,
    'if [ "$#" -eq 0 ]; then',
    '  nohup "$ELECTRON" "$APP" >/dev/null 2>&1 &',
    '  exit 0',
    'fi',
    ...CLI_LAUNCHER_RESOLVE_TARGET,
    // `--` keeps Electron/Chromium from treating our flag as a Chromium switch.
    'nohup "$ELECTRON" "$APP" -- --vav-workdir="$TARGET" >/dev/null 2>&1 &',
    ''
  ].join('\n')
}

function readMeta(): {
  preferredLocation: CliInstallLocation
  path: string | null
  installedAt: number | null
} {
  try {
    const file = join(app.getPath('userData'), 'cli.json')
    if (!existsSync(file)) {
      return { preferredLocation: DEFAULT_LOCATION, path: null, installedAt: null }
    }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const preferred: CliInstallLocation =
      raw[LOCATION_KEY] === '/usr/local/bin' ? '/usr/local/bin' : '~/.local/bin'
    return {
      preferredLocation: preferred,
      path: typeof raw[PATH_KEY] === 'string' ? raw[PATH_KEY] : null,
      installedAt: typeof raw[INSTALLED_AT_KEY] === 'number' ? raw[INSTALLED_AT_KEY] : null
    }
  } catch {
    return { preferredLocation: DEFAULT_LOCATION, path: null, installedAt: null }
  }
}

function writeMeta(meta: {
  preferredLocation: CliInstallLocation
  path: string | null
  installedAt: number | null
}): void {
  const file = join(app.getPath('userData'), 'cli.json')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify(
      {
        [LOCATION_KEY]: meta.preferredLocation,
        [PATH_KEY]: meta.path,
        [INSTALLED_AT_KEY]: meta.installedAt
      },
      null,
      2
    )
  )
}

export async function getCliStatus(): Promise<CliStatus> {
  if (process.platform === 'win32') {
    return {
      installed: false,
      path: null,
      preferredLocation: DEFAULT_LOCATION,
      pathInPath: false,
      version: null,
      installedAt: null,
      error: t('cli.winUnsupported'),
      commands: [...CLI_BIN_NAMES]
    }
  }

  const meta = readMeta()
  const candidate = meta.path ?? binaryPath(meta.preferredLocation)
  const locationDir = candidate ? dirname(candidate) : expandLocation(meta.preferredLocation)
  const present = CLI_BIN_NAMES.filter((name) => existsSync(join(locationDir, name)))
  const installed = present.length === CLI_BIN_NAMES.length
  let installedAt = meta.installedAt
  if (present.includes(APP_CLI_NAME) && !installedAt) {
    try {
      installedAt = Math.round(statSync(join(locationDir, APP_CLI_NAME)).mtimeMs)
    } catch {
      installedAt = null
    }
  }

  return {
    installed,
    path: present.includes(APP_CLI_NAME) ? join(locationDir, APP_CLI_NAME) : null,
    preferredLocation: meta.preferredLocation,
    pathInPath: await pathEnvHas(locationDir),
    version: present.length ? app.getVersion() : null,
    installedAt,
    commands: present
  }
}

export async function setCliPreferredLocation(
  location: CliInstallLocation
): Promise<CliStatus> {
  const meta = readMeta()
  writeMeta({ ...meta, preferredLocation: location })
  return getCliStatus()
}

function writeDaemonBins(dir: string): string[] {
  const written: string[] = []
  const stateDir = daemonStateDir()
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined
  for (const name of DAEMON_BIN_NAMES) {
    const spec = resolveNodeBinSpec(name, {
      cwd: process.cwd(),
      resourcesPath,
      stateDir
    })
    if (!spec) {
      throw new Error(`missing ${name} binary — pack vav-server or run from the VAV repo`)
    }
    const target = join(dir, name)
    writeFileSync(target, nodeBinLauncherScript(spec), { encoding: 'utf8', mode: 0o755 })
    chmodSync(target, 0o755)
    written.push(target)
  }
  return written
}

function writeLauncher(location: CliInstallLocation, previousPath: string | null): string {
  const dir = expandLocation(location)
  const target = binaryPath(location)
  mkdirSync(dir, { recursive: true })
  if (previousPath && previousPath !== target && existsSync(previousPath)) {
    try {
      unlinkSync(previousPath)
    } catch {
      // Best-effort; the new install still proceeds.
    }
    const previousDir = dirname(previousPath)
    for (const name of DAEMON_BIN_NAMES) {
      const stale = join(previousDir, name)
      if (stale !== join(dir, name) && existsSync(stale)) {
        try {
          unlinkSync(stale)
        } catch {
          /* ignore */
        }
      }
    }
  }
  writeFileSync(target, launcherScript(), { encoding: 'utf8', mode: 0o755 })
  chmodSync(target, 0o755)
  writeDaemonBins(dir)
  writeMeta({
    preferredLocation: location,
    path: target,
    installedAt: Date.now()
  })
  return target
}

/** Rewrite an already-installed `vav` shim so older `open -n` copies do not linger. */
export function refreshInstalledCliLauncher(): void {
  if (process.platform === 'win32') return
  const meta = readMeta()
  if (!meta.path || !existsSync(meta.path)) return
  const next = launcherScript()
  try {
    if (readFileSync(meta.path, 'utf8') === next) return
  } catch {
    // rewrite
  }
  writeFileSync(meta.path, next, { encoding: 'utf8', mode: 0o755 })
  chmodSync(meta.path, 0o755)
}

export async function installCli(): Promise<CliStatus> {
  if (process.platform === 'win32') {
    return { ...(await getCliStatus()), error: t('cli.winUnsupported') }
  }

  const meta = readMeta()
  const preferred = meta.preferredLocation

  try {
    writeLauncher(preferred, meta.path)
    return await getCliStatus()
  } catch (error) {
    // /usr/local/bin is often root-owned — fall back to the user bin automatically.
    if (preferred === '/usr/local/bin' && isAccessError(error)) {
      try {
        writeLauncher('~/.local/bin', meta.path)
        return {
          ...(await getCliStatus()),
          notice: t('cli.fellBackToLocal')
        }
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        return {
          ...(await getCliStatus()),
          error: t('cli.installFailed', {
            dir: expandLocation('~/.local/bin'),
            message
          })
        }
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      ...(await getCliStatus()),
      error: t('cli.installFailed', { dir: expandLocation(preferred), message })
    }
  }
}

export async function uninstallCli(): Promise<CliStatus> {
  const meta = readMeta()
  const target = meta.path ?? binaryPath(meta.preferredLocation)
  try {
    const dir = target ? dirname(target) : expandLocation(meta.preferredLocation)
    for (const name of CLI_BIN_NAMES) {
      const file = join(dir, name)
      if (existsSync(file)) unlinkSync(file)
    }
    writeMeta({
      preferredLocation: meta.preferredLocation,
      path: null,
      installedAt: null
    })
    return await getCliStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...(await getCliStatus()), error: t('cli.uninstallFailed', { message }) }
  }
}

/**
 * Pull the CLI workdir out of argv.
 * Prefer `--vav-workdir=/abs/path` (one token). Keep legacy `--cli-workdir <path>`.
 */
export function parseCliWorkdir(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith('--vav-workdir=')) {
      return arg.slice('--vav-workdir='.length) || null
    }
  }
  const vavIdx = argv.indexOf('--vav-workdir')
  if (vavIdx >= 0 && argv[vavIdx + 1] && !argv[vavIdx + 1].startsWith('-')) {
    return argv[vavIdx + 1]
  }
  const legacy = argv.indexOf('--cli-workdir')
  if (legacy >= 0 && argv[legacy + 1] && !argv[legacy + 1].startsWith('-')) {
    return argv[legacy + 1]
  }
  return null
}

export function argvRequestsCliOpen(argv: string[]): boolean {
  return (
    argv.some((arg) => arg === '--vav-workdir' || arg.startsWith('--vav-workdir=')) ||
    argv.includes('--cli-workdir')
  )
}

export interface OpenTarget {
  workdir: string | null
  attachments: string[]
}

export type ResolvedOpen =
  | { kind: 'preview'; file: string }
  | { kind: 'session'; workdir: string | null; attachments: string[] }

/**
 * Map dropped / opened filesystem paths (README §2.5 / file-preview.rpml):
 *
 * - Single file → File Preview window
 * - Folder(s) only → new session with that folder as workdir
 * - Multiple files → new session (parent of first file) + composer attachments
 */
export function resolveOpenPaths(paths: string[]): OpenTarget {
  const resolved = classifyOpenPaths(paths)
  if (resolved.kind === 'preview') {
    return { workdir: dirname(resolved.file), attachments: [resolved.file] }
  }
  return { workdir: resolved.workdir, attachments: resolved.attachments }
}

/** Same classification, but preserves the single-file → preview intent. */
export function classifyOpenPaths(paths: string[]): ResolvedOpen {
  const dirs: string[] = []
  const files: string[] = []
  for (const path of paths) {
    if (!path) continue
    try {
      if (!existsSync(path)) continue
      const full = realpathSync(path)
      if (statSync(full).isDirectory()) dirs.push(full)
      else files.push(full)
    } catch {
      // Skip unreadable paths.
    }
  }
  if (files.length === 0 && dirs.length === 0) {
    return { kind: 'session', workdir: null, attachments: [] }
  }
  if (files.length === 1 && dirs.length === 0) {
    return { kind: 'preview', file: files[0]! }
  }
  if (files.length > 0) {
    return { kind: 'session', workdir: dirname(files[0]!), attachments: files }
  }
  return { kind: 'session', workdir: dirs[0] ?? null, attachments: [] }
}

/**
 * Absolute paths in argv that look like user-opened files.
 * macOS: Dock / Finder cold-start. Windows: "Open with" / double-click via ProgId.
 */
export function parseOpenPathsFromArgv(argv: string[]): string[] {
  const out: string[] = []
  const exe = process.execPath.replace(/\//g, '\\').toLowerCase()
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    const normalized = arg.replace(/\//g, '\\')
    const lower = normalized.toLowerCase()
    // Electron/Chromium internals and the app executable itself are never drop targets.
    if (
      lower === exe ||
      arg.includes('Electron') ||
      arg.endsWith('.app') ||
      lower.includes('node_modules\\electron') ||
      lower.includes('node_modules/electron') ||
      arg.includes('/Contents/MacOS/') ||
      arg.includes('/MacOS/Electron') ||
      (lower.endsWith('.exe') && (lower.includes('\\electron.exe') || lower.endsWith('\\vav.exe')))
    ) {
      continue
    }
    const isAbs =
      arg.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(arg) ||
      arg.startsWith('\\\\')
    if (!isAbs) continue
    try {
      if (existsSync(arg)) out.push(arg)
    } catch {
      // skip
    }
  }
  return out
}
