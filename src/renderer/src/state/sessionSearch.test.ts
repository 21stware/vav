import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMPTY_SEARCH_MATCH_IDS,
  IDLE_SEARCH,
  searchMatchIds,
  searchStateForQuery,
  stepSearchState
} from './sessionSearch.ts'

describe('searchMatchIds', () => {
  const messages = [
    { id: 'a', content: 'Hello World' },
    { id: 'b', content: 'goodbye' },
    { id: 'c', content: 'HELLO again' }
  ]

  it('is case-insensitive and skips blank queries', () => {
    assert.equal(searchMatchIds(messages, '  '), EMPTY_SEARCH_MATCH_IDS)
    assert.deepEqual(searchMatchIds(messages, 'hello'), ['a', 'c'])
    assert.deepEqual(searchMatchIds(messages, 'GOOD'), ['b'])
  })
})

describe('searchStateForQuery', () => {
  const messages = [
    { id: 'a', content: 'alpha' },
    { id: 'b', content: 'zzzz' }
  ]

  it('reuses the previous hit array and tick when hits are unchanged', () => {
    const first = searchStateForQuery(IDLE_SEARCH, messages, 'alp')
    assert.deepEqual(first.matchIds, ['a'])
    assert.equal(first.tick, 1)
    const again = searchStateForQuery(first, messages, 'alph')
    assert.equal(again.matchIds, first.matchIds)
    assert.equal(again.tick, first.tick)
    assert.equal(again.query, 'alph')
    assert.equal(again.index, 0)
  })

  it('bumps tick when the hit list changes', () => {
    const first = searchStateForQuery(IDLE_SEARCH, messages, 'a')
    const next = searchStateForQuery(first, messages, 'zz')
    assert.deepEqual(next.matchIds, ['b'])
    assert.equal(next.tick, first.tick + 1)
  })
})

describe('stepSearchState', () => {
  it('returns null when there are no hits', () => {
    assert.equal(stepSearchState(IDLE_SEARCH, 1), null)
  })

  it('wraps and still bumps tick on a single hit', () => {
    const search = { ...IDLE_SEARCH, matchIds: ['a'], index: 0, tick: 3 }
    const same = stepSearchState(search, 1)
    assert.equal(same?.index, 0)
    assert.equal(same?.tick, 4)
    const wrapped = stepSearchState({ ...search, matchIds: ['a', 'b'], index: 1 }, 1)
    assert.equal(wrapped?.index, 0)
    assert.equal(wrapped?.tick, 4)
  })
})
