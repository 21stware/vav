import { app } from 'electron'
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
}

const LOCATION_KEY = 'cliInstallLocation'
const PATH_KEY = 'cliInstallPath'
const INSTALLED_AT_KEY = 'cliInstalledAt'

function expandLocation(location: CliInstallLocation): string {
  if (location === '~/.local/bin') return join(homedir(), '.local', 'bin')
  return '/usr/local/bin'
}

function binaryPath(location: CliInstallLocation): string {
  return join(expandLocation(location), APP_NAME)
}

function pathEnvHas(dir: string): boolean {
  const path = process.env.PATH ?? ''
  return path.split(':').includes(dir)
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
      return { preferredLocation: '/usr/local/bin', path: null, installedAt: null }
    }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const preferred =
      raw[LOCATION_KEY] === '~/.local/bin' ? '~/.local/bin' : '/usr/local/bin'
    return {
      preferredLocation: preferred,
      path: typeof raw[PATH_KEY] === 'string' ? raw[PATH_KEY] : null,
      installedAt: typeof raw[INSTALLED_AT_KEY] === 'number' ? raw[INSTALLED_AT_KEY] : null
    }
  } catch {
    return { preferredLocation: '/usr/local/bin', path: null, installedAt: null }
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
      preferredLocation: '/usr/local/bin',
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

  return {
    installed,
    path: installed ? candidate : null,
    preferredLocation: meta.preferredLocation,
    pathInPath: pathEnvHas(expandLocation(meta.preferredLocation)),
    version: installed ? app.getVersion() : null,
    installedAt
  }
}

export function setCliPreferredLocation(location: CliInstallLocation): CliStatus {
  const meta = readMeta()
  writeMeta({ ...meta, preferredLocation: location })
  return getCliStatus()
}

export function installCli(): CliStatus {
  if (process.platform === 'win32') {
    return { ...getCliStatus(), error: t('cli.winUnsupported') }
  }

  const meta = readMeta()
  const dir = expandLocation(meta.preferredLocation)
  const target = binaryPath(meta.preferredLocation)

  try {
    mkdirSync(dir, { recursive: true })
    // Moving install location: remove the previous binary first.
    if (meta.path && meta.path !== target && existsSync(meta.path)) {
      try {
        unlinkSync(meta.path)
      } catch {
        // Best-effort; the new install still proceeds.
      }
    }
    writeFileSync(target, launcherScript(), { encoding: 'utf8', mode: 0o755 })
    chmodSync(target, 0o755)
    writeMeta({
      preferredLocation: meta.preferredLocation,
      path: target,
      installedAt: Date.now()
    })
    return getCliStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...getCliStatus(),
      error: t('cli.installFailed', { dir, message })
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
