import { memo, useMemo, useState } from 'react'
import {
  Check,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  FileText,
  FolderTree,
  Loader2,
  MessageCircleQuestion,
  ShieldQuestion,
  Terminal
} from 'lucide-react'
import { TOOL_LABELS, type ToolCallBlock, type ToolName } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { ToolDetail } from './ToolDetail'
import { Button, InlineAlert } from './ui'

const TOOL_ICONS: Record<ToolName, React.ElementType> = {
  terminal: Terminal,
  fs_read: FileText,
  fs_write: FilePenLine,
  fs_list: FolderTree,
  request: ShieldQuestion,
  ask_user_question: MessageCircleQuestion
}

/** Only states worth interrupting the reader for get words. */
const STATUS_LABEL: Partial<Record<ToolCallBlock['status'], string>> = {
  pending: '待执行',
  executing: '执行中',
  error: '失败',
  skipped: '已跳过',
  expired: '已过期'
}

/**
 * A tool call in the transcript.
 *
 * Deliberately not a panel: a tool call is a line of the assistant's turn, not
 * a document attached to it. Collapsed it is one row — icon, name, argument,
 * outcome — and the chrome only appears under the pointer. The weight belongs
 * to what the tool produced, which is one click away in {@link ToolDetail}.
 *
 * `request` / `ask_user_question` in the `pending` state render as an
 * interactive card instead, because that turn is parked until the user answers
 * (main-chat-awaiting-user.rpml).
 */
export const ToolCard = memo(function ToolCard({
  block
}: {
  block: ToolCallBlock
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const isInteractive = block.tool === 'request' || block.tool === 'ask_user_question'

  const headline = useMemo(() => summaryFor(block), [block])

  if (isInteractive && block.status === 'pending') {
    return <AskCard block={block} />
  }

  const Icon = TOOL_ICONS[block.tool] ?? Terminal
  const label = STATUS_LABEL[block.status]

  return (
    <div
      className={`tool-call${expanded ? ' expanded' : ''}`}
      data-tool={block.tool}
      data-status={block.status}
    >
      <button className="tool-row" onClick={() => setExpanded(!expanded)}>
        <ChevronRight className="tool-chevron" size={11} />
        <Icon className="tool-glyph" size={12} />
        <span className="tool-name">{TOOL_LABELS[block.tool] ?? block.tool}</span>
        <span className="tool-summary">{headline}</span>
        {block.status === 'executing' && <Loader2 className="spin tool-mark" size={11} />}
        {block.status === 'completed' && <Check className="tool-mark done" size={12} />}
        {block.status === 'error' && <CircleAlert className="tool-mark failed" size={12} />}
        {label && <span className={`tool-state ${block.status}`}>{label}</span>}
      </button>

      {/* Kept mounted and collapsed by grid rows, so reopening mid-close
          retargets from where it is instead of restarting. */}
      <div className="tool-detail" aria-hidden={!expanded}>
        <div className="tool-detail-inner">{expanded && <ToolDetail block={block} />}</div>
      </div>
    </div>
  )
})

/** Writes get their edit size on the collapsed row; the path is already there. */
function summaryFor(block: ToolCallBlock): string {
  if (block.tool !== 'fs_write' || !block.output.startsWith('@@')) return block.summary
  let added = 0
  let removed = 0
  for (const line of block.output.split('\n')) {
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return `${block.summary}  +${added} −${removed}`
}

function AskCard({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const answerTool = useSessionStore((s) => s.answerTool)
  const [draft, setDraft] = useState('')

  if (block.tool === 'request') {
    return (
      <div className="ask-card request">
        <InlineAlert kind="warning" title="Request" message={block.summary} />
        <div className="ask-actions">
          <Button label="允许" variant="primary" onClick={() => void answerTool(block.id, '允许')} />
          <Button label="拒绝" variant="danger" onClick={() => void answerTool(block.id, '拒绝')} />
        </div>
        <input
          className="text-field"
          placeholder="或补充说明后提交…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) void answerTool(block.id, draft.trim())
          }}
        />
      </div>
    )
  }

  const choices = block.choices ?? []
  return (
    <div className="ask-card">
      <div className="ask-title">Ask · {block.summary}</div>
      {choices.length > 0 ? (
        <div className="ask-actions">
          {choices.map((choice, index) => (
            <Button
              key={choice}
              label={choice}
              variant={index === 0 ? 'primary' : 'secondary'}
              onClick={() => void answerTool(block.id, choice)}
            />
          ))}
        </div>
      ) : (
        <div className="ask-actions" style={{ flexWrap: 'nowrap' }}>
          <input
            className="text-field"
            autoFocus
            placeholder="你的回答…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim()) void answerTool(block.id, draft.trim())
            }}
          />
          <Button
            label="提交"
            variant="primary"
            disabled={!draft.trim()}
            onClick={() => void answerTool(block.id, draft.trim())}
          />
        </div>
      )}
    </div>
  )
}
