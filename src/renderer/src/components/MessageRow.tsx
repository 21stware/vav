import { memo, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpLeft,
  GitBranch,
  Pencil,
  Quote,
  RotateCcw
} from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { MarkdownView } from './MarkdownView'
import { ReasoningBlock } from './ReasoningBlock'
import { StreamStatus } from './StreamStatus'
import { ToolCard } from './ToolCard'
import { Button } from './ui'

interface MessageRowProps {
  message: ChatMessage
  highlight?: string
  isCurrentMatch?: boolean
  /** Bumped when this row should flash after a quote jump. */
  flash?: number
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

/** Long enough that a collapsed preview + expand control is worth the chrome. */
const USER_COLLAPSE_CHARS = 280
const USER_COLLAPSE_LINES = 5

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
  flash = 0,
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
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const [branchPulse, setBranchPulse] = useState(0)
  const [branchSwitching, setBranchSwitching] = useState(false)
  const prevBranchIndex = useRef(branchIndex)
  const scrollToMessage = useSessionStore((s) => s.scrollToMessage)

  useEffect(() => {
    if (!flash) return
    setFlashing(true)
    const timer = window.setTimeout(() => setFlashing(false), 1500)
    return () => window.clearTimeout(timer)
  }, [flash])

  // Branch switch: brief content pulse so 1/2 → 2/2 is obvious.
  useEffect(() => {
    if (prevBranchIndex.current === branchIndex) return
    prevBranchIndex.current = branchIndex
    setBranchPulse((n) => n + 1)
    setBranchSwitching(false)
    const frame = window.requestAnimationFrame(() => setBranchSwitching(true))
    const timer = window.setTimeout(() => setBranchSwitching(false), 280)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [branchIndex])

  const classes = [
    'message',
    message.role,
    highlight ? 'search-hit' : '',
    isCurrentMatch ? 'search-current' : '',
    flashing ? 'quote-flash' : '',
    branchSwitching ? 'branch-switch' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const pager = onStepBranch && branchCount > 1 && (
    <BranchPager
      index={branchIndex}
      count={branchCount}
      pulseKey={branchPulse}
      onStep={(step) => onStepBranch(message.id, step)}
    />
  )

  const onContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    const items: MenuItem[] = [
      {
        label: t('message.copy'),
        onSelect: () => void window.vav.conversations.copyToClipboard(message.content)
      }
    ]
    if (message.role === 'user' && onEdit) {
      items.push({
        label: t('message.editResend'),
        disabled: busy,
        onSelect: () => setEditing(true)
      })
    }
    if (onRegenerate) {
      items.push({
        label: message.role === 'user' ? t('message.retry') : t('message.regenerate'),
        disabled: busy,
        onSelect: () => onRegenerate(message.id)
      })
    }
    if (onQuote) items.push({ label: t('message.quote'), onSelect: () => onQuote(message) })
    items.push({ label: '', divider: true })
    if (onFork) {
      items.push({
        label: t('message.branchHere'),
        disabled: busy,
        onSelect: () => onFork(message.id)
      })
    }
    if (onContinueInNewSession) {
      items.push({
        label: t('message.continueInNew'),
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

    const lineCount = message.content.split('\n').length
    const collapsible =
      message.content.length > USER_COLLAPSE_CHARS || lineCount > USER_COLLAPSE_LINES
    const collapsed = collapsible && !expanded

    return (
      <div className="message-turn user" onContextMenu={onContextMenu}>
        <div className="message-role">You</div>
        <div className="message-group user">
          {message.quoteSummary && message.quoteMessageId && (
            <button
              type="button"
              className="message-quote-ref"
              title={t('composer.quoteJump')}
              onClick={() => scrollToMessage(message.quoteMessageId!)}
            >
              <CornerUpLeft size={12} />
              <span>{message.quoteSummary}</span>
            </button>
          )}
          <div
            className={`${classes}${collapsed ? ' is-collapsed' : ''}`}
            id={`msg-${message.id}`}
          >
            {message.content}
          </div>
          <div className="message-actions">
            {onEdit && (
              <Button
                icon={<Pencil size={12} />}
                size="sm"
                title={t('message.editResend')}
                disabled={busy}
                onClick={() => setEditing(true)}
              />
            )}
            {onRegenerate && (
              <Button
                icon={<RotateCcw size={12} />}
                size="sm"
                title={t('message.retry')}
                disabled={busy}
                onClick={() => onRegenerate(message.id)}
              />
            )}
            {onQuote && (
              <Button
                icon={<Quote size={12} />}
                size="sm"
                title={t('message.quote')}
                onClick={() => onQuote(message)}
              />
            )}
            {onFork && (
              <Button
                icon={<GitBranch size={12} />}
                size="sm"
                title={t('message.branchHere')}
                disabled={busy}
                onClick={() => onFork(message.id)}
              />
            )}
          </div>
          {pager}
        </div>
        {collapsible && (
          <button
            type="button"
            className="message-collapse-toggle"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('common.collapse') : t('common.expand')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="message-turn assistant" onContextMenu={onContextMenu}>
      <div className="message-role">Agent</div>
      <div className={classes} id={`msg-${message.id}`}>
        {message.blocks.map((block, index) => {
          if (block.kind === 'reasoning') {
            return <ReasoningBlock key={`r${index}`} text={block.text} />
          }
          if (block.kind === 'plan') {
            // Legacy PlanBlock rows, if any, are ignored in favour of plan tools.
            return null
          }
          if (block.kind === 'toolCall') {
            if (block.tool === 'plan') return null
            return <ToolCard key={block.id} block={block} />
          }
          return <MarkdownView key={`t${index}`} source={block.text} highlight={highlight} />
        })}

        {message.cancelled && <div className="message system">{t('message.cancelled')}</div>}

        <div className="message-actions">
          <Button
            icon={<Copy size={12} />}
            size="sm"
            title={t('message.copy')}
            onClick={() => void window.vav.conversations.copyToClipboard(message.content)}
          />
          {onRegenerate && (
            <Button
              icon={<RotateCcw size={12} />}
              size="sm"
              title={t('message.regenerate')}
              disabled={busy}
              onClick={() => onRegenerate(message.id)}
            />
          )}
          {onQuote && (
            <Button icon={<Quote size={12} />} size="sm" title={t('message.quote')} onClick={() => onQuote(message)} />
          )}
          {onFork && (
            <Button
              icon={<GitBranch size={12} />}
              size="sm"
              title={t('message.branchHere')}
              disabled={busy}
              onClick={() => onFork(message.id)}
            />
          )}
        </div>

        <div className="message-footer">
          {pager}
          {!message.cancelled && !message.errorText && <StreamStatus state="done" />}
        </div>
      </div>
    </div>
  )
})

/** `‹ 2/3 ›` — steps between the branches hanging off one point of the thread. */
export function BranchPager({
  index,
  count,
  pulseKey = 0,
  onStep
}: {
  index: number
  count: number
  /** Bumps when the active branch changes — drives the count pop. */
  pulseKey?: number
  onStep: (step: number) => void
}): React.JSX.Element {
  const t = useT()

  return (
    <div className="variant-pager" data-pulse={pulseKey > 0 ? pulseKey : undefined}>
      <button
        className="variant-step"
        title={t('message.prevBranch')}
        disabled={index <= 0}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={13} />
      </button>
      <span key={pulseKey} className="variant-count">
        {index + 1}/{count}
      </span>
      <button
        className="variant-step"
        title={t('message.nextBranch')}
        disabled={index >= count - 1}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={13} />
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
  const t = useT()
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
    <div className="message-turn user">
      <div className="message-role">You</div>
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
          <Button label={t('common.cancel')} size="sm" onClick={onCancel} />
          <Button label={t('composer.send')} size="sm" variant="primary" onClick={submit} />
        </div>
      </div>
    </div>
  )
}
