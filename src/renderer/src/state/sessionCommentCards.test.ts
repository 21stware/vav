import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PreviewRef } from '../../../shared/types.ts'
import {
  clearCommentCardsMap,
  removeCommentCardFromMap,
  setCommentCardsMap,
  updateCommentCardInMap
} from './sessionCommentCards.ts'

const ref = (id: string): PreviewRef => ({
  id,
  filePath: '/a.ts',
  label: id,
  startLine: 1,
  endLine: 1,
  text: 'x'
})

describe('sessionCommentCards', () => {
  it('replaces, updates, removes, and clears per conversation', () => {
    const a = { ref: ref('/a.ts::1'), comment: 'one' }
    let map = setCommentCardsMap({}, 'c1', [a])
    assert.equal(map.c1?.length, 1)
    map = updateCommentCardInMap(map, 'c1', '/a.ts::1', 'two')
    assert.equal(map.c1?.[0]?.comment, 'two')
    map = removeCommentCardFromMap(map, 'c1', '/a.ts::1')
    assert.deepEqual(map.c1, [])
    map = setCommentCardsMap(map, 'c1', [a])
    map = clearCommentCardsMap(map, 'c1')
    assert.deepEqual(map.c1, [])
  })
})
