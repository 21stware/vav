/** Find a swarm-history row by id across grouped lists. */
export function findSwarmHistoryItem<T extends { id: string }>(
  groups: Array<{ items: T[] }> | null | undefined,
  itemId: string
): T | null {
  if (!groups) return null
  for (const group of groups) {
    const hit = group.items.find((item) => item.id === itemId)
    if (hit) return hit
  }
  return null
}
