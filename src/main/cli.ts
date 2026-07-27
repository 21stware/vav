import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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

function launcherScript(): string {
  if (app.isPackaged) {
    const bin = process.execPath
    return [
      '#!/bin/sh',
      'set -e',
      `BIN=${JSON.stringify(bin)}`,
      'if [ "$#" -eq 0 ]; then',
      '  nohup "$BIN" >/dev/null 2>&1 &',
      '  exit 0',
      'fi',
      'TARGET="$1"',
      'case "$TARGET" in',
      '  .) TARGET="$(pwd)" ;;',
      '  /*) ;;',
      '  *) TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")" ;;',
      'esac',
      'nohup "$BIN" --cli-workdir "$TARGET" >/dev/null 2>&1 &',
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
    'if [ "$#" -eq 0 ]; then',
    '  nohup "$ELECTRON" "$APP" >/dev/null 2>&1 &',
    '  exit 0',
    'fi',
    'TARGET="$1"',
    'case "$TARGET" in',
    '  .) TARGET="$(pwd)" ;;',
    '  /*) ;;',
    '  *) TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")" ;;',
    'esac',
    'nohup "$ELECTRON" "$APP" --cli-workdir "$TARGET" >/dev/null 2>&1 &',
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

/** Pull `--cli-workdir <path>` out of Electron argv. */
export function parseCliWorkdir(argv: string[]): string | null {
  const index = argv.indexOf('--cli-workdir')
  if (index >= 0 && argv[index + 1]) return argv[index + 1]
  return null
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
  const existing = paths.filter((path) => path && existsSync(path))
  if (existing.length === 0) return { workdir: null, attachments: [] }

  const dirs: string[] = []
  const files: string[] = []
  for (const path of existing) {
    try {
      if (statSync(path).isDirectory()) dirs.push(path)
      else files.push(path)
    } catch {
      // Skip unreadable paths.
    }
  }

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
