import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import { startCapturedPointerDrag } from './capturedPointerDrag.ts'

const dom = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { document: dom.document, window: dom.window })

function fakeHandle(opts?: { captureFails?: boolean }): {
  el: HTMLElement
  listeners: Map<string, Set<EventListener>>
} {
  const listeners = new Map<string, Set<EventListener>>()
  const captured = new Set<number>()
  const el = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn)
    },
    setPointerCapture(id: number) {
      if (opts?.captureFails) throw new Error('no capture')
      captured.add(id)
    },
    hasPointerCapture(id: number) {
      return captured.has(id)
    },
    releasePointerCapture(id: number) {
      captured.delete(id)
    }
  } as unknown as HTMLElement
  return { el, listeners }
}

function pointerEvent(extras: { currentTarget: EventTarget }): {
  button: number
  pointerId: number
  currentTarget: EventTarget
  preventDefault: () => void
  clientX: number
  clientY: number
} {
  return {
    button: 0,
    pointerId: 1,
    preventDefault() {},
    clientX: 0,
    clientY: 0,
    ...extras
  }
}

describe('startCapturedPointerDrag', () => {
  it('keeps move/up on the handle after setPointerCapture', () => {
    const { el, listeners } = fakeHandle()
    const moves: number[] = []
    let ups = 0
    startCapturedPointerDrag(pointerEvent({ currentTarget: el }), {
      onMove: () => moves.push(1),
      onUp: () => {
        ups += 1
      }
    })
    assert.equal(el.hasPointerCapture(1), true)
    assert.equal(document.documentElement.dataset.resizing, 'true')
    listeners.get('pointermove')!.forEach((fn) => fn(new Event('pointermove')))
    listeners.get('pointerup')!.forEach((fn) => fn(new Event('pointerup')))
    assert.deepEqual(moves, [1])
    assert.equal(ups, 1)
    assert.equal(document.documentElement.dataset.resizing, undefined)
    assert.equal(el.hasPointerCapture(1), false)
  })

  it('ends the drag on pointerup even if capture is lost first', () => {
    const { el, listeners } = fakeHandle()
    let ups = 0
    startCapturedPointerDrag(pointerEvent({ currentTarget: el }), {
      onMove: () => undefined,
      onUp: () => {
        ups += 1
      }
    })
    listeners.get('lostpointercapture')!.forEach((fn) => fn(new Event('lostpointercapture')))
    listeners.get('pointerup')!.forEach((fn) => fn(new Event('pointerup')))
    assert.equal(ups, 1)
  })
})
