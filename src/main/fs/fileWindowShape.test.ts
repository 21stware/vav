import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  binaryProbeTextWindow,
  binaryWindowCaughtError,
  binaryWindowSuccess,
  deniedBinaryWindow,
  deniedTextWindow,
  directoryBinaryWindow,
  directoryTextWindow,
  emptyPastEndBinaryWindow,
  emptyPastEndTextWindow,
  textWindowCaughtError,
  textWindowLooksBinary,
  textWindowSuccess
} from './fileWindowShape.ts'

describe('text window shapes', () => {
  it('builds denied / directory / past-end / success / error cards', () => {
    assert.equal(deniedTextWindow(4, 'no').error, 'no')
    assert.equal(deniedTextWindow(4, 'no').endByte, 4)
    assert.equal(directoryTextWindow('dir').startByte, 0)
    assert.equal(emptyPastEndTextWindow(10, 10).truncated, false)
    assert.equal(textWindowLooksBinary(false, 0, true), true)
    assert.equal(textWindowLooksBinary(true, 0, true), false)
    assert.equal(textWindowLooksBinary(false, 8, true), false)
    const ok = textWindowSuccess('hi', 0, 2, 10)
    assert.equal(ok.content, 'hi')
    assert.equal(ok.truncated, true)
    assert.equal(ok.endByte, 2)
    assert.equal(binaryProbeTextWindow(0, 4, 'bin').error, 'bin')
    assert.equal(textWindowCaughtError(1, new Error('boom')).error, 'boom')
  })
})

describe('binary window shapes', () => {
  it('builds denied / directory / past-end / success / error cards', () => {
    assert.equal(deniedBinaryWindow(3, 'no').ok, false)
    assert.equal(directoryBinaryWindow('dir').totalBytes, 0)
    const empty = emptyPastEndBinaryWindow(8, 8)
    assert.equal(empty.ok, true)
    assert.equal(empty.base64, '')
    const ok = binaryWindowSuccess('YQ==', 0, 1, 4)
    assert.equal(ok.ok, true)
    assert.equal(ok.truncated, true)
    assert.equal(binaryWindowCaughtError(2, new Error('x')).error, 'x')
  })
})
