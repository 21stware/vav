import { memo, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  Pencil,
  Quote,
  RotateCcw
} from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { MarkdownView } from './MarkdownView'
import { ToolCard } from './ToolCard'
import { Button } from './ui'

interface MessageRowProps {
  message: ChatMessage
  highlight?: string
  isCurrentMatch?: boolean
  /** Branches hanging off this message: which one is showing, and how many. */
  branchIndex?: number
  branchCount?: number
  /** A turn is in flight: retrying or editing now would collide with it. */
  busy?: boolean
  onStepBranch?: (key: string, step: number) => void
  onRegenerate?: (messageId: string) => void
  onEdit?: (messageId: string, text: string) => void
  onQuote?: (message: ChatMessage) => void
  onFork?: (messageId: string) => void
  onContinueInNewSession?: (messageId: string) => void
}

/**
 * A finished message: a value row that never mutates again.
 *
 * `highlight` is only passed while in-transcript search is open, so normal
 * streaming never re-renders these (main-chat-search.rpml annotation 4).
 */
export const MessageRow = memo(function MessageRow({
  message,
  highlight,
  isCurrentMatch,
  branchIndex = 0,
  branchCount = 1,
  busy,
  onStepBranch,
  onRegenerate,
  onEdit,
  onQuote,
  onFork,
  onContinueInNewSession
}: MessageRowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)

  const classes = [
    'message',
    message.role,
    highlight ? 'search-hit' : '',
    isCurrentMatch ? 'search-current' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const pager = onStepBranch && branchCount > 1 && (
    <BranchPager
      index={branchIndex}
      count={branchCount}
      onStep={(step) => onStepBranch(message.id, step)}
    />
  )

  const onContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    const items: MenuItem[] = [
      {
        label: '复制',
        onSelect: () => void window.vav.conversations.copyToClipboard(message.content)
      }
    ]
    if (message.role === 'user' && onEdit) {
      items.push({ label: '编辑并重新提问', disabled: busy, onSelect: () => setEditing(true) })
    }
    if (onRegenerate) {
      items.push({
        label: message.role === 'user' ? '重新回答' : '重新生成',
        disabled: busy,
        onSelect: () => onRegenerate(message.id)
      })
    }
    if (onQuote) items.push({ label: '引用到输入框', onSelect: () => onQuote(message) })
    items.push({ label: '', divider: true })
    if (onFork) {
      items.push({ label: '从此处开新分支', disabled: busy, onSelect: () => onFork(message.id) })
    }
    if (onContinueInNewSession) {
      items.push({
        label: '在新会话中继续',
        onSelect: () => onContinueInNewSession(message.id)
      })
    }
    void showMenu(items)
  }

  if (message.role === 'system') {
    return (
      <div className={classes} id={`msg-${message.id}`}>
        {message.content}
      </div>
    )
  }

  if (message.role === 'user') {
    if (editing) {
      return (
        <UserEditor
          initial={message.content}
          onCancel={() => setEditing(false)}
          onSubmit={(text) => {
            setEditing(false)
            onEdit?.(message.id, text)
          }}
        />
      )
    }
    return (
      <div className="message-group user" onContextMenu={onContextMenu}>
        <div className={classes} id={`msg-${message.id}`}>
          {message.content}
        </div>
        <div className="message-actions">
          {pager}
          {onEdit && (
            <Button
              icon={<Pencil size={12} />}
              size="sm"
              title="编辑并重新提问"
              disabled={busy}
              onClick={() => setEditing(true)}
            />
          )}
          {onRegenerate && (
            <Button
              icon={<RotateCcw size={12} />}
              size="sm"
              title="重新回答"
              disabled={busy}
              onClick={() => onRegenerate(message.id)}
            />
          )}
          {onFork && (
            <Button
              icon={<GitBranch size={12} />}
              size="sm"
              title="从此处开新分支"
              disabled={busy}
              onClick={() => onFork(message.id)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={classes} id={`msg-${message.id}`} onContextMenu={onContextMenu}>
      {message.blocks.map((block, index) => {
        if (block.kind === 'reasoning') {
          return (
            <details className="reasoning" key={`r${index}`}>
              <summary>思考过程</summary>
              <div className="reasoning-body">{block.text}</div>
            </details>
          )
        }
        if (block.kind === 'toolCall') {
          return <ToolCard key={block.id} block={block} />
        }
        return <MarkdownView key={`t${index}`} source={block.text} highlight={highlight} />
      })}

      {message.cancelled && <div className="message system">已取消本轮</div>}

      <div className="message-actions">
        {pager}
        <Button
          icon={<Copy size={12} />}
          size="sm"
          title="复制"
          onClick={() => void window.vav.conversations.copyToClipboard(message.content)}
        />
        {onRegenerate && (
          <Button
            icon={<RotateCcw size={12} />}
            size="sm"
            title="重新生成"
            disabled={busy}
            onClick={() => onRegenerate(message.id)}
          />
        )}
        {onQuote && (
          <Button icon={<Quote size={12} />} size="sm" title="引用" onClick={() => onQuote(message)} />
        )}
        {onFork && (
          <Button
            icon={<GitBranch size={12} />}
            size="sm"
            title="从此处开新分支"
            disabled={busy}
            onClick={() => onFork(message.id)}
          />
        )}
      </div>
    </div>
  )
})

/** `‹ 2/3 ›` — steps between the branches hanging off one point of the thread. */
export function BranchPager({
  index,
  count,
  onStep
}: {
  index: number
  count: number
  onStep: (step: number) => void
}): React.JSX.Element {
  return (
    <div className="variant-pager">
      <button
        className="variant-step"
        title="上一个分支"
        disabled={index <= 0}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={12} />
      </button>
      <span className="variant-count">
        {index + 1}/{count}
      </span>
      <button
        className="variant-step"
        title="下一个分支"
        disabled={index >= count - 1}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  )
}

function UserEditor({
  initial,
  onSubmit,
  onCancel
}: {
  initial: string
  onSubmit: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== initial.trim()) onSubmit(trimmed)
    else onCancel()
  }

  return (
    <div className="message-group user">
      <div className="message user editing">
        <textarea
          ref={ref}
          className="message-editor"
          value={text}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel()
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          }}
        />
      </div>
      <div className="message-actions">
        <Button label="取消" size="sm" onClick={onCancel} />
        <Button label="发送" size="sm" variant="primary" onClick={submit} />
      </div>
    </div>
  )
}
