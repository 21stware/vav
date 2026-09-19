import assert from 'node:assert/strict'
import { createServer, type AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { PortForwardService } from './PortForwardService.ts'

const SECRET = '0123456789abcdef01234567'

describe('PortForwardService', () => {
  it('marks local rows without binding', () => {
    const changed: string[][] = []
    const service = new PortForwardService((ids) => changed.push(ids))
    service.sync([
      {
        hostId: 'local',
        tabId: 't1',
        conversationId: 'c1',
        remotePort: 5173,
        mode: 'local'
      }
    ])
    assert.deepEqual(service.snapshotForTab('t1'), [
      { remotePort: 5173, localPort: 5173, status: 'local' }
    ])
    service.close()
  })

  it('reports conflict when the local port is already taken', async () => {
    const blocker = createServer()
    const port = await new Promise<number>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => {
        resolve((blocker.address() as AddressInfo).port)
      })
    })
    const service = new PortForwardService(() => undefined)
    try {
      service.sync([
        {
          hostId: 'box-1',
          tabId: 't1',
          conversationId: 'c1',
          remotePort: port,
          mode: 'proxy',
          dial: { host: '127.0.0.1', port: 9, secret: SECRET }
        }
      ])
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(service.snapshotForTab('t1')?.[0]?.status, 'conflict')
    } finally {
      service.close()
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})
