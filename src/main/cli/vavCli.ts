/**
 * Public `vav` CLI surface — parse / resolve / error text. The process
 * entry (`vavRemoteCli.ts`) only talks to a running vavd.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import { formatConnectHint, pairingAuthFromInput } from '../daemon/webUiHelpers.ts'
import { resolveVavdVersion } from '../daemon/vavdArgs.ts'

export const VAV_CLI_VALUE_FLAGS = new Set([
  '--uri',
  '--host',
  '--port',
  '--secret',
  '--state',
  '--session',
  '--model',
  '--approval',
  '--thinking',
  '--device',
  '--tool',
  '--answer'
])

export type VavCliVerb = 'sessions' | 'create' | 'send' | 'thread' | 'configure' | 'cancel' | 'reply'

export type VavCliTarget = {
  host: string
  port: number
  secret: string
}

export type VavParsedCli =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | { kind: 'command'; verb: VavCliVerb; rest: string[]; flags: Map<string, string> }

const VERBS = new Set<string>(['sessions', 'create', 'send', 'thread', 'configure', 'cancel', 'reply', 'help'])

export function parsePortNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw.trim())) throw new Error(`--port must be an integer 0–65535 (got ${raw})`)
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be an integer 0–65535 (got ${raw})`)
  }
  return port
}

export function parseVavCliArgs(argv: string[]): VavParsedCli {
  const args = argv[0]?.endsWith('node') || argv[0]?.endsWith('node.exe') ? argv.slice(2) : argv
  if (args.includes('--help') || args.includes('-h') || args.length === 0) return { kind: 'help' }
  if (args.includes('--version') || args.includes('-V')) return { kind: 'version' }

  const flags = new Map<string, string>()
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=')
      const flag = arg.slice(0, eq)
      if (!VAV_CLI_VALUE_FLAGS.has(flag)) return { kind: 'error', message: `unknown flag: ${flag}` }
      flags.set(flag, arg.slice(eq + 1))
      continue
    }
    if (VAV_CLI_VALUE_FLAGS.has(arg)) {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('-')) {
        return { kind: 'error', message: `${arg} needs a value` }
      }
      flags.set(arg, value)
      i += 1
      continue
    }
    if (arg === '--help' || arg === '-h' || arg === '--version' || arg === '-V') continue
    if (arg.startsWith('-')) return { kind: 'error', message: `unknown flag: ${arg}` }
    positionals.push(arg)
  }

  const verb = positionals[0]
  if (!verb || verb === 'help') return { kind: 'help' }
  if (!VERBS.has(verb)) return { kind: 'error', message: `unknown command: ${verb}` }
  return { kind: 'command', verb: verb as VavCliVerb, rest: positionals.slice(1), flags }
}

function secretFromState(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'secret.json'), 'utf8')) as { secret?: unknown }
    return typeof raw.secret === 'string' && raw.secret.length >= 16 ? raw.secret : null
  } catch {
    return null
  }
}

export function resolveVavTarget(
  flags: Map<string, string>,
  env: NodeJS.ProcessEnv = process.env
): VavCliTarget {
  const uri = flags.get('--uri') || env.VAVD_URI
  if (uri) {
    const parsed = parseDaemonPairing(uri)
    if (!parsed?.secret) throw new Error('unrecognized pairing URI')
    return {
      host: flags.get('--host') || parsed.host || '127.0.0.1',
      port: parsePortNumber(flags.get('--port') || (parsed.port != null ? String(parsed.port) : undefined), 4750),
      secret: flags.get('--secret') || pairingAuthFromInput(uri) || parsed.secret
    }
  }
  const state = flags.get('--state') || join(homedir(), '.vavd')
  const secret = flags.get('--secret') || secretFromState(state)
  if (!secret) {
    throw new Error('no pairing secret: pass --uri / --secret or run vavd first (~/.vavd/secret.json)')
  }
  return {
    host: flags.get('--host') || '127.0.0.1',
    port: parsePortNumber(flags.get('--port'), 4750),
    secret: pairingAuthFromInput(secret) || secret
  }
}

export function formatVavHelp(): string {
  return [
    'vav — control client for a running vavd',
    '',
    '  vav sessions',
    '  vav create',
    '  vav send <text> [--session <id>]',
    '  vav thread [--session <id>]',
    '  vav configure --session <id> [--model <id>] [--approval auto|bypass|edit] [--thinking off|low|medium|high]',
    '  vav cancel --session <id>',
    '  vav reply --session <id> --tool <id> --answer <text>',
    '',
    '  --uri vav-daemon://…   pairing URI (or VAVD_URI)',
    '  --host --port --secret override pieces',
    '  --state <dir>          read secret.json (default ~/.vavd)',
    '  --version, -V          print version',
    '  --help, -h             this help',
    ''
  ].join('\n')
}

export function formatVavVersion(env: NodeJS.ProcessEnv = process.env): string {
  return `vav ${resolveVavdVersion(env)}\n`
}

export function formatVavConnectError(err: unknown, target: { host: string; port: number }): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
  const message = err instanceof Error ? err.message : String(err)
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(message) || /could not reach vavd/.test(message)) {
    return formatConnectHint(target.host, target.port)
  }
  if (/timeout/i.test(message)) return `${formatConnectHint(target.host, target.port)} (${message})`
  return message
}

