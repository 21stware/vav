#!/usr/bin/env node
/**
 * Control-plane CLI for a running `vavd`.
 *
 *   npm run vav -- sessions
 *   npm run vav -- send "hello"
 *   npm run vav -- create
 *
 * Same phone protocol as VAV Remote, the web UI, and the Chrome extension.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import { connectPhone } from './vavPhoneClient.ts'

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function positional(): string[] {
  const takesValue = new Set([
    '--uri',
    '--host',
    '--port',
    '--secret',
    '--state',
    '--session',
    '--model',
    '--approval',
    '--thinking',
    '--device'
  ])
  const out: string[] = []
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (takesValue.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) continue
    out.push(arg)
  }
  return out
}

function printHelp(): void {
  process.stdout.write(
    [
      'vav — control client for a running vavd',
      '',
      '  vav sessions',
      '  vav create',
      '  vav send <text> [--session <id>]',
      '  vav thread [--session <id>]',
      '  vav configure --session <id> [--model <id>] [--approval auto|bypass|edit] [--thinking off|low|medium|high]',
      '',
      '  --uri vav-daemon://…   pairing URI (or VAVD_URI)',
      '  --host --port --secret override pieces',
      '  --state <dir>          read secret.json (default ~/.vavd)',
      ''
    ].join('\n')
  )
}

function secretFromState(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'secret.json'), 'utf8')) as { secret?: unknown }
    return typeof raw.secret === 'string' && raw.secret.length >= 16 ? raw.secret : null
  } catch {
    return null
  }
}

function resolveTarget(): { host: string; port: number; secret: string } {
  const uri = argValue('--uri') || process.env.VAVD_URI
  if (uri) {
    const parsed = parseDaemonPairing(uri)
    if (!parsed?.secret) throw new Error('unrecognized pairing URI')
    return {
      host: argValue('--host') || parsed.host || '127.0.0.1',
      port: Number(argValue('--port') || parsed.port || 4750),
      secret: argValue('--secret') || parsed.secret
    }
  }
  const state = argValue('--state') || join(homedir(), '.vavd')
  const secret = argValue('--secret') || secretFromState(state)
  if (!secret) {
    throw new Error('no pairing secret: pass --uri / --secret or run vavd first (~/.vavd/secret.json)')
  }
  return {
    host: argValue('--host') || '127.0.0.1',
    port: Number(argValue('--port') || 4750),
    secret
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.length <= 2) {
    printHelp()
    return
  }
  const args = positional()
  const verb = args[0]
  if (!verb || verb === 'help') {
    printHelp()
    return
  }
  const target = resolveTarget()
  const phone = await connectPhone({
    ...target,
    device: argValue('--device') || 'vav-cli'
  })
  try {
    if (verb === 'sessions') {
      phone.send({ type: 'sessions' })
      const listed = await phone.waitNew((msg) => msg.type === 'sessions')
      const last = listed.findLast((msg) => msg.type === 'sessions')
      process.stdout.write(`${JSON.stringify(last && last.type === 'sessions' ? last.sessions : [], null, 2)}\n`)
      return
    }
    if (verb === 'create') {
      phone.send({ type: 'create' })
      const frames = await phone.waitNew((msg) => msg.type === 'created')
      const created = frames.findLast((msg) => msg.type === 'created')
      process.stdout.write(`${JSON.stringify(created && created.type === 'created' ? created.session : null, null, 2)}\n`)
      return
    }
    if (verb === 'send') {
      const text = args.slice(1).join(' ').trim()
      if (!text) throw new Error('vav send <text>')
      let session = argValue('--session')
      if (!session) {
        phone.send({ type: 'create' })
        const created = (await phone.waitNew((msg) => msg.type === 'created')).findLast(
          (msg) => msg.type === 'created'
        )
        if (!created || created.type !== 'created') throw new Error('create failed')
        session = created.session.id
      }
      phone.send({ type: 'send', conversationId: session, text })
      const turns = await phone.waitNew(
        (msg) =>
          msg.type === 'turn' &&
          (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled')
      )
      const done = turns.findLast((msg) => msg.type === 'turn' && (msg.phase === 'done' || msg.phase === 'error'))
      process.stdout.write(`${JSON.stringify({ session, turn: done }, null, 2)}\n`)
      return
    }
    if (verb === 'thread') {
      const session = argValue('--session')
      if (!session) throw new Error('vav thread --session <id>')
      phone.send({ type: 'thread', conversationId: session })
      const frames = await phone.waitNew((msg) => msg.type === 'thread' && msg.conversationId === session)
      const thread = frames.findLast((msg) => msg.type === 'thread')
      process.stdout.write(`${JSON.stringify(thread, null, 2)}\n`)
      return
    }
    if (verb === 'configure') {
      const session = argValue('--session')
      if (!session) throw new Error('vav configure --session <id>')
      const model = argValue('--model')
      const approval = argValue('--approval')
      const thinking = argValue('--thinking')
      if (!model && !approval && !thinking) throw new Error('pass --model, --approval, or --thinking')
      phone.send({
        type: 'configure',
        conversationId: session,
        ...(model ? { model } : {}),
        ...(approval ? { approvalMode: approval } : {}),
        ...(thinking ? { thinkingLevel: thinking } : {})
      })
      const frames = await phone.waitNew((msg) => msg.type === 'controls' && msg.conversationId === session)
      const controls = frames.findLast((msg) => msg.type === 'controls')
      process.stdout.write(`${JSON.stringify(controls, null, 2)}\n`)
      return
    }
    throw new Error(`unknown command: ${verb}`)
  } finally {
    phone.close()
  }
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
