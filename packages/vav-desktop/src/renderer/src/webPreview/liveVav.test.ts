import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '@shared/ipc.ts'
import { createLiveVav } from './liveVav.ts'

describe('live observe vav', () => {
  it('forwards invoke/send and fans events to subscribers', async () => {
    const sent: unknown[] = []
    const listeners: Array<(channel: string, payload: unknown) => void> = []
    const { vav, acceptResult } = createLiveVav({
      platform: 'darwin',
      send: (message) => {
        sent.push(message)
        if (message.type === 'invoke') {
          acceptResult({ type: 'result', id: message.id, ok: true, value: { id: 'live-1' } })
        }
      },
      onEvent: (handler) => {
        listeners.push(handler)
        return () => undefined
      }
    })
    const listed = await vav.conversations.get('live-1')
    assert.deepEqual(listed, { id: 'live-1' })
    assert.equal((sent[0] as { channel: string }).channel, IPC.convGet)
    const seen: unknown[] = []
    vav.conversations.onChanged((rows) => {
      seen.push(rows)
    })
    for (const listener of listeners) listener(IPC.convChanged, [{ id: 'a' }])
    assert.deepEqual(seen, [[{ id: 'a' }]])
    vav.pty.write('tab-1', 'ls\n')
    assert.equal((sent.at(-1) as { type: string; channel: string }).type, 'send')
    assert.equal((sent.at(-1) as { channel: string }).channel, IPC.ptyWrite)
  })
})
