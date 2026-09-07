import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { clipDest, clipDisplayName, clipHash16, clipRootOf } from './clipLayout.ts'

describe('clipLayout', () => {
  it('builds the same content-addressed path desktop clipStore uses', async () => {
    const bytes = new TextEncoder().encode('same-bytes')
    const hash = await clipHash16(bytes)
    assert.equal(hash, createHash('sha256').update(bytes).digest('hex').slice(0, 16))
    const { dest } = clipDest(clipRootOf('/tmp'), hash, clipDisplayName('hello.png'))
    assert.equal(dest, `/tmp/vav-clips/${hash}/hello.png`)
  })

  it('sanitizes display names', () => {
    assert.equal(clipDisplayName('../odd name!.png'), 'odd_name_.png')
    assert.equal(clipDisplayName(''), 'image.png')
  })
})
