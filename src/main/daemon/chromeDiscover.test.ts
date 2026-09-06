import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  discoverOrigins,
  findLocalVavd,
  probeDiscover,
  webScanPorts,
  wsUrlFromOrigin
} from '../../../extension/lib/discover.js'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { startVavWebBridge } from './VavWebBridge.ts'

const SECRET = '0123456789abcdef01234567'

describe('Chrome extension discover', () => {
  it('scans loopback hosts and hinted ports first', () => {
    const origins = discoverOrigins({ ports: [4800] }, ['::1'])
    assert.equal(origins[0], 'http://127.0.0.1:4800')
    assert.ok(origins.includes('http://localhost:4752'))
    assert.ok(origins.includes('http://[::1]:4752'))
    assert.ok(webScanPorts([4800]).includes(4800))
  })

  it('builds a websocket URL from an HTTP origin', () => {
    assert.equal(wsUrlFromOrigin('http://127.0.0.1:4752'), 'ws://127.0.0.1:4752/vav')
    assert.equal(wsUrlFromOrigin('https://127.0.0.1:4752', '/sock'), 'wss://127.0.0.1:4752/sock')
  })

  it('probes a live vavd and prefers a secret-bearing host', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-discover-'))
    const host = createLocalWorkspaceHost({ name: 'discover' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const web = await startVavWebBridge({
      listen: '127.0.0.1',
      port: 0,
      hub: plane.hub,
      secret: () => SECRET,
      name: 'discover-host',
      version: 'test'
    })
    const decoy = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ app: 'other', proto: 1 }))
    })
    await new Promise<void>((resolve) => decoy.listen(0, '127.0.0.1', resolve))
    const decoyPort = (decoy.address() as { port: number }).port
    try {
      const hit = await probeDiscover(`http://127.0.0.1:${web.port}`)
      assert.ok(hit)
      assert.equal(hit.app, 'vavd')
      assert.equal(hit.secret, SECRET)
      assert.equal(hit.wsUrl, `ws://127.0.0.1:${web.port}/vav`)
      assert.equal(await probeDiscover(`http://127.0.0.1:${decoyPort}`), null)
      assert.equal(await probeDiscover('http://127.0.0.1:1'), null)

      const found = await findLocalVavd({
        ports: [web.port],
        hosts: ['127.0.0.1']
      })
      assert.ok(found)
      assert.equal(found.secret, SECRET)
      assert.equal(found.name, 'discover-host')
    } finally {
      decoy.close()
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
