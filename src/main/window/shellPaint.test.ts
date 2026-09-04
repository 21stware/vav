import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WINDOW_BG_DARK,
  WINDOW_BG_LIGHT,
  chromeOptions,
  overlayColors,
  trafficLightOrigin,
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

describe('trafficLightOrigin / overlayColors', () => {
  it('centers the 12px lights on the toolbar and follows the window fill', () => {
    assert.deepEqual(trafficLightOrigin(42), { x: 12, y: 15 })
    assert.deepEqual(overlayColors(true, 42), {
      color: WINDOW_BG_DARK,
      symbolColor: '#efeff1',
      height: 42
    })
    assert.deepEqual(overlayColors(false, 40).color, WINDOW_BG_LIGHT)
  })
})

describe('chromeOptions', () => {
  it('uses hiddenInset + glass on macOS and overlay chrome elsewhere', () => {
    const overlay = overlayColors(true, 42)
    const macGlass = chromeOptions({
      isMac: true,
      barHeight: 42,
      vibrancyShell: true,
      vibrancyEnabled: true,
      background: WINDOW_BG_DARK,
      backgroundVibrancy: `${WINDOW_BG_DARK}01`,
      overlay
    })
    assert.equal(macGlass.titleBarStyle, 'hiddenInset')
    assert.equal(macGlass.vibrancy, 'under-window')
    assert.equal(macGlass.transparent, true)
    const win = chromeOptions({
      isMac: false,
      barHeight: 42,
      vibrancyEnabled: false,
      background: WINDOW_BG_LIGHT,
      backgroundVibrancy: `${WINDOW_BG_LIGHT}01`,
      overlay
    })
    assert.equal(win.titleBarStyle, 'hidden')
    assert.equal(win.autoHideMenuBar, false)
    assert.deepEqual(win.titleBarOverlay, overlay)
  })
})
