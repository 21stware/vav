import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { Clock, Plus, Search } from 'lucide-react'
import { buildWorkspaceFocusContext } from '@shared/agentContextInject'
import { DEFAULT_CLI_AGENTS, enabledCliAgents, type AgentConfig } from '@shared/types'
import type { FileSessionMeta } from '@shared/ipc'
import { handoffFocusToCli } from '../lib/cliFocusHandoff'
import {
  arrowKeyToPaneDirection,
  findNeighborPane,
  focusedCliPaneId,
  measureCliPaneRects
} from '../lib/cliPaneNavigate'
import { focusAgentPane } from '../lib/uiFocus'
import { focusCliAgentPickerFirstOption } from './CliAgentPicker'
import { useSessionStore } from '../state/sessionStore'
import { CLI_SURFACE_KEY, useWorkspaceStore } from '../state/workspaceStore'
import { SessionHistoryPopover } from './SessionHistoryPopover'
import { TerminalPanel } from './TerminalPanel'
import { ToolsPanel } from './ToolsPanel'
import { Composer, ComposerContext } from './Composer'
import { Transcript } from './Transcript'
import { SearchStrip } from './SearchStrip'
import { PlanOverlay } from './PlanOverlay'
import { ErrorBanner } from './ErrorBanner'
import { AgentInstallPanel } from './AgentInstallPanel'
import { teardownInlineTerminal } from './InlineTerminal'
import { Button, EmptyState } from './ui'
import { ShellLeadingControls } from './ShellLeadingControls'
import {
  clearAgentBinaryCache,
  getAgentBinaryCache,
  markAgentBinaryMissing,
  markAgentBinaryReady
} from '../lib/agentBinaryCache'
import { parkTerminal } from '../lib/terminalRegistry'
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

/** Split CLI Screen and move keyboard focus to the new pane’s first agent. */
function splitCliAndFocusPicker(
  conversationId: string,
  axis: 'row' | 'column'
): void {
  if (!conversationId) return
  useWorkspaceStore.getState().splitCliSurface(conversationId, axis)
  const host =
    useWorkspaceStore.getState().workspaces[conversationId]?.agentHostSessions[
      CLI_SURFACE_KEY
    ]
  const pendingId = host?.activeTabId
  if (!pendingId) return
  // Prefer pane-scoped focus (retries across paint). Also nudge the picker
  // button so ←/→ works even if a sibling TerminalHost raced for focus.
  focusAgentPane(conversationId, pendingId)
  focusCliAgentPickerFirstOption(conversationId, pendingId)
}

/**
 * - `main`: full session surface (sidebar → open conversation)
 * - `workspace`: agent column inside WorkspaceView (same dual-mode switcher)
 * - `preview-edit`: file-preview agent drawer — same agent switcher as main
 */
type SessionDetailVariant = 'main' | 'workspace' | 'preview-edit'

/**
 * Session chrome folded into the agent row (file-preview vav, or workspace).
 * Optional `trail` is for workspace-only controls (e.g. preview drawer toggle).
 */
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
  /** Trailing controls after search (workspace preview toggle, etc.). */
  trail?: ReactNode
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
  /** File-preview / workspace: session name / history / new in the agent row. */
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

  // VAV chat vs CLI Screen is solely cliMode. agentBinaryName only tracks the
  // focused pane's CLI type for install/prompt handoff — not surface identity.
  const agentKey = conversation?.agentBinaryName ?? null
  const cliMode = useWorkspaceStore((s) => !!s.workspaces[activeId]?.cliMode)
  const isVavMode = !cliMode
  const showAgentSwitcher = true

  const agents = enabledCliAgents(settings.cliAgents)
  const activeAgent: AgentConfig | null =
    agentKey && agentKey !== 'vav' && agentKey !== '__cli__'
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
        // Stay on CLI Screen when already there (install gate paints in-screen).
        // Never park→sync cliMode false here — that raced hydrate and bounced
        // detached opens back to VAV.
        const slice = useWorkspaceStore.getState().workspaces[activeId]
        if (!slice?.cliMode) {
          useWorkspaceStore.getState().parkAgentHost(activeId)
        }
      }
    },
    [activeId, activateHost, agentCandidates, hasLiveAgentSession]
  )

  // Screen mode is owned by workspace.cliMode (hydrated from main layouts).
  //
  // Do NOT park when cliMode is false: false means either "user chose VAV" or
  // "hydrate not finished yet". Auto-parking on false was racing openDetached /
  // session switch and writing cliMode=false into main, so double-click open
  // always bounced CLI sessions back to VAV.
  //
  // Only assert CLI surface once cliMode is already true (user or hydrate).
  useLayoutEffect(() => {
    if (!activeId) return
    if (isVavMode) {
      setProbe('idle')
      return
    }
    setProbe('ready')
    useWorkspaceStore.getState().enterCliMode(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, isVavMode])

  // CLI surface: ⌘D / ⌘⇧D split; ⌘←↑↓→ spatial pane focus.
  useEffect(() => {
    if (isVavMode) return
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.altKey) return

      const paneDir = arrowKeyToPaneDirection(event.key)
      if (paneDir) {
        const host =
          useWorkspaceStore.getState().workspaces[activeId]?.agentHostSessions[
            CLI_SURFACE_KEY
          ]
        if (!host || host.tabs.length < 2) return
        const panes = measureCliPaneRects()
        if (panes.length < 2) return
        // Prefer the pane that actually owns DOM focus (narrow vertical agent
        // lists often leave activeTabId stale after ←/→ inside the picker).
        const focused = focusedCliPaneId()
        const from =
          (focused && panes.some((p) => p.tabId === focused) ? focused : null) ||
          (host.activeTabId && panes.some((p) => p.tabId === host.activeTabId)
            ? host.activeTabId
            : null) ||
          panes[0]?.tabId ||
          ''
        if (!from) return
        const next = findNeighborPane(from, paneDir, panes)
        // Always consume ⌘+arrow in multi-pane Swarm so the picker list does
        // not treat it as in-list navigation when no geometric neighbor exists.
        event.preventDefault()
        event.stopPropagation()
        if (!next || next === from) return
        useWorkspaceStore.getState().selectAgentTab(activeId, next)
        focusAgentPane(activeId, next)
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'd' && event.shiftKey) {
        event.preventDefault()
        splitCliAndFocusPicker(activeId, 'column')
        return
      }
      if (key === 'd' && !event.shiftKey) {
        event.preventDefault()
        splitCliAndFocusPicker(activeId, 'row')
      }
    }
    // Capture so ⌘←/→ reach us before xterm treats them as line motion.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeId, previewEdit, isVavMode])

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

  // Companion window owns PTY geometry. Soft-park main's xterm (detach DOM,
  // keep buffer + live sink) so reclaim is instant when the companion closes —
  // never dispose/respawn (Herdr detach semantics). Hook must stay above returns.
  useEffect(() => {
    if (!detachedElsewhere || !activeId) return
    const ws = useWorkspaceStore.getState().workspaces[activeId]
    for (const host of Object.values(ws?.agentHostSessions ?? {})) {
      for (const tab of host.tabs) {
        parkTerminal(activeId, tab.id)
      }
    }
  }, [detachedElsewhere, activeId])

  // Find only covers the built-in chat transcript — not xterm / CLI agents.
  // Drop a leftover strip when switching to a Coding/Bash agent host.
  useEffect(() => {
    if (!isVavMode && useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
  }, [isVavMode])

  // Main / workspace: when the list is not a docked left column, park toggle +
  // new-session ahead of the agent select (no separate window titlebar).
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading =
    (variant === 'main' || variant === 'workspace') &&
    !(sidebarVisible && !sidebarFloating)

  // File-preview: session chrome only in vav (CLI keeps a separate session bar).
  // Workspace: always fold sessions into this row (vav + CLI).
  const chromeSession =
    variant === 'workspace' || (previewEdit && isVavMode)
      ? (fileSessionChrome ?? null)
      : null

  const chrome =
    showAgentSwitcher && !hideChrome ? (
      <AgentModeChrome
        conversationId={activeId}
        agentBinaryName={agentKey}
        showSearch={isVavMode}
        showShellLeading={showShellLeading}
        fileSessionChrome={chromeSession}
      />
    ) : null

  // Install only on hard failure / explicit install flow — never for idle/ready.
  const showInstallGate =
    !!activeAgent &&
    (probe === 'missing' || probe === 'installing' || probe === 'rechecking')

  const shellClass = [
    previewEdit ? 'preview-edit-session' : 'detail',
    !isVavMode ? 'terminal-host-session' : '',
    variant === 'workspace' ? 'session-detail-workspace' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const streamClass = previewEdit ? 'preview-edit-stream' : 'detail-stream'
  const toolsVariant = previewEdit ? 'preview-edit' : 'main'
  const swarmVisible = !isVavMode && !detachedElsewhere && !showInstallGate

  /*
   * Thread and Swarm stay mounted across switches. Park with `.is-surface-parked`
   * (`display: none !important`) — HTML `hidden` loses to our `display: flex`
   * rules and was painting the Swarm picker over Thread.
   */
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

      {!previewEdit && pending && pending.count > 0 && isVavMode && (
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

      <div
        className={`${streamClass}${!isVavMode ? ' is-surface-parked' : ''}`}
        data-search={searchOpen}
        aria-hidden={!isVavMode}
        inert={!isVavMode ? true : undefined}
      >
        {searchOpen && isVavMode && <SearchStrip />}
        {!previewEdit && <PlanOverlay />}
        <Transcript />
        <ComposerContext conversationId={activeId} />
      </div>

      <div
        className={`terminal-host-main terminal-host-stream${
          isVavMode ? ' is-surface-parked' : ''
        }`}
        aria-hidden={isVavMode}
        inert={isVavMode ? true : undefined}
      >
        {detachedElsewhere ? (
          <div className="detached-session-park">
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
        ) : null}
        {showInstallGate && activeAgent && !detachedElsewhere ? (
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
        ) : null}
        {/* Keep agent xterms mounted across Thread↔Swarm and install overlays. */}
        <div
          className={`terminal-host-agent-keep${
            detachedElsewhere || showInstallGate ? ' is-surface-parked' : ''
          }`}
        >
          <TerminalPanel visible={swarmVisible} surface="agent" />
        </div>
      </div>

      <div
        className={`dock${previewEdit ? ' preview-edit-dock' : ''}${
          !isVavMode ? ' dock-tools-only' : ''
        }`}
      >
        <div
          className={!isVavMode ? 'is-surface-parked' : undefined}
          aria-hidden={!isVavMode}
          inert={!isVavMode ? true : undefined}
        >
          <Composer conversationId={activeId} />
        </div>
        <ToolsPanel variant={toolsVariant} />
      </div>
    </main>
  )
}

/**
 * Agent chrome: VAV built-in | structured CLI host | raw Terminal screen.
 * Structured hosts share Transcript/Composer with VAV; Terminal is the PTY UI.
 */
export function AgentModeChrome({
  conversationId,
  agentBinaryName: _agentBinaryName,
  /** Transcript find only — hide for raw terminal hosts (no chat stream). */
  showSearch = true,
  /** Sidebar collapsed / floating: toggle + new ahead of the agent select. */
  showShellLeading = false,
  /** Single-file vav: session name / history / new in this same chrome row. */
  fileSessionChrome = null
}: {
  conversationId: string
  agentBinaryName: string | null
  showSearch?: boolean
  showShellLeading?: boolean
  fileSessionChrome?: FileSessionChromeProps | null
}): React.JSX.Element {
  const t = useT()
  const cliMode = useWorkspaceStore((s) => !!s.workspaces[conversationId]?.cliMode)
  const isTerminal = cliMode
  const isChat = !cliMode
  void _agentBinaryName

  const ensureConversation = async (): Promise<string | null> => {
    let targetId = conversationId
    if (!targetId) {
      await useSessionStore.getState().createConversation()
      targetId = useSessionStore.getState().activeId
    }
    return targetId || null
  }

  /** Leave Terminal / PTY and return to Composer + Transcript. */
  const openChatMode = async (): Promise<void> => {
    if (useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
    const targetId = await ensureConversation()
    if (!targetId) return
    // Single patch + layout sync (includes bash-tab park).
    useWorkspaceStore.getState().exitCliMode(targetId)
  }

  /** Raw PTY screen — restores existing Screen if present, else picker pane. */
  const openTerminalMode = async (): Promise<void> => {
    if (useSessionStore.getState().search.open) {
      useSessionStore.getState().closeSearch()
    }
    const targetId = await ensureConversation()
    if (!targetId) return
    useWorkspaceStore.getState().enterCliMode(targetId)
    // Leave the segment button — keyboard (←/→/Enter, xterm) needs the pane.
    focusAgentPane(targetId)
  }

  const searchOpen = useSessionStore((s) => s.search.open)
  const openSearch = useSessionStore((s) => s.openSearch)
  const closeSearch = useSessionStore((s) => s.closeSearch)
  const fs = fileSessionChrome

  const showFileSessionChrome = !!(fs && isChat && fs.sessions.length > 0)

  return (
    <div
      className={`terminal-host-chrome agent-mode-chrome${showFileSessionChrome ? ' has-file-session' : ''}${showShellLeading ? ' has-shell-leading' : ''}`}
    >
      <div className="agent-mode-chrome-row">
        {showShellLeading ? (
          <div className="agent-mode-shell-leading">
            <ShellLeadingControls />
          </div>
        ) : null}

        <div
          className="agent-mode-segment"
          role="group"
          aria-label={t('agents.surfaceSelector')}
          title={t('agents.switchHint')}
        >
          <button
            type="button"
            className={`agent-mode-segment-btn${isChat ? ' is-active' : ''}`}
            title={t('agents.chatModeHint')}
            onClick={() => void openChatMode()}
          >
            <span>{t('agents.chatMode')}</span>
          </button>
          <button
            type="button"
            className={`agent-mode-segment-btn${isTerminal ? ' is-active' : ''}`}
            title={t('agents.terminalModeHint')}
            onClick={() => void openTerminalMode()}
          >
            <span>{t('agents.terminalMode')}</span>
          </button>
        </div>

        {showFileSessionChrome ? (
          <span className="agent-mode-session-title" title={fs!.title}>
            {fs!.title || t('common.session')}
          </span>
        ) : null}

        {showFileSessionChrome ? (
          <div className="agent-mode-file-actions">
            <button
              type="button"
              ref={fs!.historyAnchorRef}
              className={`btn ghost sm icon-only${fs!.historyOpen ? ' is-active-toggle' : ''}`}
              title={t('preview.sessionHistory')}
              onClick={fs!.onToggleHistory}
            >
              <Clock size={12} />
            </button>
            <Button
              icon={<Plus size={12} />}
              size="sm"
              variant="ghost"
              title={t('preview.newSession')}
              onClick={fs!.onNewSession}
            />
          </div>
        ) : null}

        <span className="spacer" />

        {/* Search flush-right (before file-preview toggle). */}
        {showSearch && isChat ? (
          <Button
            icon={<Search size={13} />}
            size="sm"
            variant="ghost"
            title={`${t('common.search')} ${keys('⌘F')}`}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
          />
        ) : null}

        {/* Far-right pin: file preview (counterpart of left PanelLeft). */}
        {fs?.trail ? (
          <div className="agent-mode-chrome-trail agent-mode-chrome-trail-end">{fs.trail}</div>
        ) : null}
      </div>

      {showFileSessionChrome ? (
        <SessionHistoryPopover
          open={fs!.historyOpen}
          onClose={fs!.onCloseHistory}
          sessions={fs!.sessions}
          activeSessionId={fs!.activeSessionId}
          onSwitch={(id) => {
            fs!.onSwitchSession(id)
            fs!.onCloseHistory()
          }}
          onRename={fs!.onRenameSession}
          onDelete={fs!.onDeleteSessions}
          anchorRef={fs!.historyAnchorRef}
        />
      ) : null}
    </div>
  )
}
