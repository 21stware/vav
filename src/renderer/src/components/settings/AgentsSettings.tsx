import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ExternalLink,
  GripVertical,
  ListFilter,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Square,
  X
} from 'lucide-react'
import {
  CLI_AGENT_CATALOGUE,
  DEFAULT_CLI_AGENTS,
  isStructuredCliHost,
  type AgentConfig,
  type CliHostKind,
  type ModelModality
} from '@shared/types'
import { apiProviderBrand } from '@shared/accounts'
import type { AccountGroupView } from '@shared/ipc'
import type { MessageKey } from '@shared/i18n'
import { agentWebsiteUrl } from '@shared/agentBinary'
import {
  isAgentModelEnabled,
  isOfficialDeepSeekEndpoint,
  modelsForChatHost,
  nativeDeepSeekModels
} from '@shared/agentModels'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { AgentBrandMark } from '../AgentBrandMark'
import { Toggle } from '../ui'
import { AgentProfileSwitch } from './VavApiCredentials'
import { useWorkspaceStore } from '../../state/workspaceStore'
import {
  getAgentInstallStatus,
  openAgentWebsite,
  refreshAgentInstallStatus,
  useAgentInstallMap
} from '../../lib/agentInstallStatus'
import { useInstallRunStore } from '../../state/installRunStore'

const VAV_ROW_ID = 'vav'

const MODALITY_LABEL: Record<ModelModality, MessageKey> = {
  text: 'model.modality.text',
  image: 'model.modality.image',
  audio: 'model.modality.audio'
}

function ModelModalityLine({
  input,
  output,
  t
}: {
  input?: ModelModality[]
  output?: ModelModality[]
  t: (key: MessageKey) => string
}): React.JSX.Element | null {
  if (!input?.length && !output?.length) return null
  return (
    <span className="agents-models-caps">
      {input?.length ? (
        <span className="agents-models-caps-io">
          <span className="agents-models-caps-dir">{t('model.modality.input')}</span>
          {input.map((m) => (
            <span key={`in-${m}`}>{t(MODALITY_LABEL[m])}</span>
          ))}
        </span>
      ) : null}
      {output?.length ? (
        <span className="agents-models-caps-io">
          <span className="agents-models-caps-dir">{t('model.modality.output')}</span>
          {output.map((m) => (
            <span key={`out-${m}`}>{t(MODALITY_LABEL[m])}</span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function cloneAgents(list: AgentConfig[]): AgentConfig[] {
  return list.map((a) => ({
    ...a,
    envVars: { ...a.envVars },
    defaultArgs: [...a.defaultArgs],
    binaryCandidates: a.binaryCandidates ? [...a.binaryCandidates] : undefined
  }))
}

function agentsFromSettings(
  cliAgents: AgentConfig[] | null | undefined,
  removedIds?: string[] | null
): AgentConfig[] {
  if (Array.isArray(cliAgents) && cliAgents.length > 0) return cloneAgents(cliAgents)
  const removed = new Set(removedIds ?? [])
  const seed = DEFAULT_CLI_AGENTS.filter((a) => !removed.has(a.id))
  const source = seed.length > 0 ? seed : DEFAULT_CLI_AGENTS
  return source.map((a) => ({
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
  const catalog = useSessionStore((s) => s.agentModelCatalog)
  const refreshCatalog = useSessionStore((s) => s.refreshAgentModelCatalog)
  const installById = useAgentInstallMap()
  const installRuns = useInstallRunStore((s) => s.runs)
  const [detecting, setDetecting] = useState(false)
  const [startFailed, setStartFailed] = useState<string | null>(null)

  // Optimistic local list — do not wait for IPC round-trip to re-render.
  const [agents, setAgents] = useState<AgentConfig[]>(() =>
    agentsFromSettings(settings.cliAgents, settings.removedCliAgentIds)
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
    const remote = agentsFromSettings(settings.cliAgents, settings.removedCliAgentIds)
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

  const focusAgentId = useSessionStore((s) => s.settingsFocusAgentId)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => focusAgentId || VAV_ROW_ID
  )
  const [accountGroups, setAccountGroups] = useState<AccountGroupView[]>([])
  const [modelFilterOpen, setModelFilterOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [modelsRefreshing, setModelsRefreshing] = useState(false)
  const [modelsRefreshAck, setModelsRefreshAck] = useState(false)

  useEffect(() => {
    if (!focusAgentId) return
    setSelectedId(focusAgentId)
    useSessionStore.setState({ settingsFocusAgentId: null })
  }, [focusAgentId])
  const modelsRefreshTimers = useRef<number[]>([])
  const modelFilterRef = useRef<HTMLInputElement>(null)
  const selectedIsVav = selectedId === VAV_ROW_ID
  const selected = useMemo(
    () => (selectedIsVav ? null : agents.find((a) => a.id === selectedId) ?? null),
    [agents, selectedId, selectedIsVav]
  )

  // Keep selection valid after external sync / reorder. Removal picks the next
  // row itself — do not yank focus to VAV here.
  useEffect(() => {
    if (selectedId === VAV_ROW_ID) return
    if (!selectedId || !agents.some((a) => a.id === selectedId)) {
      setSelectedId(agents[agents.length - 1]?.id ?? VAV_ROW_ID)
    }
  }, [agents, selectedId])

  // Fresh query per visit (this page unmounts when leaving Settings → Agents)
  // and whenever the user picks another provider in the list.
  useEffect(() => {
    setModelFilter('')
    setModelFilterOpen(false)
    setStartFailed(null)
  }, [selectedId])

  useEffect(() => {
    if (!modelFilterOpen) return
    modelFilterRef.current?.focus()
  }, [modelFilterOpen])

  useEffect(() => {
    void refreshCatalog(false)
  }, [refreshCatalog])

  useEffect(() => {
    let cancelled = false
    const load = window.vav.accounts?.getPage
    if (typeof load !== 'function') return
    void load()
      .then((page) => {
        if (!cancelled) setAccountGroups(page.groups ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [settings.apiKeyPresent])

  useEffect(() => {
    return () => {
      for (const id of modelsRefreshTimers.current) window.clearTimeout(id)
    }
  }, [])

  const refreshModels = (): void => {
    if (modelsRefreshing) return
    setModelsRefreshing(true)
    setModelsRefreshAck(false)
    for (const id of modelsRefreshTimers.current) window.clearTimeout(id)
    modelsRefreshTimers.current = []
    const started = Date.now()
    void refreshCatalog(true)
      .catch(() => undefined)
      .finally(() => {
        const wait = Math.max(0, 280 - (Date.now() - started))
        const hold = window.setTimeout(() => {
          setModelsRefreshing(false)
          setModelsRefreshAck(true)
          const ack = window.setTimeout(() => {
            setModelsRefreshAck(false)
          }, 1100)
          modelsRefreshTimers.current.push(ack)
        }, wait)
        modelsRefreshTimers.current.push(hold)
      })
  }

  useEffect(() => {
    void refreshAgentInstallStatus({ force: true, discover: false })
  }, [])

  const recheckInstalled = (): void => {
    setDetecting(true)
    void refreshAgentInstallStatus({ force: true, discover: true }).finally(() => {
      setDetecting(false)
    })
  }

  const installCommandFor = (agent: AgentConfig): string =>
    agent.installCommand?.trim() ||
    CLI_AGENT_CATALOGUE.find((row) => row.id === agent.id)?.installCommand?.trim() ||
    ''

  const installSelected = async (): Promise<void> => {
    if (!selected) return
    const command = installCommandFor(selected)
    if (!command) return
    setStartFailed(null)
    const start = window.vav.agents.installStart
    if (typeof start !== 'function') {
      setStartFailed(t('agents.installStartFailed'))
      return
    }
    try {
      const result = await start({ agentId: selected.id, name: selected.name, command })
      if (!result?.ok) setStartFailed(t('agents.installStartFailed'))
    } catch {
      setStartFailed(t('agents.installStartFailed'))
    }
  }

  // A finished install lands a new binary on PATH — re-probe once, then drop
  // the row so the provider goes back to its normal editor.
  const settledRuns = Object.values(installRuns)
    .filter((run) => run.status !== 'running')
    .map((run) => `${run.agentId}:${run.status}:${run.endedAt ?? 0}`)
    .join('|')
  useEffect(() => {
    if (!settledRuns) return
    let cancelled = false
    void refreshAgentInstallStatus({ force: true, discover: true })
    const timer = window.setTimeout(() => {
      if (cancelled) return
      for (const run of Object.values(useInstallRunStore.getState().runs)) {
        // Keep a "done but still not on PATH" row around — it is the only hint
        // the user gets that the binary landed somewhere unexpected.
        if (run.status !== 'success') continue
        if (getAgentInstallStatus(run.agentId) !== 'ready') continue
        void window.vav.agents.installClear?.(run.agentId)
      }
    }, 2600)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [settledRuns])

  /** Menu open + leave path (matches toast / history popover). */
  const ADD_MENU_LEAVE_MS = 180 // --dur-pop
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuLeaving, setAddMenuLeaving] = useState(false)
  const addMenuLeaveTimer = useRef<number | null>(null)
  const addWrapRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverEdge, setDragOverEdge] = useState<'before' | 'after'>('before')
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

  const commitAgents = (
    next: AgentConfig[],
    extra?: { removedCliAgentIds?: string[] }
  ): void => {
    const cloned = cloneAgents(next)
    setAgents(cloned)
    agentsRef.current = cloned
    const currentDefault = settings.defaultAgentId
    // Keep VAV (null) or a still-present CLI id; never force a CLI default.
    const nextDefault =
      !currentDefault || currentDefault === 'vav'
        ? null
        : cloned.some((a) => a.id === currentDefault)
          ? currentDefault
          : null
    void updateSettings({
      cliAgents: cloned,
      defaultAgentId: nextDefault,
      ...extra
    }).catch((err) => {
      console.error('[agents] failed to persist cliAgents', err)
    })
  }

  const selectedRun = selected ? (installRuns[selected.id] ?? null) : null
  const selectedInstalling = selectedRun?.status === 'running'
  const selectedMissing =
    !!selected &&
    (installById[selected.id] ?? getAgentInstallStatus(selected.id)) === 'missing'

  const activeDefaultId =
    !settings.defaultAgentId || settings.defaultAgentId === 'vav'
      ? null
      : settings.defaultAgentId
  const modelHostKey = selectedIsVav
    ? 'vav'
    : selected && isStructuredCliHost(selected.id)
      ? selected.id
      : null
  const modelHost = (modelHostKey === 'vav' ? null : modelHostKey) as CliHostKind | null
  const vavCatalog = catalog.vav
  const selectedAgentId = selectedIsVav ? 'vav' : selected?.id ?? null
  const agentProfiles =
    (selectedAgentId
      ? accountGroups.find((group) => group.agentId === selectedAgentId)?.accounts
      : null) ?? []
  const currentVav = agentProfiles.find((row) => row.agentId === 'vav' && row.current) ??
    accountGroups.find((group) => group.agentId === 'vav')?.accounts.find((row) => row.current) ??
    accountGroups.find((group) => group.agentId === 'vav')?.accounts[0] ??
    null
  const vavBrand = apiProviderBrand(currentVav?.endpoint ?? settings.apiEndpoint)
  const vavEndpointKey = (currentVav?.endpoint ?? settings.apiEndpoint).trim()
  const vavEndpointNorm = vavEndpointKey.replace(/\/+$/, '').toLowerCase()
  const catalogMatchesVav =
    !vavEndpointNorm ||
    (Boolean(vavCatalog?.endpoint) && vavCatalog.endpoint === vavEndpointNorm)
  useEffect(() => {
    if (!vavEndpointKey) return
    void refreshCatalog(true)
  }, [refreshCatalog, vavEndpointKey])
  const vavCanFetch = currentVav
    ? Boolean(currentVav.keyPresent && (currentVav.endpoint?.trim() || settings.apiEndpoint.trim()))
    : settings.apiKeyPresent && !!settings.apiEndpoint.trim()
  const vavLive = vavCatalog?.source === 'live' && catalogMatchesVav
  const vavFetchError = selectedIsVav && catalogMatchesVav ? vavCatalog?.error : undefined
  const vavLoading = selectedIsVav && vavCanFetch && !vavLive && !vavFetchError
  const modelList = useMemo(() => {
    if (!modelHostKey) return []
    const entry = catalog[modelHostKey]
    if (selectedIsVav) {
      if (!catalogMatchesVav) return []
      const models = entry?.models ?? []
      return isOfficialDeepSeekEndpoint(vavEndpointKey)
        ? nativeDeepSeekModels(models)
        : models
    }
    if (entry?.models?.length) return entry.models
    return modelsForChatHost(modelHost, settings.customModels, settings.defaultModel)
  }, [
    catalog,
    catalogMatchesVav,
    modelHost,
    modelHostKey,
    selectedIsVav,
    settings.customModels,
    settings.defaultModel,
    vavEndpointKey
  ])

  const modelFilterQuery = modelFilter.trim().toLowerCase()
  const visibleModels = useMemo(() => {
    if (!modelFilterQuery) return modelList
    return modelList.filter((model) => {
      const label = (model.label ?? '').toLowerCase()
      const id = (model.id ?? '').toLowerCase()
      return label.includes(modelFilterQuery) || id.includes(modelFilterQuery)
    })
  }, [modelList, modelFilterQuery])

  const toggleModelEnabled = (modelId: string, enabled: boolean): void => {
    if (!modelHostKey) return
    const prev = settings.disabledAgentModels ?? {}
    const disabled = new Set(prev[modelHostKey] ?? [])
    if (enabled) disabled.delete(modelId)
    else disabled.add(modelId)
    const next = { ...prev }
    if (disabled.size === 0) delete next[modelHostKey]
    else next[modelHostKey] = [...disabled]
    void updateSettings({ disabledAgentModels: next })
  }

  const modelEnablement = useMemo(() => {
    let enabled = 0
    for (const model of modelList) {
      if (isAgentModelEnabled(modelHost, model.id, settings.disabledAgentModels)) enabled++
    }
    return {
      enabled,
      all: modelList.length > 0 && enabled === modelList.length,
      none: enabled === 0
    }
  }, [modelList, modelHost, settings.disabledAgentModels])

  const setAllModelsEnabled = (enabled: boolean): void => {
    if (!modelHostKey || modelList.length === 0) return
    const prev = settings.disabledAgentModels ?? {}
    const next = { ...prev }
    if (enabled) delete next[modelHostKey]
    else next[modelHostKey] = modelList.map((model) => model.id)
    void updateSettings({ disabledAgentModels: next })
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
    const removedCliAgentIds = (settings.removedCliAgentIds ?? []).filter(
      (id) => id !== template.id
    )
    commitAgents([...agents, agent], { removedCliAgentIds })
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

  const canRemove = agents.length > 1 && !!selected && !selectedIsVav

  const removeSelected = (): void => {
    if (!selected || agents.length <= 1) return
    const removedIndex = agents.findIndex((a) => a.id === selected.id)
    const next = agents.filter((a) => a.id !== selected.id)
    // Keep the same list index; if we removed the last row, step up to the new last.
    const nextSelected =
      next[Math.min(Math.max(removedIndex, 0), next.length - 1)]?.id ?? VAV_ROW_ID
    // Select before list commit so the validity effect never sees a stale id.
    setSelectedId(nextSelected)
    const removedCliAgentIds = [
      ...new Set([...(settings.removedCliAgentIds ?? []), selected.id])
    ]
    commitAgents(next, { removedCliAgentIds })
  }

  const reorder = (fromId: string, toId: string, edge: 'before' | 'after' = 'before'): void => {
    if (!fromId || !toId) return
    const from = agents.findIndex((a) => a.id === fromId)
    let to = agents.findIndex((a) => a.id === toId)
    if (from < 0 || to < 0) return
    if (edge === 'after') to += 1
    if (from < to) to -= 1
    if (from === to) return
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
            <div
              role="option"
              aria-selected={selectedIsVav}
              className={`agents-list-row${selectedIsVav ? ' selected' : ''}`}
              onClick={() => setSelectedId(VAV_ROW_ID)}
            >
              <span className="agents-list-grip agents-list-grip-spacer" aria-hidden />
              <AgentBrandMark agent={{ id: 'vav', name: vavBrand || t('agents.plainShell') }} size={18} />
              <span className="agents-list-name">{vavBrand || t('agents.plainShell')}</span>
              {vavBrand && vavBrand !== t('agents.plainShell') ? (
                <span className="agents-list-badge">{t('agents.plainShell')}</span>
              ) : null}
              {activeDefaultId === null ? (
                <span className="agents-list-badge">{t('agents.setAsDefault')}</span>
              ) : null}
            </div>
            {agents.map((agent) => {
              const isSelected = !selectedIsVav && agent.id === selected?.id
              const isDragging = dragId === agent.id
              const isOver = dragOverId === agent.id && dragId !== agent.id
              const dropEdge = isOver ? dragOverEdge : null
              const missing =
                (installById[agent.id] ?? getAgentInstallStatus(agent.id)) === 'missing'
              return (
                <div
                  key={agent.id}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    'agents-list-row',
                    isSelected ? 'selected' : '',
                    agent.enabled ? '' : 'disabled',
                    missing ? 'is-missing' : '',
                    isOver ? 'is-drag-over' : '',
                    isDragging ? 'is-dragging' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-drop={dropEdge ?? undefined}
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
                    const rect = e.currentTarget.getBoundingClientRect()
                    const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                    if (dragOverId !== agent.id) setDragOverId(agent.id)
                    if (dragOverEdge !== edge) setDragOverEdge(edge)
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
                    const rect = e.currentTarget.getBoundingClientRect()
                    const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                    setDragOverId(null)
                    setDragId(null)
                    dragIdRef.current = null
                    if (from) reorder(from, agent.id, edge)
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
                  {missing ? (
                    <span className="agents-list-badge">{t('agents.notInstalled')}</span>
                  ) : activeDefaultId === agent.id ? (
                    <span className="agents-list-badge">{t('agents.setAsDefault')}</span>
                  ) : null}
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
            <button
              type="button"
              className="agents-list-tool-btn is-text"
              title={
                selected &&
                (installById[selected.id] ?? getAgentInstallStatus(selected.id)) === 'missing'
                  ? t('agents.setAsDefaultNeedInstall')
                  : t('agents.setAsDefaultHint')
              }
              disabled={
                selectedIsVav
                  ? activeDefaultId === null
                  : !selected ||
                    !isStructuredCliHost(selected.id) ||
                    selected.enabled === false ||
                    (installById[selected.id] ?? getAgentInstallStatus(selected.id)) ===
                      'missing' ||
                    selected.id === activeDefaultId
              }
              onClick={() => {
                const next = selectedIsVav ? null : (selected?.id ?? null)
                void updateSettings({ defaultAgentId: next })
              }}
            >
              {t('agents.setAsDefault')}
            </button>
            <button
              type="button"
              className={`agents-list-tool-btn is-trailing${detecting ? ' is-spinning' : ''}`}
              title={
                detecting ? t('agents.installRechecking') : t('agents.detectInstalled')
              }
              aria-label={t('agents.detectInstalled')}
              disabled={detecting}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                recheckInstalled()
              }}
            >
              <RefreshCw size={13} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {selectedIsVav || selected ? (
          <div className="agents-editor">
            {selectedIsVav ? (
              <>
                <div className="agents-editor-hero">
                  <AgentBrandMark agent={{ id: 'vav', name: vavBrand || t('agents.plainShell') }} size={40} />
                  <span className="agents-editor-hero-name">
                    {vavBrand || t('agents.plainShell')}
                  </span>
                </div>
                <p className="muted tiny" style={{ marginTop: -4, marginBottom: 4 }}>
                  {t('agents.vavModelsHint')}
                </p>
                <AgentProfileSwitch
                  agentId="vav"
                  accounts={agentProfiles}
                  onProfileChanged={(next) => {
                    setAccountGroups((groups) =>
                      groups.map((group) =>
                        group.agentId === 'vav' ? { ...group, accounts: next } : group
                      )
                    )
                    void refreshCatalog(true)
                  }}
                />
              </>
            ) : selected ? (
              <>
                <div className="agents-editor-hero">
                  <AgentBrandMark agent={selected} size={40} />
                  <span className="agents-editor-hero-name">{selected.name}</span>
                  {agentWebsiteUrl(selected) ? (
                    <button
                      type="button"
                      className="agents-editor-hero-link"
                      title={t('agents.openWebsiteNamed', { name: selected.name })}
                      aria-label={t('agents.openWebsiteNamed', { name: selected.name })}
                      onClick={() => openAgentWebsite(selected)}
                    >
                      <ExternalLink size={14} strokeWidth={2.1} />
                    </button>
                  ) : null}
                </div>
                <AgentProfileSwitch
                  agentId={selected.id}
                  accounts={agentProfiles}
                  onProfileChanged={(next) => {
                    setAccountGroups((groups) =>
                      groups.map((group) =>
                        group.agentId === selected.id ? { ...group, accounts: next } : group
                      )
                    )
                  }}
                />
                {(installById[selected.id] ?? getAgentInstallStatus(selected.id)) ===
                  'missing' || selectedRun ? (
                  <div className="agents-editor-install">
                    <div className="agents-install-row">
                      {installCommandFor(selected) ? (
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={selectedInstalling}
                          title={installCommandFor(selected)}
                          onClick={() => void installSelected()}
                        >
                          {selectedInstalling ? (
                            <Loader2
                              size={13}
                              strokeWidth={2.25}
                              className="agents-install-spin"
                            />
                          ) : null}
                          {selectedInstalling
                            ? t('agents.installingNamed', { name: selected.name })
                            : selectedRun && selectedRun.status !== 'success'
                              ? t('agents.installRetry')
                              : t('agents.installRun')}
                        </button>
                      ) : (
                        <span className="muted tiny">{t('agents.notInstalled')}</span>
                      )}
                      {selectedInstalling ? (
                        <button
                          type="button"
                          className="btn ghost sm"
                          title={t('agents.installStop')}
                          onClick={() =>
                            void window.vav.agents.installCancel?.(selected.id)
                          }
                        >
                          <Square size={11} strokeWidth={2.5} />
                          {t('agents.installStop')}
                        </button>
                      ) : null}
                    </div>
                    {selectedRun ? (
                      <div
                        className="agents-install-log"
                        data-status={selectedRun.status}
                        title={selectedRun.line}
                      >
                        <span className="agents-install-log-status">
                          {selectedRun.status === 'running'
                            ? t('agents.installLogRunning')
                            : selectedRun.status === 'success'
                              ? t('agents.installLogDone')
                              : selectedRun.status === 'cancelled'
                                ? t('agents.installLogStopped')
                                : t('agents.installLogFailed')}
                        </span>
                        <span className="agents-install-log-line">{selectedRun.line}</span>
                        {selectedRun.status !== 'running' ? (
                          <button
                            type="button"
                            className="agents-install-log-dismiss"
                            title={t('common.close')}
                            aria-label={t('common.close')}
                            onClick={() =>
                              void window.vav.agents.installClear?.(selected.id)
                            }
                          >
                            <X size={11} strokeWidth={2.5} />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {startFailed ? (
                      <span className="agents-install-error">{startFailed}</span>
                    ) : null}
                  </div>
                ) : null}
                {!selected.builtin ? (
                  <>
                    <label className="settings-field">
                      <span>{t('agents.field.name')}</span>
                      <input
                        className="text-field"
                        value={selected.name}
                        onChange={(e) => patchAgent(selected.id, { name: e.target.value })}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{t('agents.field.binary')}</span>
                      <input
                        className="text-field"
                        value={selected.binaryPath}
                        placeholder="claude"
                        onChange={(e) =>
                          patchAgent(selected.id, { binaryPath: e.target.value.trim() })
                        }
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
                  </>
                ) : null}
                <label className="settings-field row">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) =>
                      patchAgent(selected.id, { enabled: e.target.checked })
                    }
                  />
                  <span>{t('agents.field.enabled')}</span>
                </label>
              </>
            ) : null}

            {modelHostKey && !selectedMissing ? (
              <div className="agents-models-field">
                <div className="agents-models-head">
                  <span>{t('agents.models')}</span>
                  <button
                    type="button"
                    className={[
                      'btn ghost sm agents-models-refresh',
                      modelsRefreshing ? 'is-refreshing' : '',
                      modelsRefreshAck ? 'is-ack' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={modelsRefreshing || (selectedIsVav && !vavCanFetch)}
                    aria-busy={modelsRefreshing}
                    onClick={refreshModels}
                  >
                    <span className="agents-models-refresh-icon" aria-hidden>
                      {modelsRefreshAck ? (
                        <Check size={12} strokeWidth={2.25} />
                      ) : (
                        <RefreshCw size={12} strokeWidth={2.25} />
                      )}
                    </span>
                    <span>
                      {modelsRefreshing
                        ? t('agents.modelsRefreshing')
                        : modelsRefreshAck
                          ? t('agents.modelsRefreshed')
                          : t('agents.modelsRefresh')}
                    </span>
                  </button>
                </div>
                {selectedIsVav && !vavCanFetch ? (
                  <div className="muted tiny">{t('agents.modelsNeedCredentials')}</div>
                ) : selectedIsVav && vavFetchError && modelList.length === 0 ? (
                  <div className="agents-models-empty muted tiny">
                    {t('agents.modelsFetchError', { error: vavFetchError })}
                  </div>
                ) : selectedIsVav && (vavLoading || modelsRefreshing) && modelList.length === 0 ? (
                  <div className="muted tiny">{t('composer.modelsLoading')}</div>
                ) : modelList.length === 0 ? (
                  <div className="muted tiny">
                    {selectedIsVav ? t('agents.modelsEmpty') : t('composer.modelsLoading')}
                  </div>
                ) : (
                  <div className="agents-models-list">
                    <div className="agents-models-row agents-models-all">
                      <label className="agents-models-all-check">
                        <input
                          type="checkbox"
                          checked={modelEnablement.all}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate =
                                !modelEnablement.all && !modelEnablement.none
                            }
                          }}
                          aria-checked={
                            modelEnablement.all
                              ? 'true'
                              : modelEnablement.none
                                ? 'false'
                                : 'mixed'
                          }
                          onChange={(e) => setAllModelsEnabled(e.target.checked)}
                        />
                        <span className="agents-models-text">
                          <span className="agents-models-label">
                            {t('agents.modelsSelectAll')}
                          </span>
                        </span>
                      </label>
                      {modelFilterOpen ? (
                        <div className="agents-models-filter">
                          <input
                            ref={modelFilterRef}
                            className="text-field agents-models-filter-input"
                            type="text"
                            value={modelFilter}
                            placeholder={t('agents.modelsFilterPlaceholder')}
                            aria-label={t('agents.modelsFilter')}
                            onChange={(e) => setModelFilter(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing || e.key === 'Process') return
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                e.stopPropagation()
                                if (modelFilter) setModelFilter('')
                                else setModelFilterOpen(false)
                              }
                            }}
                          />
                          {modelFilter ? (
                            <button
                              type="button"
                              className="agents-models-filter-clear"
                              title={t('common.clear')}
                              aria-label={t('common.clear')}
                              onClick={() => {
                                setModelFilter('')
                                modelFilterRef.current?.focus()
                              }}
                            >
                              <X size={12} strokeWidth={2.25} />
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="agents-models-filter-btn"
                          title={t('agents.modelsFilter')}
                          aria-label={t('agents.modelsFilter')}
                          onClick={() => setModelFilterOpen(true)}
                        >
                          <ListFilter size={13} strokeWidth={2.1} />
                        </button>
                      )}
                    </div>
                    {visibleModels.length === 0 ? (
                      <div className="agents-models-empty muted tiny">
                        {t('agents.modelsFilterEmpty')}
                      </div>
                    ) : (
                      visibleModels.map((model) => {
                        const enabled = isAgentModelEnabled(
                          modelHost,
                          model.id,
                          settings.disabledAgentModels
                        )
                        const isDefault =
                          selectedIsVav &&
                          !!model.id &&
                          model.id === settings.defaultModel
                        return (
                          <div key={model.id || '__default__'} className="agents-models-row">
                            <label className="agents-models-row-check">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) =>
                                  toggleModelEnabled(model.id, e.target.checked)
                                }
                              />
                              <span className="agents-models-text">
                                <span className="agents-models-label">{model.label}</span>
                                {model.id ? (
                                  <span className="agents-models-id muted tiny">{model.id}</span>
                                ) : null}
                                <ModelModalityLine
                                  input={model.input}
                                  output={model.output}
                                  t={t}
                                />
                              </span>
                            </label>
                            {selectedIsVav && model.id ? (
                              isDefault ? (
                                <span className="agents-models-default-badge">
                                  {t('agents.setAsDefault')}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="agents-models-set-default"
                                  onClick={() =>
                                    void updateSettings({ defaultModel: model.id })
                                  }
                                >
                                  {t('agents.modelsSetDefault')}
                                </button>
                              )
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted">{t('agents.empty')}</div>
        )}
      </div>

      <div className="agents-prefs">
        <label className="agents-pref-row">
          <span>{t('agents.swarmMode')}</span>
          <Toggle
            checked={settings.swarmModeEnabled === true}
            title={t('agents.swarmMode')}
            onChange={(swarmModeEnabled) => {
              void updateSettings({ swarmModeEnabled })
              if (!swarmModeEnabled) {
                const { workspaces, exitCliMode } = useWorkspaceStore.getState()
                for (const id of Object.keys(workspaces)) {
                  if (workspaces[id]?.cliMode) exitCliMode(id)
                }
              }
            }}
          />
        </label>
        <div className="form-hint">{t('agents.swarmModeHint')}</div>
        <label className="agents-pref-row">
          <span>{t('agents.skipPickerWhenSingle')}</span>
          <Toggle
            checked={settings.skipCliAgentPickerWhenSingle === true}
            title={t('agents.skipPickerWhenSingle')}
            onChange={(skipCliAgentPickerWhenSingle) =>
              void updateSettings({ skipCliAgentPickerWhenSingle })
            }
          />
        </label>
        <div className="form-hint">{t('agents.skipPickerWhenSingleHint')}</div>
      </div>
    </div>
  )
}
