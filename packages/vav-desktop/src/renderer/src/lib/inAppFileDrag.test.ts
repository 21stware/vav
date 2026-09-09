import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  beginInAppFileDrag,
  clearInAppFileDrag,
  peekInAppFileDrag,
  takeInAppFileDrag
} from './inAppFileDrag.ts'

describe('inAppFileDrag', () => {
  it('records unique trimmed paths and take() consumes the list', () => {
    clearInAppFileDrag()
    beginInAppFileDrag(['/a.ts', ' /a.ts ', '', '/b.md'])
    assert.deepEqual(peekInAppFileDrag(), ['/a.ts', '/b.md'])
    assert.deepEqual(takeInAppFileDrag(), ['/a.ts', '/b.md'])
    assert.deepEqual(peekInAppFileDrag(), [])
    assert.deepEqual(takeInAppFileDrag(), [])
  })

  it('ignores empty begins', () => {
    clearInAppFileDrag()
    beginInAppFileDrag(['  ', ''])
    assert.deepEqual(peekInAppFileDrag(), [])
  })
})
