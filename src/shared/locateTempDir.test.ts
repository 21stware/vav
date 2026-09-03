import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hostBasenamePath,
  hostDirnamePath,
  planLocateTempDir,
  tempDirContainer,
  TEMP_WORKSPACE_FOLDER
} from './locateTempDir.ts'

describe('tempDirContainer', () => {
  it('returns the minted vav/<hex> folder for a Temporary Workspace', () => {
    assert.equal(
      tempDirContainer('/var/folders/sz/x/T/vav/182b376e/Workspace'),
      '/var/folders/sz/x/T/vav/182b376e'
    )
  })

  it('rejects a real project path', () => {
    assert.equal(tempDirContainer('/Users/me/repo'), null)
    assert.equal(tempDirContainer('/tmp/scratch'), null)
  })

  it('accepts Windows minted paths', () => {
    assert.equal(
      tempDirContainer('C:\\Users\\me\\AppData\\Local\\Temp\\vav\\abcd1234\\Workspace'),
      'C:\\Users\\me\\AppData\\Local\\Temp\\vav\\abcd1234'
    )
  })
})

describe('planLocateTempDir', () => {
  it('moves every temp-container child into dest so dest contains Workspace', () => {
    const plan = planLocateTempDir(
      '/tmp/vav/aabbccdd/Workspace',
      '/Users/me/keep',
      ['Workspace', 'notes.txt']
    )
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.nextWorkdir, '/Users/me/keep/Workspace')
    assert.deepEqual(plan.moves, [
      { from: '/tmp/vav/aabbccdd/Workspace', to: '/Users/me/keep/Workspace' },
      { from: '/tmp/vav/aabbccdd/notes.txt', to: '/Users/me/keep/notes.txt' }
    ])
    assert.deepEqual(plan.cleanup, ['/tmp/vav/aabbccdd', '/tmp/vav'])
    assert.equal(hostBasenamePath(plan.nextWorkdir), TEMP_WORKSPACE_FOLDER)
  })

  it('joins Windows destinations with backslashes', () => {
    const plan = planLocateTempDir(
      'C:\\Temp\\vav\\abcd1234\\Workspace',
      'D:\\Projects\\hold',
      ['Workspace'],
      'win32'
    )
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.nextWorkdir, 'D:\\Projects\\hold\\Workspace')
    assert.deepEqual(plan.moves, [
      {
        from: 'C:\\Temp\\vav\\abcd1234\\Workspace',
        to: 'D:\\Projects\\hold\\Workspace'
      }
    ])
  })

  it('does not rename Workspace to a session title', () => {
    const plan = planLocateTempDir(
      '/tmp/vav/aabbccdd/Workspace',
      '/Users/me/keep',
      ['Workspace']
    )
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.nextWorkdir, '/Users/me/keep/Workspace')
    assert.ok(!plan.moves.some((move) => /My Session/.test(move.to)))
  })

  it('rejects a non-ephemeral workdir', () => {
    const plan = planLocateTempDir('/Users/me/repo', '/Users/me/keep', ['src'])
    assert.deepEqual(plan, { ok: false, reason: 'not-temp' })
  })
})

describe('host path helpers', () => {
  it('splits posix and windows parents', () => {
    assert.equal(hostDirnamePath('/tmp/vav/abcd/Workspace'), '/tmp/vav/abcd')
    assert.equal(hostDirnamePath('C:\\Temp\\vav\\abcd\\Workspace'), 'C:\\Temp\\vav\\abcd')
    assert.equal(hostBasenamePath('/tmp/vav/abcd/Workspace'), 'Workspace')
  })
})
