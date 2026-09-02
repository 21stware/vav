import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { LOCAL_MACHINE_ID } from '../../shared/workspaceHost.ts'
import { createLocalHostFs } from './HostFs.ts'
import { HostRegistry, createLocalWorkspaceHost } from './WorkspaceHost.ts'

describe('HostRegistry', () => {
  it('always has a local host and refuses to remove it', () => {
    const registry = new HostRegistry()
    assert.equal(registry.local().id, LOCAL_MACHINE_ID)
    assert.equal(typeof registry.local().pty.spawn, 'function')
    assert.equal(registry.list().length, 1)
    assert.equal(registry.remove(LOCAL_MACHINE_ID), false)
    assert.ok(registry.get(LOCAL_MACHINE_ID))
  })

  it('resolves missing to local and unknown remotes to an offline stub', () => {
    const registry = new HostRegistry()
    assert.equal(registry.hostFor(null).id, LOCAL_MACHINE_ID)
    assert.equal(registry.hostFor('gone').info.kind, 'remote')
    assert.equal(registry.hostFor('gone').info.online, false)
  })

  it('registers and removes a remote host', () => {
    const registry = new HostRegistry()
    const remote = createLocalWorkspaceHost({ name: 'build-server' })
    const host = { ...remote, id: 'box', info: { ...remote.info, id: 'box', kind: 'remote' as const } }
    const seen: string[][] = []
    const stop = registry.onChange((list) => seen.push(list.map((h) => h.id)))
    registry.register(host)
    assert.equal(registry.require('box').info.name, 'build-server')
    assert.deepEqual(
      registry.list().map((h) => h.id).sort(),
      ['box', LOCAL_MACHINE_ID].sort()
    )
    assert.equal(registry.remove('box'), true)
    assert.equal(registry.get('box'), undefined)
    stop()
    assert.ok(seen.some((ids) => ids.includes('box')))
  })
})

describe('createLocalHostFs', () => {
  it('reads and writes through the local disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-host-fs-'))
    try {
      const fs = createLocalHostFs()
      const file = join(dir, 'note.txt')
      await fs.writeFile(file, 'hello', 'utf8')
      assert.equal((await fs.readFile(file)).toString('utf8'), 'hello')
      assert.equal(await fs.exists(file), true)
      const info = await fs.stat(file)
      assert.equal(info.isFile(), true)
      const names = (await fs.readdir(dir)).map((d) => d.name)
      assert.ok(names.includes('note.txt'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
