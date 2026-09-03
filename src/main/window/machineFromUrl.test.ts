import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { machineIdFromRendererUrl } from './machineFromUrl.ts'

describe('machineIdFromRendererUrl', () => {
  it('reads ?machine= and falls back to local', () => {
    assert.equal(machineIdFromRendererUrl('https://app/?view=main&machine=studio'), 'studio')
    assert.equal(machineIdFromRendererUrl('https://app/'), 'local')
    assert.equal(machineIdFromRendererUrl(''), 'local')
    assert.equal(machineIdFromRendererUrl('not a url'), 'local')
  })
})
