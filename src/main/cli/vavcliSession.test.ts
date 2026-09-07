import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RemoteServerMessage } from '../../shared/remoteControl.ts'
import type { PhoneClient } from './vavPhoneClient.ts'
import { runVavcliLines, runVavcliRpc } from '../../../packages/vav-cli/src/vavcliSession.ts'

function mockPhone(conversationId = 's1'): PhoneClient & { sent: object[] } {
  const sent: object[] = []
  return {
    sent,
    frames: [],
    send: (message) => {
      sent.push(message)
    },
    wait: async () => [],
    waitNew: async () =>
      [
        { type: 'turn', conversationId, phase: 'done', draft: 'ok' }
      ] as RemoteServerMessage[],
    close: () => {}
  }
}

describe('vavcli session loops', () => {
  it('runs rpc prompt then quit without closing the socket', async () => {
    const phone = mockPhone()
    const code = await runVavcliRpc(phone, 's1', [
      JSON.stringify({ type: 'prompt', text: 'hello from rpc' }),
      JSON.stringify({ type: 'quit' })
    ])
    assert.equal(code, 0)
    assert.deepEqual(phone.sent[0], { type: 'send', conversationId: 's1', text: 'hello from rpc' })
    assert.equal(phone.sent.length, 1)
  })

  it('runs a scripted REPL prompt then /quit', async () => {
    const phone = mockPhone()
    const chunks: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stdout.write
    try {
      const code = await runVavcliLines(phone, 's1', ['hello from repl', '/quit'])
      assert.equal(code, 0)
      assert.deepEqual(phone.sent[0], { type: 'send', conversationId: 's1', text: 'hello from repl' })
      assert.match(chunks.join(''), /ok/)
    } finally {
      process.stdout.write = write
    }
  })

  it('sends a parked-turn reply over rpc', async () => {
    const phone = mockPhone()
    const code = await runVavcliRpc(phone, 's1', [
      JSON.stringify({ type: 'reply', toolCallId: 'tool-1', answer: 'Approve' }),
      JSON.stringify({ type: 'quit' })
    ])
    assert.equal(code, 0)
    assert.deepEqual(phone.sent[0], {
      type: 'reply',
      conversationId: 's1',
      toolCallId: 'tool-1',
      answer: 'Approve'
    })
  })
})
