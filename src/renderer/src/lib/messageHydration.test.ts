import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../../../shared/types.ts'
import {
  isCurrentHydration,
  mergeHydratedMessages,
  nextHydrationGeneration,
  omitKeys
} from './messageHydration.ts'

function msg(id: string, content: string, parentId: string | null = null): ChatMessage {
  return {
    id,
    parentId,
    role: 'user',
    content,
    blocks: [],
    createdAt: 1
  }
}

describe('mergeHydratedMessages', () => {
  it('returns disk when live is empty', () => {
    const disk = [msg('a', 'disk')]
    assert.deepEqual(mergeHydratedMessages(disk, undefined), disk)
    assert.deepEqual(mergeHydratedMessages(disk, []), disk)
  })

  it('keeps live turns that arrived after the disk snapshot', () => {
    const disk = [msg('a', 'from-disk')]
    const live = [msg('a', 'from-disk'), msg('b', 'streamed', 'a')]
    const merged = mergeHydratedMessages(disk, live)
    assert.deepEqual(
      merged.map((m) => m.id),
      ['a', 'b']
    )
    assert.equal(merged[1]?.content, 'streamed')
  })

  it('lets live win on the same id (streaming overlay)', () => {
    const disk = [msg('a', 'old')]
    const live = [msg('a', 'newer-stream')]
    const merged = mergeHydratedMessages(disk, live)
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.content, 'newer-stream')
  })
})

describe('hydration generations', () => {
  it('drops a stale apply after a newer load starts', () => {
    const gens = new Map<string, number>()
    const first = nextHydrationGeneration(gens, 'c1')
    const second = nextHydrationGeneration(gens, 'c1')
    assert.equal(isCurrentHydration(gens, 'c1', first), false)
    assert.equal(isCurrentHydration(gens, 'c1', second), true)
  })
})

describe('omitKeys', () => {
  it('removes per-conversation maps and preserves others', () => {
    const map = { keep: 1, gone: 2, also: 3 }
    const next = omitKeys(map, ['gone', 'missing'])
    assert.deepEqual(next, { keep: 1, also: 3 })
    assert.equal(map.gone, 2)
  })

  it('returns the same object when nothing is removed', () => {
    const map = { keep: 1 }
    assert.equal(omitKeys(map, ['nope']), map)
  })
})
