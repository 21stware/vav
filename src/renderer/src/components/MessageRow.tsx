import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpLeft,
  FileDiff,
  FileText,
  GitBranch,
  MessageSquare,
  Pencil,
  Quote,
  RotateCcw,
  Trash2,
  Undo2
} from 'lucide-react'
import type { ChatMessage, PreviewRef, TextBlock } from '@shared/types'
import { AttachmentTile } from './ComposerAttachments'
import { markdownToPlainText } from '@shared/markdownPlain'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { basename } from '../lib/path'
import { formatBadge } from '../lib/previewBlocks'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { InlineChangeReview } from './InlineChangeReview'
import { MarkdownView } from './MarkdownView'
import { ReasoningBlock } from './ReasoningBlock'
import { ThinkingProcess } from './ThinkingProcess'
import { processThoughtMs, splitAssistantProcess } from '../lib/assistantProcess'

import { ToolCard } from './ToolCard'
import { Button } from './ui'

function messageMarkdown(message: ChatMessage): string {
  const parts = message.blocks
    .filter((block): block is TextBlock => block.kind === 'text')
    .map((block) => block.text)
    .filter((text) => text.length > 0)
  return parts.join('\n\n') || message.content || ''
}

/** Visible selection that intersects `root`, or empty if the range is elsewhere. */
function selectedTextIn(root: EventTarget | null): string {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
  const text = selection.toString()
  if (!text) return ''
  if (!(root instanceof Element)) return text
  try {
    return selection.getRangeAt(0).intersectsNode(root) ? text : ''
  } catch {
    return ''
  }
}

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
  onDelete?: (messageId: string) => void
}

/** Long enough that a collapsed preview + expand control is worth the chrome. */
const USER_COLLAPSE_CHARS = 280
const USER_COLLAPSE_LINES = 5

/**
 * Message action icon button with post-click feedback (Emil: state indication).
 * - `check`: blur → Check → restore (copy / quote / fork)
 * - `spin`: one-shot RotateCcw spin (regenerate)
 * - false: press scale only (opens another surface)
 */
function MessageActionButton({
  icon,
  title,
  doneTitle,
  disabled,
  ack = 'check',
  testId,
  onClick
}: {
  icon: ReactNode
  title: string
  doneTitle?: string
  disabled?: boolean
  ack?: 'check' | 'spin' | false
  testId?: string
  onClick: () => void | Promise<void>
}): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'out' | 'done'>('idle')
  const [showDone, setShowDone] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    return () => {
      for (const id of timers.current) window.clearTimeout(id)
    }
  }, [])

  const clearTimers = (): void => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }

  const playAck = (): void => {
    if (!ack) return
    clearTimers()
    if (ack === 'spin') {
      setShowDone(false)
      setPhase('done')
      timers.current.push(
        window.setTimeout(() => {
          setPhase('idle')
        }, 480)
      )
      return
    }
    setPhase('out')
    timers.current.push(
      window.setTimeout(() => {
        setShowDone(true)
        setPhase('done')
      }, 100),
      window.setTimeout(() => {
        setPhase('out')
      }, 980),
      window.setTimeout(() => {
        setShowDone(false)
        setPhase('idle')
      }, 1100)
    )
  }

  return (
    <Button
      className={[
        'message-action-btn',
        phase !== 'idle' ? `is-ack-${phase}` : '',
        ack === 'spin' && phase === 'done' ? 'is-ack-spin' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      icon={
        <span className="message-action-glyph" aria-hidden>
          {showDone ? <Check size={12} strokeWidth={2.25} /> : icon}
        </span>
      }
      size="sm"
      testId={testId}
      title={showDone && doneTitle ? doneTitle : title}
      disabled={disabled}
      onClick={() => {
        void Promise.resolve(onClick()).finally(() => {
          playAck()
        })
      }}
    />
  )
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
  flash = 0,
  branchIndex = 0,
  branchCount = 1,
  busy,
  onStepBranch,
  onRegenerate,
  onEdit,
  onQuote,
  onFork,
  onContinueInNewSession,
  onDelete
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
    const selected = selectedTextIn(event.currentTarget)
    const markdown = messageMarkdown(message)
    const plain = markdownToPlainText(markdown) || message.content
    const items: MenuItem[] = [
      {
        label: t('message.copy'),
        disabled: !(selected || markdown || message.content),
        onSelect: () =>
          void window.vav.conversations.copyToClipboard(
            selected || markdown || message.content
          )
      },
      {
        label: t('message.copyAsMarkdown'),
        disabled: !markdown,
        onSelect: () => void window.vav.conversations.copyToClipboard(markdown)
      },
      {
        label: t('message.copyAsPlain'),
        disabled: !(plain || message.content),
        onSelect: () =>
          void window.vav.conversations.copyToClipboard(plain || message.content)
      }
    ]
    const actions: MenuItem[] = []
    if (message.role === 'user' && onEdit) {
      actions.push({
        label: t('message.editResend'),
        disabled: busy,
        onSelect: () => setEditing(true)
      })
    }
    if (onRegenerate) {
      actions.push({
        label: message.role === 'user' ? t('message.retry') : t('message.regenerate'),
        disabled: busy,
        onSelect: () => onRegenerate(message.id)
      })
    }
    if (onQuote) actions.push({ label: t('message.quote'), onSelect: () => onQuote(message) })
    const branch: MenuItem[] = []
    if (onFork) {
      branch.push({
        label: t('message.branchHere'),
        disabled: busy,
        onSelect: () => onFork(message.id)
      })
    }
    if (onContinueInNewSession) {
      branch.push({
        label: t('message.continueInNew'),
        onSelect: () => onContinueInNewSession(message.id)
      })
    }
    if (actions.length) items.push({ label: '', divider: true }, ...actions)
    if (branch.length) items.push({ label: '', divider: true }, ...branch)
    if (onDelete) {
      items.push(
        { label: '', divider: true },
        {
          label: t('message.delete'),
          destructive: true,
          disabled: busy,
          onSelect: () => onDelete(message.id)
        }
      )
    }
    void showMenu(items, { x: event.clientX, y: event.clientY })
  }

  if (message.role === 'system') {
    return (
      <div
        className={classes}
        id={`msg-${message.id}`}
        onContextMenu={onDelete ? onContextMenu : undefined}
      >
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
      <div className="message-turn user" data-testid="message-user" onContextMenu={onContextMenu}>
        <div className="message-role">You</div>
        <div className="message-group user">
          {message.quoteSummary && message.quoteMessageId && (
            <button
              type="button"
              className="message-quote-ref"
              data-testid="message-quote-ref"
              title={`${message.quoteSummary}\n${t('composer.quoteJump')}`}
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
            {hasBody && (
              <MessageActionButton
                icon={<Copy size={12} />}
                title={t('message.copy')}
                doneTitle={t('common.copied')}
                onClick={() => window.vav.conversations.copyToClipboard(message.content)}
              />
            )}
            {onEdit && (
              <MessageActionButton
                icon={<Pencil size={12} />}
                title={busy ? t('message.editWhileRunning') : t('message.editResend')}
                disabled={busy}
                ack={false}
                onClick={() => setEditing(true)}
              />
            )}
            {onRegenerate && (
              <MessageActionButton
                icon={<RotateCcw size={12} />}
                title={t('message.retry')}
                disabled={busy}
                ack="spin"
                testId="message-retry"
                onClick={() => onRegenerate(message.id)}
              />
            )}
            {onQuote && (
              <MessageActionButton
                icon={<Quote size={12} />}
                title={t('message.quote')}
                onClick={() => onQuote(message)}
              />
            )}
            {onFork && (
              <MessageActionButton
                icon={<GitBranch size={12} />}
                title={t('message.branchHere')}
                disabled={busy}
                onClick={() => onFork(message.id)}
              />
            )}
            {onDelete && (
              <MessageActionButton
                icon={<Trash2 size={12} />}
                title={t('message.delete')}
                testId="message-delete"
                disabled={busy}
                ack={false}
                onClick={() => onDelete(message.id)}
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
    <div className="message-turn assistant" data-testid="message-assistant" onContextMenu={onContextMenu}>
      <div className="message-role">Agent</div>
      <div className={classes} id={`msg-${message.id}`}>
        {(() => {
          const { process, conclusion } = splitAssistantProcess(message.blocks)
          const render = (
            item: (typeof process)[number],
            nested: boolean
          ): React.JSX.Element | null => {
            const { block, index } = item
            if (block.kind === 'reasoning') {
              return nested ? (
                <ReasoningBlock key={`r${index}`} text={block.text} flat />
              ) : (
                <ReasoningBlock
                  key={`r${index}`}
                  text={block.text}
                  durationMs={block.durationMs}
                />
              )
            }
            if (block.kind === 'toolCall') {
              return <ToolCard key={block.id} block={block} startCollapsed={nested} />
            }
            if (block.kind === 'text') {
              return <MarkdownView key={`t${index}`} source={block.text} highlight={highlight} />
            }
            return null
          }
          return (
            <>
              {process.length > 0 ? (
                <ThinkingProcess steps={process.length} durationMs={processThoughtMs(process)}>
                  {process.map((item) => render(item, true))}
                </ThinkingProcess>
              ) : null}
              {conclusion.map((item) => render(item, false))}
            </>
          )
        })()}

        {message.cancelled && (
          <div className="message system" data-testid="message-cancelled">
            {t('message.cancelled')}
          </div>
        )}
        {!message.cancelled && message.errorText && (
          <div className="message system is-error">{message.errorText}</div>
        )}

        {message.changeSetId && (
          <div id={`inline-review-${message.changeSetId}`}>
            <InlineChangeReview changeSetId={message.changeSetId} />
          </div>
        )}

        {/* Actions above Done: hover strip then settled status (never under Done). */}
        <div className="message-tail">
          <div className="message-actions-slot">
            <div className="message-actions">
              <MessageActionButton
                icon={<Copy size={12} />}
                title={t('message.copy')}
                doneTitle={t('common.copied')}
                onClick={() => window.vav.conversations.copyToClipboard(message.content)}
              />
              {onRegenerate && (
                <MessageActionButton
                  icon={<RotateCcw size={12} />}
                  title={t('message.regenerate')}
                  testId="message-regenerate"
                  disabled={busy}
                  ack="spin"
                  onClick={() => onRegenerate(message.id)}
                />
              )}
              {onQuote && (
                <MessageActionButton
                  icon={<Quote size={12} />}
                  title={t('message.quote')}
                  testId="message-quote"
                  onClick={() => onQuote(message)}
                />
              )}
              {onFork && (
                <MessageActionButton
                  icon={<GitBranch size={12} />}
                  title={t('message.branchHere')}
                  disabled={busy}
                  onClick={() => onFork(message.id)}
                />
              )}
              {onDelete && (
                <MessageActionButton
                  icon={<Trash2 size={12} />}
                  title={t('message.delete')}
                  testId="message-delete"
                  disabled={busy}
                  ack={false}
                  onClick={() => onDelete(message.id)}
                />
              )}
              {message.changeSetId && (
                <MessageActionButton
                  icon={<FileDiff size={12} />}
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
                  <MessageActionButton
                    icon={<Undo2 size={12} />}
                    title={t('message.revertWorkspace')}
                    disabled={busy}
                    ack={false}
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
                              f.status === 'pending' ||
                              f.status === 'accepted' ||
                              f.status === 'edited'
                          )
                          .map((f) => f.filePath)
                          .filter((p) =>
                            paths.some((w) => p === w || p.endsWith(w) || w.endsWith(p))
                          )
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
                              // Prefer reject (restores original) for pending; undo for accepted.
                              const pendingPaths = active.files
                                .filter(
                                  (f) => targets.includes(f.filePath) && f.status === 'pending'
                                )
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
          </div>

          {pager ? <div className="message-footer">{pager}</div> : null}
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
            <AttachmentTile key={path} path={path} />
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
    <div
      className="variant-pager"
      data-testid="branch-pager"
      data-pulse={pulseKey > 0 ? pulseKey : undefined}
    >
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
