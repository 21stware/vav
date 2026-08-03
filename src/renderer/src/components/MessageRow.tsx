import { memo, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpLeft,
  FileDiff,
  FileText,
  GitBranch,
  MessageSquare,
  Paperclip,
  Pencil,
  Quote,
  RotateCcw,
  Undo2
} from 'lucide-react'
import type { ChatMessage, PreviewRef } from '@shared/types'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { basename } from '../lib/path'
import { formatBadge } from '../lib/previewBlocks'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { InlineChangeReview } from './InlineChangeReview'
import { MarkdownView } from './MarkdownView'
import { ReasoningBlock } from './ReasoningBlock'
import { StreamStatus } from './StreamStatus'
import { ToolCard } from './ToolCard'
import { Button } from './ui'

/** Paths touched by write/delete tools on this assistant message. */
function writePathsOf(message: ChatMessage): string[] {
  const paths: string[] = []
  for (const block of message.blocks) {
    if (block.kind !== 'toolCall') continue
    if (block.tool !== 'fs_write') continue
    try {
      const input = JSON.parse(block.input) as { path?: string }
      if (input.path) paths.push(input.path)
    } catch {
      // ignore
    }
  }
  return [...new Set(paths)]
}

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

    const body = message.content
    const lineCount = body.split('\n').length
    const collapsible = body.length > USER_COLLAPSE_CHARS || lineCount > USER_COLLAPSE_LINES
    const collapsed = collapsible && !expanded
    const hasBody = body.trim().length > 0

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
          <UserMessageContext
            contextFile={message.contextFile}
            contextBlocks={message.contextBlocks}
            attachments={message.attachments}
          />
          {hasBody && (
            <div
              className={`${classes}${collapsed ? ' is-collapsed' : ''}`}
              id={`msg-${message.id}`}
            >
              {body}
            </div>
          )}
          {!hasBody && (
            <div className={`${classes} is-context-only`} id={`msg-${message.id}`} />
          )}
          <div className="message-actions">
            {onEdit && (
              <Button
                icon={<Pencil size={12} />}
                size="sm"
                title={busy ? t('message.editWhileRunning') : t('message.editResend')}
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
            title={expanded ? t('common.collapse') : t('common.expand')}
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

        {message.changeSetId && (
          <div id={`inline-review-${message.changeSetId}`}>
            <InlineChangeReview changeSetId={message.changeSetId} />
          </div>
        )}

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
          {message.changeSetId && (
            <Button
              icon={<FileDiff size={12} />}
              size="sm"
              title={t('message.reviewChanges')}
              onClick={() => {
                document
                  .getElementById(`inline-review-${message.changeSetId}`)
                  ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
              }}
            />
          )}
          {writePathsOf(message).length > 0 && (
            <>
              <Button
                icon={<Undo2 size={12} />}
                size="sm"
                title={t('message.revertWorkspace')}
                disabled={busy}
                onClick={() => {
                  const paths = writePathsOf(message)
                  const store = useSessionStore.getState()
                  void (async () => {
                    const active = message.changeSetId
                      ? await window.vav.changeSets.get(message.changeSetId)
                      : store.pendingReviewByConversation[store.activeId]
                        ? await window.vav.changeSets.get(
                            store.pendingReviewByConversation[store.activeId]!.changeSetId
                          )
                        : await window.vav.changeSets.active(store.activeId)
                    if (!active) {
                      store.showToast({
                        kind: 'info',
                        title: t('message.revertWorkspace'),
                        description: t('review.noPending')
                      })
                      return
                    }
                    const targets = active.files
                      .filter(
                        (f) =>
                          f.status === 'pending' || f.status === 'accepted' || f.status === 'edited'
                      )
                      .map((f) => f.filePath)
                      .filter((p) => paths.some((w) => p === w || p.endsWith(w) || w.endsWith(p)))
                    if (targets.length === 0) {
                      store.showToast({
                        kind: 'info',
                        title: t('message.revertWorkspace'),
                        description: t('review.noPending')
                      })
                      return
                    }
                    store.showDialog({
                      title: t('message.revertWorkspace'),
                      body: t('message.revertConfirm', { n: targets.length }),
                      confirmLabel: t('message.revertWorkspace'),
                      destructive: true,
                      onConfirm: () => {
                        void (async () => {
                          // Prefer reject (restores original) for pending; undo for already accepted.
                          const pendingPaths = active.files
                            .filter((f) => targets.includes(f.filePath) && f.status === 'pending')
                            .map((f) => f.filePath)
                          const acceptedPaths = active.files
                            .filter(
                              (f) =>
                                targets.includes(f.filePath) &&
                                (f.status === 'accepted' || f.status === 'edited')
                            )
                            .map((f) => f.filePath)
                          if (pendingPaths.length) {
                            await window.vav.changeSets.reject(active.id, pendingPaths)
                          }
                          for (const p of acceptedPaths) {
                            await window.vav.changeSets.undo(active.id, p)
                          }
                          await store.refreshChangeSet()
                          store.showToast({
                            kind: 'success',
                            title: t('message.revertDone'),
                            description: t('message.revertDoneDesc', { n: targets.length })
                          })
                        })()
                      }
                    })
                  })()
                }}
              />
            </>
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

/**
 * Read-only replay of composer context: file chip, comment cards, selection
 * chips, attachment chips — same shapes the user saw when sending.
 */
function UserMessageContext({
  contextFile,
  contextBlocks,
  attachments
}: {
  contextFile?: string
  contextBlocks?: PreviewRef[]
  attachments?: string[]
}): React.JSX.Element | null {
  const t = useT()
  const blocks = contextBlocks ?? []
  const files = attachments ?? []
  const commented = blocks.filter((r) => (r.comment ?? '').trim().length > 0)
  // When comment cards are present, the composer hides the plain selection chips
  // that duplicate those refs; mirror that: only show chip for uncommented refs.
  const commentedIds = new Set(commented.map((r) => r.id))
  const plainRefs = blocks.filter((r) => !commentedIds.has(r.id))
  // Composer also hides the file chip when comment cards are showing.
  const showFile = Boolean(contextFile && commented.length === 0)

  if (!showFile && commented.length === 0 && plainRefs.length === 0 && files.length === 0) {
    return null
  }

  return (
    <div className="message-user-context">
      {showFile && contextFile && (
        <div className="file-context-chip is-readonly" title={contextFile}>
          <FileText size={14} aria-hidden />
          <span className="file-context-chip-label">
            {[basename(contextFile), formatBadge(contextFile, 'text')].filter(Boolean).join(' · ')}
            <span className="file-context-chip-suffix"> — {t('composer.fileContextAttached')}</span>
          </span>
        </div>
      )}
      {commented.length > 0 && (
        <div className="message-comment-rows" role="list">
          {commented.map((ref) => {
            const title =
              ref.label ||
              (ref.startLine === ref.endLine
                ? `L${ref.startLine}`
                : `L${ref.startLine}–${ref.endLine}`)
            const note = (ref.comment ?? '').trim()
            const tip = [
              ref.filePath,
              `L${ref.startLine}–${ref.endLine}`,
              note || null
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <div className="message-comment-row" key={ref.id} role="listitem" title={tip}>
                <MessageSquare size={12} strokeWidth={2} className="message-comment-row-icon" />
                <span className="message-comment-row-title">{title}</span>
                {note ? (
                  <>
                    <span className="message-comment-row-sep" aria-hidden>
                      ·
                    </span>
                    <span className="message-comment-row-note">{note}</span>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {plainRefs.length > 0 && (
        <div className="context-refs">
          {plainRefs.map((ref) => (
            <span
              className="chip context-ref-chip"
              key={ref.id}
              title={`${ref.filePath} · L${ref.startLine}–${ref.endLine}`}
            >
              <Quote size={11} />
              <span className="chip-label">{ref.label}</span>
              <span className="context-ref-lines">
                L{ref.startLine}–{ref.endLine}
              </span>
            </span>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="attachments">
          {files.map((path) => (
            <span className="chip" key={path} title={path}>
              <Paperclip size={11} />
              <span className="chip-label">{basename(path)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

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
        {/*
          Dedicated row — do NOT use .message-actions here.
          That class is hover icon chrome and forces tertiary text onto primary.
        */}
        <div className="message-edit-actions">
          <Button label={t('common.cancel')} size="sm" onClick={onCancel} />
          <Button label={t('composer.send')} size="sm" variant="primary" onClick={submit} />
        </div>
      </div>
    </div>
  )
}
