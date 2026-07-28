import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, CornerUpLeft, Paperclip, Quote, Square, X } from 'lucide-react'
import type { ApprovalMode } from '@shared/types'
import { PRESET_MODELS } from '@shared/types'
import type { MessageKey, TParams } from '@shared/i18n'
import { useSessionStore } from '../state/sessionStore'
import { formatTokens } from '../lib/format'
import { basename } from '../lib/path'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { keys } from '../lib/platform'
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

export function Composer(): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const draft = useSessionStore((s) => s.drafts[s.activeId] ?? '')
  const attachments = useSessionStore((s) => s.attachments[s.activeId] ?? NO_ATTACHMENTS)
  const previewRefs = useSessionStore((s) => s.previewRefs[s.activeId] ?? NO_REFS)
  const commentCards = useSessionStore((s) => s.commentCards[s.activeId] ?? NO_CARDS)
  const quote = useSessionStore((s) => s.quotes[s.activeId] ?? null)
  const turn = useSessionStore((s) => s.turns[s.activeId])
  const settings = useSessionStore((s) => s.settings)
  const focusTick = useSessionStore((s) => s.composerFocusTick)

  const setDraft = useSessionStore((s) => s.setDraft)
  const setAttachments = useSessionStore((s) => s.setAttachments)
  const setPreviewRefs = useSessionStore((s) => s.setPreviewRefs)
  const clearQuote = useSessionStore((s) => s.clearQuote)
  const scrollToMessage = useSessionStore((s) => s.scrollToMessage)
  const send = useSessionStore((s) => s.send)
  const cancel = useSessionStore((s) => s.cancel)
  const setModel = useSessionStore((s) => s.setModel)
  const setApprovalMode = useSessionStore((s) => s.setApprovalMode)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const approvalMode: ApprovalMode = conversation?.approvalMode ?? 'auto'
  const [focused, setFocused] = useState(false)

  const isRunning = !!turn?.isRunning
  const awaiting = !!turn?.awaitingToolCallId
  const canSend =
    !isRunning &&
    (draft.trim().length > 0 ||
      attachments.length > 0 ||
      previewRefs.length > 0 ||
      commentCards.length > 0)

  /** Focused floor / empty-blur floor / hard ceiling (main-chat-search.rpml). */
  const COMPOSER_MIN_FOCUSED_ROWS = 3
  const COMPOSER_MAX_ROWS = 8

  const modes = useMemo(() => approvalModeOptions(t), [t])
  const placeholder = awaiting
    ? t('composer.placeholderAwaiting')
    : isRunning
      ? t('composer.thinking')
      : `${t('composer.placeholderCommand')}  ${keys('⌘↵')} ${t('composer.send')} · ${t('composer.dragHint', { shortcut: keys('⌘I') })}`

  useEffect(() => {
    if (!quote) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        clearQuote(activeId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [quote, activeId, clearQuote])

  useEffect(() => {
    if (focusTick === 0) return
    textareaRef.current?.focus()
  }, [focusTick])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
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
    const custom = settings.customModels.map((id) => ({
      label: id,
      checked: id === activeModel,
      onSelect: () => void setModel(activeId, id)
    }))
    const presets = PRESET_MODELS.map((model) => ({
      label: model.label,
      checked: model.id === activeModel,
      onSelect: () => void setModel(activeId, model.id)
    }))
    return custom.length ? [...presets, { label: '', divider: true }, ...custom] : presets
  }, [settings.customModels, activeId, activeModel, setModel])

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
    if (!canSend) return
    textareaRef.current?.blur()
    void send(draft.trim(), attachments)
  }

  const tokenRatio = conversation
    ? Math.min(1, conversation.tokensUsed / Math.max(1, conversation.tokenLimit))
    : 0
  const tokenPct = Math.round(tokenRatio * 100)

  const quoteSource =
    quote?.role === 'user' ? t('composer.quoteFromUser') : t('composer.quoteFromAgent')

  return (
    <div
      className="composer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const paths = [...event.dataTransfer.files]
          .map((file) => window.vav.files.pathForFile(file))
          .filter(Boolean)
        if (paths.length) setAttachments(activeId, [...new Set([...attachments, ...paths])])
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
            onClick={() => clearQuote(activeId)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="composer-box">
        {previewRefs.length > 0 && (
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
                    setPreviewRefs(activeId, previewRefs.filter((r) => r.id !== ref.id))
                  }
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((path) => (
              <span className="chip" key={path} title={path}>
                <Paperclip size={11} />
                <span className="chip-label">{basename(path)}</span>
                <button
                  className="btn icon-only sm"
                  style={{ width: 16, height: 16 }}
                  onClick={() => setAttachments(activeId, attachments.filter((p) => p !== path))}
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
          disabled={isRunning}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => setDraft(activeId, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />

        <div className="composer-bar">
          <button
            className="model-picker"
            title={t('composer.model')}
            onClick={(event) =>
              void showMenu(modelItems, menuAnchor(event.currentTarget as HTMLElement))
            }
          >
            <span className="model-name">
              {PRESET_MODELS.find((m) => m.id === activeModel)?.label ?? activeModel}
            </span>
            <ChevronDown size={11} />
          </button>

          <button
            className={`model-picker${approvalMode === 'bypass' ? ' warning' : ''}`}
            aria-label={t('composer.approvalMode')}
            title={approvalTitle}
            disabled={!conversation}
            onClick={(event) =>
              void showMenu(approvalItems, menuAnchor(event.currentTarget as HTMLElement))
            }
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
              onClick={() => void cancel(activeId)}
            />
          ) : (
            <button
              className="send-button"
              disabled={!canSend}
              onClick={submit}
              title={`${t('composer.send')} ${keys('⌘↵')}`}
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
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
