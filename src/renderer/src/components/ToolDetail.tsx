import { memo, useMemo } from 'react'
import { Folder, FileText } from 'lucide-react'
import type { ToolCallBlock } from '@shared/types'
import { tt } from '../i18n/useT'

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
  if (block.tool === 'terminal' && !output) {
    return (
      <div className="detail-terminal">
        <pre className="term-output">{tt('common.noOutput')}</pre>
      </div>
    )
  }
  if (block.tool === 'wait' || block.tool === 'read_bash_session') {
    return (
      <div className="detail-terminal">
        <pre className="term-output">{output || tt('common.noOutput')}</pre>
      </div>
    )
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
  if (block.tool === 'web_search' && output) {
    return <WebSearchView text={output} />
  }
  if (block.tool === 'web_fetch' && output) {
    return <WebFetchView text={output} />
  }
  if (block.tool === 'request' || block.tool === 'ask_user_question') {
    return (
      <div className="detail-qa">
        <div className="detail-question">{block.summary}</div>
        <div className="detail-answer">{output || tt('tool.detail.notAnswered')}</div>
      </div>
    )
  }

  return (
    <div className="detail-raw">
      <div className="detail-label">{tt('tool.detail.input')}</div>
      <pre>{block.input}</pre>
      <div className="detail-label">{tt('tool.detail.output')}</div>
      <pre>{output || tt('common.noOutput')}</pre>
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
        <div
          key={index}
          className={`listing-row${entry.isDirectory ? ' dir' : ''}`}
          title={entry.name}
        >
          {entry.isDirectory ? <Folder size={12} /> : <FileText size={12} />}
          <span>{entry.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Ranked hits from web_search — titles open in the system browser. */
function WebSearchView({ text }: { text: string }): React.JSX.Element {
  const { header, hits } = useMemo(() => parseWebSearch(text), [text])

  if (hits.length === 0) {
    return (
      <div className="detail-web">
        <pre className="web-body">{clampLines(text.split('\n')).join('\n')}</pre>
      </div>
    )
  }

  return (
    <div className="detail-web">
      {header && <div className="web-header">{header}</div>}
      <ol className="web-hits">
        {hits.map((hit) => (
          <li key={hit.rank} className="web-hit">
            <a className="web-title" href={hit.url} target="_blank" rel="noreferrer">
              {hit.title}
            </a>
            <div className="web-url">{hit.url}</div>
            {hit.snippet && <div className="web-snippet">{hit.snippet}</div>}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Fetched page body with a compact metadata strip. */
function WebFetchView({ text }: { text: string }): React.JSX.Element {
  const { meta, body } = useMemo(() => parseWebFetch(text), [text])
  return (
    <div className="detail-web">
      {meta.length > 0 && (
        <div className="web-meta">
          {meta.map((line, i) => (
            <div key={i} className="web-meta-line">
              {looksLikeUrl(line) ? (
                <a href={extractUrl(line)} target="_blank" rel="noreferrer">
                  {line}
                </a>
              ) : (
                line
              )}
            </div>
          ))}
        </div>
      )}
      <pre className="web-body">{clampLines(body.split('\n')).join('\n')}</pre>
    </div>
  )
}

function parseWebSearch(text: string): {
  header: string
  hits: Array<{ rank: number; title: string; url: string; snippet: string }>
} {
  const lines = text.replace(/\n+$/, '').split('\n')
  const header = lines[0]?.startsWith('Found ') || lines[0]?.startsWith('web_search')
    ? lines[0]!
    : ''
  const hits: Array<{ rank: number; title: string; url: string; snippet: string }> = []
  let current: { rank: number; title: string; url: string; snippet: string } | null = null

  for (const line of lines) {
    const head = /^(\d+)\.\s+\[web:\d+\]\s+(.+)$/.exec(line)
    if (head) {
      if (current) hits.push(current)
      current = { rank: Number(head[1]), title: head[2]!.trim(), url: '', snippet: '' }
      continue
    }
    if (!current) continue
    const url = /^\s*url:\s+(\S+)\s*$/.exec(line)
    if (url) {
      current.url = url[1]!
      continue
    }
    const snip = /^\s*snippet:\s+(.*)$/.exec(line)
    if (snip) {
      current.snippet = snip[1]!.trim()
    }
  }
  if (current) hits.push(current)
  return { header, hits }
}

function parseWebFetch(text: string): { meta: string[]; body: string } {
  const sep = text.indexOf('\n---\n')
  if (sep < 0) {
    // Title-only or error path
    const lines = text.split('\n')
    if (lines.length <= 6 && lines.some((l) => l.startsWith('final_url:') || l.startsWith('web_fetch'))) {
      return { meta: lines, body: '' }
    }
    return { meta: [], body: text }
  }
  const meta = text
    .slice(0, sep)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const body = text.slice(sep + 5).replace(/^\n/, '')
  return { meta, body }
}

function looksLikeUrl(line: string): boolean {
  return /https?:\/\//.test(line)
}

function extractUrl(line: string): string {
  const m = line.match(/https?:\/\/\S+/)
  return m?.[0] ?? line
}

function clampLines(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines
  return [
    ...lines.slice(0, MAX_LINES),
    tt('tool.moreLines', { n: lines.length - MAX_LINES })
  ]
}
