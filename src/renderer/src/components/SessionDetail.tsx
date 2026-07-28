import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { ToolsPanel } from './ToolsPanel'
import { SearchStrip } from './SearchStrip'
import { PlanOverlay } from './PlanOverlay'
import { ErrorBanner } from './ErrorBanner'
import { Button } from './ui'
import { applyTerminalAppearance } from '../lib/terminalRegistry'
import { useT } from '../i18n/useT'

type SessionDetailVariant = 'main' | 'preview-edit'

/**
 * Session chrome from shared pieces.
 * `preview-edit` = Agent drawer for file preview / workspace view.
 * ToolsPanel (File System + Bash) is always shown — the user needs terminal
 * access even in preview context.
 */
export function SessionDetail({
  variant = 'main'
}: {
  variant?: SessionDetailVariant
}): React.JSX.Element {
  const t = useT()
  const searchOpen = useSessionStore((s) => s.search.open)
  const errorBanner = useSessionStore((s) => s.errorBanner)
  const setErrorBanner = useSessionStore((s) => s.setErrorBanner)
  const openSettings = useSessionStore((s) => s.openSettings)
  const pending = useSessionStore((s) => s.pendingReviewByConversation[s.activeId])
  const openChangeReview = useSessionStore((s) => s.openChangeReview)

  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)
  const previewEdit = variant === 'preview-edit'

  return (
    <main className={previewEdit ? 'preview-edit-session' : 'detail'}>
      {errorBanner && (
        <ErrorBanner
          message={errorBanner}
          actionLabel={isKeyProblem ? t('error.openSettings') : undefined}
          onAction={isKeyProblem ? () => openSettings('api') : undefined}
          onDismiss={() => setErrorBanner(null)}
        />
      )}
      {pending && pending.count > 0 && (
        <div className="banner review-pending">
          <span>{t('review.pendingBanner', { n: pending.count })}</span>
          <span className="spacer" />
          <Button
            label={t('review.openReview')}
            size="sm"
            variant="primary"
            onClick={() => void openChangeReview(pending.changeSetId)}
          />
        </div>
      )}
      <div
        className={previewEdit ? 'preview-edit-stream' : 'detail-stream'}
        data-search={searchOpen}
      >
        {searchOpen && <SearchStrip />}
        {!previewEdit && <PlanOverlay />}
        <Transcript />
      </div>
      <div className={previewEdit ? 'preview-edit-dock dock' : 'dock'}>
        <CommentCardsBar />
        <ToolsPanel variant={previewEdit ? 'preview-edit' : 'main'} />
        <Composer />
      </div>
    </main>
  )
}

/**
 * Compact comment cards bar — sits above the tools panel + composer.
 * Each card shows only file · lines + title + comment input + ✕.
 * No code preview. Cards without a comment are cleaned up on next pick.
 * The most recently picked card's textarea auto-focuses.
 */
function CommentCardsBar(): React.JSX.Element | null {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const commentCards = useSessionStore((s) => s.commentCards[s.activeId] ?? NO_CARDS)
  const commentFocusId = useSessionStore((s) => s.commentFocusId)
  const updateCommentCard = useSessionStore((s) => s.updateCommentCard)
  const removeCommentCard = useSessionStore((s) => s.removeCommentCard)
  const refs = useRef<Map<string, HTMLTextAreaElement>>(new Map())

  useEffect(() => {
    if (!commentFocusId) return
    const el = refs.current.get(commentFocusId)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [commentFocusId])

  if (commentCards.length === 0) return null

  return (
    <div className="comment-cards">
      {commentCards.map((card) => (
        <div className="comment-card" key={card.ref.id}>
          <div className="comment-card-header">
            <span className="chip tag-sm">{card.ref.label}</span>
            <span className="comment-card-lines">
              L{card.ref.startLine}–{card.ref.endLine}
            </span>
            <button
              className="btn icon-only sm"
              style={{ width: 16, height: 16 }}
              onClick={() => removeCommentCard(activeId, card.ref.id)}
            >
              <X size={10} />
            </button>
          </div>
          <textarea
            ref={(el) => {
              if (el) refs.current.set(card.ref.id, el)
              else refs.current.delete(card.ref.id)
            }}
            className="comment-card-input"
            rows={1}
            placeholder={t('composer.commentPlaceholder')}
            value={card.comment}
            onChange={(e) => updateCommentCard(activeId, card.ref.id, e.target.value)}
          />
        </div>
      ))}
    </div>
  )
}

const NO_CARDS: { ref: import('@shared/types').PreviewRef; comment: string }[] = []

/** Push code-font settings into xterm hosts in this window. */
export function useTerminalAppearance(): void {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)

  useEffect(() => {
    applyTerminalAppearance(codeFont, Math.max(9, fontSize - 3))
  }, [codeFont, fontSize])
}

/** Menu commands that apply without a sidebar (session / preview Edit). */
export function useSessionMenuCommands(): void {
  useEffect(() => {
    return window.vav.onMenuCommand((command) => {
      const store = useSessionStore.getState()
      switch (command) {
        case 'focus-composer':
          store.focusComposer()
          break
        case 'find':
          store.openSearch()
          break
        case 'find-next':
          store.stepSearch(1)
          break
        case 'find-previous':
          store.stepSearch(-1)
          break
        case 'open-settings':
          store.openSettings()
          break
        case 'toggle-tools-panel':
          store.toggleToolsPanel()
          break
        case 'toggle-panel-segment':
          store.togglePanelSegment()
          break
        case 'new-terminal':
          store.setPanelSegment('terminal')
          void useWorkspaceStore.getState().newBash(store.activeId, 80, 24)
          break
        case 'switch-workdir':
          store.openWorkspaceSwitcher()
          break
        case 'send': {
          const draft = store.drafts[store.activeId] ?? ''
          const attachments = store.attachments[store.activeId] ?? []
          void store.send(draft.trim(), attachments)
          break
        }
        case 'focus-tools-1':
        case 'focus-tools-2':
        case 'focus-tools-3':
        case 'focus-tools-4':
        case 'focus-tools-5':
        case 'focus-tools-6':
        case 'focus-tools-7':
        case 'focus-tools-8':
        case 'focus-tools-9':
          store.focusToolsSlot(Number(command.slice('focus-tools-'.length)))
          break
      }
    })
  }, [])
}
