import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Columns2, Rows2 } from 'lucide-react'
import { DEFAULT_CLI_AGENTS, enabledCliAgents, type AgentConfig } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { TerminalPanel } from './TerminalPanel'
import { ToolsPanel } from './ToolsPanel'
import { Composer } from './Composer'
import { Transcript } from './Transcript'
import { SearchStrip } from './SearchStrip'
import { PlanOverlay } from './PlanOverlay'
import { ErrorBanner } from './ErrorBanner'
import { AgentInstallPanel } from './AgentInstallPanel'
import { AgentBrandMark } from './AgentBrandMark'
import { teardownInlineTerminal } from './InlineTerminal'
import { Button } from './ui'
import {
  clearAgentBinaryCache,
  getAgentBinaryCache,
  markAgentBinaryMissing,
  markAgentBinaryReady
} from '../lib/agentBinaryCache'
import { applyTerminalAppearance } from '../lib/terminalRegistry'
import { useT } from '../i18n/useT'
import { keys } from '../lib/platform'

/**
 * - `main`: full session surface (sidebar → open conversation)
 * - `workspace`: agent column inside WorkspaceView (same dual-mode switcher)
 * - `preview-edit`: file-preview agent drawer — always built-in vav chat
 */
type SessionDetailVariant = 'main' | 'workspace' | 'preview-edit'

/** CLI host gate: no dedicated "checking" UI — resolve silently or restore. */
type AgentProbe = 'idle' | 'missing' | 'installing' | 'ready' | 'rechecking'

/**
 * Hybrid product model:
 *
 * - **vav** (default): built-in agent — transcript + tools + composer
 * - **Claude Code / Codex / Grok / …**: CLI terminal host — multi-split PTY
 *   Sessions are parked per agent (not destroyed on switch). Missing CLIs
 *   show an install panel first.
 */
export function SessionDetail({
  variant = 'main'
}: {
  variant?: SessionDetailVariant
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

  const previewEdit = variant === 'preview-edit'
  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)

  // null / "vav" → built-in chat; any other id → CLI host
  // Product: switching agent only replaces the transcript surface; the bottom
  // ToolsPanel (Files + Terminal) stays the same dock as vav mode.
  const agentKey = conversation?.agentBinaryName ?? null
  const isVavMode = previewEdit || !agentKey || agentKey === 'vav'
  const showAgentSwitcher = !previewEdit

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

  const buildInitialContext = useCallback(async (): Promise<string | null> => {
    const { formatFocusedFileContext, formatBlocksContext } = await import(
      '@shared/agentContextInject'
    )
    // Only the File Attachment Chip path (contextFiles / focusedFilePath) —
    // not bare tree selection, so dismissing the chip drops context.
    const store = useSessionStore.getState()
    const focused =
      (store.contextFiles[activeId] ?? null) ||
      store.conversations.find((c) => c.id === activeId)?.focusedFilePath ||
      null
    const cards = store.commentCards[activeId] ?? []
    const parts: string[] = []
    if (focused) parts.push(formatFocusedFileContext(focused))
    if (cards.length) parts.push(formatBlocksContext(cards))
    return parts.join('\n\n') || null
  }, [activeId])

  const activateHost = useCallback(
    async (
      agentId: string,
      withContext: boolean
    ): Promise<'restored' | 'created' | 'missing'> => {
      const initial = withContext ? await buildInitialContext() : null
      return useWorkspaceStore
        .getState()
        .activateAgentHost(activeId, agentId, 80, 24, initial)
    },
    [activeId, buildInitialContext]
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
   * Probe PATH only when needed. Fast paths:
   * 1) parked live PTY → restore immediately
   * 2) resolve (cached in main) → ready or install panel
   * Never shows a dedicated "checking…" screen.
   */
  const checkAndActivate = useCallback(
    async (agent: AgentConfig, options?: { force?: boolean }): Promise<void> => {
      const gen = ++probeGen.current
      const force = options?.force === true
      const candidates = agentCandidates(agent)

      // 1) Already have a parked/live host for this agent — never re-probe.
      if (!force && hasLiveAgentSession(agent.id)) {
        setProbe('ready')
        const result = await activateHost(agent.id, false)
        if (gen !== probeGen.current) return
        if (result === 'missing') {
          markAgentBinaryMissing(agent.id)
          setProbe('missing')
        }
        return
      }

      if (force) {
        clearAgentBinaryCache(agent.id)
        setProbe('rechecking')
      }

      let path: string | null = null
      try {
        path = window.vav.agents?.resolveBinary
          ? await window.vav.agents.resolveBinary(candidates, force)
          : null
      } catch {
        path = null
      }
      if (gen !== probeGen.current) return

      if (!path) {
        markAgentBinaryMissing(agent.id)
        setProbe('missing')
        useWorkspaceStore.getState().parkAgentHost(activeId)
        return
      }

      markAgentBinaryReady(agent.id, path)
      setProbe('ready')
      const result = await activateHost(agent.id, true)
      if (gen !== probeGen.current) return
      if (result === 'missing') {
        clearAgentBinaryCache(agent.id)
        markAgentBinaryMissing(agent.id)
        setProbe('missing')
        useWorkspaceStore.getState().parkAgentHost(activeId)
      }
    },
    [activeId, activateHost, agentCandidates, hasLiveAgentSession]
  )

  // Park CLI host when returning to vav; restore / probe when selecting a CLI agent.
  // Depend on agentKey (string), not activeAgent object identity.
  useEffect(() => {
    if (previewEdit) return
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

    // Optimistic first paint: known-good → terminal; known-missing / unknown → install.
    // Resolve runs in the background without a "checking…" intermediate screen.
    if (hasLiveAgentSession(agent.id) || getAgentBinaryCache(agent.id)?.status === 'ready') {
      setProbe('ready')
    } else if (getAgentBinaryCache(agent.id)?.status === 'missing') {
      setProbe('missing')
    } else {
      // Unknown: show install gate immediately (cheap) while resolve runs;
      // if the binary is present, we flip to ready without a spinner page.
      setProbe('missing')
    }

    void checkAndActivate(agent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when agent id changes
  }, [activeId, previewEdit, isVavMode, agentKey])

  // Agent-host split shortcuts only when CLI host is ready (not tools-tray bash).
  useEffect(() => {
    if (previewEdit || isVavMode || probe !== 'ready') return
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
      if (key === 'w' && !event.shiftKey) {
        const ws = store.workspaces[activeId]
        const agentId = ws?.activeHostAgentId
        const host = agentId ? ws?.agentHostSessions[agentId] : null
        const tabs = host?.tabs ?? []
        const activeTab = host?.activeTabId ?? ''
        if (tabs.length > 1 && activeTab) {
          event.preventDefault()
          store.closeAgentTab(activeId, activeTab)
        }
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
      void window.vav.pty.write(tabId, `${cmd}\r`)
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

  // —— File-preview agent drawer (always vav chat) ——
  if (previewEdit) {
    return (
      <main className="preview-edit-session">
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
        </div>
        <div className="preview-edit-dock dock">
          <Composer />
          <ToolsPanel variant="preview-edit" />
        </div>
      </main>
    )
  }

  const chrome = showAgentSwitcher ? (
    <AgentModeChrome
      conversationId={activeId}
      agentBinaryName={agentKey}
      showSplits={!isVavMode && probe === 'ready'}
    />
  ) : null

  // —— Built-in vav agent (chat workstation) ——
  if (isVavMode) {
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
              onClick={() => void openChangeReview(pending.changeSetId)}
            />
          </div>
        )}
        <div className="detail-stream" data-search={searchOpen}>
          {searchOpen && <SearchStrip />}
          <PlanOverlay />
          <Transcript />
        </div>
        {/* Composer sits above the tools tray so the prompt stays next to the
            transcript; Files/Terminal expand downward from the dock. */}
        <div className="dock">
          <Composer />
          <ToolsPanel variant="main" />
        </div>
      </main>
    )
  }

  // —— CLI agent: install gate or terminal host ——
  const hostClass = [
    'detail',
    'terminal-host-session',
    variant === 'workspace' ? 'session-detail-workspace' : ''
  ]
    .filter(Boolean)
    .join(' ')

  // Main surface (install gate or agent host) — Tools dock always stays.
  const mainSurface =
    probe === 'ready' ? (
      <div className="terminal-host-main terminal-host-stream">
        <TerminalPanel visible surface="agent" />
      </div>
    ) : activeAgent ? (
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
    ) : null

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
          No Composer above: `.dock-tools-only` adds top air so the strip isn’t tight. */}
      <div className="dock dock-tools-only">
        <ToolsPanel variant="main" />
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
  showSplits = false
}: {
  conversationId: string
  agentBinaryName: string | null
  showSplits?: boolean
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
    try {
      const next = await window.vav.conversations.setAgentBinaryName(conversationId, nextId)
      useSessionStore.setState({ conversations: next })
    } catch {
      useSessionStore.setState((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, agentBinaryName: nextId } : c
        )
      }))
    }
  }

  const displayName = active.name

  return (
    <div className="terminal-host-chrome agent-mode-chrome">
      {/* Icon + name are one control; native <select> covers the whole face.
          Menu options are text-only (no brand icons). */}
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
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {showSplits ? (
        <>
          <span className="spacer" />
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
      ) : (
        <span className="spacer" />
      )}
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

export function useSessionMenuCommands(): void {
  useEffect(() => {
    return window.vav.onMenuCommand((command) => {
      const store = useSessionStore.getState()
      switch (command) {
        case 'focus-composer':
          store.focusComposer()
          break
        default:
          break
      }
    })
  }, [])
}
