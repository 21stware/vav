import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bumpSpawnGeneration,
  filterAcpExtraArgs,
  isCurrentSpawnGeneration,
  processExitDisposition,
  recreateEphemeralCliCwd,
  shouldArmIgnoreNextExit,
  shouldDisposeHungBootstrap
} from './cliTurnLifecycle.ts'

describe('processExitDisposition', () => {
  it('seals a live turn even when skipNextExit is still armed', () => {
    assert.equal(
      processExitDisposition({
        skipNextExit: true,
        hasTurn: true,
        settling: false,
        cancelled: false
      }),
      'fail'
    )
    assert.equal(
      processExitDisposition({
        skipNextExit: true,
        hasTurn: true,
        settling: false,
        cancelled: true
      }),
      'cancel'
    )
  })

  it('defers while a same-session retry is settling', () => {
    assert.equal(
      processExitDisposition({
        skipNextExit: false,
        hasTurn: true,
        settling: true,
        cancelled: false
      }),
      'defer'
    )
  })

  it('ignores an idle replacement exit', () => {
    assert.equal(
      processExitDisposition({
        skipNextExit: true,
        hasTurn: false,
        settling: false,
        cancelled: false
      }),
      'ignore'
    )
    assert.equal(
      processExitDisposition({
        skipNextExit: false,
        hasTurn: false,
        settling: false,
        cancelled: false
      }),
      'ignore'
    )
  })
})

describe('shouldArmIgnoreNextExit', () => {
  it('does not arm a skip when dispose already swallows the exit', () => {
    assert.equal(shouldArmIgnoreNextExit(false), false)
    assert.equal(shouldArmIgnoreNextExit(true), true)
  })
})

describe('shouldDisposeHungBootstrap', () => {
  it('kills the child when Stop arrives before turn-started', () => {
    assert.equal(shouldDisposeHungBootstrap({ hasTurn: true, sawTurnStarted: false }), true)
    assert.equal(shouldDisposeHungBootstrap({ hasTurn: true, sawTurnStarted: true }), false)
    assert.equal(shouldDisposeHungBootstrap({ hasTurn: false, sawTurnStarted: false }), false)
  })
})

describe('spawn generation', () => {
  it('marks a captured generation stale after a bump', () => {
    const map = new Map<string, number>()
    const started = map.get('c1') ?? 0
    assert.equal(isCurrentSpawnGeneration(map, 'c1', started), true)
    bumpSpawnGeneration(map, 'c1')
    assert.equal(isCurrentSpawnGeneration(map, 'c1', started), false)
    assert.equal(isCurrentSpawnGeneration(map, 'c1', 1), true)
  })
})

describe('recreateEphemeralCliCwd', () => {
  it('recreates a missing minted TEMP DIR and leaves real projects alone', () => {
    const created: string[] = []
    const ephemeral = '/var/folders/sz/tmp/T/vav/9a74bd03/Workspace'
    const project = '/Users/oboo/repo/hold/vav'
    const missing = new Set([ephemeral, project])
    const io = {
      exists: (path: string) => !missing.has(path),
      mkdir: (path: string) => {
        created.push(path)
        missing.delete(path)
      }
    }
    assert.deepEqual(recreateEphemeralCliCwd(ephemeral, io), {
      cwd: ephemeral,
      recreated: true
    })
    assert.deepEqual(created, [ephemeral])
    assert.deepEqual(recreateEphemeralCliCwd(ephemeral, io), {
      cwd: ephemeral,
      recreated: false
    })
    assert.deepEqual(recreateEphemeralCliCwd(project, io), {
      cwd: project,
      recreated: false
    })
    assert.deepEqual(created, [ephemeral])
  })

  it('is a no-op for an empty cwd', () => {
    assert.deepEqual(
      recreateEphemeralCliCwd('', {
        exists: () => false,
        mkdir: () => {
          throw new Error('must not mkdir')
        }
      }),
      { cwd: '', recreated: false }
    )
  })
})

describe('filterAcpExtraArgs', () => {
  it('strips Cursor TUI flags and keeps host-relevant argv', () => {
    assert.deepEqual(filterAcpExtraArgs('cursor', ['--force', '--trust', '--model', 'auto']), [
      '--model',
      'auto'
    ])
    assert.deepEqual(filterAcpExtraArgs('cursor', ['--yolo', '--force']), [])
    assert.deepEqual(
      filterAcpExtraArgs('grok', ['--always-approve', '--permission-mode', 'bypassPermissions']),
      ['--always-approve', '--permission-mode', 'bypassPermissions']
    )
  })
})
