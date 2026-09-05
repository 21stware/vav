import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { startDesktopWebBridge } from './desktopWebBridge.ts'

const SECRET = '0123456789abcdef01234567'

describe('desktop web bridge', () => {
  it('serves /discover from the in-process hub', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-desk-web-'))
    const host = createLocalWorkspaceHost({ name: 'desk' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: '1.19.0'
    })
    plane.load()
    const web = await startDesktopWebBridge({
      hub: plane.hub,
      secret: () => SECRET,
      name: 'VAV',
      version: '1.19.0',
      port: 0
    })
    try {
      assert.ok(web)
      const res = await fetch(`http://127.0.0.1:${web.port}/discover`)
      const info = (await res.json()) as { app?: string; secret?: string; name?: string }
      assert.equal(info.app, 'vavd')
      assert.equal(info.secret, SECRET)
      assert.equal(info.name, 'VAV')
    } finally {
      web?.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
