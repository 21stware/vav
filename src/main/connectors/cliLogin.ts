/**
 * Connector CLI login — open the vendor's own browser login.
 *
 * GitHub: `gh auth login -w`
 * Cloudflare: `wrangler login`
 * Supabase: `supabase login`
 * Vercel: `vercel login` (device flow; the CLI opens the browser)
 *
 * Do not invent a client/PKCE stack. Do not open device-code URLs from here —
 * let the CLI open the browser. Clear `CI` so Vercel still does.
 */

import * as pty from 'node-pty'
import { homedir } from 'node:os'
import type { ConnectorId, ConnectorLoginState } from '@shared/connector'
import { loginPath, resolveOnLoginPath } from '../terminal/loginPath'
import { connectorLoginArgv, connectorLoginBin, connectorLoginNpxPackage } from './cliLoginArgv'

const IS_WINDOWS = process.platform === 'win32'

type Job = {
  connector: ConnectorId
  proc: pty.IPty
  cancelled: boolean
}

let job: Job | null = null
let latest: ConnectorLoginState = { connector: null, status: 'idle' }

export function currentConnectorLogin(): ConnectorLoginState {
  return latest
}

export function finishConnectorLogin(
  connector: ConnectorId,
  status: Exclude<ConnectorLoginState['status'], 'running'>,
  message?: string
): void {
  latest = { connector, status, message }
}

export function cancelConnectorLogin(id?: ConnectorId): void {
  const current = job
  if (!current || (id && current.connector !== id)) {
    if (latest.status === 'running' && (!id || latest.connector === id)) {
      latest = { connector: latest.connector, status: 'cancelled' }
    }
    return
  }
  current.cancelled = true
  latest = { connector: current.connector, status: 'cancelled' }
  try {
    current.proc.kill()
  } catch {
    job = null
  }
}

export function resolveConnectorLoginLaunch(
  id: ConnectorId
): { file: string; args: string[] } | { error: 'missing' } {
  const argv = connectorLoginArgv(id)
  const resolved = resolveOnLoginPath(connectorLoginBin(id))
  if (resolved) return { file: resolved, args: argv }
  const pkg = connectorLoginNpxPackage(id)
  const npx = resolveOnLoginPath('npx')
  if (pkg && npx) return { file: npx, args: ['--yes', pkg, ...argv] }
  return { error: 'missing' }
}

export function startConnectorLogin(input: {
  connector: ConnectorId
  onFinished: (result: { cancelled: boolean; exitCode: number | null }) => void
}): void {
  const launch = resolveConnectorLoginLaunch(input.connector)
  if ('error' in launch) {
    throw new Error('missing')
  }
  cancelConnectorLogin()
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: loginPath(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  }
  delete env.CI
  delete env.NO_OPEN_BROWSER
  delete env.FORCE_COLOR
  delete env.NO_COLOR

  latest = { connector: input.connector, status: 'running' }
  const proc = pty.spawn(launch.file, launch.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: homedir(),
    useConpty: IS_WINDOWS,
    env
  })
  const next: Job = { connector: input.connector, proc, cancelled: false }
  job = next

  proc.onExit(({ exitCode }) => {
    if (job === next) job = null
    const cancelled = next.cancelled
    if (cancelled) {
      latest = { connector: input.connector, status: 'cancelled' }
    }
    input.onFinished({ cancelled, exitCode: exitCode ?? null })
  })
}
