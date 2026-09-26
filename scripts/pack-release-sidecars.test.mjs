import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { packageVersion } from './release-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('pack-release-sidecars accepts a relative --out (CI cwd)', async () => {
  const rel = `release-sidecars-rel-${process.pid}`
  const out = join(root, rel)
  const dir = mkdtempSync(join(tmpdir(), 'vav-server-sidecar-pkg-'))
  try {
    const packed = spawnSync(
      process.execPath,
      [join(root, 'scripts/pack-release-sidecars.mjs'), '--out', rel, '--dir', dir],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(packed.status, 0, packed.stderr || packed.stdout)
    const version = packageVersion()
    assert.ok(existsSync(join(out, `21stware-vav-server-${version}.tgz`)))
    assert.ok(!existsSync(join(out, `vav-chrome-extension-${version}.zip`)))
  } finally {
    rmSync(out, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pack-release-sidecars writes the npm tarball', async () => {
  const out = mkdtempSync(join(tmpdir(), 'vav-sidecars-'))
  const dir = mkdtempSync(join(tmpdir(), 'vav-server-sidecar-pkg-'))
  try {
    const packed = spawnSync(
      process.execPath,
      [join(root, 'scripts/pack-release-sidecars.mjs'), '--out', out, '--dir', dir],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(packed.status, 0, packed.stderr || packed.stdout)
    const version = packageVersion()
    assert.ok(existsSync(join(out, `21stware-vav-server-${version}.tgz`)))
  } finally {
    rmSync(out, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
