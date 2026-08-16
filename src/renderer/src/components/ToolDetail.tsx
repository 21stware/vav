import { memo, useMemo } from 'react'
import { Folder, FileText } from 'lucide-react'
import type { ToolCallBlock } from '@shared/types'
import { tt, useT } from '../i18n/useT'
import { parseToolInput } from '@shared/askPlan'
import { normalizePlanDocInput } from '@shared/planDoc'
import { parseTerminalOutputBlocks } from '../lib/previewBlocks'
import { MarkdownView } from './MarkdownView'
import {
  factLabelKey,
  outcomeFor,
  parseFetchedPage,
  presentToolArgs,
  prettyToolInput,
  shouldShowTechnical,
  type PresentableFact,
  type ToolOutcome
} from '../lib/toolPresentation'
import { TextBlockPick } from './TextBlockPick'

/** Rendering every line of a large result costs more than it explains. */
const MAX_LINES = 400

/**
 * The expanded half of a tool card.
 *
 * Each tool produced a specific kind of artefact, so each gets a view that
 * knows what it is looking at: a shell transcript reads as a terminal, a write
 * reads as a diff, a read reads as a numbered file. Anything else — including
 * a failed fetch with no body — is a short story: what it tried, then what
 * happened. Raw JSON stays behind a disclosure.
 */
export const ToolDetail = memo(function ToolDetail({
  block
}: {
  block: ToolCallBlock
}): React.JSX.Element {
  const output = block.output || ''

  if (block.tool === 'terminal' && output.startsWith('$ ')) {
    return <TerminalLog transcript={output} sourceId={block.id} />
  }
  if (block.tool === 'terminal') {
    return (
      <div className="detail-terminal">
        {output ? (
          <TerminalOutputPick text={output} sourceId={block.id} />
        ) : (
          <pre className="term-output">{tt('common.noOutput')}</pre>
        )}
      </div>
    )
  }
  if (block.tool === 'wait' || block.tool === 'read_bash_session') {
    return (
      <div className="detail-terminal">
        {output ? (
          <TerminalOutputPick text={output} sourceId={`${block.tool}:${block.id}`} />
        ) : (
          <pre className="term-output">{tt('common.noOutput')}</pre>
        )}
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
  if (block.tool === 'web_search') {
    return <WebSearchView block={block} />
  }
  if (block.tool === 'web_fetch') {
    return <WebFetchView block={block} />
  }
  if (block.tool === 'plan_doc') {
    const doc = normalizePlanDocInput(parseToolInput(block.input))
    return (
      <div className="detail-plan-doc">
        {doc.overview && <div className="plan-doc-overview">{doc.overview}</div>}
        {doc.plan ? <MarkdownView source={doc.plan} /> : <pre className="story-body">{output || tt('tool.detail.emptyGeneric')}</pre>}
      </div>
    )
  }
  if (block.tool === 'request' || block.tool === 'ask_user_question') {
    return (
      <div className="detail-qa">
        <div className="detail-question">{block.summary}</div>
        <div className="detail-answer">{output || tt('tool.detail.notAnswered')}</div>
      </div>
    )
  }
  if (block.tool === 'task' && (block.children?.length ?? 0) > 0) {
    // Nested transcript + result render after this in ToolCard.
    return <StoryView block={{ ...block, output: '' }} />
  }

  return <StoryView block={block} />
})

/** `$ cmd` … `exit N` — the shape StickyShell mirrors into the Agent tab. */
function TerminalOutputPick({
  text,
  sourceId
}: {
  text: string
  sourceId: string
}): React.JSX.Element {
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  const blocks = useMemo(() => parseTerminalOutputBlocks(text), [text])
  return (
    <TextBlockPick
      className="term-output"
      lines={lines}
      blocks={blocks}
      sourcePath={`terminal:${sourceId}`}
      badge="TERM"
      renderLine={(line) => line || ' '}
    />
  )
}

function TerminalLog({
  transcript,
  sourceId
}: {
  transcript: string
  sourceId: string
}): React.JSX.Element {
  const { command, body, exitCode } = useMemo(() => parseTranscript(transcript), [transcript])

  return (
    <div className="detail-terminal">
      <div className="term-command">
        <span className="term-prompt">$</span>
        <span>{command}</span>
      </div>
      {body ? <TerminalOutputPick text={body} sourceId={sourceId} /> : null}
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
function WebSearchView({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const text = block.output || ''
  const { header, hits } = useMemo(() => parseWebSearch(text), [text])
  const failed = block.status === 'error' || block.status === 'expired'

  if (failed || !text || hits.length === 0) {
    if (!failed && text) {
      return (
        <div className="detail-web">
          <pre className="web-body">{clampLines(text.split('\n')).join('\n')}</pre>
        </div>
      )
    }
    return <StoryView block={block} />
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

/** Fetched page body with a compact metadata strip. Empty/failed → a story. */
function WebFetchView({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const text = block.output || ''
  const failed =
    block.status === 'error' ||
    block.status === 'expired' ||
    /^web_fetch failed/i.test(text.trim())
  const page = useMemo(() => parseFetchedPage(text), [text])

  if (failed || !text) {
    return <StoryView block={block} />
  }

  return (
    <div className="detail-web">
      {(page.title || page.url) && (
        <div className="web-meta">
          {page.title ? <div className="web-page-title">{page.title}</div> : null}
          {page.url ? (
            <a className="web-page-url" href={page.url} target="_blank" rel="noreferrer">
              {page.url}
            </a>
          ) : null}
        </div>
      )}
      <pre className="web-body">{clampLines(page.body.split('\n')).join('\n')}</pre>
    </div>
  )
}

/**
 * Default expanded view: the thing it tried (link, path, query) and a sentence
 * about what happened. Implementation JSON is one click further.
 */
function StoryView({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const t = useT()
  const presented = useMemo(
    () => presentToolArgs(block.tool, block.input, block.summary),
    [block.tool, block.input, block.summary]
  )
  const outcome = useMemo(() => outcomeFor(block), [block])
  const pretty = useMemo(() => prettyToolInput(block.input), [block.input])
  const unusedOutput = outcome.kind === 'body' ? '' : block.output || ''
  const showTech = shouldShowTechnical(presented.extraArgs, unusedOutput)

  return (
    <div className="detail-story">
      {presented.facts.length > 0 && (
        <div className="story-facts">
          {presented.facts.map((fact, index) => (
            <FactRow key={`${fact.kind}-${index}`} fact={fact} />
          ))}
        </div>
      )}
      <OutcomeBlock outcome={outcome} />
      {showTech && (
        <details className="story-tech">
          <summary>{t('tool.detail.technical')}</summary>
          {pretty ? <pre className="story-tech-pre">{pretty}</pre> : null}
          {unusedOutput.trim() ? <pre className="story-tech-pre">{unusedOutput}</pre> : null}
        </details>
      )}
    </div>
  )
}

function FactRow({ fact }: { fact: PresentableFact }): React.JSX.Element {
  const t = useT()
  const labelKey = factLabelKey(fact.kind)
  return (
    <div className={`story-fact is-${fact.kind}`}>
      {labelKey ? <div className="story-fact-label">{t(labelKey)}</div> : null}
      {fact.kind === 'url' ? (
        <a
          className="story-fact-value"
          href={fact.value}
          target="_blank"
          rel="noreferrer"
          title={t('tool.detail.openLink')}
        >
          {fact.value}
        </a>
      ) : (
        <div className="story-fact-value">{fact.value}</div>
      )}
    </div>
  )
}

function OutcomeBlock({ outcome }: { outcome: ToolOutcome }): React.JSX.Element | null {
  const t = useT()
  if (outcome.kind === 'none') return null
  if (outcome.kind === 'body') {
    return <pre className="story-body">{clampLines(outcome.text.split('\n')).join('\n')}</pre>
  }
  const support =
    outcome.kind === 'error'
      ? outcome.detailKey
        ? t(outcome.detailKey)
        : outcome.detailText
      : undefined
  return (
    <div className={`story-outcome is-${outcome.kind}`}>
      <div className="story-headline">{t(outcome.headline)}</div>
      {support ? <div className="story-support">{support}</div> : null}
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

function clampLines(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines
  return [
    ...lines.slice(0, MAX_LINES),
    tt('tool.moreLines', { n: lines.length - MAX_LINES })
  ]
}
