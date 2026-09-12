import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bundledBinDir, clearBundledBinCache } from '../bundledBin.ts'

export function cuaDriverName(): string {
  return process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
}

/** Absolute path to the bundled cua-driver executable, or null. */
export function bundledCuaDriverPath(): string | null {
  const dir = bundledBinDir()
  if (!dir) return null
  const exe = join(dir, cuaDriverName())
  return existsSync(exe) ? exe : null
}

export { clearBundledBinCache }
