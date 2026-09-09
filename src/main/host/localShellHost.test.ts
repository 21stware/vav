import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCAL_MACHINE_ID } from '../../shared/workspaceHost.ts'
import { HostRegistry, createLocalWorkspaceHost } from './WorkspaceHost.ts'
import {
  conversationUsesLocalNode,
  localShellHostOf,
  waitForMountedLocalShell,
  workspaceHostForConversation
} from './localShellHost.ts'

function localShellHost() {
  const base = createLocalWorkspaceHost({ name: 'loopback-vav-server' })
  return {
    ...base,
    id: 'vav-server-loop',
    info: { ...base.info, id: 'vav-server-loop', kind: 'remote' as const, localShell: true }
  }
}

describe('localShellHost', () => {
  it('falls back to this process when no spawned vav-server is mounted', () => {
    const registry = new HostRegistry()
    assert.equal(localShellHostOf(registry), null)
    assert.equal(workspaceHostForConversation(registry, LOCAL_MACHINE_ID).id, LOCAL_MACHINE_ID)
    assert.equal(conversationUsesLocalNode(registry, LOCAL_MACHINE_ID), true)
  })

  it('routes local conversations through the spawned vav-server host', () => {
    const registry = new HostRegistry()
    const shell = localShellHost()
    registry.register(shell)
    assert.equal(localShellHostOf(registry)?.id, 'vav-server-loop')
    assert.equal(workspaceHostForConversation(registry, null).id, 'vav-server-loop')
    assert.equal(workspaceHostForConversation(registry, LOCAL_MACHINE_ID).id, 'vav-server-loop')
    assert.equal(conversationUsesLocalNode(registry, LOCAL_MACHINE_ID), false)
  })

  it('leaves paired remotes on their own host', () => {
    const registry = new HostRegistry()
    registry.register(localShellHost())
    const remote = createLocalWorkspaceHost({ name: 'build-server' })
    registry.register({
      ...remote,
      id: 'build-server',
      info: { ...remote.info, id: 'build-server', kind: 'remote' }
    })
    assert.equal(workspaceHostForConversation(registry, 'build-server').id, 'build-server')
    assert.equal(conversationUsesLocalNode(registry, 'build-server'), false)
  })

  it('returns null when no spawned vav-server is mounted', async () => {
    const registry = new HostRegistry()
    assert.equal(await waitForMountedLocalShell(registry, async () => true), null)
  })

  it('waits for pairing then the control plane before returning the shell id', async () => {
    const registry = new HostRegistry()
    let waited = ''
    const pairing = Promise.resolve()
    registry.register(localShellHost())
    const id = await waitForMountedLocalShell(
      registry,
      async (machineId) => {
        waited = machineId
        return true
      },
      pairing
    )
    assert.equal(id, 'vav-server-loop')
    assert.equal(waited, 'vav-server-loop')
  })
})
