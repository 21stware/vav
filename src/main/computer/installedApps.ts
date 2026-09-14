/**
 * Local installed-app scan so @-mention / computer_list still see system apps
 * when cua-driver list_apps is truncated, wrapped, or only returns running apps.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ComputerApp } from '../../shared/computerUse.ts'

/** Standard macOS launchers, including the cryptex volume Safari lives on. */
const MAC_APP_ROOTS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  '/System/Cryptexes/App/System/Applications'
]

export function macInstalledAppRoots(home = homedir()): string[] {
  return [...MAC_APP_ROOTS, join(home, 'Applications')]
}

function plistString(xml: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`)
  const match = re.exec(xml)
  const value = match?.[1]?.trim() ?? ''
  return value && !value.includes('$') ? value : null
}

function readAppMeta(appPath: string): { name: string | null; bundleId: string | null } {
  const info = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(info)) return { name: null, bundleId: null }
  let text = ''
  try {
    text = readFileSync(info, 'utf8')
  } catch {
    return { name: null, bundleId: null }
  }
  if (!text.includes('<key>')) return { name: null, bundleId: null }
  return {
    name: plistString(text, 'CFBundleDisplayName') ?? plistString(text, 'CFBundleName'),
    bundleId: plistString(text, 'CFBundleIdentifier')
  }
}

/**
 * Enumerate `.app` bundles under the given roots (or the macOS defaults).
 * Pass `roots` in tests; on non-darwin the default roots are empty.
 */
export function scanInstalledDesktopApps(roots?: string[]): ComputerApp[] {
  const dirs = roots ?? (process.platform === 'darwin' ? macInstalledAppRoots() : [])
  const byKey = new Map<string, ComputerApp>()
  for (const root of dirs) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue
      const appPath = join(root, entry)
      try {
        if (!statSync(appPath).isDirectory()) continue
      } catch {
        continue
      }
      const folderName = basename(entry, '.app')
      const meta = readAppMeta(appPath)
      const name = meta.name ?? folderName
      const bundleId = meta.bundleId
      const key = bundleId ?? name.toLowerCase()
      if (!byKey.has(key)) byKey.set(key, { name, bundleId, pid: null })
    }
  }
  return [...byKey.values()]
}
