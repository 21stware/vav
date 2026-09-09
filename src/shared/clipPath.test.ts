import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isClipPath, isFileSessionEligible } from './clipPath.ts'

describe('clipPath', () => {
  it('recognizes vav clip temp paths', () => {
    assert.equal(isClipPath('/tmp/vav-tuips/abc/app.html'), true)
    assert.equal(isClipPath('C:\\Users\\x\\AppData\\Local\\Temp\\vav-tuips\\a.png'), true)
    assert.equal(isClipPath('/Users/me/project/app.html'), false)
    assert.equal(isClipPath(''), false)
  })

  it('keeps real files eligible for File Sessions', () => {
    assert.equal(isFileSessionEligible('/Users/me/notes.md'), true)
    assert.equal(isFileSessionEligible('/tmp/vav-tuips/abc/photo.png'), false)
    assert.equal(isFileSessionEligible('  '), false)
  })
})
