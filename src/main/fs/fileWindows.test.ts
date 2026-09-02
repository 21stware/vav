import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BINARY_BASE64_SOFT,
  caughtIoError,
  clampByteWindow,
  officeUtf8WriteError,
  readBinaryStatReject,
  readBinarySuccess,
  textFileFromWindow,
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

describe('readBinaryStatReject / caughtIoError', () => {
  it('rejects directories, empty files, and oversized base64 payloads', () => {
    assert.deepEqual(
      readBinaryStatReject({ isDirectory: true, size: 9 }, { directoryError: 'dir', softMax: 16 }),
      { ok: false, error: 'dir' }
    )
    assert.deepEqual(
      readBinaryStatReject({ isDirectory: false, size: 0 }, { directoryError: 'dir', softMax: 16 }),
      { ok: false, error: 'File is empty.' }
    )
    const oversized = readBinaryStatReject(
      { isDirectory: false, size: 32 * 1024 * 1024 },
      { directoryError: 'dir', softMax: BINARY_BASE64_SOFT }
    )
    assert.match(oversized?.error ?? '', /32 MB/)
    assert.equal(
      readBinaryStatReject({ isDirectory: false, size: 12 }, { directoryError: 'dir', softMax: 16 }),
      null
    )
  })

  it('unwraps Error messages and encodes a successful payload', () => {
    assert.deepEqual(caughtIoError(new Error('disk')), { ok: false, error: 'disk' })
    assert.deepEqual(caughtIoError(new Error(''), 'fallback'), { ok: false, error: 'fallback' })
    assert.deepEqual(readBinarySuccess({ toString: () => 'YWI=', length: 2 }, 'text/plain'), {
      ok: true,
      base64: 'YWI=',
      size: 2,
      mime: 'text/plain'
    })
    assert.deepEqual(textFileFromWindow({ content: 'hi', truncated: true }), {
      content: 'hi',
      truncated: true
    })
    assert.deepEqual(textFileFromWindow({ content: 'x', truncated: true, error: 'denied' }), {
      content: '',
      truncated: false,
      error: 'denied'
    })
  })
})
