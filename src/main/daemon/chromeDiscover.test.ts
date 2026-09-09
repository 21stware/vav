import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  discoverOrigins,
  findLocalVavServer,
  loopbackWebOrigin,
  loopbackWsUrl,
  probeDiscover,
  webScanPorts,
  wsUrlFromOrigin
} from '../../../packages/vav-chrome-extension/extension/lib/discover.js'
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

  it('keeps RFC1918 pairing hints and still scans loopback', () => {
    const origins = discoverOrigins({ ports: [4752], origin: 'http://192.168.1.5:4752' }, [
      '192.168.1.5'
    ])
    assert.ok(origins.includes('http://192.168.1.5:4752'))
    assert.ok(origins.includes('http://127.0.0.1:4752'))
  })

  it('builds a websocket URL from an HTTP origin', () => {
    assert.equal(wsUrlFromOrigin('http://127.0.0.1:4752'), 'ws://127.0.0.1:4752/vav')
    assert.equal(wsUrlFromOrigin('https://127.0.0.1:4752', '/sock'), 'wss://127.0.0.1:4752/sock')
  })

  it('keeps LAN web / websocket URLs and rewrites WAN onto 127.0.0.1', () => {
    assert.equal(loopbackWebOrigin('http://192.168.1.5:4752'), 'http://192.168.1.5:4752')
    assert.equal(loopbackWsUrl('ws://192.168.1.5:4752/vav'), 'ws://192.168.1.5:4752/vav')
    assert.equal(loopbackWebOrigin('http://127.0.0.1:4753'), 'http://127.0.0.1:4753')
    assert.equal(loopbackWebOrigin('http://8.8.8.8:4752'), 'http://127.0.0.1:4752')
    assert.equal(loopbackWsUrl('ws://1.1.1.1:4752/vav'), 'ws://127.0.0.1:4752/vav')
  })

  it('probes a live vav-server and prefers a secret-bearing host', async () => {
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
      assert.equal(hit.app, 'vav-server')
      assert.equal(hit.secret, SECRET)
      assert.equal(hit.wsUrl, `ws://127.0.0.1:${web.port}/vav`)
      assert.equal(await probeDiscover(`http://127.0.0.1:${decoyPort}`), null)
      assert.equal(await probeDiscover('http://127.0.0.1:1'), null)

      const found = await findLocalVavServer({
        ports: [web.port],
        hosts: ['127.0.0.1']
      })
      assert.ok(found)
      assert.equal(found.secret, SECRET)
      assert.equal(found.name, 'discover-host')

      const fromLanHint = await findLocalVavServer({
        origin: `http://192.168.1.5:${web.port}`,
        hosts: ['192.168.1.5'],
        ports: [web.port]
      })
      assert.ok(fromLanHint)
      assert.equal(fromLanHint.origin, `http://127.0.0.1:${web.port}`)
      assert.equal(fromLanHint.wsUrl, `ws://127.0.0.1:${web.port}/vav`)
    } finally {
      decoy.close()
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('prefers a discover host that already has a provider key', async () => {
    const empty = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ app: 'vav-server', proto: 1, secret: 'aaaaaaaaaaaaaaaa', hasKey: false }))
    })
    const ready = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({ app: 'vav-server', proto: 1, secret: 'bbbbbbbbbbbbbbbb', hasKey: true, name: 'ready' })
      )
    })
    await Promise.all([
      new Promise<void>((resolve) => empty.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => ready.listen(0, '127.0.0.1', resolve))
    ])
    const emptyPort = (empty.address() as { port: number }).port
    const readyPort = (ready.address() as { port: number }).port
    try {
      const found = await findLocalVavServer({
        ports: [emptyPort, readyPort],
        hosts: ['127.0.0.1']
      })
      assert.ok(found)
      assert.equal(found.hasKey, true)
      assert.equal(found.name, 'ready')
    } finally {
      empty.close()
      ready.close()
    }
  })
})
