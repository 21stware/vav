import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  STRUCTURED_CLI_HOSTS,
  displayNameForCliHost,
  enabledCliAgents,
  isStructuredCliHost,
  type CliHostKind
} from '@shared/types'
import {
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
import { AgentBrandMark } from './AgentBrandMark'

const LEAVE_MS = 180 // --dur-pop

type HostOption = { id: CliHostKind | null; name: string; markId: string }

/**
 * Two-step Agent → Model picker.
 * Catalogues are preloaded in the background; Settings controls which agents /
 * models stay enabled. A “Recently” queue sits above the steps for one-click
 * switch to the last few agent+model pairs.
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
    // Only agents enabled in Settings appear in the picker.
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
    const out: {
      hostId: string
      host: HostOption
      model: string
      modelLabel: string
      selected: boolean
    }[] = []
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
      if (out.length >= 6) break
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

  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [modelStepHost, setModelStepHost] = useState<CliHostKind | null | 'agents'>(
    'agents'
  )
  const leaveTimer = useRef<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = (): void => {
    if (!open || leaving) return
    setLeaving(true)
    if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setOpen(false)
      setLeaving(false)
      setMounted(false)
      setModelStepHost('agents')
    }, LEAVE_MS)
  }

  const openMenu = (): void => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    setLeaving(false)
    // If current host was disabled, land on the agent list.
    const stillOffered = hostOptions.some((h) => h.id === cliHost)
    setModelStepHost(stillOffered ? cliHost : 'agents')
    setMounted(true)
    setOpen(true)
  }

  useEffect(() => {
    return () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!open || leaving) return
    const onDoc = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (modelStepHost !== 'agents') {
          event.preventDefault()
          setModelStepHost('agents')
          return
        }
        close()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leaving, modelStepHost])

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const selected = menuRef.current.querySelector<HTMLElement>('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [open, modelStepHost, cliHost, activeModel])

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
    close()
  }

  const stepHost =
    modelStepHost === 'agents'
      ? null
      : hostOptions.find((h) => h.id === modelStepHost) ?? activeHost
  const stepModels = modelStepHost === 'agents' ? [] : modelsFor(modelStepHost)
  const stepEntry =
    modelStepHost === 'agents' ? null : catalog[agentModelHostKey(modelStepHost)]
  const stepSource = stepEntry?.source ?? null

  const recentSection =
    recentItems.length > 0 ? (
      <>
        <div className="agent-model-menu-section-label">{t('composer.recently')}</div>
        <div className="agent-model-menu-sep" role="separator" />
        {recentItems.map((item) => (
          <button
            key={`${item.hostId}:${item.model || '__default__'}`}
            type="button"
            role="menuitem"
            data-selected={item.selected || undefined}
            className={`agent-model-menu-item agent-model-menu-recent${
              item.selected ? ' is-selected' : ''
            }`}
            title={`${item.host.name} · ${item.modelLabel}`}
            onClick={() => void pickAgentModel(item.host.id, item.model)}
          >
            <AgentBrandMark
              agent={{ id: item.host.markId, name: item.host.name }}
              size={16}
            />
            <span className="agent-model-menu-item-label">
              <span className="agent-model-menu-recent-agent">{item.host.name}</span>
              <span className="agent-model-picker-sep" aria-hidden>
                ·
              </span>
              <span className="agent-model-menu-recent-model">{item.modelLabel}</span>
            </span>
            {item.selected ? <Check size={12} strokeWidth={2.5} /> : null}
          </button>
        ))}
        <div className="agent-model-menu-sep" role="separator" />
      </>
    ) : null

  return (
    <div className="agent-model-picker" ref={wrapRef}>
      <button
        type="button"
        className="model-picker agent-model-picker-trigger"
        title={`${activeHost.name} · ${modelLabel}`}
        aria-label={t('composer.agentModel')}
        aria-haspopup="menu"
        aria-expanded={open && !leaving}
        disabled={!conversation}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!conversation) return
          if (open && !leaving) close()
          else openMenu()
        }}
      >
        <AgentBrandMark agent={{ id: activeHost.markId, name: activeHost.name }} size={16} />
        <span className="model-name agent-model-picker-label">
          <span className="agent-model-picker-agent">{activeHost.name}</span>
          <span className="agent-model-picker-sep" aria-hidden>
            ·
          </span>
          <span className="agent-model-picker-model">{modelLabel}</span>
        </span>
        <ChevronDown size={11} />
      </button>

      {mounted ? (
        <div
          ref={menuRef}
          className="agent-model-menu"
          role="menu"
          data-leaving={leaving || undefined}
          data-step={modelStepHost === 'agents' ? 'agents' : 'models'}
        >
          {recentSection}
          {modelStepHost === 'agents' ? (
            <>
              <div className="agent-model-menu-section-label">{t('agents.selector')}</div>
              {hostOptions.map((host) => {
                const agentActive = host.id === cliHost
                return (
                  <button
                    key={host.markId}
                    type="button"
                    role="menuitem"
                    data-selected={agentActive || undefined}
                    className={`agent-model-menu-item agent-model-menu-agent${
                      agentActive ? ' is-selected' : ''
                    }`}
                    onClick={() => setModelStepHost(host.id)}
                  >
                    <AgentBrandMark agent={{ id: host.markId, name: host.name }} size={16} />
                    <span className="agent-model-menu-item-label">{host.name}</span>
                    {agentActive ? (
                      <span className="agent-model-menu-current">{modelLabel}</span>
                    ) : null}
                    <ChevronRight size={12} strokeWidth={2.25} />
                  </button>
                )
              })}
            </>
          ) : stepHost ? (
            <>
              <button
                type="button"
                className="agent-model-menu-back"
                onClick={() => setModelStepHost('agents')}
              >
                <ChevronLeft size={14} strokeWidth={2.25} />
                <AgentBrandMark
                  agent={{ id: stepHost.markId, name: stepHost.name }}
                  size={16}
                />
                <span className="agent-model-menu-item-label">{stepHost.name}</span>
              </button>
              <div className="agent-model-menu-section-label">
                {stepSource === 'live'
                  ? t('composer.modelsFromCli')
                  : !stepEntry
                    ? t('composer.modelsLoading')
                    : t('composer.model')}
              </div>
              {stepModels.map((model) => {
                const selected = stepHost.id === cliHost && model.id === activeModel
                return (
                  <button
                    key={model.id || '__default__'}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-selected={selected || undefined}
                    className={`agent-model-menu-item agent-model-menu-model${
                      selected ? ' is-selected' : ''
                    }`}
                    onClick={() => void pickAgentModel(stepHost.id, model.id)}
                  >
                    <span className="agent-model-menu-item-label">{model.label}</span>
                    {selected ? <Check size={12} strokeWidth={2.5} /> : null}
                  </button>
                )
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
