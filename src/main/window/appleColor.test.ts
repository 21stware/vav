import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHexToRgb16, parseOsascriptColorText } from './appleColor.ts'

describe('parseHexToRgb16', () => {
  it('maps 8-bit hex to 16-bit AppleScript triplets', () => {
    assert.equal(parseHexToRgb16(undefined), null)
    assert.equal(parseHexToRgb16('nope'), null)
    assert.deepEqual(parseHexToRgb16('#000000'), [0, 0, 0])
    assert.deepEqual(parseHexToRgb16('ffffff'), [65535, 65535, 65535])
    assert.deepEqual(parseHexToRgb16('#ff0000'), [65535, 0, 0])
  })
})

describe('parseOsascriptColorText', () => {
  it('converts 16-bit r,g,b stdout to #rrggbb', () => {
    assert.equal(parseOsascriptColorText(''), null)
    assert.equal(parseOsascriptColorText('false'), null)
    assert.equal(parseOsascriptColorText('1,2'), null)
    assert.equal(parseOsascriptColorText('65535,0,0'), '#ff0000')
    assert.equal(parseOsascriptColorText('0, 65535, 0'), '#00ff00')
  })
})
