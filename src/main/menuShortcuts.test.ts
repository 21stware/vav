import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { zoomCommandFromInput } from './menuShortcuts.ts'

const mac = process.platform === 'darwin'

function down(
  partial: Partial<{
    key: string
    code: string
    control: boolean
    alt: boolean
    shift: boolean
    meta: boolean
  }>
): Parameters<typeof zoomCommandFromInput>[0] {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    control: false,
    alt: false,
    shift: false,
    meta: false,
    ...partial
  }
}

describe('zoomCommandFromInput', () => {
  it('maps the View-menu zoom chords', () => {
    const mod = mac ? { meta: true } : { control: true }
    assert.equal(zoomCommandFromInput(down({ ...mod, key: '=', code: 'Equal' })), 'zoom-in')
    assert.equal(zoomCommandFromInput(down({ ...mod, key: '+', code: 'Equal', shift: true })), 'zoom-in')
    assert.equal(zoomCommandFromInput(down({ ...mod, key: '-', code: 'Minus' })), 'zoom-out')
    assert.equal(zoomCommandFromInput(down({ ...mod, key: '0', code: 'Digit0' })), 'zoom-reset')
    assert.equal(zoomCommandFromInput(down({ key: '=', code: 'Equal' })), null)
  })
})
