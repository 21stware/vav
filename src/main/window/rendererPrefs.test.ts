import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostWindowTitle, mainWindowSize, rendererPrefs } from './rendererPrefs.ts'

describe('rendererPrefs', () => {
  it('locks sandbox off and keeps background timers', () => {
    const prefs = rendererPrefs('/preload.js', { spellcheck: false })
    assert.equal(prefs.preload, '/preload.js')
    assert.equal(prefs.sandbox, false)
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(prefs.backgroundThrottling, false)
    assert.equal(prefs.spellcheck, false)
  })
})

describe('mainWindowSize / hostWindowTitle', () => {
  it('sizes snapshot and e2e shells and titles remote hosts', () => {
    assert.deepEqual(mainWindowSize({ snapshotting: true, e2e: false }), {
      width: 1440,
      height: 900
    })
    assert.deepEqual(mainWindowSize({ snapshotting: false, e2e: true }).width, 1100)
    assert.deepEqual(mainWindowSize({ snapshotting: false, e2e: false }).width, 720)
    assert.equal(hostWindowTitle('VAV', true, 'office'), 'VAV')
    assert.equal(hostWindowTitle('VAV', false, ' studio '), 'VAV — studio')
  })
})
