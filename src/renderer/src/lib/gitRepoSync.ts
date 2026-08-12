import { useSyncExternalStore } from 'react'

/**
 * Bump when a cwd becomes (or stops being) a git repo without the path changing
 * — e.g. empty-session “enable version control” / `git init`. Panels that probe
 * `git.status` subscribe so Files ↔ Git chrome can catch up on temp dirs too.
 */
let epoch = 0
const listeners = new Set<() => void>()

export function bumpGitRepoSync(): void {
  epoch += 1
  for (const listener of listeners) listener()
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

function getEpoch(): number {
  return epoch
}

export function useGitRepoSyncEpoch(): number {
  return useSyncExternalStore(subscribe, getEpoch, getEpoch)
}
