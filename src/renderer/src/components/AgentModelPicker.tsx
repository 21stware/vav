import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  STRUCTURED_CLI_HOSTS,
  displayNameForCliHost,
  enabledCliAgents,
  isStructuredCliHost,
  type CliHostKind
} from '@shared/types'
import {
  RECENT_AGENT_MODELS_MAX,
  RECENT_AGENT_MODELS_PINNED,
  agentModelHostKey,
  filterEnabledModels,
  hostIdForChatHost,
  isAgentModelEnabled,
  labelForChatModel,
  modelsForChatHost,
  pushRecentAgentModel,
  resolveModelForChatHost
} from '@shared/agentModels'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { menuAnchorIfVisible, showMenu, type MenuItem } from '../lib/nativeMenu'
import { AgentBrandMark } from './AgentBrandMark'

type HostOption = { id: CliHostKind | null; name: string; markId: string }

type RecentItem = {
  hostId: string
  host: HostOption
  model: string
  modelLabel: string
  selected: boolean
}

/**
 * Native Agent → Model picker.
 * Top level: last 3 switches, a Recently submenu (last 10), then each
 * provider with its models one level down.
 */
export function AgentModelPicker({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element {
  const t = useT()
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const settings = useSessionStore((s) => s.settings)
  const catalog = useSessionStore((s) => s.agentModelCatalog)
  const setModel = useSessionStore((s) => s.setModel)
  const selectChatHost = useSessionStore((s) => s.selectChatHost)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const modelPickerMenuNonce = useSessionStore((s) => s.modelPickerMenuNonce)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const seenMenuNonce = useRef(0)

  const cliHost = conversation?.cliHost ?? null
  const customModels = settings.customModels
  const disabledModels = settings.disabledAgentModels ?? {}

  const hostOptions = useMemo((): HostOption[] => {
    const byId = new Map(
      enabledCliAgents(settings.cliAgents)
        .filter((a) => isStructuredCliHost(a.id))
        .map((a) => [a.id, a] as const)
    )
    const hosts: HostOption[] = [
      { id: null, name: t('agents.plainShell'), markId: 'vav' }
    ]
    for (const id of STRUCTURED_CLI_HOSTS) {
      const agent = byId.get(id)
      if (!agent) continue
      hosts.push({
        id,
        name: agent.name ?? displayNameForCliHost(id),
        markId: id
      })
    }
    return hosts
  }, [settings.cliAgents, t])

  const hostByMark = useMemo(() => {
    const map = new Map<string, HostOption>()
    for (const h of hostOptions) map.set(h.markId, h)
    return map
  }, [hostOptions])

  const modelsFor = (host: CliHostKind | null) => {
    const key = agentModelHostKey(host)
    const entry = catalog[key]
    const raw =
      entry?.models && entry.models.length > 0
        ? entry.models
        : modelsForChatHost(host, customModels)
    return filterEnabledModels(host, raw, disabledModels)
  }

  const activeCatalogue = modelsFor(cliHost)
  const activeModel = resolveModelForChatHost(cliHost, conversation?.model, {
    customModels,
    vavDefaultModel: settings.defaultModel,
    catalogue: activeCatalogue
  })
  const activeHost = hostOptions.find((h) => h.id === cliHost) ?? hostOptions[0]!
  const modelLabel = labelForChatModel(
    cliHost,
    activeModel,
    customModels,
    activeCatalogue
  )

  const recentItems = useMemo(() => {
    const offered = new Set(hostOptions.map((h) => h.markId))
    const out: RecentItem[] = []
    for (const entry of settings.recentAgentModels ?? []) {
      if (!offered.has(entry.hostId)) continue
      const host = hostByMark.get(entry.hostId)
      if (!host) continue
      if (!isAgentModelEnabled(host.id, entry.model, disabledModels)) continue
      const catalogue = modelsFor(host.id)
      out.push({
        hostId: entry.hostId,
        host,
        model: entry.model,
        modelLabel: labelForChatModel(host.id, entry.model, customModels, catalogue),
        selected: host.id === cliHost && entry.model === activeModel
      })
      if (out.length >= RECENT_AGENT_MODELS_MAX) break
    }
    return out
    // modelsFor/catalog intentionally via settings + catalog deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.recentAgentModels,
    hostOptions,
    hostByMark,
    disabledModels,
    customModels,
    catalog,
    cliHost,
    activeModel
  ])

  const rememberPick = (host: CliHostKind | null, model: string): void => {
    const next = pushRecentAgentModel(settings.recentAgentModels, {
      hostId: hostIdForChatHost(host),
      model
    })
    void updateSettings({ recentAgentModels: next })
  }

  const pickAgentModel = async (
    host: CliHostKind | null,
    model: string
  ): Promise<void> => {
    if (cliHost !== host) {
      await selectChatHost(conversationId, host)
    }
    const next = resolveModelForChatHost(host, model, {
      customModels,
      vavDefaultModel: settings.defaultModel,
      catalogue: modelsFor(host)
    })
    await setModel(conversationId, next)
    rememberPick(host, next)
  }

  const recentRow = (item: RecentItem): MenuItem => ({
    label: `${item.host.name} · ${item.modelLabel}`,
    checked: item.selected,
    onSelect: () => void pickAgentModel(item.host.id, item.model)
  })

  const openMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      const items: MenuItem[] = []

      for (const item of recentItems.slice(0, RECENT_AGENT_MODELS_PINNED)) {
        items.push(recentRow(item))
      }
      if (recentItems.length > 0) {
        items.push({
          label: t('composer.recently'),
          submenu: recentItems.map(recentRow)
        })
      }

      if (items.length > 0) items.push({ label: '', divider: true })
      items.push({ label: t('composer.providers'), disabled: true })

      for (const host of hostOptions) {
        const models = modelsFor(host.id)
        const modelItems: MenuItem[] =
          models.length === 0
            ? [{ label: t('composer.modelsLoading'), disabled: true }]
            : models.map((model) => ({
                label: model.label,
                checked: host.id === cliHost && model.id === activeModel,
                onSelect: () => void pickAgentModel(host.id, model.id)
              }))
        items.push({
          label: host.name,
          submenu: modelItems
        })
      }

      void showMenu(items, menuAnchorIfVisible(anchor))
    },
    // recentRow / modelsFor / pickAgentModel close over current picker state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentItems, hostOptions, t, cliHost, activeModel]
  )

  useEffect(() => {
    if (modelPickerMenuNonce === 0 || modelPickerMenuNonce === seenMenuNonce.current) return
    seenMenuNonce.current = modelPickerMenuNonce
    if (!conversation) return
    openMenu(triggerRef.current)
  }, [modelPickerMenuNonce, openMenu, conversation])

  return (
    <div className="agent-model-picker">
      <button
        ref={triggerRef}
        type="button"
        className="model-picker agent-model-picker-trigger"
        title={`${activeHost.name} · ${modelLabel}`}
        aria-label={t('composer.agentModel')}
        aria-haspopup="menu"
        disabled={!conversation}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!conversation) return
          openMenu(event.currentTarget)
        }}
      >
        <AgentBrandMark agent={{ id: activeHost.markId, name: activeHost.name }} size={16} />
        <span className="model-name">{modelLabel}</span>
        <ChevronDown size={11} />
      </button>
    </div>
  )
}
