import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCAL_MACHINE_ID } from '../../shared/workspaceHost.ts'
import { HostRegistry, createLocalWorkspaceHost } from './WorkspaceHost.ts'

describe('HostRegistry', () => {
  it('starts with the local host online', () => {
    const registry = new HostRegistry(createLocalWorkspaceHost({ name: 'This Mac' }))
    assert.equal(registry.local().id, LOCAL_MACHINE_ID)
    assert.equal(registry.local().info.name, 'This Mac')
    assert.equal(registry.list().length, 1)
  })

  it('hostFor does not serve local disks for an unknown remote', () => {
    const registry = new HostRegistry()
    assert.equal(registry.hostFor('missing-box').id, 'missing-box')
    assert.equal(registry.hostFor('missing-box').info.online, false)
    assert.equal(registry.hostFor('missing-box').info.kind, 'remote')
    assert.equal(registry.hostFor(null).id, LOCAL_MACHINE_ID)
  })

  it('registers and removes a remote host', () => {
    const registry = new HostRegistry()
    const remote = createLocalWorkspaceHost({ name: 'build-server' })
    const host = {
      ...remote,
      id: 'build-server',
      info: { ...remote.info, id: 'build-server', kind: 'remote' as const }
    }
    registry.register(host)
    assert.equal(registry.hostFor('build-server').id, 'build-server')
    assert.equal(registry.remove('build-server'), true)
    assert.equal(registry.hostFor('build-server').info.kind, 'remote')
    assert.equal(registry.hostFor('build-server').info.online, false)
  })

  it('refuses to remove the local host', () => {
    const registry = new HostRegistry()
    assert.equal(registry.remove(LOCAL_MACHINE_ID), false)
    assert.ok(registry.get(LOCAL_MACHINE_ID))
  })
})
