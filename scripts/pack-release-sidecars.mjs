/**
 * Build the GitHub Release sidecars that are not electron-builder artifacts:
 * the @21stware/vavd npm tarball and the unpacked Chrome extension zip.
 *
 *   node scripts/pack-release-sidecars.mjs --out /tmp/sidecars
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { packageVersion } from './release-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const outDir = resolve(argValue('--out', join(root, 'release')))
mkdirSync(outDir, { recursive: true })
const pkgDir = resolve(argValue('--dir') || join(root, 'packages', 'vavd'))

const pack = spawnSync(
  process.execPath,
  [join(root, 'scripts/pack-vavd.mjs'), '--dir', pkgDir],
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
  // Windows resolves `npm.cmd` only through the shell.
  shell: process.platform === 'win32'
})
if (packed.status !== 0) process.exit(packed.status ?? 1)

const version = packageVersion(root)
const JSZip = require('jszip')
const zip = new JSZip()
const extDir = join(root, 'extension')
for (const name of ['manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.js']) {
  zip.file(name, readFileSync(join(extDir, name)))
}
const zipName = `vav-chrome-extension-${version}.zip`
writeFileSync(join(outDir, zipName), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`[pack-release-sidecars] ${outDir}/21stware-vavd-${version}.tgz`)
console.log(`[pack-release-sidecars] ${outDir}/${zipName}`)
