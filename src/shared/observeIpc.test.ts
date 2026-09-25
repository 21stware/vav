import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  OBSERVE_DEFAULT_PORT,
  isLoopbackObserveOrigin,
  observeEnabled,
  observePort
} from './observeIpc.ts'

describe('observeIpc helpers', () => {
  it('reads the port and on/off flags from env', () => {
    assert.equal(observePort({}), OBSERVE_DEFAULT_PORT)
    assert.equal(observePort({ VAV_OBSERVE_PORT: '5199' }), 5199)
    assert.equal(observeEnabled({ VAV_OBSERVE: '0', ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' }), false)
    assert.equal(observeEnabled({ VAV_OBSERVE: '1' }), true)
    assert.equal(observeEnabled({ ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' }), true)
    assert.equal(observeEnabled({}), false)
  })

  it('accepts loopback browser origins', () => {
    assert.equal(isLoopbackObserveOrigin(undefined), true)
    assert.equal(isLoopbackObserveOrigin('http://127.0.0.1:5174'), true)
    assert.equal(isLoopbackObserveOrigin('http://localhost:5173'), true)
    assert.equal(isLoopbackObserveOrigin('https://evil.example'), false)
  })
})
