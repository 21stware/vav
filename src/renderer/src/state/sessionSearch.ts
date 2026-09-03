import type { SearchState } from './sessionTypes.ts'

/** Shared empty search hits — never allocate a fresh [] on every keystroke. */
export const EMPTY_SEARCH_MATCH_IDS: string[] = []

export const IDLE_SEARCH: SearchState = {
  open: false,
  query: '',
  matchIds: EMPTY_SEARCH_MATCH_IDS,
  index: 0,
  tick: 0
}

export function searchIdsEqual(prev: string[], next: string[]): boolean {
  return prev.length === next.length && prev.every((id, i) => id === next[i])
}

export function searchMatchIds(
  messages: Array<{ id: string; content: string }>,
  query: string
): string[] {
  const trimmed = query.trim()
  if (!trimmed) return EMPTY_SEARCH_MATCH_IDS
  const needle = trimmed.toLowerCase()
  return messages.filter((m) => m.content.toLowerCase().includes(needle)).map((m) => m.id)
}

/** New query: reset the index; only bump tick when the hit list actually changes. */
export function searchStateForQuery(
  search: SearchState,
  messages: Array<{ id: string; content: string }>,
  query: string
): SearchState {
  const trimmed = query.trim()
  let matchIds = EMPTY_SEARCH_MATCH_IDS
  if (trimmed) {
    const next = searchMatchIds(messages, query)
    matchIds = searchIdsEqual(search.matchIds, next) ? search.matchIds : next
  }
  return {
    ...search,
    query,
    matchIds,
    index: 0,
    tick: matchIds === search.matchIds ? search.tick : search.tick + 1
  }
}

/**
 * Step to the next/previous hit. Returns `null` when there are no hits so the
 * caller can keep the previous store snapshot.
 */
export function stepSearchState(
  search: SearchState,
  direction: 1 | -1
): SearchState | null {
  const count = search.matchIds.length
  if (count === 0) return null
  const index = (search.index + direction + count) % count
  if (index === search.index) {
    return { ...search, tick: search.tick + 1 }
  }
  return { ...search, index, tick: search.tick + 1 }
}
