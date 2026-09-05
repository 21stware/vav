import type { ModelOption, TurnPhase } from '@shared/types'
import type { GitChangeEntry } from '@shared/git'
import type { GithubActionRun, GithubPullListItem, GithubRelease, GithubSite } from '@shared/github'
import type { CloudflareStatus } from '@shared/cloudflare'
import type { SupabaseStatus } from '@shared/supabase'

export type AgentModelCatalogEntry = {
  host: string
  models: ModelOption[]
  source: 'live' | 'static' | 'fallback'
  error?: string
  endpoint?: string
}

/** Mid-turn context-window overlay — must not remap `conversations`. */
export type LiveUsage = {
  tokensUsed: number
  tokenLimit?: number
}

/** Contents of the session-right preview drawer. */
export type SessionPreview =
  | { kind: 'file' }
  | { kind: 'git'; cwd: string; entry: GitChangeEntry }
  | { kind: 'github'; cwd: string; pull: GithubPullListItem }
  | { kind: 'github-action'; cwd: string; run: GithubActionRun }
  | { kind: 'github-site'; cwd: string; site: GithubSite }
  | { kind: 'github-release'; cwd: string; release: GithubRelease }
  | { kind: 'cloudflare'; cwd: string; status: CloudflareStatus; deploymentId: string | null }
  | { kind: 'supabase'; cwd: string; status: SupabaseStatus; functionSlug: string | null }

export interface ToastState {
  kind: 'info' | 'success' | 'error'
  title: string
  description?: string
}

export type SettingsCategory =
  | 'api'
  | 'analysis'
  | 'accounts'
  | 'workspace'
  | 'appearance'
  | 'notifications'
  | 'connect'
  | 'cli'
  | 'agents'
  | 'file-associations'
  | 'keybindings'
  | 'logs'
  | 'about'

export interface TurnRuntime {
  isRunning: boolean
  phase: TurnPhase
  toolCount: number
  awaitingToolCallId: string | null
  /** Frozen at turn start — composer model picks must not rewrite Outputting. */
  startedModel?: string
  startedCliHost?: string | null
  startedAccountId?: string | null
}

export interface DialogState {
  title: string
  body: string
  confirmLabel: string
  /** Shown when `onConfirm` is set; defaults to 取消. */
  cancelLabel?: string
  destructive?: boolean
  /** Omit for a message-only alert with a single dismiss button. */
  onConfirm?: () => void
}

export interface SearchState {
  open: boolean
  query: string
  matchIds: string[]
  index: number
  /** Bumped on every navigation so scroll-to-match re-fires on the same id. */
  tick: number
}

/** Sidebar list: main sessions, archive, or file-bound sessions. */
export type SidebarListMode = 'main' | 'archive' | 'fileSessions'

export type { QueuedMessage } from './sessionQueue'
