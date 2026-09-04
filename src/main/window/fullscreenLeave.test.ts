import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  afterLeavingFullscreen,
  closeLeavingFullscreenDisposition,
  destroyLeavingFullscreen,
  hideLeavingFullscreen
} from './fullscreenLeave.ts'

function win(opts: {
  destroyed?: boolean
  fullscreen?: boolean
  hide?: () => void
}): {
  isDestroyed: () => boolean
  isFullScreen: () => boolean
  once: (event: 'leave-full-screen', listener: () => void) => void
  setFullScreen: (value: boolean) => void
  hide: () => void
  leave?: () => void
  fullscreenSet?: boolean
} {
  let leave: (() => void) | undefined
  const self = {
    isDestroyed: () => !!opts.destroyed,
    isFullScreen: () => !!opts.fullscreen,
    once: (_event: 'leave-full-screen', listener: () => void) => {
      leave = listener
    },
    setFullScreen: (value: boolean) => {
      self.fullscreenSet = value
    },
    hide: opts.hide ?? (() => {}),
    fullscreenSet: undefined as boolean | undefined,
    get leave() {
      return leave
    }
  }
  return self
}

describe('afterLeavingFullscreen', () => {
  it('is a no-op on a destroyed window', () => {
    let ran = 0
    afterLeavingFullscreen(win({ destroyed: true, fullscreen: true }), () => {
      ran += 1
    })
    assert.equal(ran, 0)
  })

  it('runs immediately when not fullscreen', () => {
    let ran = 0
    afterLeavingFullscreen(win({ fullscreen: false }), () => {
      ran += 1
    })
    assert.equal(ran, 1)
  })

  it('waits for leave-full-screen then runs', () => {
    let ran = 0
    const w = win({ fullscreen: true })
    afterLeavingFullscreen(w, () => {
      ran += 1
    })
    assert.equal(ran, 0)
    assert.equal(w.fullscreenSet, false)
    w.leave?.()
    assert.equal(ran, 1)
  })

  it('does not run after destroy during leave-full-screen', () => {
    let ran = 0
    let destroyed = false
    const w = {
      isDestroyed: () => destroyed,
      isFullScreen: () => true,
      once: (_event: 'leave-full-screen', listener: () => void) => {
        destroyed = true
        listener()
      },
      setFullScreen: () => {}
    }
    afterLeavingFullscreen(w, () => {
      ran += 1
    })
    assert.equal(ran, 0)
  })
})

describe('hideLeavingFullscreen', () => {
  it('hides after leaving fullscreen', () => {
    let hidden = 0
    hideLeavingFullscreen(win({ fullscreen: false, hide: () => { hidden += 1 } }))
    assert.equal(hidden, 1)
  })
})

describe('destroyLeavingFullscreen', () => {
  it('marks allowed then destroys after leaving fullscreen', () => {
    let marked = 0
    let destroyed = 0
    const w = {
      ...win({ fullscreen: false }),
      destroy: () => {
        destroyed += 1
      }
    }
    destroyLeavingFullscreen(w, () => {
      marked += 1
    })
    assert.equal(marked, 1)
    assert.equal(destroyed, 1)
  })
})

describe('closeLeavingFullscreenDisposition', () => {
  it('allows quit, destroy, and non-fullscreen close', () => {
    assert.equal(
      closeLeavingFullscreenDisposition({
        quitting: true,
        destroyed: false,
        alreadyAllowed: false,
        isFullScreen: true
      }),
      'allow'
    )
    assert.equal(
      closeLeavingFullscreenDisposition({
        quitting: false,
        destroyed: true,
        alreadyAllowed: false,
        isFullScreen: true
      }),
      'allow'
    )
    assert.equal(
      closeLeavingFullscreenDisposition({
        quitting: false,
        destroyed: false,
        alreadyAllowed: false,
        isFullScreen: false
      }),
      'allow'
    )
  })

  it('consumes a one-shot allow then defers fullscreen close', () => {
    assert.equal(
      closeLeavingFullscreenDisposition({
        quitting: false,
        destroyed: false,
        alreadyAllowed: true,
        isFullScreen: true
      }),
      'allow-once'
    )
    assert.equal(
      closeLeavingFullscreenDisposition({
        quitting: false,
        destroyed: false,
        alreadyAllowed: false,
        isFullScreen: true
      }),
      'leave-then-reclose'
    )
  })
})
