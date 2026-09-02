import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Cable,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Pin,
  Plus,
  Search,
  Star,
  Terminal as TerminalIcon,
  X
} from 'lucide-react'
import {
  enabledCliAgents,
  type ConversationMeta,
  type SidebarGroupingMode
} from '@shared/types'
import type { FileSessionListEntry } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { isTemporaryWorkspace, middleTruncate, relativeTime, workdirShortLabel } from '../lib/format'
import { flatten, groupConversations, type ConversationGroup } from '../lib/grouping'
import {
  conversationMatchesFilter,
  encodeSidebarSessionFilter,
  isSidebarSessionFilterEnabled,
  parseSidebarSessionFilter,
  type SidebarSessionFilter
} from '../lib/sidebarSessionFilter'
import { swarmChildrenOf } from '@shared/swarmLayout'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { warmMenuIcons } from '../lib/menuIcons'
import { fileManagerLabel } from '../lib/platform'
import { basename } from '../lib/path'
import {
  agentTypeLabel,
  conversationSubtitle,
  conversationSelectionRunClass,
  adjacentRunClass,
  filterValueLabel,
  flattenSessionTitle,
  groupingOptions,
  hostMachineLabel,
  incomingConnectLabels,
  pinnableWorkspaceDir
} from '../lib/sidebarList'
import { ConvBracket, type SwarmBracketKind } from './sidebar/ConvBracket'
import { RenameField } from './sidebar/RenameField'
import {
  conversationOnMachine,
  isLocalMachine,
  LOCAL_MACHINE_ID,
  normalizeMachineId,
  recentsForMachine
} from '@shared/workspaceHost'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'
import { UpdateCorner } from './UpdateCorner'

export { modelLabel } from '../lib/sidebarList'

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
  // Same trick for terminals: collapse the whole status map to the set of
  // conversations with a live command, so a chatty PTY repaints at most the
  // rows whose rollup actually flipped.
  const shellBusyKey = useWorkspaceStore((s) => {
    const ids: string[] = []
    for (const [conversationId, tabs] of Object.entries(s.ptyStatus)) {
      if (Object.values(tabs).some((status) => status === 'running')) ids.push(conversationId)
    }
    return ids.sort().join('|')
  })
  const shellBusy = useMemo(
    () => new Set(shellBusyKey ? shellBusyKey.split('|') : []),
    [shellBusyKey]
  )
  const activityById = useSessionStore((s) => s.activityById)
  const tmp = useSessionStore((s) => s.tmp)
  const renamingId = useSessionStore((s) => s.renamingId)
  const groupingMode = useSessionStore((s) => s.settings.sidebarGroupingMode)
  const sessionFilterRaw = useSessionStore((s) => s.settings.sidebarSessionFilter)
  const sessionFilter = parseSidebarSessionFilter(sessionFilterRaw)
  const favoriteIds = useSessionStore((s) => s.settings.favoriteConversationIds)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  // Select the raw list — never call enabledCliAgents inside the selector
  // (it returns a new array each time → getSnapshot infinite loop).
  const rawCliAgents = useSessionStore((s) => s.settings.cliAgents)
  const cliAgents = useMemo(() => enabledCliAgents(rawCliAgents), [rawCliAgents])
  const selectWorkspaceGroup = useSessionStore((s) => s.selectWorkspaceGroup)

  const setSidebarQuery = useSessionStore((s) => s.setSidebarQuery)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const createConversation = useSessionStore((s) => s.createConversation)
  const duplicateConversation = useSessionStore((s) => s.duplicateConversation)
  const requestDelete = useSessionStore((s) => s.requestDelete)
  const beginRename = useSessionStore((s) => s.beginRename)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const setPinned = useSessionStore((s) => s.setPinned)
  const setFavorite = useSessionStore((s) => s.setFavorite)
  const setWorkspacePinned = useSessionStore((s) => s.setWorkspacePinned)
  const pinnedWorkspaces = useSessionStore((s) => s.settings.pinnedWorkspaceDirectories)
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
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const [fileSessionRows, setFileSessionRows] = useState<FileSessionListEntry[]>([])
  const [fileSessionsLoading, setFileSessionsLoading] = useState(false)

  useEffect(() => {
    if (!activeId) return
    const root = listRef.current
    if (!root) return
    const frame = window.requestAnimationFrame(() => {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(activeId)
          : activeId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const el = root.querySelector(`[data-conversation-id="${escaped}"]`)
      if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeId, listMode, fileSessionRows.length])

  const archiveView = listMode === 'archive'
  const fileSessionsView = listMode === 'fileSessions'

  // Rasterize the foot-menu glyphs ahead of the first open.
  useEffect(() => {
    warmMenuIcons([
      { kind: 'lucide', key: 'file-sessions' },
      { kind: 'lucide', key: 'archive' },
      { kind: 'lucide', key: 'import' },
      { kind: 'lucide', key: 'settings' }
    ])
  }, [])

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
  const hosts = useSessionStore((s) => s.hosts)
  const remoteControlStatus = useSessionStore((s) => s.remoteControlStatus)
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const defaultMachineId = normalizeMachineId(useSessionStore((s) => s.settings.defaultMachineId))
  const activeHost = hosts.find((h) => h.id === windowMachineId)
  const machineLabel = (machineId: string, fallback?: string): string =>
    hostMachineLabel(machineId, hosts, LOCAL_MACHINE_ID, t('sidebar.thisMachine'), fallback)
  // Incoming phones still annotate the local Connect control.
  const incomingDeviceLabels = useMemo(
    () =>
      incomingConnectLabels(remoteControlStatus?.clients, (name) =>
        t('sidebar.connectWith', { name })
      ),
    [remoteControlStatus, t]
  )
  const localWindow = isLocalMachine(windowMachineId)
  const connectButtonLabel = localWindow
    ? incomingDeviceLabels.length > 0
      ? incomingDeviceLabels.join(' · ')
      : t('sidebar.connect')
    : machineLabel(windowMachineId, activeHost?.name)
  const connectButtonTitle = localWindow
    ? incomingDeviceLabels.length > 0
      ? incomingDeviceLabels.join(' · ')
      : t('sidebar.connect')
    : machineLabel(windowMachineId, activeHost?.name)

  const openRemoteHostMenu = (anchor: HTMLElement): void => {
    const items: MenuItem[] = [
      {
        label: t('sidebar.setDefaultService'),
        checked: defaultMachineId === windowMachineId,
        onSelect: () => void setDefaultMachine(windowMachineId)
      },
      { label: '', divider: true },
      {
        label: t('sidebar.pairDevice'),
        onSelect: () => void window.vav.window.openConnect()
      },
      {
        label: t('machines.forget'),
        onSelect: () => void window.vav.hosts.forget(windowMachineId)
      }
    ]
    void showMenu(items, menuAnchor(anchor))
  }

  const archivedCount = useMemo(
    () =>
      conversations.filter(
        (c) => c.archived && !c.fileId && conversationOnMachine(c, windowMachineId)
      ).length,
    [conversations, windowMachineId]
  )

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])

  const isSessionRunning = (id: string): boolean => {
    const turn = turns[id]
    return !!turn?.isRunning || activityById[id] === 'running' || shellBusy.has(id)
  }
  const isSessionUnread = (id: string): boolean => {
    const conversation = conversations.find((c) => c.id === id)
    const turn = turns[id]
    const awaiting = !!turn?.awaitingToolCallId
    const running = !!turn?.isRunning && !awaiting
    return (
      (!awaiting && !running && activityById[id] === 'done') || conversation?.resultUnseen === true
    )
  }

  // Collapse state is ephemeral: mode switch or search resets to all expanded.
  useEffect(() => {
    setCollapsedKeys(new Set())
  }, [groupingMode, sessionFilterRaw, searching, listMode])

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
        .filter((c) => conversationOnMachine(c, windowMachineId))
        .filter((c) => !needle || c.title.toLowerCase().includes(needle))
        .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
      return [{ key: 'archive', label: '', conversations: rows }]
    }
    const matched = conversations
      .filter((c) => !c.archived && !c.fileId)
      .filter((c) => conversationOnMachine(c, windowMachineId))
      .filter((c) => !needle || c.title.toLowerCase().includes(needle))
      .filter((c) =>
        conversationMatchesFilter(c, sessionFilter, {
          running: isSessionRunning(c.id),
          unread: isSessionUnread(c.id),
          favoriteIds: favoriteSet
        })
      )
    const keep = new Set(matched.map((c) => c.id))
    for (const row of matched) {
      if (row.swarmParentId) keep.add(row.swarmParentId)
    }
    const rows = conversations.filter((c) => keep.has(c.id) && !c.archived && !c.fileId)
    return groupConversations(rows, searching, groupingMode, tmp, pinnedWorkspaces)
  }, [
    conversations,
    query,
    searching,
    groupingMode,
    sessionFilterRaw,
    favoriteSet,
    tmp,
    pinnedWorkspaces,
    archiveView,
    fileSessionsView,
    turnBusyKey,
    shellBusyKey,
    activityById,
    windowMachineId
  ])

  const pinnedGroups = useMemo(() => groups.filter((g) => g.pinned), [groups])
  const mainGroups = useMemo(() => groups.filter((g) => !g.pinned), [groups])
  const pinnedCount = useMemo(
    () => pinnedGroups.reduce((sum, g) => sum + (g.kind === 'workspace' ? 1 : g.conversations.length), 0),
    [pinnedGroups]
  )

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

  const swarmEnabled = useSessionStore((s) => s.settings.swarmModeEnabled === true)
  const focusSwarmSession = useSessionStore((s) => s.focusSwarmSession)
  const visible = useMemo(
    () =>
      flatten(pinnedCollapsed ? mainGroups : groups, collapsedKeys, (row) =>
        swarmEnabled ? swarmChildrenOf(conversations, row.id) : []
      ),
    [groups, mainGroups, pinnedCollapsed, collapsedKeys, conversations, swarmEnabled]
  )

  const fileSessionOrderedIds = useMemo(
    () => filteredFileSessions.map((row) => row.sessionId),
    [filteredFileSessions]
  )

  const deleteSelectedFileSessions = useCallback(
    (sessionIds: string[]): void => {
      const wanted = [...new Set(sessionIds)].filter(Boolean)
      if (wanted.length === 0) return
      const targets = filteredFileSessions.filter((row) => wanted.includes(row.sessionId))
      if (targets.length === 0) return
      const messageTotal = targets.reduce((sum, row) => sum + (row.messageCount || 0), 0)
      const title =
        targets.length === 1
          ? flattenSessionTitle(targets[0]!.title, t('sidebar.fileSessionDelete'))
          : t('sidebar.fileSessionDeleteCount', { count: targets.length })
      const body =
        targets.length === 1
          ? title
          : t('preview.sessionDeleteBulkWarn', {
              count: targets.length,
              messages: messageTotal
            })
      showDialog({
        title: t('sidebar.fileSessionDelete'),
        body,
        confirmLabel:
          targets.length === 1
            ? t('sidebar.fileSessionDelete')
            : t('sidebar.fileSessionDeleteCount', { count: targets.length }),
        onConfirm: () => {
          void (async () => {
            const byFile = new Map<string, string[]>()
            for (const row of targets) {
              const list = byFile.get(row.fileId) ?? []
              list.push(row.sessionId)
              byFile.set(row.fileId, list)
            }
            let failed = false
            for (const [fileId, ids] of byFile) {
              const result = await window.vav.fileSessions.forceDelete(fileId, ids)
              if (!result.ok) failed = true
            }
            if (failed) {
              showToast({ kind: 'error', title: t('preview.sessionDeleteFailed') })
            }
            await refreshFileSessions()
            // Drop deleted ids from the multi-selection.
            const alive = new Set(
              (await window.vav.fileSessions.listAll()).map((r) => r.sessionId)
            )
            const { selectedIds: prev, activeId: cur } = useSessionStore.getState()
            const nextSel = prev.filter((id) => alive.has(id))
            const nextActive = cur && alive.has(cur) ? cur : nextSel[0] ?? ''
            useSessionStore.setState({
              selectedIds: nextSel.length ? nextSel : nextActive ? [nextActive] : []
            })
            if (nextActive && nextActive !== cur) {
              void selectConversation(nextActive)
            }
          })()
        }
      })
    },
    [filteredFileSessions, refreshFileSessions, selectConversation, showDialog, showToast, t]
  )

  const fileSessionMenuItems = useCallback(
    (ids: string[]): MenuItem[] => {
      const targets = filteredFileSessions.filter((row) => ids.includes(row.sessionId))
      if (targets.length === 0) return []
      const multi = targets.length > 1
      const openable = targets.filter((row) => row.pathStatus === 'ok')

      const openPreviews = (rows: FileSessionListEntry[]): void => {
        for (const row of rows) {
          void window.vav.window.openFilePreview(row.path, {
            origin: 'session',
            conversationId: row.sessionId,
            surface: 'file'
          })
        }
      }

      if (multi) {
        return [
          {
            label: t('sidebar.fileSessionOpenFileCount', { count: openable.length || targets.length }),
            disabled: openable.length === 0,
            onSelect: () => openPreviews(openable)
          },
          {
            label: t('sidebar.fileSessionOpenDetachedCount', { count: targets.length }),
            disabled: openable.length === 0,
            onSelect: () => {
              openPreviews(openable)
              onNavigate?.()
            }
          },
          {
            label: t('sidebar.menu.copyTitle'),
            onSelect: () => {
              const text = targets
                .map((row) => flattenSessionTitle(row.title, ''))
                .filter(Boolean)
                .join('\n')
              void window.vav.conversations.copyToClipboard(text)
            }
          },
          { label: '', divider: true },
          {
            label: t('sidebar.fileSessionDeleteCount', { count: targets.length }),
            destructive: true,
            onSelect: () => deleteSelectedFileSessions(targets.map((row) => row.sessionId))
          }
        ]
      }

      const row = targets[0]!
      const title = flattenSessionTitle(row.title)
      return [
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
              conversationId: row.sessionId,
              surface: 'file'
            })
          }
        },
        {
          label: t('sidebar.menu.openDetached'),
          disabled: row.pathStatus !== 'ok',
          onSelect: () => {
            void selectConversation(row.sessionId)
            void window.vav.window.openFilePreview(row.path, {
              origin: 'session',
              conversationId: row.sessionId,
              surface: 'file'
            })
            onNavigate?.()
          }
        },
        {
          label: t('sidebar.menu.copyTitle'),
          onSelect: () => void window.vav.conversations.copyToClipboard(title)
        },
        { label: '', divider: true },
        {
          label: t('sidebar.fileSessionDelete'),
          destructive: true,
          onSelect: () => deleteSelectedFileSessions([row.sessionId])
        }
      ]
    },
    [deleteSelectedFileSessions, filteredFileSessions, onNavigate, selectConversation, t]
  )

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

      if (fileSessionsView) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const index = fileSessionOrderedIds.indexOf(activeId)
          const base = index < 0 ? (event.key === 'ArrowDown' ? -1 : 0) : index
          const next = fileSessionOrderedIds[base + (event.key === 'ArrowDown' ? 1 : -1)]
          if (next) {
            void selectConversation(next, {
              range: event.shiftKey,
              rangeIds: fileSessionOrderedIds
            })
          }
          return
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault()
          const ids = selectedIds.length ? selectedIds : activeId ? [activeId] : []
          deleteSelectedFileSessions(ids)
          return
        }
        if (event.key === 'a' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          useSessionStore.setState({ selectedIds: [...fileSessionOrderedIds] })
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopImmediatePropagation()
          setListMode('main')
        }
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const index = visible.findIndex((c) => c.id === activeId)
        const next = visible[index + (event.key === 'ArrowDown' ? 1 : -1)]
        if (next) void selectConversation(next.id)
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        requestDelete(selectedIds.length ? selectedIds : [activeId])
      } else if (event.key === 'a' && event.metaKey) {
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
  }, [
    visible,
    activeId,
    selectedIds,
    selectConversation,
    requestDelete,
    listMode,
    fileSessionsView,
    fileSessionOrderedIds,
    deleteSelectedFileSessions,
    setListMode
  ])

  /**
   * Archive without leaving the session list: when the active row goes away,
   * move the selection to the visible row just above it (else the one below).
   */
  const archiveKeepingList = async (ids: string[]): Promise<void> => {
    const current = useSessionStore.getState().activeId
    let neighbor: string | null = null
    if (current && ids.includes(current)) {
      const leaving = new Set(ids)
      const index = visible.findIndex((c) => c.id === current)
      if (index >= 0) {
        for (let i = index - 1; i >= 0; i -= 1) {
          if (!leaving.has(visible[i]!.id)) {
            neighbor = visible[i]!.id
            break
          }
        }
        if (!neighbor) {
          for (let i = index + 1; i < visible.length; i += 1) {
            if (!leaving.has(visible[i]!.id)) {
              neighbor = visible[i]!.id
              break
            }
          }
        }
      }
    }
    for (const id of ids) await setArchived(id, true)
    if (neighbor) await selectConversation(neighbor)
  }

  const menuItems = (ids: string[]): MenuItem[] => {
    const targets = ids
      .map((id) => conversations.find((c) => c.id === id))
      .filter((c): c is ConversationMeta => !!c)
    if (targets.length === 0) return []

    // Multi-select: every action applies to the whole selection.
    if (targets.length > 1) {
      const allPinned = targets.every((c) => c.pinned)
      const allFavorite = targets.every((c) => favoriteSet.has(c.id))
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
          label: allFavorite
            ? t('sidebar.menu.unfavoriteCount', { count: targets.length })
            : t('sidebar.menu.favoriteCount', { count: targets.length }),
          onSelect: () => {
            void (async () => {
              for (const c of targets) await setFavorite(c.id, !allFavorite)
            })()
          }
        },
        {
          label: t('sidebar.menu.archiveCount', { count: targets.length }),
          onSelect: () => void archiveKeepingList(targets.map((c) => c.id))
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
        label: favoriteSet.has(id) ? t('sidebar.menu.unfavorite') : t('sidebar.menu.favorite'),
        onSelect: () => void setFavorite(id, !favoriteSet.has(id))
      },
      {
        label: t('sidebar.menu.archive'),
        onSelect: () => void archiveKeepingList([id])
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

  const visibleIds = visible.map((c) => c.id)
  const selectionRunClass = (id: string): string =>
    conversationSelectionRunClass(id, selectedIds, visibleIds)

  const toggleGroup = (key: string): void => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderGroup = (group: ConversationGroup, groupIndex: number): React.JSX.Element => {
    const collapsible = group.kind === 'workspace'
    const collapsed = collapsible && collapsedKeys.has(group.key)
    const groupWorkdir = group.workdir ?? group.conversations[0]?.workingDirectory ?? null
    // A Temporary Workspace is minted per session and has no durable path to pin.
    const pinnableWorkdir = pinnableWorkspaceDir({
      groupKind: group.kind,
      workspaceSelectable: group.workspaceSelectable,
      groupWorkdir,
      tmp,
      isTemporaryWorkspace
    })
    const workspacePinnable = pinnableWorkdir != null
    const workspacePinned = !!pinnableWorkdir && pinnedWorkspaces.includes(pinnableWorkdir)
    return (
      <div
        className={`conv-group${collapsible ? ' is-workspace' : ''}${group.pinned ? ' pinned' : ''}${workspacePinnable ? '' : ' is-default-workspace'}`}
        key={group.key || `group-${groupIndex}`}
      >
        {groupIndex > 0 && <div className="conv-group-divider" />}
        {group.label &&
          (collapsible ? (
            <div
              className="conv-group-header interactive"
              onContextMenu={(event) => {
                if (!workspacePinnable || !groupWorkdir) return
                event.preventDefault()
                void showMenu([
                  {
                    label: t('sidebar.menu.newSessionInDir'),
                    onSelect: () =>
                      void createConversation({
                        workingDirectory: groupWorkdir
                      })
                  },
                  {
                    label: workspacePinned
                      ? t('sidebar.menu.unpinWorkspace')
                      : t('sidebar.menu.pinWorkspace'),
                    onSelect: () => void setWorkspacePinned(groupWorkdir, !workspacePinned)
                  }
                ])
              }}
            >
              <button
                type="button"
                className="conv-group-title-hit"
                title={
                  groupWorkdir
                    ? groupWorkdir
                    : collapsed
                      ? t('common.expand')
                      : t('common.collapse')
                }
                onClick={() => {
                  toggleGroup(group.key)
                }}
              >
                <span className="conv-group-title">{group.label}</span>
              </button>
              {pinnableWorkdir && (
                <button
                  type="button"
                  className={`conv-group-pin-hit${workspacePinned ? ' pinned' : ''}`}
                  title={
                    workspacePinned
                      ? t('sidebar.menu.unpinWorkspace')
                      : t('sidebar.menu.pinWorkspace')
                  }
                  aria-label={
                    workspacePinned
                      ? t('sidebar.menu.unpinWorkspace')
                      : t('sidebar.menu.pinWorkspace')
                  }
                  aria-pressed={workspacePinned}
                  onClick={(event) => {
                    event.stopPropagation()
                    void setWorkspacePinned(pinnableWorkdir, !workspacePinned)
                  }}
                >
                  <Pin size={11} strokeWidth={1.75} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="conv-group-collapse-hit"
                title={collapsed ? t('common.expand') : t('common.collapse')}
                aria-expanded={!collapsed}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleGroup(group.key)
                }}
              >
                <span className="conv-group-count">{group.conversations.length}</span>
                {collapsed ? (
                  <ChevronRight className="conv-group-chevron" size={12} aria-hidden />
                ) : (
                  <ChevronDown className="conv-group-chevron" size={12} aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="conv-group-add-hit"
                title={t('sidebar.menu.newSessionInDir')}
                aria-label={t('sidebar.menu.newSessionInDir')}
                onClick={(event) => {
                  event.stopPropagation()
                  if (groupWorkdir) {
                    void createConversation({
                      workingDirectory: groupWorkdir
                    })
                  } else {
                    // Empty Temporary Workspace — mint on demand.
                    void createConversation()
                  }
                  onNavigate?.()
                }}
              >
                <Plus size={12} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="conv-group-header">
              <span className="conv-group-title" title={group.label}>
                {group.label}
              </span>
            </div>
          ))}

        {!collapsed &&
          group.conversations.flatMap((conversation) => {
            const nested = swarmEnabled ? swarmChildrenOf(conversations, conversation.id) : []
            const rows: {
              conversation: ConversationMeta
              isSwarmChild: boolean
              swarmBracket: SwarmBracketKind | null
            }[] = [
              {
                conversation,
                isSwarmChild: false,
                swarmBracket: nested.length > 0 ? 'first' : null
              }
            ]
            for (let index = 0; index < nested.length; index++) {
              rows.push({
                conversation: nested[index],
                isSwarmChild: true,
                swarmBracket: index === nested.length - 1 ? 'last' : 'mid'
              })
            }
            return rows
          }).map(({ conversation, isSwarmChild, swarmBracket }) => {
            const turn = turns[conversation.id]
            const isActive = conversation.id === activeId
            const isMultiSelected =
              selectedIds.length > 1 && selectedIds.includes(conversation.id)
            const runClass = selectionRunClass(conversation.id)
            const awaiting = !!turn?.awaitingToolCallId
            const running = !!turn?.isRunning && !awaiting
            const doneUnseen = !awaiting && !running && activityById[conversation.id] === 'done'
            const agentLabel = agentTypeLabel(conversation, cliAgents)
            const subtitle = conversationSubtitle({
              conversation,
              turn,
              isActive,
              tmp,
              t,
              agentLabel,
              hideWorkdir: group.kind === 'workspace',
              relativeTime,
              isTemporaryWorkspace,
              workdirShortLabel
            })
            const rowTitle =
              conversation.workingDirectory &&
              !isTemporaryWorkspace(conversation.workingDirectory, tmp) &&
              group.kind !== 'workspace'
                ? `${conversation.title}\n${conversation.workingDirectory}`
                : conversation.title

            return (
              <div
                key={conversation.id}
                className={`conv-row${isActive ? ' selected' : ''}${isMultiSelected ? ` multi ${runClass}` : ''}${
                  swarmBracket ? ' is-swarm-item' : ''
                }${swarmBracket === 'first' ? ' is-swarm-parent' : ''}${isSwarmChild ? ' is-swarm-child' : ''}`}
                data-testid="session-row"
                data-conversation-id={conversation.id}
                title={rowTitle}
                onClick={(event) => {
                  // detail: ignore the second half of a double-click pair
                  if (event.detail > 1) return
                  const additive = event.metaKey
                  const range = event.shiftKey
                  if (swarmEnabled && !additive && !range) {
                    void focusSwarmSession(conversation.id)
                  } else {
                    void selectConversation(conversation.id, { additive, range })
                  }
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
                {swarmBracket ? <ConvBracket kind={swarmBracket} /> : null}
                {renamingId === conversation.id ? (
                  <RenameField
                    initial={conversation.title}
                    onCommit={(title) => void renameConversation(conversation.id, title)}
                    onCancel={() => beginRename(null)}
                  />
                ) : (
                  <span className="conv-text">
                    <span className="conv-title">
                      {middleTruncate(
                        isSwarmChild && agentLabel ? agentLabel : conversation.title
                      )}
                    </span>
                    {subtitle && (
                      <span className="conv-subtitle">
                        <span className="conv-subtitle-text">
                          {subtitle.kind === 'status'
                            ? subtitle.text
                            : subtitle.dir
                              ? `${subtitle.age} · ${subtitle.dir}`
                              : subtitle.age}
                        </span>
                      </span>
                    )}
                  </span>
                )}

                {!archiveView && renamingId !== conversation.id && (
                  <button
                    type="button"
                    className={`conv-star-hit${favoriteSet.has(conversation.id) ? ' favorited' : ''}`}
                    title={
                      favoriteSet.has(conversation.id)
                        ? t('sidebar.menu.unfavorite')
                        : t('sidebar.menu.favorite')
                    }
                    aria-label={
                      favoriteSet.has(conversation.id)
                        ? t('sidebar.menu.unfavorite')
                        : t('sidebar.menu.favorite')
                    }
                    aria-pressed={favoriteSet.has(conversation.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      void setFavorite(conversation.id, !favoriteSet.has(conversation.id))
                    }}
                  >
                    <Star size={10} strokeWidth={1.75} aria-hidden />
                  </button>
                )}

                {!archiveView && renamingId !== conversation.id && (
                  <button
                    type="button"
                    className={`conv-pin-hit${conversation.pinned ? ' pinned' : ''}`}
                    title={conversation.pinned ? t('sidebar.menu.unpin') : t('sidebar.menu.pin')}
                    aria-label={
                      conversation.pinned ? t('sidebar.menu.unpin') : t('sidebar.menu.pin')
                    }
                    aria-pressed={!!conversation.pinned}
                    onClick={(event) => {
                      event.stopPropagation()
                      void setPinned(conversation.id, !conversation.pinned)
                    }}
                  >
                    <Pin size={10} strokeWidth={1.75} aria-hidden />
                  </button>
                )}

                {/* Unlike the agent badge this stays up on the active
                    row: the tools tray is often collapsed over it. */}
                {shellBusy.has(conversation.id) && (
                  <span
                    className="conv-shell-badge"
                    title={t('sidebar.badge.terminalRunning')}
                  >
                    <TerminalIcon size={11} aria-hidden />
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
                {doneUnseen && (
                  <span className="conv-badge done" title={t('sidebar.badge.done')} />
                )}
              </div>
            )
          })}
      </div>
    )
  }

  return (
    <aside className={`sidebar${floating ? ' floating' : ''}`} data-testid="sidebar">
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
            data-testid="sidebar-search"
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
          <div className="sidebar-list-controls">
            <label className="sidebar-grouping" title={t('sidebar.grouping')}>
              <span className="sidebar-grouping-label">{t('sidebar.grouping')}</span>
              <span className="sidebar-grouping-control">
                <select
                  className="text-field sidebar-grouping-select"
                  data-testid="sidebar-grouping"
                  value={groupingMode}
                  title={t('sidebar.grouping')}
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
            <button
              type="button"
              className={`sidebar-filter${isSidebarSessionFilterEnabled(sessionFilter) ? ' is-active' : ''}`}
              data-testid="sidebar-filter"
              title={t('sidebar.filter')}
              onClick={(event) => {
                const apply = (next: SidebarSessionFilter): void => {
                  void updateSettings({
                    sidebarSessionFilter: encodeSidebarSessionFilter(next)
                  })
                }
                const recent = recentsForMachine(recentDirs, windowMachineId)
                  .map((ref) => ref.path)
                  .slice(0, 3)
                const extra =
                  sessionFilter.kind === 'workspace' && !recent.includes(sessionFilter.path)
                    ? [sessionFilter.path]
                    : []
                const workspaces = [...recent, ...extra]
                const items: MenuItem[] = [
                  {
                    label: t('sidebar.filter.none'),
                    checked: sessionFilter.kind === 'none',
                    onSelect: () => apply({ kind: 'none' })
                  },
                  {
                    label: t('sidebar.filter.active'),
                    checked: sessionFilter.kind === 'active',
                    onSelect: () => apply({ kind: 'active' })
                  },
                  {
                    label: t('sidebar.filter.favorite'),
                    checked: sessionFilter.kind === 'favorite',
                    onSelect: () => apply({ kind: 'favorite' })
                  }
                ]
                if (workspaces.length > 0) {
                  items.push({ label: '', divider: true })
                  for (const path of workspaces) {
                    items.push({
                      label: basename(path),
                      checked:
                        sessionFilter.kind === 'workspace' && sessionFilter.path === path,
                      onSelect: () => apply({ kind: 'workspace', path })
                    })
                  }
                }
                void showMenu(items, menuAnchor(event.currentTarget))
              }}
            >
              <span className="sidebar-filter-label">{t('sidebar.filter')}</span>
              <span className="sidebar-filter-value">
                {filterValueLabel(sessionFilter, t)}
              </span>
              <ChevronDown className="sidebar-filter-chevron" size={12} aria-hidden />
            </button>
          </div>
        )}
        {listMode !== 'main' && (
          <div className="sidebar-archive-head">
            <button
              type="button"
              className="sidebar-archive-back"
              data-testid="sidebar-archive-back"
              title={t('sidebar.back')}
              onClick={() => {
                setListMode('main')
                // Leave file-canvas: main list has no file sessions, so keep
                // showing FileSessionView only while still on a file-bound id.
                const store = useSessionStore.getState()
                const active = store.conversations.find((c) => c.id === store.activeId)
                if (active?.fileId || active?.archived) {
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
          conversations.filter(
            (c) => !c.archived && !c.fileId && conversationOnMachine(c, windowMachineId)
          ).length === 0 &&
          groupingMode !== 'workspace' && (
          <EmptyState
            title={
              localWindow ? t('sidebar.emptyTitle') : t('sidebar.emptyRemoteTitle')
            }
            description={
              localWindow
                ? t('sidebar.emptyDesc')
                : t('sidebar.emptyRemoteDesc', { name: machineLabel(windowMachineId) })
            }
          >
            <button
              className="btn secondary"
              title={t('common.newSession')}
              onClick={() => {
                void createConversation({ machineId: windowMachineId })
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
            <button
              className="btn secondary"
              title={t('sidebar.clearFilter')}
              onClick={() => setSidebarQuery('')}
            >
              {t('sidebar.clearFilter')}
            </button>
          </EmptyState>
        )}
        {listMode === 'main' && searching && visible.length === 0 && (
          <EmptyState title={t('sidebar.noMatchTitle')} description={t('sidebar.noMatchDesc')}>
            <button
              className="btn secondary"
              title={t('sidebar.clearFilter')}
              onClick={() => setSidebarQuery('')}
            >
              {t('sidebar.clearFilter')}
            </button>
          </EmptyState>
        )}
        {listMode === 'main' &&
          !searching &&
          visible.length === 0 &&
          isSidebarSessionFilterEnabled(sessionFilter) && (
          <EmptyState title={t('sidebar.noMatchTitle')} description={t('sidebar.noMatchDesc')}>
            <button
              className="btn secondary"
              title={t('sidebar.clearFilter')}
              data-testid="sidebar-clear-filter"
              onClick={() =>
                void updateSettings({ sidebarSessionFilter: encodeSidebarSessionFilter({ kind: 'none' }) })
              }
            >
              {t('sidebar.clearFilter')}
            </button>
          </EmptyState>
        )}

        {fileSessionsView && (
          <div className="file-session-list" role="list">
            {filteredFileSessions.map((row, index) => {
              const isActive = row.sessionId === activeId
              const isMultiSelected = selectedIds.includes(row.sessionId)
              const prevMulti =
                index > 0 && selectedIds.includes(filteredFileSessions[index - 1]!.sessionId)
              const nextMulti =
                index < filteredFileSessions.length - 1 &&
                selectedIds.includes(filteredFileSessions[index + 1]!.sessionId)
              const runClass = isMultiSelected ? adjacentRunClass(prevMulti, nextMulti) : ''
              const statusLabel =
                row.pathStatus === 'dir_missing'
                  ? t('sidebar.dirNotExist')
                  : row.pathStatus === 'file_missing'
                    ? t('sidebar.fileNotExist')
                    : null
              const pathLabel = basename(row.path) || row.path
              // Flatten auto-titles: strip markdown hashes / leading whitespace.
              const title = flattenSessionTitle(row.title)
              return (
                <button
                  type="button"
                  role="listitem"
                  key={`${row.fileId}:${row.sessionId}`}
                  className={`file-session-item${isActive ? ' is-active' : ''}${
                    isMultiSelected ? ` multi ${runClass}` : ''
                  }${statusLabel ? ' is-missing' : ''}`}
                  data-conversation-id={row.sessionId}
                  title={`${title}\n${row.path}`}
                  onClick={(event) => {
                    // Ignore the second half of a double-click pair (open window).
                    if (event.detail > 1) return
                    const additive = event.metaKey || event.ctrlKey
                    const range = event.shiftKey
                    void selectConversation(row.sessionId, {
                      additive,
                      range,
                      rangeIds: fileSessionOrderedIds
                    })
                    // Multi-select keeps the float open so the user can keep picking.
                    if (additive || range) return
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
                      conversationId: row.sessionId,
                      surface: 'file'
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
                    // Finder-style: right-click inside a multi-selection keeps
                    // the set and operates on all of it; outside collapses to one.
                    const targets =
                      selectedIds.length > 1 && selectedIds.includes(row.sessionId)
                        ? selectedIds
                        : [row.sessionId]
                    if (targets.length === 1 && selectedIds.length > 1) {
                      void selectConversation(row.sessionId)
                    }
                    void showMenu(fileSessionMenuItems(targets))
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

        {!fileSessionsView && pinnedGroups.length > 0 && (
          <div className="conv-pinned-section">
            <button
              type="button"
              className="conv-section-header"
              title={pinnedCollapsed ? t('common.expand') : t('common.collapse')}
              aria-expanded={!pinnedCollapsed}
              onClick={() => setPinnedCollapsed((value) => !value)}
            >
              {pinnedCollapsed ? (
                <ChevronRight className="conv-group-chevron" size={11} aria-hidden />
              ) : (
                <ChevronDown className="conv-group-chevron" size={11} aria-hidden />
              )}
              <span className="conv-section-title">{t('sidebar.section.pinned')}</span>
              <span className="conv-section-count">{pinnedCount}</span>
            </button>
            {!pinnedCollapsed && pinnedGroups.map(renderGroup)}
          </div>
        )}

        {!fileSessionsView && mainGroups.map(renderGroup)}
      </div>

      <UpdateCorner variant="inline" />

      {listMode === 'main' && (
        <div className="sidebar-foot">
          <button
            type="button"
            className="btn ghost sm sidebar-foot-connect"
            data-testid="sidebar-connect"
            data-machine-id={windowMachineId}
            title={connectButtonTitle}
            onClick={(event) => {
              if (localWindow) {
                void window.vav.window.openConnect()
                return
              }
              openRemoteHostMenu(event.currentTarget)
            }}
          >
            <Cable size={13} />
            <span>{connectButtonLabel}</span>
            {!localWindow && (
              <ChevronDown className="sidebar-foot-connect-chevron" size={11} aria-hidden />
            )}
          </button>
          <button
            type="button"
            className="btn icon-only sm sidebar-foot-more"
            data-testid="sidebar-more"
            title={t('sidebar.moreActions')}
            aria-label={t('sidebar.moreActions')}
            onClick={(event) => {
              event.preventDefault()
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
              void showMenu(
                [
                  {
                    label: t('sidebar.showFileSessions'),
                    icon: { kind: 'lucide', key: 'file-sessions' },
                    onSelect: () => {
                      setSidebarQuery('')
                      void selectWorkspaceGroup(null)
                      setListMode('fileSessions')
                    }
                  },
                  {
                    label:
                      archivedCount > 0
                        ? t('sidebar.archivedCount', { count: archivedCount })
                        : t('sidebar.archived'),
                    icon: { kind: 'lucide', key: 'archive' },
                    onSelect: () => {
                      setSidebarQuery('')
                      setListMode('archive')
                    }
                  },
                  { label: '', divider: true },
                  {
                    label: t('sidebar.menu.import'),
                    icon: { kind: 'lucide', key: 'import' },
                    onSelect: () => void importSessions()
                  },
                  {
                    label: t('common.settingsEllipsis'),
                    icon: { kind: 'lucide', key: 'settings' },
                    onSelect: () => useSessionStore.getState().openSettings()
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
