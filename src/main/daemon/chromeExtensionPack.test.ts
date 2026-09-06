import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const EXT = join(import.meta.dirname, '../../../extension')

describe('Chrome extension pack', () => {
  it('ships brand icons, discovery, and a side panel — not a localhost paste form', () => {
    const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8')) as {
      manifest_version: number
      icons: Record<string, string>
      background: { service_worker: string; type: string }
      permissions: string[]
      host_permissions: string[]
    }
    assert.equal(manifest.manifest_version, 3)
    assert.equal(manifest.background.type, 'module')
    for (const size of ['16', '32', '48', '128']) {
      const rel = manifest.icons[size]
      assert.ok(rel, `missing icon ${size}`)
      assert.ok(existsSync(join(EXT, rel)), rel)
    }
    assert.ok(manifest.permissions.includes('contextMenus'))
    assert.ok(manifest.host_permissions.some((row) => row.includes('127.0.0.1')))
    const html = readFileSync(join(EXT, 'sidepanel.html'), 'utf8')
    assert.equal(html.includes('ws://127.0.0.1:4752'), false)
    assert.ok(html.includes('data-testid="transcript"'))
    assert.ok(html.includes('href="phone/"'), 'side panel must resolve bundled assets under phone/')
    assert.ok(existsSync(join(EXT, 'content.js')))
    assert.ok(existsSync(join(EXT, 'lib/discover.js')))
  })
})
