import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { joinOnHostPath } from './fileHostPath.ts'

describe('joinOnHostPath', () => {
  it('joins POSIX parents with a slash', () => {
    assert.equal(joinOnHostPath('/Users/ada/src', 'vav'), '/Users/ada/src/vav')
  })

  it('joins Windows parents with a backslash', () => {
    assert.equal(joinOnHostPath('C:\\Users\\ada', 'src'), 'C:\\Users\\ada\\src')
  })
})
