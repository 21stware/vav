import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deniedInspectResult, directoryInspectResult } from './fileInspectShape.ts'

describe('fileInspectShape', () => {
  it('returns a binary error stub for denied paths', () => {
    assert.deepEqual(deniedInspectResult('/secret', 'secret', 'not allowed'), {
      path: '/secret',
      name: 'secret',
      size: 0,
      kind: 'binary',
      mime: '',
      error: 'not allowed'
    })
  })

  it('never labels folders as binary', () => {
    assert.deepEqual(directoryInspectResult('/tmp/proj', 'proj', 9), {
      path: '/tmp/proj',
      name: 'proj',
      size: 0,
      mtimeMs: 9,
      kind: 'directory',
      mime: 'inode/directory'
    })
  })
})
