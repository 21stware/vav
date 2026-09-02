import type { FileEntry, FileSortKey, TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import type { AgentHostSession } from './workspaceCliSurface.ts'

export interface WorkspaceSlice {
  root: string | null
  /** Directory path → its entries. One key per loaded level, nothing nested. */
  dirs: Record<string, FileEntry[]>
  dirErrors: Record<string, string>
  dirTruncated: Record<string, number>
  loadingDirs: string[]
  expanded: string[]
  selectedPath: string | null
  sort: FileSortKey
  ascending: boolean
  /** Files this conversation's agent has written, for the 本次改动 strip. */

  /**
   * User bash surface (Tools tray Terminal) — always plain shells, never a
   * CLI agent binary. Independent of {@link agentHostSessions}.
   */
  tabs: TerminalTab[]
  activeTabId: string
  /** Binary tree of pane splits for user bash. Null until first bash exists. */
  layout: TerminalLayoutNode | null
  /**
   * Main session is CLI Agent surface (not built-in VAV chat).
   * Layout lives at {@link CLI_SURFACE_KEY} in agentHostSessions.
   */
  cliMode: boolean
  /**
   * Which CLI agent is shown in the main session surface (null = vav chat).
   * Agent PTYs live only in {@link agentHostSessions}, not in `tabs`.
   */
  activeHostAgentId: string | null
  /**
   * Main-surface CLI agent layouts keyed by agent id. Switching agents parks
   * here without touching user bash tabs. PTYs are not killed.
   * Unified surface: {@link CLI_SURFACE_KEY}.
   */
  agentHostSessions: Record<string, AgentHostSession>
  /** PTY body under the tab strip; default collapsed (terminal-panel.rpml). */
  terminalOutputExpanded: boolean
  terminalHasUnseenOutput: boolean
}

export function emptySlice(root: string | null): WorkspaceSlice {
  return {
    root,
    dirs: {},
    dirErrors: {},
    dirTruncated: {},
    loadingDirs: [],
    expanded: root ? [root] : [],
    selectedPath: null,
    sort: 'name',
    ascending: true,

    tabs: [],
    activeTabId: '',
    layout: null,
    cliMode: false,
    activeHostAgentId: null,
    agentHostSessions: {},
    terminalOutputExpanded: false,
    terminalHasUnseenOutput: false
  }
}
