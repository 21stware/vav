/**
 * Some hosts re-send the whole thought so far (or the same paragraph again)
 * as a "delta". Appending those snapshots reprints the same prose and scrambles
 * the draft order. Fold them down to the latest covering text.
 */

const SNAPSHOT_MIN = 12

function compactSense(text: string): string {
  return text.replace(/\s+/g, '').replace(/[。．.！!？?，,、；;：:…—\-]/g, '')
}

/** True when `longer` already contains the substance of `shorter`. */
export function streamTextCovers(longer: string, shorter: string): boolean {
  const a = compactSense(longer)
  const b = compactSense(shorter)
  if (!b) return true
  if (a.includes(b)) return true
  if (b.length < 8) return a.includes(b)
  const window = Math.min(b.length, 12)
  return a.includes(b.slice(0, window)) && a.includes(b.slice(-window))
}

/** Merge one incoming chunk into the open stream buffer. */
export function coalesceStreamChunk(current: string, incoming: string): string {
  if (!incoming) return current
  if (!current) return incoming
  if (incoming === current) return current
  if (current.trim() === incoming.trim()) return current.trim()
  if (current.startsWith(incoming)) return current
  if (incoming.startsWith(current)) return incoming

  const cur = current.trim()
  const next = incoming.trim()
  if (!next) return current
  if (next === cur) return cur
  if (streamTextCovers(next, cur)) return next
  if (streamTextCovers(cur, next) && next.length >= SNAPSHOT_MIN) return current
  if (cur.endsWith(next) && next.length >= SNAPSHOT_MIN) return current

  return current + incoming
}

/** Collapse a finished block that already concatenated snapshot repeats. */
export function foldSnapshotText(text: string): string {
  if (!text) return text
  const paras = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (paras.length > 1) {
    let kept = paras[0]!
    for (let i = 1; i < paras.length; i++) {
      kept = coalesceStreamChunk(kept, paras[i]!)
    }
    return kept
  }
  return dropCoveredPrefix(foldExactRepeats(text))
}

function foldExactRepeats(text: string): string {
  let cur = text
  let changed = true
  while (changed) {
    changed = false
    for (let n = Math.floor(cur.length / 2); n >= SNAPSHOT_MIN; n--) {
      const suffix = cur.slice(-n)
      const before = cur.slice(0, -n)
      if (!before.endsWith(suffix)) continue
      cur = before
      changed = true
      break
    }
  }
  return cur
}

/** Drop an early draft that the remainder restates. */
function dropCoveredPrefix(text: string): string {
  const max = Math.min(text.length - SNAPSHOT_MIN, 240)
  for (let i = SNAPSHOT_MIN; i <= max; i++) {
    const prefix = text.slice(0, i)
    const rest = text.slice(i)
    if (streamTextCovers(rest, prefix)) return rest
  }
  return text
}
