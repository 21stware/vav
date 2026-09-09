import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { whichOnHost } from './procWhich.ts'

describe('whichOnHost', () => {
  const host = createLocalWorkspaceHost({ name: 'which' })

  it('returns null when nothing is asked', async () => {
    assert.equal(await whichOnHost(host, []), null)
    assert.equal(await whichOnHost(host, ['', '  ']), null)
  })

  it('accepts an absolute path that exists', async () => {
    assert.equal(await whichOnHost(host, [process.execPath]), process.execPath)
  })

  it('skips a missing absolute path and finds a PATH name', async () => {
    assert.equal(await whichOnHost(host, ['/no/such/vav-server-which-missing']), null)
    const found = await whichOnHost(host, ['/no/such/vav-server-which-missing', 'node'])
    assert.ok(found)
    assert.match(found, /node/i)
  })
})
