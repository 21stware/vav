import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type SpecialFolderKind = 'home' | 'icloud' | 'cloudDisk'

export type SpecialFolderResult = {
  kind: SpecialFolderKind
  path: string | null
  available: boolean
}

/** iCloud Drive documents root on macOS. Missing when iCloud Drive is off. */
export function icloudDrivePath(home = homedir()): string {
  return join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
}

export function resolveSpecialFolder(
  kind: SpecialFolderKind,
  home = homedir()
): SpecialFolderResult {
  if (kind === 'home') {
    return { kind, path: home, available: Boolean(home) }
  }
  if (kind === 'icloud') {
    const path = icloudDrivePath(home)
    return { kind, path, available: existsSync(path) }
  }
  return { kind: 'cloudDisk', path: null, available: false }
}
