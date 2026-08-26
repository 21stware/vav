/**
 * Tray menu: live work and unseen completions, grouped by workdir.
 * Running / Done is a prefix on the row — not a section that replaces the path.
 */

export type TrayPaneKind = 'agent' | 'chat' | 'bash'
export type TrayPaneStatus = 'running' | 'done'

const KIND_RANK: Record<TrayPaneKind, number> = {
  chat: 0,
  agent: 1,
  bash: 2
}

/** Two em spaces so session rows sit under the path header. */
export const TRAY_ITEM_INDENT = '\u2003\u2003'

/** Recent stdout window — matches PtyManager OUTPUT_ACTIVE_MS. */
export const AGENT_OUTPUT_ACTIVE_MS = 1200
/** After a finished turn, ignore short TUI redraws before calling it Running again. */
export const AGENT_RESUME_WORK_MS = 1500
/** Host process stays alive at the prompt — treat this quiet span as the turn end. */
export const AGENT_TRAY_QUIET_MS = 4000
/** Ignore spawn / focus-in paints when deciding the quiet gap was real work. */
export const AGENT_TRAY_MIN_WORK_MS = 4000

export type TrayPane = {
  conversationId: string
  tabId: string
  kind: TrayPaneKind
  /** Conversation title. */
  sessionTitle: string
  /** Agent name, VAV, or bash tab title. */
  paneTitle: string
  /** Absolute workdir or a stable fallback key. */
  dirKey: string
  /** Compact label for the group header (`~/repo/vav`). */
  dirLabel: string
  createdAt: number
  agentId?: string
  /** Live work vs completed-and-unseen. Missing → treat as running. */
  status?: TrayPaneStatus
}

export type TrayPaneGroup = {
  dirKey: string
  dirLabel: string
  panes: TrayPane[]
}

export type ConversationActivityRow = {
  conversationId: string
  status: TrayPaneStatus
}

/** Swarm History still uses the agent-qualified form. Tray rows use the title only. */
export function trayItemLabel(pane: TrayPane): string {
  if (pane.kind === 'agent') return `${pane.sessionTitle} - ${pane.paneTitle}`
  if (pane.kind === 'bash') return pane.paneTitle
  return pane.sessionTitle
}

export function traySessionLabel(pane: TrayPane): string {
  return pane.sessionTitle
}

export function trayStatusRowLabel(
  title: string,
  status: TrayPaneStatus,
  words: { running: string; done: string }
): string {
  const word = status === 'done' ? words.done : words.running
  return `${word} · ${title}`
}

export function trayIndentedLabel(label: string): string {
  return `${TRAY_ITEM_INDENT}${label}`
}

/** Menu-bar title: `running·done`. Empty when both are zero. */
export function trayTitleCounts(running: number, done: number): string {
  const live = Math.max(0, running)
  const finished = Math.max(0, done)
  if (live <= 0 && finished <= 0) return ''
  return `${live}·${finished}`
}

export function trayPaneKey(pane: Pick<TrayPane, 'conversationId' | 'kind' | 'tabId'>): string {
  return `${pane.conversationId}:${pane.kind}:${pane.tabId}`
}

/** Live rows win; unseen completed rows fill in anything not already listed. */
export function mergeLiveAndUnseenTrayPanes(live: TrayPane[], unseen: TrayPane[]): TrayPane[] {
  const keys = new Set(live.map(trayPaneKey))
  const extra: TrayPane[] = []
  for (const pane of unseen) {
    if (pane.kind === 'bash') continue
    const key = trayPaneKey(pane)
    if (keys.has(key)) continue
    keys.add(key)
    extra.push({ ...pane, status: 'done' })
  }
  return [...live.map((pane) => ({ ...pane, status: pane.status ?? 'running' })), ...extra]
}

/** Window LED: Running wins if any pane in the conversation is live. */
export function collapseTrayActivity(
  panes: Array<{ conversationId: string; status?: TrayPaneStatus }>
): ConversationActivityRow[] {
  const byId = new Map<string, TrayPaneStatus>()
  for (const pane of panes) {
    const status = pane.status ?? 'running'
    const prev = byId.get(pane.conversationId)
    if (!prev || status === 'running') byId.set(pane.conversationId, status)
  }
  return [...byId.entries()].map(([conversationId, status]) => ({ conversationId, status }))
}

/**
 * One thread/swarm row per conversation. Running terminals stay as their
 * own rows — a server in the tools tray must still appear next to the chat.
 */
export function collapseTrayPanesByConversation(panes: TrayPane[]): TrayPane[] {
  const bash: TrayPane[] = []
  const rest: TrayPane[] = []
  for (const pane of panes) {
    if (pane.kind === 'bash') bash.push(pane)
    else rest.push(pane)
  }
  const byId = new Map<string, TrayPane>()
  for (const pane of rest) {
    const existing = byId.get(pane.conversationId)
    if (!existing) {
      byId.set(pane.conversationId, pane)
      continue
    }
    const nextStatus = pane.status ?? 'running'
    const prevStatus = existing.status ?? 'running'
    if (nextStatus === 'running' && prevStatus === 'done') {
      byId.set(pane.conversationId, pane)
      continue
    }
    if (nextStatus !== prevStatus) continue
    if (KIND_RANK[pane.kind] < KIND_RANK[existing.kind]) {
      byId.set(pane.conversationId, pane)
    }
  }
  return [...byId.values(), ...bash]
}

/** How long stdout was actually flowing in this streak. */
export function agentWorkMs(opts: {
  lastDataAt: number
  runningSince: number | null
  createdAt: number
}): number {
  if (opts.runningSince != null) return Math.max(0, opts.lastDataAt - opts.runningSince)
  return Math.max(0, opts.lastDataAt - opts.createdAt)
}

/**
 * CLI host never goes PTY-idle (child stays up at the prompt). After a real
 * work window and a quiet gap, the tray should move to Done / drop.
 */
export function shouldInferAgentTrayFinish(opts: {
  finishedTurn: boolean
  lastDataAt: number
  runningSince: number | null
  createdAt: number
  now: number
  quietMs?: number
  minWorkMs?: number
}): boolean {
  if (opts.finishedTurn) return false
  const quietMs = opts.quietMs ?? AGENT_TRAY_QUIET_MS
  const minWorkMs = opts.minWorkMs ?? AGENT_TRAY_MIN_WORK_MS
  if (opts.now - opts.lastDataAt < quietMs) return false
  return agentWorkMs(opts) >= minWorkMs
}

/**
 * CLI agent PTYs stay `running` after a turn because the host process is
 * still a child of the PTY. After we record a finish, only sustained stdout
 * counts as a new Running turn — not a focus-in TUI paint.
 *
 * Before the first finish, leftover process-alive is not enough: sit-at-prompt
 * with no work must drop off, and a quiet gap after real output is a finish.
 */
export function isAgentTrayRunning(opts: {
  finishedTurn: boolean
  ptyStatus: 'running' | 'idle' | 'exited'
  lastDataAt: number
  runningSince: number | null
  now: number
  createdAt?: number
  outputActiveMs?: number
  resumeWorkMs?: number
  quietMs?: number
  minWorkMs?: number
}): boolean {
  if (opts.ptyStatus !== 'running') return false
  const outputActiveMs = opts.outputActiveMs ?? AGENT_OUTPUT_ACTIVE_MS
  const resumeWorkMs = opts.resumeWorkMs ?? AGENT_RESUME_WORK_MS
  if (opts.finishedTurn) {
    if (opts.now - opts.lastDataAt >= outputActiveMs) return false
    if (opts.runningSince == null) return false
    return opts.now - opts.runningSince >= resumeWorkMs
  }
  if (opts.now - opts.lastDataAt < outputActiveMs) return true
  if (
    shouldInferAgentTrayFinish({
      finishedTurn: false,
      lastDataAt: opts.lastDataAt,
      runningSince: opts.runningSince,
      createdAt: opts.createdAt ?? 0,
      now: opts.now,
      quietMs: opts.quietMs,
      minWorkMs: opts.minWorkMs
    })
  ) {
    return false
  }
  // Quiet but not a finished turn (spawn / idle prompt) — hide after the gap.
  return opts.now - opts.lastDataAt < (opts.quietMs ?? AGENT_TRAY_QUIET_MS)
}

/**
 * First idle after spawn is the shell settling, not a finished command.
 * A later running→idle (or a long first run) is a completed result.
 * Terminal (bash) never uses this for the tray — no Done row.
 */
export function shouldRecordPtyCompletion(opts: {
  primed: boolean
  runningSince: number | null
  now: number
  minRunMs?: number
}): boolean {
  if (opts.runningSince == null) return false
  if (opts.primed) return true
  return opts.now - opts.runningSince >= (opts.minRunMs ?? 1200)
}

/** Group by directory. Running rows first, then Done; newest first inside each. */
export function groupTrayPanes(panes: TrayPane[]): TrayPaneGroup[] {
  const buckets = new Map<string, TrayPane[]>()
  const order: string[] = []
  for (const pane of panes) {
    const key = pane.dirKey || '~'
    const list = buckets.get(key)
    if (list) list.push(pane)
    else {
      buckets.set(key, [pane])
      order.push(key)
    }
  }
  return order.map((dirKey) => {
    const list = buckets.get(dirKey) ?? []
    list.sort((a, b) => {
      const aDone = a.status === 'done' ? 1 : 0
      const bDone = b.status === 'done' ? 1 : 0
      if (aDone !== bDone) return aDone - bDone
      const aRank = KIND_RANK[a.kind] ?? 10
      const bRank = KIND_RANK[b.kind] ?? 10
      if (aRank !== bRank) return aRank - bRank
      return b.createdAt - a.createdAt
    })
    return {
      dirKey,
      dirLabel: list[0]?.dirLabel || dirKey,
      panes: list
    }
  })
}
