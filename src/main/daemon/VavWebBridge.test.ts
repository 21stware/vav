import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { startVavWebBridge } from './VavWebBridge.ts'

const SECRET = '0123456789abcdef01234567'

describe('VavWebBridge discover', () => {
  it('hands a loopback client the pairing secret and identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-discover-'))
    const host = createLocalWorkspaceHost({ name: 'bridge' })
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
      name: 'office-mac',
      version: '1.19.0'
    })
    try {
      const res = await fetch(`http://127.0.0.1:${web.port}/discover`)
      assert.equal(res.ok, true)
      const info = (await res.json()) as {
        app: string
        proto: number
        name: string
        version: string
        wsPath: string
        loopback: boolean
        secret?: string
      }
      assert.equal(info.app, 'vavd')
      assert.equal(info.proto, 1)
      assert.equal(info.name, 'office-mac')
      assert.equal(info.version, '1.19.0')
      assert.equal(info.wsPath, '/vav')
      assert.equal(info.loopback, true)
      assert.equal(info.secret, SECRET)

      const health = await fetch(`http://127.0.0.1:${web.port}/health`)
      const body = (await health.json()) as { name: string }
      assert.equal(body.name, 'office-mac')

      const ui = await fetch(`http://127.0.0.1:${web.port}/phone.css`)
      assert.equal(ui.ok, true)
      const css = await ui.text()
      assert.match(css, /composer-box|app-shell/)
      assert.match(css, /session-run-controls|agent-model-picker/)
      assert.match(css, /workspace-view/)
      assert.match(css, /preview-right/)
      assert.match(css, /workspace-view-agent/)

      const mark = await fetch(`http://127.0.0.1:${web.port}/icon-mark.png`)
      assert.equal(mark.ok, true)
      assert.equal(mark.headers.get('content-type'), 'image/png')
      const bytes = new Uint8Array(await mark.arrayBuffer())
      assert.equal(bytes[0], 0x89)
      assert.equal(bytes[1], 0x50)
    } finally {
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
