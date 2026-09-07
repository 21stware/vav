import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock, MessageSquare, Trash2, X } from 'lucide-react'
import type { FileSessionMeta } from '@shared/ipc'
import { formatTokens, relativeTime } from '../lib/format'
import { useT } from '../i18n/useT'
import { menuAnchor, showMenu } from '../lib/nativeMenu'
import { Button } from './ui'

const LEAVE_MS = 180 // --dur-pop

export function SessionHistoryPopover({
  open,
  onClose,
  sessions,
  activeSessionId,
  onSwitch,
  onRename,
  onDelete,
  anchorRef
}: {
  open: boolean
  onClose: () => void
  sessions: FileSessionMeta[]
  activeSessionId: string | null
  onSwitch: (sessionId: string) => void
  onRename: (sessionId: string, title: string) => Promise<void>
  onDelete: (sessionIds: string[]) => void
  anchorRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    setSelectMode(false)
    setPicked(new Set())
    setEditingId(null)
    setLeaving(true)
    const id = window.setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [open, mounted])

  useEffect(() => {
    if (!open || leaving) return
    const onDoc = (event: MouseEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (selectMode) {
          setSelectMode(false)
          setPicked(new Set())
          return
        }
        if (editingId) {
          setEditingId(null)
          return
        }
        onClose()
        return
      }
      if (selectMode && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        const next = new Set(
          sessions.filter((s) => s.id !== activeSessionId).map((s) => s.id)
        )
        setPicked(next)
      }
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, leaving, onClose, anchorRef, selectMode, editingId, sessions, activeSessionId])

  const canSelect = sessions.length > 1
  const deletableCount = useMemo(
    () => sessions.filter((s) => s.id !== activeSessionId).length,
    [sessions, activeSessionId]
  )

  if (!mounted) return null

  const commitRename = async (sessionId: string): Promise<void> => {
    const next = editValue.trim().slice(0, 100)
    setEditingId(null)
    if (!next) return
    await onRename(sessionId, next)
  }

  const subtitle = (s: FileSessionMeta): string => {
    const parts = [
      relativeTime(s.updatedAt),
      t('preview.sessionMessages', { n: s.messageCount ?? 0 })
    ]
    if ((s.tokensUsed ?? 0) > 0) {
      parts.push(t('preview.sessionTokens', { n: formatTokens(s.tokensUsed) }))
    }
    return parts.join(' · ')
  }

  return (
    <div
      className="session-history-popover"
      ref={panelRef}
      role="dialog"
      aria-label={t('preview.sessionHistory')}
      data-leaving={leaving || undefined}
    >
      <div className="session-history-head">
        {selectMode ? (
          <>
            <span className="muted tiny">
              {t('preview.sessionSelectedCount', { n: picked.size })}
            </span>
            <Button
              label={t('preview.sessionDone')}
              size="sm"
              variant="primary"
              onClick={() => {
                setSelectMode(false)
                setPicked(new Set())
              }}
            />
          </>
        ) : (
          <>
            <span className="muted tiny">
              {sessions.length === 0
                ? t('preview.sessionHistoryEmptyTitle')
                : t('preview.sessionCount', { n: sessions.length })}
            </span>
            {sessions.length > 0 && (
              <Button
                label={t('preview.sessionSelectMode')}
                size="sm"
                variant="ghost"
                disabled={!canSelect || deletableCount === 0}
                title={
                  sessions.length <= 1
                    ? t('preview.sessionCannotDeleteLast')
                    : undefined
                }
                onClick={() => {
                  setSelectMode(true)
                  setPicked(new Set())
                }}
              />
            )}
          </>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="session-history-empty">
          <Clock size={22} className="muted" />
          <div className="session-history-empty-title">{t('preview.sessionHistoryEmptyTitle')}</div>
          <div className="muted tiny">{t('preview.sessionHistoryEmptyDesc')}</div>
        </div>
      ) : (
        <ul className="session-history-list">
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId
            const isPicked = picked.has(s.id)
            const trashDisabled = isActive || sessions.length <= 1
            return (
              <li
                key={s.id}
                className={`session-history-row${isActive ? ' is-active' : ''}${isPicked ? ' is-picked' : ''}${selectMode && isActive ? ' is-disabled' : ''}`}
                onClick={() => {
                  if (selectMode) {
                    if (isActive) return
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(s.id)) next.delete(s.id)
                      else next.add(s.id)
                      return next
                    })
                    return
                  }
                  if (editingId === s.id) return
                  onSwitch(s.id)
                }}
                onDoubleClick={(event) => {
                  if (selectMode) return
                  event.preventDefault()
                  setEditingId(s.id)
                  setEditValue(s.title || t('common.session'))
                }}
                onContextMenu={(event) => {
                  if (selectMode) return
                  event.preventDefault()
                  const items: {
                    label: string
                    disabled?: boolean
                    onSelect?: () => void
                  }[] = [
                    {
                      label: t('preview.sessionRename'),
                      onSelect: () => {
                        setEditingId(s.id)
                        setEditValue(s.title || t('common.session'))
                      }
                    },
                    {
                      label: t('preview.sessionCopyTitle'),
                      onSelect: () => {
                        void navigator.clipboard.writeText(s.title || '')
                      }
                    },
                    {
                      label: t('common.delete'),
                      disabled: trashDisabled,
                      onSelect: () => {
                        if (!trashDisabled) onDelete([s.id])
                      }
                    }
                  ]
                  void showMenu(items, menuAnchor(event.currentTarget as HTMLElement))
                }}
              >
                {selectMode && (
                  <span className={`session-history-check${isPicked ? ' on' : ''}${isActive ? ' disabled' : ''}`}>
                    {isPicked ? <Check size={12} /> : null}
                  </span>
                )}
                <MessageSquare size={14} className="session-history-icon" aria-hidden />
                <div className="session-history-body">
                  {editingId === s.id ? (
                    <input
                      className="text-field session-history-rename"
                      value={editValue}
                      autoFocus
                      maxLength={100}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitRename(s.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditingId(null)
                        }
                      }}
                      onBlur={() => void commitRename(s.id)}
                    />
                  ) : (
                    <div className="session-history-title" title={s.title}>
                      {s.title || t('common.session')}
                    </div>
                  )}
                  <div className="session-history-sub muted tiny">{subtitle(s)}</div>
                </div>
                {!selectMode && (
                  <button
                    type="button"
                    className="session-history-trash"
                    disabled={trashDisabled}
                    title={
                      isActive
                        ? t('preview.sessionCannotDeleteActive')
                        : sessions.length <= 1
                          ? t('preview.sessionCannotDeleteLast')
                          : t('common.delete')
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!trashDisabled) onDelete([s.id])
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {selectMode && (
        <div className="session-history-bulk">
          <span className="muted tiny">
            {t('preview.sessionSelectedCount', { n: picked.size })}
          </span>
          <span className="spacer" />
          <Button
            label={t('common.delete')}
            size="sm"
            variant="danger"
            disabled={picked.size === 0}
            icon={<Trash2 size={12} />}
            onClick={() => {
              if (picked.size === 0) return
              onDelete([...picked])
              setSelectMode(false)
              setPicked(new Set())
            }}
          />
          <Button
            icon={<X size={12} />}
            size="sm"
            variant="ghost"
            title={t('common.cancel')}
            onClick={() => {
              setSelectMode(false)
              setPicked(new Set())
            }}
          />
        </div>
      )}
    </div>
  )
}
