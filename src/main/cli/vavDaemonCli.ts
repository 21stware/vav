/**
 * Daemon-role RPC used by vav-board for files, PTY panes, host info, and logs.
 * Same pairing secret as the phone plane; different hello.role.
 */
import { DaemonClient } from '../daemon/DaemonClient.ts'
import type { VavServerTarget } from './vavServerTarget.ts'
import { printJson, printLine } from './vavControl.ts'

export type DaemonRpc = {
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>
  onStream: (id: string, handler: (event: string, data: unknown) => void) => void
  close: () => void
}

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

export async function connectDaemonTarget(target: VavServerTarget, device = 'vav-board'): Promise<DaemonRpc> {
  if (target.kind !== 'tcp') {
    throw new Error('file / pane / host commands need a TCP vav-server (pass --uri or --state)')
  }
  const client = new DaemonClient()
  await client.connect({
    host: target.host,
    port: target.port,
    secret: target.secret,
    device
  })
  return client
}

export async function withDaemon<T>(
  target: VavServerTarget,
  fn: (rpc: DaemonRpc) => Promise<T>
): Promise<T> {
  const rpc = await connectDaemonTarget(target)
  try {
    return await fn(rpc)
  } finally {
    rpc.close()
  }
}

export async function hostInfo(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('host.info')
}

export async function hostPairing(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('host.pairing')
}

export async function hostRotateOffer(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('host.rotateOffer')
}

export async function hostIncoming(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('host.incoming')
}

export async function hostDisconnectIncoming(rpc: DaemonRpc, grantId: string): Promise<unknown> {
  if (!grantId) throw new Error('vav-board host disconnect <grantId>')
  return rpc.request('host.disconnectIncoming', { grantId })
}

export async function hostUnpairIncoming(rpc: DaemonRpc, grantId: string): Promise<unknown> {
  if (!grantId) throw new Error('vav-board host unpair <grantId>')
  return rpc.request('host.unpairIncoming', { grantId })
}

export async function listFiles(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file list <path>')
  return rpc.request('fs.readdir', { path })
}

export async function statFile(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file stat <path>')
  return rpc.request('fs.stat', { path })
}

export async function readFileText(rpc: DaemonRpc, path: string): Promise<{ path: string; text: string; bytes: number }> {
  if (!path) throw new Error('vav-board file read <path>')
  const result = (await rpc.request('fs.readFile', { path }, 120_000)) as { base64?: string }
  const buf = Buffer.from(result.base64 ?? '', 'base64')
  return { path, text: buf.toString('utf8'), bytes: buf.length }
}

export async function writeFileText(rpc: DaemonRpc, path: string, text: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file write <path> --text <body>')
  return rpc.request('fs.writeFile', { path, text, encoding: 'utf8' })
}

export async function revealFile(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file reveal <path>')
  return rpc.request('fs.reveal', { path })
}

export async function openFile(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file open <path>')
  return rpc.request('fs.openPath', { path })
}

export async function getInfoFile(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file info <path>')
  return rpc.request('fs.getInfo', { path })
}

export async function mkdirFile(rpc: DaemonRpc, path: string, recursive = true): Promise<unknown> {
  if (!path) throw new Error('vav-board file mkdir <path>')
  return rpc.request('fs.mkdir', { path, recursive })
}

export async function renameFile(rpc: DaemonRpc, from: string, to: string): Promise<unknown> {
  if (!from || !to) throw new Error('vav-board file rename <from> <to>')
  return rpc.request('fs.rename', { from, to })
}

export async function unlinkFile(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file rm <path>')
  return rpc.request('fs.unlink', { path })
}

export async function existsFile(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file exists <path>')
  return rpc.request('fs.exists', { path })
}

export async function spawnPane(
  rpc: DaemonRpc,
  opts: { file?: string; cwd?: string; cols?: number; rows?: number }
): Promise<{ stream: string; pid: number }> {
  const file = opts.file || defaultShell()
  const spawned = (await rpc.request('pty.spawn', {
    file,
    args: [],
    opts: {
      cwd: opts.cwd,
      cols: opts.cols || 80,
      rows: opts.rows || 24
    }
  })) as { stream?: string; pid?: number }
  if (!spawned.stream) throw new Error('pty.spawn failed')
  return { stream: spawned.stream, pid: spawned.pid ?? 0 }
}

export async function writePane(rpc: DaemonRpc, stream: string, data: string): Promise<unknown> {
  if (!stream) throw new Error('vav-board pane write <stream> <text>')
  return rpc.request('pty.write', { stream, data })
}

export async function killPane(rpc: DaemonRpc, stream: string, signal?: string): Promise<unknown> {
  if (!stream) throw new Error('vav-board pane kill <stream>')
  return rpc.request('pty.kill', { stream, ...(signal ? { signal } : {}) })
}

export async function runProcessCommand(
  rpc: DaemonRpc,
  opts: { cwd?: string; command: string; timeoutMs?: number }
): Promise<{ stream: string; pid: number; output: string }> {
  const file = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
  const args = process.platform === 'win32' ? ['/c', opts.command] : ['-lc', opts.command]
  const spawned = (await rpc.request('process.spawn', {
    file,
    args,
    opts: { cwd: opts.cwd }
  })) as { stream?: string; pid?: number }
  if (!spawned.stream) throw new Error('process.spawn failed')
  let output = ''
  let closed = false
  rpc.onStream(spawned.stream, (event, data) => {
    if ((event === 'stdout' || event === 'stderr') && data && typeof data === 'object') {
      const raw = (data as { base64?: unknown }).base64
      if (typeof raw === 'string') output += Buffer.from(raw, 'base64').toString('utf8')
    }
    if (event === 'close' || event === 'exit') closed = true
  })
  const deadline = Date.now() + (opts.timeoutMs ?? 8_000)
  while (!closed && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return { stream: spawned.stream, pid: spawned.pid ?? 0, output }
}

export async function runPaneCommand(
  rpc: DaemonRpc,
  opts: { cwd?: string; file?: string; command: string; timeoutMs?: number }
): Promise<{ stream: string; pid: number; output: string }> {
  return runProcessCommand(rpc, opts)
}

export async function listRecentWorkspaces(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('workspace.recents')
}

export async function getDaemonSession(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('session id required')
  return rpc.request('sessions.get', { id })
}

export async function queryLogs(rpc: DaemonRpc, query: Record<string, unknown> = {}): Promise<unknown> {
  return rpc.request('logs.query', query)
}

export async function logsStats(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('logs.stats')
}

export async function clearLogs(rpc: DaemonRpc, scope = 'all'): Promise<unknown> {
  return rpc.request('logs.clear', { scope })
}

export async function exportLogs(rpc: DaemonRpc, query: Record<string, unknown> = {}): Promise<unknown> {
  return rpc.request('logs.export', query)
}

export async function recordLog(
  rpc: DaemonRpc,
  input: { event: string; message: string; conversationId?: string }
): Promise<unknown> {
  if (!input.event || !input.message) {
    throw new Error('vav-board logs record --event NAME --message TEXT')
  }
  return rpc.request('logs.record', {
    channel: 'user',
    event: input.event,
    message: input.message,
    conversationId: input.conversationId
  })
}

export async function tailLogs(
  rpc: DaemonRpc,
  opts: {
    count?: number
    timeoutMs?: number
    event?: string
    message?: string
    conversationId?: string
  } = {}
): Promise<{ stream: string; records: unknown[] }> {
  const started = (await rpc.request('logs.subscribe')) as { stream?: string }
  const stream = started.stream || ''
  if (!stream) throw new Error('logs.subscribe failed')
  const records: unknown[] = []
  const want = opts.count && opts.count > 0 ? opts.count : 0
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : want ? 8_000 : 2_000
  rpc.onStream(stream, (event, data) => {
    if (event === 'append') records.push(data)
  })
  if (opts.event && opts.message) {
    await recordLog(rpc, {
      event: opts.event,
      message: opts.message,
      conversationId: opts.conversationId
    })
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && (!want || records.length < want)) {
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  await rpc.request('logs.unsubscribe', { stream }).catch(() => undefined)
  return { stream, records }
}

export async function gitStatus(rpc: DaemonRpc, cwd: string): Promise<unknown> {
  if (!cwd) throw new Error('vav-board git status [cwd]')
  return rpc.request('git.status', { cwd })
}

export async function gitDiff(
  rpc: DaemonRpc,
  cwd: string,
  path: string,
  staged = false
): Promise<unknown> {
  if (!cwd || !path) throw new Error('vav-board git diff <path> [--cwd PATH]')
  return rpc.request('git.diff', { cwd, path, staged })
}

export async function gitInit(rpc: DaemonRpc, cwd: string): Promise<unknown> {
  if (!cwd) throw new Error('vav-board git init [cwd]')
  return rpc.request('git.init', { cwd })
}

export async function gitCreateBranch(
  rpc: DaemonRpc,
  cwd: string,
  name: string,
  checkout = false
): Promise<unknown> {
  if (!cwd || !name) throw new Error('vav-board git branch <name> [--cwd PATH] [--checkout]')
  return rpc.request('git.createBranch', { cwd, name, checkout })
}

export async function gitCheckoutBranch(rpc: DaemonRpc, cwd: string, name: string): Promise<unknown> {
  if (!cwd || !name) throw new Error('vav-board git checkout <name> [--cwd PATH]')
  return rpc.request('git.checkoutBranch', { cwd, name })
}

export async function gitCreateWorktree(
  rpc: DaemonRpc,
  cwd: string,
  path: string,
  opts?: { newBranch?: string; branch?: string }
): Promise<unknown> {
  if (!cwd || !path) throw new Error('vav-board git worktree <path> [--new-branch NAME|--branch NAME] [--cwd PATH]')
  return rpc.request('git.createWorktree', {
    cwd,
    path,
    newBranch: opts?.newBranch,
    branch: opts?.branch
  })
}

export async function gitShowBase64(
  rpc: DaemonRpc,
  cwd: string,
  path: string,
  ref = 'HEAD'
): Promise<unknown> {
  if (!cwd || !path) throw new Error('vav-board git show <path> [--ref REF] [--cwd PATH]')
  return rpc.request('git.showBase64', { cwd, path, ref })
}

export async function listPlugins(rpc: DaemonRpc, host = 'vav'): Promise<unknown> {
  return rpc.request('plugins.list', { host })
}

export async function createPlugin(rpc: DaemonRpc, kind: string, name: string): Promise<unknown> {
  if (!kind || !name) throw new Error('vav-board plugins create <skill|mcp|hook|plugin> <name>')
  return rpc.request('plugins.create', { kind, name })
}

export async function setPluginEnabled(
  rpc: DaemonRpc,
  host: string,
  pluginId: string,
  enabled: boolean
): Promise<unknown> {
  if (!pluginId) throw new Error('vav-board plugins enable|disable <id>')
  return rpc.request('plugins.setEnabled', { host: host || 'vav', pluginId, enabled })
}

export async function writePluginConfig(rpc: DaemonRpc, path: string, content: string): Promise<unknown> {
  if (!path) throw new Error('vav-board plugins write <path> --text BODY')
  return rpc.request('plugins.write', { path, content })
}

export async function listGithubPulls(
  rpc: DaemonRpc,
  cwd: string,
  state?: string
): Promise<unknown> {
  if (!cwd) throw new Error('vav-board github pulls [cwd]')
  return rpc.request('github.listPulls', { cwd, state })
}

export async function getGithubPullCli(rpc: DaemonRpc, cwd: string, number: string): Promise<unknown> {
  const n = Number(number)
  if (!cwd || !Number.isInteger(n) || n <= 0) throw new Error('vav-board github pull <number> [--cwd PATH]')
  return rpc.request('github.getPull', { cwd, number: n })
}

export async function listGithubActionsCli(
  rpc: DaemonRpc,
  cwd: string,
  scope?: string
): Promise<unknown> {
  if (!cwd) throw new Error('vav-board github actions [cwd]')
  return rpc.request('github.listActions', { cwd, scope })
}

export async function getGithubActionRunCli(
  rpc: DaemonRpc,
  cwd: string,
  runId: string
): Promise<unknown> {
  const n = Number(runId)
  if (!cwd || !Number.isInteger(n) || n <= 0) throw new Error('vav-board github run <id> [--cwd PATH]')
  return rpc.request('github.getActionRun', { cwd, runId: n })
}

export async function listGithubReleasesCli(rpc: DaemonRpc, cwd: string): Promise<unknown> {
  if (!cwd) throw new Error('vav-board github releases [cwd]')
  return rpc.request('github.listReleases', { cwd })
}

export async function getGithubSiteCli(rpc: DaemonRpc, cwd: string): Promise<unknown> {
  if (!cwd) throw new Error('vav-board github pages [cwd]')
  return rpc.request('github.getSite', { cwd })
}

export async function listTimers(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('timers.listJobs')
}

export async function createTimer(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('timers.createScheduled')
}

export async function runTimer(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board timers run <id>')
  return rpc.request('timers.runNow', { id })
}

export async function removeTimer(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board timers remove <id>')
  return rpc.request('timers.removeJob', { id })
}

export async function listTimerRuns(rpc: DaemonRpc, jobId?: string): Promise<unknown> {
  return rpc.request('timers.listRuns', jobId ? { jobId } : {})
}

export async function listTimerSessions(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('timers.listSessions')
}

export type TimerCliPatch = {
  title?: string
  prompt?: string
  enabled?: boolean
  schedule?: { kind: 'cron'; expr: string } | { kind: 'interval'; everyMs: number } | { kind: 'once'; at: number }
  sourceWorkdir?: string
}

export function parseTimerPatch(tokens: string[]): TimerCliPatch {
  const patch: TimerCliPatch = {}
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i] ?? ''
    const eq = raw.indexOf('=')
    const key = eq > 0 && raw.startsWith('--') ? raw.slice(0, eq) : raw
    const inline = eq > 0 && raw.startsWith('--') ? raw.slice(eq + 1) : undefined
    const value = inline ?? tokens[i + 1]
    if (!key.startsWith('--') || value == null || value.startsWith('--')) continue
    if (inline == null) i += 1
    if (key === '--title') patch.title = value
    else if (key === '--prompt') patch.prompt = value
    else if (key === '--enabled') patch.enabled = value !== 'off' && value !== 'false' && value !== '0'
    else if (key === '--cron') patch.schedule = { kind: 'cron', expr: value }
    else if (key === '--every-ms' || key === '--everyMs') {
      const everyMs = Number(value)
      if (Number.isFinite(everyMs) && everyMs > 0) patch.schedule = { kind: 'interval', everyMs }
    } else if (key === '--once-at' || key === '--onceAt') {
      const at = Number(value)
      if (Number.isFinite(at)) patch.schedule = { kind: 'once', at }
    } else if (key === '--cwd' || key === '--workdir') patch.sourceWorkdir = value
  }
  return patch
}

export async function updateTimer(
  rpc: DaemonRpc,
  id: string,
  patch: TimerCliPatch
): Promise<unknown> {
  if (!id) throw new Error('vav-board timers update <id> [--title TEXT] [--prompt TEXT] [--enabled on|off]')
  if (!Object.keys(patch).length) {
    throw new Error('vav-board timers update <id> [--title TEXT] [--prompt TEXT] [--enabled on|off]')
  }
  return rpc.request('timers.updateJob', { id, patch })
}

export async function getTimerForConversation(rpc: DaemonRpc, conversationId: string): Promise<unknown> {
  if (!conversationId) throw new Error('vav-board timers get <conversationId>')
  return rpc.request('timers.getJobForConversation', { conversationId })
}

export async function createTimerJob(rpc: DaemonRpc, input: TimerCliPatch & { title: string; prompt: string }): Promise<unknown> {
  const schedule = input.schedule ?? { kind: 'cron', expr: '0 9 * * *' }
  return rpc.request('timers.createJob', {
    input: {
      title: input.title,
      prompt: input.prompt,
      schedule,
      enabled: input.enabled,
      sourceWorkdir: input.sourceWorkdir
    }
  })
}

export async function listConnectors(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('connectors.catalog')
}

export async function connectorAct(
  rpc: DaemonRpc,
  connector: string,
  action: string,
  cwd: string,
  conversationId?: string
): Promise<unknown> {
  if (!connector || !action || !cwd) {
    throw new Error('vav-board connectors act <id> <action> [--cwd PATH]')
  }
  return rpc.request('connectors.act', {
    request: { connector, action, cwd, conversationId }
  })
}

export async function openFileSession(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file-session open <path>')
  return rpc.request('fileSessions.open', { path })
}

export async function listFileSessions(rpc: DaemonRpc, fileId?: string): Promise<unknown> {
  if (fileId) return rpc.request('fileSessions.list', { fileId })
  return rpc.request('fileSessions.listAll')
}

export async function createFileSession(rpc: DaemonRpc, path: string): Promise<unknown> {
  if (!path) throw new Error('vav-board file-session create <path>')
  return rpc.request('fileSessions.create', { path })
}

export async function renameFileSession(
  rpc: DaemonRpc,
  fileId: string,
  sessionId: string,
  title: string
): Promise<unknown> {
  if (!fileId || !sessionId || !title) {
    throw new Error('vav-board file-session rename <fileId> <sessionId> <title>')
  }
  return rpc.request('fileSessions.rename', { fileId, sessionId, title })
}

export async function deleteFileSessions(
  rpc: DaemonRpc,
  fileId: string,
  sessionIds: string[]
): Promise<unknown> {
  if (!fileId || sessionIds.length === 0) {
    throw new Error('vav-board file-session delete <fileId> <sessionId…>')
  }
  return rpc.request('fileSessions.delete', { fileId, sessionIds })
}

export async function activateFileSession(
  rpc: DaemonRpc,
  fileId: string,
  sessionId: string
): Promise<unknown> {
  if (!fileId || !sessionId) {
    throw new Error('vav-board file-session activate <fileId> <sessionId>')
  }
  return rpc.request('fileSessions.setActive', { fileId, sessionId })
}

export async function forceDeleteFileSessions(
  rpc: DaemonRpc,
  fileId: string,
  sessionIds: string[]
): Promise<unknown> {
  if (!fileId || sessionIds.length === 0) {
    throw new Error('vav-board file-session force-delete <fileId> <sessionId…>')
  }
  return rpc.request('fileSessions.forceDelete', { fileId, sessionIds })
}

export async function setFileSessionReadOnly(
  rpc: DaemonRpc,
  sessionId: string,
  readOnly: boolean
): Promise<unknown> {
  if (!sessionId) throw new Error('vav-board file-session readonly <sessionId> [on|off]')
  return rpc.request('fileSessions.setReadOnly', { sessionId, readOnly })
}

export async function listAccounts(rpc: DaemonRpc, workspaceKey?: string): Promise<unknown> {
  return rpc.request('accounts.getPage', { workspaceKey })
}

export async function createAccount(
  rpc: DaemonRpc,
  input: { name: string; endpoint: string; apiKey: string; agentId?: string }
): Promise<unknown> {
  if (!input.name || !input.endpoint || !input.apiKey) {
    throw new Error('vav-board account add --name TEXT --endpoint URL --key TOKEN')
  }
  return rpc.request('accounts.createVav', input)
}

export async function draftAccount(rpc: DaemonRpc, agentId?: string): Promise<unknown> {
  return rpc.request('accounts.createDraft', { agentId, kind: 'vav_key' })
}

export async function getHostSettings(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('settings.get')
}

export async function updateHostSettings(
  rpc: DaemonRpc,
  patch: Record<string, unknown>
): Promise<unknown> {
  return rpc.request('settings.update', patch)
}

const SETTINGS_SECRET_SLOTS = new Set([
  'api',
  'braveSearch',
  'tinyfish',
  'cloudflare',
  'supabase',
  'vercel'
])

function asSettingsSlot(slot: string): string {
  const name = slot.trim()
  if (!SETTINGS_SECRET_SLOTS.has(name)) {
    throw new Error('vav-board settings secret <api|braveSearch|tinyfish|cloudflare|supabase|vercel>')
  }
  return name
}

export async function setHostSecret(rpc: DaemonRpc, slot: string, value: string): Promise<unknown> {
  if (!value) throw new Error('vav-board settings secret <slot> --set TOKEN')
  return rpc.request('settings.setSecret', { slot: asSettingsSlot(slot), value })
}

export async function hintHostSecret(rpc: DaemonRpc, slot: string): Promise<unknown> {
  return rpc.request('settings.secretHint', { slot: asSettingsSlot(slot) })
}

export async function revealHostSecret(rpc: DaemonRpc, slot: string): Promise<unknown> {
  return rpc.request('settings.revealSecret', { slot: asSettingsSlot(slot) })
}

export async function removeAccount(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board account remove <id>')
  return rpc.request('accounts.remove', { id })
}

export async function updateAccount(
  rpc: DaemonRpc,
  id: string,
  patch: { alias?: string; endpoint?: string; apiKey?: string }
): Promise<unknown> {
  if (!id || (!patch.alias && !patch.endpoint && !patch.apiKey)) {
    throw new Error('vav-board account update <id> [--alias TEXT] [--endpoint URL] [--key TOKEN]')
  }
  return rpc.request('accounts.updateVav', { id, ...patch })
}

export async function setCurrentAccount(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board account current <id>')
  return rpc.request('accounts.setCurrent', { id })
}

export async function activateAccount(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board account activate <id>')
  return rpc.request('accounts.activate', { id })
}

export async function verifyAccount(rpc: DaemonRpc, id: string, apiKey?: string): Promise<unknown> {
  if (!id) throw new Error('vav-board account verify <id>')
  return rpc.request('accounts.verify', { id, apiKey })
}

export async function revealAccountKey(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board account reveal <id>')
  return rpc.request('accounts.revealKey', { id })
}

export async function beginAccountOAuth(
  rpc: DaemonRpc,
  agentId: string,
  accountId?: string
): Promise<unknown> {
  if (!agentId) throw new Error('vav-board account oauth --agent ID')
  return rpc.request('accounts.beginOAuth', { agentId, accountId })
}

export async function cancelAccountOAuth(rpc: DaemonRpc, agentId: string): Promise<unknown> {
  if (!agentId) throw new Error('vav-board account cancel --agent ID')
  return rpc.request('accounts.cancelOAuth', { agentId })
}

export async function signOutAccount(rpc: DaemonRpc, agentId: string): Promise<unknown> {
  if (!agentId) throw new Error('vav-board account signout --agent ID')
  return rpc.request('accounts.signOut', { agentId })
}

export async function beginConnectorLogin(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board connectors login <github|cloudflare|supabase|vercel>')
  return rpc.request('connectors.beginLogin', { id })
}

export async function cancelConnectorLoginCli(rpc: DaemonRpc, id?: string): Promise<unknown> {
  return rpc.request('connectors.cancelLogin', { id })
}

export async function connectorAuthStatus(rpc: DaemonRpc): Promise<unknown> {
  return rpc.request('connectors.authStatus')
}

export async function probeConnectors(rpc: DaemonRpc, cwd?: string): Promise<unknown> {
  return rpc.request('connectors.probe', { cwd: cwd || '' })
}

export async function connectorVendorStatus(
  rpc: DaemonRpc,
  vendor: string,
  cwd?: string
): Promise<unknown> {
  const id = vendor.trim().toLowerCase()
  if (id !== 'cloudflare' && id !== 'supabase' && id !== 'vercel') {
    throw new Error('vav-board connectors status <cloudflare|supabase|vercel> [--cwd PATH]')
  }
  return rpc.request(`${id}.status`, { cwd: cwd || process.cwd() })
}

export async function seedReview(rpc: DaemonRpc, conversationId: string): Promise<unknown> {
  if (!conversationId) throw new Error('vav-board review seed <sessionId>')
  return rpc.request('changeSets.seedReview', { conversationId })
}

export async function activeReview(rpc: DaemonRpc, conversationId: string): Promise<unknown> {
  if (!conversationId) throw new Error('vav-board review active <sessionId>')
  return rpc.request('changeSets.active', { conversationId })
}

export async function getReview(rpc: DaemonRpc, id: string): Promise<unknown> {
  if (!id) throw new Error('vav-board review get <setId>')
  return rpc.request('changeSets.get', { id })
}

export async function acceptReview(rpc: DaemonRpc, setId: string, filePaths: string[]): Promise<unknown> {
  if (!setId) throw new Error('vav-board review accept <setId> [path…]')
  return rpc.request('changeSets.accept', { setId, filePaths })
}

export async function rejectReview(rpc: DaemonRpc, setId: string, filePaths: string[]): Promise<unknown> {
  if (!setId) throw new Error('vav-board review reject <setId> [path…]')
  return rpc.request('changeSets.reject', { setId, filePaths })
}

export async function acceptAllReview(rpc: DaemonRpc, setId: string): Promise<unknown> {
  if (!setId) throw new Error('vav-board review accept-all <setId>')
  return rpc.request('changeSets.acceptAll', { setId })
}

export async function rejectAllReview(rpc: DaemonRpc, setId: string): Promise<unknown> {
  if (!setId) throw new Error('vav-board review reject-all <setId>')
  return rpc.request('changeSets.rejectAll', { setId })
}

export async function undoReview(rpc: DaemonRpc, setId: string, filePath: string): Promise<unknown> {
  if (!setId || !filePath) throw new Error('vav-board review undo <setId> <path>')
  return rpc.request('changeSets.undo', { setId, filePath })
}

export function printDaemonJson(value: unknown): void {
  printJson(value)
}

export function printDaemonText(value: string): void {
  printLine(value)
}
