/**
 * Empty-state entrance bookkeeping — one build-up per visit, never a replay.
 *
 * Split out of the React layer so the "has this already played?" decision is
 * plain data: the entrance is decided during render (the first committed frame
 * must already carry the animation) and claimed in a layout effect, so nothing
 * here may touch the DOM.
 */

/** Scene that last started an entrance, per slot. */
const startedScene = new Map<string, string>()

/** Visits per tracked key (session id) — see {@link visitScene}. */
const visits = new Map<string, { key: string; count: number }>()

/**
 * A scene is the identity of one entrance: change it and the hero builds up
 * again. Only the newest scene per slot is remembered — replaying is what a
 * visit is for, so a set of every scene ever seen would suppress it.
 */
export function entranceStarted(slot: string, scene: string): boolean {
  return startedScene.get(slot) === scene
}

export function markEntranceStarted(slot: string, scene: string): void {
  startedScene.set(slot, scene)
}

/**
 * Scene id for a surface the user leaves and returns to.
 *
 * A conversation switched away from and back is a *new* visit even though the
 * session id, agent mark, name and git prose are identical — the empty log
 * should greet you again. Remounts inside one visit (panel reflow, git status
 * landing, detaching neighbouring chrome) keep the same id, so they cannot
 * replay it.
 *
 * Called during render: repeated renders of the same key return the same id.
 */
export function visitScene(track: string, key: string): string {
  const seen = visits.get(track)
  if (seen && seen.key === key) return `${key}#${seen.count}`
  const count = (seen?.count ?? 0) + 1
  visits.set(track, { key, count })
  return `${key}#${count}`
}

/** Tests only — module state is per renderer process. */
export function resetEntranceState(): void {
  startedScene.clear()
  visits.clear()
}
