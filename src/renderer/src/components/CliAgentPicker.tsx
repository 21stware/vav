import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { enabledCliAgents } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { CLI_SURFACE_KEY, useWorkspaceStore } from '../state/workspaceStore'
import { setUiFocusScope } from '../lib/uiFocus'
import { IS_MAC } from '../lib/platform'
import { AgentBrandMark } from './AgentBrandMark'
import { useT } from '../i18n/useT'

/**
 * Mac glyph chord (`⌘⇧D`) → icon spans with full modifier names in `title`.
 * Non-Mac shows Ctrl/Shift words with the same titles.
 */
function ShortcutChord({ chord }: { chord: string }): React.JSX.Element {
  const t = useT()
  const nodes: ReactNode[] = []
  let key = ''
  for (const ch of chord) {
    if (ch === '⌘' || ch === '⌃') {
      nodes.push(
        <span
          key={`mod-${nodes.length}`}
          className="cli-agent-picker-kbd"
          title={IS_MAC ? t('keys.command') : t('keys.control')}
        >
          {IS_MAC ? '⌘' : 'Ctrl'}
        </span>
      )
    } else if (ch === '⇧') {
      nodes.push(
        <span key={`shift-${nodes.length}`} className="cli-agent-picker-kbd" title={t('keys.shift')}>
          {IS_MAC ? '⇧' : 'Shift'}
        </span>
      )
    } else if (ch === '⌥') {
      nodes.push(
        <span
          key={`opt-${nodes.length}`}
          className="cli-agent-picker-kbd"
          title={IS_MAC ? t('keys.option') : t('keys.alt')}
        >
          {IS_MAC ? '⌥' : 'Alt'}
        </span>
      )
    } else {
      key += ch
    }
  }
  if (key) {
    nodes.push(
      <span key="key" className="cli-agent-picker-kbd is-key">
        {key}
      </span>
    )
  }
  if (!IS_MAC) {
    return (
      <span className="cli-agent-picker-chord">
        {nodes.map((node, i) => (
          <Fragment key={i}>
            {i > 0 ? <span className="cli-agent-picker-kbd-join">+</span> : null}
            {node}
          </Fragment>
        ))}
      </span>
    )
  }
  return <span className="cli-agent-picker-chord">{nodes}</span>
}

/**
 * In-pane CLI type chooser. Shown for pending split panes and empty CLI mode.
 *
 * Default: compact icon strip. Narrow / short panes (container queries) switch
 * to a dense horizontal list so agents stay visible in small splits.
 * `compact` — multi-pane leaf: denser padding.
 *
 * Keyboard: when this pane is active, focus lands on the first agent so the
 * whole flow is keyboard-only (←/→/↑/↓, Home/End, Enter/Space).
 */
export function CliAgentPicker({
  conversationId,
  tabId,
  compact = false
}: {
  conversationId: string
  /** Pending leaf id to bind after pick; omit for empty-state first pick. */
  tabId?: string | null
  compact?: boolean
}): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const agents = enabledCliAgents(settings.cliAgents).filter((a) => !!a.id && !!a.name)

  const isActivePane = useWorkspaceStore((s) => {
    // Full-surface empty picker (no tabId) is always the sole target.
    if (!tabId) return true
    const ws = s.workspaces[conversationId]
    if (!ws) return false
    const host =
      ws.agentHostSessions[CLI_SURFACE_KEY] ??
      (ws.activeHostAgentId ? ws.agentHostSessions[ws.activeHostAgentId] : undefined)
    return host?.activeTabId === tabId
  })

  const [activeIndex, setActiveIndex] = useState(0)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndexRef = useRef(0)
  activeIndexRef.current = activeIndex

  const onPick = useCallback(
    (agentId: string): void => {
      if (!conversationId) return
      void (async () => {
        if (tabId) {
          const result = await useWorkspaceStore
            .getState()
            .assignCliPane(conversationId, tabId, agentId, 80, 24)
          if (result === 'missing') {
            await useSessionStore.getState().setAgentBinaryName(conversationId, agentId)
          }
          return
        }
        useWorkspaceStore.getState().enterCliMode(conversationId)
        const surface =
          useWorkspaceStore.getState().workspaces[conversationId]?.agentHostSessions[
            CLI_SURFACE_KEY
          ]
        const pendingId =
          surface?.tabs.find((x) => x.pendingCli)?.id ?? surface?.tabs[0]?.id ?? null
        if (pendingId) {
          await useWorkspaceStore
            .getState()
            .assignCliPane(conversationId, pendingId, agentId, 80, 24)
        } else {
          await useSessionStore.getState().setAgentBinaryName(conversationId, agentId)
          void useWorkspaceStore.getState().activateAgentHost(conversationId, agentId, 80, 24)
        }
      })()
    },
    [conversationId, tabId]
  )

  const focusItem = useCallback(
    (index: number): void => {
      if (agents.length === 0) return
      const next = ((index % agents.length) + agents.length) % agents.length
      setActiveIndex(next)
      setUiFocusScope('agent')
      const el = itemRefs.current[next]
      if (el) {
        try {
          el.focus({ preventScroll: true })
        } catch {
          el.focus()
        }
      }
    },
    [agents.length]
  )

  // Only steal focus when this pane *becomes* active (new split / click / ⌘W).
  // Do not re-focus on every agents[] refresh — that yanks keys away from a
  // live PTY if a stale picker remount races the terminal host.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    const becameActive = isActivePane && !wasActiveRef.current
    wasActiveRef.current = isActivePane
    if (!becameActive || agents.length === 0) return
    let cancelled = false
    const run = (attempt: number): void => {
      if (cancelled) return
      const el = itemRefs.current[0]
      if (!el) {
        if (attempt < 6) requestAnimationFrame(() => run(attempt + 1))
        return
      }
      setActiveIndex(0)
      setUiFocusScope('agent')
      try {
        el.focus({ preventScroll: true })
      } catch {
        el.focus()
      }
    }
    requestAnimationFrame(() => run(0))
    return () => {
      cancelled = true
    }
  }, [isActivePane, tabId, conversationId, agents.length])

  // Keep highlight in range if the agent list shrinks.
  useEffect(() => {
    if (agents.length === 0) return
    if (activeIndexRef.current >= agents.length) {
      setActiveIndex(0)
    }
  }, [agents.length])

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (agents.length === 0) return
    // ⌘/Ctrl+arrow is Swarm pane focus — never steal it for in-list moves.
    if (event.metaKey || event.ctrlKey) return
    const key = event.key
    let delta: number | null = null
    if (key === 'ArrowRight' || key === 'ArrowDown') delta = 1
    else if (key === 'ArrowLeft' || key === 'ArrowUp') delta = -1
    else if (key === 'Home') {
      event.preventDefault()
      focusItem(0)
      return
    } else if (key === 'End') {
      event.preventDefault()
      focusItem(agents.length - 1)
      return
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    focusItem(activeIndexRef.current + delta)
  }

  const help = (
    <div className="cli-agent-picker-help">
      <p>{t('agents.swarmHelpIntro')}</p>
      <p>
        <ShortcutChord chord="⌘D" /> {t('agents.swarmHelpSplitVertical')}
        <span className="cli-agent-picker-help-sep">, </span>
        <ShortcutChord chord="⌘⇧D" /> {t('agents.swarmHelpSplitHorizontal')}
      </p>
      <p>
        <ShortcutChord chord="⌘←" />{' '}
        <ShortcutChord chord="⌘→" />{' '}
        <ShortcutChord chord="⌘↑" />{' '}
        <ShortcutChord chord="⌘↓" /> {t('agents.swarmHelpNavigate')}
      </p>
    </div>
  )

  return (
    <div className={`cli-agent-picker${compact ? ' is-compact' : ''}`}>
      {agents.length === 0 ? (
        <p className="cli-agent-picker-empty">{t('agents.empty')}</p>
      ) : (
        <div className="cli-agent-picker-block">
          <div className="cli-agent-picker-rule" aria-hidden />
          <div
            className="cli-agent-picker-grid"
            role="listbox"
            aria-label={t('agents.pickCliTitle')}
            aria-activedescendant={
              agents[activeIndex] ? `cli-picker-opt-${tabId ?? 'root'}-${agents[activeIndex]!.id}` : undefined
            }
            onKeyDown={onGridKeyDown}
          >
            {agents.map((agent, index) => (
              <button
                key={agent.id}
                id={`cli-picker-opt-${tabId ?? 'root'}-${agent.id}`}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={isActivePane && index === activeIndex ? 0 : -1}
                className={`cli-agent-picker-item${index === activeIndex ? ' is-keyboard-active' : ''}`}
                onClick={() => onPick(agent.id)}
                onFocus={() => {
                  setActiveIndex(index)
                  setUiFocusScope('agent')
                }}
              >
                <span className="cli-agent-picker-icon" aria-hidden>
                  <AgentBrandMark agent={agent} size={compact ? 24 : 28} />
                </span>
                <span className="cli-agent-picker-item-name">{agent.name}</span>
              </button>
            ))}
          </div>
          <div className="cli-agent-picker-rule" aria-hidden />
        </div>
      )}
      {help}
    </div>
  )
}

/**
 * Focus the first CLI agent option inside a pending pane (by tab id), or any
 * active picker in the conversation. Used after split / close so keyboard
 * control continues without a mouse click.
 */
export function focusCliAgentPickerFirstOption(_conversationId: string, tabId?: string): void {
  const apply = (attempt: number): void => {
    const root = tabId
      ? document.querySelector(
          `[data-cli-pane="${CSS.escape(tabId)}"]:not(.is-surface-parked) .cli-agent-picker`
        )
      : document.querySelector(
          `.terminal-host-main:not(.is-surface-parked) [data-terminal-surface="agent"] .cli-agent-picker`
        )
    const first = root?.querySelector('.cli-agent-picker-item') as HTMLButtonElement | null
    if (!first) {
      if (attempt < 12) requestAnimationFrame(() => apply(attempt + 1))
      return
    }
    // Sibling TerminalHost fit/focus can win a frame later after ⌘D — reclaim.
    if (document.activeElement !== first && attempt < 12) {
      setUiFocusScope('agent')
      try {
        first.focus({ preventScroll: true })
      } catch {
        first.focus()
      }
      requestAnimationFrame(() => apply(attempt + 1))
      return
    }
    setUiFocusScope('agent')
    try {
      first.focus({ preventScroll: true })
    } catch {
      first.focus()
    }
  }
  requestAnimationFrame(() => apply(0))
}
