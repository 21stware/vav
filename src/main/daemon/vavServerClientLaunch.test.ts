import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveVavServerPairing, resolveVavServerSpawn, shouldRestoreInProcessPty } from './vavServerClientLaunch.ts'

describe('resolveVavServerPairing', () => {
  it('reads VAV_SERVER_URI', () => {
    assert.equal(resolveVavServerPairing({ VAV_SERVER_URI: 'vav-daemon://secret' }, []), 'vav-daemon://secret')
  })

  it('prefers --vav-server-uri over the environment', () => {
    assert.equal(
      resolveVavServerPairing({ VAV_SERVER_URI: 'from-env' }, ['node', 'app', '--vav-server-uri', 'from-arg']),
      'from-arg'
    )
  })

  it('accepts --vav-server= and ignores empty values', () => {
    assert.equal(resolveVavServerPairing({}, ['--vav-server=vav-daemon://x']), 'vav-daemon://x')
    assert.equal(resolveVavServerPairing({ VAV_SERVER_URI: '  ' }, ['--vav-server-uri=']), null)
    assert.equal(resolveVavServerPairing({}, []), null)
  })
})

describe('resolveVavServerSpawn', () => {
  it('reads VAV_SERVER_SPAWN and --with-vav-server', () => {
    assert.equal(resolveVavServerSpawn({ VAV_SERVER_SPAWN: '1' }, []), true)
    assert.equal(resolveVavServerSpawn({}, ['--with-vav-server']), true)
    assert.equal(resolveVavServerSpawn({}, []), true)
  })

  it('spawns by default unless opted out', () => {
    assert.equal(resolveVavServerSpawn({}, [], { packaged: true }), true)
    assert.equal(resolveVavServerSpawn({}, [], { packaged: false }), true)
    assert.equal(resolveVavServerSpawn({ VAV_SERVER_SPAWN: '0' }, [], { packaged: true }), false)
    assert.equal(resolveVavServerSpawn({}, ['--no-vav-server'], { packaged: true }), false)
  })

  it('keeps e2e and snapshot in-process unless they opt in', () => {
    assert.equal(resolveVavServerSpawn({ VAV_E2E: '1' }, []), false)
    assert.equal(resolveVavServerSpawn({ VAV_SNAPSHOT: '1' }, []), false)
    assert.equal(resolveVavServerSpawn({ VAV_E2E: '1', VAV_SERVER_SPAWN: '1' }, []), true)
  })

  it('does not spawn when a pairing URI is already set', () => {
    assert.equal(resolveVavServerSpawn({ VAV_SERVER_SPAWN: '1', VAV_SERVER_URI: 'vav-daemon://x' }, []), false)
    assert.equal(resolveVavServerSpawn({}, [], { packaged: true }), true)
  })
})

describe('shouldRestoreInProcessPty', () => {
  it('skips restore when the window is a shell over vav-server', () => {
    assert.equal(shouldRestoreInProcessPty({}, []), false)
    assert.equal(shouldRestoreInProcessPty({ VAV_SERVER_SPAWN: '1' }, []), false)
    assert.equal(shouldRestoreInProcessPty({ VAV_SERVER_URI: 'vavrtp://x' }, []), false)
    assert.equal(shouldRestoreInProcessPty({ VAV_SNAPSHOT: '1' }, []), false)
  })

  it('restores only for an in-process host', () => {
    assert.equal(shouldRestoreInProcessPty({ VAV_SERVER_SPAWN: '0' }, []), true)
    assert.equal(shouldRestoreInProcessPty({ VAV_E2E: '1' }, []), true)
    assert.equal(shouldRestoreInProcessPty({ VAV_E2E: '1', VAV_SERVER_SPAWN: '1' }, []), false)
  })
})
