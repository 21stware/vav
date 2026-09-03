const LINE_ORIENTED_EXTS = new Set([
  'log',
  'out',
  'err',
  'trace',
  'syslog',
  'logcat',
  'nfo'
])

/**
 * Line-oriented files (.log, dense logs): selection is per-line via the canvas
 * hit-test, not a prebuilt block tree (which would be O(n) memory and group
 * continuous logs into one giant paragraph).
 */
export function isLineOrientedPath(path: string, sampleText?: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  if (LINE_ORIENTED_EXTS.has(ext)) return true
  if (sampleText == null || sampleText.length < 200) return false
  const head = sampleText.split(/\r?\n/, 400)
  if (head.length < 80) return false
  const blank = head.filter((line) => !line.trim()).length
  return blank / head.length < 0.06
}
