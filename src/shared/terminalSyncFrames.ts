/** DEC 2026 synchronized-output markers used by Grok / OpenCode / Claude TUIs. */
export const SYNC_OUTPUT_ENABLE = '\x1b[?2026h'
export const SYNC_OUTPUT_DISABLE = '\x1b[?2026l'

/**
 * Give the TUI one extra frame to close a synchronized update before we paint
 * a half-drawn grid. Past this, emit anyway so a stuck sequence cannot stall.
 */
export const SYNC_HOLD_MAX_MS = 80

export function splitSynchronizedOutput(
  buffer: string,
  heldMs: number
): { emit: string; hold: string } {
  if (!buffer) return { emit: '', hold: '' }
  if (heldMs >= SYNC_HOLD_MAX_MS) return { emit: buffer, hold: '' }

  const incomplete = trailingIncompleteEscapeIndex(buffer)
  const unclosed = lastUnclosedSyncEnableIndex(buffer)
  let cut = -1
  if (incomplete >= 0) cut = incomplete
  if (unclosed >= 0 && (cut < 0 || unclosed < cut)) cut = unclosed
  if (cut < 0) return { emit: buffer, hold: '' }
  if (cut === 0) return { emit: '', hold: buffer }
  return { emit: buffer.slice(0, cut), hold: buffer.slice(cut) }
}

/** Last ESC that has not yet formed a complete CSI / OSC / escape. */
export function trailingIncompleteEscapeIndex(buffer: string): number {
  const esc = buffer.lastIndexOf('\x1b')
  if (esc < 0) return -1
  const tail = buffer.slice(esc)
  if (tail === '\x1b' || tail === '\x1b[') return esc
  // CSI parameters, no final byte (0x40–0x7E) yet.
  if (/^\x1b\[\??[\d;:]*$/.test(tail)) return esc
  // OSC / APC / PM / DCS without ST or BEL.
  if (/^\x1b[\]]/.test(tail) && !/\x07$/.test(tail) && !/\x1b\\$/.test(tail)) return esc
  if (/^\x1b[P^_]/.test(tail) && !/\x1b\\$/.test(tail)) return esc
  return -1
}

/** Start of the innermost unmatched `CSI ? 2026 h`. */
export function lastUnclosedSyncEnableIndex(buffer: string): number {
  let depth = 0
  let lastEnable = -1
  let i = 0
  while (i < buffer.length) {
    if (buffer.startsWith(SYNC_OUTPUT_ENABLE, i)) {
      if (depth === 0) lastEnable = i
      depth += 1
      i += SYNC_OUTPUT_ENABLE.length
      continue
    }
    if (buffer.startsWith(SYNC_OUTPUT_DISABLE, i)) {
      if (depth > 0) depth -= 1
      if (depth === 0) lastEnable = -1
      i += SYNC_OUTPUT_DISABLE.length
      continue
    }
    i += 1
  }
  return depth > 0 ? lastEnable : -1
}
