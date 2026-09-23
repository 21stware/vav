import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  cpSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { APP_PATHS_POINTER_FILE, type AppPathOverrides, type AppPathSnapshot } from '../../shared/appPaths.ts'

/** Chromium / cache noise — never copy these when relocating app data. */
const SKIP_COPY_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'CachedData',
  'CachedExtensionV2',
  'blob_storage',
  'Session Storage',
  'Local Storage',
  'Service Worker',
  'IndexedDB',
  'WebStorage',
  'Shared Dictionary',
  'Cookies',
  'Cookies-journal',
  'Network Persistent State',
  'TransportSecurity',
  'Local State',
  'Preferences',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile',
  APP_PATHS_POINTER_FILE
])

export function defaultAppDataDir(home = homedir()): string {
  return join(home, '.vav')
}

export function defaultTempDir(): string {
  return tmpdir()
}

export function appPathsPointerFile(legacyUserDataDir: string): string {
  return join(legacyUserDataDir, APP_PATHS_POINTER_FILE)
}

export function expandUserPath(raw: string, home = homedir()): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed === '~') return home
  if (trimmed.startsWith('~/')) return join(home, trimmed.slice(2))
  return trimmed
}

export function sameResolvedPath(a: string, b: string): boolean {
  if (!a || !b) return false
  try {
    return resolve(a) === resolve(b)
  } catch {
    return a === b
  }
}

export function hasExistingAppData(dir: string): boolean {
  if (!dir || !existsSync(dir)) return false
  return (
    existsSync(join(dir, 'settings.json')) ||
    existsSync(join(dir, 'conversations')) ||
    existsSync(join(dir, 'vav-server'))
  )
}

export function readAppPathOverrides(legacyUserDataDir: string): AppPathOverrides {
  const file = appPathsPointerFile(legacyUserDataDir)
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    return {
      appDataDir: typeof raw.appDataDir === 'string' ? raw.appDataDir : '',
      tempDir: typeof raw.tempDir === 'string' ? raw.tempDir : ''
    }
  } catch {
    return {}
  }
}

export function writeAppPathOverrides(
  legacyUserDataDir: string,
  patch: AppPathOverrides
): AppPathOverrides {
  const current = readAppPathOverrides(legacyUserDataDir)
  const next: AppPathOverrides = {
    appDataDir: patch.appDataDir !== undefined ? patch.appDataDir.trim() : (current.appDataDir ?? ''),
    tempDir: patch.tempDir !== undefined ? patch.tempDir.trim() : (current.tempDir ?? '')
  }
  mkdirSync(legacyUserDataDir, { recursive: true })
  writeFileSync(appPathsPointerFile(legacyUserDataDir), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/**
 * Auto-detect when the user has never chosen a folder:
 * keep an existing Application Support tree, otherwise use `~/.vav`.
 * An explicit pointer always wins. Dev builds pass `preferLegacyWhenEmpty`
 * so they never share `~/.vav` with the release app.
 */
export function resolveAppDataDir(opts: {
  overrides: AppPathOverrides
  legacyDir: string
  home?: string
  preferLegacyWhenEmpty?: boolean
}): string {
  const configured = expandUserPath(opts.overrides.appDataDir ?? '', opts.home)
  if (configured) return resolve(configured)
  if (hasExistingAppData(opts.legacyDir) || opts.preferLegacyWhenEmpty) {
    return resolve(opts.legacyDir)
  }
  return resolve(defaultAppDataDir(opts.home))
}

export function resolveTempDir(opts: { overrides: AppPathOverrides; home?: string }): string {
  const configured = expandUserPath(opts.overrides.tempDir ?? '', opts.home)
  if (configured) return resolve(configured)
  return defaultTempDir()
}

/** Directory whose size we report for a temp root (our `vav*` prefix under system tmp). */
export function tempUsageRoot(effectiveTempDir: string, isCustom: boolean): string {
  if (isCustom) return effectiveTempDir
  return join(effectiveTempDir, 'vav')
}

export function directorySizeBytes(
  root: string,
  maxEntries = 50_000,
  skipNames: ReadonlySet<string> = new Set()
): number {
  if (!root || !existsSync(root)) return 0
  let total = 0
  let seen = 0
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (seen >= maxEntries) return
      if (skipNames.has(entry.name)) continue
      seen += 1
      const path = join(dir, entry.name)
      try {
        if (entry.isDirectory()) walk(path)
        else if (entry.isFile() || entry.isSymbolicLink()) total += statSync(path).size
      } catch {
        /* skip unreadable */
      }
    }
  }
  walk(root)
  return total
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Copy conversations / settings / other app files into an empty destination.
 * Leaves Chromium caches behind. No-op when dest already looks like VAV data.
 */
export function copyAppDataIfEmpty(source: string, dest: string): { copied: boolean } {
  if (!source || !dest || sameResolvedPath(source, dest)) return { copied: false }
  if (!existsSync(source)) return { copied: false }
  ensureDir(dest)
  if (hasExistingAppData(dest)) return { copied: false }
  let entries
  try {
    entries = readdirSync(source, { withFileTypes: true })
  } catch {
    return { copied: false }
  }
  for (const entry of entries) {
    if (SKIP_COPY_NAMES.has(entry.name)) continue
    const from = join(source, entry.name)
    const to = join(dest, entry.name)
    try {
      cpSync(from, to, { recursive: true, force: false, dereference: false })
    } catch {
      /* skip locked / unreadable */
    }
  }
  return { copied: true }
}

export function buildAppPathSnapshot(opts: {
  overrides: AppPathOverrides
  legacyDir: string
  currentUserDataDir: string
  home?: string
  preferLegacyWhenEmpty?: boolean
}): AppPathSnapshot {
  const defaultApp = defaultAppDataDir(opts.home)
  const defaultTmp = defaultTempDir()
  const effectiveApp = resolveAppDataDir({
    overrides: opts.overrides,
    legacyDir: opts.legacyDir,
    home: opts.home,
    preferLegacyWhenEmpty: opts.preferLegacyWhenEmpty
  })
  const configuredTemp = expandUserPath(opts.overrides.tempDir ?? '', opts.home)
  const effectiveTmp = configuredTemp ? resolve(configuredTemp) : defaultTmp
  const tempIsCustom = Boolean(configuredTemp)
  return {
    appDataDir: expandUserPath(opts.overrides.appDataDir ?? '', opts.home),
    defaultAppDataDir: defaultApp,
    effectiveAppDataDir: effectiveApp,
    appDataBytes: directorySizeBytes(effectiveApp, 50_000, SKIP_COPY_NAMES),
    tempDir: configuredTemp,
    defaultTempDir: defaultTmp,
    effectiveTempDir: effectiveTmp,
    tempBytes: directorySizeBytes(tempUsageRoot(effectiveTmp, tempIsCustom)),
    tempIsCustom,
    restartRequired: !sameResolvedPath(effectiveApp, opts.currentUserDataDir)
  }
}

