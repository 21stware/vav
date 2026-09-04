import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { packageVersion } from './release-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

test('pack-release-sidecars accepts a relative --out (CI cwd)', async () => {
  const rel = `release-sidecars-rel-${process.pid}`
  const out = join(root, rel)
  try {
    const packed = spawnSync(
      process.execPath,
      [join(root, 'scripts/pack-release-sidecars.mjs'), '--out', rel],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(packed.status, 0, packed.stderr || packed.stdout)
    const version = packageVersion()
    assert.ok(existsSync(join(out, `21stware-vavd-${version}.tgz`)))
    assert.ok(existsSync(join(out, `vav-chrome-extension-${version}.zip`)))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('pack-release-sidecars writes the npm tarball and Chrome extension zip', async () => {
  const out = mkdtempSync(join(tmpdir(), 'vav-sidecars-'))
  try {
    const packed = spawnSync(
      process.execPath,
      [join(root, 'scripts/pack-release-sidecars.mjs'), '--out', out],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(packed.status, 0, packed.stderr || packed.stdout)

    const version = packageVersion()
    const tgz = join(out, `21stware-vavd-${version}.tgz`)
    const zipPath = join(out, `vav-chrome-extension-${version}.zip`)
    assert.ok(existsSync(tgz), `missing ${tgz}`)
    assert.ok(existsSync(zipPath), `missing ${zipPath}`)

    const JSZip = require('jszip')
    const zip = await JSZip.loadAsync(readFileSync(zipPath))
    for (const name of ['manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.js']) {
      assert.ok(zip.file(name), `extension zip missing ${name}`)
    }
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
    assert.equal(manifest.version, version)
    assert.equal(manifest.manifest_version, 3)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
