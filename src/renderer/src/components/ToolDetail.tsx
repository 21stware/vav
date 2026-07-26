import { memo, useMemo } from 'react'
import { Folder, FileText } from 'lucide-react'
import type { ToolCallBlock } from '@shared/types'

/** Rendering every line of a large result costs more than it explains. */
const MAX_LINES = 400

/**
 * The expanded half of a tool card.
 *
 * Each tool produced a specific kind of artefact, so each gets a view that
 * knows what it is looking at: a shell transcript reads as a terminal, a write
 * reads as a diff, a read reads as a numbered file. The generic input/output
 * dump is the fallback for anything unrecognised, including tool calls recorded
 * before these views existed.
 */
export const ToolDetail = memo(function ToolDetail({
  block
}: {
  block: ToolCallBlock
}): React.JSX.Element {
  const output = block.output || ''

  if (block.tool === 'terminal' && output.startsWith('$ ')) {
    return <TerminalLog transcript={output} />
  }
  if (block.tool === 'fs_write' && looksLikeDiff(output)) {
    return <DiffView diff={output} />
  }
  if (block.tool === 'fs_read' && output) {
    return <FileView content={output} />
  }
  if (block.tool === 'fs_list' && output) {
    return <ListingView listing={output} />
  }
  if (block.tool === 'request' || block.tool === 'ask_user_question') {
    return (
      <div className="detail-qa">
        <div className="detail-question">{block.summary}</div>
        <div className="detail-answer">{output || '（未回答）'}</div>
      </div>
    )
  }

  return (
    <div className="detail-raw">
      <div className="detail-label">输入</div>
      <pre>{block.input}</pre>
      <div className="detail-label">输出</div>
      <pre>{output || '（无输出）'}</pre>
    </div>
  )
})

/** `$ cmd` … `exit N` — the shape StickyShell mirrors into the Agent tab. */
function TerminalLog({ transcript }: { transcript: string }): React.JSX.Element {
  const { command, body, exitCode } = useMemo(() => parseTranscript(transcript), [transcript])

  return (
    <div className="detail-terminal">
      <div className="term-command">
        <span className="term-prompt">$</span>
        <span>{command}</span>
      </div>
      {body && <pre className="term-output">{body}</pre>}
      {exitCode !== null && (
        <div className={`term-exit${exitCode === 0 ? '' : ' failed'}`}>exit {exitCode}</div>
      )}
    </div>
  )
}

function parseTranscript(transcript: string): {
  command: string
  body: string
  exitCode: number | null
} {
  const lines = transcript.replace(/\n+$/, '').split('\n')
  const command = (lines.shift() ?? '').slice(2)
  let exitCode: number | null = null
  const match = /^exit (-?\d+)$/.exec(lines[lines.length - 1] ?? '')
  if (match) {
    exitCode = Number(match[1])
    lines.pop()
  }
  return { command, body: clampLines(lines).join('\n'), exitCode }
}

function looksLikeDiff(text: string): boolean {
  return text.startsWith('@@') || text.startsWith('+') || text.startsWith('-')
}

/** Unified diff from the write tool, coloured by line prefix. */
function DiffView({ diff }: { diff: string }): React.JSX.Element {
  const lines = useMemo(() => clampLines(diff.split('\n')), [diff])

  return (
    <div className="detail-diff">
      {lines.map((line, index) => {
        const kind = diffKind(line)
        // Hunk headers and the truncation notice are annotations, not content:
        // they have no gutter mark and no leading character to strip.
        if (kind === 'hunk' || kind === 'more') {
          return (
            <div key={index} className={`diff-line ${kind}`}>
              <span className="diff-text">{line}</span>
            </div>
          )
        }
        return (
          <div key={index} className={`diff-line ${kind}`}>
            <span className="diff-mark">{kind === 'context' ? '' : line.slice(0, 1)}</span>
            <span className="diff-text">{line.slice(1)}</span>
          </div>
        )
      })}
    </div>
  )
}

function diffKind(line: string): string {
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('…')) return 'more'
  return 'context'
}

/** File contents with a line gutter, so a quoted line number means something. */
function FileView({ content }: { content: string }): React.JSX.Element {
  const lines = useMemo(() => clampLines(content.split('\n')), [content])

  return (
    <div className="detail-file">
      {lines.map((line, index) => (
        <div key={index} className="file-line">
          <span className="file-ln">{index + 1}</span>
          <span className="file-text">{line}</span>
        </div>
      ))}
    </div>
  )
}

/** `d name` / `- name` rows from the list tool, directories first-class. */
function ListingView({ listing }: { listing: string }): React.JSX.Element {
  const entries = useMemo(
    () =>
      clampLines(listing.split('\n')).map((line) => ({
        isDirectory: line.startsWith('d '),
        name: /^[d-] /.test(line) ? line.slice(2) : line
      })),
    [listing]
  )

  return (
    <div className="detail-listing">
      {entries.map((entry, index) => (
        <div key={index} className={`listing-row${entry.isDirectory ? ' dir' : ''}`}>
          {entry.isDirectory ? <Folder size={12} /> : <FileText size={12} />}
          <span>{entry.name}</span>
        </div>
      ))}
    </div>
  )
}

function clampLines(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines
  return [...lines.slice(0, MAX_LINES), `… 其余 ${lines.length - MAX_LINES} 行未显示`]
}
