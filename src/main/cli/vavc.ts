#!/usr/bin/env node
/**
 * vavc — herdr-style control client for a running vavd.
 *
 * Same phone protocol as VAV Remote, the web UI, and the Chrome extension.
 * Sessions on this CLI are the same sessions the desktop app paints.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findVavdEntry, resolveNodeForVavd, vavdNodeArgs } from '../daemon/vavdSpawn.ts'
import { probeListenAlive, readListenState } from '../daemon/listenState.ts'
import {
  archiveSession,
  cancelSession,
  configureSession,
  createSession,
  fetchControls,
  fetchThread,
  listSessions,
  printJson,
  printLine,
  renameSession,
  resolveSession,
  sendTurn,
  setWorkspace,
  waitSessionStatus
} from './vavControl.ts'
import { connectPhoneTarget } from './vavPhoneClient.ts'
import {
  TARGET_FLAGS,
  argValueOrEq,
  defaultStateDirs,
  formatTarget,
  positionalArgs,
  resolveVavdTarget,
  secretFromState
} from './vavdTarget.ts'

const CONTROL_FLAGS = new Set([
  ...TARGET_FLAGS,
  '--cwd',
  '--label',
  '--session',
  '--model',
  '--approval',
  '--thinking',
  '--agent',
  '--kind',
  '--timeout',
  '--until',
  '--listen'
])

const CONTROL_BOOL = new Set(['--json', '--wait', '--focus', '--no-focus', '--force'])

export function vavcHelp(): string {
  return [
    'vavc — control client for a running vavd (herdr-style)',
    '',
    '  vavc status',
    '  vavc server              start vavd in the foreground if none is up',
    '  vavc session list',
    '  vavc session create [--cwd PATH] [--label TEXT] [--model ID]',
    '  vavc session get <id>',
    '  vavc session attach <id>',
    '  vavc session stop <id>',
    '  vavc session delete <id>',
    '  vavc session rename <id> <title>',
    '  vavc workspace list',
    '  vavc workspace create [--cwd PATH] [--label TEXT]',
    '  vavc workspace get <id>',
    '  vavc workspace focus <id> [--cwd PATH]',
    '  vavc workspace close <id>',
    '  vavc agent list',
    '  vavc agent get <id>',
    '  vavc agent prompt <id> <text> [--wait]',
    '  vavc agent wait <id> [--until idle|done|running]',
    '  vavc agent start --kind vav [--cwd PATH] [--label TEXT]',
    '  vavc completion zsh|bash|fish',
    '',
    'Legacy (same as older `vav`):',
    '  vavc sessions | create | send <text> | thread | configure',
    '',
    '  --uri vav-daemon://…   pairing URI (or VAVD_URI)',
    '  --host --port --secret override pieces',
    '  --state <dir>          read secret.json + listen.json (default ~/.vavd)',
    '  --json                 force JSON (list/get already print JSON)',
    ''
  ].join('\n')
}

export function positional(argv: string[], takesValue: Set<string> = CONTROL_FLAGS): string[] {
  return positionalArgs(argv, takesValue, CONTROL_BOOL)
}

function packageVersion(): string {
  try {
    const here = typeof import.meta.dirname === 'string' ? import.meta.dirname : dirname(fileURLToPath(import.meta.url))
    const candidates = [
      join(here, '../../../package.json'),
      join(here, '../../package.json'),
      join(process.cwd(), 'package.json')
    ]
    for (const file of candidates) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
        if (typeof raw.version === 'string' && raw.version) return raw.version
      } catch {
        /* next */
      }
    }
  } catch {
    /* ignore */
  }
  return process.env.npm_package_version || '0.0.0'
}

export function completionScript(shell: string): string {
  if (shell === 'bash') {
    return `complete -W "status server session workspace agent completion sessions create send thread configure help" vavc\n`
  }
  if (shell === 'fish') {
    return [
      'complete -c vavc -f',
      'complete -c vavc -n "__fish_use_subcommand" -a "status server session workspace agent completion"',
      'complete -c vavc -n "__fish_seen_subcommand_from session" -a "list create get attach stop delete rename"',
      'complete -c vavc -n "__fish_seen_subcommand_from workspace" -a "list create get focus close"',
      'complete -c vavc -n "__fish_seen_subcommand_from agent" -a "list get prompt wait start"',
      ''
    ].join('\n')
  }
  return [
    '#compdef vavc',
    '_vavc() {',
    '  local -a cmds',
    '  cmds=(status server session workspace agent completion sessions create send thread configure help)',
    '  _describe "command" cmds',
    '}',
    '_vavc',
    ''
  ].join('\n')
}

async function withPhone<T>(argv: string[], device: string, fn: (phone: Awaited<ReturnType<typeof connectPhoneTarget>>) => Promise<T>): Promise<T> {
  const target = await resolveVavdTarget({ argv })
  const phone = await connectPhoneTarget(target, device)
  try {
    return await fn(phone)
  } finally {
    phone.close()
  }
}

async function statusCommand(argv: string[]): Promise<number> {
  try {
    const target = await resolveVavdTarget({ argv })
    const phone = await connectPhoneTarget(target, 'vavc')
    try {
      const welcome = phone.frames.find((msg) => msg.type === 'welcome')
      const host = phone.frames.find((msg) => msg.type === 'host')
      const sessions = await listSessions(phone)
      printJson({
        ok: true,
        target: formatTarget(target),
        app: welcome && welcome.type === 'welcome' ? welcome.app : 'vavd',
        version: welcome && welcome.type === 'welcome' ? welcome.version : undefined,
        host: host && host.type === 'host' ? { name: host.name, platform: host.platform } : undefined,
        sessions: sessions.length,
        running: sessions.filter((row) => row.status === 'running').length
      })
      return 0
    } finally {
      phone.close()
    }
  } catch (err) {
    printJson({ ok: false, error: err instanceof Error ? err.message : String(err) })
    return 1
  }
}

async function startServer(argv: string[]): Promise<number> {
  const state = argValueOrEq(argv, '--state') || process.env.VAVD_STATE || defaultStateDirs()[0]!
  const listen = readListenState(state)
  if (listen && (await probeListenAlive(listen))) {
    printLine(`vavd already running on ${listen.host}:${listen.port}`)
    const secret = secretFromState(state)
    if (secret) printLine(`pass --state ${state} (or VAVD_URI) to vavc / vavcli`)
    return 0
  }
  const entry = findVavdEntry(process.cwd())
  if (!entry) {
    process.stderr.write('vavd not found — install the VAV app (Settings → Command Line) or npm i -g @21stware/vavd\n')
    return 1
  }
  const flags = ['--state', state]
  const listenAddr = argValueOrEq(argv, '--listen')
  const port = argValueOrEq(argv, '--port')
  if (listenAddr) flags.push('--listen', listenAddr)
  if (port) flags.push('--port', port)
  const node = resolveNodeForVavd()
  const child = spawn(node.cmd, vavdNodeArgs(entry, flags), {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(node.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    }
  })
  const code: number | null = await new Promise((resolve) => {
    child.on('exit', (status) => resolve(status))
  })
  return code ?? 1
}

async function ensureSession(
  phone: Parameters<typeof createSession>[0],
  argv: string[],
  id: string | undefined,
  createIfMissing: boolean
) {
  const sessions = await listSessions(phone)
  const existing = resolveSession(sessions, id, createIfMissing ? 'none' : 'none')
  if (existing) return existing
  if (!createIfMissing) throw new Error('session id required')
  const session = await createSession(phone)
  const cwd = argValueOrEq(argv, '--cwd')
  const label = argValueOrEq(argv, '--label')
  const model = argValueOrEq(argv, '--model')
  if (cwd) await setWorkspace(phone, session.id, cwd)
  if (label) await renameSession(phone, session.id, label)
  if (model) await configureSession(phone, session.id, { model })
  const again = await listSessions(phone)
  return resolveSession(again, session.id) ?? session
}

export async function runVavc(argv: string[] = process.argv): Promise<number> {
  if (argv.includes('--version') || argv.includes('-V')) {
    printLine(packageVersion())
    return 0
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(vavcHelp())
    return 0
  }
  const args = positional(argv)
  const verb = args[0]
  if (!verb || verb === 'help') {
    process.stdout.write(vavcHelp())
    return 0
  }

  if (verb === 'completion' || verb === 'completions') {
    process.stdout.write(completionScript(args[1] || 'zsh'))
    return 0
  }
  if (verb === 'status') {
    return statusCommand(argv)
  }
  if (verb === 'server') {
    if (args[1] === 'stop') {
      process.stderr.write('send SIGTERM to the vavd process (or quit the VAV app that spawned it)\n')
      return 2
    }
    return startServer(argv)
  }

  return withPhone(argv, 'vavc', async (phone) => {
    if (verb === 'sessions' || (verb === 'session' && (args[1] === 'list' || !args[1]))) {
      printJson(await listSessions(phone))
      return 0
    }
    if (verb === 'create' || (verb === 'session' && args[1] === 'create') || (verb === 'workspace' && args[1] === 'create')) {
      const session = await ensureSession(phone, argv, undefined, true)
      printJson(session)
      return 0
    }
    if (verb === 'session' && args[1] === 'get') {
      const sessions = await listSessions(phone)
      printJson(resolveSession(sessions, args[2]))
      return 0
    }
    if (verb === 'session' && args[1] === 'attach') {
      const id = args[2] || argValueOrEq(argv, '--session')
      if (!id) throw new Error('vavc session attach <id>')
      printJson(await fetchThread(phone, id))
      return 0
    }
    if (verb === 'session' && args[1] === 'stop') {
      const id = args[2]
      if (!id) throw new Error('vavc session stop <id>')
      await cancelSession(phone, id)
      printJson({ ok: true, id })
      return 0
    }
    if (verb === 'session' && args[1] === 'delete') {
      const id = args[2]
      if (!id) throw new Error('vavc session delete <id>')
      await archiveSession(phone, id)
      printJson({ ok: true, id })
      return 0
    }
    if (verb === 'session' && args[1] === 'rename') {
      const id = args[2]
      const title = args.slice(3).join(' ').trim()
      if (!id || !title) throw new Error('vavc session rename <id> <title>')
      await renameSession(phone, id, title)
      printJson({ ok: true, id, title })
      return 0
    }
    if (verb === 'workspace' && args[1] === 'list') {
      const sessions = await listSessions(phone)
      printJson(
        sessions.map((row) => ({
          id: row.id,
          title: row.title,
          workdir: row.workdir,
          dirLabel: row.dirLabel,
          temporary: row.temporary,
          status: row.status
        }))
      )
      return 0
    }
    if (verb === 'workspace' && args[1] === 'get') {
      const sessions = await listSessions(phone)
      const row = resolveSession(sessions, args[2])
      printJson(row)
      return 0
    }
    if (verb === 'workspace' && args[1] === 'focus') {
      const id = args[2]
      if (!id) throw new Error('vavc workspace focus <id>')
      const cwd = argValueOrEq(argv, '--cwd')
      if (cwd) await setWorkspace(phone, id, cwd)
      printJson(await fetchControls(phone, id))
      return 0
    }
    if (verb === 'workspace' && args[1] === 'close') {
      const id = args[2]
      if (!id) throw new Error('vavc workspace close <id>')
      await archiveSession(phone, id)
      printJson({ ok: true, id })
      return 0
    }
    if (verb === 'agent' && (args[1] === 'list' || !args[1])) {
      const sessions = await listSessions(phone)
      printJson(
        sessions.map((row) => ({
          name: row.id,
          title: row.title,
          kind: row.surface,
          status: row.status === 'running' ? 'working' : row.status === 'done' ? 'done' : 'idle',
          workdir: row.workdir,
          pane: row.id
        }))
      )
      return 0
    }
    if (verb === 'agent' && args[1] === 'get') {
      const sessions = await listSessions(phone)
      const row = resolveSession(sessions, args[2])
      if (!row) throw new Error('vavc agent get <id>')
      printJson({ ...row, kind: row.surface, status: row.status === 'running' ? 'working' : row.status })
      return 0
    }
    if (verb === 'agent' && args[1] === 'start') {
      const kind = argValueOrEq(argv, '--kind') || 'vav'
      if (kind !== 'vav') throw new Error('vavd hosts the VAV agent; use --kind vav (other CLIs run in the app terminal)')
      const session = await ensureSession(phone, argv, undefined, true)
      printJson({ name: session.id, kind: 'vav', session })
      return 0
    }
    if (verb === 'agent' && args[1] === 'prompt') {
      const id = args[2] || argValueOrEq(argv, '--session')
      const text = args.slice(id && args[2] === id ? 3 : 2).join(' ').trim()
      if (!id || !text) throw new Error('vavc agent prompt <id> <text>')
      if (argv.includes('--wait')) {
        const turn = await sendTurn(phone, id, text)
        printJson({ session: id, turn })
      } else {
        phone.send({ type: 'send', conversationId: id, text })
        await phone.waitNew((msg) => msg.type === 'sent' || (msg.type === 'turn' && msg.conversationId === id), 8000)
        printJson({ session: id, queued: true })
      }
      return 0
    }
    if (verb === 'agent' && args[1] === 'wait') {
      const id = args[2] || argValueOrEq(argv, '--session')
      if (!id) throw new Error('vavc agent wait <id>')
      const untilRaw = argValueOrEq(argv, '--until')
      const until = untilRaw
        ? (untilRaw.split(',').map((item) => (item === 'working' ? 'running' : item)) as Array<'idle' | 'done' | 'running'>)
        : (['idle', 'done'] as const)
      const timeout = Number(argValueOrEq(argv, '--timeout') || 120_000)
      printJson(await waitSessionStatus(phone, id, [...until], timeout))
      return 0
    }
    if (verb === 'send') {
      const text = args.slice(1).join(' ').trim()
      if (!text) throw new Error('vavc send <text>')
      const id = argValueOrEq(argv, '--session')
      const session = await ensureSession(phone, argv, id, !id)
      const turn = await sendTurn(phone, session.id, text)
      printJson({ session: session.id, turn })
      return 0
    }
    if (verb === 'thread') {
      const id = argValueOrEq(argv, '--session')
      if (!id) throw new Error('vavc thread --session <id>')
      printJson(await fetchThread(phone, id))
      return 0
    }
    if (verb === 'configure') {
      const id = argValueOrEq(argv, '--session')
      if (!id) throw new Error('vavc configure --session <id>')
      printJson(
        await configureSession(phone, id, {
          model: argValueOrEq(argv, '--model'),
          approval: argValueOrEq(argv, '--approval'),
          thinking: argValueOrEq(argv, '--thinking'),
          agent: argValueOrEq(argv, '--agent')
        })
      )
      return 0
    }
    throw new Error(`unknown command: ${verb}${args[1] ? ` ${args[1]}` : ''}`)
  })
}

const entry = process.argv[1] || ''
if (/(?:^|[\\/])vavc\.(ts|js)$/.test(entry)) {
  void runVavc().then((code) => {
    if (code) process.exit(code)
  }, (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
    process.exit(1)
  })
}
