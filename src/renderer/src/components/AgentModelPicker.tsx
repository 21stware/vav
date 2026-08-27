import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  defaultModelForChatHost,
  filterEnabledModels,
  hostIdForChatHost,
  isAgentModelEnabled,
  labelForChatModel,
  modelsForChatHost,
  pushRecentAgentModel,
  resolveModelForChatHost
} from '@shared/agentModels'
import {
  groupAccountsByVendor,
  vendorDisplayName,
  vendorIdFromEndpoint,
  type LlmVendorId
} from '@shared/llmVendors'
import { isAgentPickerLocked } from '../lib/agentPickerLock'
import { useAccountGroups, vavAccountsOf } from '../lib/accountGroups'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { menuAnchorIfVisible, showMenu, type MenuItem } from '../lib/nativeMenu'
import { formatTokens } from '../lib/format'
import { AgentBrandMark } from './AgentBrandMark'

type HostOption = {
  id: CliHostKind | null
  name: string
  markId: string
  vendorId?: LlmVendorId
  accountId?: string
}

export type TokenUsage = {
  used: number
  limit: number
  percent: number
  ratio: number
}

type RecentItem = {
  hostId: string
  host: HostOption
  model: string
  modelLabel: string
  selected: boolean
}

/** Visual lock sequence. `joined` is the pre-send pill. */
type SplitPhase = 'joined' | 'splitting' | 'settled'

type SplitMotion = { finished: Promise<boolean>; cancel: () => void }

/** Must match the split gap in `.agent-model-picker[data-phase]`. */
const SPLIT_GAP = 6
const REVEAL_MS = 90
const SEPARATE_MS = 260
const ROUND_MS = 220
const DISSOLVE_AT = 250
const DISSOLVE_MS = 150
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The split, as one overlapping timeline rather than three steps:
 *
 * - 0–90ms: the pill's material fades in, seam still closed.
 * - 90–350ms: the seam opens while the joining corners round out, so the two
 *   chips become separate objects on the way apart instead of after.
 * - 250–400ms: the material dissolves over the tail of the travel, by which
 *   point the chips are ~96% of the way to their resting places.
 *
 * The gap is a layout animation on purpose: the pickers to the right have to
 * slide over, and sliding 6px reads better than jumping it in one frame.
 */
function playSplitMotion(root: HTMLElement, host: HTMLElement, model: HTMLElement): SplitMotion {
  const styles = getComputedStyle(root)
  const fill = styles.getPropertyValue('--bg-hover').trim() || 'rgba(20, 20, 28, 0.05)'
  const radius = styles.getPropertyValue('--radius-sm').trim() || '6px'
  const clear = 'rgba(0, 0, 0, 0)'
  const seams = [
    [host, `${radius} 0 0 ${radius}`],
    [model, `0 ${radius} ${radius} 0`]
  ] as const

  const running: Animation[] = [
    root.animate([{ columnGap: '0px' }, { columnGap: `${SPLIT_GAP}px` }], {
      delay: REVEAL_MS,
      duration: SEPARATE_MS,
      easing: EASE_OUT,
      fill: 'both'
    })
  ]

  for (const [half, seam] of seams) {
    running.push(
      half.animate([{ backgroundColor: clear }, { backgroundColor: fill }], {
        duration: REVEAL_MS,
        easing: EASE_OUT,
        fill: 'both'
      }),
      half.animate([{ borderRadius: seam }, { borderRadius: radius }], {
        delay: REVEAL_MS,
        duration: ROUND_MS,
        easing: EASE_OUT,
        fill: 'both'
      }),
      // Forwards only — a backwards fill would hold the fill colour through
      // the reveal and swallow it.
      half.animate([{ backgroundColor: fill }, { backgroundColor: clear }], {
        delay: DISSOLVE_AT,
        duration: DISSOLVE_MS,
        easing: 'ease',
        fill: 'forwards'
      })
    )
  }

  return {
    finished: Promise.all(running.map((a) => a.finished.then(() => true, () => false))).then(
      (settled) => settled.every(Boolean)
    ),
    cancel: () => {
      for (const animation of running) animation.cancel()
    }
  }
}

/**
 * Native Agent → Model picker.
 *
 * Before the first turn: one pill, Agent → Model menu.
 * After a message the pill splits once (see `playSplitMotion`) into a provider
 * mark that opens account / weekly quota and a model half that stays a select
 * for this host.
 */
export function AgentModelPicker({
  conversationId,
  usage
}: {
  conversationId: string
  usage?: TokenUsage
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
  const modelPickerConversationId = useSessionStore((s) => s.modelPickerConversationId)
  const messages = useSessionStore((s) => s.messages[conversationId])
  const locked = isAgentPickerLocked(messages)

  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const seenMenuNonce = useRef(0)
  const conversationRef = useRef(conversationId)
  const playedRef = useRef(locked)
  const motionRef = useRef<SplitMotion | null>(null)
  const [phase, setPhase] = useState<SplitPhase>(locked ? 'settled' : 'joined')

  // Progress ring dimensions (20x20 squircle for n=3)
  const ringSize = 20
  const ringR = ringSize / 2
  const ringK = ringR * 0.72
  const ringPath = `M ${ringR},0 C ${ringR + ringK},0 ${ringSize},${ringR - ringK} ${ringSize},${ringR} C ${ringSize},${ringR + ringK} ${ringR + ringK},${ringSize} ${ringR},${ringSize} C ${ringR - ringK},${ringSize} 0,${ringR + ringK} 0,${ringR} C 0,${ringR - ringK} ${ringR - ringK},0 ${ringR},0 Z`
  const ringLevel = usage && usage.ratio > 0.9 ? 'full' : usage && usage.ratio > 0.7 ? 'warn' : 'ok'

  useLayoutEffect(() => {
    if (conversationRef.current !== conversationId) {
      conversationRef.current = conversationId
      motionRef.current?.cancel()
      motionRef.current = null
      playedRef.current = locked
      setPhase(locked ? 'settled' : 'joined')
    }
  }, [conversationId, locked])

  useEffect(() => {
    if (!locked) {
      playedRef.current = false
      setPhase('joined')
      return
    }
    if (playedRef.current) return
    const root = rootRef.current
    const host = hostRef.current
    const model = triggerRef.current
    if (prefersReducedMotion() || !root || !host || !model) {
      playedRef.current = true
      setPhase('settled')
      return
    }
    setPhase('splitting')
    const motion = playSplitMotion(root, host, model)
    motionRef.current = motion
    void motion.finished.then((completed) => {
      if (!completed) return
      playedRef.current = true
      setPhase('settled')
    })
    return () => {
      if (playedRef.current) return
      motion.cancel()
      motionRef.current = null
    }
  }, [locked])

  // Hand the end pose back to CSS only once the settled class has committed,
  // so cancelling the fill-forwards animations can never expose a seam frame.
  useLayoutEffect(() => {
    if (phase !== 'settled') return
    motionRef.current?.cancel()
    motionRef.current = null
  }, [phase])

  const cliHost = conversation?.cliHost ?? null
  const customModels = settings.customModels
  const disabledModels = settings.disabledAgentModels ?? {}
  const accountGroups = useAccountGroups()

  const agentOptions = useMemo((): HostOption[] => {
    const byId = new Map(
      enabledCliAgents(settings.cliAgents)
        .filter((a) => isStructuredCliHost(a.id))
        .map((a) => [a.id, a] as const)
    )
    const hosts: HostOption[] = []
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
  }, [settings.cliAgents])

  const modelOptions = useMemo((): HostOption[] => {
    const grouped = groupAccountsByVendor(vavAccountsOf(accountGroups))
    if (grouped.length > 0) {
      return grouped.map((group) => {
        const current = group.accounts.find((row) => row.current) ?? group.accounts[0]!
        return {
          id: null,
          name: group.vendor.name,
          markId: group.vendor.id,
          vendorId: group.vendor.id,
          accountId: current.id
        }
      })
    }
    const vendorId = vendorIdFromEndpoint(settings.apiEndpoint)
    return [
      {
        id: null,
        name: vendorDisplayName(settings.apiEndpoint, t('agents.customModel')),
        markId: vendorId,
        vendorId
      }
    ]
  }, [accountGroups, settings.apiEndpoint, t])

  const hostOptions = useMemo(
    () => [...modelOptions, ...agentOptions],
    [agentOptions, modelOptions]
  )

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
        : modelsForChatHost(host, customModels, settings.defaultModel)
    return filterEnabledModels(host, raw, disabledModels)
  }

  const activeCatalogue = modelsFor(cliHost)
  const activeModel = resolveModelForChatHost(cliHost, conversation?.model, {
    customModels,
    vavDefaultModel: settings.defaultModel,
    hostDefaultModel: defaultModelForChatHost(cliHost, settings),
    catalogue: activeCatalogue
  })
  const currentVav = useMemo(() => {
    const rows = vavAccountsOf(accountGroups)
    return (
      rows.find((row) => row.id === conversation?.accountId) ??
      rows.find((row) => row.current) ??
      rows[0] ??
      null
    )
  }, [accountGroups, conversation?.accountId])
  const activeVendorId =
    cliHost == null ? vendorIdFromEndpoint(currentVav?.endpoint ?? settings.apiEndpoint) : null
  const activeHost =
    (cliHost
      ? agentOptions.find((h) => h.id === cliHost)
      : modelOptions.find((h) => h.vendorId === activeVendorId)) ??
    modelOptions[0] ??
    agentOptions[0] ?? {
      id: null,
      name: vendorDisplayName(settings.apiEndpoint, t('agents.customModel')),
      markId: activeVendorId ?? 'custom',
      vendorId: activeVendorId ?? 'custom'
    }
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
      const hostId = entry.hostId === 'vav' ? (activeVendorId ?? 'custom') : entry.hostId
      if (!offered.has(hostId) && !offered.has(entry.hostId)) continue
      const host = hostByMark.get(hostId) ?? hostByMark.get(entry.hostId)
      if (!host) continue
      if (!isAgentModelEnabled(host.id, entry.model, disabledModels)) continue
      const catalogue = modelsFor(host.id)
      out.push({
        hostId: entry.hostId,
        host,
        model: entry.model,
        modelLabel: labelForChatModel(host.id, entry.model, customModels, catalogue),
        selected:
          host.id === cliHost &&
          entry.model === activeModel &&
          (host.vendorId == null || host.vendorId === activeVendorId)
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
    activeModel,
    activeVendorId
  ])

  const rememberPick = (
    host: CliHostKind | null,
    model: string,
    vendorId?: string | null
  ): void => {
    const next = pushRecentAgentModel(settings.recentAgentModels, {
      hostId: hostIdForChatHost(host, vendorId),
      model
    })
    void updateSettings({ recentAgentModels: next })
  }

  const pickAgentModel = async (
    host: CliHostKind | null,
    model: string,
    vendor?: { vendorId?: LlmVendorId; accountId?: string }
  ): Promise<void> => {
    if (locked && host !== cliHost) return
    if (host == null && vendor?.accountId) {
      const currentId =
        currentVav?.id ?? vavAccountsOf(accountGroups).find((row) => row.current)?.id
      if (vendor.accountId !== currentId) {
        await window.vav.accounts.setCurrent(vendor.accountId)
      }
    }
    if (!locked && cliHost !== host) {
      await selectChatHost(conversationId, host)
    }
    await setModel(conversationId, model)
    rememberPick(host, model, vendor?.vendorId ?? (host == null ? activeVendorId : null))
  }

  const recentRow = (item: RecentItem): MenuItem => ({
    label: `${item.host.name} · ${item.modelLabel}`,
    checked: item.selected,
    onSelect: () =>
      void pickAgentModel(item.host.id, item.model, {
        vendorId: item.host.vendorId,
        accountId: item.host.accountId
      })
  })

  const openMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      const items: MenuItem[] = []

      if (locked) {
        const models = modelsFor(cliHost)
        if (models.length === 0) {
          items.push({ label: t('composer.modelsLoading'), disabled: true })
        } else {
          for (const model of models) {
            items.push({
              label: model.label,
              checked: model.id === activeModel,
              onSelect: () => void pickAgentModel(cliHost, model.id)
            })
          }
        }
        void showMenu(items, menuAnchorIfVisible(anchor))
        return
      }

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

      const hostMenu = (hosts: HostOption[]): MenuItem[] =>
        hosts.map((host) => {
          const models = modelsFor(host.id)
          const modelItems: MenuItem[] =
            models.length === 0
              ? [{ label: t('composer.modelsLoading'), disabled: true }]
              : models.map((model) => ({
                  label: model.label,
                  checked:
                    host.id === cliHost &&
                    model.id === activeModel &&
                    (host.vendorId == null || host.vendorId === activeVendorId),
                  onSelect: () =>
                    void pickAgentModel(host.id, model.id, {
                      vendorId: host.vendorId,
                      accountId: host.accountId
                    })
                }))
          return { label: host.name, submenu: modelItems }
        })

      if (agentOptions.length > 0) {
        items.push({ label: t('composer.agents'), disabled: true })
        items.push(...hostMenu(agentOptions))
      }
      if (modelOptions.length > 0) {
        if (agentOptions.length > 0) items.push({ label: '', divider: true })
        items.push({ label: t('composer.models'), disabled: true })
        items.push(...hostMenu(modelOptions))
      }

      void showMenu(items, menuAnchorIfVisible(anchor))
    },
    // recentRow / modelsFor / pickAgentModel close over current picker state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      recentItems,
      agentOptions,
      modelOptions,
      t,
      cliHost,
      activeModel,
      activeVendorId,
      locked,
      catalog,
      disabledModels
    ]
  )

  useEffect(() => {
    if (modelPickerMenuNonce === 0 || modelPickerMenuNonce === seenMenuNonce.current) return
    if (modelPickerConversationId && modelPickerConversationId !== conversationId) return
    seenMenuNonce.current = modelPickerMenuNonce
    if (!conversation) return
    openMenu(locked ? triggerRef.current : rootRef.current)
  }, [modelPickerMenuNonce, modelPickerConversationId, conversationId, openMenu, conversation, locked])

    const hasUsage = Boolean(usage && usage.used > 0)

    return (
      <div
        ref={rootRef}
        className="agent-model-picker"
        role="group"
        data-locked={locked ? 'true' : 'false'}
        data-phase={phase}
        data-level={ringLevel}
      >
        <button
          ref={hostRef}
          type="button"
          className="agent-model-picker-host"
          title={[
            locked
              ? t('composer.agentAccount', { name: activeHost.name })
              : `${activeHost.name} · ${modelLabel}`,
            hasUsage
              ? t('token.contextDetail', {
                  percent: usage!.percent,
                  used: formatTokens(usage!.used),
                  limit: formatTokens(usage!.limit)
                })
              : null
          ]
            .filter(Boolean)
            .join('\n')}
          aria-label={
            locked
              ? t('composer.agentAccount', { name: activeHost.name })
              : t('composer.agentModel')
          }
          disabled={!conversation}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!conversation) return
            if (locked) {
              const el = hostRef.current ?? event.currentTarget
              const rect = el.getBoundingClientRect()
              void window.vav.window.openTokenUsage(conversationId, {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
              })
              return
            }
            openMenu(rootRef.current)
          }}
        >
          <AgentBrandMark agent={{ id: activeHost.markId, name: activeHost.name }} size={16} />
          {hasUsage && (
            <div className="agent-model-picker-progress">
              <svg
                width={ringSize}
                height={ringSize}
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                aria-hidden
              >
                <path d={ringPath} className="ring-track" fill="none" />
                <path
                  d={ringPath}
                  className="ring-fill"
                  fill="none"
                  strokeDasharray="100"
                  pathLength="100"
                  strokeDashoffset={100 - usage!.percent}
                />
              </svg>
            </div>
          )}
        </button>
      <button
        ref={triggerRef}
        type="button"
        className="model-picker agent-model-picker-model"
        title={`${activeHost.name} · ${modelLabel}`}
        aria-label={locked ? t('composer.model') : t('composer.agentModel')}
        aria-haspopup="menu"
        disabled={!conversation}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!conversation) return
          openMenu(locked ? event.currentTarget : rootRef.current)
        }}
      >
        <span className="model-name">{modelLabel}</span>
        <ChevronDown size={11} />
      </button>
    </div>
  )
}
