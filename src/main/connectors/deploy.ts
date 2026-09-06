import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ConnectorActionResult, ConnectorId } from '@shared/connector'
import { loginPath } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)
const DEPLOY_TIMEOUT_MS = 180_000
const OUTPUT_CAP = 12_000

export type ConnectorCreds = {
  cloudflare: { token: string | null; accountId: string | null }
  supabase: { token: string | null; projectRef: string | null }
  vercel: { token: string | null }
}

function clip(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= OUTPUT_CAP) return trimmed
  return `${trimmed.slice(0, OUTPUT_CAP)}\n… truncated`
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s]+/)
  return match?.[0]
}

async function runCli(
  cwd: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<ConnectorActionResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: DEPLOY_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PATH: loginPath(), ...env }
    })
    const output = clip(`${stdout}\n${stderr}`)
    return {
      ok: true,
      summary: `${command} ${args.join(' ')} finished`,
      url: extractUrl(output),
      output
    }
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
    const output = clip(`${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? e.message ?? ''}`)
    return { ok: false, error: output || `${command} failed`, code: 'deploy-failed' }
  }
}

export async function deployConnector(
  id: ConnectorId,
  cwd: string,
  creds: ConnectorCreds
): Promise<ConnectorActionResult> {
  if (id === 'github') {
    return { ok: false, error: 'GitHub connector is read-only — deploy stays on Actions / Pages.', code: 'read-only' }
  }
  if (id === 'cloudflare') {
    const env: NodeJS.ProcessEnv = {}
    if (creds.cloudflare.token) env.CLOUDFLARE_API_TOKEN = creds.cloudflare.token
    if (creds.cloudflare.accountId) env.CLOUDFLARE_ACCOUNT_ID = creds.cloudflare.accountId
    return runCli(cwd, 'npx', ['--yes', 'wrangler', 'deploy'], env)
  }
  if (id === 'supabase') {
    const env: NodeJS.ProcessEnv = {}
    if (creds.supabase.token) env.SUPABASE_ACCESS_TOKEN = creds.supabase.token
    const args = ['--yes', 'supabase', 'functions', 'deploy']
    if (creds.supabase.projectRef) args.push('--project-ref', creds.supabase.projectRef)
    return runCli(cwd, 'npx', args, env)
  }
  const env: NodeJS.ProcessEnv = {}
  if (creds.vercel.token) env.VERCEL_TOKEN = creds.vercel.token
  return runCli(cwd, 'npx', ['--yes', 'vercel', '--yes'], env)
}
