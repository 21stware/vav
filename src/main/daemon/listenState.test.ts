import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  clearListenState,
  probeListenAlive,
  readListenState,
  writeListenState
} from './listenState.ts'

describe('listenState', () => {
  it('round-trips host/port and probes a live socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vavd-listen-'))
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    try {
      writeListenState(dir, { host: '127.0.0.1', port: address.port })
      const read = readListenState(dir)
      assert.equal(read?.host, '127.0.0.1')
      assert.equal(read?.port, address.port)
      assert.equal(await probeListenAlive({ host: '127.0.0.1', port: address.port }), true)
      clearListenState(dir)
      assert.equal(readListenState(dir), null)
    } finally {
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a closed port as dead', async () => {
    assert.equal(await probeListenAlive({ host: '127.0.0.1', port: 1 }), false)
  })
})
