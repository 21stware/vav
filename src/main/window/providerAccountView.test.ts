import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { providerAccountViewOf } from './providerAccountView.ts'

describe('providerAccountViewOf', () => {
  it('defaults hostId, authKind, and loading', () => {
    const payload = providerAccountViewOf({
      conversationId: 'c1',
      host: null,
      hostName: 'VAV',
      signedIn: false,
      windows: [],
      theme: 'dark',
      locale: 'en',
      now: 9
    })
    assert.equal(payload.hostId, 'vav')
    assert.equal(payload.authKind, 'none')
    assert.equal(payload.loading, false)
    assert.equal(payload.now, 9)

    const signedIn = providerAccountViewOf({
      conversationId: 'c1',
      host: 'claude',
      hostName: 'Claude',
      signedIn: true,
      windows: [],
      theme: 'light',
      locale: 'zh-CN',
      now: 1
    })
    assert.equal(signedIn.hostId, 'claude')
    assert.equal(signedIn.authKind, 'oauth')
  })
})
