import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDaemonRpc, decodeBase64Utf8 } from './phoneDaemon.ts'

describe('phone daemon rpc', () => {
  it('hellos as role=daemon and resolves fs.readdir', async () => {
    const sent: Array<Record<string, unknown>> = []
    const handlers = new Set<(msg: Record<string, unknown>) => void>()
    const rpc = createDaemonRpc({
      send: (msg) => sent.push(msg),
      onLine: (handler) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      }
    })
    const hello = rpc.hello('secret', 'web')
    assert.equal(sent[0]?.role, 'daemon')
    for (const handler of handlers) handler({ type: 'welcome', proto: 1, app: 'vav-server', version: '1' })
    assert.equal(await hello, true)

    const pending = rpc.request('fs.readdir', { path: '/tmp/ws' })
    await Promise.resolve()
    const req = sent.at(-1) as { id?: string; method?: string }
    assert.equal(req.method, 'fs.readdir')
    for (const handler of handlers) {
      handler({
        type: 'res',
        id: req.id,
        ok: true,
        result: { entries: [{ name: 'remote-only.md', isDirectory: false, isFile: true }] }
      })
    }
    const result = (await pending) as { entries: Array<{ name: string }> }
    assert.equal(result.entries[0]?.name, 'remote-only.md')
  })

  it('decodes daemon file bodies', () => {
    const encoded = Buffer.from('planted by vav-server e2e', 'utf8').toString('base64')
    assert.equal(decodeBase64Utf8(encoded), 'planted by vav-server e2e')
  })
})
