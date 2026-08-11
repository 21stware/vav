import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from './state/sessionStore'
import {
  installCompactionsBridge,
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge, useWorkspaceStore } from './state/workspaceStore'
import { AgentModeChrome, SessionDetail } from './components/SessionDetail'
import { useAppearance } from './lib/appearance'
import { useTerminalAppearance } from './lib/useTerminalAppearance'
import { useMenuCommands } from './lib/menuCommands'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { useT } from './i18n/useT'

/** Open clock from main (requestedAt) for [session-perf] logs. */
let sessionOpenClock = 0

function markSession(label: string): void {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const sinceOpen =
    sessionOpenClock > 0 ? ` +${Math.round(Date.now() - sessionOpenClock)}ms` : ''
  console.info(`[session-perf] ${label}${sinceOpen} t=${now.toFixed(1)}`)
}

/**
 * One conversation, in its own window.
 *
 * Same transcript, tools and composer as the main window with the sidebar and
 * its chrome taken away — this window exists to hold a single session, so it
 * has nothing to navigate between. Agent switcher / search / splits sit in the
 * title bar; top-right Reveal in List jumps back to the main window row.
 *
 * Warm shells load with `warm=1` and no conversationId, then receive
 * `onSessionNavigate` to claim a session without reloading the BrowserWindow.
 */
export default function SessionWindow({
  conversationId: initialConversationId
}: {
  conversationId: string
}): React.JSX.Element {
  const t = useT()
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const warmBoot = params.get('warm') === '1' || !initialConversationId
  const collapseToolsBoot = params.get('collapseTools') === '1'
  const emptyBoot = params.get('empty') === '1'
  const requestedAtBoot = Number(params.get('requestedAt')) || 0

  const [conversationId, setConversationId] = useState(initialConversationId || '')
  const focusGenRef = useRef(0)
  const coldClaimedRef = useRef(false)

  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const conversation = useSessionStore((s) =>
    conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined
  )
  const agentBinaryName = conversation?.agentBinaryName ?? null
  // Same source of truth as SessionDetail / AgentModeChrome: Screen cliMode,
  // not agentBinaryName (that only names the focused pane's CLI type).
  const isVavMode = useWorkspaceStore((s) => {
    if (!conversationId) return true
    return !s.workspaces[conversationId]?.cliMode
  })

  // CLI Screen splits: any pane tree on the unified surface (not per-agent host).
  const showSplits = useWorkspaceStore((s) => {
    if (!conversationId) return false
    const ws = s.workspaces[conversationId]
    if (!ws?.cliMode) return false
    const surface =
      ws.agentHostSessions['__cli__'] ??
      (ws.activeHostAgentId ? ws.agentHostSessions[ws.activeHostAgentId] : null)
    return Boolean(surface?.layout && (surface.tabs?.length ?? 0) > 0)
  })

  const scheduleFocus = (reason: string): void => {
    const gen = ++focusGenRef.current
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (gen !== focusGenRef.current) return
        useSessionStore.getState().focusComposer()
        markSession(reason)
      })
    })
  }

  useEffect(() => {
    if (requestedAtBoot > 0) sessionOpenClock = requestedAtBoot
    markSession(warmBoot ? 'boot:warm-start' : 'boot:cold-start')

    // Light bootstrap: settings only — skip updates.getState. Hydrate via claim.
    void bootstrap(initialConversationId || undefined, { light: true }).then(() => {
      markSession('boot:ready')
      // Cold URL path: claim from listMeta (create already ran on main).
      if (initialConversationId && !coldClaimedRef.current) {
        coldClaimedRef.current = true
        const store = useSessionStore.getState()
        const meta = store.conversations.find((c) => c.id === initialConversationId)
        if (meta) {
          store.claimDetachedSession(meta, {
            empty: emptyBoot,
            collapseTools: collapseToolsBoot
          })
          markSession('boot:cold-claimed')
          scheduleFocus('focus-composer-cold')
        }
      }
      window.vav.window.sessionShellReady?.()
      markSession('boot:shell-ready-sent')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once per window
  }, [bootstrap, collapseToolsBoot, emptyBoot, initialConversationId, requestedAtBoot, warmBoot])

  useEffect(() => {
    const off = window.vav.window.onSessionNavigate?.((payload) => {
      if (payload.requestedAt) sessionOpenClock = payload.requestedAt
      markSession(`navigate:${payload.openSeq}`)

      if (!payload.conversationId) {
        // Park into warm idle — keep ready, drop active session.
        focusGenRef.current += 1
        useSessionStore.getState().releaseDetachedSession()
        setConversationId('')
        markSession('navigate:parked')
        return
      }

      if (payload.meta) {
        useSessionStore.getState().claimDetachedSession(payload.meta, {
          empty: payload.empty === true,
          collapseTools: payload.collapseTools
        })
      }
      setConversationId(payload.conversationId)
      markSession('navigate:claimed')
      scheduleFocus('focus-composer')
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable subscribe
  }, [])

  useEffect(() => {
    const offTurn = installTurnEventBridge()
    const offFs = installFsWatchBridge()
    const offPty = installPtyBridge()
    const offSettings = installSettingsBridge()
    const offCompactions = installCompactionsBridge()
    const offWindow = installWindowBridge()
    const offUpdates = installUpdateBridge()
    const offMenu = installDefaultContextMenu()
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offCompactions()
      offWindow()
      offUpdates()
      offMenu()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  // Full shortcut surface — not just focus-composer (detached windows used to
  // drop ⌘⇧E / Ctrl+` once a CLI agent host stole keyboard focus).
  useMenuCommands()

  const title = useMemo(() => {
    const name = (conversation?.title || '').trim()
    return name || t('common.session')
  }, [conversation?.title, t])

  useEffect(() => {
    document.title = title
  }, [title])

  // Match early HTML/native wash while bootstrap runs — avoids a white flash
  // on ⌘⇧↵ before appearance CSS applies.
  if (!ready) {
    return <div className="app-shell session-window session-window-booting" />
  }

  // Warm pool idle — shell alive, no session UI until navigate claims one.
  if (!conversationId) {
    return (
      <div className="app-shell session-window session-window-booting" data-warm="1" />
    )
  }

  // Change review is inline in the transcript (not a full-screen takeover).
  return (
    <div className="app-shell session-window">
      {/*
        Title bar: traffic lights + agent switcher / search / splits, then
        Reveal in List. Agent chrome used to sit under this bar and felt like
        a second toolbar.
      */}
      <header className="titlebar bare session-window-titlebar">
        <div className="session-window-titlebar-chrome">
          <AgentModeChrome
            conversationId={conversationId}
            agentBinaryName={agentBinaryName}
            showSplits={showSplits}
            showSearch={isVavMode}
          />
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="session-reveal-in-list"
          title={t('session.revealInList')}
          onClick={() => {
            const api = window.vav?.window?.revealInList
            if (typeof api !== 'function') {
              console.error('[session] revealInList unavailable — rebuild preload')
              return
            }
            void api(conversationId)
          }}
        >
          {t('session.revealInList')}
        </button>
      </header>
      <SessionDetail hideChrome />
    </div>
  )
}
