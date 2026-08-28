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
import {
  LLM_CUSTOM_VENDOR,
  LLM_VENDOR_CATALOGUE,
  groupAccountsByVendor,
  isLlmVendorId,
  vendorIdFromEndpoint,
  type LlmVendor,
  type LlmVendorGroup
} from '@shared/llmVendors'
import type { AccountView } from '@shared/ipc'
import type { MessageKey } from '@shared/i18n'
import { agentWebsiteUrl } from '@shared/agentBinary'
import {
  agentModelHostKey,
  isAgentModelEnabled,
  isOfficialDeepSeekEndpoint,
  modelsForChatHost,
  nativeDeepSeekModels
} from '@shared/agentModels'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { useAccountGroups, vavAccountsOf } from '../../lib/accountGroups'
import { menuAnchor, showMenu } from '../../lib/nativeMenu'
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

type ProviderListRow =
  | { id: string; kind: 'agent'; agent: AgentConfig }
  | { id: string; kind: 'vendor'; vendor: LlmVendor; accounts: AccountView[] }

function orderProviderRows(
  agents: AgentConfig[],
  vendors: LlmVendorGroup<AccountView>[],
  order: string[]
): ProviderListRow[] {
  const rows = new Map<string, ProviderListRow>()
  for (const agent of agents) {
    rows.set(agent.id, { id: agent.id, kind: 'agent', agent })
  }
  for (const row of vendors) {
    rows.set(row.vendor.id, {
      id: row.vendor.id,
      kind: 'vendor',
      vendor: row.vendor,
      accounts: row.accounts
    })
  }
  const out: ProviderListRow[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const row = rows.get(id)
    if (!row || seen.has(id)) continue
    out.push(row)
    seen.add(id)
  }
  for (const agent of agents) {
    if (seen.has(agent.id)) continue
    out.push(rows.get(agent.id)!)
    seen.add(agent.id)
  }
  for (const row of vendors) {
    if (seen.has(row.vendor.id)) continue
    out.push(rows.get(row.vendor.id)!)
    seen.add(row.vendor.id)
  }
  return out
}

/** After a row is removed, stay on the item above it (or the new first). */
function idAfterRemoving(rows: Array<{ id: string }>, removedId: string): string | null {
  const index = rows.findIndex((row) => row.id === removedId)
  const remaining = rows.filter((row) => row.id !== removedId)
  if (remaining.length === 0) return null
  return remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id ?? null
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
  const focusAccountId = useSessionStore((s) => s.settingsFocusAccountId)
  const accountGroups = useAccountGroups()
  const [accountGroupsLocal, setAccountGroupsLocal] = useState(accountGroups)
  const groups = accountGroupsLocal.length > 0 ? accountGroupsLocal : accountGroups
  const vavAccounts = vavAccountsOf(groups)
  const modelVendors = useMemo(() => groupAccountsByVendor(vavAccounts), [vavAccounts])
  const [listOrder, setListOrder] = useState<string[]>(() => settings.providerListOrder ?? [])
  useEffect(() => {
    setListOrder(settings.providerListOrder ?? [])
  }, [settings.providerListOrder])
  const listRows = useMemo(
    () => orderProviderRows(agents, modelVendors, listOrder),
    [agents, modelVendors, listOrder]
  )
  const [selectedId, setSelectedId] = useState<string | null>(
    () => focusAgentId && focusAgentId !== 'vav' ? focusAgentId : null
  )
  const [modelFilterOpen, setModelFilterOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [modelView, setModelView] = useState<'all' | 'enabled'>('all')
  const [modelsRefreshing, setModelsRefreshing] = useState(false)
  const [modelsRefreshAck, setModelsRefreshAck] = useState(false)

  useEffect(() => {
    setAccountGroupsLocal(accountGroups)
  }, [accountGroups])

  useEffect(() => {
    if (focusAccountId) {
      const hit = vavAccounts.find((row) => row.id === focusAccountId)
      if (hit) {
        setSelectedId(vendorIdFromEndpoint(hit.endpoint))
        useSessionStore.setState({ settingsFocusAccountId: null, settingsFocusAgentId: null })
        return
      }
    }
    if (!focusAgentId) return
    if (focusAgentId === 'vav') {
      const current = vavAccounts.find((row) => row.current) ?? vavAccounts[0]
      setSelectedId(current ? vendorIdFromEndpoint(current.endpoint) : modelVendors[0]?.vendor.id ?? null)
    } else {
      setSelectedId(focusAgentId)
    }
    useSessionStore.setState({ settingsFocusAgentId: null })
  }, [focusAccountId, focusAgentId, modelVendors, vavAccounts])
  const modelsRefreshTimers = useRef<number[]>([])
  const modelFilterRef = useRef<HTMLInputElement>(null)
  const selectedVendor = useMemo(
    () => modelVendors.find((row) => row.vendor.id === selectedId) ?? null,
    [modelVendors, selectedId]
  )
  const selectedIsModel = !!selectedVendor
  const selected = useMemo(
    () => (selectedIsModel ? null : agents.find((a) => a.id === selectedId) ?? null),
    [agents, selectedId, selectedIsModel]
  )

  // Keep selection valid after external sync / reorder.
  useEffect(() => {
    if (selectedVendor || (selectedId && agents.some((a) => a.id === selectedId))) return
    setSelectedId(modelVendors[0]?.vendor.id ?? agents[0]?.id ?? null)
  }, [agents, modelVendors, selectedId, selectedVendor])

  // Fresh query per visit (this page unmounts when leaving Settings → Agents)
  // and whenever the user picks another provider in the list.
  useEffect(() => {
    setModelFilter('')
    setModelFilterOpen(false)
    setModelView('all')
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

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverEdge, setDragOverEdge] = useState<'before' | 'after'>('before')
  const dragIdRef = useRef<string | null>(null)

  const commitAgents = (
    next: AgentConfig[],
    extra?: { removedCliAgentIds?: string[] }
  ): void => {
    const cloned = cloneAgents(next)
    setAgents(cloned)
    agentsRef.current = cloned
    const currentDefault = settings.defaultAgentId
    // Keep an explicit vendor default, or a still-present CLI id.
    const nextDefault =
      !currentDefault || currentDefault === 'vav'
        ? null
        : isLlmVendorId(currentDefault)
          ? currentDefault
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

  const persistListOrder = (next: string[]): void => {
    setListOrder(next)
    void updateSettings({ providerListOrder: next }).catch((err) => {
      console.error('[agents] failed to persist providerListOrder', err)
    })
  }

  const selectedRun = selected ? (installRuns[selected.id] ?? null) : null
  const selectedInstalling = selectedRun?.status === 'running'
  const selectedMissing =
    !!selected &&
    (installById[selected.id] ?? getAgentInstallStatus(selected.id)) === 'missing'

  const currentVav =
    (selectedVendor?.accounts.find((row) => row.current) ??
      selectedVendor?.accounts[0] ??
      vavAccounts.find((row) => row.current) ??
      vavAccounts[0]) ??
    null

  const activeDefaultId =
    !settings.defaultAgentId || settings.defaultAgentId === 'vav'
      ? null
      : settings.defaultAgentId
  const defaultHostMatchesSelection = selectedIsModel
    ? activeDefaultId === selectedVendor?.vendor.id
    : selected?.id === activeDefaultId
  const modelHostKey = agentModelHostKey(
    (selectedIsModel ? null : selected?.id) as CliHostKind | null,
    selectedIsModel ? selectedVendor?.vendor.id : null,
    selectedIsModel ? currentVav?.id : null
  )
  const modelHost = (selectedIsModel ? null : selected?.id) as CliHostKind | null
  const vavCatalog = catalog[modelHostKey]
  const selectedAgentId = selectedIsModel ? 'vav' : selected?.id ?? null
  const agentProfiles = selectedIsModel
    ? selectedVendor?.accounts ?? []
    : (selectedAgentId
        ? groups.find((group) => group.agentId === selectedAgentId)?.accounts
        : null) ?? []
  const selectedVendorName = selectedVendor?.vendor.name ?? t('agents.customModel')
  const vavEndpointKey = (currentVav?.endpoint ?? selectedVendor?.vendor.endpoint ?? settings.apiEndpoint).trim()
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
  const vavFetchError = selectedIsModel && catalogMatchesVav ? vavCatalog?.error : undefined
  const vavLoading = selectedIsModel && vavCanFetch && !vavLive && !vavFetchError
  const modelList = useMemo(() => {
    if (!modelHostKey) return []
    const entry = catalog[modelHostKey]
    if (selectedIsModel) {
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
    selectedIsModel,
    settings.customModels,
    settings.defaultModel,
    vavEndpointKey
  ])

  const modelFilterQuery = modelFilter.trim().toLowerCase()
  const visibleModels = useMemo(() => {
    return modelList.filter((model) => {
      if (
        modelView === 'enabled' &&
        !isAgentModelEnabled(modelHost, model.id, settings.disabledAgentModels, selectedVendor?.vendor.id, currentVav?.id)
      ) {
        return false
      }
      if (!modelFilterQuery) return true
      const label = (model.label ?? '').toLowerCase()
      const id = (model.id ?? '').toLowerCase()
      return label.includes(modelFilterQuery) || id.includes(modelFilterQuery)
    })
  }, [modelList, modelFilterQuery, modelView, modelHost, settings.disabledAgentModels])

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
      if (isAgentModelEnabled(modelHost, model.id, settings.disabledAgentModels, selectedVendor?.vendor.id, currentVav?.id)) enabled++
    }
    return {
      enabled,
      all: modelList.length > 0 && enabled === modelList.length,
      none: enabled === 0
    }
  }, [modelList, modelHost, settings.disabledAgentModels])

  const setModelAsDefault = (modelId: string): void => {
    if (selectedIsModel) {
      const account =
        selectedVendor?.accounts.find((row) => row.current) ?? selectedVendor?.accounts[0]
      void updateSettings({
        defaultModel: modelId,
        defaultAgentId: selectedVendor?.vendor.id ?? null
      })
      if (account && !account.current) {
        void window.vav.accounts.setCurrent(account.id).then((page) => {
          setAccountGroupsLocal(page.groups ?? [])
          void refreshCatalog(true)
        })
      }
      return
    }
    if (!selected || !modelHostKey) return
    void updateSettings({
      defaultAgentModels: {
        ...settings.defaultAgentModels,
        [modelHostKey]: modelId
      },
      defaultAgentId: selected.id
    })
  }

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
    persistListOrder([...listRows.map((row) => row.id), agent.id])
    setSelectedId(agent.id)
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
    persistListOrder([...listRows.map((row) => row.id), id])
    setSelectedId(id)
  }

  const presentVendorIds = useMemo(
    () => new Set(modelVendors.map((row) => row.vendor.id)),
    [modelVendors]
  )

  const addModelVendor = async (vendor: LlmVendor): Promise<void> => {
    if (vendor.id !== 'custom' && presentVendorIds.has(vendor.id)) {
      setSelectedId(vendor.id)
      return
    }
    const { page, id } = await window.vav.accounts.createDraft({
      agentId: 'vav',
      kind: 'vav_key',
      endpoint: vendor.endpoint
    })
    setAccountGroupsLocal(page.groups ?? [])
    if (vendor.id !== 'custom') {
      await window.vav.accounts.updateVav(id, { alias: vendor.name })
    }
    await window.vav.accounts.setCurrent(id)
    persistListOrder(
      listRows.some((row) => row.id === vendor.id)
        ? listRows.map((row) => row.id)
        : [...listRows.map((row) => row.id), vendor.id]
    )
    setSelectedId(vendor.id)
    void refreshCatalog(true)
  }

  const openAddMenu = (anchor: HTMLElement): void => {
    const addableVendors = LLM_VENDOR_CATALOGUE.filter((vendor) => !presentVendorIds.has(vendor.id))
    void showMenu(
      [
        { label: t('agents.groupAgents'), disabled: true },
        ...addableCatalogue.map((agent) => ({
          label: agent.name,
          onSelect: () => addFromCatalogue(agent)
        })),
        { label: t('agents.newCustomName'), onSelect: addCustom },
        { label: '', divider: true },
        { label: t('agents.groupModels'), disabled: true },
        ...addableVendors.map((vendor) => ({
          label: vendor.name,
          onSelect: () => void addModelVendor(vendor)
        })),
        { label: t('agents.newCustomModel'), onSelect: () => void addModelVendor(LLM_CUSTOM_VENDOR) }
      ],
      menuAnchor(anchor)
    )
  }

  const canRemove = selectedIsModel
    ? (selectedVendor?.accounts.length ?? 0) > 0
    : agents.length > 1 && !!selected

  const removeSelected = (): void => {
    if (selectedIsModel && selectedVendor) {
      const ids = selectedVendor.accounts.map((row) => row.id)
      const remaining = listRows.filter((row) => row.id !== selectedVendor.vendor.id)
      persistListOrder(remaining.map((row) => row.id))
      setSelectedId(idAfterRemoving(listRows, selectedVendor.vendor.id))
      if (settings.defaultAgentId === selectedVendor.vendor.id) {
        void updateSettings({ defaultAgentId: null })
      }
      void (async () => {
        let page = null
        for (const id of ids) {
          page = await window.vav.accounts.remove(id)
        }
        if (page) setAccountGroupsLocal(page.groups ?? [])
      })()
      return
    }
    if (!selected || agents.length <= 1) return
    const remaining = listRows.filter((row) => row.id !== selected.id)
    persistListOrder(remaining.map((row) => row.id))
    setSelectedId(idAfterRemoving(listRows, selected.id))
    const next = agents.filter((a) => a.id !== selected.id)
    const removedCliAgentIds = [
      ...new Set([...(settings.removedCliAgentIds ?? []), selected.id])
    ]
    commitAgents(next, { removedCliAgentIds })
  }

  const reorder = (fromId: string, toId: string, edge: 'before' | 'after' = 'before'): void => {
    if (!fromId || !toId || fromId === toId) return
    const ids = listRows.map((row) => row.id)
    const from = ids.indexOf(fromId)
    let to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    if (edge === 'after') to += 1
    if (from < to) to -= 1
    if (from === to) return
    const next = [...ids]
    const [id] = next.splice(from, 1)
    if (!id) return
    next.splice(to, 0, id)
    const agentIds = next.filter((rowId) => agents.some((agent) => agent.id === rowId))
    const agentsChanged = agentIds.join('\0') !== agents.map((agent) => agent.id).join('\0')
    if (agentsChanged) {
      const byId = new Map(agents.map((agent) => [agent.id, agent]))
      const nextAgents = agentIds.map((rowId) => byId.get(rowId)!).filter(Boolean)
      const cloned = cloneAgents(nextAgents)
      setListOrder(next)
      setAgents(cloned)
      agentsRef.current = cloned
      const currentDefault = settings.defaultAgentId
      const nextDefault =
        !currentDefault || currentDefault === 'vav'
          ? null
          : cloned.some((a) => a.id === currentDefault)
            ? currentDefault
            : null
      void updateSettings({
        providerListOrder: next,
        cliAgents: cloned,
        defaultAgentId: nextDefault
      }).catch((err) => {
        console.error('[agents] failed to persist provider order', err)
      })
      return
    }
    persistListOrder(next)
  }

  return (
    <div className="settings-section agents-settings">
      <div className="agents-layout">
        <div className="agents-list-panel">
          <div
            className="agents-list"
            data-testid="providers-list"
            role="listbox"
            aria-label={t('settings.nav.agents')}
            onDragOver={(e) => {
              // Allow drops anywhere in the list (not only on row buttons).
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
          >
            {listRows.map((row) => {
              const isSelected = selectedId === row.id
              const isDragging = dragId === row.id
              const isOver = dragOverId === row.id && dragId !== row.id
              const dropEdge = isOver ? dragOverEdge : null
              const agent = row.kind === 'agent' ? row.agent : null
              const missing = agent
                ? (installById[agent.id] ?? getAgentInstallStatus(agent.id)) === 'missing'
                : false
              const vendorCurrent =
                row.kind === 'vendor'
                  ? (row.accounts.find((account) => account.current) ?? row.accounts[0])
                  : null
              const isDefault = agent
                ? activeDefaultId === agent.id
                : activeDefaultId === row.id
              return (
                <div
                  key={row.id}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`provider-row-${row.id}`}
                  className={[
                    'agents-list-row',
                    isSelected ? 'selected' : '',
                    agent && !agent.enabled ? 'disabled' : '',
                    missing ? 'is-missing' : '',
                    isOver ? 'is-drag-over' : '',
                    isDragging ? 'is-dragging' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-drop={dropEdge ?? undefined}
                  draggable
                  onClick={() => {
                    setSelectedId(row.id)
                    if (vendorCurrent && !vendorCurrent.current) {
                      void window.vav.accounts.setCurrent(vendorCurrent.id).then((page) => {
                        setAccountGroupsLocal(page.groups ?? [])
                        void refreshCatalog(true)
                      })
                    }
                  }}
                  onDragStart={(e) => {
                    dragIdRef.current = row.id
                    setDragId(row.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', row.id)
                    e.dataTransfer.setData('application/x-vav-agent-id', row.id)
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
                    if (dragOverId !== row.id) setDragOverId(row.id)
                    if (dragOverEdge !== edge) setDragOverEdge(edge)
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverId === row.id) setDragOverId(null)
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
                    if (from) reorder(from, row.id, edge)
                  }}
                >
                  <span
                    className="agents-list-grip"
                    title={t('agents.reorderHint')}
                    aria-label={t('agents.reorderHint')}
                  >
                    <GripVertical size={12} strokeWidth={2} />
                  </span>
                  <AgentBrandMark
                    agent={
                      agent ?? {
                        id: row.kind === 'vendor' ? row.vendor.id : row.id,
                        name: row.kind === 'vendor' ? row.vendor.name : row.id
                      }
                    }
                    size={18}
                  />
                  <span className="agents-list-name">
                    {agent?.name ?? (row.kind === 'vendor' ? row.vendor.name : row.id)}
                  </span>
                  {missing ? (
                    <span className="agents-list-badge">{t('agents.notInstalled')}</span>
                  ) : isDefault ? (
                    <span className="agents-list-badge">{t('agents.setAsDefault')}</span>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="agents-list-toolbar">
            <div className="agents-list-add-wrap">
              <button
                type="button"
                className="agents-list-tool-btn"
                title={t('agents.add')}
                aria-label={t('agents.add')}
                aria-haspopup="menu"
                onClick={(event) => {
                  event.preventDefault()
                  openAddMenu(event.currentTarget)
                }}
              >
                <Plus size={14} strokeWidth={2.25} />
              </button>
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
                selectedIsModel
                  ? !selectedVendor || activeDefaultId === selectedVendor.vendor.id
                  : !selected ||
                    !isStructuredCliHost(selected.id) ||
                    selected.enabled === false ||
                    (installById[selected.id] ?? getAgentInstallStatus(selected.id)) ===
                      'missing' ||
                    selected.id === activeDefaultId
              }
              onClick={() => {
                const next = selectedIsModel
                  ? (selectedVendor?.vendor.id ?? null)
                  : (selected?.id ?? null)
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

        {selectedIsModel || selected ? (
          <div className="agents-editor">
            {selectedIsModel ? (
              <>
                <div className="agents-editor-hero">
                  <AgentBrandMark
                    agent={{ id: selectedVendor?.vendor.id ?? 'custom', name: selectedVendorName }}
                    size={40}
                  />
                  <span className="agents-editor-hero-name" data-testid="provider-editor-name">
                    {selectedVendorName}
                  </span>
                </div>
                <AgentProfileSwitch
                  agentId="vav"
                  accounts={agentProfiles}
                  endpoint={selectedVendor?.vendor.endpoint}
                  onProfileChanged={(next) => {
                    setAccountGroupsLocal((groups) =>
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
                  <span className="agents-editor-hero-name" data-testid="provider-editor-name">
                    {selected.name}
                  </span>
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
                    setAccountGroupsLocal((groups) =>
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
                    disabled={modelsRefreshing || (selectedIsModel && !vavCanFetch)}
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
                {selectedIsModel && !vavCanFetch ? (
                  <div className="muted tiny">
                    {t(
                      selectedVendor?.vendor.endpoint
                        ? 'agents.modelsNeedKey'
                        : 'agents.modelsNeedCredentials'
                    )}
                  </div>
                ) : selectedIsModel && vavFetchError && modelList.length === 0 ? (
                  <div className="agents-models-empty muted tiny">
                    {t('agents.modelsFetchError', { error: vavFetchError })}
                  </div>
                ) : selectedIsModel && (vavLoading || modelsRefreshing) && modelList.length === 0 ? (
                  <div className="muted tiny">{t('composer.modelsLoading')}</div>
                ) : modelList.length === 0 ? (
                  <div className="muted tiny">
                    {selectedIsModel ? t('agents.modelsEmpty') : t('composer.modelsLoading')}
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
                      <button
                        type="button"
                        className="agents-models-view-toggle"
                        onClick={() =>
                          setModelView((view) => (view === 'all' ? 'enabled' : 'all'))
                        }
                      >
                        {modelView === 'all'
                          ? t('agents.modelsShowEnabled')
                          : t('agents.modelsShowAll')}
                      </button>
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
                        {modelFilterQuery
                          ? t('agents.modelsFilterEmpty')
                          : t('agents.modelsEnabledEmpty')}
                      </div>
                    ) : (
                      visibleModels.map((model) => {
                        const enabled = isAgentModelEnabled(
                          modelHost,
                          model.id,
                          settings.disabledAgentModels,
                          selectedVendor?.vendor.id
                        )
                        const hostDefault = selectedIsModel
                          ? settings.defaultModel
                          : (settings.defaultAgentModels?.[modelHostKey] ?? '')
                        const isDefault = model.id === hostDefault && defaultHostMatchesSelection
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
                            {isDefault ? (
                              <span className="agents-models-default-badge">
                                {t('agents.setAsDefault')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="agents-models-set-default"
                                onClick={() => setModelAsDefault(model.id)}
                              >
                                {t('agents.modelsSetDefault')}
                              </button>
                            )}
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
            testId="settings-swarm-mode"
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
