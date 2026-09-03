/**
 * Hand workspace focus (+ optional composer draft) into a live CLI agent TUI.
 *
 * Order: brief context first, user draft last (editable). Never auto-submit.
 * Dedupes identical payloads per pane via inject fingerprint.
 */
import {
  buildWorkspaceFocusContext,
  cliPromptFingerprint,
  composeCliPromptPaste,
  contextLaunchStrategyForAgent,
  formatBlockContextBrief,
  formatFocusedFileContextBrief,
  launchCarriesContext
} from '@shared/agentContextInject'
import type { PreviewRef } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { resolveComposerContextFile } from '../state/sessionQueue'
import { useWorkspaceStore } from '../state/workspaceStore'

export type CliHandoffReason = 'created' | 'restored' | 'focus-change' | 'block-pick'

function readFocus(conversationId: string): {
  path: string | null
  cards: { ref: PreviewRef; comment: string }[]
} {
  const store = useSessionStore.getState()
  const path = resolveComposerContextFile(store.contextFiles, store.conversations, conversationId)
  const cards = store.commentCards[conversationId] ?? []
  return { path, cards }
}

function takeDraft(conversationId: string): string {
  const store = useSessionStore.getState()
  return (store.drafts[conversationId] ?? '').trim()
}

function clearDraft(conversationId: string): void {
  const store = useSessionStore.getState()
  if (!(store.drafts[conversationId] ?? '').trim()) return
  store.setDraft(conversationId, '')
}

/**
 * Deliver current workspace focus into the active CLI prompt, optionally
 * carrying the vav composer draft so the question rides with the context.
 */
export function handoffFocusToCli(
  conversationId: string,
  agentId: string,
  reason: CliHandoffReason
): void {
  if (!agentId || agentId === 'vav') return

  const ws = useWorkspaceStore.getState().workspaces[conversationId]
  // focus-change / block-pick require a live host; activate path already set it.
  if (reason === 'focus-change' || reason === 'block-pick') {
    if (ws?.activeHostAgentId !== agentId) return
  }

  const strategy = contextLaunchStrategyForAgent(agentId)
  const { path, cards } = readFocus(conversationId)
  const draft = takeDraft(conversationId)

  // Fresh Claude spawn already has ambient system context — only hand off draft.
  const skipContext =
    reason === 'created' && launchCarriesContext(strategy)

  const context = skipContext
    ? null
    : buildWorkspaceFocusContext({
        focusedPath: path,
        cards,
        style: 'prompt'
      })

  const paste = composeCliPromptPaste({ context, draft })
  if (!paste) return

  const delayMs =
    reason === 'created' ? 700 : reason === 'restored' ? 140 : 80

  useWorkspaceStore.getState().injectContextToActivePane(conversationId, paste, {
    submit: false,
    delayMs,
    fingerprint: cliPromptFingerprint(context, draft || null)
  })

  // Draft is now in the TUI — drop it from the (hidden) vav composer so it
  // does not re-append on the next switch.
  if (draft) clearDraft(conversationId)
}

/**
 * Explicit insert (Files context menu). Uses conversation.agentBinaryName from
 * meta — does not require the Bash/CLI surface to already be foreground.
 * Brings that host forward (or spawns it), then pastes brief file context.
 */
export async function handoffFileFocusToCli(
  conversationId: string,
  filePath: string
): Promise<void> {
  const meta = useSessionStore.getState().conversations.find((c) => c.id === conversationId)
  const agentId = meta?.agentBinaryName
  if (!agentId || agentId === 'vav') return

  const workspace = useWorkspaceStore.getState()
  // Activate from meta so insert works even when the main chat / preview is up.
  const result = await workspace.activateAgentHost(conversationId, agentId, 80, 24, null)
  if (result === 'missing') return

  const draft = takeDraft(conversationId)
  const context = formatFocusedFileContextBrief(filePath)
  const paste = composeCliPromptPaste({ context, draft })
  if (!paste) return

  // No fingerprint: menu inserts are intentional; user may re-insert after editing.
  useWorkspaceStore.getState().injectContextToActivePane(conversationId, paste, {
    submit: false,
    delayMs: result === 'created' ? 700 : 80,
    agentId
  })
  if (draft) clearDraft(conversationId)
}

/** Block pick while CLI is active — selection + optional draft. */
export function handoffBlockToCli(
  conversationId: string,
  ref: PreviewRef,
  comment?: string
): void {
  const meta = useSessionStore.getState().conversations.find((c) => c.id === conversationId)
  const agentId = meta?.agentBinaryName
  if (!agentId || agentId === 'vav') return
  const ws = useWorkspaceStore.getState().workspaces[conversationId]
  if (ws?.activeHostAgentId !== agentId) return

  const draft = takeDraft(conversationId)
  const context = formatBlockContextBrief(ref, comment)
  // Block picks are intentional and additive — fingerprint includes ref id so
  // re-picking another block always pastes; same block+draft skips.
  const paste = composeCliPromptPaste({ context, draft })
  if (!paste) return

  useWorkspaceStore.getState().injectContextToActivePane(conversationId, paste, {
    submit: false,
    delayMs: 80,
    fingerprint: `block:${ref.id}\u0000${cliPromptFingerprint(context, draft || null)}`
  })
  if (draft) clearDraft(conversationId)
}
