import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  checkoutGitBranch,
  createGitBranch,
  createGitWorktree,
  getGitDiff,
  getGitShowBase64,
  getGitSnapshot,
  initGitRepo
} from '../git/GitService'
import {
  getGithubActionRun,
  getGithubPull,
  getGithubSite,
  listGithubActions,
  listGithubPulls,
  listGithubReleases
} from '../github/GithubService'
import { getCloudflareStatus } from '../cloudflare/CloudflareService'
import { getSupabaseStatus } from '../supabase/SupabaseService'

export type VcsIpcRemote = {
  request: (method: string, params?: unknown) => Promise<unknown>
}

export type VcsIpcCreds = {
  cloudflare: () => { token: string | null; accountId: string | null }
  supabase: () => { token: string | null; projectRef: string | null }
  /** Spawned loopback vav-server — Git / vendor trays share the daemon plane Chrome uses. */
  remote?: () => VcsIpcRemote | null
}

/** Git, GitHub, Cloudflare, and Supabase IPC — thin wrappers over the services. */
export function registerVcsIpc(ipcMain: IpcMain, creds: VcsIpcCreds): void {
  const remote = (): VcsIpcRemote | null => creds.remote?.() ?? null

  ipcMain.handle(IPC.gitStatus, async (_event, cwd: string, conversationId?: string) => {
    const client = remote()
    if (client) return client.request('git.status', { cwd, conversationId })
    return getGitSnapshot(cwd, conversationId)
  })
  ipcMain.handle(
    IPC.gitDiff,
    async (_event, cwd: string, path: string, opts?: { staged?: boolean; conversationId?: string }) => {
      const client = remote()
      if (client) return client.request('git.diff', { cwd, path, ...opts })
      return getGitDiff(cwd, path, opts)
    }
  )
  ipcMain.handle(
    IPC.gitShowBase64,
    async (_event, cwd: string, path: string, ref?: string, conversationId?: string) => {
      const client = remote()
      if (client) return client.request('git.showBase64', { cwd, path, ref: ref || 'HEAD', conversationId })
      return getGitShowBase64(cwd, path, ref || 'HEAD', conversationId)
    }
  )
  ipcMain.handle(IPC.gitInit, async (_event, cwd: string, conversationId?: string) => {
    const client = remote()
    if (client) return client.request('git.init', { cwd, conversationId })
    return initGitRepo(cwd, conversationId)
  })
  ipcMain.handle(
    IPC.gitCreateBranch,
    async (_event, cwd: string, name: string, opts?: { checkout?: boolean; conversationId?: string }) => {
      const client = remote()
      if (client) return client.request('git.createBranch', { cwd, name, ...opts })
      return createGitBranch(cwd, name, opts)
    }
  )
  ipcMain.handle(
    IPC.gitCheckoutBranch,
    async (_event, cwd: string, name: string, conversationId?: string) => {
      const client = remote()
      if (client) return client.request('git.checkoutBranch', { cwd, name, conversationId })
      return checkoutGitBranch(cwd, name, conversationId)
    }
  )
  ipcMain.handle(
    IPC.gitCreateWorktree,
    async (
      _event,
      cwd: string,
      options: { path: string; newBranch?: string; branch?: string },
      conversationId?: string
    ) => {
      const client = remote()
      if (client) return client.request('git.createWorktree', { cwd, ...options, conversationId })
      return createGitWorktree(cwd, options, conversationId)
    }
  )
  ipcMain.handle(
    IPC.githubListPulls,
    async (_event, cwd: string, state?: import('@shared/github').GithubPullStateFilter) => {
      const client = remote()
      if (client) return client.request('github.listPulls', { cwd, state })
      return listGithubPulls(cwd, state)
    }
  )
  ipcMain.handle(IPC.githubGetPull, async (_event, cwd: string, number: number) => {
    const client = remote()
    if (client) return client.request('github.getPull', { cwd, number })
    return getGithubPull(cwd, number)
  })
  ipcMain.handle(
    IPC.cloudflareStatus,
    async (_event, cwd: string, query?: import('@shared/cloudflare').CloudflareStatusQuery) => {
      const client = remote()
      if (client) return client.request('cloudflare.status', { cwd, query })
      return getCloudflareStatus(
        String(cwd || ''),
        creds.cloudflare(),
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
    }
  )
  ipcMain.handle(
    IPC.supabaseStatus,
    async (_event, cwd: string, query?: import('@shared/supabase').SupabaseStatusQuery) => {
      const client = remote()
      if (client) return client.request('supabase.status', { cwd, query })
      return getSupabaseStatus(
        String(cwd || ''),
        creds.supabase(),
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
    }
  )
  ipcMain.handle(
    IPC.githubListActions,
    async (_event, cwd: string, scope?: import('@shared/github').GithubActionsScope) => {
      const client = remote()
      if (client) return client.request('github.listActions', { cwd, scope })
      return listGithubActions(cwd, scope)
    }
  )
  ipcMain.handle(IPC.githubGetActionRun, async (_event, cwd: string, runId: number) => {
    const client = remote()
    if (client) return client.request('github.getActionRun', { cwd, runId })
    return getGithubActionRun(cwd, runId)
  })
  ipcMain.handle(IPC.githubGetSite, async (_event, cwd: string) => {
    const client = remote()
    if (client) return client.request('github.getSite', { cwd })
    return getGithubSite(cwd)
  })
  ipcMain.handle(IPC.githubListReleases, async (_event, cwd: string) => {
    const client = remote()
    if (client) return client.request('github.listReleases', { cwd })
    return listGithubReleases(cwd)
  })
}
