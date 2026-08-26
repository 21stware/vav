import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent
} from 'react'
import {
  ArrowUp,
  ChevronDown,
  CornerUpLeft,
  FileText,
  MapPin,
  MessageSquare,
  Quote,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type { ApprovalMode } from '@shared/types'
import {
  acpCurrentModeId,
  acpSessionModes,
  acpSlashMenuMatches,
  type AcpAvailableCommand
} from '@shared/acpSession'
import type { MessageKey, TParams } from '@shared/i18n'
import {
  MESSAGE_QUEUE_MAX,
  useSessionStore,
  type QueuedMessage
} from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { formatBytes, formatTokens } from '../lib/format'
import { basename } from '../lib/path'
import { formatBadge } from '../lib/previewBlocks'
import { menuAnchorIfVisible, showMenu, type MenuItem } from '../lib/nativeMenu'
import { keys } from '../lib/platform'
import { resolveSendKeyMode, shouldSendOnKeyDown } from '../lib/composerSendKey'
import { isPickGestureActive } from '../lib/clickPick'
import { agentModelHostKey } from '@shared/agentModels'
import { imageInputLimits, modelAcceptsImageInput } from '@shared/agentImageInput'
import { useT } from '../i18n/useT'
import { collectClipboardImages, imageSizeByPath, writeClipboardImage } from '../lib/pasteImages'
import { Button } from './ui'
import { AgentModelPicker } from './AgentModelPicker'
import { ComposerAttachments } from './ComposerAttachments'
import { ThinkingLevelPicker } from './ThinkingLevelPicker'

const NO_QUEUE: QueuedMessage[] = []

/**
 * Keep the composer from blurring (and collapsing) on mousedown of a nearby
 * control. Blur-first would shrink the dock, move the card, and eat the click.
 */
function retainComposerFocus(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('textarea, input, [contenteditable="true"]')) return
  if (target.closest('button, [role="button"]')) event.preventDefault()
}

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
 * Streaming (main-chat-streaming.rpml §5): composer stays enabled and enqueues
 * instead of disabling. ask_user_question still disables. `canSend` requires
 * text or an attachment; a missing key turns send into Settings.
 */
/** Stable identity: a fresh [] from a selector would re-render forever. */
const NO_ATTACHMENTS: string[] = []
const NO_REFS: import('@shared/types').PreviewRef[] = []
const NO_CARDS: { ref: import('@shared/types').PreviewRef; comment: string }[] = []

/**
 * Quote strip, file-context chip, message queue, and comment cards.
 *
 * Lives at the bottom of the Agent log column (not inside the dock) so
 * appear/disappear only resizes the transcript — composer box + tools tray
 * keep a stable height (no jump when Files selection toggles the chip).
 *
 * Vertical order: queue → quote/chip → comment cards → (composer in dock).
 */
export function ComposerContext({
  conversationId: pinnedConversationId
}: {
  conversationId?: string | null
} = {}): React.JSX.Element | null {
  const t = useT()
  const storeActiveId = useSessionStore((s) => s.activeId)
  const conversationId = (pinnedConversationId?.trim() || storeActiveId) || ''
  const contextFile = useSessionStore((s) => s.contextFiles[conversationId] ?? null)
  const commentCards = useSessionStore((s) => s.commentCards[conversationId] ?? NO_CARDS)
  const messageQueue = useSessionStore((s) => s.messageQueues[conversationId] ?? NO_QUEUE)
  const quote = useSessionStore((s) => s.quotes[conversationId] ?? null)
  const dismissContextFile = useSessionStore((s) => s.dismissContextFile)
  const clearQuote = useSessionStore((s) => s.clearQuote)
  const scrollToMessage = useSessionStore((s) => s.scrollToMessage)

  const hasCommentCards = commentCards.length > 0
  const hasQueue = messageQueue.length > 0
  const showFileContextChip = Boolean(contextFile && !hasCommentCards)
  const quoteSource =
    quote?.role === 'user' ? t('composer.quoteFromUser') : t('composer.quoteFromAgent')

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

  if (!conversationId) return null
  if (!quote && !showFileContextChip && !hasCommentCards && !hasQueue) return null

  return (
    <div
      className={`composer-context${hasCommentCards ? ' has-comment-cards' : ''}${hasQueue ? ' has-message-queue' : ''}`}
      data-has-context="true"
      onMouseDown={retainComposerFocus}
    >
      {hasQueue && <MessageQueueBar conversationId={conversationId} items={messageQueue} />}
      {quote && (
        <div className="quote-strip" data-testid="composer-quote">
          <button
            type="button"
            className="quote-strip-body"
            title={`${quote.summary}\n${t('composer.quoteJump')}`}
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
            onClick={() => clearQuote(conversationId)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {showFileContextChip && contextFile && (
        <FileContextChip
          path={contextFile}
          conversationId={conversationId}
          onDismiss={() => void dismissContextFile(conversationId)}
        />
      )}
      <CommentCardsBar conversationId={conversationId} />
    </div>
  )
}

/**
 * Single shared composer for main session, workspace agent column, and
 * file-preview drawer. Pass {@link conversationId} when the surface owns a
 * session that may lag behind (or differ from) store.activeId for a frame.
 *
 * Context chips live in {@link ComposerContext} (Agent log column) so the dock
 * height stays stable while browsing Files.
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
  const storeDraft = useSessionStore((s) => s.drafts[conversationId] ?? '')
  const attachments = useSessionStore((s) => s.attachments[conversationId] ?? NO_ATTACHMENTS)
  const previewRefs = useSessionStore((s) => s.previewRefs[conversationId] ?? NO_REFS)
  const commentCards = useSessionStore((s) => s.commentCards[conversationId] ?? NO_CARDS)
  const contextFile = useSessionStore((s) => s.contextFiles[conversationId] ?? null)
  const isRunning = useSessionStore((s) => !!s.turns[conversationId]?.isRunning)
  const awaiting = useSessionStore((s) => !!s.turns[conversationId]?.awaitingToolCallId)
  const queueLen = useSessionStore((s) => (s.messageQueues[conversationId] ?? NO_QUEUE).length)
  const queueFull = queueLen >= MESSAGE_QUEUE_MAX
  const sendKeySetting = useSessionStore((s) => s.settings.sendKey)
  const focusTick = useSessionStore((s) => s.composerFocusTick)
  const focusId = useSessionStore((s) => s.composerFocusId)

  const setDraft = useSessionStore((s) => s.setDraft)
  const setAttachments = useSessionStore((s) => s.setAttachments)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const showToast = useSessionStore((s) => s.showToast)
  const setPreviewRefs = useSessionStore((s) => s.setPreviewRefs)
  const send = useSessionStore((s) => s.send)
  const cancel = useSessionStore((s) => s.cancel)
  const setApprovalMode = useSessionStore((s) => s.setApprovalMode)
  const approvalMenuNonce = useSessionStore((s) => s.approvalMenuNonce)
  const approvalConversationId = useSessionStore((s) => s.approvalConversationId)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const approvalTriggerRef = useRef<HTMLButtonElement>(null)
  const seenApprovalMenuNonce = useRef(0)
  /** True while IME / dictation composition is active (Enter must not submit). */
  const composingRef = useRef(false)
  const approvalMode: ApprovalMode = conversation?.approvalMode ?? 'auto'
  const [focused, setFocused] = useState(false)
  const imageLimits = imageInputLimits(conversation?.cliHost ?? null)
  const catalogModel = useSessionStore((s) => {
    const host = conversation?.cliHost ?? null
    const id = conversation?.model ?? ''
    return s.agentModelCatalog[agentModelHostKey(host)]?.models.find((m) => m.id === id)
  })
  const imageInputSupported = modelAcceptsImageInput(
    conversation?.cliHost ?? null,
    conversation?.model ?? null,
    catalogModel
  )
  // Local draft mirrors the store but keeps keystrokes off the React commit path
  // of every other subscriber for one frame when the store write coalesces.
  const [draft, setLocalDraft] = useState(storeDraft)
  const draftFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const acpCommands = conversation?.acpSession?.commands ?? NO_COMMANDS
  const slashMatches = useMemo(
    () => acpSlashMenuMatches(draft, acpCommands),
    [draft, acpCommands]
  )
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const slashOpen = Boolean(slashMatches && !slashDismissed)

  useEffect(() => {
    setSlashIndex(0)
    setSlashDismissed(false)
  }, [draft])

  useEffect(() => {
    setLocalDraft(storeDraft)
  }, [conversationId, storeDraft])

  useEffect(() => {
    return () => {
      if (draftFlushTimer.current) clearTimeout(draftFlushTimer.current)
    }
  }, [])
  // Composer stays editable while streaming; only ask_user_question locks it.
  const inputDisabled = awaiting
  // Allow send with no session yet — store.send mints on first submit.
  // While streaming, send enqueues (blocked only when queue is full).
  const hasPayload =
    draft.trim().length > 0 ||
    attachments.length > 0 ||
    previewRefs.length > 0 ||
    commentCards.length > 0
  const canSend = !awaiting && hasPayload && !(isRunning && queueFull)

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
  const sendKey = resolveSendKeyMode(sendKeySetting)
  const sendShortcut = sendKey === 'enter' ? keys('↵') : keys('⌘↵')
  // Keep idle hint short: e.g. "↵ Send · ⌘I Focus" (no drag-files copy).
  const shortcutHints = t('composer.placeholderHints', {
    send: sendShortcut,
    focus: keys('⌘I')
  })
  const placeholder = awaiting
    ? t('composer.placeholderAwaiting')
    : isRunning
      ? queueFull
        ? t('composer.placeholderQueueFull', { n: MESSAGE_QUEUE_MAX })
        : t('composer.placeholderQueue')
      : `${idlePlaceholder}  ${shortcutHints}`

  useEffect(() => {
    if (focusTick === 0) return
    if (focusId && focusId !== conversationId) return
    textareaRef.current?.focus()
  }, [focusTick, focusId, conversationId])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    // Avoid reflowing height mid-composition — can cancel IME on macOS.
    if (composingRef.current) return
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20
    const minRows = focused && !inputDisabled ? COMPOSER_MIN_FOCUSED_ROWS : 1
    const minHeight = minRows * lineHeight
    const maxHeight = COMPOSER_MAX_ROWS * lineHeight
    element.style.height = 'auto'
    const next = Math.min(maxHeight, Math.max(minHeight, element.scrollHeight))
    element.style.height = `${next}px`
    element.style.overflowY = element.scrollHeight > maxHeight + 1 ? 'auto' : 'hidden'
  }, [draft, focused, inputDisabled])

  const approvalItems = useMemo((): MenuItem[] => {
    if (!conversation) return []
    return modes.map((mode) => ({
      label: mode.label,
      checked: mode.value === approvalMode,
      onSelect: () => void setApprovalMode(conversation.id, mode.value)
    }))
  }, [conversation, approvalMode, setApprovalMode, modes])

  const openApprovalMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      if (!conversation || approvalItems.length === 0) return
      void showMenu(approvalItems, menuAnchorIfVisible(anchor))
    },
    [conversation, approvalItems]
  )

  useEffect(() => {
    if (approvalMenuNonce === 0 || approvalMenuNonce === seenApprovalMenuNonce.current) return
    if (approvalConversationId && approvalConversationId !== conversationId) return
    seenApprovalMenuNonce.current = approvalMenuNonce
    openApprovalMenu(approvalTriggerRef.current)
  }, [approvalMenuNonce, approvalConversationId, conversationId, openApprovalMenu])

  const activeMode = modes.find((m) => m.value === approvalMode) ?? modes[0]!
  const approvalLabel = activeMode.label
  const approvalTitle = activeMode.title

  const flushDraft = (value: string): void => {
    if (!conversationId) return
    if (draftFlushTimer.current) {
      clearTimeout(draftFlushTimer.current)
      draftFlushTimer.current = null
    }
    setDraft(conversationId, value)
  }

  const submit = (): void => {
    if (!canSend) return
    if (conversationId) flushDraft(draft)
    textareaRef.current?.blur()
    void send(draft.trim(), attachments, conversationId || undefined)
  }

  const hasCommentCards = commentCards.length > 0

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const { filePaths, pathSizes, memoryImages, text } = collectClipboardImages(event.clipboardData)
    if (filePaths.length === 0 && memoryImages.length === 0) return
    event.preventDefault()
    if (!conversationId) return

    if (memoryImages.length > 0) {
      const incoming: string[] = []
      const sizes: Record<string, number> = {}
      for (const image of memoryImages) {
        const written = await writeClipboardImage(image, imageLimits)
        if ('error' in written) {
          if (written.error === 'too-large') {
            const mb = Math.max(1, Math.round(imageLimits.maxBytes / (1024 * 1024)))
            showToast({ kind: 'info', title: t('composer.imageTooLarge', { mb }) })
          } else if (written.error === 'bad-type') {
            showToast({ kind: 'info', title: t('composer.imageTypeUnsupported') })
          }
          continue
        }
        incoming.push(written.path)
        sizes[written.path] = written.bytes
      }
      if (incoming.length) addAttachments(conversationId, incoming, { sizes })
    }

    if (filePaths.length) addAttachments(conversationId, filePaths, { sizes: pathSizes })

    const clipped = text.trim()
    if (!clipped) return
    const el = textareaRef.current
    if (!el) {
      const next = `${draft}${draft && !draft.endsWith('\n') ? '\n' : ''}${clipped}`
      setLocalDraft(next)
      flushDraft(next)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = `${el.value.slice(0, start)}${clipped}${el.value.slice(end)}`
    setLocalDraft(next)
    flushDraft(next)
    requestAnimationFrame(() => {
      const pos = start + clipped.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div
      className={`composer${hasCommentCards ? ' has-comment-cards' : ''}`}
      data-testid="composer"
      onMouseDown={retainComposerFocus}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (!conversationId) return
        const { paths, sizes } = imageSizeByPath([...event.dataTransfer.files])
        if (paths.length) addAttachments(conversationId, paths, { sizes })
      }}
    >
      {/* Context chips / comments live in ComposerContext (Agent log column). */}
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
        {conversationId && slashOpen && slashMatches ? (
          <AcpSlashMenu
            matches={slashMatches}
            selectedIndex={slashIndex}
            onHover={setSlashIndex}
            onPick={(next) => {
              setLocalDraft(next)
              flushDraft(next)
              textareaRef.current?.focus()
            }}
          />
        ) : null}
        {attachments.length > 0 && conversationId && (
          <ComposerAttachments
            paths={attachments}
            conversationId={conversationId}
            imageInputSupported={imageInputSupported}
            onRemove={(path) =>
              setAttachments(
                conversationId,
                attachments.filter((p) => p !== path)
              )
            }
          />
        )}

        <textarea
          ref={textareaRef}
          data-testid="composer-input"
          rows={1}
          placeholder={placeholder}
          value={draft}
          disabled={inputDisabled}
          onFocus={() => setFocused(true)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onChange={(event) => {
            // Paint locally first; coalesce store writes so typing stays at 60fps
            // even when other panels subscribe to session churn.
            const value = event.target.value
            setLocalDraft(value)
            if (!conversationId) return
            if (draftFlushTimer.current) clearTimeout(draftFlushTimer.current)
            draftFlushTimer.current = setTimeout(() => {
              draftFlushTimer.current = null
              setDraft(conversationId, value)
            }, 32)
          }}
          onBlur={() => {
            setFocused(false)
            // Composition can be aborted without compositionend (focus loss).
            composingRef.current = false
            if (conversationId) flushDraft(textareaRef.current?.value ?? draft)
          }}
          onPaste={(event) => {
            void handlePaste(event)
          }}
          onKeyDown={(event) => {
            // Don’t treat IME “confirm” Enter as send.
            if (composingRef.current || event.nativeEvent.isComposing) return
            if (slashOpen && slashMatches) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSlashIndex((index) => (index + 1) % slashMatches.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const command = slashMatches[slashIndex] ?? slashMatches[0]
                if (!command) return
                const next = `/${command.name} `
                setLocalDraft(next)
                flushDraft(next)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setSlashDismissed(true)
                return
              }
            }
            if (!shouldSendOnKeyDown(event, sendKey)) return
            event.preventDefault()
            submit()
          }}
        />

        <div className="composer-bar">
          {conversationId ? <AgentModelPicker conversationId={conversationId} /> : null}
          {conversationId ? <AcpSessionModePicker conversationId={conversationId} /> : null}
          {conversationId ? <ThinkingLevelPicker conversationId={conversationId} /> : null}

          <button
            ref={approvalTriggerRef}
            type="button"
            className={`model-picker approval-picker${approvalMode === 'bypass' ? ' warning' : ''}`}
            data-testid="approval-mode"
            aria-label={t('composer.approvalMode')}
            aria-haspopup="menu"
            title={approvalTitle}
            disabled={!conversation}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openApprovalMenu(event.currentTarget)
            }}
          >
            <span className="model-name">{approvalLabel}</span>
            <ChevronDown size={11} />
          </button>

          <span className="spacer" />

          {conversation && <ConversationContextRing conversationId={conversation.id} />}

          {isRunning && (
            <Button
              label={t('composer.stop')}
              icon={<Square size={11} />}
              variant="danger"
              size="sm"
              title={t('composer.stop')}
              onClick={() => conversationId && void cancel(conversationId)}
            />
          )}
          <button
            className="send-button"
            data-testid="composer-send"
            disabled={!canSend}
            onClick={submit}
            title={
              isRunning
                ? `${t('queue.enqueue')} ${sendShortcut}`
                : `${t('composer.send')} ${sendShortcut}`
            }
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * FIFO pending sends — same visual language as comment cards (light strip,
 * icon actions). Empty queue renders nothing.
 */
function MessageQueueBar({
  conversationId,
  items
}: {
  conversationId: string
  items: QueuedMessage[]
}): React.JSX.Element | null {
  const t = useT()
  const updateQueuedMessage = useSessionStore((s) => s.updateQueuedMessage)
  const removeQueuedMessage = useSessionStore((s) => s.removeQueuedMessage)
  const sendQueuedNow = useSessionStore((s) => s.sendQueuedNow)
  const showDialog = useSessionStore((s) => s.showDialog)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editingId) return
    const el = editRef.current
    if (!el) return
    el.focus()
    try {
      el.setSelectionRange(el.value.length, el.value.length)
    } catch {
      // ignore
    }
  }, [editingId])

  if (items.length === 0) return null

  const startEdit = (item: QueuedMessage): void => {
    setEditingId(item.id)
    setEditDraft(item.text)
  }

  const saveEdit = (id: string): void => {
    const next = editDraft.trim()
    if (next) updateQueuedMessage(conversationId, id, next)
    setEditingId(null)
    setEditDraft('')
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setEditDraft('')
  }

  const confirmDelete = (item: QueuedMessage): void => {
    const preview = item.text.trim() || t('queue.emptyBody')
    const clipped = preview.length > 80 ? `${preview.slice(0, 79)}…` : preview
    showDialog({
      title: t('queue.deleteTitle'),
      body: t('queue.deleteBody', { text: clipped }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => removeQueuedMessage(conversationId, item.id)
    })
  }

  return (
    <div className="message-queue" role="list" aria-label={t('queue.regionLabel')}>
      {items.map((item) => {
        const editing = editingId === item.id
        const body = item.text.trim() || t('queue.emptyBody')
        return (
          <div
            className={`message-queue-item${editing ? ' is-editing' : ''}`}
            key={item.id}
            role="listitem"
          >
            {editing ? (
              <>
                <div className="message-queue-item-header">
                  <span className="message-queue-item-icon" aria-hidden>
                    <MessageSquare size={12} strokeWidth={2} />
                  </span>
                  <span className="message-queue-item-label">{t('queue.editing')}</span>
                  <button
                    type="button"
                    className="message-queue-icon-btn"
                    title={t('common.close')}
                    aria-label={t('common.close')}
                    onClick={cancelEdit}
                  >
                    <X size={12} strokeWidth={2.25} />
                  </button>
                </div>
                <textarea
                  ref={editRef}
                  className="message-queue-input"
                  rows={2}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                      return
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      saveEdit(item.id)
                    }
                  }}
                  onBlur={() => {
                    // Commit on blur if non-empty (same spirit as comment cards).
                    window.setTimeout(() => {
                      if (editingId !== item.id) return
                      if (document.activeElement === editRef.current) return
                      saveEdit(item.id)
                    }, 0)
                  }}
                />
              </>
            ) : (
              <>
                <div className="message-queue-item-header">
                  <span className="message-queue-item-icon" aria-hidden>
                    <MessageSquare size={12} strokeWidth={2} />
                  </span>
                  <button
                    type="button"
                    className="message-queue-item-text"
                    title={t('queue.clickToEdit')}
                    onClick={() => startEdit(item)}
                  >
                    {body}
                  </button>
                  <button
                    type="button"
                    className="message-queue-icon-btn is-send"
                    title={t('queue.sendNowTitle')}
                    aria-label={t('queue.sendNow')}
                    onClick={() => void sendQueuedNow(conversationId, item.id)}
                  >
                    <ArrowUp size={12} strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    className="message-queue-icon-btn is-trash"
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                    onClick={() => confirmDelete(item)}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
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
                  // Wait out an active pick gesture so commit doesn't thrash mid-click.
                  const finish = (): void => {
                    const el = inputRefs.current.get(card.ref.id)
                    if (el && document.activeElement === el) return
                    if (
                      document.activeElement instanceof HTMLInputElement &&
                      document.activeElement.classList.contains('comment-card-input')
                    ) {
                      setEditingId((cur) => (cur === card.ref.id ? null : cur))
                      return
                    }
                    commitCard(card.ref.id)
                  }
                  window.setTimeout(() => {
                    if (isPickGestureActive()) {
                      window.setTimeout(() => {
                        if (!isPickGestureActive()) finish()
                      }, 50)
                      return
                    }
                    finish()
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

/** Composer ring that reads mid-turn tokens without remapping `conversations`. */
function ConversationContextRing({ conversationId }: { conversationId: string }): React.JSX.Element {
  const used = useSessionStore((s) => {
    const live = s.liveUsage[conversationId]
    if (live) return live.tokensUsed
    return s.conversations.find((c) => c.id === conversationId)?.tokensUsed ?? 0
  })
  const limit = useSessionStore((s) => {
    const live = s.liveUsage[conversationId]
    if (typeof live?.tokenLimit === 'number') return live.tokenLimit
    return s.conversations.find((c) => c.id === conversationId)?.tokenLimit ?? 0
  })
  const tokenRatio = Math.min(1, used / Math.max(1, limit))
  return (
    <ContextRing
      ratio={tokenRatio}
      percent={Math.round(tokenRatio * 100)}
      used={used}
      limit={limit}
      onClick={(anchor) => void window.vav.window.openTokenUsage(conversationId, anchor)}
    />
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
      data-testid="token-ring"
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

function AcpSessionModePicker({ conversationId }: { conversationId: string }): React.JSX.Element | null {
  const t = useT()
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === conversationId))
  const setAcpMode = useSessionStore((s) => s.setAcpMode)
  const setAcpConfigOption = useSessionStore((s) => s.setAcpConfigOption)
  const modes = acpSessionModes(conversation?.acpSession)
  const current = acpCurrentModeId(conversation?.acpSession)
  if (!conversation?.cliHost || modes.length === 0) return null
  const active = modes.find((mode) => mode.id === current) ?? modes[0]!
  return (
    <button
      type="button"
      className="model-picker"
      data-testid="acp-session-mode"
      aria-label={t('composer.sessionMode')}
      aria-haspopup="menu"
      title={active.description || t('composer.sessionMode')}
      onClick={(event) => {
        event.preventDefault()
        const items = modes.map((mode) => ({
          label: mode.name,
          checked: mode.id === current,
          onSelect: () => {
            const config = conversation.acpSession?.configOptions?.find((option) => option.category === 'mode')
            if (config) void setAcpConfigOption(conversationId, config.id, mode.id)
            else void setAcpMode(conversationId, mode.id)
          }
        }))
        void showMenu(items, menuAnchorIfVisible(event.currentTarget))
      }}
    >
      <span className="model-name">{active.name}</span>
      <ChevronDown size={11} />
    </button>
  )
}

function AcpSlashMenu({
  matches,
  selectedIndex,
  onHover,
  onPick
}: {
  matches: AcpAvailableCommand[]
  selectedIndex: number
  onHover: (index: number) => void
  onPick: (next: string) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div
      className="acp-slash-menu"
      data-testid="acp-slash-menu"
      role="listbox"
      aria-label={t('composer.slashCommands')}
    >
      {matches.map((command, index) => (
        <button
          key={command.name}
          type="button"
          className={`acp-slash-item${index === selectedIndex ? ' is-active' : ''}`}
          data-testid={`acp-slash-${command.name}`}
          data-active={index === selectedIndex ? 'true' : undefined}
          role="option"
          aria-selected={index === selectedIndex}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(`/${command.name} `)
          }}
        >
          <span className="acp-slash-name">/{command.name}</span>
          {command.description ? <span className="acp-slash-desc">{command.description}</span> : null}
        </button>
      ))}
    </div>
  )
}

const NO_COMMANDS: AcpAvailableCommand[] = []
