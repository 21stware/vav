import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildAppPathSnapshot,
  copyAppDataIfEmpty,
  defaultAppDataDir,
  hasExistingAppData,
  readAppPathOverrides,
  resolveAppDataDir,
  resolveTempDir,
  writeAppPathOverrides
} from './appPaths.ts'

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('appPaths', () => {
  it('keeps the Application Support folder for isolated / dev installs', () => {
    const home = scratch('vav-paths-dev-')
    const legacy = join(home, 'Library', 'Application Support', 'vav-dev')
    mkdirSync(legacy, { recursive: true })
    const resolved = resolveAppDataDir({
      overrides: {},
      legacyDir: legacy,
      home,
      preferLegacyWhenEmpty: true
    })
    assert.equal(resolved, legacy)
  })

  it('defaults app data to ~/.vav when nothing is on disk', () => {
    const home = scratch('vav-paths-home-')
    const legacy = join(home, 'Library', 'Application Support', 'vav')
    const resolved = resolveAppDataDir({ overrides: {}, legacyDir: legacy, home })
    assert.equal(resolved, join(home, '.vav'))
    assert.equal(defaultAppDataDir(home), join(home, '.vav'))
  })

  it('keeps an existing Application Support tree until the user picks a folder', () => {
    const home = scratch('vav-paths-legacy-')
    const legacy = join(home, 'support')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'settings.json'), '{}')
    const resolved = resolveAppDataDir({ overrides: {}, legacyDir: legacy, home })
    assert.equal(resolved, legacy)
    assert.equal(hasExistingAppData(legacy), true)
  })

  it('honours an explicit app data pointer, including ~/', () => {
    const home = scratch('vav-paths-icloud-')
    const dest = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'VAV')
    const resolved = resolveAppDataDir({
      overrides: { appDataDir: '~/Library/Mobile Documents/com~apple~CloudDocs/VAV' },
      legacyDir: join(home, 'support'),
      home
    })
    assert.equal(resolved, dest)
  })

  it('defaults temp to the system tmp and accepts a custom folder', () => {
    const home = scratch('vav-paths-tmp-')
    const custom = join(home, 'my-temp')
    assert.equal(resolveTempDir({ overrides: {} }), tmpdir())
    assert.equal(resolveTempDir({ overrides: { tempDir: custom }, home }), custom)
  })

  it('round-trips the pointer file', () => {
    const dir = scratch('vav-paths-pointer-')
    assert.deepEqual(readAppPathOverrides(dir), {})
    writeAppPathOverrides(dir, { appDataDir: '/data/vav', tempDir: '/tmp/vav-custom' })
    assert.deepEqual(readAppPathOverrides(dir), {
      appDataDir: '/data/vav',
      tempDir: '/tmp/vav-custom'
    })
    writeAppPathOverrides(dir, { tempDir: '' })
    assert.deepEqual(readAppPathOverrides(dir), { appDataDir: '/data/vav', tempDir: '' })
  })

  it('copies app files into an empty destination and skips caches', () => {
    const source = scratch('vav-paths-src-')
    const dest = scratch('vav-paths-dst-')
    mkdirSync(join(source, 'conversations'), { recursive: true })
    mkdirSync(join(source, 'Cache'), { recursive: true })
    writeFileSync(join(source, 'settings.json'), '{"ok":true}')
    writeFileSync(join(source, 'Cache', 'x'), 'nope')
    writeFileSync(join(source, 'conversations', 'a.json'), '{}')
    assert.deepEqual(copyAppDataIfEmpty(source, dest), { copied: true })
    assert.equal(hasExistingAppData(dest), true)
    assert.equal(existsSync(join(dest, 'Cache')), false)
    assert.deepEqual(copyAppDataIfEmpty(source, dest), { copied: false })
  })

  it('marks restart required when the pointer disagrees with the live userData', () => {
    const home = scratch('vav-paths-snap-')
    const legacy = join(home, 'support')
    const snap = buildAppPathSnapshot({
      overrides: { appDataDir: join(home, '.vav') },
      legacyDir: legacy,
      currentUserDataDir: legacy,
      home
    })
    assert.equal(snap.effectiveAppDataDir, join(home, '.vav'))
    assert.equal(snap.restartRequired, true)
    assert.equal(snap.tempIsCustom, false)
    assert.equal(snap.defaultTempDir, tmpdir())
  })
})
