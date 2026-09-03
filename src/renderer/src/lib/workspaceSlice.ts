import type { FileEntry, FileSortKey, TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import type { AgentHostSession } from './workspaceCliSurface.ts'
import { omitRecord } from './workspacePty.ts'

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

/** Missing-path noise becomes ENOENT so the Files panel can stay calm. */
export function normalizeDirListError(error: string | null | undefined): string | undefined {
  if (!error) return undefined
  return /enoent|no such file|not found/i.test(error) ? 'ENOENT' : error
}

export function dirEntriesEqual(
  prev:
    | Array<{
        path: string
        name: string
        isDirectory: boolean
        size: number
        modifiedAt: number
      }>
    | undefined,
  next: Array<{
    path: string
    name: string
    isDirectory: boolean
    size: number
    modifiedAt: number
  }>
): boolean {
  return (
    Array.isArray(prev) &&
    prev.length === next.length &&
    prev.every((entry, i) => {
      const item = next[i]
      return (
        !!item &&
        entry.path === item.path &&
        entry.name === item.name &&
        entry.isDirectory === item.isDirectory &&
        entry.size === item.size &&
        entry.modifiedAt === item.modifiedAt
      )
    })
  )
}

/** Apply a directory listing without flashing unchanged trees. */
export function planDirListingPatch(
  s: {
    dirs: Record<string, FileEntry[]>
    dirErrors: Record<string, string>
    dirTruncated: Record<string, number>
    loadingDirs: string[]
  },
  path: string,
  nextEntries: FileEntry[],
  listing: { truncated: number },
  error: string | undefined
): Partial<{
  dirs: Record<string, FileEntry[]>
  dirErrors: Record<string, string>
  dirTruncated: Record<string, number>
  loadingDirs: string[]
}> {
  const prev = s.dirs[path]
  const sameEntries = dirEntriesEqual(prev, nextEntries)
  const sameTrunc = (s.dirTruncated[path] ?? 0) === listing.truncated
  const prevErr = s.dirErrors[path]
  const sameErr = error ? prevErr === error : prevErr === undefined
  const nextLoading = s.loadingDirs.filter((p) => p !== path)
  const loadingChanged = nextLoading.length !== s.loadingDirs.length

  if (sameEntries && sameTrunc && sameErr) {
    if (!loadingChanged) return {}
    return { loadingDirs: nextLoading }
  }

  return {
    loadingDirs: nextLoading,
    dirs: { ...s.dirs, [path]: nextEntries },
    dirErrors: error ? { ...s.dirErrors, [path]: error } : omitRecord(s.dirErrors, path),
    dirTruncated: { ...s.dirTruncated, [path]: listing.truncated }
  }
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

/** New workdir: wipe the file tree, keep bash + CLI host layouts. */
export function planWorkingDirectorySlice(prev: WorkspaceSlice, root: string | null): WorkspaceSlice {
  return {
    ...emptySlice(root),
    sort: prev.sort,
    ascending: prev.ascending,
    tabs: prev.tabs,
    activeTabId: prev.activeTabId,
    layout: prev.layout,
    cliMode: prev.cliMode,
    activeHostAgentId: prev.activeHostAgentId,
    agentHostSessions: prev.agentHostSessions
  }
}

/** Expand or collapse one directory path using the pre-click expanded flag. */
export function nextExpandedPaths(expanded: string[], path: string, isExpanded: boolean): string[] {
  return isExpanded ? expanded.filter((p) => p !== path) : [...expanded, path]
}
