import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WINDOW_BG_DARK,
  WINDOW_BG_LIGHT,
  windowBackgroundColor,
  windowThemeNameFromDark
} from './shellPaint.ts'

describe('windowBackgroundColor', () => {
  it('matches the renderer bootstrap fills, including vibrancy alpha', () => {
    assert.equal(windowBackgroundColor(true), WINDOW_BG_DARK)
    assert.equal(windowBackgroundColor(false), WINDOW_BG_LIGHT)
    assert.equal(windowBackgroundColor(true, '01'), `${WINDOW_BG_DARK}01`)
    assert.equal(windowThemeNameFromDark(true), 'dark')
    assert.equal(windowThemeNameFromDark(false), 'light')
  })
})
