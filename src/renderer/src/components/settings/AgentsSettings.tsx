import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Minus, Plus } from 'lucide-react'
import {
  CLI_AGENT_CATALOGUE,
  DEFAULT_CLI_AGENTS,
  type AgentConfig
} from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { AgentBrandMark } from '../AgentBrandMark'

function cloneAgents(list: AgentConfig[]): AgentConfig[] {
  return list.map((a) => ({
    ...a,
    envVars: { ...a.envVars },
    defaultArgs: [...a.defaultArgs],
    binaryCandidates: a.binaryCandidates ? [...a.binaryCandidates] : undefined
  }))
}

function agentsFromSettings(cliAgents: AgentConfig[] | null | undefined): AgentConfig[] {
  if (Array.isArray(cliAgents) && cliAgents.length > 0) return cloneAgents(cliAgents)
  return DEFAULT_CLI_AGENTS.map((a) => ({
    ...a,
    envVars: { ...a.envVars },
    defaultArgs: [...a.defaultArgs],
    binaryCandidates: a.binaryCandidates ? [...a.binaryCandidates] : undefined
  }))
}

/**
 * CLI Agents settings — macOS-style list with +/− footer and drag reorder.
 *
 * Local list is optimistic so reorder/remove paint immediately; settings IPC
 * persists in the background (no restart required).
 */
export function AgentsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)

  // Optimistic local list — do not wait for IPC round-trip to re-render.
  const [agents, setAgents] = useState<AgentConfig[]>(() =>
    agentsFromSettings(settings.cliAgents)
  )
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  // Sync when another window (or bridge) pushes settings.cliAgents.
  const remoteKey = useMemo(
    () =>
      (settings.cliAgents ?? [])
        .map((a) => a.id)
        .join('\0'),
    [settings.cliAgents]
  )
  const remoteOrderKey = useMemo(
    () =>
      (settings.cliAgents ?? [])
        .map((a) => `${a.id}:${a.enabled !== false ? 1 : 0}:${a.name}:${a.binaryPath}`)
        .join('|'),
    [settings.cliAgents]
  )
  useEffect(() => {
    const remote = agentsFromSettings(settings.cliAgents)
    const localIds = agentsRef.current.map((a) => a.id).join('\0')
    const remoteIds = remote.map((a) => a.id).join('\0')
    // Accept remote when ids order changed, or metadata changed without id churn.
    if (
      localIds !== remoteIds ||
      agentsRef.current.length !== remote.length ||
      remoteOrderKey !==
        agentsRef.current
          .map((a) => `${a.id}:${a.enabled !== false ? 1 : 0}:${a.name}:${a.binaryPath}`)
          .join('|')
    ) {
      setAgents(remote)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remoteKey/orderKey track settings.cliAgents
  }, [remoteKey, remoteOrderKey])

  const [selectedId, setSelectedId] = useState<string | null>(
    () => agents[0]?.id ?? null
  )
  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? agents[0] ?? null,
    [agents, selectedId]
  )

  // Keep selection valid after remove/reorder.
  useEffect(() => {
    if (!selectedId || !agents.some((a) => a.id === selectedId)) {
      setSelectedId(agents[0]?.id ?? null)
    }
  }, [agents, selectedId])

  /** Menu open + leave path (matches toast / history popover). */
  const ADD_MENU_LEAVE_MS = 180 // --dur-pop
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuLeaving, setAddMenuLeaving] = useState(false)
  const addMenuLeaveTimer = useRef<number | null>(null)
  const addWrapRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)

  const closeAddMenu = (): void => {
    if (!addMenuOpen || addMenuLeaving) return
    setAddMenuLeaving(true)
    if (addMenuLeaveTimer.current != null) window.clearTimeout(addMenuLeaveTimer.current)
    addMenuLeaveTimer.current = window.setTimeout(() => {
      addMenuLeaveTimer.current = null
      setAddMenuOpen(false)
      setAddMenuLeaving(false)
    }, ADD_MENU_LEAVE_MS)
  }

  const openAddMenu = (): void => {
    if (addMenuLeaveTimer.current != null) {
      window.clearTimeout(addMenuLeaveTimer.current)
      addMenuLeaveTimer.current = null
    }
    setAddMenuLeaving(false)
    setAddMenuOpen(true)
  }

  useEffect(() => {
    return () => {
      if (addMenuLeaveTimer.current != null) window.clearTimeout(addMenuLeaveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!addMenuOpen || addMenuLeaving) return
    const onDoc = (event: MouseEvent): void => {
      if (!addWrapRef.current?.contains(event.target as Node)) {
        closeAddMenu()
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeAddMenu()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeAddMenu is stable enough for listeners
  }, [addMenuOpen, addMenuLeaving])

  const commitAgents = (next: AgentConfig[]): void => {
    const cloned = cloneAgents(next)
    setAgents(cloned)
    agentsRef.current = cloned
    void updateSettings({
      cliAgents: cloned,
      defaultAgentId:
        settings.defaultAgentId && cloned.some((a) => a.id === settings.defaultAgentId)
          ? settings.defaultAgentId
          : (cloned.find((a) => a.enabled !== false)?.id ?? cloned[0]?.id ?? null)
    }).catch((err) => {
      console.error('[agents] failed to persist cliAgents', err)
    })
  }

  const patchAgent = (id: string, patch: Partial<AgentConfig>): void => {
    commitAgents(agents.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const presentIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents])

  const addableCatalogue = useMemo(
    () => CLI_AGENT_CATALOGUE.filter((a) => !presentIds.has(a.id)),
    [presentIds]
  )

  const addFromCatalogue = (template: AgentConfig): void => {
    if (presentIds.has(template.id)) return
    const agent: AgentConfig = {
      ...template,
      envVars: { ...template.envVars },
      defaultArgs: [...template.defaultArgs],
      binaryCandidates: template.binaryCandidates
        ? [...template.binaryCandidates]
        : undefined,
      enabled: true,
      builtin: true
    }
    commitAgents([...agents, agent])
    setSelectedId(agent.id)
    closeAddMenu()
  }

  const addCustom = (): void => {
    const id = `custom-${Date.now().toString(36)}`
    const agent: AgentConfig = {
      id,
      name: t('agents.customName'),
      binaryPath: '',
      defaultArgs: [],
      envVars: {},
      enabled: true,
      providerName: null,
      builtin: false
    }
    commitAgents([...agents, agent])
    setSelectedId(id)
    closeAddMenu()
  }

  const canRemove = agents.length > 1 && !!selected

  const removeSelected = (): void => {
    if (!selected || agents.length <= 1) return
    const next = agents.filter((a) => a.id !== selected.id)
    const nextSelected =
      next.find((a) => a.id === selectedId)?.id ?? next[0]?.id ?? null
    commitAgents(next)
    setSelectedId(nextSelected)
  }

  const reorder = (fromId: string, toId: string): void => {
    if (!fromId || !toId || fromId === toId) return
    const from = agents.findIndex((a) => a.id === fromId)
    const to = agents.findIndex((a) => a.id === toId)
    if (from < 0 || to < 0) return
    const next = [...agents]
    const [row] = next.splice(from, 1)
    if (!row) return
    next.splice(to, 0, row)
    commitAgents(next)
  }

  return (
    <div className="settings-section agents-settings">
      <div className="agents-layout">
        <div className="agents-list-panel">
          <div
            className="agents-list"
            role="listbox"
            aria-label={t('settings.nav.agents')}
            onDragOver={(e) => {
              // Allow drops anywhere in the list (not only on row buttons).
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
          >
            {agents.map((agent) => {
              const isSelected = agent.id === selected?.id
              const isDragging = dragId === agent.id
              const isOver = dragOverId === agent.id && dragId !== agent.id
              return (
                <div
                  key={agent.id}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    'agents-list-row',
                    isSelected ? 'selected' : '',
                    agent.enabled ? '' : 'disabled',
                    isOver ? 'is-drag-over' : '',
                    isDragging ? 'is-dragging' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  onClick={() => setSelectedId(agent.id)}
                  onDragStart={(e) => {
                    dragIdRef.current = agent.id
                    setDragId(agent.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', agent.id)
                    e.dataTransfer.setData('application/x-vav-agent-id', agent.id)
                    try {
                      e.dataTransfer.setDragImage(e.currentTarget, 12, 12)
                    } catch {
                      // ignore
                    }
                  }}
                  onDragEnd={() => {
                    dragIdRef.current = null
                    setDragId(null)
                    setDragOverId(null)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOverId !== agent.id) setDragOverId(agent.id)
                  }}
                  onDragLeave={(e) => {
                    // Only clear when leaving the row (not entering a child).
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverId === agent.id) setDragOverId(null)
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const from =
                      dragIdRef.current ||
                      dragId ||
                      e.dataTransfer.getData('text/plain') ||
                      e.dataTransfer.getData('application/x-vav-agent-id')
                    setDragOverId(null)
                    setDragId(null)
                    dragIdRef.current = null
                    if (from) reorder(from, agent.id)
                  }}
                >
                  <span
                    className="agents-list-grip"
                    title={t('agents.reorderHint')}
                    aria-label={t('agents.reorderHint')}
                  >
                    <GripVertical size={12} strokeWidth={2} />
                  </span>
                  <AgentBrandMark agent={agent} size={18} />
                  <span className="agents-list-name">{agent.name}</span>
                </div>
              )
            })}
          </div>

          <div className="agents-list-toolbar">
            <div className="agents-list-add-wrap" ref={addWrapRef}>
              <button
                type="button"
                className="agents-list-tool-btn"
                title={t('agents.add')}
                aria-label={t('agents.add')}
                aria-haspopup="menu"
                aria-expanded={addMenuOpen && !addMenuLeaving}
                onClick={() => {
                  if (addMenuOpen && !addMenuLeaving) closeAddMenu()
                  else openAddMenu()
                }}
              >
                <Plus size={14} strokeWidth={2.25} />
              </button>
              {addMenuOpen ? (
                <div
                  className="agents-add-menu"
                  role="menu"
                  data-leaving={addMenuLeaving || undefined}
                >
                  {addableCatalogue.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      role="menuitem"
                      className="agents-add-menu-item"
                      onClick={() => addFromCatalogue(agent)}
                    >
                      <AgentBrandMark agent={agent} size={16} />
                      <span>{agent.name}</span>
                    </button>
                  ))}
                  {addableCatalogue.length > 0 ? (
                    <div className="agents-add-menu-sep" role="separator" />
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="agents-add-menu-item"
                    onClick={addCustom}
                  >
                    <span className="agents-add-menu-custom-icon" aria-hidden>
                      …
                    </span>
                    <span>{t('agents.customName')}</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="agents-list-tool-btn"
              title={
                canRemove ? t('common.delete') : t('agents.removeLastDisabled')
              }
              aria-label={t('common.delete')}
              disabled={!canRemove}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                removeSelected()
              }}
            >
              <Minus size={14} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {selected ? (
          <div className="agents-editor">
            <label className="settings-field">
              <span>{t('agents.field.name')}</span>
              <input
                className="text-field"
                value={selected.name}
                disabled={!!selected.builtin}
                onChange={(e) => patchAgent(selected.id, { name: e.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>{t('agents.field.binary')}</span>
              <input
                className="text-field"
                value={selected.binaryPath}
                placeholder="claude"
                onChange={(e) => patchAgent(selected.id, { binaryPath: e.target.value.trim() })}
              />
              <span className="muted tiny" style={{ marginTop: 4 }}>
                {t('agents.field.binaryHint')}
              </span>
            </label>
            <label className="settings-field">
              <span>{t('agents.field.args')}</span>
              <input
                className="text-field"
                value={selected.defaultArgs.join(' ')}
                placeholder="--flag value"
                onChange={(e) =>
                  patchAgent(selected.id, {
                    defaultArgs: e.target.value
                      .split(/\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </label>
            <label className="settings-field row">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => patchAgent(selected.id, { enabled: e.target.checked })}
              />
              <span>{t('agents.field.enabled')}</span>
            </label>
          </div>
        ) : (
          <div className="muted">{t('agents.empty')}</div>
        )}
      </div>

      <label className="settings-field row agents-skip-picker">
        <input
          type="checkbox"
          checked={settings.skipCliAgentPickerWhenSingle === true}
          onChange={(e) =>
            void updateSettings({ skipCliAgentPickerWhenSingle: e.target.checked })
          }
        />
        <span>{t('agents.skipPickerWhenSingle')}</span>
      </label>
    </div>
  )
}
