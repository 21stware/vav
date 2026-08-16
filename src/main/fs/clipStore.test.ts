import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { writeClip, isClipPath } from './clipStore.ts'

describe('clipStore', () => {
  it('writes into the OS temp clip folder and reuses the same path', () => {
    const first = writeClip({ filename: 'hello.png', text: 'same-bytes' })
    const second = writeClip({ filename: 'hello.png', text: 'same-bytes' })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.equal(first.path, second.path)
    assert.equal(first.displayName, 'hello.png')
    assert.equal(isClipPath(first.path), true)
    assert.equal(readFileSync(first.path, 'utf8'), 'same-bytes')
  })

  it('rejects an empty payload', () => {
    assert.equal(writeClip({ filename: 'x.png' }).ok, false)
  })
})
