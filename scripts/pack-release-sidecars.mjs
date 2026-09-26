/**
 * Build the GitHub Release sidecar that is not an electron-builder artifact:
 * the @21stware/vav-server npm tarball.
 *
 *   node scripts/pack-release-sidecars.mjs --out /tmp/sidecars
 */
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packageVersion } from './release-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const outDir = resolve(argValue('--out', join(root, 'release')))
mkdirSync(outDir, { recursive: true })
const pkgDir = resolve(argValue('--dir') || join(root, 'packages', 'vav-server'))

const pack = spawnSync(
  process.execPath,
  [join(root, 'scripts/pack-vav-server.mjs'), '--dir', pkgDir],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VAV_PACK_QUIET: '1' }
  }
)
if (pack.status !== 0) process.exit(pack.status ?? 1)
const packed = spawnSync('npm', ['pack', '--pack-destination', outDir], {
  cwd: pkgDir,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (packed.status !== 0) process.exit(packed.status ?? 1)

const version = packageVersion(root)
console.log(`[pack-release-sidecars] ${outDir}/21stware-vav-server-${version}.tgz`)
