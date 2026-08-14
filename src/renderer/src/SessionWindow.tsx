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

  /** Focus CLI pane or VAV composer based on hydrated cliMode (not always composer). */
  const scheduleSurfaceFocus = (conversationId: string, reason: string): void => {
    const gen = ++focusGenRef.current
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (gen !== focusGenRef.current) return
        void (async () => {
          if (gen !== focusGenRef.current) return
          const { applySessionSurfaceFocus } = await import('./lib/sessionFocus')
          const cli = useWorkspaceStore.getState().workspaces[conversationId]?.cliMode === true
          await applySessionSurfaceFocus({
            conversationId,
            toast: null,
            surface: cli ? 'cli' : 'vav'
          })
          if (gen === focusGenRef.current) markSession(reason)
        })()
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
          scheduleSurfaceFocus(initialConversationId, 'focus-surface-cold')
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
      scheduleSurfaceFocus(payload.conversationId, 'focus-surface-navigate')
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
    // Tray / notify: main may raise this companion and ask for CLI pane focus.
    const offCli = window.vav.onCliOpen((event) => {
      if (!event.conversationId) return
      // Only handle opens for this companion's session (or warm shell claiming).
      if (conversationId && event.conversationId !== conversationId) return
      void (async () => {
        if (!conversationId && event.conversationId) {
          setConversationId(event.conversationId)
        }
        // Cancel any pending composer-focus from navigate/reuse.
        focusGenRef.current += 1
        const { applySessionSurfaceFocus } = await import('./lib/sessionFocus')
        await applySessionSurfaceFocus(event)
        markSession(
          event.surface === 'cli' || event.tabId ? 'focus-cli-pane' : 'focus-composer-cliOpen'
        )
      })()
    })
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offCompactions()
      offWindow()
      offUpdates()
      offMenu()
      offCli()
    }
  }, [conversationId])

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
        Overlay chrome: traffic lights + agent switcher / search, then
        Reveal in List. The 40px row is a 30%-clear plate over the log;
        the first turn is inset below it and can still scroll underneath.
      */}
      <header className="titlebar bare session-window-titlebar">
        <div className="session-window-titlebar-chrome">
          <AgentModeChrome
            conversationId={conversationId}
            agentBinaryName={agentBinaryName}
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
