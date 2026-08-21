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
  filterEnabledModels,
  hostIdForChatHost,
  isAgentModelEnabled,
  labelForChatModel,
  modelsForChatHost,
  pushRecentAgentModel,
  resolveModelForChatHost
} from '@shared/agentModels'
import { isAgentPickerLocked } from '../lib/agentPickerLock'
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
        : modelsForChatHost(host, customModels, settings.defaultModel)
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
    if (locked && host !== cliHost) return
    if (!locked && cliHost !== host) {
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
    [recentItems, hostOptions, t, cliHost, activeModel, locked, catalog, disabledModels]
  )

  useEffect(() => {
    if (modelPickerMenuNonce === 0 || modelPickerMenuNonce === seenMenuNonce.current) return
    seenMenuNonce.current = modelPickerMenuNonce
    if (!conversation) return
    openMenu(locked ? triggerRef.current : rootRef.current)
  }, [modelPickerMenuNonce, openMenu, conversation, locked])

  return (
    <div
      ref={rootRef}
      className="agent-model-picker"
      role="group"
      data-locked={locked ? 'true' : 'false'}
      data-phase={phase}
    >
      <button
        ref={hostRef}
        type="button"
        className="agent-model-picker-host"
        title={
          locked
            ? t('composer.agentAccount', { name: activeHost.name })
            : `${activeHost.name} · ${modelLabel}`
        }
        aria-label={locked ? t('composer.agentAccount', { name: activeHost.name }) : t('composer.agentModel')}
        disabled={!conversation}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!conversation) return
          if (locked) {
            const el = hostRef.current ?? event.currentTarget
            const rect = el.getBoundingClientRect()
            void window.vav.window.openProviderAccount(conversationId, {
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
