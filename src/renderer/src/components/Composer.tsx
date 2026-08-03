import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  ChevronDown,
  CornerUpLeft,
  FileText,
  MapPin,
  MessageSquare,
  Paperclip,
  Quote,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type { ApprovalMode } from '@shared/types'
import { PRESET_MODELS } from '@shared/types'
import type { MessageKey, TParams } from '@shared/i18n'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { formatBytes, formatTokens } from '../lib/format'
import { basename } from '../lib/path'
import { formatBadge } from '../lib/previewBlocks'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { keys } from '../lib/platform'
import { resolveSendKeyMode, shouldSendOnKeyDown } from '../lib/composerSendKey'
import { useT } from '../i18n/useT'
import { Button } from './ui'

function approvalModeOptions(
  t: (key: MessageKey, params?: TParams) => string
): { value: ApprovalMode; label: string; title: string }[] {
  return [
    { value: 'auto', label: t('approvalMode.auto'), title: t('approvalMode.autoTitle') },
    {
      value: 'bypass',
      label: t('approvalMode.bypass'),
      title: t('approvalMode.yolo')
    },
    { value: 'edit', label: t('approvalMode.edit'), title: t('approvalMode.editTitle') }
  ]
}

/**
 * Prompt input for the active conversation.
 *
 * Gating follows main-chat.rpml annotation 8: disabled while this conversation
 * is running, `canSend` requires text or an attachment, and a missing key turns
 * send into a prompt that opens Settings.
 */
/** Stable identity: a fresh [] from a selector would re-render forever. */
const NO_ATTACHMENTS: string[] = []
const NO_REFS: import('@shared/types').PreviewRef[] = []
const NO_CARDS: { ref: import('@shared/types').PreviewRef; comment: string }[] = []

/**
 * Single shared composer for main session, workspace agent column, and
 * file-preview drawer. Pass {@link conversationId} when the surface owns a
 * session that may lag behind (or differ from) store.activeId for a frame.
 */
export function Composer({
  conversationId: pinnedConversationId
}: {
  conversationId?: string | null
} = {}): React.JSX.Element {
  const t = useT()
  const storeActiveId = useSessionStore((s) => s.activeId)
  const conversationId = (pinnedConversationId?.trim() || storeActiveId) || ''
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const draft = useSessionStore((s) => s.drafts[conversationId] ?? '')
  const attachments = useSessionStore((s) => s.attachments[conversationId] ?? NO_ATTACHMENTS)
  const previewRefs = useSessionStore((s) => s.previewRefs[conversationId] ?? NO_REFS)
  const commentCards = useSessionStore((s) => s.commentCards[conversationId] ?? NO_CARDS)
  const contextFile = useSessionStore((s) => s.contextFiles[conversationId] ?? null)
  const quote = useSessionStore((s) => s.quotes[conversationId] ?? null)
  const turn = useSessionStore((s) => s.turns[conversationId])
  const settings = useSessionStore((s) => s.settings)
  const focusTick = useSessionStore((s) => s.composerFocusTick)

  const setDraft = useSessionStore((s) => s.setDraft)
  const setAttachments = useSessionStore((s) => s.setAttachments)
  const setPreviewRefs = useSessionStore((s) => s.setPreviewRefs)
  const dismissContextFile = useSessionStore((s) => s.dismissContextFile)
  const clearQuote = useSessionStore((s) => s.clearQuote)
  const scrollToMessage = useSessionStore((s) => s.scrollToMessage)
  const send = useSessionStore((s) => s.send)
  const cancel = useSessionStore((s) => s.cancel)
  const setModel = useSessionStore((s) => s.setModel)
  const setApprovalMode = useSessionStore((s) => s.setApprovalMode)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** True while IME / dictation composition is active (Enter must not submit). */
  const composingRef = useRef(false)
  const approvalMode: ApprovalMode = conversation?.approvalMode ?? 'auto'
  const [focused, setFocused] = useState(false)

  const isRunning = !!turn?.isRunning
  const awaiting = !!turn?.awaitingToolCallId
  const canSend =
    !!conversationId &&
    !isRunning &&
    (draft.trim().length > 0 ||
      attachments.length > 0 ||
      previewRefs.length > 0 ||
      commentCards.length > 0)

  /** Focused floor / empty-blur floor / hard ceiling (main-chat-search.rpml). */
  const COMPOSER_MIN_FOCUSED_ROWS = 3
  const COMPOSER_MAX_ROWS = 8

  const modes = useMemo(() => approvalModeOptions(t), [t])
  // file-preview.rpml: when the file chip is dismissed, fall back to a generic
  // "Ask the agent…" prompt; when attached on a file session, prefer the
  // file-oriented phrasing.
  const idlePlaceholder = conversation?.fileId
    ? contextFile
      ? t('composer.placeholderFile')
      : t('composer.placeholder')
    : contextFile
      ? t('composer.placeholderFile')
      : t('composer.placeholderCommand')
  const sendKey = resolveSendKeyMode(settings.sendKey)
  const sendShortcut = sendKey === 'enter' ? keys('↵') : keys('⌘↵')
  // Keep idle hint short: e.g. "↵ Send · ⌘I Focus" (no drag-files copy).
  const shortcutHints = t('composer.placeholderHints', {
    send: sendShortcut,
    focus: keys('⌘I')
  })
  const placeholder = awaiting
    ? t('composer.placeholderAwaiting')
    : isRunning
      ? t('composer.thinking')
      : `${idlePlaceholder}  ${shortcutHints}`

  useEffect(() => {
    if (!quote || !conversationId) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        clearQuote(conversationId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [quote, conversationId, clearQuote])

  useEffect(() => {
    if (focusTick === 0) return
    textareaRef.current?.focus()
  }, [focusTick])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    // Avoid reflowing height mid-composition — can cancel IME on macOS.
    if (composingRef.current) return
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20
    const minRows = focused && !isRunning ? COMPOSER_MIN_FOCUSED_ROWS : 1
    const minHeight = minRows * lineHeight
    const maxHeight = COMPOSER_MAX_ROWS * lineHeight
    element.style.height = 'auto'
    const next = Math.min(maxHeight, Math.max(minHeight, element.scrollHeight))
    element.style.height = `${next}px`
    element.style.overflowY = element.scrollHeight > maxHeight + 1 ? 'auto' : 'hidden'
  }, [draft, focused, isRunning])

  const activeModel = conversation?.model ?? settings.defaultModel

  const modelItems = useMemo((): MenuItem[] => {
    if (!conversationId) return []
    const custom = settings.customModels.map((id) => ({
      label: id,
      checked: id === activeModel,
      onSelect: () => void setModel(conversationId, id)
    }))
    const presets = PRESET_MODELS.map((model) => ({
      label: model.label,
      checked: model.id === activeModel,
      onSelect: () => void setModel(conversationId, model.id)
    }))
    return custom.length ? [...presets, { label: '', divider: true }, ...custom] : presets
  }, [settings.customModels, conversationId, activeModel, setModel])

  const approvalItems = useMemo((): MenuItem[] => {
    if (!conversation) return []
    return modes.map((mode) => ({
      label: mode.label,
      checked: mode.value === approvalMode,
      onSelect: () => void setApprovalMode(conversation.id, mode.value)
    }))
  }, [conversation, approvalMode, setApprovalMode, modes])

  const activeMode = modes.find((m) => m.value === approvalMode) ?? modes[0]!
  const approvalLabel = activeMode.label
  const approvalTitle = activeMode.title

  const submit = (): void => {
    if (!canSend || !conversationId) return
    textareaRef.current?.blur()
    void send(draft.trim(), attachments, conversationId)
  }

  const tokenRatio = conversation
    ? Math.min(1, conversation.tokensUsed / Math.max(1, conversation.tokenLimit))
    : 0
  const tokenPct = Math.round(tokenRatio * 100)

  const quoteSource =
    quote?.role === 'user' ? t('composer.quoteFromUser') : t('composer.quoteFromAgent')

  const hasCommentCards = commentCards.length > 0
  /**
   * file-preview.rpml: whole-file chip only when there are no comment cards.
   * Selected blocks already carry path + line context; the chip is redundant.
   */
  const showFileContextChip = Boolean(contextFile && !hasCommentCards)

  return (
    <div
      className={`composer${hasCommentCards ? ' has-comment-cards' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const paths = [...event.dataTransfer.files]
          .map((file) => window.vav.files.pathForFile(file))
          .filter(Boolean)
        if (conversationId && paths.length) {
          setAttachments(conversationId, [...new Set([...attachments, ...paths])])
        }
      }}
    >
      {quote && (
        <div className="quote-strip">
          <button
            type="button"
            className="quote-strip-body"
            title={t('composer.quoteJump')}
            onClick={() => scrollToMessage(quote.messageId)}
          >
            <CornerUpLeft size={14} />
            <span className="quote-strip-text">
              <span className="quote-strip-summary">{quote.summary}</span>
              <span className="quote-strip-source">{quoteSource}</span>
            </span>
          </button>
          <button
            type="button"
            className="btn icon-only sm"
            title={t('composer.clearQuote')}
            onClick={() => conversationId && clearQuote(conversationId)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {/* File Attachment Chip — above comment cards (file-preview.rpml). */}
      {showFileContextChip && contextFile && conversationId && (
        <FileContextChip
          path={contextFile}
          conversationId={conversationId}
          onDismiss={() => void dismissContextFile(conversationId)}
        />
      )}
      {/* Attached stack: comment strip sits on top of the input box. */}
      <CommentCardsBar conversationId={conversationId} />
      <div className="composer-box">
        {previewRefs.length > 0 && conversationId && (
          <div className="context-refs">
            {previewRefs.map((ref) => (
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
                <button
                  className="btn icon-only sm"
                  style={{ width: 16, height: 16 }}
                  title={t('composer.removeContext')}
                  onClick={() =>
                    setPreviewRefs(
                      conversationId,
                      previewRefs.filter((r) => r.id !== ref.id)
                    )
                  }
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && conversationId && (
          <div className="attachments">
            {attachments.map((path) => (
              <span className="chip" key={path} title={path}>
                <Paperclip size={11} />
                <span className="chip-label">{basename(path)}</span>
                <button
                  type="button"
                  className="btn icon-only sm"
                  style={{ width: 16, height: 16 }}
                  title={t('composer.removeAttachment')}
                  aria-label={t('composer.removeAttachment')}
                  onClick={() =>
                    setAttachments(
                      conversationId,
                      attachments.filter((p) => p !== path)
                    )
                  }
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={placeholder}
          value={draft}
          disabled={isRunning || !conversationId}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            // Composition can be aborted without compositionend (focus loss).
            composingRef.current = false
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onChange={(event) => {
            // Always sync: blocking composition updates (or preventDefault on
            // insertCompositionText) breaks CJK IME / dictation and can leave
            // the controlled value stuck so nothing types.
            if (conversationId) setDraft(conversationId, event.target.value)
          }}
          onKeyDown={(event) => {
            // Don’t treat IME “confirm” Enter as send.
            if (composingRef.current || event.nativeEvent.isComposing) return
            if (!shouldSendOnKeyDown(event, sendKey)) return
            event.preventDefault()
            submit()
          }}
        />

        <div className="composer-bar">
          <button
            type="button"
            className="model-picker"
            title={t('composer.model')}
            disabled={!conversation}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!conversation) return
              void showMenu(modelItems, menuAnchor(event.currentTarget as HTMLElement))
            }}
          >
            <span className="model-name">
              {PRESET_MODELS.find((m) => m.id === activeModel)?.label ?? activeModel}
            </span>
            <ChevronDown size={11} />
          </button>

          <button
            type="button"
            className={`model-picker${approvalMode === 'bypass' ? ' warning' : ''}`}
            aria-label={t('composer.approvalMode')}
            title={approvalTitle}
            disabled={!conversation}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!conversation) return
              void showMenu(approvalItems, menuAnchor(event.currentTarget as HTMLElement))
            }}
          >
            <span className="model-name">{approvalLabel}</span>
            <ChevronDown size={11} />
          </button>

          <span className="spacer" />

          {conversation && (
            <ContextRing
              ratio={tokenRatio}
              percent={tokenPct}
              used={conversation.tokensUsed}
              limit={conversation.tokenLimit}
              onClick={(anchor) =>
                void window.vav.window.openTokenUsage(conversation.id, anchor)
              }
            />
          )}

          {isRunning ? (
            <Button
              label={t('composer.stop')}
              icon={<Square size={11} />}
              variant="danger"
              size="sm"
              title={t('composer.stop')}
              onClick={() => conversationId && void cancel(conversationId)}
            />
          ) : (
            <button
              className="send-button"
              disabled={!canSend}
              onClick={submit}
              title={`${t('composer.send')} ${sendShortcut}`}
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Pick-mode comment strip — attached above the composer box (not above tools).
 * Multiple cards stack flush; bottom edge is square so it reads as part of the input.
 */
function CommentCardsBar({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element | null {
  const t = useT()
  const cards = useSessionStore((s) => s.commentCards[conversationId] ?? NO_CARDS)
  const commentFocusId = useSessionStore((s) => s.commentFocusId)
  const commentFocusTick = useSessionStore((s) => s.commentFocusTick)
  const updateCommentCard = useSessionStore((s) => s.updateCommentCard)
  const removeCommentCard = useSessionStore((s) => s.removeCommentCard)
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const [editingId, setEditingId] = useState<string | null>(null)

  // Every pick (including re-pick of the same block) opens edit + focuses.
  useEffect(() => {
    if (!commentFocusId || commentFocusTick === 0) return
    setEditingId(commentFocusId)
  }, [commentFocusId, commentFocusTick])

  useEffect(() => {
    if (!editingId) return
    // Wait a frame so the input is mounted after switching into edit mode.
    const id = window.requestAnimationFrame(() => {
      const el = inputRefs.current.get(editingId)
      if (!el) return
      el.focus()
      try {
        el.setSelectionRange(el.value.length, el.value.length)
      } catch {
        // ignore
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [editingId, commentFocusTick])

  /**
   * Leave edit mode. Do NOT drop empty cards on blur/Enter — empty cards are
   * intentional picks (selection highlight + pending note). Opening Agent / focusing
   * the composer used to blur the field and wipe the selection.
   * Removal is explicit: trash / ✕ / re-click block on the canvas.
   */
  const commitCard = (refId: string): void => {
    setEditingId((cur) => (cur === refId ? null : cur))
  }

  if (cards.length === 0) return null

  return (
    <div className="comment-cards" role="list">
      {cards.map((card) => {
        const editing = editingId === card.ref.id
        const hasComment = card.comment.trim().length > 0
        const title =
          card.ref.label ||
          (card.ref.startLine === card.ref.endLine
            ? `line ${card.ref.startLine}`
            : `lines ${card.ref.startLine}–${card.ref.endLine}`)
        return (
          <div
            className={`comment-card${editing ? ' is-editing' : ''}${hasComment && !editing ? ' is-committed' : ''}`}
            key={card.ref.id}
            role="listitem"
          >
            <div className="comment-card-header">
              <span className="comment-card-icon" aria-hidden>
                {editing || !hasComment ? (
                  <MapPin size={12} strokeWidth={2} />
                ) : (
                  <MessageSquare size={12} strokeWidth={2} />
                )}
              </span>
              <span
                className="comment-card-title"
                title={`${card.ref.filePath} · L${card.ref.startLine}–${card.ref.endLine}`}
              >
                {title}
              </span>
              {editing ? (
                <button
                  type="button"
                  className="comment-card-close"
                  title={t('common.close')}
                  aria-label={t('common.close')}
                  onClick={() => removeCommentCard(conversationId, card.ref.id)}
                >
                  <X size={12} strokeWidth={2.25} />
                </button>
              ) : (
                <button
                  type="button"
                  className="comment-card-trash"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  onClick={() => removeCommentCard(conversationId, card.ref.id)}
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              )}
            </div>
            {editing ? (
              <input
                ref={(el) => {
                  if (el) {
                    inputRefs.current.set(card.ref.id, el)
                    // Focus on mount when this is the active edit target.
                    if (editingId === card.ref.id && document.activeElement !== el) {
                      requestAnimationFrame(() => {
                        el.focus()
                        try {
                          el.setSelectionRange(el.value.length, el.value.length)
                        } catch {
                          // ignore
                        }
                      })
                    }
                  } else {
                    inputRefs.current.delete(card.ref.id)
                  }
                }}
                type="text"
                className="comment-card-input"
                placeholder={t('composer.commentPlaceholder')}
                value={card.comment}
                onChange={(e) =>
                  updateCommentCard(conversationId, card.ref.id, e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitCard(card.ref.id)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    commitCard(card.ref.id)
                  }
                }}
                onBlur={() => {
                  // Defer past canvas mousedown so a new pick can win focus first.
                  window.setTimeout(() => {
                    const el = inputRefs.current.get(card.ref.id)
                    if (el && document.activeElement === el) return
                    // Another comment field took focus — leave this card committed if it has text.
                    if (
                      document.activeElement instanceof HTMLInputElement &&
                      document.activeElement.classList.contains('comment-card-input')
                    ) {
                      setEditingId((cur) => (cur === card.ref.id ? null : cur))
                      return
                    }
                    commitCard(card.ref.id)
                  }, 0)
                }}
              />
            ) : (
              <button
                type="button"
                className={`comment-card-body${hasComment ? '' : ' is-placeholder'}`}
                title={t('composer.commentEditHint')}
                onClick={() => setEditingId(card.ref.id)}
              >
                {hasComment ? card.comment : t('composer.commentPlaceholder')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * File Attachment Chip (main-chat / file-preview / workspace-view).
 * Shows name · size · format; ✕ dismisses context only (not the preview).
 */
function FileContextChip({
  path,
  conversationId,
  onDismiss
}: {
  path: string
  conversationId: string
  onDismiss: () => void
}): React.JSX.Element {
  const t = useT()
  const size = useWorkspaceStore((s) => {
    const dirs = s.workspaces[conversationId]?.dirs
    if (!dirs) return null
    for (const entries of Object.values(dirs)) {
      const hit = entries.find((e) => e.path === path)
      if (hit && !hit.isDirectory) return hit.size
    }
    return null
  })
  const name = basename(path)
  const badge = formatBadge(path, 'text')
  const sizeLabel = size != null ? formatBytes(size) : null
  const label = [name, sizeLabel, badge].filter(Boolean).join(' · ')

  return (
    <div className="file-context-chip" title={path}>
      <FileText size={14} aria-hidden />
      <span className="file-context-chip-label">
        {label}
        <span className="file-context-chip-suffix"> — {t('composer.fileContextAttached')}</span>
      </span>
      <button
        type="button"
        className="btn icon-only sm"
        title={t('composer.dismissFileContext')}
        aria-label={t('composer.dismissFileContext')}
        onClick={onDismiss}
      >
        <X size={12} />
      </button>
    </div>
  )
}

/** Circular context-window meter — ring + %; click opens the native usage popup. */
function ContextRing({
  ratio,
  percent,
  used,
  limit,
  onClick
}: {
  ratio: number
  percent: number
  used: number
  limit: number
  onClick: (anchor: { x: number; y: number; width: number; height: number }) => void
}): React.JSX.Element {
  const t = useT()
  const size = 14
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - ratio)
  const level = ratio > 0.9 ? 'full' : ratio > 0.7 ? 'warn' : 'ok'

  return (
    <button
      type="button"
      className="token-ring"
      data-level={level}
      title={t('token.contextDetail', {
        percent,
        used: formatTokens(used),
        limit: formatTokens(limit)
      })}
      aria-label={t('token.contextUsage', { percent })}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onClick({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        })
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="token-pct">{percent}%</span>
    </button>
  )
}
