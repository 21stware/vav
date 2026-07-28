import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowLeft, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { PRESET_MODELS, type ConversationMeta, type SidebarGroupingMode } from '@shared/types'
import { useSessionStore, type TurnRuntime } from '../state/sessionStore'
import { isTemporaryWorkspace, middleTruncate, relativeTime, workdirShortLabel } from '../lib/format'
import { flatten, groupConversations } from '../lib/grouping'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'

export function modelLabel(id: string): string {
  return PRESET_MODELS.find((model) => model.id === id)?.label ?? id
}

/**
 * Subtitle slot, resolved by the priority ladder in
 * sidebar-conversation-list.rpml (annotation 2 → 副标题).
 */
function subtitleFor(
  conversation: ConversationMeta,
  turn: TurnRuntime | undefined,
  isActive: boolean,
  tmp: string,
  t: ReturnType<typeof useT>
): string {
  if (turn?.awaitingToolCallId) return t('sidebar.awaitingAnswer')
  if (turn?.isRunning && isActive)
    return t('sidebar.streaming', { model: modelLabel(conversation.model) })
  if (turn?.isRunning)
    return t('sidebar.backgroundRunning', { count: turn.toolCount })
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

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const activeId = useSessionStore((s) => s.activeId)
  const selectedIds = useSessionStore((s) => s.selectedIds)
  const query = useSessionStore((s) => s.sidebarQuery)
  const turns = useSessionStore((s) => s.turns)
  const tmp = useSessionStore((s) => s.tmp)
  const renamingId = useSessionStore((s) => s.renamingId)
  const groupingMode = useSessionStore((s) => s.settings.sidebarGroupingMode)
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

  const listRef = useRef<HTMLDivElement>(null)
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())
  const [archiveView, setArchiveView] = useState(false)

  const searching = query.trim().length > 0
  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  )

  // Collapse state is ephemeral: mode switch or search resets to all expanded.
  useEffect(() => {
    setCollapsedKeys(new Set())
  }, [groupingMode, searching, archiveView])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (archiveView) {
      const rows = conversations
        .filter((c) => c.archived)
        .filter((c) => !needle || c.title.toLowerCase().includes(needle))
        .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
      return [{ key: 'archive', label: '', conversations: rows }]
    }
    const rows = conversations
      .filter((c) => !c.archived)
      .filter((c) => !needle || c.title.toLowerCase().includes(needle))
    return groupConversations(rows, searching, groupingMode, tmp)
  }, [conversations, query, searching, groupingMode, tmp, archiveView])

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
      } else if (event.key === 'Escape' && archiveView) {
        event.preventDefault()
        setArchiveView(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, activeId, selectedIds, selectConversation, requestDelete, archiveView])

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
      { label: t('sidebar.menu.openDetached'), onSelect: () => void openDetached(id) },
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
    <aside className="sidebar">
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
              className="btn icon-only sm"
              style={{ position: 'absolute', right: 2, top: 2 }}
              onClick={() => setSidebarQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!archiveView && (
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
        {archiveView && (
          <div className="sidebar-archive-head">
            <button
              type="button"
              className="btn icon-only sm"
              title={t('sidebar.back')}
              onClick={() => setArchiveView(false)}
            >
              <ArrowLeft size={13} />
            </button>
            <span className="sidebar-archive-title">
              {t('sidebar.archivedCount', { count: archivedCount })}
            </span>
          </div>
        )}
      </div>

      <div className="sidebar-list" ref={listRef} tabIndex={-1}>
        {visible.length === 0 && !archiveView && conversations.filter((c) => !c.archived).length === 0 && (
          <EmptyState title={t('sidebar.emptyTitle')} description={t('sidebar.emptyDesc')}>
            <button className="btn secondary" onClick={() => void createConversation()}>
              {t('common.newSession')}
            </button>
          </EmptyState>
        )}
        {visible.length === 0 && archiveView && !searching && (
          <EmptyState
            title={t('sidebar.archiveEmptyTitle')}
            description={t('sidebar.archiveEmptyDesc')}
          />
        )}
        {visible.length === 0 && searching && (
          <EmptyState title={t('sidebar.noMatchTitle')} description={t('sidebar.noMatchDesc')}>
            <button className="btn secondary" onClick={() => setSidebarQuery('')}>
              {t('sidebar.clearFilter')}
            </button>
          </EmptyState>
        )}

        {groups.map((group, groupIndex) => {
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

                  return (
                    <div
                      key={conversation.id}
                      className={`conv-row${isActive ? ' selected' : ''}${isMultiSelected ? ` multi ${runClass}` : ''}`}
                      onClick={(event) =>
                        void selectConversation(conversation.id, {
                          additive: event.metaKey,
                          range: event.shiftKey
                        })
                      }
                      onDoubleClick={() => void openDetached(conversation.id)}
                      onContextMenu={(event) => {
                        event.preventDefault()
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
                            {subtitleFor(conversation, turn, isActive, tmp, t)}
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

      {!archiveView && (
        <div className="sidebar-archive-foot">
          <button
            type="button"
            className="btn ghost sm sidebar-archive-btn"
            onClick={() => {
              setSidebarQuery('')
              setArchiveView(true)
            }}
          >
            <Archive size={13} />
            <span>{t('sidebar.archived')}</span>
            {archivedCount > 0 && <span className="sidebar-archive-count">{archivedCount}</span>}
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
