#!/usr/bin/env node
/**
 * Pack and publish @21stware/vavd from packages/vavd only.
 * Never publish from the repo root (that would ship the Electron app as `vav`).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages', 'vavd')
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
if (pkg.name !== '@21stware/vavd') {
  console.error(`[publish-vavd] refusing unexpected name ${pkg.name}`)
  process.exit(1)
}

const pack = spawnSync(process.execPath, [join(root, 'scripts/pack-vavd.mjs')], {
  cwd: root,
  stdio: 'inherit'
})
if (pack.status !== 0) process.exit(pack.status ?? 1)

const extra = process.argv.slice(2)
const pub = spawnSync('npm', ['publish', '--access', 'public', ...extra], {
  cwd: pkgDir,
  stdio: 'inherit',
  shell: false
})
process.exit(pub.status ?? 1)
