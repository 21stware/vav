/**
 * Native BrowserWindow min-size — not a CSS/flex floor.
 *
 * `windowMinWidth` / `windowMinHeight` are applied with `setMinimumSize` so
 * the user cannot drag the frame smaller than the visible columns. Height
 * follows the compact session empty-state (mark + name + foot) plus the
 * current workbench. CSS mins on panes are only layout hints.
 */

/** Matches `--sidebar-width` / `.sidebar-column` clamp. */
export const SIDEBAR_WIDTH_MIN = 190
export const SIDEBAR_WIDTH_MAX = 420
export const SIDEBAR_WIDTH_DEFAULT = 232

/** Conversation / agent column — never shrink below this when visible. */
export const AGENT_MIN_WIDTH = 360
/** File-bound session: agent is a side panel, not the landing column. */
export const FILE_SESSION_AGENT_MIN_WIDTH = 280
/** Right preview / file canvas. */
export const PREVIEW_MIN_WIDTH = 320

/** `.body-split` horizontal padding (`0 8px 8px`). */
export const BODY_SPLIT_PAD_X = 16
/** Gap between the docked sidebar and the detail column. */
export const BODY_SPLIT_GAP = 2
/** 1px rule between agent and preview. */
export const COLUMN_RULE = 1
/** `.body-split` floor padding. */
export const BODY_SPLIT_PAD_BOTTOM = 8

/** `--toolbar-height` / `--agent-chrome-h` — overlays the empty transcript. */
export const AGENT_CHROME_HEIGHT = 42
/** Empty-session transcript `padding-bottom` in the main shell. */
export const EMPTY_TRANSCRIPT_PAD_BOTTOM = 8
/** Companion session empty transcript `padding-bottom`. */
export const SESSION_EMPTY_TRANSCRIPT_PAD_BOTTOM = 12

/**
 * Compact session empty stack — the 280px container-query tier:
 * padding 8+8, mark 56, hero gap 10, name 18×1.2, foot gap 12, line 17.
 * Title / desc / quota are already hidden at this tier.
 */
export const EMPTY_STATE_COMPACT_PAD_Y = 16
export const EMPTY_STATE_COMPACT_MARK = 56
export const EMPTY_STATE_HERO_GAP = 10
export const EMPTY_STATE_COMPACT_NAME = 22
export const EMPTY_STATE_COMPACT_FOOT_GAP = 12
export const EMPTY_STATE_FOOT_LINE = 18

export const EMPTY_STATE_STACK_MIN =
  EMPTY_STATE_COMPACT_PAD_Y +
  EMPTY_STATE_COMPACT_MARK +
  EMPTY_STATE_HERO_GAP +
  EMPTY_STATE_COMPACT_NAME +
  EMPTY_STATE_COMPACT_FOOT_GAP +
  EMPTY_STATE_FOOT_LINE

/**
 * Session empty-state container queries (transcript content-box):
 *   360 — mark 72
 *   280 — mark 56, hide title / desc / quota
 *   180 — hide the agent name
 * Window min sits just above 180 so the compact hero (mark + name + foot)
 * still shows. The 96px full stack is not required.
 */
export const EMPTY_STATE_HIDE_NAME_AT = 180
export const EMPTY_STATE_STAGE_MIN = EMPTY_STATE_HIDE_NAME_AT + 1

/** Composer: pad-top 6 + box 8+7 + 3lh+4 textarea + gap 6 + bar 28. */
export const COMPOSER_MIN_HEIGHT = 119

/** `.tools-header` chip row. */
export const WORKBENCH_HEADER_HEIGHT = 32
/** `.panel-resizer` between header and open body. */
export const WORKBENCH_RESIZER_HEIGHT = 6
/** Tools body min — same as `PANEL_MIN_HEIGHT`. */
export const WORKBENCH_BODY_MIN = 160
/** `.tools-body` bottom margin when expanded. */
export const WORKBENCH_BODY_MARGIN = 4
/** `.dock > .tools-panel` padding-bottom. */
export const WORKBENCH_DOCK_PAD = 2

export const WORKBENCH_COLLAPSED_HEIGHT = WORKBENCH_HEADER_HEIGHT + WORKBENCH_DOCK_PAD

export const WORKBENCH_EXPANDED_HEIGHT =
  WORKBENCH_HEADER_HEIGHT +
  WORKBENCH_RESIZER_HEIGHT +
  WORKBENCH_BODY_MIN +
  WORKBENCH_BODY_MARGIN +
  WORKBENCH_DOCK_PAD

export type WindowShellKind = 'main' | 'session'

export type ShellMinWidthInput = {
  /** Sidebar is showing — counts even if CSS would overlay it. */
  sidebarVisible: boolean
  /** Current sidebar width; clamped to the sidebar min. */
  sidebarWidth?: number
  agentVisible: boolean
  agentMinWidth?: number
  /**
   * Live width of a fixed agent column (file-session drawer). The flex
   * conversation column omits this and uses `agentMinWidth` only.
   */
  agentWidth?: number
  previewVisible: boolean
  /**
   * Live width of a fixed preview drawer. The flex file canvas omits this
   * and uses `PREVIEW_MIN_WIDTH` only.
   */
  previewWidth?: number
  /** Main shell includes `.body-split` pad + gap. Companion session does not. */
  shell?: WindowShellKind
}

export type ShellMinHeightInput = {
  workbenchExpanded: boolean
  shell?: WindowShellKind
}

function columnSpan(min: number, current?: number): number {
  if (typeof current !== 'number' || !Number.isFinite(current)) return min
  return Math.max(min, Math.round(current))
}

export function windowMinWidth(input: ShellMinWidthInput): number {
  const shell = input.shell ?? 'main'
  const agentMin = input.agentMinWidth ?? AGENT_MIN_WIDTH
  let width = 0
  if (shell === 'main') width += BODY_SPLIT_PAD_X
  if (input.sidebarVisible) {
    width += columnSpan(SIDEBAR_WIDTH_MIN, input.sidebarWidth) + BODY_SPLIT_GAP
  }
  if (input.agentVisible) width += columnSpan(agentMin, input.agentWidth)
  if (input.previewVisible) {
    width += columnSpan(PREVIEW_MIN_WIDTH, input.previewWidth) + COLUMN_RULE
  }
  return Math.max(width, agentMin)
}

/**
 * Empty-state stage + dock. Expanded workbench uses the tools-tray floor so
 * opening Files / Terminal never crushes the empty hero.
 */
export function windowMinHeight(input: ShellMinHeightInput): number {
  const shell = input.shell ?? 'main'
  const transcriptPadBottom =
    shell === 'session' ? SESSION_EMPTY_TRANSCRIPT_PAD_BOTTOM : EMPTY_TRANSCRIPT_PAD_BOTTOM
  const workbench = input.workbenchExpanded
    ? WORKBENCH_EXPANDED_HEIGHT
    : WORKBENCH_COLLAPSED_HEIGHT
  const chrome = AGENT_CHROME_HEIGHT + transcriptPadBottom
  const splitFloor = shell === 'main' ? BODY_SPLIT_PAD_BOTTOM : 0
  return (
    chrome + EMPTY_STATE_STAGE_MIN + COMPOSER_MIN_HEIGHT + workbench + splitFloor
  )
}

/** Smallest the frame may ever be (sidebar hidden, agent only). */
export const WINDOW_MIN_WIDTH_FLOOR = windowMinWidth({
  sidebarVisible: false,
  agentVisible: true,
  previewVisible: false,
  shell: 'main'
})

/** First-paint / constructor: default sidebar + agent. */
export const MAIN_WINDOW_MIN_WIDTH = windowMinWidth({
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  agentVisible: true,
  previewVisible: false,
  shell: 'main'
})

/** Constructor / clamp floor: compact empty-state + collapsed workbench. */
export const MAIN_WINDOW_MIN_HEIGHT = windowMinHeight({
  workbenchExpanded: false,
  shell: 'main'
})

export const SESSION_WINDOW_MIN_WIDTH = windowMinWidth({
  sidebarVisible: false,
  agentVisible: true,
  previewVisible: false,
  shell: 'session'
})

export const SESSION_WINDOW_MIN_HEIGHT = windowMinHeight({
  workbenchExpanded: false,
  shell: 'session'
})
