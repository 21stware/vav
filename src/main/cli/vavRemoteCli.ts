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
import { connectPhone } from './vavPhoneClient.ts'
import {
  formatVavConnectError,
  formatVavHelp,
  formatVavVersion,
  parseVavCliArgs,
  resolveVavTarget
} from './vavCli.ts'

async function main(): Promise<void> {
  const parsed = parseVavCliArgs(process.argv)
  if (parsed.kind === 'help') {
    process.stdout.write(formatVavHelp())
    return
  }
  if (parsed.kind === 'version') {
    process.stdout.write(formatVavVersion())
    return
  }
  if (parsed.kind === 'error') {
    throw new Error(parsed.message)
  }

  const target = resolveVavTarget(parsed.flags)
  const phone = await connectPhone({
    ...target,
    device: parsed.flags.get('--device') || 'vav-cli'
  })
  try {
    const verb = parsed.verb
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
      const text = parsed.rest.join(' ').trim()
      if (!text) throw new Error('vav send <text>')
      let session = parsed.flags.get('--session')
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
      const done = turns.findLast(
        (msg) =>
          msg.type === 'turn' &&
          (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled')
      )
      process.stdout.write(`${JSON.stringify({ session, turn: done ?? null }, null, 2)}\n`)
      return
    }
    if (verb === 'thread') {
      const session = parsed.flags.get('--session')
      if (!session) throw new Error('vav thread --session <id>')
      phone.send({ type: 'thread', conversationId: session })
      const frames = await phone.waitNew((msg) => msg.type === 'thread' && msg.conversationId === session)
      const thread = frames.findLast((msg) => msg.type === 'thread')
      process.stdout.write(`${JSON.stringify(thread, null, 2)}\n`)
      return
    }
    if (verb === 'configure') {
      const session = parsed.flags.get('--session')
      if (!session) throw new Error('vav configure --session <id>')
      const model = parsed.flags.get('--model')
      const approval = parsed.flags.get('--approval')
      const thinking = parsed.flags.get('--thinking')
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
    if (verb === 'cancel') {
      const session = parsed.flags.get('--session')
      if (!session) throw new Error('vav cancel --session <id>')
      phone.send({ type: 'cancel', conversationId: session })
      const frames = await phone.waitNew(
        (msg) =>
          (msg.type === 'turn' && msg.conversationId === session && msg.phase === 'cancelled') ||
          (msg.type === 'error' && msg.conversationId === session),
        4000
      ).catch(() => [])
      const last = frames.findLast(
        (msg) =>
          (msg.type === 'turn' && msg.phase === 'cancelled') || msg.type === 'error'
      )
      process.stdout.write(`${JSON.stringify(last ?? { ok: true, session }, null, 2)}\n`)
      return
    }
    if (verb === 'reply') {
      const session = parsed.flags.get('--session')
      const tool = parsed.flags.get('--tool')
      const answer = parsed.flags.get('--answer') || parsed.rest.join(' ').trim()
      if (!session || !tool || !answer) throw new Error('vav reply --session <id> --tool <id> --answer <text>')
      phone.send({ type: 'reply', conversationId: session, toolCallId: tool, answer })
      const frames = await phone.waitNew(
        (msg) =>
          msg.type === 'turn' &&
          msg.conversationId === session &&
          (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled')
      )
      const done = frames.findLast((msg) => msg.type === 'turn')
      process.stdout.write(`${JSON.stringify(done ?? null, null, 2)}\n`)
      return
    }
  } finally {
    phone.close()
  }
}

void main().catch((err) => {
  const parsed = parseVavCliArgs(process.argv)
  const flags = parsed.kind === 'command' ? parsed.flags : new Map<string, string>()
  let hint = err instanceof Error ? err.message : String(err)
  try {
    const target = resolveVavTarget(flags)
    hint = formatVavConnectError(err, target)
  } catch {
    /* keep original */
  }
  process.stderr.write(`${hint}\n`)
  process.exit(1)
})
