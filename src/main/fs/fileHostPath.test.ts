import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isInvalidRenameName, joinOnHostPath, parentPathOfWrite } from './fileHostPath.ts'

describe('joinOnHostPath', () => {
  it('joins POSIX parents with a slash', () => {
    assert.equal(joinOnHostPath('/Users/ada/src', 'vav'), '/Users/ada/src/vav')
  })

  it('joins Windows parents with a backslash', () => {
    assert.equal(joinOnHostPath('C:\\Users\\ada', 'src'), 'C:\\Users\\ada\\src')
  })
})

describe('isInvalidRenameName', () => {
  it('rejects empty, dots, and path separators', () => {
    assert.equal(isInvalidRenameName(''), true)
    assert.equal(isInvalidRenameName('.'), true)
    assert.equal(isInvalidRenameName('..'), true)
    assert.equal(isInvalidRenameName('a/b'), true)
    assert.equal(isInvalidRenameName('a\\b'), true)
    assert.equal(isInvalidRenameName('readme.md'), false)
  })
})

describe('parentPathOfWrite', () => {
  it('strips the leaf on POSIX and Windows paths', () => {
    assert.equal(parentPathOfWrite('/proj/src/a.ts', '/proj'), '/proj/src')
    assert.equal(parentPathOfWrite('C:\\proj\\a.ts', 'C:\\proj'), 'C:\\proj')
    assert.equal(parentPathOfWrite('/a.ts', '/cwd'), '/cwd')
    assert.equal(parentPathOfWrite('a.ts', '/cwd'), 'a.ts')
  })
})
