import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  missingReleaseAssets,
  packageVersion,
  requiredReleaseAssets
} from './release-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('extension and vavd package versions match the app', () => {
  const version = packageVersion()
  const extension = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))
  const vavd = JSON.parse(readFileSync(join(root, 'packages/vavd/package.json'), 'utf8'))
  assert.equal(extension.version, version)
  assert.equal(vavd.version, version)
})

test('every release lists desktop installers, updater feeds, vavd, and the Chrome extension', () => {
  const version = '1.2.3'
  const names = requiredReleaseAssets(version)
  assert.deepEqual(names, [
    'VAV-1.2.3-macos-arm64.dmg',
    'VAV-1.2.3-macos-arm64.zip',
    'VAV-1.2.3-macos-arm64.zip.blockmap',
    'latest-mac.yml',
    'VAV-1.2.3-windows-x64-setup.exe',
    'VAV-1.2.3-windows-x64-setup.exe.blockmap',
    'latest.yml',
    '21stware-vavd-1.2.3.tgz',
    'vav-chrome-extension-1.2.3.zip'
  ])
  assert.equal(packageVersion().split('.').length, 3)
})

test('missingReleaseAssets reports only the absent files', () => {
  const dir = join(tmpdir(), `vav-release-assets-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(join(dir, 'latest.yml'), 'x\n')
    const missing = missingReleaseAssets(dir, '9.9.9')
    assert.ok(missing.includes('VAV-9.9.9-macos-arm64.dmg'))
    assert.ok(missing.includes('21stware-vavd-9.9.9.tgz'))
    assert.ok(missing.includes('vav-chrome-extension-9.9.9.zip'))
    assert.ok(!missing.includes('latest.yml'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
