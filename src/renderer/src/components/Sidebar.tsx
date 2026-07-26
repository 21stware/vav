import { useEffect, useMemo, useRef, useState } from 'react'
import { HelpCircle, Loader2, MessageSquare, Pin, Search, X } from 'lucide-react'
import { PRESET_MODELS, type ConversationMeta } from '@shared/types'
import { useSessionStore, type TurnRuntime } from '../state/sessionStore'
import { isTemporaryWorkspace, middleTruncate, relativeTime, workdirShortLabel } from '../lib/format'
import { flatten, groupConversations } from '../lib/grouping'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { FILE_MANAGER } from '../lib/platform'
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
  tmp: string
): string {
  if (turn?.awaitingToolCallId) return '等待回答'
  if (turn?.isRunning && isActive) return `流式中 · ${modelLabel(conversation.model)}`
  if (turn?.isRunning) return `后台运行 · ${turn.toolCount} 工具已执行`
  if (!isTemporaryWorkspace(conversation.workingDirectory, tmp)) {
    return workdirShortLabel(conversation.workingDirectory, tmp)
  }
  const age = Date.now() - conversation.updatedAt
  if (age > 7 * 24 * 60 * 60 * 1000) return `${relativeTime(conversation.updatedAt)} · ${modelLabel(conversation.model)}`
  return relativeTime(conversation.updatedAt)
}

export function Sidebar(): React.JSX.Element {
  const conversations = useSessionStore((s) => s.conversations)
  const activeId = useSessionStore((s) => s.activeId)
  const selectedIds = useSessionStore((s) => s.selectedIds)
  const query = useSessionStore((s) => s.sidebarQuery)
  const turns = useSessionStore((s) => s.turns)
  const tmp = useSessionStore((s) => s.tmp)
  const renamingId = useSessionStore((s) => s.renamingId)

  const setSidebarQuery = useSessionStore((s) => s.setSidebarQuery)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const createConversation = useSessionStore((s) => s.createConversation)
  const requestDelete = useSessionStore((s) => s.requestDelete)
  const beginRename = useSessionStore((s) => s.beginRename)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const setPinned = useSessionStore((s) => s.setPinned)
  const openDetached = useSessionStore((s) => s.openDetached)

  const listRef = useRef<HTMLDivElement>(null)

  const searching = query.trim().length > 0

  // A conversation open in its own window keeps its row here, selection and
  // all — detaching shows it somewhere else, it does not move it.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = conversations.filter((c) => !needle || c.title.toLowerCase().includes(needle))
    return groupConversations(rows, searching)
  }, [conversations, query, searching])

  const visible = useMemo(() => flatten(groups), [groups])

  // Sidebar-scoped keys. Ignored while focus sits in a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
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
      } else if (event.key === 'a' && event.metaKey) {
        event.preventDefault()
        useSessionStore.setState({ selectedIds: visible.map((c) => c.id) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, activeId, selectedIds, selectConversation, requestDelete])

  const menuItems = (id: string): MenuItem[] => {
    const conversation = conversations.find((c) => c.id === id)
    const hasRealWorkdir = !isTemporaryWorkspace(conversation?.workingDirectory ?? null, tmp)
    return [
      { label: '在单独窗口中打开', onSelect: () => void openDetached(id) },
      {
        label: conversation?.pinned ? '取消置顶' : '置顶',
        onSelect: () => void setPinned(id, !conversation?.pinned)
      },
      { label: '重命名', onSelect: () => beginRename(id) },
      {
        label: '复制标题',
        onSelect: () => void window.vav.conversations.copyToClipboard(conversation?.title ?? '')
      },
      {
        label: `在 ${FILE_MANAGER} 中显示工作目录`,
        disabled: !hasRealWorkdir,
        onSelect: () => {
          if (conversation?.workingDirectory) {
            void window.vav.conversations.revealInFinder(conversation.workingDirectory)
          }
        }
      },
      { label: '', divider: true },
      { label: '删除', destructive: true, onSelect: () => requestDelete([id]) }
    ]
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
            placeholder="搜索会话…"
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
      </div>

      <div className="sidebar-list" ref={listRef} tabIndex={-1}>
        {visible.length === 0 && conversations.length === 0 && (
          <EmptyState title="暂无会话记录" description="开始一个新会话吧">
            <button className="btn secondary" onClick={() => void createConversation()}>
              新会话
            </button>
          </EmptyState>
        )}
        {visible.length === 0 && conversations.length > 0 && (
          <EmptyState title="未找到匹配的会话" description="试试其他关键词">
            <button className="btn secondary" onClick={() => setSidebarQuery('')}>
              清除过滤
            </button>
          </EmptyState>
        )}

        {groups.map((group, groupIndex) => (
          <div className="conv-group" key={group.label || `pinned-${groupIndex}`}>
            {groupIndex > 0 && <div className="conv-group-divider" />}
            {group.label && <div className="conv-group-header">{group.label}</div>}

            {group.conversations.map((conversation) => {
              const turn = turns[conversation.id]
              const isActive = conversation.id === activeId
              const isMultiSelected =
                selectedIds.length > 1 && selectedIds.includes(conversation.id)
              const awaiting = !!turn?.awaitingToolCallId
              const running = !!turn?.isRunning && !awaiting

              return (
                <div
                  key={conversation.id}
                  className={`conv-row${isActive ? ' selected' : ''}${isMultiSelected && !isActive ? ' multi' : ''}`}
                  onClick={(event) =>
                    void selectConversation(conversation.id, {
                      additive: event.metaKey,
                      range: event.shiftKey
                    })
                  }
                  onDoubleClick={() => void openDetached(conversation.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    void showMenu(menuItems(conversation.id))
                  }}
                >
                  {/* Pin wins over the activity icons: being pinned is why the
                      row is up here, and that is what needs explaining. */}
                  <span className="conv-icon">
                    {conversation.pinned ? (
                      <Pin size={13} />
                    ) : awaiting ? (
                      <HelpCircle size={14} />
                    ) : running ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <MessageSquare size={14} />
                    )}
                  </span>

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
                        {subtitleFor(conversation, turn, isActive, tmp)}
                      </span>
                    </span>
                  )}

                  {awaiting && <span className="conv-badge awaiting" title="等待回答" />}
                  {running && !isActive && <span className="conv-badge running" title="后台运行" />}
                </div>
              )
            })}
          </div>
        ))}
      </div>
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
