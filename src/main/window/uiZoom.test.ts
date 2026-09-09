import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyUiZoomFactor, type ZoomableContents } from './uiZoom.ts'

function mockContents(url: string, current = 1): {
  current: { factor: number; limits: [number, number] | null }
  contents: ZoomableContents
} {
  const currentState = { factor: current, limits: null as [number, number] | null }
  return {
    current: currentState,
    contents: {
      isDestroyed: () => false,
      getURL: () => url,
      getZoomFactor: () => currentState.factor,
      setZoomFactor: (factor: number) => {
        currentState.factor = factor
      },
      setVisualZoomLevelLimits: (min: number, max: number) => {
        currentState.limits = [min, max]
        return Promise.resolve()
      }
    }
  }
}

describe('applyUiZoomFactor', () => {
  it('sets Chromium zoom on ordinary windows', () => {
    const mock = mockContents('http://localhost:5173/?view=settings', 1)
    applyUiZoomFactor(mock.contents, 1.25)
    assert.equal(mock.current.factor, 1.25)
    assert.deepEqual(mock.current.limits, [1, 1])
  })

  it('keeps screenshot and token-usage popups at 1×', () => {
    const shot = mockContents('http://localhost:5173/screenshot.html', 1.2)
    applyUiZoomFactor(shot.contents, 1.25)
    assert.equal(shot.current.factor, 1)

    const usage = mockContents('http://localhost:5173/?view=token-usage', 1.2)
    applyUiZoomFactor(usage.contents, 1.25)
    assert.equal(usage.current.factor, 1)
  })
})
