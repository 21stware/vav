/**
 * Swarm CLI panes have no protocol `end` event. Infer a finished turn from
 * PTY running → idle, then wait so a quiet gap between tools is not a chime.
 *
 * First idle after spawn is ignored unless stdout has already spanned a
 * real work window (launch-with-prompt). After the pane has been idle once,
 * any later idle that follows running is a candidate.
 */
import type { PtyActivityStatus } from './ipc'

export const SWARM_IDLE_QUIET_MS = 4000
/** Output must span this long before the first idle counts as a finished turn. */
export const SWARM_MIN_WORK_MS = 4000

export type SwarmFinishAgentId = string

export type SwarmFinishSample = {
  tabId: string
  conversationId: string
  agentId: string | null
  status: PtyActivityStatus
  createdAt: number
  lastDataAt: number
}

export type SwarmFinishEffect =
  | { type: 'arm'; tabId: string; conversationId: string; delayMs: number }
  | { type: 'cancel'; tabId: string }
  | { type: 'forget'; tabId: string }

type PaneWatch = {
  conversationId: string
  status: PtyActivityStatus
  sawIdle: boolean
  runningSince: number | null
  armed: boolean
}

export function isSwarmFinishAgent(agentId: string | null | undefined): boolean {
  return typeof agentId === 'string' && agentId.length > 0 && agentId !== 'vav'
}

export function createSwarmFinishWatch(opts?: {
  quietMs?: number
  minWorkMs?: number
  now?: () => number
}): {
  noteStatus: (sample: SwarmFinishSample) => SwarmFinishEffect | null
  noteGone: (tabId: string) => SwarmFinishEffect | null
  takeNotify: (tabId: string) => { conversationId: string } | null
} {
  const quietMs = opts?.quietMs ?? SWARM_IDLE_QUIET_MS
  const minWorkMs = opts?.minWorkMs ?? SWARM_MIN_WORK_MS
  const now = opts?.now ?? Date.now
  const panes = new Map<string, PaneWatch>()

  function drop(tabId: string, armed: boolean): SwarmFinishEffect {
    panes.delete(tabId)
    return armed ? { type: 'cancel', tabId } : { type: 'forget', tabId }
  }

  function noteStatus(sample: SwarmFinishSample): SwarmFinishEffect | null {
    if (!isSwarmFinishAgent(sample.agentId)) {
      const existing = panes.get(sample.tabId)
      if (!existing) return null
      return drop(sample.tabId, existing.armed)
    }
    if (sample.status === 'exited') {
      const existing = panes.get(sample.tabId)
      if (!existing) return null
      return drop(sample.tabId, existing.armed)
    }

    let pane = panes.get(sample.tabId)
    if (!pane) {
      pane = {
        conversationId: sample.conversationId,
        status: sample.status,
        sawIdle: false,
        runningSince: sample.status === 'running' ? now() : null,
        armed: false
      }
      panes.set(sample.tabId, pane)
    } else {
      pane.conversationId = sample.conversationId
    }

    if (sample.status === 'running') {
      if (pane.status !== 'running' || pane.runningSince == null) {
        pane.runningSince = now()
      }
      pane.status = 'running'
      if (!pane.armed) return null
      pane.armed = false
      return { type: 'cancel', tabId: sample.tabId }
    }

    const prevSawIdle = pane.sawIdle
    const runningSince = pane.runningSince
    const wasArmed = pane.armed
    const runMs = runningSince != null ? now() - runningSince : 0
    const outputSpan = Math.max(0, sample.lastDataAt - sample.createdAt)
    const qualifying = prevSawIdle || runMs >= minWorkMs || outputSpan >= minWorkMs

    pane.status = 'idle'
    pane.sawIdle = true
    pane.runningSince = null

    if (qualifying) {
      if (wasArmed) return null
      pane.armed = true
      return {
        type: 'arm',
        tabId: sample.tabId,
        conversationId: pane.conversationId,
        delayMs: quietMs
      }
    }
    pane.armed = false
    return wasArmed ? { type: 'cancel', tabId: sample.tabId } : null
  }

  function noteGone(tabId: string): SwarmFinishEffect | null {
    const pane = panes.get(tabId)
    if (!pane) return null
    return drop(tabId, pane.armed)
  }

  function takeNotify(tabId: string): { conversationId: string } | null {
    const pane = panes.get(tabId)
    if (!pane?.armed || pane.status !== 'idle') return null
    pane.armed = false
    return { conversationId: pane.conversationId }
  }

  return { noteStatus, noteGone, takeNotify }
}
