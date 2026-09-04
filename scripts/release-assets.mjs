/**
 * Canonical GitHub Release asset names for a VAV version.
 * The release workflow must publish every name in this list.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function packageVersion(from = root) {
  return JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version
}

/** Files every `v*` GitHub Release must contain (installers + sidecars). */
export function requiredReleaseAssets(version) {
  return [
    `VAV-${version}-macos-arm64.dmg`,
    `VAV-${version}-macos-arm64.zip`,
    `VAV-${version}-macos-arm64.zip.blockmap`,
    'latest-mac.yml',
    `VAV-${version}-windows-x64-setup.exe`,
    `VAV-${version}-windows-x64-setup.exe.blockmap`,
    'latest.yml',
    `21stware-vavd-${version}.tgz`,
    `vav-chrome-extension-${version}.zip`
  ]
}

export function missingReleaseAssets(dir, version = packageVersion()) {
  const have = new Set(readdirSync(dir))
  return requiredReleaseAssets(version).filter((name) => !have.has(name))
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invoked && process.argv[2] === 'verify') {
  const dir = process.argv[3]
  if (!dir) {
    console.error('usage: node scripts/release-assets.mjs verify <dir>')
    process.exit(1)
  }
  const missing = missingReleaseAssets(dir)
  if (missing.length) {
    console.error(`missing release assets in ${dir}:\n${missing.map((n) => `  ${n}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`release assets ok (${requiredReleaseAssets(packageVersion()).length})`)
}
