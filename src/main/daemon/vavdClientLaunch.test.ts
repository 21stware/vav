import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveVavdPairing, resolveVavdSpawn } from './vavdClientLaunch.ts'

describe('resolveVavdPairing', () => {
  it('reads VAVD_URI', () => {
    assert.equal(resolveVavdPairing({ VAVD_URI: 'vav-daemon://secret' }, []), 'vav-daemon://secret')
  })

  it('prefers --vavd-uri over the environment', () => {
    assert.equal(
      resolveVavdPairing({ VAVD_URI: 'from-env' }, ['node', 'app', '--vavd-uri', 'from-arg']),
      'from-arg'
    )
  })

  it('accepts --vavd= and ignores empty values', () => {
    assert.equal(resolveVavdPairing({}, ['--vavd=vav-daemon://x']), 'vav-daemon://x')
    assert.equal(resolveVavdPairing({ VAVD_URI: '  ' }, ['--vavd-uri=']), null)
    assert.equal(resolveVavdPairing({}, []), null)
  })
})

describe('resolveVavdSpawn', () => {
  it('reads VAVD_SPAWN and --with-vavd', () => {
    assert.equal(resolveVavdSpawn({ VAVD_SPAWN: '1' }, []), true)
    assert.equal(resolveVavdSpawn({}, ['--with-vavd']), true)
    assert.equal(resolveVavdSpawn({}, []), true)
  })

  it('spawns by default unless opted out', () => {
    assert.equal(resolveVavdSpawn({}, [], { packaged: true }), true)
    assert.equal(resolveVavdSpawn({}, [], { packaged: false }), true)
    assert.equal(resolveVavdSpawn({ VAVD_SPAWN: '0' }, [], { packaged: true }), false)
    assert.equal(resolveVavdSpawn({}, ['--no-vavd'], { packaged: true }), false)
  })

  it('keeps e2e and snapshot in-process unless they opt in', () => {
    assert.equal(resolveVavdSpawn({ VAV_E2E: '1' }, []), false)
    assert.equal(resolveVavdSpawn({ VAV_SNAPSHOT: '1' }, []), false)
    assert.equal(resolveVavdSpawn({ VAV_E2E: '1', VAVD_SPAWN: '1' }, []), true)
  })

  it('does not spawn when a pairing URI is already set', () => {
    assert.equal(resolveVavdSpawn({ VAVD_SPAWN: '1', VAVD_URI: 'vav-daemon://x' }, []), false)
    assert.equal(resolveVavdSpawn({}, [], { packaged: true }), true)
  })
})
