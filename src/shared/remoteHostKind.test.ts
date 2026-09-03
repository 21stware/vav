import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  desktopClientAgainst,
  hostOwnsTurns,
  hostSessionId,
  localSessionId,
  remoteEndpointConfig
} from './remoteHostKind.ts'

describe('remoteEndpointConfig', () => {
  it('keeps the phone on the session plane only — no fs, no local agent, no keys', () => {
    const phone = remoteEndpointConfig('phone')
    assert.equal(phone.controlPlane, true)
    assert.equal(phone.workspaceHost, false)
    assert.equal(phone.localAgent, false)
    assert.equal(phone.holdsSecrets, false)
    assert.equal(phone.driveLocalUi, true)
  })

  it('lets a desktop host run turns and drive its own UI', () => {
    const host = remoteEndpointConfig('desktop-host')
    assert.equal(host.controlPlane, true)
    assert.equal(host.workspaceHost, true)
    assert.equal(host.localAgent, true)
    assert.equal(host.driveLocalUi, true)
    assert.equal(host.holdsSecrets, true)
  })

  it('treats vavd as workspace-only — no control plane, no UI', () => {
    const daemon = remoteEndpointConfig('headless-daemon')
    assert.equal(daemon.controlPlane, false)
    assert.equal(daemon.localAgent, false)
    assert.equal(daemon.driveLocalUi, false)
    assert.equal(daemon.workspaceHost, true)
  })
})

describe('desktopClientAgainst', () => {
  it('uses the host control plane against another desktop so the controlled UI is driven', () => {
    const client = desktopClientAgainst('desktop')
    assert.equal(client.controlPlane, true)
    assert.equal(client.localAgent, false)
    assert.equal(client.holdsSecrets, false)
    assert.equal(client.workspaceHost, true)
    assert.equal(hostOwnsTurns(true, false), true)
  })

  it('falls back to a local agent only when the host is headless', () => {
    const client = desktopClientAgainst('headless')
    assert.equal(client.controlPlane, false)
    assert.equal(client.localAgent, true)
    assert.equal(client.holdsSecrets, true)
    assert.equal(hostOwnsTurns(false, false), false)
  })

  it('always treats the local machine as owning its turns', () => {
    assert.equal(hostOwnsTurns(false, true), true)
    assert.equal(hostOwnsTurns(undefined, true), true)
  })
})

describe('hostSessionId', () => {
  it('keeps the local id when the host id was free', () => {
    assert.equal(hostSessionId('e2e-host-session', null), 'e2e-host-session')
    assert.equal(hostSessionId('e2e-host-session', ''), 'e2e-host-session')
  })

  it('sends the host id when adopt remapped a collision', () => {
    assert.equal(hostSessionId('local-copy', 'e2e-host-session'), 'e2e-host-session')
  })
})

describe('localSessionId', () => {
  it('returns the adopt id when the host id collided', () => {
    assert.equal(
      localSessionId(
        [
          { id: 'local-copy', duplicateSourceId: 'e2e-host-session' },
          { id: 'e2e-host-session', duplicateSourceId: null }
        ],
        'e2e-host-session'
      ),
      'local-copy'
    )
  })

  it('keeps the host id when adopt did not remap', () => {
    assert.equal(
      localSessionId([{ id: 'e2e-host-session', duplicateSourceId: null }], 'e2e-host-session'),
      'e2e-host-session'
    )
  })
})
