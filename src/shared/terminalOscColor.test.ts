import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cssColorToOscRgb, oscColorQueryReply } from './terminalOscColor.ts'

describe('cssColorToOscRgb', () => {
  it('expands hex into rgb:rrrr/gggg/bbbb', () => {
    assert.equal(cssColorToOscRgb('#1b1b1d'), 'rgb:1b1b/1b1b/1d1d')
    assert.equal(cssColorToOscRgb('#abc'), 'rgb:aaaa/bbbb/cccc')
  })

  it('rejects empty or non-hex', () => {
    assert.equal(cssColorToOscRgb(undefined), null)
    assert.equal(cssColorToOscRgb('red'), null)
  })
})

describe('oscColorQueryReply', () => {
  it('wraps OSC 11 with ST', () => {
    assert.equal(oscColorQueryReply(11, '#101012'), '\x1b]11;rgb:1010/1010/1212\x1b\\')
  })
})
