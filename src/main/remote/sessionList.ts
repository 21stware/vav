import type { ChatMessage, AppLocale } from '../../shared/types.ts'
import { compareRemoteSessions, type RemoteSession, type RemoteThreadEvent } from '../../shared/remoteControl.ts'
import { projectRemoteMessages, remoteSessionPreview } from '../../shared/remoteThread.ts'
import { remoteIsTemporary } from '../../shared/remoteWorkspace.ts'
import { threadPath } from '../../shared/thread.ts'

export const REMOTE_SESSION_LIST_CAP = 30

export type RemoteSessionSource = {
  id: string
  title?: string | null
  archived?: boolean
  fileId?: string | null
  swarmParentId?: string | null
  workingDirectory?: string | null
  resultUnseen?: boolean
  updatedAt: number
  messages: ChatMessage[]
  activeLeafId?: string | null
  pinned?: boolean
  pinTime?: number | null
}

/** Phone session list: live conversations only, newest first, capped. */
export function mapRemoteSessions(
  conversations: RemoteSessionSource[],
  opts: {
    fallbackTitle: string
    tmpdir: string
    dirLabel: (workingDirectory: string | null | undefined) => string
    statusOf: (id: string, resultUnseen: boolean) => RemoteSession['status']
    surfaceOf: (id: string) => RemoteSession['surface']
    favoriteOf?: (id: string) => boolean
  }
): RemoteSession[] {
  return conversations
    .filter((c) => !c.archived && !c.fileId && !c.swarmParentId)
    .map((c) => ({
      id: c.id,
      title: (c.title && c.title.trim()) || opts.fallbackTitle,
      dirLabel: opts.dirLabel(c.workingDirectory),
      status: opts.statusOf(c.id, Boolean(c.resultUnseen)),
      surface: opts.surfaceOf(c.id),
      updatedAt: c.updatedAt,
      preview: remoteSessionPreview(threadPath(c.messages, c.activeLeafId ?? null)),
      workdir: c.workingDirectory ?? undefined,
      temporary: remoteIsTemporary(c.workingDirectory, opts.tmpdir),
      pinned: c.pinned === true,
      pinTime: c.pinned && c.pinTime ? c.pinTime : undefined,
      favorite: opts.favoriteOf?.(c.id) === true
    }))
    .sort(compareRemoteSessions)
    .slice(0, REMOTE_SESSION_LIST_CAP)
}

/** Phone `create` fallback when the list snapshot has not caught up yet. */
export function fallbackRemoteSession(
  conversation: {
    id: string
    title?: string | null
    updatedAt: number
  },
  opts: {
    fallbackTitle: string
    dirLabel: string
    surface: RemoteSession['surface']
  }
): RemoteSession {
  return {
    id: conversation.id,
    title: (conversation.title && conversation.title.trim()) || opts.fallbackTitle,
    dirLabel: opts.dirLabel,
    status: 'idle',
    surface: opts.surface,
    updatedAt: conversation.updatedAt
  }
}

/** Phone thread body; archived sessions are hidden. */
export function buildRemoteThreadEvent(
  conversationId: string,
  conversation:
    | {
        archived?: boolean
        messages: ChatMessage[]
        activeLeafId: string | null
      }
    | null
    | undefined,
  locale: AppLocale
): RemoteThreadEvent | null {
  if (!conversation || conversation.archived) return null
  return {
    type: 'thread',
    conversationId,
    messages: projectRemoteMessages(
      threadPath(conversation.messages, conversation.activeLeafId),
      locale
    )
  }
}
