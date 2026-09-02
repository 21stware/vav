/**
 * Tools tray + sidebar chrome layout persisted per window.
 * Companion session windows use sessionStorage so they do not share collapse
 * state with the main window for the same conversationId.
 */

export interface SessionToolsLayout {
  toolsCollapsed: boolean
  panelSegment: 'files' | 'terminal'
  /** Segment to restore when expanding via chevron (main-chat.rpml §5). */
  lastActiveSegment: 'files' | 'terminal'
  panelHeight: number
}

export const PANEL_MIN_HEIGHT = 160
/**
 * Safety rail for persisted heights. Interactive drag / double-click max is
 * `PANEL_SNAP_RATIO` of the session column (see ToolsPanel).
 */
export const PANEL_MAX_HEIGHT = 2400
/** Double-click the tray resizer to jump here; again to restore. */
export const PANEL_SNAP_RATIO = 0.7

export const GLOBAL_LAYOUT_KEY = 'vav.layout'
export const SESSION_TOOLS_KEY = 'vav.session-tools-layout'

export const DEFAULT_SESSION_TOOLS: SessionToolsLayout = {
  toolsCollapsed: true,
  panelSegment: 'files',
  lastActiveSegment: 'files',
  panelHeight: 240
}

export type GlobalLayoutPrefs = {
  sidebarVisible: boolean
}

export function parseGlobalLayout(raw: string | null | undefined): GlobalLayoutPrefs {
  const fallback: GlobalLayoutPrefs = { sidebarVisible: true }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<GlobalLayoutPrefs>
    return { sidebarVisible: parsed.sidebarVisible ?? true }
  } catch {
    return fallback
  }
}

export function parseSessionToolsMap(
  raw: string | null | undefined
): Record<string, SessionToolsLayout> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<SessionToolsLayout>>
    const out: Record<string, SessionToolsLayout> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      out[id] = { ...DEFAULT_SESSION_TOOLS, ...value }
    }
    return out
  } catch {
    return {}
  }
}

export function toolsFor(
  state: { toolsLayouts: Record<string, SessionToolsLayout> },
  id: string
): SessionToolsLayout {
  return state.toolsLayouts[id] ?? DEFAULT_SESSION_TOOLS
}

export function activeToolsFields(layout: SessionToolsLayout): {
  toolsCollapsed: boolean
  panelSegment: SessionToolsLayout['panelSegment']
  lastActiveSegment: SessionToolsLayout['lastActiveSegment']
  panelHeight: number
} {
  return {
    toolsCollapsed: layout.toolsCollapsed,
    panelSegment: layout.panelSegment,
    lastActiveSegment: layout.lastActiveSegment,
    panelHeight: layout.panelHeight
  }
}

/**
 * Companion session windows must not share tools-tray layout with the main
 * window via localStorage (same conversationId would collapse both). Use
 * sessionStorage in detached views — per BrowserWindow, dies with the window.
 */
export function isDetachedSessionWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'session'
  } catch {
    return false
  }
}

export function toolsLayoutStorage(): Storage {
  try {
    return isDetachedSessionWindow() ? sessionStorage : localStorage
  } catch {
    return localStorage
  }
}

export function loadGlobalLayout(): GlobalLayoutPrefs {
  try {
    return parseGlobalLayout(localStorage.getItem(GLOBAL_LAYOUT_KEY))
  } catch {
    return parseGlobalLayout(null)
  }
}

export function saveGlobalLayout(prefs: GlobalLayoutPrefs): void {
  try {
    localStorage.setItem(GLOBAL_LAYOUT_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode or a full quota: layout simply falls back to defaults.
  }
}

export function loadSessionToolsMap(): Record<string, SessionToolsLayout> {
  try {
    return parseSessionToolsMap(toolsLayoutStorage().getItem(SESSION_TOOLS_KEY))
  } catch {
    return {}
  }
}

export function saveSessionToolsMap(map: Record<string, SessionToolsLayout>): void {
  try {
    toolsLayoutStorage().setItem(SESSION_TOOLS_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export type ToolsLayoutState = {
  activeId: string
  toolsLayouts: Record<string, SessionToolsLayout>
}

/** Patch active conversation's tools layout + mirror fields for selectors. */
export function patchActiveTools(
  state: ToolsLayoutState,
  patch: Partial<SessionToolsLayout>
): Partial<{
  toolsLayouts: Record<string, SessionToolsLayout>
  toolsCollapsed: boolean
  panelSegment: SessionToolsLayout['panelSegment']
  lastActiveSegment: SessionToolsLayout['lastActiveSegment']
  panelHeight: number
}> {
  const id = state.activeId
  if (!id) return {}
  const next = { ...toolsFor(state, id), ...patch }
  const toolsLayouts = { ...state.toolsLayouts, [id]: next }
  saveSessionToolsMap(toolsLayouts)
  return {
    toolsLayouts,
    ...activeToolsFields(next)
  }
}
