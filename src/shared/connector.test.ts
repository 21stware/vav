import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  connectorCan,
  connectorDescriptor,
  isConnectorId,
  parseConnectorAction
} from './connector.ts'

describe('connector catalog', () => {
  it('covers every id and keeps github read-only', () => {
    assert.deepEqual(
      CONNECTOR_CATALOG.map((row) => row.id),
      [...CONNECTOR_IDS]
    )
    assert.equal(connectorCan('github', 'deploy'), false)
    assert.equal(connectorCan('vercel', 'deploy'), true)
    assert.equal(connectorDescriptor('cloudflare').trayDefault, false)
  })

  it('narrows ids and actions', () => {
    assert.equal(isConnectorId('vercel'), true)
    assert.equal(isConnectorId('plugin'), false)
    assert.equal(parseConnectorAction('deploy'), 'deploy')
    assert.equal(parseConnectorAction('merge'), null)
  })
})
