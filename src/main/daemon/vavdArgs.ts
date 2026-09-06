/**
 * Public CLI surface for `vavd`. Parsed once so the long-running process and
 * unit tests share the same flag / verb / error rules.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DAEMON_DEFAULT_PORT } from '../../shared/daemonProtocol.ts'
import { VAVD_WEB_DEFAULT_PORT } from '../../shared/vavDiscover.ts'
import { DAEMON_LAN_BIND } from './DaemonServer.ts'

export { VAVD_WEB_DEFAULT_PORT }

export type VavdAdminVerb = 'clients' | 'disconnect' | 'unpair' | 'rotate-offer'

export type VavdServeOptions = {
  stateDir: string
  name?: string
  port: number
  listen: string
  webPort: number
  webListen: string
  web: boolean
  announce: boolean
  quiet: boolean
  apiKey?: string
  apiEndpoint?: string
}

export type VavdParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | { kind: 'admin'; command: VavdAdminVerb; id?: string; stateDir: string }
  | { kind: 'serve'; options: VavdServeOptions }

const ADMIN_VERBS = new Set<string>(['clients', 'disconnect', 'unpair', 'rotate-offer'])

const VALUE_FLAGS = new Set([
  '--state',
  '--port',
  '--listen',
  '--name',
  '--web-port',
  '--web-listen',
  '--api-key',
  '--api-endpoint'
])

const BOOL_FLAGS = new Set(['--help', '-h', '--version', '-V', '--no-announce', '--no-web', '--quiet'])

export function parsePortFlag(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback
  const trimmed = raw.trim()
  if (!trimmed) throw new Error(`${flag} needs a number (0–65535; 0 = ephemeral)`)
  if (!/^\d+$/.test(trimmed)) throw new Error(`${flag} must be an integer 0–65535 (got ${raw})`)
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${flag} must be an integer 0–65535 (got ${raw})`)
  }
  return port
}

export function parseListenFlag(raw: string | undefined, flag: string, fallback: string): string {
  if (raw === undefined) return fallback
  const trimmed = raw.trim()
  if (!trimmed) throw new Error(`${flag} needs a bind address`)
  return trimmed
}

function splitArgv(argv: string[]): { flags: Map<string, string | true>; positionals: string[]; error?: string } {
  const flags = new Map<string, string | true>()
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=')
      const flag = arg.slice(0, eq)
      const value = arg.slice(eq + 1)
      if (VALUE_FLAGS.has(flag)) {
        flags.set(flag, value)
        continue
      }
      if (BOOL_FLAGS.has(flag)) {
        flags.set(flag, true)
        continue
      }
      return { flags, positionals, error: `unknown flag: ${flag}` }
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) {
        return { flags, positionals, error: `${arg} needs a value` }
      }
      flags.set(arg, value)
      i += 1
      continue
    }
    if (BOOL_FLAGS.has(arg)) {
      flags.set(arg, true)
      continue
    }
    if (arg.startsWith('-')) {
      return { flags, positionals, error: `unknown flag: ${arg}` }
    }
    positionals.push(arg)
  }
  return { flags, positionals }
}

export function parseVavdArgs(
  argv: string[],
  opts: { home?: string } = {}
): VavdParsedArgs {
  const args = argv[0]?.endsWith('node') || argv[0]?.endsWith('node.exe') ? argv.slice(2) : argv
  const { flags, positionals, error } = splitArgv(args)
  if (error) return { kind: 'error', message: error }
  if (flags.has('--help') || flags.has('-h')) return { kind: 'help' }
  if (flags.has('--version') || flags.has('-V')) return { kind: 'version' }

  const home = opts.home ?? homedir()
  const stateRaw = flags.get('--state')
  const stateDir =
    typeof stateRaw === 'string' && stateRaw.trim() ? stateRaw.trim() : join(home, '.vavd')

  const verb = positionals[0]
  if (verb && ADMIN_VERBS.has(verb)) {
    const extra = positionals.slice(1)
    if (verb === 'clients' && extra.length > 0) {
      return { kind: 'error', message: 'clients does not take an id — use disconnect / unpair <id>' }
    }
    if ((verb === 'disconnect' || verb === 'unpair') && extra.length > 1) {
      return { kind: 'error', message: `usage: vavd ${verb} <grant-id>` }
    }
    return {
      kind: 'admin',
      command: verb as VavdAdminVerb,
      id: extra[0],
      stateDir
    }
  }
  if (verb) return { kind: 'error', message: `unknown command: ${verb}` }

  try {
    const port = parsePortFlag(
      typeof flags.get('--port') === 'string' ? (flags.get('--port') as string) : undefined,
      '--port',
      DAEMON_DEFAULT_PORT
    )
    const webPort = parsePortFlag(
      typeof flags.get('--web-port') === 'string' ? (flags.get('--web-port') as string) : undefined,
      '--web-port',
      VAVD_WEB_DEFAULT_PORT
    )
    const listen = parseListenFlag(
      typeof flags.get('--listen') === 'string' ? (flags.get('--listen') as string) : undefined,
      '--listen',
      DAEMON_LAN_BIND
    )
    const webListen = parseListenFlag(
      typeof flags.get('--web-listen') === 'string' ? (flags.get('--web-listen') as string) : undefined,
      '--web-listen',
      '127.0.0.1'
    )
    const name = typeof flags.get('--name') === 'string' ? (flags.get('--name') as string).trim() : ''
    const apiKey = typeof flags.get('--api-key') === 'string' ? (flags.get('--api-key') as string) : undefined
    const apiEndpoint =
      typeof flags.get('--api-endpoint') === 'string' ? (flags.get('--api-endpoint') as string) : undefined
    return {
      kind: 'serve',
      options: {
        stateDir,
        name: name || undefined,
        port,
        listen,
        webPort,
        webListen,
        web: !flags.has('--no-web'),
        announce: !flags.has('--no-announce'),
        quiet: flags.has('--quiet'),
        apiKey,
        apiEndpoint
      }
    }
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export function formatVavdHelp(): string {
  return [
    'vavd — headless VAV',
    '',
    '  --port <n>          daemon / control listen port (default 4750; 0 = ephemeral)',
    '  --listen <addr>     bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)',
    '  --web-port <n>      HTTP + WebSocket UI (default 4752; 0 = ephemeral)',
    '  --web-listen <addr> web bind (default 127.0.0.1)',
    '  --name <label>      machine name in pairing',
    '  --state <dir>       identity + secrets + sessions (default ~/.vavd)',
    '  --api-key <key>     VAV provider key (or VAV_API_KEY)',
    '  --api-endpoint <url> provider root (or VAV_API_ENDPOINT)',
    '  --no-announce       skip LAN multicast',
    '  --no-web            disable the web UI',
    '  --quiet             print only the pairing URI',
    '  --version, -V       print version',
    '  --help, -h          this help',
    '',
    '  clients          list authorized computers',
    '  disconnect <id>  drop live sockets; grant remains',
    '  unpair <id>      revoke a computer’s grant',
    '  rotate-offer     invalidate the printed pairing URI; existing grants stay',
    ''
  ].join('\n')
}

export function resolveVavdVersion(
  env: NodeJS.ProcessEnv = process.env,
  fromFile = process.argv[1]
): string {
  const fromEnv = env.npm_package_version?.trim()
  if (fromEnv) return fromEnv
  const start = fromFile ? dirname(fromFile) : process.cwd()
  const dirs = [start, join(start, '..'), join(start, '../..'), join(start, '../../..'), process.cwd()]
  for (const dir of dirs) {
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown }
      if (
        typeof raw.version === 'string' &&
        raw.version &&
        (raw.name === 'vav' || raw.name === '@21stware/vavd')
      ) {
        return raw.version
      }
    } catch {
      /* try next */
    }
  }
  return '0.0.0'
}

export function formatListenError(err: unknown, what: string, bind: string, port: number): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'EADDRINUSE') {
    return `${what} ${bind}:${port} is already in use — pass --port 0 or stop the other process`
  }
  if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
    return `cannot bind ${what} to ${bind} — check --listen`
  }
  return err instanceof Error ? err.message : String(err)
}
