import type { ChatMessage } from '../../shared/types.ts'
import type { RemoteSession } from '../../shared/remoteControl.ts'
import { remoteSessionPreview } from '../../shared/remoteThread.ts'
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
  }
): RemoteSession[] {
  return conversations
    .filter((c) => !c.archived && !c.fileId && !c.swarmParentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, REMOTE_SESSION_LIST_CAP)
    .map((c) => ({
      id: c.id,
      title: (c.title && c.title.trim()) || opts.fallbackTitle,
      dirLabel: opts.dirLabel(c.workingDirectory),
      status: opts.statusOf(c.id, Boolean(c.resultUnseen)),
      surface: opts.surfaceOf(c.id),
      updatedAt: c.updatedAt,
      preview: remoteSessionPreview(threadPath(c.messages, c.activeLeafId ?? null)),
      workdir: c.workingDirectory ?? undefined,
      temporary: remoteIsTemporary(c.workingDirectory, opts.tmpdir)
    }))
}
