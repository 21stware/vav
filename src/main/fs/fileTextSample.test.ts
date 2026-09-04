import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bufferLooksLikeText } from './fileTextSample.ts'

describe('bufferLooksLikeText', () => {
  it('accepts ordinary UTF-8 source', () => {
    assert.equal(bufferLooksLikeText(Buffer.from('export const x = 1\n')), true)
  })

  it('rejects a NUL in the sample', () => {
    assert.equal(bufferLooksLikeText(Buffer.from([0x68, 0x69, 0x00, 0x21])), false)
  })

  it('rejects a sample that is mostly control bytes', () => {
    assert.equal(bufferLooksLikeText(Buffer.alloc(50, 1)), false)
  })
})
