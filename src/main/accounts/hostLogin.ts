/**
 * Host CLI OAuth — open the provider's own browser login.
 *
 * Grok: `grok login --oauth` opens `/oauth2/authorize` and listens on
 * `127.0.0.1/callback`. Let the CLI open the browser — do not `openExternal`
 * the same URL or the user gets two tabs. Keep the process alive for the
 * loopback. The “Enter this code” page is device-code / token — never open that.
 *
 * Cursor: `agent login` → cursor.com
 *
 * Do not invent a client/PKCE stack. Do not treat an existing ~/.grok/auth.json
 * (or Cursor keychain) as “this click finished OAuth”.
 */
import * as pty from 'node-pty'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { AccountsOAuthLogin } from '@shared/ipc'
import { loginPath } from '../terminal/loginPath'
import { unwrapAgentLaunch } from '../terminal/unwrapAgentLaunch'
import { loginArgv, logoutArgv } from './hostLoginArgv'
import { loginUrlFromCliOutput } from './hostLoginUrl'

export { loginArgv, logoutArgv }

const execFileAsync = promisify(execFile)
const IS_WINDOWS = process.platform === 'win32'
const LOGOUT_TIMEOUT_MS = 20_000

type Job = {
  agentId: string
  proc: pty.IPty
  cancelled: boolean
}

const jobs = new Map<string, Job>()
let latest: AccountsOAuthLogin | null = null

export function currentOAuthLogin(): AccountsOAuthLogin | null {
  return latest
}

export function runningOAuthAgents(): string[] {
  return [...jobs.keys()]
}

export function finishHostOAuth(
  agentId: string,
  status: Exclude<AccountsOAuthLogin['status'], 'running'>,
  message?: string
): void {
  latest = { agentId, accountId: latest?.agentId === agentId ? latest.accountId : undefined, status, message }
}

export function cancelHostOAuthLogin(agentId: string): void {
  const job = jobs.get(agentId)
  if (!job) {
    if (latest?.agentId === agentId && latest.status === 'running') {
      latest = { agentId, status: 'cancelled' }
    }
    return
  }
  job.cancelled = true
  latest = { agentId, status: 'cancelled' }
  try {
    job.proc.kill()
  } catch {
    jobs.delete(agentId)
  }
}

export function startHostOAuthLogin(input: {
  agentId: string
  accountId?: string
  resolved: string
  onAuthorizeUrl?: (url: string) => void
  onFinished: (result: { cancelled: boolean; exitCode: number | null }) => void
}): void {
  const args = loginArgv(input.agentId)
  if (!args) {
    throw new Error(`oauth login is not supported for ${input.agentId}`)
  }
  cancelHostOAuthLogin(input.agentId)
  const unwrapped = unwrapAgentLaunch(input.resolved, args)
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: loginPath(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...unwrapped.env
  }
  delete env.NO_OPEN_BROWSER
  delete env.FORCE_COLOR
  delete env.NO_COLOR

  latest = { agentId: input.agentId, accountId: input.accountId, status: 'running' }
  const proc = pty.spawn(unwrapped.file, unwrapped.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: homedir(),
    useConpty: IS_WINDOWS,
    env
  })
  const job: Job = { agentId: input.agentId, proc, cancelled: false }
  jobs.set(input.agentId, job)

  let output = ''
  let opened = false
  proc.onData((chunk) => {
    if (opened || job.cancelled) return
    output += chunk
    const url = loginUrlFromCliOutput(output)
    if (!url) return
    opened = true
    input.onAuthorizeUrl?.(url)
  })

  proc.onExit(({ exitCode }) => {
    jobs.delete(input.agentId)
    const cancelled = job.cancelled
    if (cancelled) {
      latest = { agentId: input.agentId, status: 'cancelled' }
    }
    input.onFinished({ cancelled, exitCode: exitCode ?? null })
  })
}

export async function runHostLogout(resolved: string, agentId: string): Promise<void> {
  const args = logoutArgv(agentId)
  if (!args) return
  const unwrapped = unwrapAgentLaunch(resolved, args)
  await execFileAsync(unwrapped.file, unwrapped.args, {
    timeout: LOGOUT_TIMEOUT_MS,
    env: {
      ...process.env,
      PATH: loginPath(),
      ...unwrapped.env
    }
  })
}
