import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import { isPathAllowed, isPathInside } from './pathAllow.ts'

describe('isPathInside', () => {
  it('accepts the root itself and nested files', () => {
    const root = join('/tmp', 'proj')
    assert.equal(isPathInside(root, root), true)
    assert.equal(isPathInside(root, join(root, 'src', 'a.ts')), true)
  })

  it('rejects a sibling prefix that is not a child', () => {
    const root = join('/tmp', 'proj')
    assert.equal(isPathInside(root, join('/tmp', 'proj-evil', 'secret')), false)
    assert.equal(isPathInside(root, join('/tmp', 'other')), false)
  })

  it('rejects traversal that escapes the root', () => {
    const root = join('/tmp', 'proj')
    assert.equal(isPathInside(root, join(root, '..', 'outside')), false)
  })

  it('rejects empty and null-byte paths', () => {
    assert.equal(isPathInside('/tmp/proj', ''), false)
    assert.equal(isPathInside('/tmp/proj', '/tmp/proj/\0x'), false)
  })
})

describe('isPathAllowed', () => {
  it('matches watched roots and granted files', () => {
    const root = join('/tmp', 'ws')
    const extra = join('/tmp', 'vav-clips')
    const granted = join('/Users', 'ada', 'Downloads', 'note.txt')
    assert.equal(isPathAllowed(join(root, 'a.ts'), [root, extra], [granted]), true)
    assert.equal(isPathAllowed(join(extra, 'x.png'), [root, extra], [granted]), true)
    assert.equal(isPathAllowed(granted, [root, extra], [granted]), true)
    assert.equal(isPathAllowed(join('/etc', 'passwd'), [root, extra], [granted]), false)
    assert.equal(isPathAllowed(join('/Users', 'ada', 'Downloads'), [root, extra], [granted]), false)
    assert.equal(isPathAllowed(join('/'), [root, extra], [granted]), false)
  })
})
