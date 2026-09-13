import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
  type WheelEvent
} from 'react'
import {
  ArrowUp,
  ChevronDown,
  CornerUpLeft,
  MapPin,
  MessageSquare,
  Plus,
  Quote,
  Scissors,
  Square,
  Trash2,
  X
} from 'lucide-react'
import {
  acpSlashMenuMatches,
  type AcpAvailableCommand
} from '@shared/acpSession'
import {
  MESSAGE_QUEUE_MAX,
  useSessionStore,
  type QueuedMessage
} from '../state/sessionStore'
import { mergeComposerFilePaths } from '../state/sessionQueue'
import { keys, PLATFORM } from '../lib/platform'
import { resolveSendKeyMode, shouldSendOnKeyDown } from '../lib/composerSendKey'
import { isPickGestureActive } from '../lib/clickPick'
import { agentModelHostKey } from '@shared/agentModels'
import { imageInputLimits, modelAcceptsImageInput } from '@shared/agentImageInput'
import { vendorIdFromEndpoint } from '@shared/llmVendors'
import { useAccountGroups, vavAccountsOf } from '../lib/accountGroups'
import { useT } from '../i18n/useT'
import { attachScreenshot } from '../lib/composerAttach'
import { COMPOSER_MIN_ROWS, composerWheelStaysOnField } from '../lib/composerTextarea'
import { collectClipboardImages, writeClipboardImage } from '../lib/pasteImages'
import { menuAnchor, showMenu } from '../lib/nativeMenu'
import { prettyAccelerator, resolveKeyBindings } from '@shared/keyBindings'
import { Button } from './ui'
import { AgentModelPicker } from './AgentModelPicker'
import { ComposerAttachments } from './ComposerAttachments'
import { SessionRunPicker } from './SessionRunPicker'
import { MentionBox, type MentionBoxHandle } from './mentionBox/MentionBox'
import { appMentionToken, findComposerPills } from './mentionBox/mentionTokens'

const NO_QUEUE: QueuedMessage[] = []

/**
 * Keep the composer from blurring on mousedown of a nearby control.
 * Blur-first would eat the click on the control.
 */
function retainComposerFocus(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('textarea, input, [contenteditable="true"]')) return
  if (target.closest('button, [role="button"]')) event.preventDefault()
}

/**
 * Prompt input for the active conversation.
 *
 * Streaming (main-chat-streaming.rpml §5): composer stays enabled and enqueues
 * instead of disabling. ask_user_question / request_for_secret still disable.
 * `canSend` requires
 * text or an attachment; a missing key turns send into Settings.
 */
/** Stable identity: a fresh [] from a selector would re-render forever. */
const NO_ATTACHMENTS: string[] = []
const NO_REFS: import('@shared/types').PreviewRef[] = []
const NO_CARDS: { ref: import('@shared/types').PreviewRef; comment: string }[] = []

/**
 * Quote strip, message queue, and comment cards.
 *
 * Lives at the bottom of the Agent log column (not inside the dock) so
 * appear/disappear only resizes the transcript — composer box + tools tray
 * keep a stable height.
 *
 * Vertical order: queue → quote → comment cards → (composer in dock).
 */
export function ComposerContext({
  conversationId: pinnedConversationId
}: {
  conversationId?: string | null
} = {}): React.JSX.Element | null {
  const t = useT()
  const storeActiveId = useSessionStore((s) => s.activeId)
  const conversationId = (pinnedConversationId?.trim() || storeActiveId) || ''
  const commentCards = useSessionStore((s) => s.commentCards[conversationId] ?? NO_CARDS)
  const messageQueue = useSessionStore((s) => s.messageQueues[conversationId] ?? NO_QUEUE)
  const quote = useSessionStore((s) => s.quotes[conversationId] ?? null)
  const clearQuote = useSessionStore((s) => s.clearQuote)
  const scrollToMessage = useSessionStore((s) => s.scrollToMessage)

  const hasCommentCards = commentCards.length > 0
  const hasQueue = messageQueue.length > 0
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
  if (!quote && !hasCommentCards && !hasQueue) return null

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
      <CommentCardsBar conversationId={conversationId} />
    </div>
  )
}

export type ComposerVariant = 'chat' | 'schedule'

/**
 * Single shared composer for main session, workspace agent column, and
 * file-preview drawer. Pass {@link conversationId} when the surface owns a
 * session that may lag behind (or differ from) store.activeId for a frame.
 *
 * Quote / comments / queue live in {@link ComposerContext} (Agent log column)
 * so the dock height stays independent of those strips.
 *
 * `schedule` reuses the same prompt card without send / screenshot — the
 * scheduled-task editor owns enable / run instead.
 */
export function Composer({
  conversationId: pinnedConversationId,
  variant = 'chat',
  value,
  onChange,
  onCommit
}: {
  conversationId?: string | null
  variant?: ComposerVariant
  value?: string
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
} = {}): React.JSX.Element {
  const t = useT()
  const isSchedule = variant === 'schedule'
  const storeActiveId = useSessionStore((s) => s.activeId)
  const conversationId = isSchedule
    ? (pinnedConversationId?.trim() ?? '')
    : (pinnedConversationId?.trim() || storeActiveId) || ''
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const storeDraft = useSessionStore((s) => s.drafts[conversationId] ?? '')
  const boundDraft = value !== undefined ? value : storeDraft
  const attachments = useSessionStore((s) => s.attachments[conversationId] ?? NO_ATTACHMENTS)
  const previewRefs = useSessionStore((s) => s.previewRefs[conversationId] ?? NO_REFS)
  const commentCards = useSessionStore((s) => s.commentCards[conversationId] ?? NO_CARDS)
  const contextFile = useSessionStore((s) => s.contextFiles[conversationId] ?? null)
  const composerFiles = useMemo(
    () => mergeComposerFilePaths(contextFile, attachments),
    [contextFile, attachments]
  )
  const isRunning = useSessionStore((s) => !!s.turns[conversationId]?.isRunning)
  const awaiting = useSessionStore((s) => !!s.turns[conversationId]?.awaitingToolCallId)
  const queueLen = useSessionStore((s) => (s.messageQueues[conversationId] ?? NO_QUEUE).length)
  const queueFull = queueLen >= MESSAGE_QUEUE_MAX
  const sendKeySetting = useSessionStore((s) => s.settings.sendKey)
  const keyBindings = useSessionStore((s) => s.settings.keyBindings)
  const openSettings = useSessionStore((s) => s.openSettings)
  const focusTick = useSessionStore((s) => s.composerFocusTick)
  const focusId = useSessionStore((s) => s.composerFocusId)

  const setDraft = useSessionStore((s) => s.setDraft)
  const setAttachments = useSessionStore((s) => s.setAttachments)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const dismissContextFile = useSessionStore((s) => s.dismissContextFile)
  const showToast = useSessionStore((s) => s.showToast)
  const [attachBusy, setAttachBusy] = useState(false)
  const setPreviewRefs = useSessionStore((s) => s.setPreviewRefs)
  const send = useSessionStore((s) => s.send)
  const cancel = useSessionStore((s) => s.cancel)

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
  const tokenUsage = useMemo(() => {
    const ratio = Math.min(1, used / Math.max(1, limit))
    return {
      used,
      limit,
      percent: Math.round(ratio * 100),
      ratio
    }
  }, [used, limit])

  const mentionRef = useRef<MentionBoxHandle>(null)
  const accountGroups = useAccountGroups()
  const imageLimits = imageInputLimits(conversation?.cliHost ?? null)
  const catalogModel = useSessionStore((s) => {
    const host = conversation?.cliHost ?? null
    const id = conversation?.model ?? ''
    const currentVav = vavAccountsOf(accountGroups).find(
      (row) => row.id === conversation?.accountId
    )
    const vendorId =
      host == null
        ? vendorIdFromEndpoint(currentVav?.endpoint ?? s.settings.apiEndpoint)
        : null
    const accountId = conversation?.accountId ?? currentVav?.id ?? null
    return s.agentModelCatalog[agentModelHostKey(host, vendorId, accountId)]?.models?.find((m) => m.id === id)
  })
  const imageInputSupported = modelAcceptsImageInput(
    conversation?.cliHost ?? null,
    conversation?.model ?? null,
    catalogModel
  )
  // Local draft mirrors the store but keeps keystrokes off the React commit path
  // of every other subscriber for one frame when the store write coalesces.
  const [draft, setLocalDraft] = useState(boundDraft)
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
    setLocalDraft(boundDraft)
  }, [conversationId, boundDraft])

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
    composerFiles.length > 0 ||
    previewRefs.length > 0 ||
    commentCards.length > 0
  const canSend = !awaiting && hasPayload && !(isRunning && queueFull)

  // file-preview.rpml: when the file chip is dismissed, fall back to a generic
  // "Ask the agent…" prompt; when attached on a file session, prefer the
  // file-oriented phrasing.
  const idlePlaceholder = conversation?.fileId
    ? composerFiles.length > 0
      ? t('composer.placeholderFile')
      : t('composer.placeholder')
    : composerFiles.length > 0
      ? t('composer.placeholderFile')
      : t('composer.placeholderCommand')
  const sendKey = resolveSendKeyMode(sendKeySetting)
  const sendShortcut = sendKey === 'enter' ? keys('↵') : keys('⌘↵')
  const screenshotChord = prettyAccelerator(
    resolveKeyBindings(keyBindings).screenshot,
    PLATFORM
  )
  // Keep idle hint short: e.g. "↵ Send · ⌘I Focus" (no drag-files copy).
  const shortcutHints = t('composer.placeholderHints', {
    send: sendShortcut,
    focus: keys('⌘I')
  })
  const placeholder = isSchedule
    ? t('timer.promptPlaceholder')
    : awaiting
      ? t('composer.placeholderAwaiting')
      : isRunning
        ? queueFull
          ? t('composer.placeholderQueueFull', { n: MESSAGE_QUEUE_MAX })
          : t('composer.placeholderQueue')
        : `${idlePlaceholder}  ${shortcutHints}`

  useEffect(() => {
    if (focusTick === 0) return
    if (focusId && focusId !== conversationId) return
    mentionRef.current?.focus()
  }, [focusTick, focusId, conversationId])

  const runScreenshot = (hideWindow?: boolean): void => {
    void (async () => {
      if (attachBusy) return
      setAttachBusy(true)
      try {
        await attachScreenshot(hideWindow === undefined ? undefined : { hideWindow })
      } finally {
        setAttachBusy(false)
      }
    })()
  }

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
    mentionRef.current?.textarea?.blur()
    void send(draft.trim(), attachments, conversationId || undefined)
  }

  /** Update the local draft + coalesced store write (shared by typing + pills). */
  const applyDraftChange = (next: string): void => {
    setLocalDraft(next)
    onChange?.(next)
    if (!conversationId) return
    if (draftFlushTimer.current) clearTimeout(draftFlushTimer.current)
    draftFlushTimer.current = setTimeout(() => {
      draftFlushTimer.current = null
      setDraft(conversationId, next)
    }, 32)
  }

  /** Native add-content menu — shared by the "+" button and the `@` trigger. */
  const openAddMenu = (anchor: { x: number; y: number }): void => {
    void (async () => {
      const apps = await window.vav.computer.listApps().catch(() => [])
      const appItems =
        apps.length > 0
          ? apps.map((app) => ({
              label: app.name,
              onSelect: () => mentionRef.current?.insertText(`${appMentionToken(app.name)} `)
            }))
          : [{ label: t('composer.mentionNoApps'), disabled: true }]
      await showMenu(
        [
          {
            label: t('composer.mentionAddFile'),
            icon: { kind: 'lucide', key: 'file-text' },
            onSelect: () => {
              void (async () => {
                const res = await window.vav.files.pickAttachments()
                if (!res.ok || res.paths.length === 0) return
                mentionRef.current?.insertText(`${res.paths.join(' ')} `)
              })()
            }
          },
          {
            label: t('composer.mentionAddApp'),
            icon: { kind: 'lucide', key: 'app-window' },
            submenu: appItems
          }
        ],
        anchor
      )
    })()
  }

  const hasCommentCards = commentCards.length > 0

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const { filePaths, pathSizes, memoryImages, text } = collectClipboardImages(event.clipboardData)
    if (filePaths.length === 0 && memoryImages.length === 0) {
      const types = event.clipboardData ? [...event.clipboardData.types] : []
      const looksLikeImage =
        types.some((type) => type.startsWith('image/') || type === 'Files') ||
        [...(event.clipboardData?.items ?? [])].some((item) => item.type.startsWith('image/'))
      if (!looksLikeImage) return
      event.preventDefault()
      if (!conversationId) return
      const fromOs = await window.vav.conversations.readClipboardImage()
      if (!fromOs.ok) return
      addAttachments(conversationId, [fromOs.path], { sizes: { [fromOs.path]: fromOs.bytes } })
      return
    }
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
      else {
        const fromOs = await window.vav.conversations.readClipboardImage()
        if (fromOs.ok) {
          addAttachments(conversationId, [fromOs.path], { sizes: { [fromOs.path]: fromOs.bytes } })
        }
      }
    }

    if (filePaths.length) addAttachments(conversationId, filePaths, { sizes: pathSizes })

    const clipped = text.trim()
    if (!clipped) return
    const el = mentionRef.current?.textarea ?? null
    if (!el) {
      const next = `${draft}${draft && !draft.endsWith('\n') ? '\n' : ''}${clipped}`
      setLocalDraft(next)
      onChange?.(next)
      flushDraft(next)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = `${el.value.slice(0, start)}${clipped}${el.value.slice(end)}`
    setLocalDraft(next)
    onChange?.(next)
    flushDraft(next)
    requestAnimationFrame(() => {
      const pos = start + clipped.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div
      className={`composer${hasCommentCards ? ' has-comment-cards' : ''}${isSchedule ? ' is-schedule' : ''}`}
      data-testid="composer"
      onMouseDown={retainComposerFocus}
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
        {conversationId && !isSchedule && slashOpen && slashMatches ? (
          <AcpSlashMenu
            matches={slashMatches}
            selectedIndex={slashIndex}
            onHover={setSlashIndex}
            onPick={(next) => {
              setLocalDraft(next)
              flushDraft(next)
              mentionRef.current?.focus()
            }}
          />
        ) : null}
        {composerFiles.length > 0 && conversationId && (
          <ComposerAttachments
            paths={composerFiles}
            conversationId={conversationId}
            imageInputSupported={imageInputSupported}
            onRemove={(path) => {
              if (path === contextFile) void dismissContextFile(conversationId)
              setAttachments(
                conversationId,
                attachments.filter((p) => p !== path)
              )
            }}
          />
        )}

        <MentionBox
          id="text"
          ref={mentionRef}
          data-testid={isSchedule ? 'timer-prompt' : 'composer-input'}
          rows={COMPOSER_MIN_ROWS}
          placeholder={placeholder}
          value={draft}
          disabled={inputDisabled}
          findPills={findComposerPills}
          onTrigger={(_query, anchor) => {
            // `@` opens the same native add-content menu as the "+" button.
            openAddMenu(anchor ?? { x: 0, y: 0 })
          }}
          onChange={(value) => {
            // Paint locally first; coalesce store writes so typing stays at 60fps
            // even when other panels subscribe to session churn.
            applyDraftChange(value)
          }}
          onBlur={() => {
            const next = mentionRef.current?.textarea?.value ?? draft
            if (conversationId) flushDraft(next)
            onCommit?.(next)
          }}
          onPaste={(event) => {
            void handlePaste(event)
          }}
          onWheel={(event: WheelEvent<HTMLTextAreaElement>) => {
            if (composerWheelStaysOnField(event.currentTarget, event.deltaY)) {
              event.stopPropagation()
            }
          }}
          onKeyDown={(event) => {
            // Don’t treat IME “confirm” Enter as send.
            if (event.nativeEvent.isComposing) return
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
            if (isSchedule) return
            if (!shouldSendOnKeyDown(event, sendKey)) return
            event.preventDefault()
            submit()
          }}
        />

        <div className="composer-bar">
          <span className="composer-tools">
            <button
              type="button"
              className="model-picker session-run-btn is-icon"
              data-testid="composer-attach"
              title={t('composer.attachFileTitle')}
              aria-label={t('composer.attachFile')}
              aria-haspopup="menu"
              disabled={inputDisabled}
              onClick={(event) => openAddMenu(menuAnchor(event.currentTarget))}
            >
              <Plus size={12} strokeWidth={2} />
            </button>
            {isSchedule ? null : (
              <span className="composer-shot-group">
                <button
                  type="button"
                  className="model-picker session-run-btn is-icon"
                  data-testid="composer-screenshot"
                  title={`${t('composer.screenshotTitle')} ${screenshotChord}`}
                  aria-label={t('composer.screenshot')}
                  disabled={inputDisabled || attachBusy}
                  onClick={() => runScreenshot()}
                >
                  <Scissors size={12} strokeWidth={2} style={{ transform: 'rotate(-90deg)' }} />
                </button>
                <button
                  type="button"
                  className="model-picker session-run-btn is-icon is-shot-caret"
                  data-testid="composer-screenshot-menu"
                  title={t('composer.screenshotMenu')}
                  aria-label={t('composer.screenshotMenu')}
                  aria-haspopup="menu"
                  disabled={inputDisabled || attachBusy}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void showMenu(
                      [
                        {
                          label: t('composer.screenshotHideWindow'),
                          icon: { kind: 'lucide', key: 'app-window' },
                          onSelect: () => runScreenshot(true)
                        },
                        { label: '', divider: true },
                        {
                          label: t('composer.screenshotSettings'),
                          icon: { kind: 'lucide', key: 'settings' },
                          onSelect: () => openSettings('appearance', 'screenshot')
                        }
                      ],
                      menuAnchor(event.currentTarget)
                    )
                  }}
                >
                  <ChevronDown size={9} className="session-run-caret" aria-hidden />
                </button>
              </span>
            )}
          </span>

          <span className="spacer" />

          <span className="composer-meta">
            {conversationId ? (
              <SessionRunPicker conversationId={conversationId}>
                <AgentModelPicker conversationId={conversationId} usage={tokenUsage} />
              </SessionRunPicker>
            ) : null}
          </span>

          {!isSchedule && isRunning && (
            <Button
              label={t('composer.stop')}
              icon={<Square size={11} />}
              variant="danger"
              size="sm"
              title={t('composer.stop')}
              onClick={() => conversationId && void cancel(conversationId)}
            />
          )}
          {isSchedule ? null : (
            <button
              type="button"
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
          )}
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
            title={body}
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
          title={command.description}
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
