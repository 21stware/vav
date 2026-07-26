/**
 * Incremental markdown segmenter.
 *
 * Streaming text is split into *sealed chunks* — complete, immutable pieces
 * that will never change again — and an *open tail* that is still growing.
 * Only the tail is re-parsed on each UI tick, which is what keeps token
 * streaming off the whole-message re-render path (README §8).
 *
 * A chunk is sealed at a blank line that is not inside a fenced code block, so
 * a half-written fence is never rendered as if it had closed.
 */
export class MarkdownSegmenter {
  /** Complete chunks, append-only. Existing indices are never rewritten. */
  readonly sealed: string[] = []

  private currentLines: string[] = []
  private partialLine = ''
  private insideFence = false
  private fenceMarker = ''

  push(text: string): void {
    this.partialLine += text
    let index: number
    while ((index = this.partialLine.indexOf('\n')) >= 0) {
      const line = this.partialLine.slice(0, index)
      this.partialLine = this.partialLine.slice(index + 1)
      this.consumeLine(line)
    }
  }

  /** The still-growing remainder, re-rendered every tick. */
  get tail(): string {
    const lines = this.partialLine ? [...this.currentLines, this.partialLine] : this.currentLines
    return lines.join('\n')
  }

  /** Seals everything, used when the turn ends. */
  finish(): void {
    if (this.partialLine) {
      this.currentLines.push(this.partialLine)
      this.partialLine = ''
    }
    this.flushCurrent()
  }

  private consumeLine(line: string): void {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (!this.insideFence) {
        this.insideFence = true
        this.fenceMarker = fence[1][0]
      } else if (fence[1][0] === this.fenceMarker) {
        this.insideFence = false
        this.fenceMarker = ''
      }
    }

    this.currentLines.push(line)

    if (!this.insideFence && line.trim() === '') {
      this.flushCurrent()
    }
  }

  private flushCurrent(): void {
    if (this.currentLines.length === 0) return
    const chunk = this.currentLines.join('\n')
    this.currentLines = []
    if (chunk.trim() === '') return
    this.sealed.push(chunk)
  }
}

/** Beyond this the open tail renders as plain text instead of parsed markdown. */
export const TAIL_PLAIN_TEXT_THRESHOLD = 8 * 1024
