import type { TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import {
  adoptRemotePendingTabs,
  makePendingCliTab,
  replaceLayoutTabId
} from './cliPendingLayout.ts'
import {
  collectLeaves,
  layoutFromTabIds,
  pickCliLayoutBase,
  reconcileLayout
} from './workspaceLayout.ts'

/** One CLI agent's terminal host layout — survives agent switching. */
export type AgentHostSession = {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
}

/**
 * Unified CLI Agent surface key — holds mixed pending + multi-type panes.
 * (Per-agent keys may still exist for legacy hydrate; display uses this.)
 */
export const CLI_SURFACE_KEY = '__cli__'

/** Prefer a live pane of this agent, then any live pane, then the first tab. */
export function pickCliScreenFocusTab<T extends { pendingCli?: boolean; agentId?: string | null }>(
  tabs: T[],
  agentId: string
): T | undefined {
  return (
    tabs.find((t) => !t.pendingCli && t.agentId === agentId) ??
    tabs.find((t) => !t.pendingCli) ??
    tabs[0]
  )
}

/**
 * Screen-level CLI surface: panes are not grouped by agent type.
 * Pending picker leaves stay until the user assigns a CLI.
 * Hydrate must never drop an existing Screen when re-entering from VAV.
 */
export function mergeCliSurface(
  prev: AgentHostSession | undefined,
  projected: Record<string, AgentHostSession>,
  remoteLayout: TerminalLayoutNode | null
): AgentHostSession | null {
  const liveById = new Map<string, TerminalTab>()
  for (const [agentId, host] of Object.entries(projected)) {
    if (agentId === CLI_SURFACE_KEY) continue
    for (const t of host.tabs) {
      liveById.set(t.id, {
        ...t,
        pendingCli: false,
        agentId: t.agentId ?? agentId
      })
    }
  }

  // Map pending picker leaves → newly spawned PTYs in order so we never treat
  // "pending + live" as two panes and re-split with row.
  // Optimistic assign marks the picker live (preferred id) before spawn
  // returns; that tab is not pendingCli but also has no PTY yet — treat it
  // the same so a minted id does not become a second pane beside the chooser.
  let layoutSeed = prev?.layout ?? null
  const pendingQueue = (prev?.tabs ?? [])
    .filter((t) => t.pendingCli || !liveById.has(t.id))
    .map((t) => t.id)
  const prevKnown = new Set((prev?.tabs ?? []).map((t) => t.id))
  const brandNewLives = [...liveById.keys()].filter((id) => !prevKnown.has(id))
  const pendingToLive = new Map<string, string>()
  for (const pendingId of pendingQueue) {
    if (brandNewLives.length === 0) break
    // Prefer when layout still names this pending leaf.
    const leaves = layoutSeed ? collectLeaves(layoutSeed) : []
    if (!leaves.includes(pendingId) && !prevKnown.has(pendingId)) continue
    const liveId = brandNewLives.shift()!
    pendingToLive.set(pendingId, liveId)
    layoutSeed = replaceLayoutTabId(layoutSeed, pendingId, liveId)
  }

  const tabs: TerminalTab[] = []
  const seen = new Set<string>()

  // Preserve previous pane order (Screen topology).
  for (const t of prev?.tabs ?? []) {
    const mapped = pendingToLive.get(t.id)
    if (mapped) {
      const live = liveById.get(mapped)
      if (live && !seen.has(mapped)) {
        tabs.push(live)
        seen.add(mapped)
        liveById.delete(mapped)
      }
      continue
    }
    if (t.pendingCli) {
      // Keep unassigned picker panes (no PTY in main yet).
      if (!seen.has(t.id)) {
        tabs.push({ ...t, pendingCli: true, agentId: null })
        seen.add(t.id)
      }
      continue
    }
    const live = liveById.get(t.id)
    if (live && !seen.has(t.id)) {
      tabs.push(live)
      seen.add(t.id)
      liveById.delete(t.id)
    }
  }
  // Attach any newly discovered live PTYs (other window / restore).
  for (const live of liveById.values()) {
    if (seen.has(live.id)) continue
    tabs.push(live)
    seen.add(live.id)
  }

  if (tabs.length === 0) {
    // Companion closed every live pane and reseeded a picker. Main still holds
    // those dead PTY tabs — adopt the persisted pending leaves so reclaim is
    // not a blank Screen.
    const adopted = adoptRemotePendingTabs(prev?.tabs, remoteLayout)
    if (adopted) {
      const tabIds = adopted.map((t) => t.id)
      return {
        tabs: adopted,
        layout: reconcileLayout(remoteLayout, tabIds) ?? layoutFromTabIds(tabIds),
        activeTabId: adopted[0]!.id
      }
    }
    // Screen existed but projection is empty (brief list race / all exited).
    // Prefer keeping the previous Screen topology over inventing a new picker —
    // enterCliMode + VAV park must not look like a wipe.
    if (prev && prev.tabs.length > 0) {
      return {
        tabs: prev.tabs,
        layout: prev.layout ?? layoutFromTabIds(prev.tabs.map((t) => t.id)),
        activeTabId: prev.activeTabId || prev.tabs[0]!.id
      }
    }
    if (!prev) return null
    const pending = makePendingCliTab()
    return {
      tabs: [pending],
      layout: { type: 'leaf', tabId: pending.id, weight: 1 },
      activeTabId: pending.id
    }
  }

  const tabIds = tabs.map((t) => t.id)
  // Also remap pending→live on remote seed so stale main trees stay column/row.
  let remoteSeed = remoteLayout
  for (const [from, to] of pendingToLive) {
    remoteSeed = replaceLayoutTabId(remoteSeed, from, to)
  }
  const base = pickCliLayoutBase(layoutSeed, remoteSeed, tabIds)
  const layout = reconcileLayout(base, tabIds)
  const activeTabId =
    prev && tabIds.includes(prev.activeTabId)
      ? prev.activeTabId
      : prev?.activeTabId && pendingToLive.has(prev.activeTabId)
        ? (pendingToLive.get(prev.activeTabId) ?? tabIds[0] ?? '')
        : (tabIds[0] ?? '')
  return { tabs, layout, activeTabId }
}

/** Merge projected agent hosts while preserving each host's split topology. */
export function reconcileAgentHosts(
  prev: Record<string, AgentHostSession>,
  projected: Record<string, AgentHostSession>,
  remoteAgents?: Record<string, TerminalLayoutNode | null>
): Record<string, AgentHostSession> {
  const out: Record<string, AgentHostSession> = {}
  for (const [agentId, proj] of Object.entries(projected)) {
    if (agentId === CLI_SURFACE_KEY) continue
    const old = prev[agentId]
    const tabIds = proj.tabs.map((t) => t.id)
    // Main-process layouts win so a detached window does not flatten ⌘⇧D → row.
    const base = remoteAgents?.[agentId] ?? old?.layout ?? null
    const layout = reconcileLayout(base, tabIds)
    const activeTabId =
      old && tabIds.includes(old.activeTabId)
        ? old.activeTabId
        : (proj.activeTabId || tabIds[0] || '')
    out[agentId] = {
      tabs: proj.tabs,
      layout,
      activeTabId
    }
  }
  // Unified CLI Screen: keep layout + pending picker panes across hydrate.
  // Live PTYs of any agent type are folded into this single surface.
  const prevSurface = prev[CLI_SURFACE_KEY]
  const remoteSurface = remoteAgents?.[CLI_SURFACE_KEY] ?? null
  const mergedSurface = mergeCliSurface(prevSurface, projected, remoteSurface)
  if (mergedSurface) {
    out[CLI_SURFACE_KEY] = mergedSurface
  }
  return out
}
