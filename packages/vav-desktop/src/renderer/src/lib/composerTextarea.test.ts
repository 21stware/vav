import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  composerWheelStaysOnField,
  COMPOSER_MAX_ROWS,
  fitComposerTextarea
} from './composerTextarea.ts'

describe('composerWheelStaysOnField', () => {
  it('lets the parent scroll when the field is not overflowing', () => {
    assert.equal(
      composerWheelStaysOnField({ scrollTop: 0, scrollHeight: 40, clientHeight: 40 }, 20),
      false
    )
  })

  it('keeps downward wheel on the field while more content is below', () => {
    assert.equal(
      composerWheelStaysOnField({ scrollTop: 0, scrollHeight: 240, clientHeight: 120 }, 40),
      true
    )
  })

  it('releases downward wheel at the bottom so the transcript can move', () => {
    assert.equal(
      composerWheelStaysOnField({ scrollTop: 120, scrollHeight: 240, clientHeight: 120 }, 40),
      false
    )
  })

  it('keeps upward wheel on the field while scrolled down', () => {
    assert.equal(
      composerWheelStaysOnField({ scrollTop: 40, scrollHeight: 240, clientHeight: 120 }, -20),
      true
    )
  })

  it('releases upward wheel at the top', () => {
    assert.equal(
      composerWheelStaysOnField({ scrollTop: 0, scrollHeight: 240, clientHeight: 120 }, -20),
      false
    )
  })

  it('caps the composer at eight rows', () => {
    assert.equal(COMPOSER_MAX_ROWS, 8)
  })
})

describe('fitComposerTextarea', () => {
  it('enables overflow from the uncapped content height', () => {
    const style: { height?: string; overflowY?: string } = {}
    const el = {
      style,
      scrollHeight: 400
    } as HTMLTextAreaElement
    fitComposerTextarea(el, { focused: true, disabled: false, lineHeight: 20 })
    assert.equal(style.height, `${COMPOSER_MAX_ROWS * 20}px`)
    assert.equal(style.overflowY, 'auto')
  })

  it('hides overflow when the draft is shorter than the cap', () => {
    const style: { height?: string; overflowY?: string } = {}
    const el = {
      style,
      scrollHeight: 40
    } as HTMLTextAreaElement
    fitComposerTextarea(el, { focused: false, disabled: false, lineHeight: 20 })
    assert.equal(style.height, '40px')
    assert.equal(style.overflowY, 'hidden')
  })
})
