import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileSessionMeta } from '@shared/ipc'
import type { MessageKey, TParams } from '@shared/i18n'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { relativeTime } from './format'
import { dirname } from './path'
import type { FileSessionChromeProps } from '../components/SessionDetail'

const EMPTY_SESSIONS: FileSessionMeta[] = []

function toFileSessionMeta(row: {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  tokensUsed?: number
}): FileSessionMeta {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount: 0,
    tokensUsed: row.tokensUsed ?? 0
  }
}

function useHistoryChrome(
  title: string,
  sessions: FileSessionMeta[],
  activeSessionId: string | null,
  handlers: {
    onSwitchSession: (id: string) => void
    onRenameSession: (id: string, title: string) => Promise<void>
    onDeleteSessions: (ids: string[]) => void
    onNewSession: () => void
  }
): FileSessionChromeProps {
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyAnchorRef = useRef<HTMLButtonElement | null>(null)
  return {
    title,
    sessions,
    activeSessionId,
    historyOpen,
    historyAnchorRef,
    onToggleHistory: () => setHistoryOpen((value) => !value),
    onCloseHistory: () => setHistoryOpen(false),
    onSwitchSession: (id) => {
      setHistoryOpen(false)
      handlers.onSwitchSession(id)
    },
    onRenameSession: handlers.onRenameSession,
    onDeleteSessions: handlers.onDeleteSessions,
    onNewSession: () => {
      setHistoryOpen(false)
      handlers.onNewSession()
    }
  }
}

function confirmDeleteSessions(opts: {
  sessions: FileSessionMeta[]
  sessionIds: string[]
  showDialog: (dialog: {
    title: string
    body: string
    confirmLabel: string
    destructive: boolean
    onConfirm: () => void
  }) => void
  t: (key: MessageKey, params?: TParams) => string
  onConfirm: () => void
}): void {
  const targets = opts.sessions.filter((session) => opts.sessionIds.includes(session.id))
  if (targets.length === 0) return
  const single = targets.length === 1
  const totalMessages = targets.reduce((n, session) => n + (session.messageCount ?? 0), 0)
  const title = single
    ? opts.t('dialog.deleteSession')
    : opts.t('dialog.deleteSessions', { count: targets.length })
  const body = single
    ? [
        opts.t('preview.sessionDeleteWarn'),
        '',
        `${opts.t('preview.sessionLabel')}: ${targets[0]!.title}`,
        `${opts.t('preview.sessionMessages', { n: targets[0]!.messageCount ?? 0 })}`,
        `${opts.t('preview.sessionCreated')}: ${relativeTime(targets[0]!.createdAt)}`
      ].join('\n')
    : [
        opts.t('preview.sessionDeleteBulkWarn', {
          count: targets.length,
          messages: totalMessages
        }),
        '',
        ...targets.map((session) => `• ${session.title} (${session.messageCount ?? 0})`)
      ].join('\n')
  opts.showDialog({
    title,
    body,
    confirmLabel: opts.t('common.delete'),
    destructive: true,
    onConfirm: opts.onConfirm
  })
}

/** File-bound history (FileSessionStore) for the main-shell context agent. */
export function useFileSessionHistory(
  fileId: string,
  conversationId: string,
  path: string | null
): FileSessionChromeProps {
  const t = useT()
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const showDialog = useSessionStore((s) => s.showDialog)
  const showToast = useSessionStore((s) => s.showToast)
  const title = useSessionStore(
    (s) => s.conversations.find((row) => row.id === conversationId)?.title ?? ''
  )
  const [sessions, setSessions] = useState<FileSessionMeta[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    if (!fileId || typeof window.vav.fileSessions?.list !== 'function') return
    const listed = await window.vav.fileSessions.list(fileId)
    if (listed?.sessions.length) {
      setSessions(listed.sessions)
      if (listed.activeSessionId !== conversationId) {
        await window.vav.fileSessions.setActive(fileId, conversationId)
        const pinned = await window.vav.fileSessions.list(fileId)
        if (pinned) setSessions(pinned.sessions)
      }
      return
    }
    if (!path) return
    const opened = await window.vav.fileSessions.open(path)
    if (!opened) return
    if (opened.sessions.some((session) => session.id === conversationId)) {
      const pinned = await window.vav.fileSessions.setActive(opened.fileId, conversationId)
      setSessions(pinned?.sessions ?? opened.sessions)
      return
    }
    setSessions(opened.sessions)
  }, [conversationId, fileId, path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const switchSession = useCallback(
    (sessionId: string) => {
      if (!fileId || sessionId === conversationId) return
      void (async () => {
        const state = await window.vav.fileSessions.setActive(fileId, sessionId)
        if (state) setSessions(state.sessions)
        await selectConversation(sessionId, {
          fileSession: {
            fileId,
            title: state?.sessions.find((session) => session.id === sessionId)?.title || title,
            workingDirectory: path ? dirname(path) || null : null
          }
        })
      })()
    },
    [conversationId, fileId, path, selectConversation, title]
  )

  const renameSession = useCallback(
    async (sessionId: string, nextTitle: string): Promise<void> => {
      if (!fileId) return
      const state = await window.vav.fileSessions.rename(fileId, sessionId, nextTitle)
      if (state) setSessions(state.sessions)
    },
    [fileId]
  )

  const newSession = useCallback(() => {
    if (!path) return
    void (async () => {
      const state = await window.vav.fileSessions.create(path)
      if (!state) return
      setSessions(state.sessions)
      await selectConversation(state.activeSessionId, {
        fileSession: {
          fileId: state.fileId,
          title: 'New session',
          workingDirectory: dirname(path) || null
        }
      })
    })()
  }, [path, selectConversation])

  const deleteSessions = useCallback(
    (sessionIds: string[]) => {
      confirmDeleteSessions({
        sessions,
        sessionIds,
        showDialog,
        t,
        onConfirm: () => {
          void (async () => {
            const result = await window.vav.fileSessions.delete(fileId, sessionIds)
            if (!result?.ok) {
              const msg =
                result?.error === 'active_protected'
                  ? t('preview.sessionCannotDeleteActive')
                  : result?.error === 'last_protected'
                    ? t('preview.sessionCannotDeleteLast')
                    : t('preview.sessionDeleteFailed')
              showToast({ kind: 'error', title: msg })
              return
            }
            setSessions(result.sessions)
            if (result.activeSessionId !== conversationId) {
              await selectConversation(result.activeSessionId, {
                fileSession: {
                  fileId,
                  title:
                    result.sessions.find((session) => session.id === result.activeSessionId)
                      ?.title || 'New session',
                  workingDirectory: path ? dirname(path) || null : null
                }
              })
            }
          })()
        }
      })
    },
    [conversationId, fileId, path, selectConversation, sessions, showDialog, showToast, t]
  )

  return useHistoryChrome(title, sessions, conversationId, {
    onSwitchSession: switchSession,
    onRenameSession: renameSession,
    onDeleteSessions: deleteSessions,
    onNewSession: newSession
  })
}

/** Connection-bound history for the DB context agent. */
export function useDbSessionHistory(
  connectionId: string | null,
  conversationId: string
): FileSessionChromeProps {
  const t = useT()
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const showDialog = useSessionStore((s) => s.showDialog)
  const showToast = useSessionStore((s) => s.showToast)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const title = useSessionStore(
    (s) => s.conversations.find((row) => row.id === conversationId)?.title ?? ''
  )
  // Subscribe to the conversations array itself — mapping here would return a
  // new array every getSnapshot and trip React's infinite-loop guard.
  const conversations = useSessionStore((s) => s.conversations)
  const sessions = useMemo(() => {
    if (!connectionId) return EMPTY_SESSIONS
    return conversations
      .filter((row) => row.dbConnectionId === connectionId && !row.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toFileSessionMeta)
  }, [connectionId, conversations])

  const switchSession = useCallback(
    (sessionId: string) => {
      if (!connectionId || sessionId === conversationId) return
      void (async () => {
        await window.vav.db.update(connectionId, { conversationId: sessionId })
        await selectConversation(sessionId)
      })()
    },
    [connectionId, conversationId, selectConversation]
  )

  const renameSession = useCallback(
    async (sessionId: string, nextTitle: string): Promise<void> => {
      await renameConversation(sessionId, nextTitle)
    },
    [renameConversation]
  )

  const newSession = useCallback(() => {
    if (!connectionId || typeof window.vav.db.createSession !== 'function') return
    void (async () => {
      const created = await window.vav.db.createSession(connectionId)
      if (!created?.conversation.id) return
      await selectConversation(created.conversation.id)
    })()
  }, [connectionId, selectConversation])

  const deleteSessions = useCallback(
    (sessionIds: string[]) => {
      confirmDeleteSessions({
        sessions,
        sessionIds,
        showDialog,
        t,
        onConfirm: () => {
          void (async () => {
            if (sessionIds.includes(conversationId)) {
              showToast({ kind: 'error', title: t('preview.sessionCannotDeleteActive') })
              return
            }
            if (sessions.length - sessionIds.length < 1) {
              showToast({ kind: 'error', title: t('preview.sessionCannotDeleteLast') })
              return
            }
            try {
              await window.vav.conversations.remove(sessionIds)
              useSessionStore.setState((state) => ({
                conversations: state.conversations.filter((row) => !sessionIds.includes(row.id))
              }))
            } catch (err) {
              showToast({
                kind: 'error',
                title: t('preview.sessionDeleteFailed'),
                description: err instanceof Error ? err.message : String(err)
              })
            }
          })()
        }
      })
    },
    [conversationId, sessions, showDialog, showToast, t]
  )

  return useHistoryChrome(title, sessions, conversationId, {
    onSwitchSession: switchSession,
    onRenameSession: renameSession,
    onDeleteSessions: deleteSessions,
    onNewSession: newSession
  })
}
