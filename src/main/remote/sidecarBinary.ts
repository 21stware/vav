import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Bundled sidecar: resources/bin in dev, Resources/bin when packaged. */
export function resolveSidecarBinary(): string | null {
  const name = process.platform === 'win32' ? 'tailcatbridge.exe' : 'tailcatbridge'
  const candidates = [
    typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', name) : '',
    join(app.getAppPath(), 'resources', 'bin', name),
    join(process.cwd(), 'resources', 'bin', name)
  ].filter(Boolean)
  return candidates.find((path) => existsSync(path)) ?? null
}
