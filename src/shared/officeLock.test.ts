import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isOfficeLockFile } from './officeLock.ts'

describe('isOfficeLockFile', () => {
  it('treats Word and LibreOffice owner stubs as locks', () => {
    assert.equal(isOfficeLockFile('~$budget.xlsx'), true)
    assert.equal(isOfficeLockFile('/tmp/.~$letter.docx'), true)
    assert.equal(isOfficeLockFile('.~报告.docx'), true)
    assert.equal(isOfficeLockFile('C:\\\\Users\\\\me\\\\~$deck.pptx'), true)
  })

  it('does not lock a real document whose name starts with ~', () => {
    assert.equal(isOfficeLockFile('~优品开题报告.docx'), false)
    assert.equal(isOfficeLockFile('/tmp/notes.xlsx'), false)
    assert.equal(isOfficeLockFile('letter.docx'), false)
  })
})
