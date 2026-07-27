import { app } from 'electron'
import { execFileSync } from 'node:child_process'
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
import { APP_NAME } from './brand'
import { t } from './i18n'

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

function binaryPath(location: CliInstallLocation): string {
  return join(expandLocation(location), APP_NAME)
}

/**
 * GUI apps inherit a stripped PATH from launchd, so `process.env.PATH` often
 * omits `/usr/local/bin` even when every terminal has it. Ask the login shell.
 */
function loginPathDirs(): string[] {
  if (cachedLoginPathDirs) return cachedLoginPathDirs
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  try {
    const out = execFileSync(shell, ['-ilc', 'printenv PATH'], {
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
      .trim()
      .split('\n')
      .at(-1)
    cachedLoginPathDirs = (out ?? '')
      .split(':')
      .map((part) => part.trim())
      .filter(Boolean)
  } catch {
    cachedLoginPathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  }
  return cachedLoginPathDirs
}

function pathEnvHas(dir: string): boolean {
  return loginPathDirs().includes(dir)
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
  'If vav is already running, the session is added and focused.',
  'The command returns immediately — vav opens in the background.',
  ''
].join('\n')

/** Packaged macOS: …/vav.app/Contents/MacOS/vav → …/vav.app */
function packagedAppBundlePath(): string {
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

function launcherScript(): string {
  const helpBlock = [
    'case "$1" in',
    '  -h|--help)',
    '    cat <<\'EOF\'',
    CLI_HELP + 'EOF',
    '    exit 0',
    '    ;;',
    'esac'
  ]

  // Resolve "." / relative paths in the *shell* cwd before handing off to the GUI app.
  // Use a single argv token (`--vav-workdir=…`) so Chromium cannot swallow the path
  // as a separate flag value.
  const resolveTarget = [
    'TARGET="$1"',
    'case "$TARGET" in',
    '  .) TARGET="$(pwd -P)" ;;',
    '  /*) TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P || echo "$TARGET")" ;;',
    '  *) TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P || echo "$TARGET")" ;;',
    'esac'
  ]

  if (app.isPackaged && process.platform === 'darwin') {
    // `open -n` always starts a process so requestSingleInstanceLock can forward argv
    // to the running instance (plain `open` often just activates and drops --args).
    const bundle = packagedAppBundlePath()
    return [
      '#!/bin/sh',
      'set -e',
      `APP=${JSON.stringify(bundle)}`,
      ...helpBlock,
      'if [ "$#" -eq 0 ]; then',
      '  open -n "$APP"',
      '  exit 0',
      'fi',
      ...resolveTarget,
      'open -n "$APP" --args --vav-workdir="$TARGET"',
      ''
    ].join('\n')
  }

  if (app.isPackaged) {
    const bin = process.execPath
    return [
      '#!/bin/sh',
      'set -e',
      `BIN=${JSON.stringify(bin)}`,
      ...helpBlock,
      'if [ "$#" -eq 0 ]; then',
      '  nohup "$BIN" >/dev/null 2>&1 &',
      '  exit 0',
      'fi',
      ...resolveTarget,
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
    ...helpBlock,
    'if [ "$#" -eq 0 ]; then',
    '  nohup "$ELECTRON" "$APP" >/dev/null 2>&1 &',
    '  exit 0',
    'fi',
    ...resolveTarget,
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

export function getCliStatus(): CliStatus {
  if (process.platform === 'win32') {
    return {
      installed: false,
      path: null,
      preferredLocation: DEFAULT_LOCATION,
      pathInPath: false,
      version: null,
      installedAt: null,
      error: t('cli.winUnsupported')
    }
  }

  const meta = readMeta()
  const candidate = meta.path ?? binaryPath(meta.preferredLocation)
  const installed = !!(candidate && existsSync(candidate))
  let installedAt = meta.installedAt
  if (installed && !installedAt) {
    try {
      installedAt = Math.round(statSync(candidate).mtimeMs)
    } catch {
      installedAt = null
    }
  }

  const locationDir = installed && candidate
    ? dirname(candidate)
    : expandLocation(meta.preferredLocation)

  return {
    installed,
    path: installed ? candidate : null,
    preferredLocation: meta.preferredLocation,
    pathInPath: pathEnvHas(locationDir),
    version: installed ? app.getVersion() : null,
    installedAt
  }
}

export function setCliPreferredLocation(location: CliInstallLocation): CliStatus {
  const meta = readMeta()
  writeMeta({ ...meta, preferredLocation: location })
  return getCliStatus()
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
  }
  writeFileSync(target, launcherScript(), { encoding: 'utf8', mode: 0o755 })
  chmodSync(target, 0o755)
  writeMeta({
    preferredLocation: location,
    path: target,
    installedAt: Date.now()
  })
  return target
}

export function installCli(): CliStatus {
  if (process.platform === 'win32') {
    return { ...getCliStatus(), error: t('cli.winUnsupported') }
  }

  const meta = readMeta()
  const preferred = meta.preferredLocation

  try {
    writeLauncher(preferred, meta.path)
    return getCliStatus()
  } catch (error) {
    // /usr/local/bin is often root-owned — fall back to the user bin automatically.
    if (preferred === '/usr/local/bin' && isAccessError(error)) {
      try {
        writeLauncher('~/.local/bin', meta.path)
        return {
          ...getCliStatus(),
          notice: t('cli.fellBackToLocal')
        }
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        return {
          ...getCliStatus(),
          error: t('cli.installFailed', {
            dir: expandLocation('~/.local/bin'),
            message
          })
        }
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      ...getCliStatus(),
      error: t('cli.installFailed', { dir: expandLocation(preferred), message })
    }
  }
}

export function uninstallCli(): CliStatus {
  const meta = readMeta()
  const target = meta.path ?? binaryPath(meta.preferredLocation)
  try {
    if (target && existsSync(target)) unlinkSync(target)
    writeMeta({
      preferredLocation: meta.preferredLocation,
      path: null,
      installedAt: null
    })
    return getCliStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...getCliStatus(), error: t('cli.uninstallFailed', { message }) }
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

/**
 * Map dropped / opened filesystem paths to a session workdir + optional file
 * attachments — same rules as Dock drop and `vav <path>` (README §2.5 / §5.17).
 *
 * - Folder(s) only → workdir = first folder, no attachments
 * - File(s) → workdir = parent of the first file, those files as attachments
 */
export function resolveOpenPaths(paths: string[]): OpenTarget {
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
  if (files.length === 0 && dirs.length === 0) return { workdir: null, attachments: [] }

  if (files.length > 0) {
    return { workdir: dirname(files[0]), attachments: files }
  }
  return { workdir: dirs[0] ?? null, attachments: [] }
}

/** Absolute paths in argv that look like user-opened files (Dock cold-start). */
export function parseOpenPathsFromArgv(argv: string[]): string[] {
  const out: string[] = []
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    // Electron/Chromium internals and the app path itself are never drop targets.
    if (arg.includes('Electron') || arg.endsWith('.app') || arg.includes('node_modules/electron')) {
      continue
    }
    if (arg.startsWith('/') && existsSync(arg)) out.push(arg)
  }
  return out
}
