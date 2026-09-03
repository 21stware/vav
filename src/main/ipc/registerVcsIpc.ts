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

export type VcsIpcCreds = {
  cloudflare: () => { token: string | null; accountId: string | null }
  supabase: () => { token: string | null; projectRef: string | null }
}

/** Git, GitHub, Cloudflare, and Supabase IPC — thin wrappers over the services. */
export function registerVcsIpc(ipcMain: IpcMain, creds: VcsIpcCreds): void {
  ipcMain.handle(IPC.gitStatus, (_event, cwd: string, conversationId?: string) =>
    getGitSnapshot(cwd, conversationId)
  )
  ipcMain.handle(
    IPC.gitDiff,
    (_event, cwd: string, path: string, opts?: { staged?: boolean; conversationId?: string }) =>
      getGitDiff(cwd, path, opts)
  )
  ipcMain.handle(
    IPC.gitShowBase64,
    (_event, cwd: string, path: string, ref?: string, conversationId?: string) =>
      getGitShowBase64(cwd, path, ref || 'HEAD', conversationId)
  )
  ipcMain.handle(IPC.gitInit, (_event, cwd: string, conversationId?: string) =>
    initGitRepo(cwd, conversationId)
  )
  ipcMain.handle(
    IPC.gitCreateBranch,
    (_event, cwd: string, name: string, opts?: { checkout?: boolean; conversationId?: string }) =>
      createGitBranch(cwd, name, opts)
  )
  ipcMain.handle(IPC.gitCheckoutBranch, (_event, cwd: string, name: string, conversationId?: string) =>
    checkoutGitBranch(cwd, name, conversationId)
  )
  ipcMain.handle(
    IPC.gitCreateWorktree,
    (
      _event,
      cwd: string,
      options: { path: string; newBranch?: string; branch?: string },
      conversationId?: string
    ) => createGitWorktree(cwd, options, conversationId)
  )
  ipcMain.handle(
    IPC.githubListPulls,
    (_event, cwd: string, state?: import('@shared/github').GithubPullStateFilter) =>
      listGithubPulls(cwd, state)
  )
  ipcMain.handle(IPC.githubGetPull, (_event, cwd: string, number: number) =>
    getGithubPull(cwd, number)
  )
  ipcMain.handle(
    IPC.cloudflareStatus,
    (_event, cwd: string, query?: import('@shared/cloudflare').CloudflareStatusQuery) =>
      getCloudflareStatus(
        String(cwd || ''),
        creds.cloudflare(),
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
  )
  ipcMain.handle(
    IPC.supabaseStatus,
    (_event, cwd: string, query?: import('@shared/supabase').SupabaseStatusQuery) =>
      getSupabaseStatus(
        String(cwd || ''),
        creds.supabase(),
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
  )
  ipcMain.handle(
    IPC.githubListActions,
    (_event, cwd: string, scope?: import('@shared/github').GithubActionsScope) =>
      listGithubActions(cwd, scope)
  )
  ipcMain.handle(IPC.githubGetActionRun, (_event, cwd: string, runId: number) =>
    getGithubActionRun(cwd, runId)
  )
  ipcMain.handle(IPC.githubGetSite, (_event, cwd: string) => getGithubSite(cwd))
  ipcMain.handle(IPC.githubListReleases, (_event, cwd: string) => listGithubReleases(cwd))
}
