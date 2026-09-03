import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPreviewableColdOpenPath } from './coldOpen.ts'

describe('isPreviewableColdOpenPath', () => {
  it('rejects empty, missing, and directory paths', () => {
    const missing = {
      existsSync: () => false,
      realpathSync: (p: string) => p,
      statSync: () => ({ isDirectory: () => false })
    }
    assert.equal(isPreviewableColdOpenPath('', missing), false)
    assert.equal(isPreviewableColdOpenPath('/nope', missing), false)
    assert.equal(
      isPreviewableColdOpenPath('/dir', {
        existsSync: () => true,
        realpathSync: (p: string) => p,
        statSync: () => ({ isDirectory: () => true })
      }),
      false
    )
  })

  it('accepts an existing file', () => {
    assert.equal(
      isPreviewableColdOpenPath('/a.md', {
        existsSync: () => true,
        realpathSync: (p: string) => p,
        statSync: () => ({ isDirectory: () => false })
      }),
      true
    )
  })
})
