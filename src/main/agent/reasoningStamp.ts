import type { MessageBlock } from '../../shared/types.ts'

/** Stamp `durationMs` on open reasoning blocks from first-token wall times. */
export function stampReasoningDurations(
  blocks: MessageBlock[],
  startedAt: Map<number, number>,
  now = Date.now(),
  slot?: number
): void {
  const targets = slot !== undefined ? [slot] : [...startedAt.keys()]
  for (const index of targets) {
    const block = blocks[index]
    if (!block || block.kind !== 'reasoning' || block.durationMs != null) continue
    const started = startedAt.get(index) ?? now
    block.durationMs = Math.max(0, now - started)
  }
}
