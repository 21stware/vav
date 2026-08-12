/** Shared git workspace types for main ↔ renderer. */

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict'
  | 'typechange'
  | 'unknown'

export interface GitWorktreeInfo {
  path: string
  /** Branch short name, or null when detached / bare. */
  branch: string | null
  bare: boolean
  detached: boolean
  isCurrent: boolean
  /** First entry from `git worktree list` — the primary checkout. */
  isPrimary: boolean
  /** "Local" for primary, otherwise directory basename. */
  label: string
}

export interface GitChangeEntry {
  path: string
  /** Absolute path when cwd is known. */
  absolutePath: string
  status: GitFileStatus
  /** XY status letters from `git status --porcelain` (e.g. "M ", "??"). */
  code: string
  staged: boolean
  unstaged: boolean
}

export interface GitSnapshot {
  cwd: string
  isRepo: boolean
  /** `git rev-parse --show-toplevel` for the current checkout. */
  toplevel: string | null
  /** Basename of the primary worktree (project name). */
  projectName: string
  branch: string | null
  detached: boolean
  headShort: string | null
  /** Current worktree label: "Local" or worktree folder name. */
  worktreeLabel: string
  isAdditionalWorktree: boolean
  worktrees: GitWorktreeInfo[]
  branches: string[]
  changes: GitChangeEntry[]
  error?: string
}

export type GitResult<T> = { ok: true; data: T } | { ok: false; error: string }
