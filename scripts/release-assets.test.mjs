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

test('extension and every product package version match the app', () => {
  const version = packageVersion()
  const extension = JSON.parse(readFileSync(join(root, 'packages/vav-chrome-extension/extension/manifest.json'), 'utf8'))
  assert.equal(extension.version, version)
  for (const dir of [
    'vav-server',
    'vav-desktop',
    'vav-tui',
    'vav-board',
    'vav-chrome-extension',
    'vav-ios',
    'vav-android'
  ]) {
    const pkg = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))
    assert.equal(pkg.version, version, dir)
    const product = JSON.parse(readFileSync(join(root, 'packages', dir, 'product.json'), 'utf8'))
    assert.equal(product.version, version, `${dir} product.json`)
  }
})

test('every release lists desktop installers, updater feeds, vav-server, and the Chrome extension', () => {
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
    '21stware-vav-server-1.2.3.tgz',
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
    assert.ok(missing.includes('21stware-vav-server-9.9.9.tgz'))
    assert.ok(missing.includes('vav-chrome-extension-9.9.9.zip'))
    assert.ok(!missing.includes('latest.yml'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
