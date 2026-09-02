import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  gateReadonlyExecute,
  isFileEditLockedPath,
  isReadonlyTerminalCommand
} from './fileEditLock.ts'

describe('isFileEditLockedPath', () => {
  it('locks PDF / HEIC / legacy Office / ZIP / drawio', () => {
    assert.equal(isFileEditLockedPath('/a.pdf'), true)
    assert.equal(isFileEditLockedPath('/a.heic'), true)
    assert.equal(isFileEditLockedPath('/a.doc'), true)
    assert.equal(isFileEditLockedPath('/a.docx'), false)
    assert.equal(isFileEditLockedPath('/a.zip'), true)
    assert.equal(isFileEditLockedPath('/a.ts'), false)
    assert.equal(isFileEditLockedPath(null), false)
  })
})

describe('isReadonlyTerminalCommand', () => {
  it('allows common readers and rejects redirects / mutators', () => {
    assert.equal(isReadonlyTerminalCommand('ls -la'), true)
    assert.equal(isReadonlyTerminalCommand('cat README.md'), true)
    assert.equal(isReadonlyTerminalCommand('echo hi > out.txt'), false)
    assert.equal(isReadonlyTerminalCommand('rm -rf dist'), false)
  })
})

describe('gateReadonlyExecute', () => {
  it('is a no-op when the session can write', () => {
    assert.equal(gateReadonlyExecute(false, 'fs_write', { path: '/a' }), null)
  })

  it('blocks fs_write and mutating shell in Read mode', () => {
    const write = gateReadonlyExecute(true, 'fs_write', { path: '/a' })
    assert.equal(write?.details.failed, true)
    assert.match(write?.content[0]?.text ?? '', /switch_mode/)
    const shell = gateReadonlyExecute(true, 'terminal', { command: 'rm file' })
    assert.match(shell?.content[0]?.text ?? '', /Refused: rm file/)
    assert.equal(gateReadonlyExecute(true, 'terminal', { command: 'ls' }), null)
    assert.equal(gateReadonlyExecute(true, 'fs_read', { path: '/a' }), null)
  })
})
