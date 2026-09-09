/**
 * In-process vav-tui session loops. Kept off `vav-tui.ts` so Playwright can
 * import them (that file uses `import.meta`, which Playwright loads as CJS).
 */
import type { RemoteTurnEvent } from '@shared/remoteControl.ts'
import { continueSession, editSession, fetchThread, replySession, sendTurn } from '@main/cli/vavControl.ts'
import type { PhoneClient } from '@main/cli/vavPhoneClient.ts'

function asAsyncLines(lines: AsyncIterable<string> | Iterable<string>): AsyncIterable<string> {
  if (typeof (lines as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') {
    return lines as AsyncIterable<string>
  }
  return (async function* () {
    for (const line of lines as Iterable<string>) yield line
  })()
}

async function lastMessageId(
  phone: PhoneClient,
  session: string,
  role: 'user' | 'assistant'
): Promise<string> {
  const thread = await fetchThread(phone, session)
  const messages = thread && thread.type === 'thread' ? thread.messages : []
  return [...messages].reverse().find((row) => row.role === role)?.id ?? ''
}

function textFromTurn(turn: RemoteTurnEvent): string {
  if (turn.draft?.trim()) return turn.draft.trim()
  if (turn.error?.trim()) return turn.error.trim()
  const textBlock = turn.blocks?.find((block) => block.kind === 'text' && block.text.trim())
  return textBlock && textBlock.kind === 'text' ? textBlock.text.trim() : ''
}

function writeTurn(turn: RemoteTurnEvent, mode: 'text' | 'json'): void {
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify(turn)}\n`)
    return
  }
  const text = textFromTurn(turn)
  if (text) process.stdout.write(`${text}\n`)
}

/** Stream a prompt the same way `vav-tui -p` / the TTY REPL do. */
export async function streamTurn(
  phone: PhoneClient,
  session: string,
  text: string,
  mode: 'text' | 'json',
  timeoutMs = 120_000
): Promise<RemoteTurnEvent> {
  if (!text.trim()) throw new Error('empty prompt')
  phone.send({ type: 'send', conversationId: session, text })
  let lastDraft = ''
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remain = Math.max(250, deadline - Date.now())
    const frames = await phone.waitNew(
      (msg) =>
        (msg.type === 'turn' && msg.conversationId === session) ||
        (msg.type === 'error' && msg.conversationId === session),
      remain
    )
    const err = frames.findLast((msg) => msg.type === 'error' && msg.conversationId === session)
    if (err && err.type === 'error') throw new Error(err.message)
    const turn = frames.findLast((msg) => msg.type === 'turn' && msg.conversationId === session)
    if (!turn || turn.type !== 'turn') continue
    if (mode === 'json') {
      process.stdout.write(`${JSON.stringify(turn)}\n`)
    } else {
      const draft = turn.draft ?? ''
      if (draft.length > lastDraft.length) {
        process.stdout.write(draft.slice(lastDraft.length))
        lastDraft = draft
      }
    }
    if (turn.phase === 'done' || turn.phase === 'error' || turn.phase === 'cancelled') {
      if (mode === 'text' && lastDraft) process.stdout.write('\n')
      if (mode === 'text' && !lastDraft) {
        let fallback = textFromTurn(turn)
        if (!fallback) {
          const thread = await fetchThread(phone, session)
          if (thread && thread.type === 'thread') {
            const last = [...thread.messages].reverse().find((msg) => msg.role === 'assistant' && msg.text.trim())
            fallback = last?.text.trim() ?? ''
          }
        }
        if (fallback) process.stdout.write(`${fallback}\n`)
      }
      return turn
    }
  }
}

/** JSON-line RPC used by `vav-tui --mode rpc`. */
export async function runVavTuiRpc(
  phone: PhoneClient,
  session: string,
  lines: AsyncIterable<string> | Iterable<string>,
  mode: 'text' | 'json' = 'json'
): Promise<number> {
  for await (const line of asAsyncLines(lines)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let msg: { type?: string; text?: string; toolCallId?: string; answer?: string; messageId?: string }
    try {
      msg = JSON.parse(trimmed) as {
        type?: string
        text?: string
        toolCallId?: string
        answer?: string
        messageId?: string
      }
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
      writeTurn(turn, mode)
      continue
    }
    if (msg.type === 'reply') {
      const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : ''
      const answer = typeof msg.answer === 'string' ? msg.answer : ''
      await replySession(phone, session, toolCallId, answer)
      if (mode === 'json') process.stdout.write(`${JSON.stringify({ type: 'replied', session, toolCallId })}\n`)
      continue
    }
    if (msg.type === 'edit') {
      const text = typeof msg.text === 'string' ? msg.text : ''
      const messageId =
        typeof msg.messageId === 'string' && msg.messageId
          ? msg.messageId
          : await lastMessageId(phone, session, 'user')
      if (!messageId || !text) {
        process.stderr.write('rpc: edit needs text and a user message\n')
        continue
      }
      const turn = await editSession(phone, session, messageId, text)
      writeTurn(turn, mode)
      continue
    }
    if (msg.type === 'continue') {
      const messageId =
        typeof msg.messageId === 'string' && msg.messageId
          ? msg.messageId
          : await lastMessageId(phone, session, 'assistant')
      if (!messageId) {
        process.stderr.write('rpc: continue needs an assistant message\n')
        continue
      }
      const next = await continueSession(phone, session, messageId)
      if (mode === 'json') process.stdout.write(`${JSON.stringify({ type: 'created', session: next.id })}\n`)
      continue
    }
    process.stderr.write(`rpc: unknown type ${msg.type ?? '?'}\n`)
  }
  return 0
}

/** REPL / scripted prompt+slash loop. `/quit` is built in; other slashes go to `onSlash`. */
export async function runVavTuiLines(
  phone: PhoneClient,
  session: string,
  lines: AsyncIterable<string> | Iterable<string>,
  onSlash?: (session: string, line: string) => Promise<string | 'quit' | null>
): Promise<number> {
  let current = session
  for await (const line of asAsyncLines(lines)) {
    const text = line.trim()
    if (!text) continue
    if (text.startsWith('/')) {
      const cmd = text.slice(1).split(/\s+/)[0] || ''
      if (cmd === 'quit' || cmd === 'exit') return 0
      if (onSlash) {
        const next = await onSlash(current, text)
        if (next === 'quit') return 0
        if (next) current = next
      }
      continue
    }
    try {
      await streamTurn(phone, current, text, 'text')
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
    }
  }
  return 0
}
