import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BINARY_BASE64_SOFT,
  clampByteWindow,
  officeUtf8WriteError,
  TEXT_WINDOW_BYTES,
  TEXT_WINDOW_HARD_MAX
} from './fileWindows.ts'

describe('clampByteWindow', () => {
  it('floors startByte and clamps maxBytes', () => {
    assert.deepEqual(clampByteWindow(-10, 50, TEXT_WINDOW_BYTES, TEXT_WINDOW_HARD_MAX), {
      startByte: 0,
      maxBytes: 1024
    })
    assert.deepEqual(clampByteWindow(12.9, undefined, 2048, TEXT_WINDOW_HARD_MAX), {
      startByte: 12,
      maxBytes: 2048
    })
    assert.deepEqual(
      clampByteWindow(0, TEXT_WINDOW_HARD_MAX * 4, TEXT_WINDOW_BYTES, TEXT_WINDOW_HARD_MAX),
      { startByte: 0, maxBytes: TEXT_WINDOW_HARD_MAX }
    )
  })
})

describe('officeUtf8WriteError', () => {
  it('blocks OOXML and PDF, allows text', () => {
    assert.match(officeUtf8WriteError('/a.docx') ?? '', /Cannot write \.docx/)
    assert.match(officeUtf8WriteError('/a.pdf') ?? '', /Cannot write \.pdf/)
    assert.equal(officeUtf8WriteError('/a.md'), null)
    assert.equal(BINARY_BASE64_SOFT, 16 * 1024 * 1024)
  })
})
