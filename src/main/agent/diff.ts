/**
 * Line diffs for the `fs_write` tool card.
 *
 * The model writes whole files, so "what changed" is not in the tool call — it
 * only exists at the moment of the write, between the bytes on disk and the
 * bytes about to replace them. This module captures that difference as unified
 * diff text, which is what the card renders.
 *
 * The output is persisted in conversations.json, so it is capped twice: the
 * expensive comparison is skipped for large files, and the emitted text is
 * truncated. A tool card is a summary, not an archive.
 */

/** Beyond this, the quadratic LCS is not worth it and we report a replacement. */
const MAX_COMPARED_LINES = 1500
/** Emitted diff lines; a longer change is truncated with a marker. */
const MAX_DIFF_LINES = 400
const CONTEXT = 3

export interface DiffStats {
  added: number
  removed: number
}

/**
 * Unified diff between `before` and `after`, or null when they are identical.
 *
 * `before` is null for a file that did not exist, which reads as an all-added
 * diff rather than a special case.
 */
export function unifiedDiff(before: string | null, after: string): string | null {
  if (before === after) return null

  const oldLines = before === null ? [] : splitLines(before)
  const newLines = splitLines(after)

  if (oldLines.length === 0) return truncate(newLines.map((line) => `+${line}`))

  if (oldLines.length > MAX_COMPARED_LINES || newLines.length > MAX_COMPARED_LINES) {
    return `@@ -1,${oldLines.length} +1,${newLines.length} @@\n（文件较大，仅记录整体替换：${oldLines.length} 行 → ${newLines.length} 行）`
  }

  const ops = diffOps(oldLines, newLines)
  const hunks = toHunks(ops, oldLines, newLines)
  return hunks.length ? truncate(hunks) : null
}

/** Counts the +/- lines of an already-built diff, for the card's headline. */
export function diffStats(diff: string): DiffStats {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  // A trailing newline is a terminator, not an empty final line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

type Op = { kind: 'same' | 'add' | 'remove'; oldIndex: number; newIndex: number }

/**
 * Longest-common-subsequence diff, with the identical head and tail peeled off
 * first so the quadratic table only covers the part that actually differs.
 */
function diffOps(oldLines: string[], newLines: string[]): Op[] {
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) {
    head += 1
  }
  let tail = 0
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail += 1
  }

  const ops: Op[] = []
  for (let i = 0; i < head; i += 1) ops.push({ kind: 'same', oldIndex: i, newIndex: i })

  const oldMid = oldLines.slice(head, oldLines.length - tail)
  const newMid = newLines.slice(head, newLines.length - tail)

  // table[i][j] = LCS length of oldMid[i:] and newMid[j:]
  const table: number[][] = Array.from({ length: oldMid.length + 1 }, () =>
    new Array<number>(newMid.length + 1).fill(0)
  )
  for (let i = oldMid.length - 1; i >= 0; i -= 1) {
    for (let j = newMid.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldMid[i] === newMid[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < oldMid.length && j < newMid.length) {
    if (oldMid[i] === newMid[j]) {
      ops.push({ kind: 'same', oldIndex: head + i, newIndex: head + j })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'remove', oldIndex: head + i, newIndex: head + j })
      i += 1
    } else {
      ops.push({ kind: 'add', oldIndex: head + i, newIndex: head + j })
      j += 1
    }
  }
  while (i < oldMid.length) {
    ops.push({ kind: 'remove', oldIndex: head + i, newIndex: head + j })
    i += 1
  }
  while (j < newMid.length) {
    ops.push({ kind: 'add', oldIndex: head + i, newIndex: head + j })
    j += 1
  }

  for (let k = 0; k < tail; k += 1) {
    ops.push({
      kind: 'same',
      oldIndex: oldLines.length - tail + k,
      newIndex: newLines.length - tail + k
    })
  }
  return ops
}

/** Groups changed ops into hunks with `CONTEXT` unchanged lines around them. */
function toHunks(ops: Op[], oldLines: string[], newLines: string[]): string[] {
  const changed = ops
    .map((op, index) => (op.kind === 'same' ? -1 : index))
    .filter((index) => index >= 0)
  if (changed.length === 0) return []

  const ranges: [number, number][] = []
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT)
    const end = Math.min(ops.length - 1, index + CONTEXT)
    const last = ranges[ranges.length - 1]
    // Touching ranges merge, so two nearby edits read as one hunk.
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }

  const out: string[] = []
  for (const [start, end] of ranges) {
    const slice = ops.slice(start, end + 1)
    const oldStart = slice[0].oldIndex + 1
    const newStart = slice[0].newIndex + 1
    const oldCount = slice.filter((op) => op.kind !== 'add').length
    const newCount = slice.filter((op) => op.kind !== 'remove').length
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const op of slice) {
      if (op.kind === 'same') out.push(` ${oldLines[op.oldIndex]}`)
      else if (op.kind === 'remove') out.push(`-${oldLines[op.oldIndex]}`)
      else out.push(`+${newLines[op.newIndex]}`)
    }
  }
  return out
}

function truncate(lines: string[]): string {
  if (lines.length <= MAX_DIFF_LINES) return lines.join('\n')
  const omitted = lines.length - MAX_DIFF_LINES
  return `${lines.slice(0, MAX_DIFF_LINES).join('\n')}\n…（还有 ${omitted} 行差异未显示）`
}
