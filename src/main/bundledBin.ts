/**
 * Resolve VAV-bundled helper binaries (extraResources → Resources/bin).
 *
 * Dev:   <repo>/resources/bin
 * Packaged: process.resourcesPath/bin
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let cachedDir: string | null | undefined

function officecliName(): string {
  return process.platform === 'win32' ? 'officecli.exe' : 'officecli'
}

function appPathSafe(): string | null {
  try {
    return app.getAppPath()
  } catch {
    return null
  }
}

/** Absolute path to the bundled `bin` directory, or null if missing. */
export function bundledBinDir(): string | null {
  if (cachedDir !== undefined) return cachedDir
  const appPath = appPathSafe()
  const candidates = [
    typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin') : '',
    appPath ? join(appPath, 'resources', 'bin') : '',
    appPath ? join(appPath, '..', 'resources', 'bin') : '',
    join(__dirname, '../../resources/bin'),
    join(__dirname, '../../../resources/bin'),
    join(process.cwd(), 'resources', 'bin')
  ].filter(Boolean)
  const name = officecliName()
  const hit = candidates.find((p) => existsSync(join(p, name)))
  cachedDir = hit ?? null
  return cachedDir
}

/** Absolute path to the bundled officecli executable, or null. */
export function bundledOfficeCliPath(): string | null {
  const dir = bundledBinDir()
  if (!dir) return null
  const exe = join(dir, officecliName())
  return existsSync(exe) ? exe : null
}

/** Drop cache (tests / after fetch mid-session). */
export function clearBundledBinCache(): void {
  cachedDir = undefined
}
