/**
 * App → agent composer. Inserts a prompt and/or a path mention on the
 * workspace agent without stealing the active session.
 */
import { appSearchPrompt } from '@shared/appResourceUrl'
import { fileMentionToken } from '../components/mentionBox/mentionTokens'
import { useSessionStore } from '../state/sessionStore'
import { workspaceAgentConversationId } from './workspaceAgentContext'
import { syncWorkspaceAgentFocusedPath } from './workspaceAgentContext'

export { appSearchPrompt }

export function agentComposerId(): string | null {
  return workspaceAgentConversationId() || useSessionStore.getState().activeId || null
}

/** Put `text` in the workspace-agent draft and focus the input. */
export function insertAgentPrompt(text: string, opts?: { replace?: boolean }): string | null {
  const prompt = text.trim()
  if (!prompt) return null
  const store = useSessionStore.getState()
  const id = agentComposerId()
  if (!id) return null
  const current = store.drafts[id] ?? ''
  const next = opts?.replace || !current.trim() ? prompt : `${current.replace(/\s+$/, '')}\n\n${prompt}`
  store.setDraft(id, next)
  store.setAgentVisible(true)
  store.focusComposer(id)
  return id
}

/** Sync a selected path into the agent (focused file + optional @file mention). */
export function insertAgentPath(path: string, opts?: { mention?: boolean }): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  syncWorkspaceAgentFocusedPath(trimmed)
  const id = agentComposerId()
  if (!id) return null
  const store = useSessionStore.getState()
  if (opts?.mention !== false) {
    const token = fileMentionToken(trimmed)
    const current = store.drafts[id] ?? ''
    if (!current.includes(token)) {
      store.setDraft(id, current.trim() ? `${current.trim()} ${token}` : token)
    }
  }
  store.setAgentVisible(true)
  store.focusComposer(id)
  return id
}

export function insertAgentSelectedText(text: string): string | null {
  const body = text.trim()
  if (!body) return null
  return insertAgentPrompt(body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body)
}
