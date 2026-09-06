#!/usr/bin/env node
/**
 * vavcli — pi-style agent CLI against a running vavd.
 *
 * Modes: interactive (TTY), print (`-p`), JSON event stream (`--mode json`),
 * and a small stdin RPC (`--mode rpc`). Turns run in vavd; the desktop app
 * sees the same session.
 */
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdin as input, stdout as output } from 'node:process'
import type { RemoteTurnEvent } from '../../shared/remoteControl.ts'
import {
  configureSession,
  createSession,
  fetchThread,
  listSessions,
  printLine,
  resolveSession,
  sendTurn,
  setWorkspace
} from './vavControl.ts'
import { connectPhoneTarget, type PhoneClient } from './vavPhoneClient.ts'
import { TARGET_FLAGS, argValueOrEq, positionalArgs, resolveVavdTarget } from './vavdTarget.ts'

const CLI_FLAGS = new Set([
  ...TARGET_FLAGS,
  '--cwd',
  '--workdir',
  '--session',
  '--model',
  '-m',
  '--thinking',
  '--approval',
  '--mode',
  '-p',
  '--print'
])

export function vavcliHelp(): string {
  return [
    'vavcli — VAV agent in the terminal (pi-style)',
    '',
    '  vavcli                         interactive REPL against a vavd session',
    '  vavcli -p "query"              print mode — one shot, wait for the turn',
    '  vavcli --mode json -p "query"  NDJSON turn events',
    '  vavcli --mode rpc              JSON lines on stdin (prompt / cancel / quit)',
    '  vavcli -c                      continue the last session',
    '  vavcli --session <id>          attach a known session',
    '',
    '  -p, --print            one-shot (implies waiting for done/error)',
    '  --mode text|json|rpc   output / control mode (default text)',
    '  -c, --continue         last updated session',
    '  --session <id>         existing session id',
    '  --cwd, --workdir PATH  set the session workdir before sending',
    '  -m, --model ID         configure model',
    '  --thinking off|low|medium|high',
    '  --approval auto|bypass|edit',
    '  --uri / --host / --port / --secret / --state',
    '  --version, -h',
    ''
  ].join('\n')
}

function modeOf(argv: string[]): 'text' | 'json' | 'rpc' {
  const raw = argValueOrEq(argv, '--mode') || 'text'
  if (raw === 'json' || raw === 'rpc' || raw === 'text') return raw
  throw new Error(' --mode must be text, json, or rpc')
}

function printPrompt(argv: string[]): string {
  const eq = argv.find((arg) => arg.startsWith('--print='))
  if (eq) return eq.slice('--print='.length)
  const flagged = argValueOrEq(argv, '-p') || argValueOrEq(argv, '--print')
  const rest = positionalArgs(argv, CLI_FLAGS)
  return [flagged, ...rest].filter(Boolean).join(' ').trim()
}

function packageVersion(): string {
  try {
    const here = typeof import.meta.dirname === 'string' ? import.meta.dirname : dirname(fileURLToPath(import.meta.url))
    for (const file of [join(here, '../../../package.json'), join(process.cwd(), 'package.json')]) {
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

function textFromTurn(turn: RemoteTurnEvent): string {
  if (turn.draft?.trim()) return turn.draft.trim()
  if (turn.error?.trim()) return turn.error.trim()
  const textBlock = turn.blocks?.find((block) => block.kind === 'text' && block.text.trim())
  return textBlock && textBlock.kind === 'text' ? textBlock.text.trim() : ''
}

async function emitTurn(phone: PhoneClient, session: string, mode: 'text' | 'json', turn: RemoteTurnEvent): Promise<void> {
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify(turn)}\n`)
    return
  }
  let text = textFromTurn(turn)
  if (!text && turn.phase === 'done') {
    const thread = await fetchThread(phone, session)
    if (thread && thread.type === 'thread') {
      const last = [...thread.messages].reverse().find((msg) => msg.role === 'assistant' && msg.text.trim())
      text = last?.text.trim() ?? ''
    }
  }
  if (text) printLine(text)
}

async function prepareSession(phone: PhoneClient, argv: string[]): Promise<string> {
  const sessions = await listSessions(phone)
  const wantContinue = argv.includes('-c') || argv.includes('--continue')
  const id = argValueOrEq(argv, '--session')
  let session = resolveSession(sessions, id, wantContinue ? 'last' : 'none')
  if (!session) session = await createSession(phone)
  const cwd = argValueOrEq(argv, '--cwd') || argValueOrEq(argv, '--workdir')
  const model = argValueOrEq(argv, '-m') || argValueOrEq(argv, '--model')
  const thinking = argValueOrEq(argv, '--thinking')
  const approval = argValueOrEq(argv, '--approval')
  if (cwd) await setWorkspace(phone, session.id, cwd)
  if (model || thinking || approval) {
    await configureSession(phone, session.id, { model, thinking, approval })
  }
  return session.id
}

async function runRpc(phone: PhoneClient, session: string, mode: 'text' | 'json'): Promise<number> {
  const rl = createInterface({ input, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let msg: { type?: string; text?: string }
    try {
      msg = JSON.parse(trimmed) as { type?: string; text?: string }
    } catch {
      process.stderr.write('rpc: expected a JSON object per line\n')
      continue
    }
    if (msg.type === 'quit' || msg.type === 'exit') return 0
    if (msg.type === 'cancel') {
      phone.send({ type: 'cancel', conversationId: session })
      if (mode === 'json') process.stdout.write(`${JSON.stringify({ type: 'cancelled', session })}\n`)
      continue
    }
    if (msg.type === 'prompt' || msg.type === 'send') {
      const text = typeof msg.text === 'string' ? msg.text : ''
      const turn = await sendTurn(phone, session, text)
      await emitTurn(phone, session, mode, turn)
      continue
    }
    process.stderr.write(`rpc: unknown type ${msg.type ?? '?'}\n`)
  }
  return 0
}

async function runInteractive(phone: PhoneClient, session: string): Promise<number> {
  printLine(`vavcli session ${session}  (Ctrl+C to exit; /new starts another session)`)
  const rl = createInterface({ input, output, prompt: 'vavcli> ' })
  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question('vavcli> ', (answer) => resolve(answer))
      rl.once('close', () => resolve(null))
    })
  let current = session
  for (;;) {
    const line = await ask()
    if (line == null) break
    const text = line.trim()
    if (!text) continue
    if (text === '/quit' || text === '/exit') break
    if (text === '/new') {
      current = (await createSession(phone)).id
      printLine(`session ${current}`)
      continue
    }
    if (text === '/session') {
      printLine(current)
      continue
    }
    try {
      const turn = await sendTurn(phone, current, text)
      await emitTurn(phone, current, 'text', turn)
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
    }
  }
  rl.close()
  return 0
}

export async function runVavcli(argv: string[] = process.argv): Promise<number> {
  if (argv.includes('--version') || argv.includes('-V')) {
    printLine(packageVersion())
    return 0
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(vavcliHelp())
    return 0
  }

  const mode = modeOf(argv)
  const target = await resolveVavdTarget({ argv })
  const phone = await connectPhoneTarget(target, 'vavcli')
  try {
    const session = await prepareSession(phone, argv)
    if (mode === 'rpc') return runRpc(phone, session, 'json')
    const prompt = printPrompt(argv)
    if (prompt) {
      const turn = await sendTurn(phone, session, prompt)
      await emitTurn(phone, session, mode === 'json' ? 'json' : 'text', turn)
      return turn.phase === 'error' ? 1 : 0
    }
    if (!input.isTTY) {
      const chunks: Buffer[] = []
      for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        process.stderr.write('vavcli: pass -p "query" or pipe a prompt on stdin\n')
        return 2
      }
      const turn = await sendTurn(phone, session, text)
      await emitTurn(phone, session, mode === 'json' ? 'json' : 'text', turn)
      return turn.phase === 'error' ? 1 : 0
    }
    return runInteractive(phone, session)
  } finally {
    phone.close()
  }
}

const entry = process.argv[1] || ''
if (/(?:^|[\\/])vavcli\.(ts|js)$/.test(entry)) {
  void runVavcli().then(
    (code) => {
      if (code) process.exit(code)
    },
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
      process.exit(1)
    }
  )
}
