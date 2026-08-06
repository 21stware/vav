import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, Clock, Columns2, Plus, Rows2, Search } from 'lucide-react'
import { buildWorkspaceFocusContext } from '@shared/agentContextInject'
import { DEFAULT_CLI_AGENTS, enabledCliAgents, type AgentConfig } from '@shared/types'
import type { FileSessionMeta } from '@shared/ipc'
import { handoffFocusToCli } from '../lib/cliFocusHandoff'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { SessionHistoryPopover } from './SessionHistoryPopover'
import { TerminalPanel } from './TerminalPanel'
import { ToolsPanel } from './ToolsPanel'
import { Composer, ComposerContext } from './Composer'
import { Transcript } from './Transcript'
import { SearchStrip } from './SearchStrip'
import { PlanOverlay } from './PlanOverlay'
import { ErrorBanner } from './ErrorBanner'
import { AgentInstallPanel } from './AgentInstallPanel'
import { AgentBrandMark } from './AgentBrandMark'
import { teardownInlineTerminal } from './InlineTerminal'
import { Button, EmptyState } from './ui'
import { ShellLeadingControls } from './ShellLeadingControls'
import {
  clearAgentBinaryCache,
  getAgentBinaryCache,
  markAgentBinaryMissing,
  markAgentBinaryReady
} from '../lib/agentBinaryCache'
import { applyTerminalAppearance, disposeTerminal } from '../lib/terminalRegistry'
import { useT } from '../i18n/useT'
import { keys } from '../lib/platform'
import { useSidebarFloatMode } from '../lib/sidebarLayout'

function isCompanionSessionShell(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'session'
  } catch {
    return false
  }
}

/**
 * - `main`: full session surface (sidebar → open conversation)
 * - `workspace`: agent column inside WorkspaceView (same dual-mode switcher)
 * - `preview-edit`: file-preview agent drawer — same agent switcher as main
 */
type SessionDetailVariant = 'main' | 'workspace' | 'preview-edit'

/** Single-file drawer chrome folded into the agent row (vav mode only). */
export type FileSessionChromeProps = {
  title: string
  sessions: FileSessionMeta[]
  activeSessionId: string | null
  historyOpen: boolean
  historyAnchorRef: RefObject<HTMLButtonElement | null>
  onToggleHistory: () => void
  onCloseHistory: () => void
  onSwitchSession: (id: string) => void
  onRenameSession: (id: string, title: string) => Promise<void>
  onDeleteSessions: (ids: string[]) => void
  onNewSession: () => void
}

/** CLI host gate: no dedicated "checking" UI — resolve silently or restore. */
type AgentProbe = 'idle' | 'missing' | 'installing' | 'ready' | 'rechecking'

/**
 * Hybrid product model:
 *
 * - **vav** (default): built-in agent — transcript + tools + composer
 * - **Claude Code / Codex / Grok / …**: CLI terminal host — multi-split PTY
 *   Sessions are parked per agent (not destroyed on switch). CLI mode always
 *   paints the terminal optimistically; install panel only after spawn fails.
 */
export function SessionDetail({
  variant = 'main',
  fileSessionChrome,
  /** Companion session window: chrome lives in the title bar, not under it. */
  hideChrome = false
}: {
  variant?: SessionDetailVariant
  /** File-preview: session name / history / new in the same row as agent + search. */
  fileSessionChrome?: FileSessionChromeProps | null
  hideChrome?: boolean
}): React.JSX.Element {
  const t = useT()
  const searchOpen = useSessionStore((s) => s.search.open)
  const errorBanner = useSessionStore((s) => s.errorBanner)
  const setErrorBanner = useSessionStore((s) => s.setErrorBanner)
  const openSettings = useSessionStore((s) => s.openSettings)
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const settings = useSessionStore((s) => s.settings)
  const pending = useSessionStore((s) => s.pendingReviewByConversation[s.activeId])
  const openChangeReview = useSessionStore((s) => s.openChangeReview)
  const detachedElsewhere = useSessionStore(
    (s) =>
      !isCompanionSessionShell() &&
      s.detachedConversationIds.includes(s.activeId)
  )

  const previewEdit = variant === 'preview-edit'
  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)

  // null / "vav" → built-in chat; any other id → CLI host
  // Product: switching agent only replaces the transcript surface; the bottom
  // ToolsPanel (Files + Terminal) stays the same dock as vav mode.
  // File-preview drawer uses the same switcher (standalone file Agent sessions).
  const agentKey = conversation?.agentBinaryName ?? null
  const isVavMode = !agentKey || agentKey === 'vav'
  const showAgentSwitcher = true

  const agents = enabledCliAgents(settings.cliAgents)
  const activeAgent: AgentConfig | null =
    agentKey && agentKey !== 'vav'
      ? (agents.find((a) => a.id === agentKey) ?? {
          id: agentKey,
          name: agentKey,
          binaryPath: agentKey,
          defaultArgs: [],
          envVars: {},
          enabled: true
        })
      : null

  const [probe, setProbe] = useState<AgentProbe>('idle')
  const probeGen = useRef(0)
  const [installTabId, setInstallTabId] = useState<string | null>(null)
  const installTabRef = useRef<string | null>(null)

  /**
   * Ambient launch context (long form) for agents that accept system-prompt
   * files. Prompt paste uses a brief form + composer draft via handoffFocusToCli.
   */
  const buildLaunchContext = useCallback((): string | null => {
    const store = useSessionStore.getState()
    const focused =
      (store.contextFiles[activeId] ?? null) ||
      store.conversations.find((c) => c.id === activeId)?.focusedFilePath ||
      null
    const cards = store.commentCards[activeId] ?? []
    return buildWorkspaceFocusContext({
      focusedPath: focused,
      cards,
      style: 'ambient'
    })
  }, [activeId])

  const activateHost = useCallback(
    async (
      agentId: string,
      withLaunchContext: boolean
    ): Promise<'restored' | 'created' | 'missing'> => {
      const launch = withLaunchContext ? buildLaunchContext() : null
      const result = await useWorkspaceStore
        .getState()
        .activateAgentHost(activeId, agentId, 80, 24, launch)
      if (result === 'created' || result === 'restored') {
        // Brief focus + vav composer draft → TUI input (no auto-submit).
        handoffFocusToCli(activeId, agentId, result)
      }
      return result
    },
    [activeId, buildLaunchContext]
  )

  const agentCandidates = useCallback((agent: AgentConfig): string[] => {
    const builtin = DEFAULT_CLI_AGENTS.find((a) => a.id === agent.id)
    return [
      ...new Set(
        [
          agent.binaryPath,
          ...(agent.binaryCandidates ?? []),
          builtin?.binaryPath,
          ...(builtin?.binaryCandidates ?? [])
        ].filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      )
    ]
  }, [])

  const hasLiveAgentSession = useCallback(
    (agentId: string): boolean => {
      const ws = useWorkspaceStore.getState().workspaces[activeId]
      if (!ws) return false
      const host = ws.agentHostSessions[agentId]
      if (!host?.layout || host.tabs.length === 0) return false
      return host.tabs.some((t) => t.agentId === agentId)
    },
    [activeId]
  )

  /**
   * Optimistic activate: paint the terminal host immediately, spawn/restore,
   * and only fall back to the install panel if the binary is truly missing.
   * PATH resolve is not a gate — it was causing install-flash + slow load.
   */
  const checkAndActivate = useCallback(
    async (agent: AgentConfig, options?: { force?: boolean }): Promise<void> => {
      const gen = ++probeGen.current
      const force = options?.force === true
      const candidates = agentCandidates(agent)
      const ws = useWorkspaceStore.getState()

      // 1) Parked / live PTY — surface host synchronously, then attach (no PATH probe).
      if (!force && hasLiveAgentSession(agent.id)) {
        setProbe('ready')
        ws.focusAgentHost(activeId, agent.id)
        const result = await activateHost(agent.id, false)
        if (gen !== probeGen.current) return
        if (result === 'missing') {
          markAgentBinaryMissing(agent.id)
          setProbe('missing')
        } else {
          const cached = getAgentBinaryCache(agent.id)
          markAgentBinaryReady(
            agent.id,
            cached?.status === 'ready'
              ? cached.path
              : agent.binaryPath || candidates[0] || agent.id
          )
        }
        return
      }

      if (force) {
        clearAgentBinaryCache(agent.id)
      }

      // 2) Optimistic UI: terminal surface first (spawn is the source of truth).
      // Never gate on resolveBinary — install only after AGENT_NOT_FOUND.
      setProbe('ready')
      const result = await activateHost(agent.id, true)
      if (gen !== probeGen.current) return

      if (result === 'created' || result === 'restored') {
        const cached = getAgentBinaryCache(agent.id)
        const path =
          cached?.status === 'ready'
            ? cached.path
            : agent.binaryPath || candidates[0] || agent.id
        markAgentBinaryReady(agent.id, path)
        setProbe('ready')
        return
      }

      if (result === 'missing') {
        // Optional resolve for install panel hints (which binary name failed).
        if (force && window.vav.agents?.resolveBinary) {
          try {
            const path = await window.vav.agents.resolveBinary(candidates, true)
            if (gen !== probeGen.current) return
            if (path) {
              markAgentBinaryReady(agent.id, path)
              setProbe('ready')
              const retry = await activateHost(agent.id, true)
              if (gen !== probeGen.current) return
              if (retry === 'created' || retry === 'restored') return
            }
          } catch {
            // fall through to install
          }
        }
        markAgentBinaryMissing(agent.id)
        setProbe('missing')
        useWorkspaceStore.getState().parkAgentHost(activeId)
      }
    },
    [activeId, activateHost, agentCandidates, hasLiveAgentSession]
  )

  // Park CLI host when returning to vav; restore / optimistically spawn when
  // selecting a CLI agent. useLayoutEffect so probe=ready + focusAgentHost run
  // before paint — avoids a one-frame install flash when probe was still idle.
  useLayoutEffect(() => {
    if (isVavMode || !agentKey || agentKey === 'vav') {
      useWorkspaceStore.getState().parkAgentHost(activeId)
      setProbe('idle')
      return
    }
    const list = enabledCliAgents(useSessionStore.getState().settings.cliAgents)
    const agent: AgentConfig =
      list.find((a) => a.id === agentKey) ?? {
        id: agentKey,
        name: agentKey,
        binaryPath: agentKey,
        defaultArgs: [],
        envVars: {},
        enabled: true
      }

    // Terminal first. Install panel only after spawn fails with AGENT_NOT_FOUND.
    setProbe('ready')
    if (hasLiveAgentSession(agent.id)) {
      useWorkspaceStore.getState().focusAgentHost(activeId, agent.id)
    }
    void checkAndActivate(agent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when agent id changes
  }, [activeId, isVavMode, agentKey])

  // Agent-host split shortcuts only when CLI host is ready (not tools-tray bash).
  // ⌘W is owned by uiFocus / close-context (close pane when multi-split agent).
  useEffect(() => {
    if (isVavMode || probe !== 'ready') return
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.altKey) return
      const key = event.key.toLowerCase()
      const store = useWorkspaceStore.getState()
      if (key === 'd' && event.shiftKey) {
        event.preventDefault()
        void store.splitAgentHost(activeId, 80, 24, 'column')
        return
      }
      if (key === 'd' && !event.shiftKey) {
        event.preventDefault()
        void store.splitAgentHost(activeId, 80, 24, 'row')
        return
      }
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        void store.splitAgentHost(activeId, 80, 24)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, previewEdit, isVavMode, probe])

  // Install-inline PTY — hooks must stay above every early return (Rules of Hooks).
  const teardownInstallPty = useCallback((): void => {
    const tabId = installTabRef.current
    installTabRef.current = null
    setInstallTabId(null)
    if (!tabId) return
    teardownInlineTerminal(activeId, tabId)
  }, [activeId])

  const cancelInstall = useCallback((): void => {
    teardownInstallPty()
    setProbe('missing')
  }, [teardownInstallPty])

  useEffect(() => () => teardownInstallPty(), [teardownInstallPty])

  const runInstallInShell = useCallback(async (): Promise<void> => {
    if (!activeAgent?.installCommand) return
    teardownInstallPty()

    const ws = useWorkspaceStore.getState()
    const slice = ws.workspaces[activeId]
    const appSettings = await window.vav.settings.get()
    const metas = await window.vav.conversations.list()
    const meta = metas.find((c) => c.id === activeId)
    let cwd =
      (slice?.root && slice.root !== '~' ? slice.root : null) ??
      (meta?.workingDirectory && meta.workingDirectory !== '~' ? meta.workingDirectory : null) ??
      (appSettings.defaultWorkingDirectory?.trim() || null)
    if (!cwd) {
      const boot = await window.vav.bootstrap()
      cwd = boot.home || boot.tmp || '/'
    }

    const cmd = activeAgent.installCommand.trim()
    let tabId: string
    try {
      tabId = await window.vav.pty.create(activeId, cwd, 100, 28)
    } catch {
      setProbe('missing')
      return
    }
    installTabRef.current = tabId
    setInstallTabId(tabId)
    setProbe('installing')

    window.setTimeout(() => {
      window.vav.pty.write(tabId, `${cmd}\r`)
    }, 280)
  }, [activeAgent, activeId, teardownInstallPty])

  const finishInstallAndRecheck = useCallback(async (): Promise<void> => {
    if (!activeAgent) return
    teardownInstallPty()
    await checkAndActivate(activeAgent, { force: true })
  }, [activeAgent, checkAndActivate, teardownInstallPty])

  /**
   * While the install shell is open, poll login PATH for the agent binary.
   * When it appears (install finished / user PATH updated), activate automatically —
   * no manual “done — recheck” confirm.
   */
  useEffect(() => {
    if (probe !== 'installing' || !activeAgent || !installTabId) return
    let cancelled = false
    let timer = 0
    const candidates = agentCandidates(activeAgent)

    const tick = async (): Promise<void> => {
      if (cancelled) return
      // Prefer a quick recheck right after the foreground install process exits.
      try {
        const busy = await window.vav.pty.isBusy(installTabId)
        if (cancelled) return
        if (!busy) {
          const path = window.vav.agents?.resolveBinary
            ? await window.vav.agents.resolveBinary(candidates, true)
            : null
          if (cancelled) return
          if (path) {
            await finishInstallAndRecheck()
            return
          }
        } else {
          // Still installing — also try resolve periodically (some installers
          // leave a parent shell busy while the binary is already on PATH).
          const path = window.vav.agents?.resolveBinary
            ? await window.vav.agents.resolveBinary(candidates, true)
            : null
          if (cancelled) return
          if (path) {
            await finishInstallAndRecheck()
            return
          }
        }
      } catch {
        // ignore transient probe failures
      }
      if (cancelled) return
      timer = window.setTimeout(() => void tick(), 1600)
    }

    // Give the install command a moment to start before first probe.
    timer = window.setTimeout(() => void tick(), 1200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [probe, activeAgent, installTabId, agentCandidates, finishInstallAndRecheck])

  // Companion window owns the live agent PTY. Main shell must not keep a second
  // xterm attached (shared PTY has one geometry). Hook must stay above returns.
  useEffect(() => {
    if (!detachedElsewhere || !activeId) return
    const ws = useWorkspaceStore.getState().workspaces[activeId]
    const agentId = ws?.activeHostAgentId
    const host = agentId ? ws?.agentHostSessions[agentId] : null
    for (const tab of host?.tabs ?? []) {
      disposeTerminal(activeId, tab.id)
    }
  }, [detachedElsewhere, activeId])

  // Find only covers the built-in chat transcript — not xterm / CLI agents.
  // Drop a leftover strip when switching to a Coding/Bash agent host.
  useEffect(() => {
    if (!isVavMode && useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
  }, [isVavMode])

  // Main shell only: when the list is not a docked left column, park toggle +
  // new-session ahead of the agent select (no separate window titlebar).
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading =
    variant === 'main' && !(sidebarVisible && !sidebarFloating)

  const chrome =
    showAgentSwitcher && !hideChrome ? (
      <AgentModeChrome
        conversationId={activeId}
        agentBinaryName={agentKey}
        showSplits={!isVavMode && probe === 'ready'}
        showSearch={isVavMode}
        showShellLeading={showShellLeading}
        fileSessionChrome={previewEdit && isVavMode ? fileSessionChrome ?? null : null}
      />
    ) : null

  // —— Built-in vav agent (chat workstation) ——
  if (isVavMode) {
    // File-preview drawer: tighter chrome, no Plan overlay, preview tools tray.
    if (previewEdit) {
      return (
        <main className="preview-edit-session">
          {chrome}
          {errorBanner && (
            <ErrorBanner
              message={errorBanner}
              actionLabel={isKeyProblem ? t('error.openSettings') : undefined}
              onAction={isKeyProblem ? () => openSettings('api') : undefined}
              onDismiss={() => setErrorBanner(null)}
            />
          )}
          <div className="preview-edit-stream" data-search={searchOpen}>
            {searchOpen && <SearchStrip />}
            <Transcript />
            {/* Bubbles eat log space only — dock height stays put. */}
            <ComposerContext conversationId={activeId} />
          </div>
          <div className="preview-edit-dock dock">
            <Composer conversationId={activeId} />
            <ToolsPanel variant="preview-edit" />
          </div>
        </main>
      )
    }
    const shellClass =
      variant === 'workspace' ? 'detail session-detail-workspace' : 'detail'
    return (
      <main className={shellClass}>
        {chrome}
        {errorBanner && (
          <ErrorBanner
            message={errorBanner}
            actionLabel={isKeyProblem ? t('error.openSettings') : undefined}
            onAction={isKeyProblem ? () => openSettings('api') : undefined}
            onDismiss={() => setErrorBanner(null)}
          />
        )}
        {pending && pending.count > 0 && (
          <div className="banner review-pending">
            <span>{t('review.pendingBanner', { n: pending.count })}</span>
            <span className="spacer" />
            <Button
              label={t('review.openReview')}
              size="sm"
              variant="primary"
              onClick={() => {
                document
                  .getElementById(`inline-review-${pending.changeSetId}`)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                void openChangeReview(pending.changeSetId)
              }}
            />
          </div>
        )}
        <div className="detail-stream" data-search={searchOpen}>
          {searchOpen && <SearchStrip />}
          <PlanOverlay />
          <Transcript />
          {/* File / quote / comment bubbles resize only this column — not the
              tools tray or composer box (avoids jump while browsing Files). */}
          <ComposerContext conversationId={activeId} />
        </div>
        {/* Composer sits above the tools tray so the prompt stays next to the
            transcript; Files/Terminal expand downward from the dock. */}
        <div className="dock">
          <Composer conversationId={activeId} />
          <ToolsPanel variant="main" />
        </div>
      </main>
    )
  }

  // —— CLI agent: terminal host first; install only after confirmed missing ——
  const hostClass = [
    previewEdit ? 'preview-edit-session' : 'detail',
    'terminal-host-session',
    variant === 'workspace' ? 'session-detail-workspace' : ''
  ]
    .filter(Boolean)
    .join(' ')

  // Install only on hard failure / explicit install flow — never for idle/ready.
  // Previously idle (default) rendered the install card for one frame on switch.
  const showInstallGate =
    !!activeAgent &&
    (probe === 'missing' || probe === 'installing' || probe === 'rechecking')

  // Main surface (install gate or agent host) — Tools dock always stays.
  const mainSurface = detachedElsewhere ? (
    <div className="terminal-host-main terminal-host-stream detached-session-park">
      <EmptyState title={t('session.detachedTitle')} description={t('session.detachedDesc')}>
        <div className="detached-session-park-actions">
          <Button
            label={t('session.detachedTakeBack')}
            variant="secondary"
            size="sm"
            onClick={() => void window.vav.window.closeDetachedSession(activeId)}
          />
          <Button
            label={t('session.detachedFocus')}
            variant="primary"
            size="sm"
            onClick={() => void window.vav.window.openSession(activeId)}
          />
        </div>
      </EmptyState>
    </div>
  ) : showInstallGate && activeAgent ? (
    <div className="terminal-host-main terminal-host-stream">
      <AgentInstallPanel
        agent={activeAgent}
        conversationId={activeId}
        rechecking={probe === 'rechecking'}
        installing={probe === 'installing'}
        installTabId={installTabId}
        onRecheck={() => {
          teardownInstallPty()
          void checkAndActivate(activeAgent, { force: true })
        }}
        onInstallInShell={() => void runInstallInShell()}
        onCancelInstall={cancelInstall}
        onOpenDocs={() => {
          if (activeAgent.installDocsUrl) {
            window.open(activeAgent.installDocsUrl, '_blank', 'noopener,noreferrer')
          }
        }}
      />
    </div>
  ) : (
    <div className="terminal-host-main terminal-host-stream">
      <TerminalPanel visible surface="agent" />
    </div>
  )

  return (
    <main className={hostClass}>
      {chrome}
      {errorBanner && (
        <ErrorBanner
          message={errorBanner}
          actionLabel={isKeyProblem ? t('error.openSettings') : undefined}
          onAction={isKeyProblem ? () => openSettings('api') : undefined}
          onDismiss={() => setErrorBanner(null)}
        />
      )}
      {mainSurface}
      {/* Files + user bash tray — always present in CLI mode, even before install.
          No Composer above: `.dock-tools-only` adds top air so the strip isn’t tight.
          File-preview drawer keeps the slim preview tools tray (terminal-first). */}
      <div className={`dock dock-tools-only${previewEdit ? ' preview-edit-dock' : ''}`}>
        <ToolsPanel variant={previewEdit ? 'preview-edit' : 'main'} />
      </div>
    </main>
  )
}

/**
 * Agent switcher — same visual language as sidebar "group by workspace" select.
 * No redundant "Agent" label; value alone is the control.
 */
export function AgentModeChrome({
  conversationId,
  agentBinaryName,
  showSplits = false,
  /** Transcript find only — hide for CLI / terminal hosts (no chat stream). */
  showSearch = true,
  /** Sidebar collapsed / floating: toggle + new ahead of the agent select. */
  showShellLeading = false,
  /** Single-file vav: session name + history + new in this same chrome row. */
  fileSessionChrome = null
}: {
  conversationId: string
  agentBinaryName: string | null
  showSplits?: boolean
  showSearch?: boolean
  showShellLeading?: boolean
  fileSessionChrome?: FileSessionChromeProps | null
}): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const agents = enabledCliAgents(settings.cliAgents)
  const value =
    !agentBinaryName || agentBinaryName === 'vav' ? 'vav' : agentBinaryName
  const active =
    value === 'vav'
      ? { id: 'vav', name: t('agents.plainShell') }
      : (agents.find((a) => a.id === value) ?? {
          id: value,
          name: value
        })

  const setMode = async (id: string): Promise<void> => {
    const nextId = id === 'vav' ? null : id
    // Leaving chat → terminal: close find so the strip does not linger.
    if (nextId && useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
    const store = useSessionStore.getState()
    let targetId = conversationId
    if (!targetId) {
      // Empty chat shell — mint a session before switching agent host.
      await store.createConversation()
      targetId = useSessionStore.getState().activeId
      if (!targetId) return
    }
    // Via store so file-preview sessions (hidden from listMeta) keep their
    // agentBinaryName instead of being wiped by a raw list replace.
    await useSessionStore.getState().setAgentBinaryName(targetId, nextId)
  }

  const displayName = active.name
  const searchOpen = useSessionStore((s) => s.search.open)
  const openSearch = useSessionStore((s) => s.openSearch)
  const closeSearch = useSessionStore((s) => s.closeSearch)
  const fs = fileSessionChrome

  return (
    <div
      className={`terminal-host-chrome agent-mode-chrome${fs ? ' has-file-session' : ''}${showShellLeading ? ' has-shell-leading' : ''}`}
    >
      {showShellLeading ? (
        <div className="agent-mode-shell-leading">
          <ShellLeadingControls />
        </div>
      ) : null}

      {/* Icon + name are one control; native <select> covers the whole face. */}
      <label className="agent-mode-select" title={t('agents.switchHint')}>
        <span className="agent-mode-select-face" aria-hidden>
          <AgentBrandMark agent={active} size={20} />
          <span className="agent-mode-select-name">{displayName}</span>
          <ChevronDown className="agent-mode-select-chevron" size={12} />
        </span>
        <select
          className="agent-mode-select-native"
          value={value}
          onChange={(e) => void setMode(e.target.value)}
          aria-label={t('agents.selector')}
        >
          <option value="vav">{t('agents.plainShell')}</option>
          {agents
            .filter((a) => !!a.id && !!a.name)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>

      {fs ? (
        <span className="agent-mode-session-title" title={fs.title}>
          {fs.title || t('common.session')}
        </span>
      ) : null}

      <span className="spacer" />

      {showSplits ? (
        <>
          <Button
            icon={<Columns2 size={13} />}
            size="sm"
            variant="ghost"
            title={`${t('agents.splitRight')} (${keys('⌘D')})`}
            onClick={() =>
              void useWorkspaceStore.getState().splitAgentHost(conversationId, 80, 24, 'row')
            }
          />
          <Button
            icon={<Rows2 size={13} />}
            size="sm"
            variant="ghost"
            title={`${t('agents.splitDown')} (${keys('⌘⇧D')})`}
            onClick={() =>
              void useWorkspaceStore
                .getState()
                .splitAgentHost(conversationId, 80, 24, 'column')
            }
          />
        </>
      ) : null}

      {fs ? (
        <div className="agent-mode-file-actions">
          <button
            type="button"
            ref={fs.historyAnchorRef}
            className={`btn ghost sm icon-only${fs.historyOpen ? ' is-active-toggle' : ''}`}
            title={t('preview.sessionHistory')}
            onClick={fs.onToggleHistory}
          >
            <Clock size={12} />
          </button>
          <Button
            icon={<Plus size={12} />}
            size="sm"
            variant="ghost"
            title={t('preview.newSession')}
            onClick={fs.onNewSession}
          />
        </div>
      ) : null}

      {/* Find only works on the built-in chat transcript — not CLI / bash PTYs. */}
      {showSearch ? (
        <Button
          icon={<Search size={13} />}
          size="sm"
          variant="ghost"
          title={`${t('common.search')} ${keys('⌘F')}`}
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
        />
      ) : null}

      {/* History panel is a child of the full chrome row so left/right:8px spans
          the agent panel — not the narrow clock/+ cluster (that became a stick). */}
      {fs ? (
        <SessionHistoryPopover
          open={fs.historyOpen}
          onClose={fs.onCloseHistory}
          sessions={fs.sessions}
          activeSessionId={fs.activeSessionId}
          onSwitch={(id) => {
            fs.onSwitchSession(id)
            fs.onCloseHistory()
          }}
          onRename={fs.onRenameSession}
          onDelete={fs.onDeleteSessions}
          anchorRef={fs.historyAnchorRef}
        />
      ) : null}
    </div>
  )
}

export function useTerminalAppearance(): void {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)

  useEffect(() => {
    applyTerminalAppearance(codeFont, Math.max(9, fontSize - 3))
  }, [codeFont, fontSize])
}

/** @deprecated Prefer `useMenuCommands` from `lib/menuCommands` (full surface). */
export { useMenuCommands as useSessionMenuCommands } from '../lib/menuCommands'
