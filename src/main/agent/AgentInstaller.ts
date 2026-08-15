import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import {
  INSTALL_TIMEOUT_MS,
  installLogLine,
  nonInteractiveInstallEnv,
  type AgentInstallRun
} from '@shared/agentInstall'
import { clearLoginPathCache, loginPath } from '../terminal/loginPath'

/**
 * Headless CLI installer.
 *
 * Runs the agent's install one-liner in a plain child process — no PTY, no
 * terminal tab, no window. stdin is /dev/null and the env forces every
 * assume-yes flag, so a script that wants a confirmation gets EOF and exits
 * instead of blocking on a prompt nobody can answer.
 *
 * One run per agent; state is a single sanitized log line the UI can render
 * inline and a terminal status.
 */

type Listener = (runs: AgentInstallRun[]) => void

type ActiveRun = {
  run: AgentInstallRun
  child: ChildProcess
  timeout: NodeJS.Timeout
  killTimer: NodeJS.Timeout | null
  /** Cancel/timeout decide the final status before `close` lands. */
  outcome: 'cancelled' | 'timeout' | null
}

const runs = new Map<string, AgentInstallRun>()
const active = new Map<string, ActiveRun>()
const listeners = new Set<Listener>()

/** Coalesce chatty output into one publish per frame-ish window. */
const PUBLISH_INTERVAL_MS = 120
const KILL_GRACE_MS = 3_000
let publishTimer: NodeJS.Timeout | null = null

export function listAgentInstallRuns(): AgentInstallRun[] {
  return [...runs.values()].map((run) => ({ ...run }))
}

export function onAgentInstallRunsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publishNow(): void {
  if (publishTimer) {
    clearTimeout(publishTimer)
    publishTimer = null
  }
  const snapshot = listAgentInstallRuns()
  for (const listener of listeners) listener(snapshot)
}

function publishSoon(): void {
  if (publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    publishNow()
  }, PUBLISH_INTERVAL_MS)
}

function shellInvocation(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  const shell = process.env.SHELL || '/bin/bash'
  // Login shell so version managers (nvm/fnm/asdf) place their bins on PATH,
  // never interactive — an interactive shell would try to draw a prompt.
  return { file: shell, args: ['-lc', command] }
}

function killTree(entry: ActiveRun, signal: NodeJS.Signals): void {
  const pid = entry.child.pid
  if (!pid) return
  try {
    // Detached child leads its own group; `curl | bash` children die with it.
    if (process.platform === 'win32') entry.child.kill(signal)
    else process.kill(-pid, signal)
  } catch {
    try {
      entry.child.kill(signal)
    } catch {
      // already gone
    }
  }
}

function finish(agentId: string, status: AgentInstallRun['status'], exitCode: number | null): void {
  const entry = active.get(agentId)
  if (entry) {
    clearTimeout(entry.timeout)
    if (entry.killTimer) clearTimeout(entry.killTimer)
    active.delete(agentId)
  }
  const run = runs.get(agentId)
  if (!run) return
  run.status = status
  run.exitCode = exitCode
  run.endedAt = Date.now()
  // A fresh install lands outside the PATH snapshot taken at boot.
  if (status === 'success') clearLoginPathCache()
  publishNow()
}

export function startAgentInstall(payload: {
  agentId: string
  name?: string
  command: string
  cwd?: string
}): { ok: boolean; error?: string } {
  const agentId = payload.agentId?.trim() ?? ''
  const command = payload.command?.trim() ?? ''
  if (!agentId) return { ok: false, error: 'missing-agent' }
  if (!command) return { ok: false, error: 'missing-command' }
  if (active.has(agentId)) return { ok: true }

  const home = homedir()
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
  const { file, args } = shellInvocation(command)

  let child: ChildProcess
  try {
    child = spawn(file, args, {
      cwd: home,
      env: nonInteractiveInstallEnv(process.env, { path: loginPath(), home, shell }),
      // No stdin: any prompt reads EOF and the script bails instead of hanging.
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    })
  } catch (err) {
    runs.set(agentId, {
      agentId,
      name: payload.name?.trim() || agentId,
      status: 'error',
      line: err instanceof Error ? err.message : 'spawn failed',
      startedAt: Date.now(),
      endedAt: Date.now(),
      exitCode: null
    })
    publishNow()
    return { ok: false, error: 'spawn-failed' }
  }

  const run: AgentInstallRun = {
    agentId,
    name: payload.name?.trim() || agentId,
    status: 'running',
    line: command,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null
  }
  runs.set(agentId, run)

  const entry: ActiveRun = {
    run,
    child,
    timeout: setTimeout(() => {
      const current = active.get(agentId)
      if (!current) return
      current.outcome = 'timeout'
      run.line = 'install timed out'
      killTree(current, 'SIGTERM')
    }, INSTALL_TIMEOUT_MS),
    killTimer: null,
    outcome: null
  }
  active.set(agentId, entry)

  const onChunk = (data: Buffer | string): void => {
    run.line = installLogLine(run.line, String(data))
    publishSoon()
  }
  child.stdout?.on('data', onChunk)
  child.stderr?.on('data', onChunk)

  child.on('error', (err) => {
    run.line = err instanceof Error ? err.message : String(err)
    finish(agentId, 'error', null)
  })

  child.on('close', (code) => {
    const outcome = active.get(agentId)?.outcome ?? null
    if (outcome === 'cancelled') {
      finish(agentId, 'cancelled', code)
      return
    }
    if (outcome === 'timeout') {
      finish(agentId, 'error', code)
      return
    }
    finish(agentId, code === 0 ? 'success' : 'error', code)
  })

  publishNow()
  return { ok: true }
}

export function cancelAgentInstall(agentId: string): void {
  const id = agentId?.trim() ?? ''
  const entry = active.get(id)
  if (!entry) {
    // Never started or already settled — just drop any stale row.
    if (runs.delete(id)) publishNow()
    return
  }
  entry.outcome = 'cancelled'
  killTree(entry, 'SIGTERM')
  entry.killTimer = setTimeout(() => {
    if (active.get(id) === entry) killTree(entry, 'SIGKILL')
  }, KILL_GRACE_MS)
  publishNow()
}

/** Drop a settled row once the UI has shown its result. */
export function clearAgentInstall(agentId: string): void {
  const id = agentId?.trim() ?? ''
  if (active.has(id)) return
  if (runs.delete(id)) publishNow()
}

/** App quit: never leave a detached installer behind. */
export function stopAllAgentInstalls(): void {
  for (const [id, entry] of active) {
    entry.outcome = 'cancelled'
    killTree(entry, 'SIGKILL')
    active.delete(id)
  }
  if (publishTimer) {
    clearTimeout(publishTimer)
    publishTimer = null
  }
}
