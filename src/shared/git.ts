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

export type GitTrayTab = 'workspace' | 'commits' | 'local' | 'origin' | 'stashes'

export interface GitCommitEntry {
  sha: string
  shortSha: string
  subject: string
  author: string
  /** Unix milliseconds. */
  date: number
}

export interface GitBranchEntry {
  /** Local short name, or the branch name after the remote (e.g. `main`). */
  name: string
  /** `main` locally, `origin/main` for remote-tracking refs. */
  fullName: string
  sha: string
  shortSha: string
  subject: string
  date: number
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  gone: boolean
  /** Remote name for tracking refs (`origin`), else null. */
  remote: string | null
}

export interface GitStashEntry {
  index: number
  /** `stash@{n}` */
  selector: string
  sha: string
  shortSha: string
  subject: string
  date: number
}

export interface GitLogPage {
  commits: GitCommitEntry[]
}

export interface GitBranchesPage {
  local: GitBranchEntry[]
  remote: GitBranchEntry[]
}

export interface GitStashesPage {
  stashes: GitStashEntry[]
}

export function emptyGitSnapshot(cwd = ''): GitSnapshot {
  return {
    cwd,
    isRepo: false,
    toplevel: null,
    projectName: '',
    branch: null,
    detached: false,
    headShort: null,
    worktreeLabel: '',
    isAdditionalWorktree: false,
    worktrees: [],
    branches: [],
    changes: []
  }
}

export function isGitSnapshot(value: unknown): value is GitSnapshot {
  if (!value || typeof value !== 'object') return false
  const snap = value as Partial<GitSnapshot>
  return typeof snap.isRepo === 'boolean' && Array.isArray(snap.changes)
}

export function isGitLogPage(value: unknown): value is GitLogPage {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as GitLogPage).commits)
}

export function isGitBranchesPage(value: unknown): value is GitBranchesPage {
  if (!value || typeof value !== 'object') return false
  const page = value as GitBranchesPage
  return Array.isArray(page.local) && Array.isArray(page.remote)
}

export function isGitStashesPage(value: unknown): value is GitStashesPage {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as GitStashesPage).stashes)
}

/** Folder-name slug for a sibling worktree directory. */
export function slugWorktreeBranch(branchName: string): string {
  return (
    branchName
      .trim()
      .replace(/[^A-Za-z0-9._\-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'worktree'
  )
}

/** Suggested sibling path for a new worktree. */
export function suggestWorktreePath(primaryPath: string, branchName: string): string {
  const trimmed = primaryPath.replace(/[\\/]+$/, '')
  const win = /^[A-Za-z]:[\\/]/.test(trimmed) || (trimmed.includes('\\') && !trimmed.startsWith('/'))
  const sep = win ? '\\' : '/'
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const dir = idx >= 0 ? trimmed.slice(0, idx) : trimmed
  const project = idx >= 0 ? trimmed.slice(idx + 1) : trimmed
  return `${dir}${sep}${project}-${slugWorktreeBranch(branchName)}`
}
