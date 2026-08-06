import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Search,
  X
} from 'lucide-react'
import {
  PRESET_MODELS,
  enabledCliAgents,
  type ConversationMeta,
  type SidebarGroupingMode
} from '@shared/types'
import type { FileSessionListEntry } from '@shared/ipc'
import { useSessionStore, type TurnRuntime } from '../state/sessionStore'
import { isTemporaryWorkspace, middleTruncate, relativeTime, workdirShortLabel } from '../lib/format'
import { flatten, groupConversations } from '../lib/grouping'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { basename } from '../lib/path'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'

export function modelLabel(id: string): string {
  return PRESET_MODELS.find((model) => model.id === id)?.label ?? id
}

/** Running CLI agent display name (sidebar-conversation-list.rpml · Agent 类型). */
function agentTypeLabel(
  conversation: ConversationMeta,
  cliAgents: ReturnType<typeof enabledCliAgents>
): string | null {
  const id = conversation.agentBinaryName
  if (!id || id === 'vav') return null
  return cliAgents.find((a) => a.id === id)?.name ?? id
}

/**
 * Subtitle slot, resolved by the priority ladder in
 * sidebar-conversation-list.rpml (annotation 2 → 副标题).
 * Running: `{AgentType} · 流式中 · {Model}` / `{AgentType} · 后台运行 · N 工具`.
 */
function subtitleFor(
  conversation: ConversationMeta,
  turn: TurnRuntime | undefined,
  isActive: boolean,
  tmp: string,
  t: ReturnType<typeof useT>,
  agentLabel: string | null
): string {
  if (turn?.awaitingToolCallId) return t('sidebar.awaitingAnswer')
  if (turn?.isRunning && isActive) {
    const core = t('sidebar.streaming', { model: modelLabel(conversation.model) })
    return agentLabel ? `${agentLabel} · ${core}` : core
  }
  if (turn?.isRunning) {
    const core = t('sidebar.backgroundRunning', { count: turn.toolCount })
    return agentLabel ? `${agentLabel} · ${core}` : core
  }
  if (!isTemporaryWorkspace(conversation.workingDirectory, tmp)) {
    return workdirShortLabel(conversation.workingDirectory, tmp)
  }
  const age = Date.now() - conversation.updatedAt
  if (age > 7 * 24 * 60 * 60 * 1000) return `${relativeTime(conversation.updatedAt)} · ${modelLabel(conversation.model)}`
  return relativeTime(conversation.updatedAt)
}

function groupingOptions(t: ReturnType<typeof useT>): { value: SidebarGroupingMode; label: string }[] {
  return [
    { value: 'none', label: t('sidebar.group.none') },
    { value: 'workspace', label: t('sidebar.group.workspace') }
  ]
}

export function Sidebar({
  floating = false,
  onNavigate
}: {
  /** Rendered as a left overlay on a narrow window (not in the flex split). */
  floating?: boolean
  /** Close the float after a plain navigation pick (not multi-select). */
  onNavigate?: () => void
} = {}): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const activeId = useSessionStore((s) => s.activeId)
  const selectedIds = useSessionStore((s) => s.selectedIds)
  const query = useSessionStore((s) => s.sidebarQuery)
  // Subscribe to a compact busy fingerprint — not the whole `turns` object —
  // so streaming tool ticks on one session don't repaint every sidebar row.
  const turnBusyKey = useSessionStore((s) => {
    const parts: string[] = []
    for (const [id, turn] of Object.entries(s.turns)) {
      if (!turn?.isRunning && !turn?.awaitingToolCallId) continue
      parts.push(`${id}:${turn.phase}:${turn.awaitingToolCallId ? 'a' : 'r'}`)
    }
    return parts.join('|')
  })
  void turnBusyKey
  const turns = useSessionStore.getState().turns
  const tmp = useSessionStore((s) => s.tmp)
  const renamingId = useSessionStore((s) => s.renamingId)
  const groupingMode = useSessionStore((s) => s.settings.sidebarGroupingMode)
  // Select the raw list — never call enabledCliAgents inside the selector
  // (it returns a new array each time → getSnapshot infinite loop).
  const rawCliAgents = useSessionStore((s) => s.settings.cliAgents)
  const cliAgents = useMemo(() => enabledCliAgents(rawCliAgents), [rawCliAgents])
  const activeGroupId = useSessionStore((s) => s.activeGroupId)
  const selectWorkspaceGroup = useSessionStore((s) => s.selectWorkspaceGroup)

  const setSidebarQuery = useSessionStore((s) => s.setSidebarQuery)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const createConversation = useSessionStore((s) => s.createConversation)
  const duplicateConversation = useSessionStore((s) => s.duplicateConversation)
  const requestDelete = useSessionStore((s) => s.requestDelete)
  const beginRename = useSessionStore((s) => s.beginRename)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const setPinned = useSessionStore((s) => s.setPinned)
  const setArchived = useSessionStore((s) => s.setArchived)
  const openDetached = useSessionStore((s) => s.openDetached)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const showToast = useSessionStore((s) => s.showToast)
  const showDialog = useSessionStore((s) => s.showDialog)
  const listMode = useSessionStore((s) => s.sidebarListMode)
  const setListMode = useSessionStore((s) => s.setSidebarListMode)

  const listRef = useRef<HTMLDivElement>(null)
  /** Defers float close on single-click so double-click can open a companion. */
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** File-session list: same delay so dblclick can open the standalone window. */
  const fileClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())
  const [fileSessionRows, setFileSessionRows] = useState<FileSessionListEntry[]>([])
  const [fileSessionsLoading, setFileSessionsLoading] = useState(false)

  const archiveView = listMode === 'archive'
  const fileSessionsView = listMode === 'fileSessions'

  const refreshFileSessions = useCallback(async (): Promise<void> => {
    setFileSessionsLoading(true)
    try {
      const rows = await window.vav.fileSessions.listAll()
      setFileSessionRows(rows)
    } catch {
      setFileSessionRows([])
    } finally {
      setFileSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!fileSessionsView) return
    void refreshFileSessions()
  }, [fileSessionsView, refreshFileSessions])

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      if (fileClickTimerRef.current) clearTimeout(fileClickTimerRef.current)
    }
  }, [])

  const searching = query.trim().length > 0
  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived && !c.fileId).length,
    [conversations]
  )

  // Collapse state is ephemeral: mode switch or search resets to all expanded.
  useEffect(() => {
    setCollapsedKeys(new Set())
  }, [groupingMode, searching, listMode])

  const groups = useMemo(() => {
    if (fileSessionsView) return []
    const needle = query.trim().toLowerCase()
    // File-bound sessions live only under “File sessions” — never in workspace
    // groups. listMeta already omits them; the store still hydrates them for
    // FileSessionView, so we must filter here or a Downloads/file click looks
    // like a normal project session that “wrongly” opens the file canvas.
    if (archiveView) {
      const rows = conversations
        .filter((c) => c.archived && !c.fileId)
        .filter((c) => !needle || c.title.toLowerCase().includes(needle))
        .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
      return [{ key: 'archive', label: '', conversations: rows }]
    }
    const rows = conversations
      .filter((c) => !c.archived && !c.fileId)
      .filter((c) => !needle || c.title.toLowerCase().includes(needle))
    return groupConversations(rows, searching, groupingMode, tmp)
  }, [conversations, query, searching, groupingMode, tmp, archiveView, fileSessionsView])

  const filteredFileSessions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return fileSessionRows
    return fileSessionRows.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        row.path.toLowerCase().includes(needle) ||
        basename(row.path).toLowerCase().includes(needle)
    )
  }, [fileSessionRows, query])

  const visible = useMemo(() => flatten(groups, collapsedKeys), [groups, collapsedKeys])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      if (editing) return
      if (!listRef.current?.contains(document.activeElement) && document.activeElement !== document.body)
        return

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const index = visible.findIndex((c) => c.id === activeId)
        const next = visible[index + (event.key === 'ArrowDown' ? 1 : -1)]
        if (next) void selectConversation(next.id)
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        requestDelete(selectedIds.length ? selectedIds : [activeId])
      } else       if (event.key === 'a' && event.metaKey) {
        event.preventDefault()
        useSessionStore.setState({ selectedIds: visible.map((c) => c.id) })
      } else if (event.key === 'Escape' && listMode !== 'main') {
        event.preventDefault()
        // Keep the float open: Escape steps out of archive / file-sessions first.
        event.stopImmediatePropagation()
        setListMode('main')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, activeId, selectedIds, selectConversation, requestDelete, listMode])

  const menuItems = (ids: string[]): MenuItem[] => {
    const targets = ids
      .map((id) => conversations.find((c) => c.id === id))
      .filter((c): c is ConversationMeta => !!c)
    if (targets.length === 0) return []

    // Multi-select: every action applies to the whole selection.
    if (targets.length > 1) {
      const allPinned = targets.every((c) => c.pinned)
      const allArchived = targets.every((c) => c.archived)
      if (archiveView || allArchived) {
        return [
          {
            label: t('sidebar.menu.unarchiveCount', { count: targets.length }),
            onSelect: () => {
              void (async () => {
                for (const c of targets) await setArchived(c.id, false)
              })()
            }
          },
          { label: '', divider: true },
          {
            label: t('sidebar.menu.deleteCount', { count: targets.length }),
            destructive: true,
            onSelect: () => requestDelete(targets.map((c) => c.id))
          }
        ]
      }
      return [
        {
          label: allPinned
            ? t('sidebar.menu.unpinCount', { count: targets.length })
            : t('sidebar.menu.pinCount', { count: targets.length }),
          onSelect: () => {
            void (async () => {
              for (const c of targets) await setPinned(c.id, !allPinned)
            })()
          }
        },
        {
          label: t('sidebar.menu.archiveCount', { count: targets.length }),
          onSelect: () => {
            void (async () => {
              for (const c of targets) await setArchived(c.id, true)
            })()
          }
        },
        {
          label: t('sidebar.menu.exportCount', { count: targets.length }),
          onSelect: () => void exportSessions(targets.map((c) => c.id))
        },
        { label: '', divider: true },
        {
          label: t('sidebar.menu.deleteCount', { count: targets.length }),
          destructive: true,
          onSelect: () => requestDelete(targets.map((c) => c.id))
        }
      ]
    }

    const conversation = targets[0]
    const id = conversation.id
    const hasRealWorkdir = !isTemporaryWorkspace(conversation.workingDirectory ?? null, tmp)
    if (archiveView || conversation.archived) {
      return [
        {
          label: t('sidebar.menu.unarchive'),
          onSelect: () => void setArchived(id, false)
        },
        { label: '', divider: true },
        { label: t('sidebar.menu.delete'), destructive: true, onSelect: () => requestDelete([id]) }
      ]
    }
    return [
      {
        label: t('sidebar.menu.openDetached'),
        onSelect: () => {
          void openDetached(id)
          // Close the floating overlay after launching the companion.
          onNavigate?.()
        }
      },
      {
        label: conversation.pinned ? t('sidebar.menu.unpin') : t('sidebar.menu.pin'),
        onSelect: () => void setPinned(id, !conversation.pinned)
      },
      {
        label: t('sidebar.menu.archive'),
        onSelect: () => void setArchived(id, true)
      },
      { label: t('sidebar.menu.rename'), onSelect: () => beginRename(id) },
      { label: t('sidebar.menu.duplicate'), onSelect: () => void duplicateConversation(id) },
      {
        label: t('sidebar.menu.export'),
        onSelect: () => void exportSessions([id])
      },
      {
        label: t('sidebar.menu.copyTitle'),
        onSelect: () => void window.vav.conversations.copyToClipboard(conversation.title ?? '')
      },
      {
        label: t('sidebar.menu.revealWorkdir', { fileManager: fileManagerLabel() }),
        disabled: !hasRealWorkdir,
        onSelect: () => {
          if (conversation.workingDirectory) {
            void window.vav.conversations.revealInFinder(conversation.workingDirectory)
          }
        }
      },
      { label: '', divider: true },
      { label: t('sidebar.menu.delete'), destructive: true, onSelect: () => requestDelete([id]) }
    ]
  }

  const exportSessions = async (ids: string[]): Promise<void> => {
    const result = await window.vav.conversations.exportPack(ids)
    if (result.ok === false) {
      if (result.cancelled) return
      showToast({
        kind: 'error',
        title: t('sidebar.exportFailed'),
        description: result.error
      })
      return
    }
    showToast({
      kind: 'success',
      title: t('sidebar.exportOk'),
      description: t('sidebar.exportOkDesc', {
        path: result.path,
        count: result.conversationCount,
        blobs: result.blobCount
      })
    })
  }

  const importSessions = async (): Promise<void> => {
    const result = await window.vav.conversations.importPack()
    if (result.ok === false) {
      if (result.cancelled) return
      showToast({
        kind: 'error',
        title: t('sidebar.importFailed'),
        description: result.error
      })
      return
    }
    showToast({
      kind: 'success',
      title: t('sidebar.importOk'),
      description: t('sidebar.importOkDesc', {
        count: result.importedIds.length,
        blobs: result.blobCount
      })
    })
    if (result.importedIds[0]) {
      void selectConversation(result.importedIds[0])
    }
  }

  const selectionRunClass = (id: string): string => {
    if (selectedIds.length <= 1 || !selectedIds.includes(id)) return ''
    const selected = new Set(selectedIds)
    const index = visible.findIndex((c) => c.id === id)
    if (index < 0) return 'run-only'
    const prev = index > 0 && selected.has(visible[index - 1]!.id)
    const next = index < visible.length - 1 && selected.has(visible[index + 1]!.id)
    if (!prev && !next) return 'run-only'
    if (!prev && next) return 'run-start'
    if (prev && next) return 'run-middle'
    return 'run-end'
  }

  const toggleGroup = (key: string): void => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <aside className={`sidebar${floating ? ' floating' : ''}`}>
      <div className="sidebar-search">
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 7,
              top: 7,
              opacity: 0.5,
              pointerEvents: 'none'
            }}
          />
          <input
            className="text-field"
            style={{ paddingLeft: 24, paddingRight: query ? 24 : 8 }}
            placeholder={t('sidebar.searchPlaceholder')}
            value={query}
            onChange={(event) => setSidebarQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSidebarQuery('')
            }}
          />
          {query && (
            <button
              type="button"
              className="btn icon-only sm"
              style={{ position: 'absolute', right: 2, top: 2 }}
              title={t('common.clear')}
              aria-label={t('common.clear')}
              onClick={() => setSidebarQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {listMode === 'main' && (
          <label className="sidebar-grouping">
            <span className="sidebar-grouping-label">{t('sidebar.grouping')}</span>
            <span className="sidebar-grouping-control">
              <select
                className="text-field sidebar-grouping-select"
                value={groupingMode}
                onChange={(event) =>
                  void updateSettings({
                    sidebarGroupingMode: event.target.value as SidebarGroupingMode
                  })
                }
              >
                {groupingOptions(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="sidebar-grouping-chevron" size={12} aria-hidden />
            </span>
          </label>
        )}
        {listMode !== 'main' && (
          <div className="sidebar-archive-head">
            <button
              type="button"
              className="sidebar-archive-back"
              title={t('sidebar.back')}
              onClick={() => {
                setListMode('main')
                // Leave file-canvas: main list has no file sessions, so keep
                // showing FileSessionView only while still on a file-bound id.
                const store = useSessionStore.getState()
                const active = store.conversations.find((c) => c.id === store.activeId)
                if (active?.fileId) {
                  const next = store.conversations.find((c) => !c.archived && !c.fileId)
                  if (next) void store.selectConversation(next.id)
                }
              }}
            >
              <ArrowLeft size={13} aria-hidden />
              <span className="sidebar-archive-title">
                {archiveView
                  ? t('sidebar.archivedCount', { count: archivedCount })
                  : t('sidebar.fileSessionsTitle', { count: fileSessionRows.length })}
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-list" ref={listRef} tabIndex={-1}>
        {listMode === 'main' &&
          visible.length === 0 &&
          conversations.filter((c) => !c.archived && !c.fileId).length === 0 && (
          <EmptyState title={t('sidebar.emptyTitle')} description={t('sidebar.emptyDesc')}>
            <button
              className="btn secondary"
              onClick={() => {
                void createConversation()
                onNavigate?.()
              }}
            >
              {t('common.newSession')}
            </button>
          </EmptyState>
        )}
        {archiveView && visible.length === 0 && !searching && (
          <EmptyState
            title={t('sidebar.archiveEmptyTitle')}
            description={t('sidebar.archiveEmptyDesc')}
          />
        )}
        {fileSessionsView && !fileSessionsLoading && filteredFileSessions.length === 0 && !searching && (
          <EmptyState
            title={t('sidebar.fileSessionsEmptyTitle')}
            description={t('sidebar.fileSessionsEmptyDesc')}
          />
        )}
        {fileSessionsView && searching && filteredFileSessions.length === 0 && (
          <EmptyState title={t('sidebar.noMatchTitle')} description={t('sidebar.noMatchDesc')}>
            <button className="btn secondary" onClick={() => setSidebarQuery('')}>
              {t('sidebar.clearFilter')}
            </button>
          </EmptyState>
        )}
        {listMode === 'main' && searching && visible.length === 0 && (
          <EmptyState title={t('sidebar.noMatchTitle')} description={t('sidebar.noMatchDesc')}>
            <button className="btn secondary" onClick={() => setSidebarQuery('')}>
              {t('sidebar.clearFilter')}
            </button>
          </EmptyState>
        )}

        {fileSessionsView && (
          <div className="file-session-list" role="list">
            {filteredFileSessions.map((row) => {
              const isActive = row.sessionId === activeId
              const statusLabel =
                row.pathStatus === 'dir_missing'
                  ? t('sidebar.dirNotExist')
                  : row.pathStatus === 'file_missing'
                    ? t('sidebar.fileNotExist')
                    : null
              const pathLabel = basename(row.path) || row.path
              // Flatten auto-titles: strip markdown hashes / leading whitespace.
              const title =
                row.title.replace(/^[#\s\u00a0\u3000]+/, '').trim() || row.title.trim() || 'New session'
              return (
                <button
                  type="button"
                  role="listitem"
                  key={`${row.fileId}:${row.sessionId}`}
                  className={`file-session-item${isActive ? ' is-active' : ''}${statusLabel ? ' is-missing' : ''}`}
                  onClick={(event) => {
                    // Ignore the second half of a double-click pair (open window).
                    if (event.detail > 1) return
                    void selectConversation(row.sessionId)
                    // Floating: delay close so dblclick can open the companion.
                    if (floating && onNavigate) {
                      if (fileClickTimerRef.current) clearTimeout(fileClickTimerRef.current)
                      fileClickTimerRef.current = setTimeout(() => {
                        fileClickTimerRef.current = null
                        onNavigate()
                      }, 280)
                      return
                    }
                    onNavigate?.()
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    if (fileClickTimerRef.current) {
                      clearTimeout(fileClickTimerRef.current)
                      fileClickTimerRef.current = null
                    }
                    // Same as regular sessions: companion window. File sessions
                    // open the file-preview shell (canvas + agent), not bare chat.
                    void selectConversation(row.sessionId)
                    void window.vav.window.openFilePreview(row.path, {
                      origin: 'session',
                      conversationId: row.sessionId
                    })
                    onNavigate?.()
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (fileClickTimerRef.current) {
                      clearTimeout(fileClickTimerRef.current)
                      fileClickTimerRef.current = null
                    }
                    const items: MenuItem[] = [
                      {
                        label: t('sidebar.fileSessionOpenChat'),
                        onSelect: () => {
                          void selectConversation(row.sessionId)
                          onNavigate?.()
                        }
                      },
                      {
                        label: t('sidebar.fileSessionOpenFile'),
                        disabled: row.pathStatus !== 'ok',
                        onSelect: () => {
                          void selectConversation(row.sessionId)
                          void window.vav.window.openFilePreview(row.path, {
                            origin: 'session',
                            conversationId: row.sessionId
                          })
                        }
                      },
                      {
                        label: t('sidebar.menu.openDetached'),
                        onSelect: () => {
                          void selectConversation(row.sessionId)
                          void window.vav.window.openFilePreview(row.path, {
                            origin: 'session',
                            conversationId: row.sessionId
                          })
                          onNavigate?.()
                        }
                      },
                      { label: '', divider: true },
                      {
                        label: t('sidebar.fileSessionDelete'),
                        destructive: true,
                        onSelect: () => {
                          showDialog({
                            title: t('sidebar.fileSessionDelete'),
                            body: title,
                            confirmLabel: t('sidebar.fileSessionDelete'),
                            onConfirm: () => {
                              void (async () => {
                                const result = await window.vav.fileSessions.forceDelete(
                                  row.fileId,
                                  [row.sessionId]
                                )
                                if (!result.ok) {
                                  showToast({
                                    kind: 'error',
                                    title: t('preview.sessionDeleteFailed')
                                  })
                                  return
                                }
                                await refreshFileSessions()
                              })()
                            }
                          })
                        }
                      }
                    ]
                    void showMenu(items)
                  }}
                >
                  <span className="file-session-item-title">{middleTruncate(title)}</span>
                  <span className="file-session-item-sub">
                    {statusLabel
                      ? `${pathLabel} · ${statusLabel}`
                      : `${pathLabel} · ${relativeTime(row.updatedAt)}`}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!fileSessionsView &&
          groups.map((group, groupIndex) => {
          const collapsible = group.kind === 'workspace'
          const collapsed = collapsible && collapsedKeys.has(group.key)
          const groupWorkdir = group.workdir ?? group.conversations[0]?.workingDirectory ?? null
          const isWorkspaceSelected =
            group.kind === 'workspace' && !!groupWorkdir && activeGroupId === groupWorkdir
          return (
            <div className="conv-group" key={group.key || `group-${groupIndex}`}>
              {groupIndex > 0 && <div className="conv-group-divider" />}
              {group.label &&
                (collapsible ? (
                  <div
                    className={`conv-group-header interactive${isWorkspaceSelected ? ' selected' : ''}`}
                    onContextMenu={(event) => {
                      if (group.kind !== 'workspace' || !groupWorkdir) return
                      if (isTemporaryWorkspace(groupWorkdir, tmp)) return
                      event.preventDefault()
                      void showMenu([
                        {
                          label: t('sidebar.menu.newSessionInDir'),
                          onSelect: () =>
                            void createConversation({
                              workingDirectory: groupWorkdir,
                              model: useSessionStore.getState().settings.defaultModel
                            })
                        }
                      ])
                    }}
                  >
                    <button
                      type="button"
                      className="conv-group-chevron-hit"
                      title={collapsed ? t('common.expand') : t('common.collapse')}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleGroup(group.key)
                      }}
                    >
                      {collapsed ? (
                        <ChevronRight className="conv-group-chevron" size={12} aria-hidden />
                      ) : (
                        <ChevronDown className="conv-group-chevron" size={12} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className="conv-group-title-hit"
                      title={t('sidebar.openWorkspaceView')}
                      onClick={() => {
                        if (group.kind !== 'workspace' || !groupWorkdir) {
                          toggleGroup(group.key)
                          return
                        }
                        void selectWorkspaceGroup(groupWorkdir)
                        onNavigate?.()
                      }}
                    >
                      <span className="conv-group-title">{group.label}</span>
                      <span className="conv-group-count">{group.conversations.length}</span>
                    </button>
                  </div>
                ) : (
                  <div className="conv-group-header">
                    <span className="conv-group-title">{group.label}</span>
                  </div>
                ))}

              {!collapsed &&
                group.conversations.map((conversation) => {
                  const turn = turns[conversation.id]
                  const isActive = conversation.id === activeId
                  const isMultiSelected =
                    selectedIds.length > 1 && selectedIds.includes(conversation.id)
                  const runClass = selectionRunClass(conversation.id)
                  const awaiting = !!turn?.awaitingToolCallId
                  const running = !!turn?.isRunning && !awaiting
                  const agentLabel = agentTypeLabel(conversation, cliAgents)

                  return (
                    <div
                      key={conversation.id}
                      className={`conv-row${isActive ? ' selected' : ''}${isMultiSelected ? ` multi ${runClass}` : ''}`}
                      onClick={(event) => {
                        // detail: ignore the second half of a double-click pair
                        if (event.detail > 1) return
                        const additive = event.metaKey
                        const range = event.shiftKey
                        void selectConversation(conversation.id, { additive, range })
                        // Multi-select keeps the float open so the user can keep picking.
                        if (additive || range) return
                        // Floating: delay close so a double-click can still open
                        // a companion window (immediate unmount ate dblclick before).
                        if (floating && onNavigate) {
                          if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
                          clickTimerRef.current = setTimeout(() => {
                            clickTimerRef.current = null
                            onNavigate()
                          }, 280)
                          return
                        }
                        onNavigate?.()
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        if (clickTimerRef.current) {
                          clearTimeout(clickTimerRef.current)
                          clickTimerRef.current = null
                        }
                        void openDetached(conversation.id)
                        onNavigate?.()
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (clickTimerRef.current) {
                          clearTimeout(clickTimerRef.current)
                          clickTimerRef.current = null
                        }
                        // Finder-style: right-click inside a multi-selection keeps
                        // the set and operates on all of it; outside collapses to one.
                        const targets =
                          selectedIds.length > 1 && selectedIds.includes(conversation.id)
                            ? selectedIds
                            : [conversation.id]
                        if (targets.length === 1 && selectedIds.length > 1) {
                          void selectConversation(conversation.id)
                        }
                        void showMenu(menuItems(targets))
                      }}
                    >
                      {renamingId === conversation.id ? (
                        <RenameField
                          initial={conversation.title}
                          onCommit={(title) => void renameConversation(conversation.id, title)}
                          onCancel={() => beginRename(null)}
                        />
                      ) : (
                        <span className="conv-text">
                          <span className="conv-title">{middleTruncate(conversation.title)}</span>
                          <span className="conv-subtitle">
                            {subtitleFor(conversation, turn, isActive, tmp, t, agentLabel)}
                          </span>
                        </span>
                      )}

                      {awaiting && (
                        <span className="conv-badge awaiting" title={t('sidebar.awaitingAnswer')} />
                      )}
                      {running && !isActive && (
                        <span
                          className="conv-badge running"
                          title={t('sidebar.badge.backgroundRunning')}
                        />
                      )}
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>

      {listMode === 'main' && (
        <div className="sidebar-archive-foot">
          <button
            type="button"
            className="btn ghost sm sidebar-archive-btn"
            title={t('sidebar.archived')}
            onClick={() => {
              setSidebarQuery('')
              setListMode('archive')
            }}
          >
            <Archive size={13} />
            <span>{t('sidebar.archived')}</span>
            {archivedCount > 0 && <span className="sidebar-archive-count">{archivedCount}</span>}
          </button>
          <button
            type="button"
            className="btn icon-only sm sidebar-foot-more"
            title={t('sidebar.moreActions')}
            aria-label={t('sidebar.moreActions')}
            onClick={(event) => {
              event.preventDefault()
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
              void showMenu(
                [
                  {
                    label: t('sidebar.showFileSessions'),
                    onSelect: () => {
                      setSidebarQuery('')
                      // Leave workspace canvas so File sessions land on FileSessionView.
                      void selectWorkspaceGroup(null)
                      setListMode('fileSessions')
                    }
                  },
                  { label: '', divider: true },
                  {
                    label: t('sidebar.menu.import'),
                    onSelect: () => void importSessions()
                  }
                ],
                { x: Math.round(rect.right), y: Math.round(rect.top) }
              )
            }}
          >
            <MoreVertical size={14} />
          </button>
        </div>
      )}
    </aside>
  )
}

function RenameField({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (title: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className="text-field rename-field"
      value={value}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(value)
        else if (event.key === 'Escape') onCancel()
      }}
    />
  )
}
